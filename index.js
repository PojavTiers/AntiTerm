const { Client, GatewayIntentBits, PermissionFlagsBits, ComponentType, MessageFlags } = require('discord.js');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const gifFrames = require('gif-frames');
const fs = require('fs');
const path = require('path');
const os = require('os');

const embeds = require('./embeds.js');
const setActivity = require('./activity.js');
const { connectDB, getSettings, getWhitelist } = require('./database.js');
const { sendMessage, isAuthorized, checkViolation, applyPunishment, getNsfwThreshold, createVideoCollage } = require('./utils.js');
const { getHelpContainer } = require('./help.js');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const OWNER_ID = '1450096764672544844'; // Your User ID

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

function getTopFlag(scores) {
    if (!scores) return "nsfw";
    const flags = ['porn', 'hentai', 'sexy', 'nsfw'];
    let highest = "nsfw";
    let maxScore = 0;
    for (const flag of flags) {
        if (scores[flag] && scores[flag] > maxScore) {
            maxScore = scores[flag];
            highest = flag;
        }
    }
    return highest;
}

function censorWord(word) {
    if (word === 'porn') return 'p*rn';
    if (word === 'hentai') return 'h*ntai';
    if (word === 'sexy') return 's*xy';
    if (word === 'nsfw') return 'nsfw';
    return word;
}

client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  setActivity(client);
  
  const whitelist = await getWhitelist();
  const mainGuildId = whitelist.allowedGuilds[0] || '1500445119185293404';

  try { 
      await client.application.commands.set([]);
      const mainGuild = client.guilds.cache.get(mainGuildId);
      if (mainGuild) {
          await mainGuild.commands.set([
            {
              name: 'antinsfwcontent',
              description: 'Configure AI NSFW image/video scanner',
              defaultMemberPermissions: PermissionFlagsBits.Administrator,
              options: [
                { name: 'state', description: 'On or off', type: 3, required: true, choices: [{ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }] },
                { name: 'mode', description: 'Strictness level', type: 3, required: false, choices: [{ name: 'Basic', value: 'basic' }, { name: 'Moderate', value: 'moderate' }, { name: 'Advanced', value: 'advanced' }] },
                { name: 'punishment', description: 'Punishment', type: 3, required: false, choices: [{ name: 'Delete', value: 'delete' }, { name: 'Mute', value: 'mute' }, { name: 'Kick', value: 'kick' }, { name: 'Ban', value: 'ban' }] },
                { name: 'duration', description: 'Mute duration', type: 3, required: false }
              ]
            },
            {
              name: 'antibypassfilter',
              description: 'Manage custom server filter words',
              defaultMemberPermissions: PermissionFlagsBits.Administrator,
              options: [
                { name: 'action', description: 'Add, Remove, or List', type: 3, required: true, choices: [{ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }, { name: 'List', value: 'list' }] },
                { name: 'word', description: 'The word', type: 3, required: false }
              ]
            }
          ]); 
      }
  } catch (e) { console.error(e); }
});

// --- PRIVATE BOT SECURITY (ALLOWED GUILDS) ---
const dmCooldowns = new Set();

client.on('guildCreate', async (guild) => {
    const whitelist = await getWhitelist();
    
    if (!whitelist.allowedGuilds.includes(guild.id)) {
        console.log(`[SECURITY] Unauthorized join attempt in: ${guild.name} (${guild.id}). Leaving immediately.`);
        
        try {
            const owner = await guild.fetchOwner();
            
            if (owner && !dmCooldowns.has(owner.id)) {
                dmCooldowns.add(owner.id);
                
                await owner.send("This bot is private and cannot be added to your server. It has been removed.").catch(() => {});
                
                setTimeout(() => {
                    dmCooldowns.delete(owner.id);
                }, 5000);
            }
        } catch (e) {}

        await guild.leave();
    } else {
        console.log(`[SECURITY] Successfully joined allowed server: ${guild.name}`);
    }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return interaction.reply({ content: 'Servers only.', ephemeral: true });

  const s = await getSettings(interaction.guild.id);
  if (!isAuthorized(interaction.member, s)) return interaction.reply({ content: 'No permission.', ephemeral: true });

  const arrow = await embeds.getEmoji(client, 'arrow_right2', '➜');

  if (interaction.commandName === 'antinsfwcontent') {
      const state = interaction.options.getString('state');
      if (state === 'on' && s.antiNsfw) return sendMessage(interaction, 'error', 'System Alert', [`NSFW filtering is already **ON**.`], interaction.guild, client, s);
      if (state === 'off' && !s.antiNsfw) return sendMessage(interaction, 'error', 'System Alert', [`NSFW filtering is already **OFF**.`], interaction.guild, client, s);
      
      s.antiNsfw = (state === 'on');
      if (interaction.options.getString('mode')) s.nsfwMode = interaction.options.getString('mode');
      if (interaction.options.getString('punishment')) s.nsfwPunish = interaction.options.getString('punishment');
      if (interaction.options.getString('duration')) s.nsfwDur = interaction.options.getString('duration');
      await s.save();

      if (state === 'off') {
          const desc = `Successfully turned **AntiNSFWContent** OFF`;
          const embed = await embeds.success('System Updated', desc, interaction.guild, client);
          return interaction.reply({ embeds: [embed] });
      }

      const desc = `
Successfully turned **AntiNSFWContent** ON

${arrow} **Mode:** \`${s.nsfwMode.toUpperCase()}\`
${arrow} **Punishment:** \`${s.nsfwPunish}\`
      `;
      const embed = await embeds.success('System Updated', desc, interaction.guild, client);
      return interaction.reply({ embeds: [embed] });
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  
  const whitelist = await getWhitelist();
  if (!whitelist.allowedGuilds.includes(message.guild.id)) return;

  const s = await getSettings(message.guild.id);
  const lowerContent = message.content.toLowerCase();
  
  // --- OWNER ONLY WHITELIST COMMANDS ---
  if (lowerContent.startsWith('$whitelist') && message.author.id === OWNER_ID) {
      const args = message.content.slice(1).trim().split(/ +/);
      const cmd = args.shift().toLowerCase();
      const arrow = await embeds.getEmoji(client, 'arrow_right2', '➜');

      if (cmd === 'whitelist_add') {
          const guildId = args[0];
          if (!guildId) return sendMessage(message, 'error', 'Invalid Input', ['Please provide a Guild ID.'], message.guild, client, s);
          
          if (whitelist.allowedGuilds.includes(guildId)) {
              return sendMessage(message, 'error', 'Already Added', ['That server is already whitelisted.'], message.guild, client, s);
          }
          
          whitelist.allowedGuilds.push(guildId);
          await whitelist.save();
          
          return sendMessage(message, 'success', 'Whitelist Updated', [`Successfully added \`${guildId}\` to the whitelist.`], message.guild, client, s);
      }

      if (cmd === 'whitelist_remove') {
          const guildId = args[0];
          if (!guildId) return sendMessage(message, 'error', 'Invalid Input', ['Please provide a Guild ID.'], message.guild, client, s);
          
          const index = whitelist.allowedGuilds.indexOf(guildId);
          if (index === -1) {
              return sendMessage(message, 'error', 'Not Found', ['That server is not in the whitelist.'], message.guild, client, s);
          }
          
          whitelist.allowedGuilds.splice(index, 1);
          await whitelist.save();
          
          const targetGuild = client.guilds.cache.get(guildId);
          if (targetGuild) await targetGuild.leave().catch(()=>{});

          return sendMessage(message, 'success', 'Whitelist Updated', [`Successfully removed \`${guildId}\` from the whitelist.`], message.guild, client, s);
      }

      if (cmd === 'whitelist_list') {
          if (whitelist.allowedGuilds.length === 0) {
              return sendMessage(message, 'warning', 'Empty', ['No servers are whitelisted.'], message.guild, client, s);
          }
          
          const list = whitelist.allowedGuilds.map(id => `\`${id}\``).join(', ');
          return sendMessage(message, 'info', 'Whitelisted Servers', [`${arrow} ${list}`], message.guild, client, s);
      }
      return;
  }

  if (lowerContent.startsWith('$')) {
      const arrow = await embeds.getEmoji(client, 'arrow_right2', '➜');
      if (!isAuthorized(message.member, s)) {
          return sendMessage(message, 'error', 'Access Denied', [`You do not have permission to use this.`], message.guild, client, s);
      }
      
      const args = message.content.slice(1).trim().split(/ +/);
      const cmd = args.shift().toLowerCase();

      if (cmd === 'help') {
        let currentPage = 1;
        const helpMenu = await getHelpContainer(currentPage, client, 2);
        const msg = await message.reply({ components: [helpMenu], flags: MessageFlags.IsComponentsV2 });
        
        const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
        collector.on('collect', async i => {
            if (i.user.id !== message.author.id) return i.reply({ content: "Not your menu.", ephemeral: true });
            if (i.customId === 'delete_msg') return msg.delete().catch(()=>{});
            if (i.customId === 'prev_page' && currentPage > 1) currentPage--;
            if (i.customId === 'next_page' && currentPage < 2) currentPage++;
            const newMenu = await getHelpContainer(currentPage, client, 2);
            await i.update({ components: [newMenu], flags: MessageFlags.IsComponentsV2 });
        });
        return;
      }

      const nsfwAliases = ['antinsfwcontent', 'antinsfw', 'antinsfwbypass'];
      const filterAliases = ['antibypassfilter', 'filter'];

      // --- CUSTOM FORMAT FOR ANTINSFW ---
      if (nsfwAliases.includes(cmd)) {
        const state = args[0]?.toLowerCase();
        
        if (state !== 'on' && state !== 'off') {
            const desc = `
${arrow} **Current Mode:** \`${s.nsfwMode.toUpperCase()}\`
${arrow} **Punishment:** \`${s.nsfwPunish}\`
${arrow} **Usage Examples:**
${arrow} \`$AntiNsfw on --mode:advanced\`
${arrow} \`$AntiNsfw on --punishment:mute --duration:1h\`
            `;
            const embed = await embeds.info('Configuration', desc, message.guild, client);
            return message.reply({ embeds: [embed] });
        }
        
        if (state === 'on' && s.antiNsfw) return sendMessage(message, 'error', 'System Alert', [`NSFW filtering is already **ON**.`], message.guild, client, s);
        if (state === 'off' && !s.antiNsfw) return sendMessage(message, 'error', 'System Alert', [`NSFW filtering is already **OFF**.`], message.guild, client, s);

        s.antiNsfw = (state === 'on');
        const punishFlag = args.find(a => a.startsWith('--punishment'));
        if (punishFlag) s.nsfwPunish = punishFlag.split(':')[1]?.toLowerCase() || args[args.indexOf(punishFlag)+1]?.toLowerCase();
        const durFlag = args.find(a => a.startsWith('--duration'));
        if (durFlag) s.nsfwDur = durFlag.split(':')[1]?.toLowerCase() || args[args.indexOf(durFlag)+1]?.toLowerCase();
        const modeFlag = args.find(a => a.startsWith('--mode'));
        if (modeFlag) {
            const modeVal = modeFlag.split(':')[1]?.toLowerCase() || args[args.indexOf(modeFlag)+1]?.toLowerCase();
            if (['basic', 'moderate', 'advanced'].includes(modeVal)) s.nsfwMode = modeVal;
        }
        await s.save();

        if (state === 'off') {
            const desc = `Successfully turned **AntiNSFWContent** OFF`;
            const embed = await embeds.success('System Updated', desc, message.guild, client);
            return message.reply({ embeds: [embed] });
        }

        const desc = `
Successfully turned **AntiNSFWContent** ON

${arrow} **Mode:** \`${s.nsfwMode.toUpperCase()}\`
${arrow} **Punishment:** \`${s.nsfwPunish}\`
        `;
        const embed = await embeds.success('System Updated', desc, message.guild, client);
        return message.reply({ embeds: [embed] });
      }

      // --- CUSTOM FORMAT FOR FILTER ---
      if (filterAliases.includes(cmd)) {
        const action = args[0]?.toLowerCase();
        const word = args[1]?.toLowerCase();

        if (action !== 'add' && action !== 'remove' && action !== 'list') {
            const desc = `
${arrow} **Total Filtered Words:** \`${s.words.length}\`
${arrow} **Usage Examples:**
${arrow} \`$Filter add <word>\`
${arrow} \`$Filter remove <word>\`
${arrow} \`$Filter list\`
            `;
            const embed = await embeds.info('Configuration', desc, message.guild, client);
            return message.reply({ embeds: [embed] });
        }

        if (action === 'list') {
            if (s.words.length === 0) {
                const desc = `There are currently no custom filtered words.`;
                const embed = await embeds.warning('System Alert', desc, message.guild, client);
                return message.reply({ embeds: [embed] });
            }
            const desc = `**Current Filtered Words:**\n${arrow} \`${s.words.join('`, `')}\``;
            const embed = await embeds.info('Configuration', desc, message.guild, client);
            return message.reply({ embeds: [embed] });
        }
        
        if (!word) {
            const desc = `Please provide a word to add or remove.`;
            const embed = await embeds.error('Invalid Input', desc, message.guild, client);
            return message.reply({ embeds: [embed] });
        }
        
        if (action === 'add') {
            if (s.words.includes(word)) {
                const desc = `The word \`${word}\` is already in the filter.`;
                const embed = await embeds.error('System Alert', desc, message.guild, client);
                return message.reply({ embeds: [embed] });
            }
            s.words.push(word);
            await s.save();
            const desc = `Successfully added \`${word}\` to the filter.`;
            const embed = await embeds.success('Filter Updated', desc, message.guild, client);
            return message.reply({ embeds: [embed] });
        }
        
        if (action === 'remove') {
            const index = s.words.indexOf(word);
            if (index === -1) {
                const desc = `The word \`${word}\` was not found in the filter.`;
                const embed = await embeds.error('System Alert', desc, message.guild, client);
                return message.reply({ embeds: [embed] });
            }
            s.words.splice(index, 1);
            await s.save();
            const desc = `Successfully removed \`${word}\` from the filter.`;
            const embed = await embeds.success('Filter Updated', desc, message.guild, client);
            return message.reply({ embeds: [embed] });
        }
        return;
      }
      return; 
  }

  // TEXT FILTER (Always on if words exist)
  if (s.words.length > 0) {
    let textToScan = message.content;
    if (message.messageSnapshots.size > 0) textToScan += " " + message.messageSnapshots.first().content;

    let violation = false;
    if (s.words.some(w => checkViolation(textToScan, w))) violation = true;

    if (violation) {
        await message.delete().catch(() => {});
        
        const desc = `<@${message.author.id}> That word is not allowed on this server.`;
        const embed = await embeds.warning('Word Blocked', desc, message.guild, client);
        
        const warning = await message.channel.send({ embeds: [embed] }).catch(()=>{});
        setTimeout(() => warning.delete().catch(() => {}), 5000);
        return; 
    }
  }

  // AI SCANNER (Checks forwards)
  if (s.antiNsfw) {
     const threshold = getNsfwThreshold(s.nsfwMode);
     let isUnsafe = false;
     let detectedFlag = "nsfw";
     let mediaUrls = []; 

     if (message.embeds.length > 0) {
         const embed = message.embeds[0];
         if (embed.thumbnail && embed.thumbnail.url) mediaUrls.push(embed.thumbnail.url);
         if (embed.image && embed.image.url) mediaUrls.push(embed.image.url);
         if (embed.video && embed.video.url) mediaUrls.push(embed.video.url);
     }

     if (message.messageSnapshots.size > 0) {
         const snapshot = message.messageSnapshots.first();
         if (snapshot.attachments.size > 0) mediaUrls.push(snapshot.attachments.first().url);
         if (snapshot.embeds.length > 0) {
             const embed = snapshot.embeds[0];
             if (embed.thumbnail && embed.thumbnail.url) mediaUrls.push(embed.thumbnail.url);
             if (embed.image && embed.image.url) mediaUrls.push(embed.image.url);
             if (embed.video && embed.video.url) mediaUrls.push(embed.video.url);
         }
     }

     if (message.attachments.size > 0) mediaUrls.push(message.attachments.first().url);
     if (message.content.match(/https?:\/\/[^\s]+/)) mediaUrls.push(message.content.match(/https?:\/\/[^\s]+/)[0]);

     for (let mediaUrl of mediaUrls) {
         if (isUnsafe) break;
         try {
             let finalUrl = mediaUrl;
             if (!finalUrl.match(/\.(jpeg|jpg|png|gif|mp4|webm)/i) && !finalUrl.includes('cdn.discordapp.com')) {
                 const webRes = await fetch(finalUrl); const html = await webRes.text();
                 const mediaMatch = html.match(/(https:\/\/[^"']+\.(?:gif|mp4|webm))/i);
                 if (mediaMatch) finalUrl = mediaMatch[0]; else continue;
             }
             
             const isVideo = finalUrl.toLowerCase().includes('.mp4') || finalUrl.toLowerCase().includes('.webm');
             const isGif = finalUrl.toLowerCase().includes('.gif');
             
             const imageResponse = await fetch(finalUrl);
             const contentType = imageResponse.headers.get('content-type');
             const imageBuffer = await imageResponse.arrayBuffer();
             const buffer = Buffer.from(imageBuffer);

             if (isVideo) {
                 const collageBuffer = await createVideoCollage(buffer);
                 if (collageBuffer) {
                     const formData = new FormData(); 
                     formData.append('image', new Blob([collageBuffer], { type: 'image/jpeg' }), 'collage.jpg');
                     const apiRes = await fetch(process.env.NSFW_API_URL + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
                     const data = JSON.parse(await apiRes.text());
                     if (data.safe === false || (data.scores && (data.scores.nsfw > threshold || data.scores.sexy > threshold || data.scores.hentai > threshold || data.scores.porn > threshold))) {
                         isUnsafe = true;
                         detectedFlag = getTopFlag(data.scores);
                     }
                 }
             } else if (isGif) { 
                 try {
                     const frameData = await gifFrames({ url: buffer, frames: 'all', outputType: 'jpeg', cumulative: true });
                     if (frameData && frameData.length > 0) {
                         const totalFrames = frameData.length; const framesToCheck = Math.min(5, totalFrames); const step = Math.floor(totalFrames / framesToCheck) || 1;
                         for (let i = 0; i < framesToCheck; i++) {
                             const frame = frameData[i * step];
                             const frameBuffer = await new Promise((resolve, reject) => { const chunks = []; const stream = frame.getImage(); stream.on('data', (chunk) => chunks.push(chunk)); stream.on('end', () => resolve(Buffer.concat(chunks))); stream.on('error', reject); });
                             const formData = new FormData(); formData.append('image', new Blob([frameBuffer], { type: 'image/jpeg' }), `frame_${i}.jpg`);
                             const apiRes = await fetch(process.env.NSFW_API_URL + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
                             const data = JSON.parse(await apiRes.text());
                             if (data.safe === false || (data.scores && (data.scores.nsfw > threshold || data.scores.sexy > threshold || data.scores.hentai > threshold || data.scores.porn > threshold))) { 
                                 isUnsafe = true; 
                                 detectedFlag = getTopFlag(data.scores);
                                 break; 
                             }
                         }
                     }
                 } catch (e) {}
             } else {
                 const blob = new Blob([imageBuffer], { type: contentType || 'image/jpeg' }); const formData = new FormData(); formData.append('image', blob, 'image.jpg');
                 const response = await fetch(process.env.NSFW_API_URL + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
                 const data = JSON.parse(await response.text());
                 if (data.safe === false || (data.flags && data.flags.length > 0) || (data.scores && ((data.scores.nsfw > threshold) || (data.scores.sexy > threshold) || (data.scores.hentai > threshold) || (data.scores.porn > threshold)))) {
                     isUnsafe = true;
                     detectedFlag = getTopFlag(data.scores);
                 }
             }
         } catch (err) { console.error(err); }
     }

     if (isUnsafe) {
         await message.delete().catch(() => {});
         await applyPunishment(message.member, s.nsfwPunish, s.nsfwDur, 'Posted NSFW media.', message, client);
         
         const censoredFlag = censorWord(detectedFlag);
         
         const desc = `<@${message.author.id}> That image is not allowed on this server, flagged \`${censoredFlag}\``;
         
         const embed = await embeds.warning('NSFW Detected', desc, message.guild, client);
         const warningMsg = await message.channel.send({ embeds: [embed] }).catch(e => console.error("Failed to send warning:", e));
         
         if (warningMsg) setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
     }
  }
});

// Start Bot
connectDB().then(() => {
    client.login(process.env.DISCORD_TOKEN);
});
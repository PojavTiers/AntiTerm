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
const { connectDB, getSettings } = require('./database.js');
const { sendMessage, isAuthorized, checkViolation, applyPunishment, getNsfwThreshold, createVideoCollage, EXTREME_SLURS, MEDIUM_INSULTS, SAFE_WORDS } = require('./utils.js');
const { getHelpContainer } = require('./help.js');
const { handleConfig } = require('./config.js');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

let WEB_PROFANITY_LIST = [];
async function fetchWebProfanity() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en');
        const text = await response.text();
        WEB_PROFANITY_LIST = text.split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 2 && !SAFE_WORDS.includes(w));
    } catch (e) { console.error('[DEBUG] Failed to fetch profanity list:', e); }
}

async function scanImageUrl(url, threshold) {
    try {
        const res = await fetch(url);
        const buffer = await res.arrayBuffer();
        const formData = new FormData();
        formData.append('image', new Blob([buffer], { type: res.headers.get('content-type') || 'image/jpeg' }), 'image.jpg');
        const apiRes = await fetch(process.env.NSFW_API_URL + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
        const data = JSON.parse(await apiRes.text());
        if (data.safe === false || (data.flags && data.flags.length > 0) || (data.scores && (
            data.scores.nsfw > threshold || data.scores.sexy > threshold || 
            data.scores.hentai > threshold || data.scores.porn > threshold
        ))) return true;
        return false;
    } catch (e) { return false; }
}

client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  setActivity(client);
  await fetchWebProfanity();
  
  try { 
      await client.application.commands.set([
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
          name: 'antinsfwmessages',
          description: 'Configure text filter and sensitivity',
          defaultMemberPermissions: PermissionFlagsBits.Administrator,
          options: [
            { name: 'state', description: 'On or off', type: 3, required: true, choices: [{ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }] },
            { name: 'sensitivity', description: '0.1 to 0.9', type: 3, required: false },
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
        },
        {
          name: 'config',
          description: 'Configure bot settings',
          defaultMemberPermissions: PermissionFlagsBits.Administrator,
          options: [
            { name: 'setting', description: 'What to configure', type: 3, required: true, choices: [{ name: 'Embeds', value: 'embeds' }, { name: 'NSFW Warning', value: 'nsfwwarning' }, { name: 'Word Warning', value: 'wordwarning' }] },
            { name: 'value', description: 'on/off or the text', type: 3, required: true }
          ]
        }
      ]); 
  } catch (e) { console.error(e); }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return interaction.reply({ content: 'Servers only.', ephemeral: true });

  const s = await getSettings(interaction.guild.id);
  if (!isAuthorized(interaction.member, s)) return interaction.reply({ content: 'No permission.', ephemeral: true });

  if (interaction.commandName === 'config') {
      await handleConfig(interaction, [interaction.options.getString('setting'), interaction.options.getString('value')], s, client); 
  }
  
  if (interaction.commandName === 'antinsfwcontent') {
      const state = interaction.options.getString('state');
      if (state === 'on' && s.antiNsfw) return interaction.reply({ content: '❌ AntiNSFW is already **ON**.', ephemeral: true });
      if (state === 'off' && !s.antiNsfw) return interaction.reply({ content: '❌ AntiNSFW is already **OFF**.', ephemeral: true });
      
      s.antiNsfw = (state === 'on');
      if (interaction.options.getString('mode')) s.nsfwMode = interaction.options.getString('mode');
      if (interaction.options.getString('punishment')) s.nsfwPunish = interaction.options.getString('punishment');
      if (interaction.options.getString('duration')) s.nsfwDur = interaction.options.getString('duration');
      await s.save();
      return sendMessage(interaction, 'success', 'Updated', [`NSFW filtering is now \`${s.antiNsfw ? 'on' : 'off'}\` (Mode: \`${s.nsfwMode}\`)`], interaction.guild, client, s);
  }

  if (interaction.commandName === 'antinsfwmessages') {
      const state = interaction.options.getString('state');
      if (state === 'on' && s.termMessages) return interaction.reply({ content: '❌ Text filter is already **ON**.', ephemeral: true });
      if (state === 'off' && !s.termMessages) return interaction.reply({ content: '❌ Text filter is already **OFF**.', ephemeral: true });

      s.termMessages = (state === 'on');
      if (interaction.options.getString('sensitivity')) s.sensitivity = parseFloat(interaction.options.getString('sensitivity'));
      if (interaction.options.getString('punishment')) s.msgPunish = interaction.options.getString('punishment');
      if (interaction.options.getString('duration')) s.msgDur = interaction.options.getString('duration');
      await s.save();
      return sendMessage(interaction, 'success', 'Updated', [`Text filtering is now \`${s.termMessages ? 'on' : 'off'}\``], interaction.guild, client, s);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const s = await getSettings(message.guild.id);
  const lowerContent = message.content.toLowerCase();
  
  if (lowerContent.startsWith('$')) {
      if (!isAuthorized(message.member, s)) return sendMessage(message, 'error', 'Access Denied', ['You cannot use this.'], message.guild, client, s);
      
      const args = message.content.slice(1).trim().split(/ +/);
      const cmd = args.shift().toLowerCase();

      if (cmd === 'help') {
        let currentPage = 1;
        const msg = await message.reply({ components: [getHelpContainer(currentPage, client, message.guild, 2)], flags: MessageFlags.IsComponentsV2 });
        const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
        collector.on('collect', async i => {
            if (i.user.id !== message.author.id) return i.reply({ content: "Not your menu.", ephemeral: true });
            if (i.customId === 'delete_msg') return msg.delete().catch(()=>{});
            if (i.customId === 'prev_page' && currentPage > 1) currentPage--;
            if (i.customId === 'next_page' && currentPage < 2) currentPage++;
            await i.update({ components: [getHelpContainer(currentPage, client, message.guild, 2)], flags: MessageFlags.IsComponentsV2 });
        });
        return;
      }

      if (cmd === 'config') return handleConfig(message, args, s, client);
      
      const nsfwAliases = ['antinsfwcontent', 'antinsfw', 'antinsfwbypass'];
      const textAliases = ['antinsfwmessages', 'nonsfwtext'];
      const filterAliases = ['antibypassfilter', 'filter'];

      // --- CUSTOM FORMAT FOR ANTINSFW ---
      if (nsfwAliases.includes(cmd)) {
        const state = args[0]?.toLowerCase();
        
        // USING YOUR CUSTOM EMOJI HERE
        const arrow = embeds.getEmoji(message.guild, 'arrow_right2', '>');
        
        // If no state provided, show info
        if (state !== 'on' && state !== 'off') {
            const desc = `
${arrow} **Mode:** \`${s.nsfwMode.toUpperCase()}\`
${arrow} **Punishment:** \`${s.nsfwPunish}\`
${arrow} **Examples:**
${arrow} \`$AntiNsfw on --mode:advanced\`
${arrow} \`$AntiNsfw on --punishment:mute --duration:1h\`
            `;
            return message.reply({ embeds: [embeds.info('', desc, message.guild, client, 'General')] });
        }
        
        // Check if already on/off
        if (state === 'on' && s.antiNsfw) return sendMessage(message, 'error', 'Already Enabled', ['NSFW filtering is already **ON**.'], message.guild, client, s);
        if (state === 'off' && !s.antiNsfw) return sendMessage(message, 'error', 'Already Disabled', ['NSFW filtering is already **OFF**.'], message.guild, client, s);

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

        const successDesc = `
${arrow} **Mode:** \`${s.nsfwMode.toUpperCase()}\`
${arrow} **Punishment:** \`${s.nsfwPunish}\`
        `;
        return message.reply({ embeds: [embeds.success('', successDesc, message.guild, client, 'General')] });
      }

      // --- CUSTOM FORMAT FOR NOSFWTEXT ---
      if (textAliases.includes(cmd)) {
        const state = args[0]?.toLowerCase();
        
        // USING YOUR CUSTOM EMOJI HERE
        const arrow = embeds.getEmoji(message.guild, 'arrow_right2', '>');

        if (state !== 'on' && state !== 'off') {
            const desc = `
${arrow} **Sensitivity:** \`${s.sensitivity}\`
${arrow} **Punishment:** \`${s.msgPunish}\`
${arrow} **Examples:**
${arrow} \`$NoNsfwText on 0.8\`
${arrow} \`$NoNsfwText on 0.9 --punishment:mute\`
            `;
            return message.reply({ embeds: [embeds.info('', desc, message.guild, client, 'General')] });
        }

        if (state === 'on' && s.termMessages) return sendMessage(message, 'error', 'Already Enabled', ['Text filtering is already **ON**.'], message.guild, client, s);
        if (state === 'off' && !s.termMessages) return sendMessage(message, 'error', 'Already Disabled', ['Text filtering is already **OFF**.'], message.guild, client, s);

        s.termMessages = (state === 'on');
        const sens = parseFloat(args[1]);
        if (!isNaN(sens) && sens >= 0.1 && sens <= 0.9) s.sensitivity = sens;
        const punishFlag = args.find(a => a.startsWith('--punishment'));
        if (punishFlag) s.msgPunish = punishFlag.split(':')[1]?.toLowerCase() || args[args.indexOf(punishFlag)+1]?.toLowerCase();
        const durFlag = args.find(a => a.startsWith('--duration'));
        if (durFlag) s.msgDur = durFlag.split(':')[1]?.toLowerCase() || args[args.indexOf(durFlag)+1]?.toLowerCase();
        await s.save();

        const successDesc = `
${arrow} **Sensitivity:** \`${s.sensitivity}\`
${arrow} **Punishment:** \`${s.msgPunish}\`
        `;
        return message.reply({ embeds: [embeds.success('', successDesc, message.guild, client, 'General')] });
      }

      if (filterAliases.includes(cmd)) {
        const action = args[0]?.toLowerCase();
        const word = args[1]?.toLowerCase();

        if (action === 'list') {
            if (s.words.length === 0) return sendMessage(message, 'warning', 'Empty', ['No custom words.'], message.guild, client, s);
            return sendMessage(message, 'info', 'Filtered Words', [`\`${s.words.join('`, `')}\``], message.guild, client, s);
        }
        if (!word) return sendMessage(message, 'error', 'Error', ['Provide a word.'], message.guild, client, s);
        
        if (action === 'add') {
            if (s.words.includes(word)) return sendMessage(message, 'error', 'Already Added', ['Word exists.'], message.guild, client, s);
            s.words.push(word);
            await s.save();
            return sendMessage(message, 'success', 'Word Added', [`Added \`${word}\`.`], message.guild, client, s);
        }
        if (action === 'remove') {
            const index = s.words.indexOf(word);
            if (index === -1) return sendMessage(message, 'error', 'Not Found', ['Word not found.'], message.guild, client, s);
            s.words.splice(index, 1);
            await s.save();
            return sendMessage(message, 'success', 'Word Removed', [`Removed \`${word}\`.`], message.guild, client, s);
        }
        return;
      }
      return; 
  }

  // TEXT FILTER (Checks forwards)
  if (s.termMessages) {
    let textToScan = message.content;
    if (message.messageSnapshots.size > 0) textToScan += " " + message.messageSnapshots.first().content;

    let violation = false;
    if (s.words.some(w => checkViolation(textToScan, w))) violation = true;
    else if (EXTREME_SLURS.some(w => checkViolation(textToScan, w))) violation = true;
    else if (s.sensitivity >= 0.4 && MEDIUM_INSULTS.some(w => checkViolation(textToScan, w))) violation = true;
    else if (s.sensitivity >= 0.7 && WEB_PROFANITY_LIST.some(w => checkViolation(textToScan, w))) violation = true;

    if (violation) {
        await message.delete().catch(() => {});
        await applyPunishment(message.member, s.msgPunish, s.msgDur, 'Used a banned word.', message, client);
        const customWarning = s.customMessages.wordWarning.replace('{user}', `<@${message.author.id}>`);
        const warning = await sendMessage(message.channel, 'warning', 'Word Blocked', [customWarning, `**Action:** \`${s.msgPunish.toUpperCase()}\``], message.guild, client, s);
        setTimeout(() => warning.delete().catch(() => {}), 5000);
        return; 
    }
  }

  // AI SCANNER (Checks forwards)
  if (s.antiNsfw) {
     const threshold = getNsfwThreshold(s.nsfwMode);
     let isUnsafe = false;
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
                             if (data.safe === false || (data.scores && (data.scores.nsfw > threshold || data.scores.sexy > threshold || data.scores.hentai > threshold || data.scores.porn > threshold))) { isUnsafe = true; break; }
                         }
                     }
                 } catch (e) {}
             } else {
                 const blob = new Blob([imageBuffer], { type: contentType || 'image/jpeg' }); const formData = new FormData(); formData.append('image', blob, 'image.jpg');
                 const response = await fetch(process.env.NSFW_API_URL + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
                 const data = JSON.parse(await response.text());
                 if (data.safe === false || (data.flags && data.flags.length > 0) || (data.scores && ((data.scores.nsfw > threshold) || (data.scores.sexy > threshold) || (data.scores.hentai > threshold) || (data.scores.porn > threshold)))) isUnsafe = true;
             }
         } catch (err) { console.error(err); }
     }

     if (isUnsafe) {
         await message.delete().catch(() => {});
         await applyPunishment(message.member, s.nsfwPunish, s.nsfwDur, 'Posted NSFW media.', message, client);
         
         const customWarning = s.customMessages.nsfwWarning.replace('{user}', `<@${message.author.id}>`);
         const warningMsg = await sendMessage(message.channel, 'warning', 'NSFW Detected', [customWarning, `**Action:** \`${s.nsfwPunish.toUpperCase()}\``], message.guild, client, s);
         setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
     }
  }
});

// Start Bot
connectDB().then(() => {
    client.login(process.env.DISCORD_TOKEN);
});
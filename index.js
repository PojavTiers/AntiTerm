const { Client, GatewayIntentBits, ComponentType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require('discord.js');
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

const OWNER_ID = '1450096764672544844';

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

// --- GENERATE CONFIG MENU ---
async function generateConfigMenu(client, s, guild) {
    const settingsEmoji = await embeds.getEmoji(client, 'settings', '⚙️');
    const onlineEmoji = await embeds.getEmoji(client, 'online_t', '🟢');
    const offlineEmoji = await embeds.getEmoji(client, 'offline_t', '🔴');
    
    const status = s.antiNsfw ? `${onlineEmoji} **Enabled**` : `${offlineEmoji} **Disabled**`;
    const wordCount = s.words ? s.words.length : 0;
    const userCount = s.allowedUsers ? s.allowedUsers.length : 0;
    
    const textDisplay = new TextDisplayBuilder().setContent(`
### ${settingsEmoji} AntiTerm Configuration

**NSFW Media Scanner**
➜ **Status:** ${status}
➜ **Mode:** \`${s.nsfwMode.toUpperCase()}\`
➜ **Punishment:** \`${s.nsfwPunish.toUpperCase()}\`

**Text Filter**
➜ **Filtered Words:** \`${wordCount}\`
➜ **Whitelisted Users:** \`${userCount}\`
    `);

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfg_toggle_nsfw').setLabel('Toggle Scanner').setStyle(s.antiNsfw ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cfg_mode').setLabel('Scanner Mode').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cfg_punish').setLabel('Punishment').setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfg_filter_add').setLabel('Add Word').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cfg_filter_remove').setLabel('Remove Word').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cfg_filter_list').setLabel('View Words').setStyle(ButtonStyle.Secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfg_user_add').setLabel('Add User').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cfg_user_remove').setLabel('Remove User').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cfg_user_list').setLabel('View Users').setStyle(ButtonStyle.Secondary)
    );

    return new ContainerBuilder()
        .addTextDisplayComponents(textDisplay)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
        .addActionRowComponents(row1)
        .addActionRowComponents(row2)
        .addActionRowComponents(row3);
}

client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  setActivity(client);
  
  try { 
      await client.application.commands.set([
        { name: 'config', description: 'Open the interactive configuration menu' },
        { name: 'help', description: 'View bot information and features' }
      ]); 
      console.log("[DEBUG] Global slash commands registered.");
  } catch (e) { console.error(e); }
});

const dmCooldowns = new Set();
client.on('guildCreate', async (guild) => {
    const whitelist = await getWhitelist();
    if (!whitelist.allowedGuilds.includes(guild.id)) {
        try {
            const owner = await guild.fetchOwner();
            if (owner && !dmCooldowns.has(owner.id)) {
                dmCooldowns.add(owner.id);
                await owner.send("This bot is private and cannot be added to your server.").catch(() => {});
                setTimeout(() => dmCooldowns.delete(owner.id), 5000);
            }
        } catch (e) {}
        await guild.leave();
    }
});

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.guild) return;
  
  try {
      const s = await getSettings(interaction.guild.id);

      // 1. BUTTON HANDLERS
      if (interaction.isButton()) {
          if (!isAuthorized(interaction.member, s)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });

          if (interaction.customId === 'cfg_toggle_nsfw') {
              await interaction.deferUpdate();
              s.antiNsfw = !s.antiNsfw;
              await s.save();
              const menu = await generateConfigMenu(client, s, interaction.guild);
              return interaction.editReply({ components: [menu], flags: MessageFlags.IsComponentsV2 });
          }

          if (interaction.customId === 'cfg_filter_add') {
              const modal = new ModalBuilder().setCustomId('modal_filter_add').setTitle('Add Filtered Word');
              const input = new TextInputBuilder().setCustomId('word_input').setLabel('Word to filter').setStyle(TextInputStyle.Short).setRequired(true);
              modal.addComponents(new ActionRowBuilder().addComponents(input));
              return interaction.showModal(modal);
          }

          if (interaction.customId === 'cfg_filter_remove') {
              if (!s.words || s.words.length === 0) return interaction.reply({ content: '❌ No words to remove.', ephemeral: true });
              const modal = new ModalBuilder().setCustomId('modal_filter_remove').setTitle('Remove Filtered Word');
              const input = new TextInputBuilder().setCustomId('word_input').setLabel('Word to remove').setStyle(TextInputStyle.Short).setRequired(true);
              modal.addComponents(new ActionRowBuilder().addComponents(input));
              return interaction.showModal(modal);
          }

          if (interaction.customId === 'cfg_user_add') {
              if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Only the Server Owner can manage whitelisted users.', ephemeral: true });
              const modal = new ModalBuilder().setCustomId('modal_user_add').setTitle('Add Whitelisted User');
              const input = new TextInputBuilder().setCustomId('user_id').setLabel('User ID').setStyle(TextInputStyle.Short).setRequired(true);
              modal.addComponents(new ActionRowBuilder().addComponents(input));
              return interaction.showModal(modal);
          }

          if (interaction.customId === 'cfg_user_remove') {
              if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Only the Server Owner can manage whitelisted users.', ephemeral: true });
              if (!s.allowedUsers || s.allowedUsers.length === 0) return interaction.reply({ content: '❌ No users to remove.', ephemeral: true });
              const modal = new ModalBuilder().setCustomId('modal_user_remove').setTitle('Remove Whitelisted User');
              const input = new TextInputBuilder().setCustomId('user_id').setLabel('User ID').setStyle(TextInputStyle.Short).setRequired(true);
              modal.addComponents(new ActionRowBuilder().addComponents(input));
              return interaction.showModal(modal);
          }

          if (interaction.customId === 'cfg_filter_list') {
              const words = s.words && s.words.length > 0 ? s.words.map(w => `\`${w}\``).join(', ') : 'None';
              return interaction.reply({ content: `➜ **Filtered Words:** ${words}`, ephemeral: true });
          }

          if (interaction.customId === 'cfg_user_list') {
              const users = s.allowedUsers && s.allowedUsers.length > 0 ? s.allowedUsers.map(id => `<@${id}>`).join(', ') : 'None';
              return interaction.reply({ content: `➜ **Whitelisted Users:** ${users}`, ephemeral: true });
          }

          if (interaction.customId === 'cfg_mode') {
              const select = new StringSelectMenuBuilder().setCustomId('select_mode').setPlaceholder('Select a mode').addOptions([
                  { label: 'Basic', description: 'Only hardcore porn', value: 'basic' },
                  { label: 'Moderate', description: 'Standard filtering', value: 'moderate' },
                  { label: 'Advanced', description: 'Strict (suggestive content)', value: 'advanced' }
              ]);
              return interaction.reply({ content: 'Select the new mode:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
          }

          if (interaction.customId === 'cfg_punish') {
              const select = new StringSelectMenuBuilder().setCustomId('select_punish').setPlaceholder('Select a punishment').addOptions([
                  { label: 'Delete', value: 'delete' }, { label: 'Mute', value: 'mute' },
                  { label: 'Kick', value: 'kick' }, { label: 'Ban', value: 'ban' }
              ]);
              return interaction.reply({ content: 'Select the punishment:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
          }
      }

      // 2. SELECT MENU HANDLERS
      if (interaction.isStringSelectMenu()) {
          if (!isAuthorized(interaction.member, s)) return;
          
          if (interaction.customId === 'select_mode') {
              s.nsfwMode = interaction.values[0];
              await s.save();
              const menu = await generateConfigMenu(client, s, interaction.guild);
              // Use update instead of editReply for component interactions
              await interaction.update({ components: [menu], flags: MessageFlags.IsComponentsV2 });
              return;
          }

          if (interaction.customId === 'select_punish') {
              s.nsfwPunish = interaction.values[0];
              await s.save();
              const menu = await generateConfigMenu(client, s, interaction.guild);
              await interaction.update({ components: [menu], flags: MessageFlags.IsComponentsV2 });
              return;
          }
      }

      // 3. MODAL SUBMIT HANDLERS
      if (interaction.isModalSubmit()) {
          if (!isAuthorized(interaction.member, s)) return;
          await interaction.deferReply({ ephemeral: true });
          const input = interaction.fields.getTextInputValue('word_input') || interaction.fields.getTextInputValue('user_id');

          if (interaction.customId === 'modal_filter_add') {
              const word = input.toLowerCase().trim();
              if (!s.words) s.words = [];
              if (s.words.includes(word)) return interaction.editReply({ content: '❌ Word is already filtered.' });
              s.words.push(word);
              await s.save();
              return interaction.editReply({ content: `✅ Added \`${word}\` to filter.` });
          }

          if (interaction.customId === 'modal_filter_remove') {
              const word = input.toLowerCase().trim();
              if (!s.words) s.words = [];
              const index = s.words.indexOf(word);
              if (index === -1) return interaction.editReply({ content: '❌ Word not found in filter.' });
              s.words.splice(index, 1);
              await s.save();
              return interaction.editReply({ content: `✅ Removed \`${word}\` from filter.` });
          }

          if (interaction.customId === 'modal_user_add') {
              const userId = input.replace(/[<@!>]/g, '').trim();
              if (!s.allowedUsers) s.allowedUsers = [];
              if (s.allowedUsers.includes(userId)) return interaction.editReply({ content: '❌ User is already whitelisted.' });
              s.allowedUsers.push(userId);
              await s.save();
              return interaction.editReply({ content: `✅ Whitelisted <@${userId}>.` });
          }

          if (interaction.customId === 'modal_user_remove') {
              const userId = input.replace(/[<@!>]/g, '').trim();
              if (!s.allowedUsers) s.allowedUsers = [];
              const index = s.allowedUsers.indexOf(userId);
              if (index === -1) return interaction.editReply({ content: '❌ User is not whitelisted.' });
              s.allowedUsers.splice(index, 1);
              await s.save();
              return interaction.editReply({ content: `✅ Removed <@${userId}> from whitelist.` });
          }
      }

      // 4. SLASH COMMANDS
      if (interaction.isChatInputCommand()) {
          if (interaction.commandName === 'config') {
              await interaction.deferReply();
              if (!isAuthorized(interaction.member, s)) return interaction.editReply({ content: '❌ No permission.' });
              const menu = await generateConfigMenu(client, s, interaction.guild);
              return interaction.editReply({ components: [menu], flags: MessageFlags.IsComponentsV2 });
          }
          if (interaction.commandName === 'help') {
              await interaction.deferReply();
              const helpMenu = await getHelpContainer(1, client, 2);
              return interaction.editReply({ components: [helpMenu], flags: MessageFlags.IsComponentsV2 });
          }
      }
  } catch (error) {
      console.error("Interaction Error:", error);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  
  try {
      const whitelist = await getWhitelist();
      if (!whitelist.allowedGuilds.includes(message.guild.id)) return;

      const s = await getSettings(message.guild.id);
      const lowerContent = message.content.toLowerCase();
      
      if (lowerContent === '$config') {
          if (!isAuthorized(message.member, s)) return sendMessage(message, 'error', 'Access Denied', ['You do not have permission.'], message.guild, client, s);
          const menu = await generateConfigMenu(client, s, message.guild);
          return message.reply({ components: [menu], flags: MessageFlags.IsComponentsV2 });
      }

      if (lowerContent === '$help') {
          const helpMenu = await getHelpContainer(1, client, 2);
          const msg = await message.reply({ components: [helpMenu], flags: MessageFlags.IsComponentsV2 });
          
          let currentPage = 1;
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

      // TEXT FILTER
      if (s.words && s.words.length > 0) {
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

      // AI SCANNER
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
                 
                 console.log(`[SCANNER] Checking URL: ${finalUrl}`);

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
                         console.log(`[SCANNER] Video Response:`, data.scores || data);
                         if (data.safe === false || (data.scores && (data.scores.nsfw > threshold || data.scores.sexy > threshold || data.scores.hentai > threshold || data.scores.porn > threshold))) { isUnsafe = true; detectedFlag = getTopFlag(data.scores); }
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
                                 console.log(`[SCANNER] GIF Frame ${i} Response:`, data.scores || data);
                                 if (data.safe === false || (data.scores && (data.scores.nsfw > threshold || data.scores.sexy > threshold || data.scores.hentai > threshold || data.scores.porn > threshold))) { isUnsafe = true; detectedFlag = getTopFlag(data.scores); break; }
                             }
                         }
                     } catch (e) { console.error("[SCANNER] GIF Error:", e); }
                 } else {
                     const blob = new Blob([imageBuffer], { type: contentType || 'image/jpeg' }); const formData = new FormData(); formData.append('image', blob, 'image.jpg');
                     const response = await fetch(process.env.NSFW_API_URL + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
                     const data = JSON.parse(await response.text());
                     console.log(`[SCANNER] Image Response:`, data.scores || data);
                     if (data.safe === false || (data.flags && data.flags.length > 0) || (data.scores && ((data.scores.nsfw > threshold) || (data.scores.sexy > threshold) || (data.scores.hentai > threshold) || (data.scores.porn > threshold)))) { isUnsafe = true; detectedFlag = getTopFlag(data.scores); }
                 }
             } catch (err) { console.error("[SCANNER] Fetch Error:", err); }
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
  } catch (error) {
      console.error("Message Error:", error);
  }
});

// Start Bot
connectDB().then(() => {
    client.login(process.env.DISCORD_TOKEN);
});
const { Client, GatewayIntentBits, ComponentType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require('discord.js');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const fs = require('fs');
const path = require('path');
const os = require('os');

const embeds = require('./embeds.js');
const setActivity = require('./activity.js');
const { connectDB, getSettings, getWhitelist } = require('./database.js');
const { sendMessage, isAuthorized, checkViolation, applyPunishment, getNsfwThreshold } = require('./utils.js');
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

function parseApiScores(predictionArray) {
    const scores = { porn: 0, hentai: 0, sexy: 0, drawing: 0, neutral: 0 };
    if (Array.isArray(predictionArray)) {
        for (const item of predictionArray) {
            const className = (item.className || '').toLowerCase();
            if (className === 'porn') scores.porn = item.probability;
            if (className === 'hentai') scores.hentai = item.probability;
            if (className === 'sexy') scores.sexy = item.probability;
            if (className === 'drawing') scores.drawing = item.probability;
            if (className === 'neutral') scores.neutral = item.probability;
        }
    }
    return scores;
}

function getTopFlag(scores) {
    if (!scores) return "nsfw";
    const flags = ['porn', 'hentai', 'sexy', 'drawing'];
    let highest = "nsfw";
    let maxScore = 0;
    for (const flag of flags) {
        if (scores[flag] && scores[flag] > maxScore) {
            maxScore = scores[flag];
            highest = flag;
        }
    }
    if (highest === 'drawing') return 'hentai'; 
    return highest;
}

function censorWord(word) {
    if (word === 'porn') return 'p*rn';
    if (word === 'hentai') return 'h*ntai';
    if (word === 'sexy') return 's*xy';
    if (word === 'nsfw') return 'nsfw';
    return word;
}

async function createVideoCollage(videoBuffer, isGif = false) {
    const tempVideoPath = path.join(os.tmpdir(), `vid_${Date.now()}.${isGif ? 'gif' : 'mp4'}`);
    const outputPath = path.join(os.tmpdir(), `collage_${Date.now()}.jpg`);
    fs.writeFileSync(tempVideoPath, videoBuffer);

    try {
        await new Promise((resolve, reject) => {
            ffmpeg(tempVideoPath)
                .on('end', resolve)
                .on('error', reject)
                .outputOptions([
                    '-vf', 'select=\'not(mod(n\\,15))\',scale=256:256,tile=3x3', 
                    '-frames:v', '1', 
                    '-q:v', '4'
                ])
                .save(outputPath);
        });
        return fs.readFileSync(outputPath);
    } catch (err) {
        console.error("[SCANNER ERROR] Collage generation failed:", err);
        return null;
    } finally {
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
}

async function generateConfigMenu(client, s, guild) {
    const settingsEmoji = await embeds.getEmoji(client, 'settings', '⚙️');
    const onlineEmoji = await embeds.getEmoji(client, 'online_t', '🟢');
    const offlineEmoji = await embeds.getEmoji(client, 'offline_t', '🔴');
    const arrow = await embeds.getEmoji(client, 'arrow_long', '➜');
    
    const status = s.antiNsfw ? `${onlineEmoji} **Enabled**` : `${offlineEmoji} **Disabled**`;
    const wordCount = s.words ? s.words.length : 0;
    const userCount = s.allowedUsers ? s.allowedUsers.length : 0;
    
    const textDisplay = new TextDisplayBuilder().setContent(`
### ${settingsEmoji} AntiTerm Dashboard

**NSFW Media Scanner**
${arrow} **Status:** ${status}
${arrow} **Mode:** \`${s.nsfwMode.toUpperCase()}\`
${arrow} **Punishment:** \`${s.nsfwPunish.toUpperCase()}\`

**Text Filter**
${arrow} **Filtered Words:** \`${wordCount}\`
${arrow} **Whitelisted Users:** \`${userCount}\`

*Select an option from the menu below to configure.*
    `);

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('config_menu')
        .setPlaceholder('Select a setting to configure...')
        .addOptions([
            { label: 'Toggle Scanner', description: 'Turn the NSFW media scanner on or off', value: 'action_toggle_nsfw' },
            { label: 'Scanner Mode', description: 'Change the AI strictness', value: 'action_mode' },
            { label: 'Punishment', description: 'Set what happens to rule breakers', value: 'action_punish' },
            { label: 'Add Filter Words', description: 'Add words to the unbypassable filter', value: 'action_add_word' },
            { label: 'Remove Filter Word', description: 'Remove a word from the text filter', value: 'action_remove_word' },
            { label: 'View Filtered Words', description: 'See all currently blocked words', value: 'action_list_words' },
            { label: 'Add Whitelisted User', description: 'Allow a user to configure the bot', value: 'action_add_user' },
            { label: 'Remove Whitelisted User', description: 'Revoke a user\'s access to the bot', value: 'action_remove_user' },
            { label: 'View Whitelisted Users', description: 'See who can configure the bot', value: 'action_list_users' },
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    return new ContainerBuilder()
        .addTextDisplayComponents(textDisplay)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
        .addActionRowComponents(row);
}

client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  setActivity(client);
  
  // DEBUG: Check if variables loaded
  console.log(`[STARTUP] NSFW_API_URL loaded: ${process.env.NSFW_API_URL ? 'YES' : 'NO'}`);
  console.log(`[STARTUP] API_KEY loaded: ${process.env.API_KEY ? 'YES' : 'NO'}`);
  
  try { 
      await client.application.commands.set([
        { name: 'config', description: 'Open the interactive configuration menu' },
        { name: 'help', description: 'View bot information and features' }
      ]); 
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

client.on('interactionCreate', async (interaction) => {
  if (!interaction.guild) return;
  
  try {
      const s = await getSettings(interaction.guild.id);

      if (interaction.isStringSelectMenu() && interaction.customId === 'config_menu') {
          if (!isAuthorized(interaction.member, s)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
          
          const action = interaction.values[0];

          if (action === 'action_add_word') {
              const modal = new ModalBuilder().setCustomId('modal_filter_add').setTitle('Add Filtered Words');
              const input = new TextInputBuilder().setCustomId('word_input').setLabel('Words (Separate with commas)').setPlaceholder('word1, word2, word3').setStyle(TextInputStyle.Paragraph).setRequired(true);
              modal.addComponents(new ActionRowBuilder().addComponents(input));
              return interaction.showModal(modal);
          }

          if (action === 'action_remove_word') {
              if (!s.words || s.words.length === 0) return interaction.reply({ content: '❌ No words to remove.', ephemeral: true });
              const modal = new ModalBuilder().setCustomId('modal_filter_remove').setTitle('Remove Filtered Word');
              const input = new TextInputBuilder().setCustomId('word_input').setLabel('Word to remove').setStyle(TextInputStyle.Short).setRequired(true);
              modal.addComponents(new ActionRowBuilder().addComponents(input));
              return interaction.showModal(modal);
          }

          if (action === 'action_add_user') {
              if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Only the Server Owner can manage whitelisted users.', ephemeral: true });
              const modal = new ModalBuilder().setCustomId('modal_user_add').setTitle('Add Whitelisted User');
              const input = new TextInputBuilder().setCustomId('user_id').setLabel('User ID').setStyle(TextInputStyle.Short).setRequired(true);
              modal.addComponents(new ActionRowBuilder().addComponents(input));
              return interaction.showModal(modal);
          }

          if (action === 'action_remove_user') {
              if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Only the Server Owner can manage whitelisted users.', ephemeral: true });
              if (!s.allowedUsers || s.allowedUsers.length === 0) return interaction.reply({ content: '❌ No users to remove.', ephemeral: true });
              const modal = new ModalBuilder().setCustomId('modal_user_remove').setTitle('Remove Whitelisted User');
              const input = new TextInputBuilder().setCustomId('user_id').setLabel('User ID').setStyle(TextInputStyle.Short).setRequired(true);
              modal.addComponents(new ActionRowBuilder().addComponents(input));
              return interaction.showModal(modal);
          }

          await interaction.deferUpdate();

          if (action === 'action_toggle_nsfw') {
              s.antiNsfw = !s.antiNsfw;
              await s.save();
              const menu = await generateConfigMenu(client, s, interaction.guild);
              return interaction.editReply({ components: [menu], flags: MessageFlags.IsComponentsV2 });
          }

          if (action === 'action_mode') {
              const modeSelect = new StringSelectMenuBuilder().setCustomId('select_mode').setPlaceholder('Select a mode').addOptions([
                  { label: 'Basic', description: 'Only hardcore porn', value: 'basic' },
                  { label: 'Moderate', description: 'Standard filtering', value: 'moderate' },
                  { label: 'Advanced', description: 'Strict (bikinis, suggestive)', value: 'advanced' }
              ]);
              return interaction.followUp({ content: 'Select the new mode:', components: [new ActionRowBuilder().addComponents(modeSelect)], ephemeral: true });
          }

          if (action === 'action_punish') {
              const punishSelect = new StringSelectMenuBuilder().setCustomId('select_punish').setPlaceholder('Select a punishment').addOptions([
                  { label: 'Delete', value: 'delete' }, { label: 'Mute', value: 'mute' },
                  { label: 'Kick', value: 'kick' }, { label: 'Ban', value: 'ban' }
              ]);
              return interaction.followUp({ content: 'Select the punishment:', components: [new ActionRowBuilder().addComponents(punishSelect)], ephemeral: true });
          }

          if (action === 'action_list_words') {
              const words = s.words && s.words.length > 0 ? s.words.map(w => `\`${w}\``).join(', ') : 'None';
              return interaction.followUp({ content: `➜ **Filtered Words:** ${words}`, ephemeral: true });
          }

          if (action === 'action_list_users') {
              const users = s.allowedUsers && s.allowedUsers.length > 0 ? s.allowedUsers.map(id => `<@${id}>`).join(', ') : 'None';
              return interaction.followUp({ content: `➜ **Whitelisted Users:** ${users}`, ephemeral: true });
          }
      }

      if (interaction.isStringSelectMenu() && (interaction.customId === 'select_mode' || interaction.customId === 'select_punish')) {
          if (!isAuthorized(interaction.member, s)) return;
          await interaction.deferUpdate();

          if (interaction.customId === 'select_mode') {
              s.nsfwMode = interaction.values[0];
              await s.save();
              const menu = await generateConfigMenu(client, s, interaction.guild);
              await interaction.editReply({ components: [menu], flags: MessageFlags.IsComponentsV2 });
              return interaction.followUp({ content: `✅ Mode changed to **${s.nsfwMode.toUpperCase()}**`, ephemeral: true });
          }

          if (interaction.customId === 'select_punish') {
              s.nsfwPunish = interaction.values[0];
              await s.save();
              const menu = await generateConfigMenu(client, s, interaction.guild);
              await interaction.editReply({ components: [menu], flags: MessageFlags.IsComponentsV2 });
              return interaction.followUp({ content: `✅ Punishment changed to **${s.nsfwPunish.toUpperCase()}**`, ephemeral: true });
          }
      }

      if (interaction.isModalSubmit()) {
          if (!isAuthorized(interaction.member, s)) return;
          await interaction.deferReply({ ephemeral: true });
          const input = interaction.fields.getTextInputValue('word_input') || interaction.fields.getTextInputValue('user_id');

          if (interaction.customId === 'modal_filter_add') {
              const newWords = input.split(',').map(w => w.toLowerCase().trim()).filter(w => w.length > 0);
              if (!s.words) s.words = [];
              
              let addedCount = 0;
              let duplicateCount = 0;

              for (const word of newWords) {
                  if (s.words.includes(word)) {
                      duplicateCount++;
                  } else {
                      s.words.push(word);
                      addedCount++;
                  }
              }
              await s.save();
              
              let response = `✅ Successfully added **${addedCount}** word(s) to the filter.`;
              if (duplicateCount > 0) response += `\n⚠️ Skipped **${duplicateCount}** word(s) already filtered.`;
              return interaction.editReply({ content: response });
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
         let threshold = 0.50;
         if (s.nsfwMode === 'advanced') threshold = 0.05;
         else if (s.nsfwMode === 'moderate') threshold = 0.25;
         else if (s.nsfwMode === 'basic') threshold = 0.50;

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
                 
                 let apiUrl = process.env.NSFW_API_URL;
                 // FIXED: Looks for API_KEY
                 let apiKey = process.env.API_KEY; 
                 
                 if (!apiUrl) {
                     console.error("[SCANNER CRITICAL] NSFW_API_URL is missing in Railway Variables!");
                     return;
                 }
                 if (!apiKey) {
                     console.error("[SCANNER CRITICAL] API_KEY is missing in Railway Variables!");
                     return;
                 }

                 if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
                     apiUrl = 'https://' + apiUrl;
                 }

                 const scanImage = async (imageBlob) => {
                     const formData = new FormData(); 
                     formData.append('image', imageBlob, 'image.jpg');
                     
                     console.log(`[SCANNER] Sending request to: ${apiUrl}/classify`);
                     
                     const apiRes = await fetch(apiUrl + '/classify', { 
                         method: 'POST', 
                         body: formData,
                         headers: { 'Authorization': `Bearer ${apiKey}` }
                     });
                     
                     console.log(`[SCANNER] HTTP Status: ${apiRes.status} ${apiRes.statusText}`);

                     const rawData = await apiRes.text();
                     
                     if (!apiRes.ok) {
                         console.error(`[SCANNER CRITICAL] API rejected request. Raw Body:`, rawData);
                         return;
                     }

                     try {
                         const data = JSON.parse(rawData);
                         const scores = parseApiScores(data.prediction);
                         
                         console.log(`[SCANNER DEBUG] Threshold: ${threshold}`);
                         console.log(`[SCANNER DEBUG] Porn: ${(scores.porn*100).toFixed(2)}% | Hentai: ${(scores.hentai*100).toFixed(2)}% | Sexy: ${(scores.sexy*100).toFixed(2)}% | Drawing: ${(scores.drawing*100).toFixed(2)}%`);
                         
                         const isHighDrawing = scores.drawing > 0.50 && s.nsfwMode === 'advanced';

                         if (scores && (
                             (scores.porn > threshold) ||
                             (scores.hentai > threshold) || 
                             (scores.sexy > threshold) || 
                             isHighDrawing 
                         )) { 
                             isUnsafe = true; 
                             detectedFlag = isHighDrawing ? 'hentai' : getTopFlag(scores); 
                             console.log(`[SCANNER DEBUG] FLAGGED AS NSFW! Flag: ${detectedFlag}`);
                         } else {
                             console.log(`[SCANNER DEBUG] Passed. Image deemed SAFE.`);
                         }
                     } catch(e) {
                         console.error("[SCANNER CRITICAL] Failed to parse API JSON. Raw Body:", rawData);
                     }
                 };

                 if (isVideo || isGif) {
                     const collageBuffer = await createVideoCollage(buffer, isGif);
                     if (collageBuffer) {
                         console.log(`[SCANNER] Sending COLLAGE...`);
                         await scanImage(new Blob([collageBuffer], { type: 'image/jpeg' }));
                     }
                 } else {
                     console.log(`[SCANNER] Sending IMAGE...`);
                     await scanImage(new Blob([imageBuffer], { type: contentType || 'image/jpeg' }));
                 }
             } catch (err) { console.error("[SCANNER ERROR] Catch block:", err); }
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

connectDB().then(() => {
    client.login(process.env.DISCORD_TOKEN);
});
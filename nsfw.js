const { Client, GatewayIntentBits, ComponentType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require('discord.js');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

const embeds = require('./embeds.js');
const setActivity = require('./activity.js');
const { connectDB, getSettings, getWhitelist } = require('./database.js');
const { sendMessage, isAuthorized, checkViolation, applyPunishment } = require('./utils.js');
const { getHelpContainer } = require('./help.js');
const { scanMedia } = require('./nsfw.js');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const OWNER_ID = '1450096764672544844';
const nsfwCooldowns = new Map(); 

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

function censorWord(word) {
    if (word === 'porn') return 'p*rn';
    if (word === 'hentai') return 'h*ntai';
    if (word === 'sexy') return 's*xy';
    if (word === 'nsfw') return 'nsfw';
    return word;
}

async function generateConfigMenu(client, s, guild) {
    const settingsEmoji = await embeds.getEmoji(client, 'settings', '⚙️');
    const onlineEmoji = await embeds.getEmoji(client, 'online_t', '🟢');
    const offlineEmoji = await embeds.getEmoji(client, 'offline_t', '🔴');
    const shieldEmoji = await embeds.getEmoji(client, 'shield', '🛡️');
    const config1 = await embeds.getEmoji(client, 'config_1', '⚙️');
    const config2 = await embeds.getEmoji(client, 'config_2', '🛡️');
    const config3 = await embeds.getEmoji(client, 'config_3', '⚙️');
    
    const status = s.antiNsfw ? `${onlineEmoji} **Enabled**` : `${offlineEmoji} **Disabled**`;
    const wordCount = s.words ? s.words.length : 0;
    const userCount = s.allowedUsers ? s.allowedUsers.length : 0;
    const showMsg = s.nsfwShowMsg !== false ? 'Yes' : 'No';
    const thresh = s.nsfwMode === 'custom' ? `Custom (${s.nsfwCustomThreshold})` : s.nsfwMode.toUpperCase();
    
    const textDisplay = new TextDisplayBuilder().setContent(`
${shieldEmoji} **AntiTerm Configuration**

**NSFW Scanner**
Status: ${status}
Mode: ${thresh}
Punishment: \`${s.nsfwPunish.toUpperCase()}\`
Warn Message: \`${showMsg}\`

**Text Filter**
Blocked Words: \`${wordCount}\`
Whitelisted Users: \`${userCount}\`

Pick a category below to configure your security settings.
    `);

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('config_menu')
        .setPlaceholder('Choose a category')
        .addOptions([
            { label: 'Scanner Settings', description: 'Toggle scanner, mode, and punishment', value: 'action_scanner_menu', emoji: config1 },
            { label: 'Text Filter', description: 'Manage blocked words', value: 'action_filter_menu', emoji: config2 },
            { label: 'Whitelist', description: 'Manage authorized users', value: 'action_whitelist_menu', emoji: config3 }
        ]);

    return new ContainerBuilder()
        .addTextDisplayComponents(textDisplay)
        .addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));
}

client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  setActivity(client);
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
                await owner.send("This bot is private.").catch(() => {});
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

          if (action === 'action_scanner_menu') {
              const menu = new StringSelectMenuBuilder().setCustomId('scanner_submenu').setPlaceholder('Select scanner action...').addOptions([
                  { label: 'Toggle Scanner', description: 'Turn the NSFW media scanner on or off', value: 'action_toggle_nsfw' },
                  { label: 'Scanner Mode', description: 'Change the AI strictness', value: 'action_mode' },
                  { label: 'Punishment', description: 'Set what happens to rule breakers', value: 'action_punish' },
                  { label: 'Toggle Warn Message', description: 'Enable or disable the NSFW warning', value: 'action_toggle_warn' }
              ]);
              return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
          }

          if (action === 'action_filter_menu') {
              const menu = new StringSelectMenuBuilder().setCustomId('filter_submenu').setPlaceholder('Select filter action...').addOptions([
                  { label: 'Add Filter Words', description: 'Add words to the filter', value: 'action_add_word' },
                  { label: 'Remove Filter Word', description: 'Remove a word from the filter', value: 'action_remove_word' },
                  { label: 'View Filtered Words', description: 'See all blocked words', value: 'action_list_words' }
              ]);
              return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
          }

          if (action === 'action_whitelist_menu') {
              const menu = new StringSelectMenuBuilder().setCustomId('whitelist_submenu').setPlaceholder('Select whitelist action...').addOptions([
                  { label: 'Add Whitelisted User', description: 'Allow a user to configure', value: 'action_add_user' },
                  { label: 'Remove Whitelisted User', description: 'Revoke access', value: 'action_remove_user' },
                  { label: 'View Whitelisted Users', description: 'See authorized users', value: 'action_list_users' }
              ]);
              return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
          }
      }

      if (interaction.isStringSelectMenu() && ['scanner_submenu', 'filter_submenu', 'whitelist_submenu'].includes(interaction.customId)) {
          if (!isAuthorized(interaction.member, s)) return interaction.reply({ content: '❌ No permission.', ephemeral: true });
          const action = interaction.values[0];

          if (action === 'action_toggle_nsfw') {
              const toggleMenu = new StringSelectMenuBuilder().setCustomId('select_toggle').setPlaceholder('Choose On or Off').addOptions([
                  { label: 'On', description: 'Enable the NSFW Scanner', value: 'toggle_on' },
                  { label: 'Off', description: 'Disable the NSFW Scanner', value: 'toggle_off' }
              ]);
              return interaction.reply({ components: [new ActionRowBuilder().addComponents(toggleMenu)], ephemeral: true });
          }

          if (action === 'action_add_word') {
              const modal = new ModalBuilder().setCustomId('modal_filter_add').setTitle('Add Filtered Words');
              const input = new TextInputBuilder().setCustomId('word_input').setLabel('Words (Separate with commas)').setStyle(TextInputStyle.Paragraph).setRequired(true);
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
              if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Only the Server Owner can manage this.', ephemeral: true });
              const modal = new ModalBuilder().setCustomId('modal_user_add').setTitle('Add Whitelisted User');
              const input = new TextInputBuilder().setCustomId('user_id').setLabel('User ID').setStyle(TextInputStyle.Short).setRequired(true);
              modal.addComponents(new ActionRowBuilder().addComponents(input));
              return interaction.showModal(modal);
          }

          if (action === 'action_remove_user') {
              if (interaction.user.id !== interaction.guild.ownerId && interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Only the Server Owner can manage this.', ephemeral: true });
              if (!s.allowedUsers || s.allowedUsers.length === 0) return interaction.reply({ content: '❌ No users to remove.', ephemeral: true });
              const modal = new ModalBuilder().setCustomId('modal_user_remove').setTitle('Remove Whitelisted User');
              const input = new TextInputBuilder().setCustomId('user_id').setLabel('User ID').setStyle(TextInputStyle.Short).setRequired(true);
              modal.addComponents(new ActionRowBuilder().addComponents(input));
              return interaction.showModal(modal);
          }

          if (action === 'action_toggle_warn') {
              s.nsfwShowMsg = !s.nsfwShowMsg;
              await s.save();
              return interaction.reply({ content: `✅ Warn message is now **${s.nsfwShowMsg ? 'ON' : 'OFF'}**.`, ephemeral: true });
          }

          if (action === 'action_mode') {
              const modeSelect = new StringSelectMenuBuilder().setCustomId('select_mode').setPlaceholder('Select a mode').addOptions([
                  { label: 'Basic', description: 'Only hardcore porn', value: 'basic' },
                  { label: 'Moderate', description: 'Standard filtering', value: 'moderate' },
                  { label: 'Advanced', description: 'Strict (bikinis, suggestive)', value: 'advanced' },
                  { label: 'Custom', description: 'Set your own threshold', value: 'custom' }
              ]);
              return interaction.reply({ content: 'Select the new mode:', components: [new ActionRowBuilder().addComponents(modeSelect)], ephemeral: true });
          }

          if (action === 'action_punish') {
              const punishSelect = new StringSelectMenuBuilder().setCustomId('select_punish').setPlaceholder('Select a punishment').addOptions([
                  { label: 'Delete', value: 'delete' }, { label: 'Mute', value: 'mute' },
                  { label: 'Kick', value: 'kick' }, { label: 'Ban', value: 'ban' }
              ]);
              return interaction.reply({ content: 'Select the punishment:', components: [new ActionRowBuilder().addComponents(punishSelect)], ephemeral: true });
          }

          if (action === 'action_list_words') {
              const words = s.words && s.words.length > 0 ? s.words.map(w => `\`${w}\``).join(', ') : 'None';
              return interaction.reply({ content: `➜ **Filtered Words:** ${words}`, ephemeral: true });
          }

          if (action === 'action_list_users') {
              const users = s.allowedUsers && s.allowedUsers.length > 0 ? s.allowedUsers.map(id => `<@${id}>`).join(', ') : 'None';
              return interaction.reply({ content: `➜ **Whitelisted Users:** ${users}`, ephemeral: true });
          }
      }

      if (interaction.isStringSelectMenu() && ['select_mode', 'select_punish', 'select_toggle'].includes(interaction.customId)) {
          if (!isAuthorized(interaction.member, s)) return;

          if (interaction.customId === 'select_toggle') {
              s.antiNsfw = interaction.values[0] === 'toggle_on';
              await s.save();
              return interaction.reply({ content: `✅ Scanner is now **${s.antiNsfw ? 'ON' : 'OFF'}**.`, ephemeral: true });
          }

          if (interaction.customId === 'select_mode') {
              const val = interaction.values[0];
              if (val === 'custom') {
                  const modal = new ModalBuilder().setCustomId('modal_custom_thresh').setTitle('Custom Threshold');
                  const input = new TextInputBuilder().setCustomId('thresh_input').setLabel('Enter a number (0.01 to 0.99)').setStyle(TextInputStyle.Short).setRequired(true);
                  modal.addComponents(new ActionRowBuilder().addComponents(input));
                  return interaction.showModal(modal);
              } else {
                  s.nsfwMode = val;
                  await s.save();
                  return interaction.reply({ content: `✅ Mode changed to **${s.nsfwMode.toUpperCase()}**.`, ephemeral: true });
              }
          }

          if (interaction.customId === 'select_punish') {
              s.nsfwPunish = interaction.values[0];
              await s.save();
              return interaction.reply({ content: `✅ Punishment changed to **${s.nsfwPunish.toUpperCase()}**.`, ephemeral: true });
          }
      }

      if (interaction.isModalSubmit()) {
          if (!isAuthorized(interaction.member, s)) return;
          await interaction.deferReply({ ephemeral: true });
          const input = interaction.fields.getTextInputValue('word_input') || interaction.fields.getTextInputValue('user_id') || interaction.fields.getTextInputValue('thresh_input');

          if (interaction.customId === 'modal_custom_thresh') {
              const parsed = parseFloat(input);
              if (isNaN(parsed) || parsed <= 0 || parsed >= 1) return interaction.editReply({ content: '❌ Invalid number. Must be between 0.01 and 0.99.' });
              s.nsfwMode = 'custom';
              s.nsfwCustomThreshold = parsed;
              await s.save();
              return interaction.editReply({ content: `✅ Custom threshold set to **${parsed}**.` });
          }

          if (interaction.customId === 'modal_filter_add') {
              const newWords = input.split(',').map(w => w.toLowerCase().trim()).filter(w => w.length > 0);
              if (!s.words) s.words = [];
              let added = 0, dupes = 0;
              for (const word of newWords) {
                  if (s.words.includes(word)) dupes++;
                  else { s.words.push(word); added++; }
              }
              await s.save();
              let res = `✅ Added **${added}** word(s).`;
              if (dupes > 0) res += `\n⚠️ Skipped **${dupes}**.`;
              return interaction.editReply({ content: res });
          }

          if (interaction.customId === 'modal_filter_remove') {
              const word = input.toLowerCase().trim();
              if (!s.words) s.words = [];
              const index = s.words.indexOf(word);
              if (index === -1) return interaction.editReply({ content: '❌ Word not found.' });
              s.words.splice(index, 1);
              await s.save();
              return interaction.editReply({ content: `✅ Removed \`${word}\`.` });
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
              return interaction.editReply({ content: `✅ Removed <@${userId}>.` });
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
  // 1. First check: Is it a bot or a DM?
  if (message.author.bot || !message.guild) return;
  
  // 2. Log EXACTLY every message the bot sees
  console.log(`\n[MESSAGE EVENT] Received message in guild: ${message.guild.id} from ${message.author.tag}`);
  
  try {
      // 3. Check Whitelist
      const whitelist = await getWhitelist();
      console.log(`[MESSAGE EVENT] Whitelist loaded. Does it include this guild? ${whitelist.allowedGuilds.includes(message.guild.id)}`);
      
      if (!whitelist.allowedGuilds.includes(message.guild.id)) {
          console.log(`[MESSAGE EVENT] IGNORING MESSAGE: Guild ${message.guild.id} is not in the ALLOWED_GUILDS list.`);
          return;
      }

      const s = await getSettings(message.guild.id);
      console.log(`[MESSAGE EVENT] Settings loaded. NSFW Scanner is: ${s.antiNsfw ? 'ON' : 'OFF'}`);
      
      const lowerContent = message.content.toLowerCase();
      
      if (lowerContent === '$config') {
          if (!isAuthorized(message.member, s)) return sendMessage(message, 'error', 'Access Denied', ['You do not have permission.'], message.guild, client, s);
          const menu = await generateConfigMenu(client, s, message.guild);
          return message.reply({ components: [menu], flags: MessageFlags.IsComponentsV2 });
      }

      if (lowerContent === '$help') {
          const helpMenu = await getHelpContainer(1, client, 2);
          const msg = await message.reply({ components: [helpMenu], flags: MessageFlags.IsComponentsV2 });
          const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });
          collector.on('collect', async i => {
              if (i.user.id !== message.author.id) return i.reply({ content: "Not your menu.", ephemeral: true });
              const page = i.values[0] === 'help_page_2' ? 2 : 1;
              const newMenu = await getHelpContainer(page, client, 2);
              await i.update({ components: [newMenu], flags: MessageFlags.IsComponentsV2 });
          });
          return;
      }

      if (s.words && s.words.length > 0) {
        let textToScan = message.content;
        if (message.messageSnapshots.size > 0) textToScan += " " + message.messageSnapshots.first().content;
        if (s.words.some(w => checkViolation(textToScan, w))) {
            await message.delete().catch(() => {});
            const desc = `<@${message.author.id}> That word is not allowed on this server.`;
            const embed = await embeds.warning('Word Blocked', desc, message.guild, client);
            const warning = await message.channel.send({ embeds: [embed] }).catch(()=>{});
            setTimeout(() => warning.delete().catch(() => {}), 5000);
            return; 
        }
      }

      // --- AI SCANNER ---
      if (s.antiNsfw) {
         console.log(`[SCANNER] NSFW Scanner is ON. Checking message content...`);
         let mediaUrls = []; 

         if (message.embeds.length > 0) {
             for (const embed of message.embeds) {
                 if (embed.thumbnail && embed.thumbnail.url) mediaUrls.push(embed.thumbnail.url);
                 if (embed.image && embed.image.url) mediaUrls.push(embed.image.url);
                 if (embed.video && embed.video.url) mediaUrls.push(embed.video.url);
                 if (embed.url) mediaUrls.push(embed.url);
             }
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
         if (message.attachments.size > 0) {
             message.attachments.forEach(att => mediaUrls.push(att.url));
         }
         
         const urlRegex = /(https?:\/\/[^\s]+)/g;
         const foundUrls = message.content.match(urlRegex);
         if (foundUrls) {
             mediaUrls.push(...foundUrls);
         }

         mediaUrls = [...new Set(mediaUrls)];
         
         if (mediaUrls.length === 0) {
             console.log(`[SCANNER] No URLs or attachments found in this message. Skipping scan.`);
         } else {
             console.log(`[SCANNER] Found ${mediaUrls.length} link(s) to scan:`, mediaUrls);
         }

         for (let mediaUrl of mediaUrls) {
             console.log(`[SCANNER] Starting scan for: ${mediaUrl}`);
             const result = await scanMedia(mediaUrl, s, client);
             
             if (result.isUnsafe) {
                 console.log(`[SCANNER] MEDIA IS UNSAFE. Deleting message.`);
                 await message.delete().catch(() => {});
                 await applyPunishment(message.member, s.nsfwPunish, s.nsfwDur, 'Posted NSFW media.', message, client);
                 
                 const now = Date.now();
                 const userCooldown = nsfwCooldowns.get(message.author.id);
                 
                 if (!userCooldown || now - userCooldown > 2000) {
                     nsfwCooldowns.set(message.author.id, now);
                     if (s.nsfwShowMsg !== false) {
                         const censoredFlag = censorWord(result.detectedFlag);
                         const desc = `<@${message.author.id}> That image is not allowed on this server, flagged \`${censoredFlag}\``;
                         const embed = await embeds.warning('NSFW Detected', desc, message.guild, client);
                         const warningMsg = await message.channel.send({ embeds: [embed] }).catch(e => console.error("Failed to send warning:", e));
                         if (warningMsg) setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
                     }
                 }
                 break; 
             } else {
                 console.log(`[SCANNER] Media is safe.`);
             }
         }
      }
  } catch (error) {
      console.error("[MESSAGE CREATE ERROR]:", error);
  }
});

connectDB().then(() => {
    client.login(process.env.DISCORD_TOKEN);
});
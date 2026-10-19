const { 
    Client, GatewayIntentBits, PermissionFlagsBits, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ComponentType, 
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MessageFlags 
} = require('discord.js');
const gifFrames = require('gif-frames');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const levenshtein = require('fast-levenshtein');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const os = require('os');

const embeds = require('./embeds.js');
const setActivity = require('./activity.js');

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

// ==========================================
// 🗄️ DATABASE SETUP
// ==========================================
const settingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    antiNsfw: { type: Boolean, default: false },
    nsfwPunish: { type: String, default: 'delete' },
    nsfwDur: { type: String, default: '1h' },
    termMessages: { type: Boolean, default: false },
    sensitivity: { type: Number, default: 0.5 },
    msgPunish: { type: String, default: 'delete' },
    msgDur: { type: String, default: '1h' },
    words: { type: [String], default: [] },
    allowedUsers: { type: [String], default: [] },
    
    useEmbeds: { type: Boolean, default: true },
    customMessages: {
        nsfwWarning: { type: String, default: "Image detected as **NSFW** and deleted the message." },
        wordWarning: { type: String, default: "That word is not allowed." }
    }
});

const GuildSettings = mongoose.model('GuildSettings', settingsSchema);
const settingsCache = new Map();

async function getSettings(guildId) {
    if (settingsCache.has(guildId)) return settingsCache.get(guildId);
    let s = await GuildSettings.findOne({ guildId });
    if (!s) s = await GuildSettings.create({ guildId });
    settingsCache.set(guildId, s);
    return s;
}

// --- GLOBAL MESSAGE FORMATTER ---
function sendMessage(target, type, title, fields, guild, client, s) {
    let formattedDesc = "";
    if (Array.isArray(fields)) {
        formattedDesc = fields.map(f => `└ ${f}`).join('\n');
    } else {
        formattedDesc = fields.split('\n').map(line => line.startsWith('└') ? line : `└ ${line}`).join('\n');
    }

    if (s.useEmbeds) {
        // Using standard embeds for normal commands, but you can swap to Container if you want
        return target.reply({ embeds: [embeds[type](title, formattedDesc, guild, client)] });
    } else {
        const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
        return target.reply({ content: `${icon} **${title}**\n${formattedDesc}` });
    }
}

// ==========================================
// 🚨 WORD LISTS & SAFE WORDS 🚨
// ==========================================
const EXTREME_SLURS = ['put_racial_slurs_here', 'put_extreme_slurs_here']; 
const MEDIUM_INSULTS = ['asshole', 'bastard', 'retard', 'whore', 'slut'];
const SAFE_WORDS = ['nsfw', 'sex', 'sexual', 'assume', 'assassin', 'class', 'pass', 'bass', 'grass', 'mass', 'cocktail', 'peacock', 'shitake', 'hello', 'help'];

let WEB_PROFANITY_LIST = [];

async function fetchWebProfanity() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en');
        const text = await response.text();
        WEB_PROFANITY_LIST = text.split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 2 && !SAFE_WORDS.includes(w));
    } catch (e) { console.error('[DEBUG] Failed to fetch profanity list:', e); }
}

// --- HELPERS ---
function normalise(text) {
  return text.toLowerCase().normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's').replace(/[^a-z]/g, '');
}

function isCloseEnough(input, target) {
    if (!input || !target) return false;
    if (Math.abs(input.length - target.length) > 1) return false;
    return levenshtein.get(input, target) <= 1; 
}

function checkViolation(text, bannedWord) {
    const cleanBanned = normalise(bannedWord);
    if (!cleanBanned || cleanBanned.length < 3) return false;
    if (SAFE_WORDS.includes(cleanBanned)) return false;

    const words = text.split(/[\s,.!?]+/); 
    for (const w of words) {
        if (!w) continue;
        const cleanW = normalise(w);
        if (!cleanW) continue;

        if (cleanW === cleanBanned) return true;
        if (cleanW.length > 2 && isCloseEnough(cleanW, cleanBanned)) return true;
        
        const collapsed = cleanW.replace(/(.)\1{2,}/g, '$1');
        if (collapsed === cleanBanned) return true;
    }

    if (cleanBanned.length > 4) {
        const fullClean = normalise(text);
        if (fullClean.includes(cleanBanned)) return true;
    }
    return false;
}

function isAuthorized(member, s) {
    if (!member) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (member.id === member.guild.ownerId) return true;
    if (s.allowedUsers && s.allowedUsers.includes(member.id)) return true;
    return false;
}

function parseDuration(str) {
    if (!str) return 3600000; 
    const match = str.match(/^(\d+)([smhd])$/i);
    if (!match) return 3600000;
    const val = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 's') return val * 1000;
    if (unit === 'm') return val * 60000;
    if (unit === 'h') return val * 3600000;
    if (unit === 'd') return val * 86400000;
    return 3600000;
}

async function applyPunishment(member, type, durationStr, reason, message, client) {
    if (type === 'delete' || !type) return; 
    try {
        if (type === 'mute') await member.timeout(parseDuration(durationStr), reason);
        else if (type === 'kick') await member.kick(reason);
        else if (type === 'ban') await member.ban({ reason });
    } catch (e) {
        console.error(`Failed to ${type} user:`, e);
        if (message) message.channel.send({ content: `❌ Failed to ${type} the user. Check my role position and permissions!` });
    }
}

// --- THE EXACT CONTAINER HELP MENU ---
function getHelpContainer(page, client, guild, totalPages) {
    const p1 = `
### ℹ️ Help

**Help Commands**
├ help
└ help category

**Moderation Commands**
├ antinsfw
├ antinsfwmessages
└ antibypassfilter

**Antinuke Commands**
├ antinuke
└ antinuke admin
`;

    const p2 = `
### ℹ️ Help

**Command Examples**
├ $antinsfw on --punishment:ban
├ $antinsfwmessages on 0.8 --punishment:mute --duration:1h
├ $antibypassfilter add badword
└ $config nsfwwarning {user} posted NSFW!

**Need Help?**
├ All commands require Admin permissions.
└ Use the buttons below to navigate.
`;

    const descriptions = [p1, p2];
    const currentDesc = descriptions[page-1];

    const leftEmoji = embeds.getButtonEmoji(guild, 'arrow_left', '◀️');
    const rightEmoji = embeds.getButtonEmoji(guild, 'arrow_right', '▶️');
    const trashEmoji = embeds.getButtonEmoji(guild, 'dustbin', '🗑️'); 

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prev_page').setEmoji(leftEmoji).setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
        new ButtonBuilder().setCustomId('next_page').setEmoji(rightEmoji).setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages),
        new ButtonBuilder().setCustomId('delete_msg').setEmoji(trashEmoji).setStyle(ButtonStyle.Danger)
    );

    // Using the new Components V2 Container
    const container = new ContainerBuilder()
        .setAccentColor(0x2B2D31) // Dark gray border
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(currentDesc)
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(1)
        )
        .addActionRowComponents(row);

    return container;
}

client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  setActivity(client);

  try {
      for (const guild of client.guilds.cache.values()) {
          await guild.emojis.fetch();
      }
  } catch (e) {}

  await fetchWebProfanity();

  const punishmentOptions = [
      { name: 'Delete Only', value: 'delete' },
      { name: 'Mute', value: 'mute' },
      { name: 'Kick', value: 'kick' },
      { name: 'Ban', value: 'ban' }
  ];

  const commands = [
    {
      name: 'antinsfwcontent',
      description: 'Configure AI NSFW image/video scanner',
      defaultMemberPermissions: PermissionFlagsBits.Administrator,
      options: [
        { name: 'state', description: 'On or off', type: 3, required: true, choices: [{ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }] },
        { name: 'punishment', description: 'What to do when NSFW is found', type: 3, required: false, choices: punishmentOptions },
        { name: 'duration', description: 'Mute duration (e.g. 10m, 1h, 1d).', type: 3, required: false }
      ]
    },
    {
      name: 'antinsfwmessages',
      description: 'Configure text filter and sensitivity',
      defaultMemberPermissions: PermissionFlagsBits.Administrator,
      options: [
        { name: 'state', description: 'On or off', type: 3, required: true, choices: [{ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }] },
        { name: 'sensitivity', description: '0.1 (Slurs only) to 0.9 (Everything)', type: 3, required: false },
        { name: 'punishment', description: 'What to do when bad words are found', type: 3, required: false, choices: punishmentOptions },
        { name: 'duration', description: 'Mute duration (e.g. 10m, 1h, 1d).', type: 3, required: false }
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
      description: 'Configure bot settings and custom messages',
      defaultMemberPermissions: PermissionFlagsBits.Administrator,
      options: [
        { name: 'setting', description: 'What to configure', type: 3, required: true, choices: [{ name: 'Embeds', value: 'embeds' }, { name: 'NSFW Warning', value: 'nsfwwarning' }, { name: 'Word Warning', value: 'wordwarning' }] },
        { name: 'value', description: 'on/off or the new text', type: 3, required: true }
      ]
    },
    {
      name: 'antitermadmin',
      description: 'Add or remove users who can configure the bot',
      defaultMemberPermissions: PermissionFlagsBits.Administrator,
      options: [
        { name: 'action', description: 'Add, Remove, or List', type: 3, required: true, choices: [{ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }, { name: 'List', value: 'list' }] },
        { name: 'user', description: 'The user to add/remove', type: 6, required: false }
      ]
    }
  ];

  try { await client.application.commands.set(commands); } catch (e) { console.error(e); }
});

client.on('emojiCreate', async (emoji) => {
    await emoji.guild.emojis.fetch();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  if (interaction.isButton()) {
      if (interaction.customId === 'delete_msg') return interaction.message.delete().catch(()=>{});
      return;
  }

  if (!interaction.guild) {
      return interaction.reply({ content: 'This bot can only be used inside a server.', ephemeral: true });
  }

  const s = await getSettings(interaction.guild.id);

  if (!isAuthorized(interaction.member, s)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }

  if (interaction.commandName === 'antinsfwcontent') {
    const state = interaction.options.getString('state');
    const punish = interaction.options.getString('punishment');
    const dur = interaction.options.getString('duration');
    s.antiNsfw = (state === 'on');
    if (punish) s.nsfwPunish = punish;
    if (dur) s.nsfwDur = dur;
    await s.save();

    const title = `Filtering **NSFW Content** ${state === 'on' ? 'On' : 'Off'}`;
    return sendMessage(interaction, 'success', title, [
        `**Filtering:** \`${state}\``,
        `**Punishment:** \`${s.nsfwPunish}\`${s.nsfwPunish === 'mute' ? ` (\`${s.nsfwDur}\`)` : ''}`
    ], interaction.guild, client, s);
  }

  if (interaction.commandName === 'antinsfwmessages') {
    const state = interaction.options.getString('state');
    const sensInput = interaction.options.getString('sensitivity');
    const punish = interaction.options.getString('punishment');
    const dur = interaction.options.getString('duration');
    s.termMessages = (state === 'on');
    if (sensInput) s.sensitivity = parseFloat(sensInput);
    if (punish) s.msgPunish = punish;
    if (dur) s.msgDur = dur;
    await s.save();

    const title = `Filtering **Messages** ${state === 'on' ? 'On' : 'Off'}`;
    return sendMessage(interaction, 'success', title, [
        `**Filtering:** \`${state}\``,
        `**Sensitivity:** \`${s.sensitivity}\``,
        `**Punishment:** \`${s.msgPunish}\`${s.msgPunish === 'mute' ? ` (\`${s.msgDur}\`)` : ''}`
    ], interaction.guild, client, s);
  }

  if (interaction.commandName === 'antibypassfilter') {
    const action = interaction.options.getString('action');
    const word = interaction.options.getString('word')?.toLowerCase().trim();
    if (action === 'list') {
      if (s.words.length === 0) return sendMessage(interaction, 'warning', 'Empty', ['No custom words.'], interaction.guild, client, s);
      return sendMessage(interaction, 'info', 'Filtered Words', [`\`${s.words.join('`, `')}\``], interaction.guild, client, s);
    }
    if (!word) return sendMessage(interaction, 'error', 'Error', ['Provide a word.'], interaction.guild, client, s);
    if (action === 'add') {
      if (s.words.includes(word)) return sendMessage(interaction, 'error', 'Already Added', ['Word exists.'], interaction.guild, client, s);
      s.words.push(word);
      await s.save();
      return sendMessage(interaction, 'success', 'Word Added', [`Added \`${word}\`.`], interaction.guild, client, s);
    }
    if (action === 'remove') {
      const index = s.words.indexOf(word);
      if (index === -1) return sendMessage(interaction, 'error', 'Not Found', ['Word not found.'], interaction.guild, client, s);
      s.words.splice(index, 1);
      await s.save();
      return sendMessage(interaction, 'success', 'Word Removed', [`Removed \`${word}\`.`], interaction.guild, client, s);
    }
  }

  if (interaction.commandName === 'config') {
    const setting = interaction.options.getString('setting');
    const val = interaction.options.getString('value');

    if (setting === 'embeds') {
        if (val.toLowerCase() !== 'on' && val.toLowerCase() !== 'off') return sendMessage(interaction, 'error', 'Error', ['Value must be `on` or `off`.'], interaction.guild, client, s);
        s.useEmbeds = val.toLowerCase() === 'on';
    } else if (setting === 'nsfwwarning') {
        s.customMessages.nsfwWarning = val;
    } else if (setting === 'wordwarning') {
        s.customMessages.wordWarning = val;
    }
    await s.save();
    return sendMessage(interaction, 'success', 'Config Updated', [`Setting **${setting}** has been updated.`], interaction.guild, client, s);
  }

  if (interaction.commandName === 'antitermadmin') {
    const action = interaction.options.getString('action');
    const user = interaction.options.getUser('user');
    if (action === 'list') {
      if (s.allowedUsers.length === 0) return sendMessage(interaction, 'warning', 'Empty', ['No extra admins configured.'], interaction.guild, client, s);
      return sendMessage(interaction, 'info', 'Authorized Users', [`\`${s.allowedUsers.join('`, `')}\``], interaction.guild, client, s);
    }
    if (!user) return sendMessage(interaction, 'error', 'Error', ['You must mention a user.'], interaction.guild, client, s);
    if (action === 'add') {
      if (s.allowedUsers.includes(user.id)) return sendMessage(interaction, 'error', 'Already Added', ['User is already authorized.'], interaction.guild, client, s);
      s.allowedUsers.push(user.id);
      await s.save();
      return sendMessage(interaction, 'success', 'Admin Added', [`Added <@${user.id}> to authorized users.`], interaction.guild, client, s);
    }
    if (action === 'remove') {
      const index = s.allowedUsers.indexOf(user.id);
      if (index === -1) return sendMessage(interaction, 'error', 'Not Found', ['User is not in the list.'], interaction.guild, client, s);
      s.allowedUsers.splice(index, 1);
      await s.save();
      return sendMessage(interaction, 'success', 'Admin Removed', [`Removed <@${user.id}> from authorized users.`], interaction.guild, client, s);
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const s = await getSettings(message.guild.id);
  const lowerContent = message.content.toLowerCase();

  if (lowerContent.startsWith('$')) {
      if (!isAuthorized(message.member, s)) {
          const warning = await sendMessage(message, 'error', 'Access Denied', ['Only Administrators or authorized users can use this command.'], message.guild, client, s);
          setTimeout(() => warning.delete().catch(() => {}), 5000);
          return;
      }
      
      const args = message.content.slice(1).trim().split(/ +/);
      const cmd = args.shift().toLowerCase();

      if (cmd === 'help') {
        let currentPage = 1;
        const totalPages = 2;
        
        // Sending the Container Component
        const msg = await message.reply({ 
            components: [getHelpContainer(currentPage, client, message.guild, totalPages)],
            flags: MessageFlags.IsComponentsV2 
        });

        const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

        collector.on('collect', async i => {
            if (i.user.id !== message.author.id) return i.reply({ content: "You cannot use these buttons.", ephemeral: true });
            if (i.customId === 'delete_msg') {
                await msg.delete().catch(()=>{});
                collector.stop();
                return;
            }
            if (i.customId === 'prev_page' && currentPage > 1) currentPage--;
            if (i.customId === 'next_page' && currentPage < totalPages) currentPage++;

            await i.update({ 
                components: [getHelpContainer(currentPage, client, message.guild, totalPages)],
                flags: MessageFlags.IsComponentsV2
            });
        });

        collector.on('end', () => { msg.edit({ components: [] }).catch(()=>{}); });
        return;
      }

      if (cmd === 'config') {
        const setting = args[0]?.toLowerCase();
        const val = args.slice(1).join(' ');

        if (!setting || !val) return sendMessage(message, 'error', 'Error', ['Usage: `$config <embeds|nsfwwarning|wordwarning> <value>`'], message.guild, client, s);

        if (setting === 'embeds') {
            if (val.toLowerCase() !== 'on' && val.toLowerCase() !== 'off') return sendMessage(message, 'error', 'Error', ['Value must be `on` or `off`.'], message.guild, client, s);
            s.useEmbeds = val.toLowerCase() === 'on';
        } else if (setting === 'nsfwwarning') {
            s.customMessages.nsfwWarning = val;
        } else if (setting === 'wordwarning') {
            s.customMessages.wordWarning = val;
        } else {
            return sendMessage(message, 'error', 'Error', ['Invalid setting. Use `embeds`, `nsfwwarning`, or `wordwarning`.'], message.guild, client, s);
        }
        await s.save();
        return sendMessage(message, 'success', 'Config Updated', [`Setting **${setting}** has been updated.`], message.guild, client, s);
      }

      const nsfwAliases = ['antinsfwcontent', 'antinsfw', 'antinsfwbypass'];
      const textAliases = ['antinsfwmessages', 'nonsfwtext'];

      if (nsfwAliases.includes(cmd)) {
        const state = args[0]?.toLowerCase();
        if (state !== 'on' && state !== 'off') {
            const title = `Filtering **NSFW Content** ${s.antiNsfw ? 'On' : 'Off'}`;
            const fields = [
                `**Filtering:** \`${s.antiNsfw ? 'on' : 'off'}\``,
                `**Punishment:** \`${s.nsfwPunish}\`${s.nsfwPunish === 'mute' ? ` (\`${s.nsfwDur}\`)` : ''}`,
                `**Usage:** \`$AntiNsfw <on/off> [--punishment:delete/mute/kick/ban] [--duration:1h]\``
            ];
            return sendMessage(message, 'info', title, fields, message.guild, client, s);
        }
        s.antiNsfw = (state === 'on');
        const punishFlag = args.find(a => a.startsWith('--punishment'));
        if (punishFlag) s.nsfwPunish = punishFlag.split(':')[1]?.toLowerCase() || args[args.indexOf(punishFlag)+1]?.toLowerCase();
        const durFlag = args.find(a => a.startsWith('--duration'));
        if (durFlag) s.nsfwDur = durFlag.split(':')[1]?.toLowerCase() || args[args.indexOf(durFlag)+1]?.toLowerCase();
        await s.save();

        const title = `Filtering **NSFW Content** ${state === 'on' ? 'On' : 'Off'}`;
        const fields = [
            `**Filtering:** \`${state}\``,
            `**Punishment:** \`${s.nsfwPunish}\`${s.nsfwPunish === 'mute' ? ` (\`${s.nsfwDur}\`)` : ''}`
        ];
        return sendMessage(message, 'success', title, fields, message.guild, client, s);
      }

      if (textAliases.includes(cmd)) {
        const state = args[0]?.toLowerCase();
        if (state !== 'on' && state !== 'off') {
            const title = `Filtering **Messages** ${s.termMessages ? 'On' : 'Off'}`;
            const fields = [
                `**Filtering:** \`${s.termMessages ? 'on' : 'off'}\``,
                `**Sensitivity:** \`${s.sensitivity}\``,
                `**Punishment:** \`${s.msgPunish}\`${s.msgPunish === 'mute' ? ` (\`${s.msgDur}\`)` : ''}`,
                `**Usage:** \`$NoNsfwText <on/off> [0.1-0.9] [--punishment:delete/mute/kick/ban] [--duration:1h]\``
            ];
            return sendMessage(message, 'info', title, fields, message.guild, client, s);
        }
        s.termMessages = (state === 'on');
        const sens = parseFloat(args[1]);
        if (!isNaN(sens) && sens >= 0.1 && sens <= 0.9) s.sensitivity = sens;
        const punishFlag = args.find(a => a.startsWith('--punishment'));
        if (punishFlag) s.msgPunish = punishFlag.split(':')[1]?.toLowerCase() || args[args.indexOf(punishFlag)+1]?.toLowerCase();
        const durFlag = args.find(a => a.startsWith('--duration'));
        if (durFlag) s.msgDur = durFlag.split(':')[1]?.toLowerCase() || args[args.indexOf(durFlag)+1]?.toLowerCase();
        await s.save();

        const title = `Filtering **Messages** ${state === 'on' ? 'On' : 'Off'}`;
        const fields = [
            `**Filtering:** \`${state}\``,
            `**Sensitivity:** \`${s.sensitivity}\``,
            `**Punishment:** \`${s.msgPunish}\`${s.msgPunish === 'mute' ? ` (\`${s.msgDur}\`)` : ''}`
        ];
        return sendMessage(message, 'success', title, fields, message.guild, client, s);
      }
      
      return; 
  }

  if (s.termMessages) {
    let violation = false;
    if (s.words.some(w => checkViolation(message.content, w))) violation = true;
    else if (EXTREME_SLURS.some(w => checkViolation(message.content, w))) violation = true;
    else if (s.sensitivity >= 0.4 && MEDIUM_INSULTS.some(w => checkViolation(message.content, w))) violation = true;
    else if (s.sensitivity >= 0.7 && WEB_PROFANITY_LIST.some(w => checkViolation(message.content, w))) violation = true;

    if (violation) {
        await message.delete().catch(() => {});
        await applyPunishment(message.member, s.msgPunish, s.msgDur, 'Used a banned word.', message, client);
        
        const customWarning = s.customMessages.wordWarning.replace('{user}', `<@${message.author.id}>`);
        const warning = await sendMessage(message.channel, 'warning', 'Word Blocked', [
            customWarning,
            `**Action:** \`${s.msgPunish.toUpperCase()}\``
        ], message.guild, client, s);
        setTimeout(() => warning.delete().catch(() => {}), 5000);
        return; 
    }
  }

  if (s.antiNsfw) {
     let mediaUrl = null;
     if (message.attachments.size > 0) mediaUrl = message.attachments.first().url;
     else if (message.embeds.length > 0) {
       const embed = message.embeds[0];
       if (embed.video && embed.video.url) mediaUrl = embed.video.url;
       else if (embed.image && embed.image.url) mediaUrl = embed.image.url;
       else if (embed.thumbnail && embed.thumbnail.url) mediaUrl = embed.thumbnail.url;
     } else if (message.content.match(/https?:\/\/[^\s]+/)) mediaUrl = message.content.match(/https?:\/\/[^\s]+/)[0];

     if (mediaUrl) {
       try {
         let finalUrl = mediaUrl;
         if (!finalUrl.match(/\.(jpeg|jpg|png|gif|mp4|webm)/i) && !finalUrl.includes('cdn.discordapp.com')) {
             const webRes = await fetch(finalUrl); const html = await webRes.text();
             const mediaMatch = html.match(/(https:\/\/[^"']+\.(?:gif|mp4|webm))/i);
             if (mediaMatch) finalUrl = mediaMatch[0]; else return;
         }
         const isVideo = finalUrl.toLowerCase().includes('.mp4') || finalUrl.toLowerCase().includes('.webm');
         const isGif = finalUrl.toLowerCase().includes('.gif');
         const imageResponse = await fetch(finalUrl);
         const contentType = imageResponse.headers.get('content-type');
         const imageBuffer = await imageResponse.arrayBuffer();
         const buffer = Buffer.from(imageBuffer);

         let isUnsafe = false;

         if (isVideo) {
           const tempVideoPath = path.join(os.tmpdir(), `vid_${Date.now()}.mp4`);
           const framePrefix = `frame_${Date.now()}`;
           fs.writeFileSync(tempVideoPath, buffer);
           try {
             await new Promise((resolve, reject) => { ffmpeg(tempVideoPath).on('end', resolve).on('error', reject).screenshots({ count: 3, folder: os.tmpdir(), filename: `${framePrefix}_%i.jpg`, size: '640x?' }); });
             const files = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(framePrefix));
             for (const file of files) {
               const framePath = path.join(os.tmpdir(), file);
               const frameBuffer = fs.readFileSync(framePath);
               const formData = new FormData(); formData.append('image', new Blob([frameBuffer], { type: 'image/jpeg' }), 'frame.jpg');
               const apiRes = await fetch(process.env.NSFW_API_URL + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
               const data = JSON.parse(await apiRes.text()); fs.unlinkSync(framePath);
               if (data.safe === false || (data.scores && (data.scores.nsfw > 0.4 || data.scores.sexy > 0.4 || data.scores.hentai > 0.4 || data.scores.porn > 0.4))) { isUnsafe = true; break; }
             }
             fs.unlinkSync(tempVideoPath);
           } catch (err) { if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath); }
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
                     if (data.safe === false || (data.scores && (data.scores.nsfw > 0.4 || data.scores.sexy > 0.4))) { isUnsafe = true; break; }
                   }
               }
           } catch (e) {}
         } else {
           const blob = new Blob([imageBuffer], { type: contentType || 'image/jpeg' }); const formData = new FormData(); formData.append('image', blob, 'image.jpg');
           const response = await fetch(process.env.NSFW_API_URL + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
           const data = JSON.parse(await response.text());
           if (data.safe === false || (data.flags && data.flags.length > 0) || (data.scores && ((data.scores.nsfw > 0.4) || (data.scores.sexy > 0.4) || (data.scores.hentai > 0.4) || (data.scores.porn > 0.4)))) isUnsafe = true;
         }

         if (isUnsafe) {
           await message.delete().catch(() => {});
           await applyPunishment(message.member, s.nsfwPunish, s.nsfwDur, 'Posted NSFW media.', message, client);
           
           const customWarning = s.customMessages.nsfwWarning.replace('{user}', `<@${message.author.id}>`);
           const warningMsg = await sendMessage(message.channel, 'warning', 'NSFW Detected', [
               customWarning,
               `**Action:** \`${s.nsfwPunish.toUpperCase()}\``
           ], message.guild, client, s);
           setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
         }
       } catch (err) { console.error(err); }
    }
  }
});

// Connect to MongoDB, then log in
(async () => {
    const mongoUri = process.env.MONGO_URL;
    if (mongoUri) {
        try {
            await mongoose.connect(mongoUri);
            console.log(`[DEBUG] Connected to MongoDB successfully!`);
        } catch (err) {
            console.error(`[DEBUG] MongoDB connection error:`, err.message);
        }
    } else {
        console.log(`[DEBUG] No MONGO_URL found. Settings will not be saved permanently.`);
    }
    client.login(process.env.DISCORD_TOKEN);
})();
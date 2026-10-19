const { Client, GatewayIntentBits, PermissionFlagsBits, ComponentType } = require('discord.js');
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
const { sendMessage, isAuthorized, checkViolation, applyPunishment, EXTREME_SLURS, MEDIUM_INSULTS, SAFE_WORDS } = require('./utils.js');
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

client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  setActivity(client);
  await fetchWebProfanity();
  
  // Register Commands
  try { 
      await client.application.commands.set([
        {
          name: 'antinsfwcontent',
          description: 'Configure AI NSFW image/video scanner',
          defaultMemberPermissions: PermissionFlagsBits.Administrator,
          options: [
            { name: 'state', description: 'On or off', type: 3, required: true, choices: [{ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }] },
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

// --- INTERACTION HANDLER (Slash Commands) ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return interaction.reply({ content: 'Servers only.', ephemeral: true });

  const s = await getSettings(interaction.guild.id);
  if (!isAuthorized(interaction.member, s)) return interaction.reply({ content: 'No permission.', ephemeral: true });

  if (interaction.commandName === 'config') {
      const setting = interaction.options.getString('setting');
      const val = interaction.options.getString('value');
      await handleConfig(interaction, [setting, val], s, client); // Re-using prefix logic
  }
  
  if (interaction.commandName === 'antinsfwcontent') {
      // Logic for slash nsfw content
      s.antiNsfw = (interaction.options.getString('state') === 'on');
      if (interaction.options.getString('punishment')) s.nsfwPunish = interaction.options.getString('punishment');
      if (interaction.options.getString('duration')) s.nsfwDur = interaction.options.getString('duration');
      await s.save();
      return sendMessage(interaction, 'success', 'Updated', [`NSFW filtering is now \`${s.antiNsfw ? 'on' : 'off'}\``], interaction.guild, client, s);
  }
});

// --- MESSAGE HANDLER (Prefix Commands & Filtering) ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const s = await getSettings(message.guild.id);
  
  // TEXT FILTER
  if (s.termMessages && !message.content.startsWith('$')) {
    let violation = false;
    if (s.words.some(w => checkViolation(message.content, w))) violation = true;
    else if (EXTREME_SLURS.some(w => checkViolation(message.content, w))) violation = true;
    else if (s.sensitivity >= 0.4 && MEDIUM_INSULTS.some(w => checkViolation(message.content, w))) violation = true;
    else if (s.sensitivity >= 0.7 && WEB_PROFANITY_LIST.some(w => checkViolation(message.content, w))) violation = true;

    if (violation) {
        await message.delete().catch(() => {});
        await applyPunishment(message.member, s.msgPunish, s.msgDur, 'Used a banned word.', message, client);
        const customWarning = s.customMessages.wordWarning.replace('{user}', `<@${message.author.id}>`);
        const warning = await sendMessage(message.channel, 'warning', 'Word Blocked', [customWarning, `**Action:** \`${s.msgPunish.toUpperCase()}\``], message.guild, client, s);
        setTimeout(() => warning.delete().catch(() => {}), 5000);
        return; 
    }
  }

  // PREFIX COMMANDS
  if (message.content.startsWith('$')) {
      if (!isAuthorized(message.member, s)) return sendMessage(message, 'error', 'Access Denied', ['You cannot use this.'], message.guild, client, s);
      
      const args = message.content.slice(1).trim().split(/ +/);
      const cmd = args.shift().toLowerCase();

      if (cmd === 'help') {
        let currentPage = 1;
        const msg = await message.reply({ 
            components: [getHelpContainer(currentPage, client, message.guild, 2)],
            flags: require('discord.js').MessageFlags.IsComponentsV2 
        });
        const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
        collector.on('collect', async i => {
            if (i.user.id !== message.author.id) return i.reply({ content: "Not your menu.", ephemeral: true });
            if (i.customId === 'delete_msg') return msg.delete().catch(()=>{});
            if (i.customId === 'prev_page' && currentPage > 1) currentPage--;
            if (i.customId === 'next_page' && currentPage < 2) currentPage++;
            await i.update({ components: [getHelpContainer(currentPage, client, message.guild, 2)], flags: require('discord.js').MessageFlags.IsComponentsV2 });
        });
        return;
      }

      if (cmd === 'config') return handleConfig(message, args, s, client);
      
      // (Add antinsfwcontent and antinsfwmessages prefix logic here)
  }

  // AI SCANNER
  if (s.antiNsfw) {
      // (Insert the FFmpeg/NSFW checking logic here)
  }
});

// Start Bot
connectDB().then(() => {
    client.login(process.env.DISCORD_TOKEN);
});
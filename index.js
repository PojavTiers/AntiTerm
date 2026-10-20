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

client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  setActivity(client);
  
  const whitelist = await getWhitelist();
  const mainGuildId = '1500445119185293404';

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
            },
            {
              name: 'whitelistuser',
              description: 'Manage users allowed to configure the bot',
              options: [
                { name: 'action', description: 'Add, Remove, or List', type: 3, required: true, choices: [{ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }, { name: 'List', value: 'list' }] },
                { name: 'user', description: 'The user to manage', type: 6, required: false }
              ]
            }
          ]); 
      }
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
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return interaction.reply({ content: 'Servers only.', ephemeral: true });

  const s = await getSettings(interaction.guild.id);
  const arrow = await embeds.getEmoji(client, 'arrow_right2', '➜');

  // OWNER ONLY: Slash Command for User Whitelist
  if (interaction.commandName === 'whitelistuser') {
      if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: '❌ Only the bot owner can use this.', ephemeral: true });
      
      const action = interaction.options.getString('action');
      const user = interaction.options.getUser('user');

      if (action === 'list') {
          if (s.allowedUsers.length === 0) return sendMessage(interaction, 'warning', 'System Alert', ['No users are whitelisted.'], interaction.guild, client, s);
          const list = s.allowedUsers.map(id => `<@${id}>`).join(', ');
          return sendMessage(interaction, 'info', 'Whitelisted Users', [`${arrow} ${list}`], interaction.guild, client, s);
      }

      if (!user) return sendMessage(interaction, 'error', 'Invalid Input', ['You must mention a user.'], interaction.guild, client, s);

      if (action === 'add') {
          if (s.allowedUsers.includes(user.id)) return sendMessage(interaction, 'error', 'Already Added', ['That user is already whitelisted.'], interaction.guild, client, s);
          s.allowedUsers.push(user.id);
          await s.save();
          return sendMessage(interaction, 'success', 'User Added', [`Successfully whitelisted <@${user.id}>.`], interaction.guild, client, s);
      }

      if (action === 'remove') {
          const index = s.allowedUsers.indexOf(user.id);
          if (index === -1) return sendMessage(interaction, 'error', 'Not Found', ['That user is not whitelisted.'], interaction.guild, client, s);
          s.allowedUsers.splice(index, 1);
          await s.save();
          return sendMessage(interaction, 'success', 'User Removed', [`Successfully removed <@${user.id}> from the whitelist.`], interaction.guild, client, s);
      }
  }

  // REGULAR COMMANDS (Admin / Whitelisted Users)
  if (!isAuthorized(interaction.member, s)) return interaction.reply({ content: 'No permission.', ephemeral: true });

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

      const desc = `Successfully turned **AntiNSFWContent** ON\n\n${arrow} **Mode:** \`${s.nsfwMode.toUpperCase()}\`\n${arrow} **Punishment:** \`${s.nsfwPunish}\``;
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
  
  // OWNER ONLY: Prefix Command for User Whitelist
  if (message.author.id === OWNER_ID && lowerContent.startsWith('$whitelist_user')) {
      const args = message.content.slice(1).trim().split(/ +/);
      const cmd = args.shift().toLowerCase();
      const arrow = await embeds.getEmoji(client, 'arrow_right2', '➜');

      if (cmd === 'whitelist_user_add') {
          const userId = args[0]?.replace(/[<@!>]/g, '');
          if (!userId) return sendMessage(message, 'error', 'Invalid Input', ['Provide a User ID.'], message.guild, client, s);
          if (s.allowedUsers.includes(userId)) return sendMessage(message, 'error', 'Already Added', ['User is already whitelisted.'], message.guild, client, s);
          s.allowedUsers.push(userId);
          await s.save();
          return sendMessage(message, 'success', 'User Added', [`Successfully whitelisted <@${userId}>.`], message.guild, client, s);
      }

      if (cmd === 'whitelist_user_remove') {
          const userId = args[0]?.replace(/[<@!>]/g, '');
          if (!userId) return sendMessage(message, 'error', 'Invalid Input', ['Provide a User ID.'], message.guild, client, s);
          const index = s.allowedUsers.indexOf(userId);
          if (index === -1) return sendMessage(message, 'error', 'Not Found', ['User is not whitelisted.'], message.guild, client, s);
          s.allowedUsers.splice(index, 1);
          await s.save();
          return sendMessage(message, 'success', 'User Removed', [`Removed <@${userId}> from the whitelist.`], message.guild, client, s);
      }

      if (cmd === 'whitelist_user_list') {
          if (s.allowedUsers.length === 0) return sendMessage(message, 'warning', 'Empty', ['No users are whitelisted.'], message.guild, client, s);
          const list = s.allowedUsers.map(id => `<@${id}>`).join(', ');
          return sendMessage(message, 'info', 'Whitelisted Users', [`${arrow} ${list}`], message.guild, client, s);
      }
      return;
  }

  // ... (The rest of the message handling logic remains the same: help, antinsfw, filter, text filter, AI scanner)
  // (Copy the rest of the messageCreate logic from the previous index.js here)
});

// Start Bot
connectDB().then(() => {
    client.login(process.env.DISCORD_TOKEN);
});
const { Client, GatewayIntentBits, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const gifFrames = require('gif-frames');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const levenshtein = require('fast-levenshtein');
const fs = require('fs');
const path = require('path');
const os = require('os');

const embeds = require('./embeds.js');

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

const settings = new Map();

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
        console.log(`[DEBUG] Downloaded ${WEB_PROFANITY_LIST.length} bad words.`);
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
        if (message) message.channel.send({ embeds: [embeds.error('Punishment Failed', `Could not ${type} the user. Check my role position and permissions!`, client)] });
    }
}

// --- HELP MENU BUILDER ---
function getHelpMenu(page, client, totalPages) {
    const p1 = `
**Moderation Configuration**
These commands require Administrator permissions.

\`antinsfw on/off\` \`antinsfw punishment:\`
\`antinsfwmessages on/off\` \`antinsfwmessages sensitivity:\`
\`antitermadmin add/remove/list\`
    `;
    const p2 = `
**Custom Filtering**
Protect your server from specific words or bypasses.

\`antibypassfilter add <word>\`
\`antibypassfilter remove <word>\`
\`antibypassfilter list\`

**Example Usage:**
\`$antinsfwmessages on 0.8 --punishment:mute --duration:1h\`
\`$antinsfw on --punishment:ban\`
    `;

    const descriptions = [p1, p2];
    const titles = ['Moderation Commands (5)', 'Filter Commands (3)'];
    const categories = ['Moderation', 'Configuration'];
    
    return embeds.shield(titles[page-1], descriptions[page-1], client, categories[page-1], page, totalPages);
}

function getHelpButtons(page, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prev_page').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
        new ButtonBuilder().setCustomId('next_page').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages),
        new ButtonBuilder().setCustomId('delete_msg').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
    );
}

client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  await fetchWebProfanity();

  const punishmentOptions = [
      { name: 'Delete Only', value: 'delete' },
      { name: 'Mute', value: 'mute' },
      { name: 'Kick', value: 'kick' },
      { name: 'Ban', value: 'ban' }
  ];

  const commands = [
    {
      name: 'antinsfw',
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

// --- SLASH COMMANDS ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
  
  if (interaction.isButton()) {
      // Handle Help Menu Buttons
      if (interaction.customId === 'delete_msg') {
          return interaction.message.delete().catch(()=>{});
      }
      // (If you add more pages later, handle prev/next here. Currently 2 pages)
      return;
  }

  if (!settings.has(interaction.guild.id)) settings.set(interaction.guild.id, { antiNsfw: false, nsfwPunish: 'delete', nsfwDur: '1h', termMessages: false, sensitivity: 0.5, msgPunish: 'delete', msgDur: '1h', words: [], allowedUsers: [] });
  const s = settings.get(interaction.guild.id);

  if (!isAuthorized(interaction.member, s)) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }

  if (interaction.commandName === 'antinsfw') {
    const state = interaction.options.getString('state');
    const punish = interaction.options.getString('punishment');
    const dur = interaction.options.getString('duration');
    
    s.antiNsfw = (state === 'on');
    if (punish) s.nsfwPunish = punish;
    if (dur) s.nsfwDur = dur;

    const title = `Filtering **NSFW** ${state === 'on' ? 'On' : 'Off'}`;
    const desc = `- **Filtering:** \`${state}\`\n- **Punishment:** \`${s.nsfwPunish}\`${s.nsfwPunish === 'mute' ? ` (\`${s.nsfwDur}\`)` : ''}`;
    return interaction.reply({ embeds: [embeds.success(title, desc, client)] });
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

    const title = `Filtering **Messages** ${state === 'on' ? 'On' : 'Off'}`;
    const desc = `- **Filtering:** \`${state}\`\n- **Sensitivity:** \`${s.sensitivity}\`\n- **Punishment:** \`${s.msgPunish}\`${s.msgPunish === 'mute' ? ` (\`${s.msgDur}\`)` : ''}`;
    return interaction.reply({ embeds: [embeds.success(title, desc, client)] });
  }

  if (interaction.commandName === 'antibypassfilter') {
    const action = interaction.options.getString('action');
    const word = interaction.options.getString('word')?.toLowerCase().trim();

    if (action === 'list') {
      if (s.words.length === 0) return interaction.reply({ embeds: [embeds.warning('Empty', 'No custom words.', client)] });
      return interaction.reply({ embeds: [embeds.info('Filtered Words', `\`${s.words.join('`, `')}\``, client)] });
    }
    if (!word) return interaction.reply({ embeds: [embeds.error('Error', 'Provide a word.', client)] });

    if (action === 'add') {
      if (s.words.includes(word)) return interaction.reply({ embeds: [embeds.error('Already Added', 'Word exists.', client)] });
      s.words.push(word);
      return interaction.reply({ embeds: [embeds.success('Word Added', `Added \`${word}\`.`, client)] });
    }
    if (action === 'remove') {
      const index = s.words.indexOf(word);
      if (index === -1) return interaction.reply({ embeds: [embeds.error('Not Found', 'Word not found.', client)] });
      s.words.splice(index, 1);
      return interaction.reply({ embeds: [embeds.success('Word Removed', `Removed \`${word}\`.`, client)] });
    }
  }

  if (interaction.commandName === 'antitermadmin') {
    const action = interaction.options.getString('action');
    const user = interaction.options.getUser('user');

    if (action === 'list') {
      if (s.allowedUsers.length === 0) return interaction.reply({ embeds: [embeds.warning('Empty', 'No extra admins configured.', client)] });
      return interaction.reply({ embeds: [embeds.info('Authorized Users', `\`${s.allowedUsers.join('`, `')}\``, client)] });
    }
    if (!user) return interaction.reply({ embeds: [embeds.error('Error', 'You must mention a user.', client)] });

    if (action === 'add') {
      if (s.allowedUsers.includes(user.id)) return interaction.reply({ embeds: [embeds.error('Already Added', 'User is already authorized.', client)] });
      s.allowedUsers.push(user.id);
      return interaction.reply({ embeds: [embeds.success('Admin Added', `Added <@${user.id}> to authorized users.`, client)] });
    }
    if (action === 'remove') {
      const index = s.allowedUsers.indexOf(user.id);
      if (index === -1) return interaction.reply({ embeds: [embeds.error('Not Found', 'User is not in the list.', client)] });
      s.allowedUsers.splice(index, 1);
      return interaction.reply({ embeds: [embeds.success('Admin Removed', `Removed <@${user.id}> from authorized users.`, client)] });
    }
  }
});

// --- PREFIX COMMANDS & MESSAGE FILTER ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  if (!settings.has(message.guild.id)) settings.set(message.guild.id, { antiNsfw: false, nsfwPunish: 'delete', nsfwDur: '1h', termMessages: false, sensitivity: 0.5, msgPunish: 'delete', msgDur: '1h', words: [], allowedUsers: [] });
  const s = settings.get(message.guild.id);

  if (message.content.startsWith('$')) {
      if (!isAuthorized(message.member, s)) {
          const warning = await message.reply({ embeds: [embeds.error('Access Denied', 'Only Administrators or authorized users can use this command.', client)] });
          setTimeout(() => warning.delete().catch(() => {}), 5000);
          return;
      }
      
      // --- HELP MENU ---
      if (message.content === '$help') {
        let currentPage = 1;
        const totalPages = 2;
        
        const msg = await message.reply({ 
            embeds: [getHelpMenu(currentPage, client, totalPages)], 
            components: [getHelpButtons(currentPage, totalPages)] 
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
                embeds: [getHelpMenu(currentPage, client, totalPages)], 
                components: [getHelpButtons(currentPage, totalPages)] 
            });
        });

        collector.on('end', () => { msg.edit({ components: [] }).catch(()=>{}); });
        return;
      }

      if (message.content.startsWith('$antinsfwmessages')) {
        const match = message.content.match(/^\$antinsfwmessages\s+(on|off)(?:\s+(0\.[1-9]))?(?:\s+--punishment:?(\w+))?(?:\s+--duration:?(\w+))?/i);
        if (!match) return message.reply({ embeds: [embeds.error('Invalid Syntax', 'Usage: `$antinsfwmessages <on/off> [0.1-0.9] [--punishment:delete/mute/kick/ban] [--duration:1h]`', client)] });

        const state = match[1].toLowerCase();
        if (match[2]) s.sensitivity = parseFloat(match[2]);
        if (match[3]) s.msgPunish = match[3].toLowerCase();
        if (match[4]) s.msgDur = match[4].toLowerCase();
        s.termMessages = (state === 'on');

        const title = `Filtering **Messages** ${state === 'on' ? 'On' : 'Off'}`;
        const desc = `- **Filtering:** \`${state}\`\n- **Sensitivity:** \`${s.sensitivity}\`\n- **Punishment:** \`${s.msgPunish}\`${s.msgPunish === 'mute' ? ` (\`${s.msgDur}\`)` : ''}`;
        return message.reply({ embeds: [embeds.success(title, desc, client)] });
      }

      if (message.content.startsWith('$antinsfw')) {
        const match = message.content.match(/^\$antinsfw\s+(on|off)(?:\s+--punishment:?(\w+))?(?:\s+--duration:?(\w+))?/i);
        if (!match) return message.reply({ embeds: [embeds.error('Invalid Syntax', 'Usage: `$antinsfw <on/off> [--punishment:delete/mute/kick/ban] [--duration:1h]`', client)] });

        const state = match[1].toLowerCase();
        if (match[2]) s.nsfwPunish = match[2].toLowerCase();
        if (match[3]) s.nsfwDur = match[3].toLowerCase();
        s.antiNsfw = (state === 'on');

        const title = `Filtering **NSFW** ${state === 'on' ? 'On' : 'Off'}`;
        const desc = `- **Filtering:** \`${state}\`\n- **Punishment:** \`${s.nsfwPunish}\`${s.nsfwPunish === 'mute' ? ` (\`${s.nsfwDur}\`)` : ''}`;
        return message.reply({ embeds: [embeds.success(title, desc, client)] });
      }
      
      return; 
  }

  // --- TEXT FILTER EXECUTION ---
  if (s.termMessages) {
    let violation = false;
    if (s.words.some(w => checkViolation(message.content, w))) violation = true;
    else if (EXTREME_SLURS.some(w => checkViolation(message.content, w))) violation = true;
    else if (s.sensitivity >= 0.4 && MEDIUM_INSULTS.some(w => checkViolation(message.content, w))) violation = true;
    else if (s.sensitivity >= 0.7 && WEB_PROFANITY_LIST.some(w => checkViolation(message.content, w))) violation = true;

    if (violation) {
        await message.delete().catch(() => {});
        await applyPunishment(message.member, s.msgPunish, s.msgDur, 'Used a banned word.', message, client);
        const warning = await message.channel.send({ embeds: [embeds.warning('Word Blocked', `${message.author}, that word is not allowed.\nAction: **${s.msgPunish.toUpperCase()}**`, client)] });
        setTimeout(() => warning.delete().catch(() => {}), 5000);
        return; 
    }
  }

  // --- AI SCANNER EXECUTION ---
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
                     if (data.safe === false || (data.scores && (data.scores.nsfw > 0.4 || data.scores.sexy > 0.4 || data.scores.hentai > 0.4 || data.scores.porn > 0.4))) { isUnsafe = true; break; }
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
           const warningMsg = await message.channel.send({ embeds: [embeds.warning('NSFW Detected', `Image detected as **NSFW** and deleted the message.\nAction: **${s.nsfwPunish.toUpperCase()}**`, client)] });
           setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
         }
       } catch (err) { console.error(err); }
     }
  }
});

client.login(process.env.DISCORD_TOKEN);
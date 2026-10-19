const { Client, GatewayIntentBits } = require('discord.js');
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
// 🚨 WORD LISTS 🚨
// ==========================================
const EXTREME_SLURS = ['put_racial_slurs_here', 'put_extreme_slurs_here']; 
const MEDIUM_INSULTS = ['asshole', 'bastard', 'retard', 'whore', 'slut'];
let WEB_PROFANITY_LIST = [];

async function fetchWebProfanity() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en');
        const text = await response.text();
        WEB_PROFANITY_LIST = text.split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 2);
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
    return levenshtein.get(input, target) <= (target.length > 5 ? 2 : 1);
}

function checkViolation(messageContent, bannedWord) {
    const cleanBanned = normalise(bannedWord);
    if (!cleanBanned) return false;
    const rawWords = messageContent.split(/ +/);
    for (const rawWord of rawWords) {
        const cleanSingle = normalise(rawWord);
        if (cleanSingle.length >= 3 && isCloseEnough(cleanSingle, cleanBanned)) return true;
        if (cleanSingle === cleanBanned) return true;
    }
    if (cleanBanned.length > 3) {
        const fullClean = normalise(messageContent);
        if (fullClean.includes(cleanBanned)) return true;
        if (fullClean.replace(/(.)\1{2,}/g, '$1').includes(cleanBanned)) return true;
    }
    return false;
}

// Converts "1h", "10m", "1d" to milliseconds for Discord Timeout
function parseDuration(str) {
    if (!str) return 3600000; // Default 1 hour
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

// Executes the actual punishment
async function applyPunishment(member, type, durationStr, reason, message, client) {
    if (type === 'delete' || !type) return; // Delete only
    try {
        if (type === 'mute') {
            const ms = parseDuration(durationStr);
            await member.timeout(ms, reason);
        } else if (type === 'kick') {
            await member.kick(reason);
        } else if (type === 'ban') {
            await member.ban({ reason });
        }
    } catch (e) {
        console.error(`Failed to ${type} user:`, e);
        message.channel.send({ embeds: [embeds.error('Punishment Failed', `Could not ${type} the user. Check my role position and permissions!`, client)] });
    }
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
      options: [
        { name: 'state', description: 'On or off', type: 3, required: true, choices: [{ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }] },
        { name: 'punishment', description: 'What to do when NSFW is found', type: 3, required: false, choices: punishmentOptions },
        { name: 'duration', description: 'Mute duration (e.g. 10m, 1h, 1d). Ignored for kick/ban.', type: 3, required: false }
      ]
    },
    {
      name: 'antinsfwmessages',
      description: 'Configure text filter and sensitivity',
      options: [
        { name: 'state', description: 'On or off', type: 3, required: true, choices: [{ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }] },
        { name: 'sensitivity', description: '0.1 (Slurs only) to 0.9 (Everything)', type: 3, required: false },
        { name: 'punishment', description: 'What to do when bad words are found', type: 3, required: false, choices: punishmentOptions },
        { name: 'duration', description: 'Mute duration (e.g. 10m, 1h, 1d). Ignored for kick/ban.', type: 3, required: false }
      ]
    },
    {
      name: 'antibypassfilter',
      description: 'Manage custom server filter words',
      options: [
        { name: 'action', description: 'Add, Remove, or List', type: 3, required: true, choices: [{ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }, { name: 'List', value: 'list' }] },
        { name: 'word', description: 'The word', type: 3, required: false }
      ]
    }
  ];

  try { await client.application.commands.set(commands); } catch (e) { console.error(e); }
});

// --- SLASH COMMANDS ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!settings.has(interaction.guild.id)) settings.set(interaction.guild.id, { 
      antiNsfw: false, nsfwPunish: 'delete', nsfwDur: '1h',
      termMessages: false, sensitivity: 0.5, msgPunish: 'delete', msgDur: '1h', 
      words: [] 
  });
  const s = settings.get(interaction.guild.id);

  if (interaction.commandName === 'antinsfw') {
    const state = interaction.options.getString('state');
    const punish = interaction.options.getString('punishment');
    const dur = interaction.options.getString('duration');
    
    s.antiNsfw = (state === 'on');
    if (punish) s.nsfwPunish = punish;
    if (dur) s.nsfwDur = dur;

    return interaction.reply({ embeds: [embeds.success(`AntiNSFW ${state.toUpperCase()}`, `Scanning is **${state}**.\nPunishment: **${s.nsfwPunish}** (${s.nsfwDur} if mute)`, client)] });
  }

  if (interaction.commandName === 'antinsfwmessages') {
    const state = interaction.options.getString('state');
    const sensInput = interaction.options.getString('sensitivity');
    const punish = interaction.options.getString('punishment');
    const dur = interaction.options.getString('duration');
    
    s.termMessages = (state === 'on');

    if (sensInput) {
        const parsed = parseFloat(sensInput);
        if (parsed >= 0.1 && parsed <= 0.9) s.sensitivity = parsed;
        else return interaction.reply({ embeds: [embeds.error('Invalid Sensitivity', 'Must be between 0.1 and 0.9.', client)] });
    }
    if (punish) s.msgPunish = punish;
    if (dur) s.msgDur = dur;

    return interaction.reply({ embeds: [embeds.success(`Text Filter ${state.toUpperCase()}`, `Filter is **${state}**.\nSensitivity: **${s.sensitivity}**\nPunishment: **${s.msgPunish}** (${s.msgDur} if mute)`, client)] });
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
});

// --- PREFIX COMMANDS & MESSAGE FILTER ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  if (!settings.has(message.guild.id)) settings.set(message.guild.id, { 
      antiNsfw: false, nsfwPunish: 'delete', nsfwDur: '1h',
      termMessages: false, sensitivity: 0.5, msgPunish: 'delete', msgDur: '1h', 
      words: [] 
  });
  const s = settings.get(message.guild.id);

  // --- PREFIX: $antinsfwmessages ---
  if (message.content.startsWith('$antinsfwmessages')) {
    // Regex matches: on/off, optional sensitivity, optional punishment, optional duration
    const match = message.content.match(/^\$antinsfwmessages\s+(on|off)(?:\s+(0\.[1-9]))?(?:\s+--punishment:?(\w+))?(?:\s+--duration:?(\w+))?/i);
    if (!match) return message.reply({ embeds: [embeds.error('Invalid Syntax', 'Usage: `$antinsfwmessages <on/off> [0.1-0.9] [--punishment:delete/mute/kick/ban] [--duration:1h]`', client)] });

    const state = match[1].toLowerCase();
    if (match[2]) s.sensitivity = parseFloat(match[2]);
    if (match[3]) s.msgPunish = match[3].toLowerCase();
    if (match[4]) s.msgDur = match[4].toLowerCase();
    s.termMessages = (state === 'on');

    return message.reply({ embeds: [embeds.success(`Text Filter ${state.toUpperCase()}`, `Filter is **${state}**.\nSensitivity: **${s.sensitivity}**\nPunishment: **${s.msgPunish}** (${s.msgDur})`, client)] });
  }

  // --- PREFIX: $antinsfw ---
  if (message.content.startsWith('$antinsfw')) {
    const match = message.content.match(/^\$antinsfw\s+(on|off)(?:\s+--punishment:?(\w+))?(?:\s+--duration:?(\w+))?/i);
    if (!match) return message.reply({ embeds: [embeds.error('Invalid Syntax', 'Usage: `$antinsfw <on/off> [--punishment:delete/mute/kick/ban] [--duration:1h]`', client)] });

    const state = match[1].toLowerCase();
    if (match[2]) s.nsfwPunish = match[2].toLowerCase();
    if (match[3]) s.nsfwDur = match[3].toLowerCase();
    s.antiNsfw = (state === 'on');

    return message.reply({ embeds: [embeds.success(`AntiNSFW ${state.toUpperCase()}`, `Scanning is **${state}**.\nPunishment: **${s.nsfwPunish}** (${s.nsfwDur})`, client)] });
  }

  if (message.content === '$help') {
    const helpDesc = `
**🛡️ AntiTerm Security**
\`/antinsfw <on/off> [punishment]\`
\`/antinsfwmessages <on/off> [sensitivity] [punishment]\`
\`/antibypassfilter add/remove/list\`

**Prefix Examples**
\`$antinsfwmessages on 0.8 --punishment:mute --duration:1h\`
\`$antinsfw on --punishment:ban\`
    `;
    return message.reply({ embeds: [embeds.info('Help Menu', helpDesc, client)] });
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
        
        // Apply the configured punishment
        await applyPunishment(message.member, s.msgPunish, s.msgDur, 'Used a banned word.', message, client);

        // Notify the channel
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
           
           const warningMsg = await message.channel.send({ embeds: [embeds.warning('NSFW Media Blocked', `${message.author}, NSFW media is not allowed.\nAction: **${s.nsfwPunish.toUpperCase()}**`, client)] });
           setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
         }
       } catch (err) { console.error(err); }
     }
  }
});

client.login(process.env.DISCORD_TOKEN);
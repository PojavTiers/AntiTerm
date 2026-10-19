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
// 🚨 WORD LISTS & WEB FETCHING 🚨
// ==========================================
// YOU MUST FILL IN THE EXTREME SLURS HERE.
// (Websites mix normal swears with slurs, so we keep the absolute worst ones hardcoded to protect your server).
const EXTREME_SLURS = ['put_racial_slurs_here', 'put_extreme_slurs_here']; 
const MEDIUM_INSULTS = ['asshole', 'bastard', 'retard', 'whore', 'slut'];

let WEB_PROFANITY_LIST = []; // This will hold the downloaded words

async function fetchWebProfanity() {
    try {
        console.log('[DEBUG] Downloading bad words from GitHub...');
        // Fetching a massive list of 400+ bad words from the LDNOOBW GitHub repo
        const response = await fetch('https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en');
        const text = await response.text();
        
        // Split by new lines and clean up the words
        WEB_PROFANITY_LIST = text.split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 2);
        console.log(`[DEBUG] Successfully downloaded ${WEB_PROFANITY_LIST.length} bad words from the web!`);
    } catch (e) {
        console.error('[DEBUG] Failed to fetch web profanity list:', e);
    }
}

// Advanced Normalisation (strips invisible chars, fixes homoglyphs, leetspeak, etc.)
function normalise(text) {
  return text
    .toLowerCase()
    .normalize('NFKC') // Fixes weird foreign letters that look like English
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Removes invisible zero-width spaces
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
    .replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't')
    .replace(/@/g, 'a').replace(/\$/g, 's')
    .replace(/[^a-z]/g, ''); // Removes everything that isn't a letter
}

// Advanced Fuzzy Matching (Checks if a word is close to a banned word)
function isCloseEnough(input, target) {
    if (!input || !target) return false;
    const dist = levenshtein.get(input, target);
    const threshold = target.length > 5 ? 2 : 1;
    return dist <= threshold;
}

client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  
  // Download the web list on startup
  await fetchWebProfanity();

  const commands = [
    {
      name: 'antinsfw',
      description: 'Toggle the AI NSFW image/video scanner',
      options: [{ name: 'state', description: 'On or off', type: 3, required: true, choices: [{ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }] }]
    },
    {
      name: 'antinsfwmessages',
      description: 'Toggle text filter and set sensitivity',
      options: [
        { name: 'state', description: 'On or off', type: 3, required: true, choices: [{ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }] },
        { name: 'sensitivity', description: '0.1 (Slurs only) to 0.9 (Everything)', type: 3, required: false }
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
  if (!settings.has(interaction.guild.id)) settings.set(interaction.guild.id, { antiNsfw: false, termMessages: false, sensitivity: 0.5, words: [] });
  const serverSettings = settings.get(interaction.guild.id);

  if (interaction.commandName === 'antinsfw') {
    const state = interaction.options.getString('state');
    serverSettings.antiNsfw = (state === 'on');
    return interaction.reply({ embeds: [embeds.success(`AntiNSFW ${state.toUpperCase()}`, `AI Media scanning is now ${state}.`, client)] });
  }

  if (interaction.commandName === 'antinsfwmessages') {
    const state = interaction.options.getString('state');
    const sensInput = interaction.options.getString('sensitivity');
    serverSettings.termMessages = (state === 'on');

    let sensText = `Current sensitivity: **${serverSettings.sensitivity}**`;
    if (sensInput) {
        const parsed = parseFloat(sensInput);
        if (parsed >= 0.1 && parsed <= 0.9) { serverSettings.sensitivity = parsed; sensText = `Sensitivity set to: **${parsed}**`; }
        else return interaction.reply({ embeds: [embeds.error('Invalid Sensitivity', 'Must be between 0.1 and 0.9.', client)] });
    }
    return interaction.reply({ embeds: [embeds.success(`Term Filter ${state.toUpperCase()}`, `Filter is ${state}.\n${sensText}`, client)] });
  }

  if (interaction.commandName === 'antibypassfilter') {
    const action = interaction.options.getString('action');
    const word = interaction.options.getString('word')?.toLowerCase().trim();

    if (action === 'list') {
      if (serverSettings.words.length === 0) return interaction.reply({ embeds: [embeds.warning('Empty', 'No custom words.', client)] });
      return interaction.reply({ embeds: [embeds.info('Filtered Words', `\`${serverSettings.words.join('`, `')}\``, client)] });
    }
    if (!word) return interaction.reply({ embeds: [embeds.error('Error', 'Provide a word.', client)] });

    if (action === 'add') {
      if (serverSettings.words.includes(word)) return interaction.reply({ embeds: [embeds.error('Already Added', 'Word exists.', client)] });
      serverSettings.words.push(word);
      return interaction.reply({ embeds: [embeds.success('Word Added', `Added \`${word}\`.`, client)] });
    }
    if (action === 'remove') {
      const index = serverSettings.words.indexOf(word);
      if (index === -1) return interaction.reply({ embeds: [embeds.error('Not Found', 'Word not found.', client)] });
      serverSettings.words.splice(index, 1);
      return interaction.reply({ embeds: [embeds.success('Word Removed', `Removed \`${word}\`.`, client)] });
    }
  }
});

// --- PREFIX COMMANDS & MESSAGE FILTER ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  if (!settings.has(message.guild.id)) settings.set(message.guild.id, { antiNsfw: false, termMessages: false, sensitivity: 0.5, words: [] });
  const serverSettings = settings.get(message.guild.id);

  // --- PREFIX COMMANDS ---
  if (message.content.startsWith('$antinsfwmessages')) {
    const match = message.content.match(/^\$antinsfwmessages\s+(on|off)(?:\s+(?:--sensitivity|-s)\s+(0\.[1-9]))?/i);
    if (!match) return message.reply({ embeds: [embeds.error('Invalid Syntax', 'Usage: `$antinsfwmessages <on/off> [--sensitivity 0.1-0.9]`', client)] });

    const state = match[1].toLowerCase();
    const sens = match[2];
    serverSettings.termMessages = (state === 'on');
    
    let sensText = `Current sensitivity: **${serverSettings.sensitivity}**`;
    if (sens) { const parsed = parseFloat(sens); serverSettings.sensitivity = parsed; sensText = `Sensitivity set to: **${parsed}**`; }

    return message.reply({ embeds: [embeds.success(`Term Filter ${state.toUpperCase()}`, `Filter is ${state}.\n${sensText}`, client)] });
  }

  if (message.content === '$antinsfw on') {
    if (serverSettings.antiNsfw) return message.reply({ embeds: [embeds.error('Already Enabled', 'AntiNSFW is already on.', client)] });
    serverSettings.antiNsfw = true;
    return message.reply({ embeds: [embeds.success('AntiNSFW Enabled', 'Scanning media now.', client)] });
  }
  if (message.content === '$antinsfw off') {
    if (!serverSettings.antiNsfw) return message.reply({ embeds: [embeds.error('Already Disabled', 'AntiNSFW is already off.', client)] });
    serverSettings.antiNsfw = false;
    return message.reply({ embeds: [embeds.success('AntiNSFW Disabled', 'Scanning stopped.', client)] });
  }

  if (message.content === '$help') {
    const helpDesc = `
**🛡️ AntiTerm Security**
\`/antinsfw on/off\` - AI Media Scanner
\`/antinsfwmessages on/off [sensitivity]\` - Text Filter
\`/antibypassfilter add/remove/list\` - Custom Words

**Prefix Commands**
\`$antinsfw on/off\`
\`$antinsfwmessages on/off --sensitivity 0.1-0.9\`
\`$antibypassfilter add/remove/list <word>\`
    `;
    return message.reply({ embeds: [embeds.info('Help Menu', helpDesc, client)] });
  }

  // --- ADVANCED TEXT FILTER LOGIC ---
  if (serverSettings.termMessages) {
    const rawWords = message.content.split(/ +/);
    let violationType = null;

    for (const rawWord of rawWords) {
        const cleanWord = normalise(rawWord);
        if (cleanWord.length < 3) continue;

        // 1. Check Custom Filter
        if (!violationType && serverSettings.words.find(b => cleanWord.includes(normalise(b)) || isCloseEnough(cleanWord, normalise(b)))) {
            violationType = 'custom';
        }

        // 2. Check Severity Levels
        if (!violationType) {
            const sens = serverSettings.sensitivity;

            // Extreme (0.1+)
            if (EXTREME_SLURS.find(w => cleanWord.includes(normalise(w)) || isCloseEnough(cleanWord, normalise(w)))) {
                violationType = 'extreme';
            }
            // Medium Insults (0.4+)
            else if (sens >= 0.4 && MEDIUM_INSULTS.find(w => cleanWord.includes(normalise(w)) || isCloseEnough(cleanWord, normalise(w)))) {
                violationType = 'severe';
            }
            // Web Profanity (0.7+) - THIS USES THE LIST FETCHED FROM THE WEB
            else if (sens >= 0.7 && WEB_PROFANITY_LIST.find(w => cleanWord.includes(normalise(w)) || isCloseEnough(cleanWord, normalise(w)))) {
                violationType = 'profanity';
            }
        }
    }

    if (violationType) {
        await message.delete().catch(() => {});
        
        if (violationType === 'extreme') {
            try {
                await message.member.timeout(3600000, 'Used an extreme slur.'); // 1 Hour
                const warning = await message.channel.send({ embeds: [embeds.error('Severe Violation', `${message.author} has been muted for 1 hour.\nReason: Extreme Language.`, client)] });
                setTimeout(() => warning.delete().catch(() => {}), 10000);
            } catch (e) {
                const warning = await message.channel.send({ embeds: [embeds.error('Severe Violation', `${message.author}, that word is completely banned.`, client)] });
                setTimeout(() => warning.delete().catch(() => {}), 5000);
            }
        } else {
            const warning = await message.channel.send({ embeds: [embeds.warning('Word Blocked', `${message.author}, that word is not allowed.`, client)] });
            setTimeout(() => warning.delete().catch(() => {}), 5000);
        }
        return; 
    }
  }

  // --- AI IMAGE & VIDEO SCANNER ---
  if (serverSettings.antiNsfw) {
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
               if (data.safe === false || (data.scores && (data.scores.nsfw > 0.4 || data.scores.sexy > 0.4 || data.scores.hentai > 0.4 || data.scores.porn > 0.4))) {
                 fs.unlinkSync(tempVideoPath); await message.delete().catch(() => {});
                 const warningMsg = await message.channel.send({ embeds: [embeds.warning('NSFW Video Blocked', `${message.author}, NSFW videos are not allowed.`, client)] });
                 setTimeout(() => warningMsg.delete().catch(() => {}), 5000); return; 
               }
             }
             fs.unlinkSync(tempVideoPath); return;
           } catch (err) { if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath); return; }
         }
         if (isGif) { 
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
                     if (data.safe === false || (data.scores && (data.scores.nsfw > 0.4 || data.scores.sexy > 0.4 || data.scores.hentai > 0.4 || data.scores.porn > 0.4))) {
                       await message.delete().catch(() => {});
                       const warningMsg = await message.channel.send({ embeds: [embeds.warning('NSFW GIF Blocked', `${message.author}, NSFW GIFs are not allowed.`, client)] });
                       setTimeout(() => warningMsg.delete().catch(() => {}), 5000); return; 
                     }
                   }
                   return; 
               }
           } catch (e) {}
         }
         const blob = new Blob([imageBuffer], { type: contentType || 'image/jpeg' }); const formData = new FormData(); formData.append('image', blob, 'image.jpg');
         const response = await fetch(process.env.NSFW_API_URL + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
         const data = JSON.parse(await response.text());
         const isUnsafeScore = data.scores && ((data.scores.nsfw > 0.4) || (data.scores.sexy > 0.4) || (data.scores.hentai > 0.4) || (data.scores.porn > 0.4));
         if (data.safe === false || (data.flags && data.flags.length > 0) || isUnsafeScore) {
           await message.delete().catch(() => {});
           const warningMsg = await message.channel.send({ embeds: [embeds.warning('NSFW Media Blocked', `${message.author}, NSFW media is not allowed.`, client)] });
           setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
         }
       } catch (err) {}
     }
  }
});

client.login(process.env.DISCORD_TOKEN);
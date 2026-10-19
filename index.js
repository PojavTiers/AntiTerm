const { Client, GatewayIntentBits } = require('discord.js');
const gifFrames = require('gif-frames');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const settings = new Map();

function normalise(text) {
  return text.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's').replace(/[^a-z]/g, '');
}

client.once('clientReady', () => {
  console.log(`✅ ${client.user.tag} is online!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  if (!settings.has(message.guild.id)) {
    settings.set(message.guild.id, { antiNsfw: false, words: [] });
  }
  const serverSettings = settings.get(message.guild.id);

  // --- COMMANDS ---
  if (message.content === '$antinsfw on') {
    serverSettings.antiNsfw = true;
    return message.reply('✅ AntiNSFW is now **ON**. I will scan images, GIF frames, and links.');
  }
  if (message.content === '$antinsfw off') {
    serverSettings.antiNsfw = false;
    return message.reply('❌ AntiNSFW is now **OFF**.');
  }
  if (message.content.startsWith('$antibypassfilter add ')) {
    const word = message.content.slice('$antibypassfilter add '.length).toLowerCase().trim();
    if (!word) return message.reply('Usage: `$antibypassfilter add <word>`');
    if (serverSettings.words.includes(word)) return message.reply('Already in the list.');
    serverSettings.words.push(word);
    return message.reply(`✅ Added \`${word}\` to filter.`);
  }
  if (message.content === '$antibypassfilter list') {
    if (serverSettings.words.length === 0) return message.reply('No words in filter.');
    return message.reply('**Filtered words:** ' + serverSettings.words.join(', '));
  }
  if (message.content.startsWith('$antibypassfilter remove ')) {
    const word = message.content.slice('$antibypassfilter remove '.length).toLowerCase().trim();
    const index = serverSettings.words.indexOf(word);
    if (index === -1) return message.reply('That word is not in the list.');
    serverSettings.words.splice(index, 1);
    return message.reply(`✅ Removed \`${word}\``);
  }

  // --- TEXT FILTER ---
  if (serverSettings.words.length > 0) {
    const cleanedMessage = normalise(message.content);
    if (cleanedMessage.length >= 3) {
      const found = serverSettings.words.find((word) => {
        const cleanedWord = normalise(word);
        return cleanedWord && cleanedMessage.includes(cleanedWord);
      });
      if (found) {
        await message.delete().catch(() => {});
        const warning = await message.channel.send(`⚠️ ${message.author}, that word is not allowed.`);
        setTimeout(() => warning.delete().catch(() => {}), 5000);
        return;
      }
    }
  }

  // --- IMAGE & LINK NSFW FILTER (WITH GIF FRAME EXTRACTION) ---
  if (serverSettings.antiNsfw) {
    let mediaUrl = null;
    let isGif = false;

    // 1. Check attachments
    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      if (!attachment.contentType || attachment.contentType.startsWith('image/') || attachment.contentType.includes('gif') || attachment.contentType.includes('video/')) {
        mediaUrl = attachment.url;
        if (attachment.contentType && attachment.contentType.includes('gif')) isGif = true;
      }
    } 
    // 2. Check text links
    else if (message.content.match(/https?:\/\/[^\s]+/)) {
      const linkMatch = message.content.match(/https?:\/\/[^\s]+/)[0];
      if (linkMatch.includes('cdn.discordapp.com') || linkMatch.match(/\.(jpeg|jpg|gif|png|webp)/i)) {
        mediaUrl = linkMatch;
        if (linkMatch.toLowerCase().includes('.gif')) isGif = true;
      }
    }

    if (mediaUrl) {
      console.log(`[TEST] Scanning media: ${mediaUrl} | GIF: ${isGif}`);
      
      try {
        if (isGif) {
          // --- GIF FRAME EXTRACTION LOGIC ---
          const response = await fetch(mediaUrl);
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Extract frames from the buffer
          const frameData = await gifFrames({ url: buffer, frames: 'all', outputType: 'jpeg', cumulative: true });
          
          if (!frameData || frameData.length === 0) {
            console.log('[TEST] No frames could be extracted from this GIF.');
            return;
          }

          // Sample up to 5 frames evenly across the GIF
          const totalFrames = frameData.length;
          const framesToCheck = Math.min(5, totalFrames);
          const step = Math.floor(totalFrames / framesToCheck) || 1;
          
          console.log(`[TEST] GIF has ${totalFrames} frames. Scanning ${framesToCheck} sampled frames...`);

          for (let i = 0; i < framesToCheck; i++) {
            const frameIndex = i * step;
            if (frameIndex >= totalFrames) break;

            const frame = frameData[frameIndex];
            
            // Convert the frame stream into a Buffer
            const frameBuffer = await new Promise((resolve, reject) => {
              const chunks = [];
              const stream = frame.getImage();
              stream.on('data', (chunk) => chunks.push(chunk));
              stream.on('end', () => resolve(Buffer.concat(chunks)));
              stream.on('error', reject);
            });

            const formData = new FormData();
            const blob = new Blob([frameBuffer], { type: 'image/jpeg' });
            formData.append('image', blob, `frame_${i}.jpg`);

            const apiRes = await fetch(process.env.NSFW_API_URL + '/classify', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${process.env.API_KEY}` },
              body: formData
            });

            const rawText = await apiRes.text();
            const data = JSON.parse(rawText);
            console.log(`[TEST] Frame ${i} result:`, data.flags);

            // If ANY frame is unsafe, delete the original message and stop scanning
            if (data.safe === false || (data.flags && data.flags.length > 0)) {
              console.log(`[TEST] Unsafe content found in GIF frame ${i}. Deleting.`);
              await message.delete().catch(() => {});
              const warning = await message.channel.send(`⚠️ ${message.author}, NSFW GIFs are not allowed here.`);
              setTimeout(() => warning.delete().catch(() => {}), 5000);
              return; // Exit early
            }
          }
          console.log('[TEST] All scanned GIF frames are safe.');
        } else {
          // --- NORMAL IMAGE/VIDEO LOGIC ---
          const imageResponse = await fetch(mediaUrl);
          const contentType = imageResponse.headers.get('content-type');
          const imageBuffer = await imageResponse.arrayBuffer();
          const blob = new Blob([imageBuffer], { type: contentType || 'image/jpeg' });

          const formData = new FormData();
          formData.append('image', blob, 'image.jpg');

          const response = await fetch(process.env.NSFW_API_URL + '/classify', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.API_KEY}` },
            body: formData
          });

          const rawText = await response.text();
          const data = JSON.parse(rawText);
          
          if (data.safe === false || (data.flags && data.flags.length > 0)) {
            await message.delete().catch(() => {});
            const warning = await message.channel.send(`⚠️ ${message.author}, NSFW links/media are not allowed here.`);
            setTimeout(() => warning.delete().catch(() => {}), 5000);
          }
        }
      } catch (err) {
        console.error('[TEST] Failed to scan media:', err);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
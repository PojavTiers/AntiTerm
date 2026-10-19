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
    console.log(`[DEBUG] AntiNSFW turned ON for guild ${message.guild.id}`);
    return message.reply('✅ AntiNSFW is now **ON**.');
  }
  if (message.content === '$antinsfw off') {
    serverSettings.antiNsfw = false;
    console.log(`[DEBUG] AntiNSFW turned OFF for guild ${message.guild.id}`);
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

  // --- IMAGE & LINK NSFW FILTER ---
  if (serverSettings.antiNsfw) {
    let mediaUrl = null;

    if (message.attachments.size > 0) {
      mediaUrl = message.attachments.first().url;
    } else if (message.content.match(/https?:\/\/[^\s]+/)) {
      mediaUrl = message.content.match(/https?:\/\/[^\s]+/)[0];
    }

    if (mediaUrl) {
      console.log(`[DEBUG] Original link found: ${mediaUrl}`);
      
      try {
        let finalUrl = mediaUrl;
        let isGif = finalUrl.toLowerCase().includes('.gif') || finalUrl.includes('tenor.com') || finalUrl.includes('giphy.com');

        // --- SCRAPER LOGIC: If it's a website (like klipy.com), find the hidden .gif or .mp4 inside ---
        if (!finalUrl.match(/\.(jpeg|jpg|png|gif|mp4|webp)/i) && !finalUrl.includes('cdn.discordapp.com')) {
            console.log(`[DEBUG] Link is a website. Scraping for direct media...`);
            const webRes = await fetch(finalUrl);
            const html = await webRes.text();
            
            // Look for a GIF or MP4 link inside the HTML
            const gifMatch = html.match(/(https:\/\/[^"']+\.gif)/i);
            const mp4Match = html.match(/(https:\/\/[^"']+\.mp4)/i);
            
            if (gifMatch) {
                finalUrl = gifMatch[0];
                isGif = true;
            } else if (mp4Match) {
                finalUrl = mp4Match[0];
                isGif = false; // Treat as video
            } else {
                // Try looking for og:image meta tag (common for klipy/tenor)
                const ogMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
                if (ogMatch) finalUrl = ogMatch[1];
            }
            console.log(`[DEBUG] Scraped URL: ${finalUrl} | isGif: ${isGif}`);
        }

        // --- SCAN LOGIC ---
        const imageResponse = await fetch(finalUrl);
        const contentType = imageResponse.headers.get('content-type');
        const imageBuffer = await imageResponse.arrayBuffer();
        
        if (isGif && imageBuffer.byteLength < 5000000) { // Only try to extract frames if GIF is under 5MB
          console.log(`[DEBUG] Extracting GIF frames...`);
          const buffer = Buffer.from(imageBuffer);
          try {
              const frameData = await gifFrames({ url: buffer, frames: 'all', outputType: 'jpeg', cumulative: true });
              if (frameData && frameData.length > 0) {
                  const totalFrames = frameData.length;
                  const framesToCheck = Math.min(5, totalFrames);
                  const step = Math.floor(totalFrames / framesToCheck) || 1;
                  
                  for (let i = 0; i < framesToCheck; i++) {
                    const frame = frameData[i * step];
                    const frameBuffer = await new Promise((resolve, reject) => {
                      const chunks = [];
                      const stream = frame.getImage();
                      stream.on('data', (chunk) => chunks.push(chunk));
                      stream.on('end', () => resolve(Buffer.concat(chunks)));
                      stream.on('error', reject);
                    });
                    const formData = new FormData();
                    formData.append('image', new Blob([frameBuffer], { type: 'image/jpeg' }), `frame_${i}.jpg`);
                    
                    const apiRes = await fetch(process.env.NSFW_API_URL + '/classify', {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${process.env.API_KEY}` },
                      body: formData
                    });
                    const rawText = await apiRes.text();
                    console.log(`[DEBUG] Frame ${i} RESPONSE:`, rawText);
                    const data = JSON.parse(rawText);
                    
                    if (data.safe === false || (data.scores && (data.scores.nsfw > 0.4 || data.scores.sexy > 0.4 || data.scores.hentai > 0.4))) {
                      await message.delete().catch(() => {});
                      const warning = await message.channel.send(`⚠️ ${message.author}, NSFW GIFs are not allowed here.`);
                      setTimeout(() => warning.delete().catch(() => {}), 5000);
                      return; 
                    }
                  }
                  console.log('[DEBUG] All GIF frames safe.');
                  return; // Done scanning
              }
          } catch (e) {
              console.log('[DEBUG] GIF frame extraction failed, scanning as static image.');
          }
        }
        
        // --- FALLBACK: Scan as static image (or MP4 first frame) ---
        const blob = new Blob([imageBuffer], { type: contentType || 'image/jpeg' });
        const formData = new FormData();
        formData.append('image', blob, 'image.jpg');

        const response = await fetch(process.env.NSFW_API_URL + '/classify', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.API_KEY}` },
          body: formData
        });

        const rawText = await response.text();
        console.log(`[DEBUG] FULL RESPONSE:`, rawText);
        const data = JSON.parse(rawText);
        
        const isUnsafeScore = data.scores && (
            (data.scores.nsfw && data.scores.nsfw > 0.4) || 
            (data.scores.sexy && data.scores.sexy > 0.4) || 
            (data.scores.hentai && data.scores.hentai > 0.4) ||
            (data.scores.porn && data.scores.porn > 0.4)
        );

        if (data.safe === false || (data.flags && data.flags.length > 0) || isUnsafeScore) {
          console.log(`[DEBUG] Deleting image. Scores:`, data.scores);
          await message.delete().catch(() => {});
          const warning = await message.channel.send(`⚠️ ${message.author}, NSFW media is not allowed here.`);
          setTimeout(() => warning.delete().catch(() => {}), 5000);
        }

      } catch (err) {
        console.error('[DEBUG] Failed to scan media:', err);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
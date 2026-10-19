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

    // 1. Check for direct attachments
    if (message.attachments.size > 0) {
      mediaUrl = message.attachments.first().url;
    } 
    // 2. Check if Discord made an Embed (Tenor, Giphy, Klipy links usually make embeds)
    else if (message.embeds.length > 0) {
      const embed = message.embeds[0];
      // Try to grab the video or image from the embed
      if (embed.video && embed.video.url) mediaUrl = embed.video.url;
      else if (embed.image && embed.image.url) mediaUrl = embed.image.url;
      else if (embed.thumbnail && embed.thumbnail.url) mediaUrl = embed.thumbnail.url;
    }
    // 3. Check raw text links
    else if (message.content.match(/https?:\/\/[^\s]+/)) {
      mediaUrl = message.content.match(/https?:\/\/[^\s]+/)[0];
    }

    if (mediaUrl) {
      console.log(`[DEBUG] Found media URL to scan: ${mediaUrl}`);
      
      try {
        let finalUrl = mediaUrl;
        
        // If the URL is still a webpage (not an image), try one last-ditch scrape
        if (!finalUrl.match(/\.(jpeg|jpg|png|gif|mp4|webp)/i) && !finalUrl.includes('cdn.discordapp.com')) {
            console.log(`[DEBUG] URL is a webpage. Trying to extract media...`);
            const webRes = await fetch(finalUrl);
            const html = await webRes.text();
            
            // Look for .mp4 or .gif links in the HTML
            const mediaMatch = html.match(/(https:\/\/[^"']+\.(?:gif|mp4))/i);
            if (mediaMatch) {
                finalUrl = mediaMatch[0];
                console.log(`[DEBUG] Found hidden media link: ${finalUrl}`);
            } else {
                console.log(`[DEBUG] Could not find any media in the webpage. Skipping scan.`);
                return;
            }
        }

        const isGif = finalUrl.toLowerCase().includes('.gif');
        const isVideo = finalUrl.toLowerCase().includes('.mp4') || finalUrl.toLowerCase().includes('.webm');

        // --- DOWNLOAD MEDIA ---
        const imageResponse = await fetch(finalUrl);
        const contentType = imageResponse.headers.get('content-type');
        const imageBuffer = await imageResponse.arrayBuffer();
        
        // --- IF IT'S A GIF, EXTRACT FRAMES ---
        if (isGif && !isVideo && imageBuffer.byteLength < 5000000) { 
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
                    const data = JSON.parse(rawText);
                    console.log(`[DEBUG] Frame ${i} Scores:`, data.scores);
                    
                    if (data.safe === false || (data.scores && (data.scores.nsfw > 0.4 || data.scores.sexy > 0.4 || data.scores.hentai > 0.4 || data.scores.porn > 0.4))) {
                      await message.delete().catch(() => {});
                      const warning = await message.channel.send(`⚠️ ${message.author}, NSFW GIFs are not allowed here.`);
                      setTimeout(() => warning.delete().catch(() => {}), 5000);
                      return; 
                    }
                  }
                  console.log('[DEBUG] All GIF frames safe.');
                  return; 
              }
          } catch (e) {
              console.log('[DEBUG] GIF extraction failed, scanning as static image.');
          }
        }
        
        // --- STATIC IMAGE / VIDEO FALLBACK ---
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
          console.log(`[DEBUG] Deleting media. Scores:`, data.scores);
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
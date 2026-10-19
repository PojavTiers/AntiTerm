const { Client, GatewayIntentBits } = require('discord.js');
const gifFrames = require('gif-frames');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const fs = require('fs');
const path = require('path');
const os = require('os');

// Import our new embeds
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

  // --- HELP MENU ---
  if (message.content === '$help') {
    const helpDesc = `
**🛡️ AntiTerm Commands**
*Protecting your server from terming.*

**🖼️ NSFW Protection**
\`$antinsfw on/off\` - Toggles the image/video scanner.

**🔤 Bypass Filter**
\`$antibypassfilter add <word>\` - Add a word to the strict filter.
\`$antibypassfilter remove <word>\` - Remove a word from the filter.
\`$antibypassfilter list\` - View all filtered words.

**ℹ️ Info**
\`$help\` - Shows this menu.
    `;
    return message.reply({ embeds: [embeds.info('Help Menu', helpDesc, client)] });
  }

  // --- ANTINSFW COMMAND ---
  if (message.content === '$antinsfw on') {
    if (serverSettings.antiNsfw) {
      return message.reply({ embeds: [embeds.error('Already Enabled', 'AntiNSFW is already **ON** for this server.', client)] });
    }
    serverSettings.antiNsfw = true;
    console.log(`[DEBUG] AntiNSFW turned ON for guild ${message.guild.id}`);
    return message.reply({ embeds: [embeds.success('AntiNSFW Enabled', 'I will now scan images, GIFs, and videos for NSFW content.', client)] });
  }
  
  if (message.content === '$antinsfw off') {
    if (!serverSettings.antiNsfw) {
      return message.reply({ embeds: [embeds.error('Already Disabled', 'AntiNSFW is already **OFF** for this server.', client)] });
    }
    serverSettings.antiNsfw = false;
    console.log(`[DEBUG] AntiNSFW turned OFF for guild ${message.guild.id}`);
    return message.reply({ embeds: [embeds.success('AntiNSFW Disabled', 'I have stopped scanning media.', client)] });
  }

  // --- BYPASS FILTER COMMANDS ---
  if (message.content.startsWith('$antibypassfilter add ')) {
    const word = message.content.slice('$antibypassfilter add '.length).toLowerCase().trim();
    if (!word) return message.reply({ embeds: [embeds.error('Invalid Usage', 'Usage: `$antibypassfilter add <word>`', client)] });
    
    if (serverSettings.words.includes(word)) {
      return message.reply({ embeds: [embeds.error('Already Filtered', `The word \`${word}\` is already in the filter.`, client)] });
    }
    
    serverSettings.words.push(word);
    return message.reply({ embeds: [embeds.success('Word Added', `Successfully added \`${word}\` to the bypass filter.`, client)] });
  }

  if (message.content === '$antibypassfilter list') {
    if (serverSettings.words.length === 0) {
      return message.reply({ embeds: [embeds.warning('Empty Filter', 'There are no words in the bypass filter.', client)] });
    }
    return message.reply({ embeds: [embeds.info('Filtered Words', `**Current filtered words:**\n\`${serverSettings.words.join('`, `')}\``, client)] });
  }

  if (message.content.startsWith('$antibypassfilter remove ')) {
    const word = message.content.slice('$antibypassfilter remove '.length).toLowerCase().trim();
    const index = serverSettings.words.indexOf(word);
    
    if (index === -1) {
      return message.reply({ embeds: [embeds.error('Not Found', `The word \`${word}\` is not in the filter.`, client)] });
    }
    
    serverSettings.words.splice(index, 1);
    return message.reply({ embeds: [embeds.success('Word Removed', `Successfully removed \`${word}\` from the filter.`, client)] });
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
        const warningMsg = await message.channel.send({ embeds: [embeds.warning('Word Blocked', `${message.author}, that word is not allowed here.`, client)] });
        setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
        return;
      }
    }
  }

  // --- IMAGE & LINK NSFW FILTER ---
  if (serverSettings.antiNsfw) {
    let mediaUrl = null;

    if (message.attachments.size > 0) {
      mediaUrl = message.attachments.first().url;
    } else if (message.embeds.length > 0) {
      const embed = message.embeds[0];
      if (embed.video && embed.video.url) mediaUrl = embed.video.url;
      else if (embed.image && embed.image.url) mediaUrl = embed.image.url;
      else if (embed.thumbnail && embed.thumbnail.url) mediaUrl = embed.thumbnail.url;
    } else if (message.content.match(/https?:\/\/[^\s]+/)) {
      mediaUrl = message.content.match(/https?:\/\/[^\s]+/)[0];
    }

    if (mediaUrl) {
      console.log(`[DEBUG] Found media URL: ${mediaUrl}`);
      
      try {
        let finalUrl = mediaUrl;
        
        if (!finalUrl.match(/\.(jpeg|jpg|png|gif|mp4|webm)/i) && !finalUrl.includes('cdn.discordapp.com')) {
            const webRes = await fetch(finalUrl);
            const html = await webRes.text();
            const mediaMatch = html.match(/(https:\/\/[^"']+\.(?:gif|mp4|webm))/i);
            if (mediaMatch) {
                finalUrl = mediaMatch[0];
            } else {
                return;
            }
        }

        const isVideo = finalUrl.toLowerCase().includes('.mp4') || finalUrl.toLowerCase().includes('.webm');
        const isGif = finalUrl.toLowerCase().includes('.gif');
        
        const imageResponse = await fetch(finalUrl);
        const contentType = imageResponse.headers.get('content-type');
        const imageBuffer = await imageResponse.arrayBuffer();
        const buffer = Buffer.from(imageBuffer);

        // --- VIDEO LOGIC ---
        if (isVideo) {
          console.log(`[DEBUG] Extracting frames from VIDEO using FFmpeg...`);
          
          const tempVideoPath = path.join(os.tmpdir(), `vid_${Date.now()}.mp4`);
          const framePrefix = `frame_${Date.now()}`;
          
          fs.writeFileSync(tempVideoPath, buffer);

          try {
            await new Promise((resolve, reject) => {
              ffmpeg(tempVideoPath)
                .on('end', resolve)
                .on('error', reject)
                .screenshots({
                  count: 3,
                  folder: os.tmpdir(),
                  filename: `${framePrefix}_%i.jpg`,
                  size: '640x?' 
                });
            });

            const files = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(framePrefix));
            
            for (const file of files) {
              const framePath = path.join(os.tmpdir(), file);
              const frameBuffer = fs.readFileSync(framePath);
              
              const formData = new FormData();
              formData.append('image', new Blob([frameBuffer], { type: 'image/jpeg' }), 'frame.jpg');
              
              const apiRes = await fetch(process.env.NSFW_API_URL + '/classify', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${process.env.API_KEY}` },
                body: formData
              });
              const rawText = await apiRes.text();
              console.log(`[DEBUG] Video Frame RESPONSE:`, rawText);
              const data = JSON.parse(rawText);
              
              fs.unlinkSync(framePath);

              if (data.safe === false || (data.scores && (data.scores.nsfw > 0.4 || data.scores.sexy > 0.4 || data.scores.hentai > 0.4 || data.scores.porn > 0.4))) {
                fs.unlinkSync(tempVideoPath);
                await message.delete().catch(() => {});
                const warningMsg = await message.channel.send({ embeds: [embeds.warning('NSFW Video Blocked', `${message.author}, NSFW videos are not allowed here.`, client)] });
                setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
                return; 
              }
            }
            fs.unlinkSync(tempVideoPath);
            console.log('[DEBUG] All video frames safe.');
            return;
          } catch (err) {
            console.log("[DEBUG] FFmpeg failed to process this video format.");
            if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
            return;
          }
        }

        // --- GIF LOGIC ---
        if (isGif) { 
          console.log(`[DEBUG] Extracting GIF frames...`);
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
                    
                    if (data.safe === false || (data.scores && (data.scores.nsfw > 0.4 || data.scores.sexy > 0.4 || data.scores.hentai > 0.4 || data.scores.porn > 0.4))) {
                      await message.delete().catch(() => {});
                      const warningMsg = await message.channel.send({ embeds: [embeds.warning('NSFW GIF Blocked', `${message.author}, NSFW GIFs are not allowed here.`, client)] });
                      setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
                      return; 
                    }
                  }
                  return; 
              }
          } catch (e) {
              console.log('[DEBUG] GIF extraction failed, trying static fallback.');
          }
        }
        
        // --- STATIC IMAGE FALLBACK ---
        console.log(`[DEBUG] Scanning as static image...`);
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
        
        const isUnsafeScore = data.scores && (
            (data.scores.nsfw && data.scores.nsfw > 0.4) || 
            (data.scores.sexy && data.scores.sexy > 0.4) || 
            (data.scores.hentai && data.scores.hentai > 0.4) ||
            (data.scores.porn && data.scores.porn > 0.4)
        );

        if (data.safe === false || (data.flags && data.flags.length > 0) || isUnsafeScore) {
          await message.delete().catch(() => {});
          const warningMsg = await message.channel.send({ embeds: [embeds.warning('NSFW Media Blocked', `${message.author}, NSFW media is not allowed here.`, client)] });
          setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
        }

      } catch (err) {
        console.error('[DEBUG] Failed to scan media:', err);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
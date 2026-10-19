const { Client, GatewayIntentBits } = require('discord.js');

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
    return message.reply('✅ AntiNSFW is now **ON**. I will scan images, files, and links.');
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

  // --- IMAGE & LINK NSFW FILTER ---
  if (serverSettings.antiNsfw) {
    let imageUrlToScan = null;

    // 1. Check if there is an attached file (image/gif)
    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      if (attachment.contentType && (attachment.contentType.startsWith('image/') || attachment.contentType.includes('video/') || attachment.contentType.includes('gif'))) {
        imageUrlToScan = attachment.url;
      }
    } 
    // 2. Check if there is a link in the text message
    else if (message.content.match(/https?:\/\/[^\s]+/)) {
      // Extract the first link found
      const linkMatch = message.content.match(/https?:\/\/[^\s]+/)[0];
      // Only scan if it looks like an image/video link
      if (linkMatch.match(/\.(jpeg|jpg|gif|png|mp4|webp)/i) || linkMatch.includes('cdn.discordapp.com')) {
        imageUrlToScan = linkMatch;
      }
    }

    if (imageUrlToScan) {
      console.log(`[TEST] Scanning image from: ${imageUrlToScan}`);
      
      try {
        const imageResponse = await fetch(imageUrlToScan);
        
        // Ensure it's actually an image file before sending to API
        const contentType = imageResponse.headers.get('content-type');
        if (!contentType || (!contentType.startsWith('image/') && !contentType.includes('video/'))) {
          console.log(`[TEST] Skipped: Link is not an image/video (${contentType})`);
          return; 
        }

        const imageBuffer = await imageResponse.arrayBuffer();
        const blob = new Blob([imageBuffer], { type: contentType });

        const formData = new FormData();
        formData.append('image', blob, 'image.jpg');

        const response = await fetch(process.env.NSFW_API_URL + '/classify', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.API_KEY}` },
          body: formData
        });

        const rawText = await response.text();
        console.log(`[TEST] API Response: ${rawText}`);
        const data = JSON.parse(rawText);
        
        // If unsafe, delete message
        if (data.safe === false || (data.flags && data.flags.length > 0)) {
          await message.delete().catch(() => {});
          const warning = await message.channel.send(`⚠️ ${message.author}, NSFW links/media are not allowed here.`);
          setTimeout(() => warning.delete().catch(() => {}), 5000);
        }
      } catch (err) {
        console.error('[TEST] Failed to scan:', err);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
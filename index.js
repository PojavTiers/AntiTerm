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

  if (message.content === '$antinsfw on') {
    serverSettings.antiNsfw = true;
    return message.reply('✅ AntiNSFW is now **ON**.');
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

  // --- IMAGE NSFW FILTER ---
  if (message.attachments.size > 0 && serverSettings.antiNsfw) {
    const attachment = message.attachments.first();
    console.log(`[TEST] Image detected, sending as file...`);

    try {
      // Download image from Discord
      const imageResponse = await fetch(attachment.url);
      const imageBuffer = await imageResponse.arrayBuffer();
      const blob = new Blob([imageBuffer], { type: attachment.contentType || 'image/jpeg' });

      // Send as multipart/form-data with 'image' field (as per template docs)
      const formData = new FormData();
      formData.append('image', blob, 'image.jpg');

      const response = await fetch(process.env.NSFW_API_URL + '/classify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.API_KEY}`
        },
        body: formData
      });

      console.log(`[TEST] API status: ${response.status}`);
      const rawText = await response.text();
      console.log(`[TEST] API response: ${rawText}`);

      // The API returns { "safe": false, "flags": ["nsfw"] } or similar
      const data = JSON.parse(rawText);
      if (data.safe === false || (data.flags && data.flags.length > 0)) {
        await message.delete().catch(() => {});
        const warning = await message.channel.send(`⚠️ ${message.author}, this image is not allowed here.`);
        setTimeout(() => warning.delete().catch(() => {}), 5000);
      }
    } catch (err) {
      console.error('[TEST] Failed:', err);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
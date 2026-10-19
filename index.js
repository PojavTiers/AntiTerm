const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Simple storage (resets when bot restarts — we'll fix with a database later)
const settings = new Map();

// ---- Helper: normalise text so "w r d", "w0rd", "W.E.R.D" all become "werd"/"word" ----
function normalise(text) {
  return text
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/[^a-z]/g, ''); // keep only a-z
}

client.once('ready', () => {
  console.log(`✅ ${client.user.tag} is online!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // Make sure this server has settings
  if (!settings.has(message.guild.id)) {
    settings.set(message.guild.id, { antiNsfw: false, words: [] });
  }
  const serverSettings = settings.get(message.guild.id);

  // ---- $antinsfw on/off ----
  if (message.content === '$antinsfw on') {
    serverSettings.antiNsfw = true;
    return message.reply('✅ AntiNSFW is now **ON**\n⚠️ Note: this toggle is a placeholder — real image scanning needs Discord\'s built-in "Explicit Media Content Filter" in Server Settings → AutoMod.');
  }
  if (message.content === '$antinsfw off') {
    serverSettings.antiNsfw = false;
    return message.reply('❌ AntiNSFW is now **OFF**');
  }

  // ---- $antibypassfilter add <word> ----
  if (message.content.startsWith('$antibypassfilter add ')) {
    const word = message.content.slice('$antibypassfilter add '.length).toLowerCase().trim();
    if (!word) return message.reply('Usage: `$antibypassfilter add <word>`');
    if (serverSettings.words.includes(word)) return message.reply('Already in the list.');
    serverSettings.words.push(word);
    return message.reply(`✅ Added \`${word}\` to filter.`);
  }

  // ---- $antibypassfilter list ----
  if (message.content === '$antibypassfilter list') {
    if (serverSettings.words.length === 0) return message.reply('No words in filter.');
    return message.reply('**Filtered words:** ' + serverSettings.words.join(', '));
  }

  // ---- $antibypassfilter remove <word> ----
  if (message.content.startsWith('$antibypassfilter remove ')) {
    const word = message.content.slice('$antibypassfilter remove '.length).toLowerCase().trim();
    const index = serverSettings.words.indexOf(word);
    if (index === -1) return message.reply('That word is not in the list.');
    serverSettings.words.splice(index, 1);
    return message.reply(`✅ Removed \`${word}\``);
  }

  // ---- FILTER CHECK (with variant detection) ----
  if (serverSettings.words.length === 0) return; // nothing to filter

  const cleanedMessage = normalise(message.content);

  // Skip very short messages so "ok", "gg" etc don't false-positive
  if (cleanedMessage.length < 3) return;

  const found = serverSettings.words.find((word) => {
    const cleanedWord = normalise(word);
    if (!cleanedWord) return false;
    return cleanedMessage.includes(cleanedWord);
  });

  if (found) {
    await message.delete().catch(() => {});
    const warning = await message.channel.send(
      `⚠️ ${message.author}, that word is not allowed.`
    );
    setTimeout(() => warning.delete().catch(() => {}), 5000);
  }
});

client.login(process.env.DISCORD_TOKEN);
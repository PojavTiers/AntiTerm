const { Client, GatewayIntentBits, Events } = require('discord.js');
const { WordFilter } = require('@rikatech/text-profanity');

// --- 1. CONFIGURATION ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// In-memory settings store
const guildSettings = new Map();

// List of words that WILL get users termed (Slurs, etc.) - Add your own here.
const TERM_WORDS = ['example_slur_1', 'example_slur_2']; 

// Initialize the anti-bypass filter
const filter = new WordFilter({ languages: ['en'] });

// --- 2. HELPER FUNCTIONS ---
function getGuildSettings(guildId) {
  if (!guildSettings.has(guildId)) {
    guildSettings.set(guildId, { antiNsfw: false, customBypassWords: [] });
  }
  return guildSettings.get(guildId);
}

// --- 3. COMMAND HANDLERS ---
// We are using a simple message-based command parser ($command) for now.
// Slash commands require a separate registration script.

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const prefix = '$';
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // --- AntiNsfw Command ---
  if (command === 'antinsfw') {
    const settings = getGuildSettings(message.guild.id);
    const action = args[0]?.toLowerCase();

    if (action === 'on') {
      settings.antiNsfw = true;
      return message.reply('✅ AntiNSFW is now **ON**. (Note: This requires a third-party image API to actually work, which is not yet implemented).');
    } else if (action === 'off') {
      settings.antiNsfw = false;
      return message.reply('❌ AntiNSFW is now **OFF**.');
    } else {
      return message.reply(`AntiNSFW is currently **${settings.antiNsfw ? 'ON' : 'OFF'}**. Use \`${prefix}antinsfw on/off\`.`);
    }
  }

  // --- AntiBypassFilter Command ---
  if (command === 'antibypassfilter') {
    const settings = getGuildSettings(message.guild.id);
    const subCommand = args[0]?.toLowerCase();
    const word = args[1]?.toLowerCase();

    if (subCommand === 'add' && word) {
      if (settings.customBypassWords.includes(word)) return message.reply('That word is already in the filter.');
      settings.customBypassWords.push(word);
      filter.addBadWords([word]); // Add to the live filter
      return message.reply(`✅ Added \`${word}\` to the bypass filter.`);
    }

    if (subCommand === 'remove' && word) {
      const index = settings.customBypassWords.indexOf(word);
      if (index > -1) {
        settings.customBypassWords.splice(index, 1);
        // Note: The library might not have a 'remove' method. A restart is the safest way to remove a word.
        return message.reply(`✅ Removed \`${word}\` from the filter (may need a bot restart to take full effect).`);
      }
      return message.reply('That word is not in the filter.');
    }

    if (subCommand === 'list') {
      const list = settings.customBypassWords.length > 0 ? settings.customBypassWords.join(', ') : 'No custom words added.';
      return message.reply(`**Custom Bypass Filter Words:**\n${list}`);
    }

    return message.reply(`Usage: \`${prefix}antibypassfilter add/remove/list <word>\``);
  }
});

// --- 4. MESSAGE FILTERING LOGIC ---
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const settings = getGuildSettings(message.guild.id);
  const content = message.content;

  // 1. Check for "Term" words (Severe)
  const lowerContent = content.toLowerCase();
  const hasTermWord = TERM_WORDS.some(word => lowerContent.includes(word));
  
  if (hasTermWord) {
    await message.delete().catch(console.error);
    return message.channel.send(`⚠️ ${message.author}, that language is not allowed here.`).then(msg => {
        setTimeout(() => msg.delete(), 5000); // Auto-delete warning
    });
  }

  // 2. Check for Bypass Filter (Custom Words + Default Profanity)
  // The library handles the normalization (W O R D, W0RD, etc.)
  if (filter.hasBadWord(content)) {
    // If the library catches it, delete the message.
    // We only do this if the message isn't already handled by the term words above.
    await message.delete().catch(console.error);
    // Optional: send a DM or a temporary channel message
  }

  // 3. AntiNSFW logic (Placeholder)
  // If settings.antiNsfw is true, you would call your image moderation API here.
  // Example:
  // if (settings.antiNsfw && message.attachments.size > 0) {
  //   const isNsfw = await checkImagesWithExternalAPI(message.attachments);
  //   if (isNsfw) { message.delete(); }
  // }
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ ${c.user.tag} is online!`);
});

client.login(process.env.DISCORD_TOKEN);
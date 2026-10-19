const { EmbedBuilder } = require('discord.js');

const MAIN_GUILD_ID = '1500445119185293404'; // The server where your emojis live

async function getEmoji(client, name, fallback) {
    if (!client) return fallback;
    
    // Find the main server in the bot's cache
    const mainGuild = client.guilds.cache.get(MAIN_GUILD_ID);
    if (!mainGuild) return fallback;

    try {
        await mainGuild.emojis.fetch(); // Force update cache
        const emoji = mainGuild.emojis.cache.find(e => e.name.toLowerCase() === name.toLowerCase());
        return emoji ? `<:${emoji.name}:${emoji.id}>` : fallback;
    } catch (e) {
        return fallback;
    }
}

async function getButtonEmoji(client, name, fallback) {
    if (!client) return fallback;
    
    const mainGuild = client.guilds.cache.get(MAIN_GUILD_ID);
    if (!mainGuild) return fallback;

    try {
        await mainGuild.emojis.fetch();
        const emoji = mainGuild.emojis.cache.find(e => e.name.toLowerCase() === name.toLowerCase());
        return emoji ? emoji.id : fallback; 
    } catch (e) {
        return fallback;
    }
}

async function createEmbed(type, title, description, client, category = 'General', page = null, totalPages = null) {
    let color = '#5865F2'; 
    let icon = ''; 

    if (type === 'success') { color = '#57F287'; icon = await getEmoji(client, 'success', ''); }
    if (type === 'error') { color = '#ED4245'; icon = await getEmoji(client, 'error', ''); }
    if (type === 'warning') { color = '#FEE75C'; icon = await getEmoji(client, 'warning', ''); }
    if (type === 'info') { color = '#3498DB'; icon = await getEmoji(client, 'info', ''); }
    if (type === 'shield') { color = '#2B2D31'; icon = await getEmoji(client, 'shield', ''); }

    let footerText = `AntiTerm Security | ${category}`;
    if (page && totalPages) {
        footerText = `AntiTerm Security | Page ${page} / ${totalPages} | ${category}`;
    }

    const embed = new EmbedBuilder()
        .setColor(color)
        .setDescription(description)
        .setFooter({ text: footerText, iconURL: client.user.displayAvatarURL() });

    return embed;
}

module.exports = {
  success: async (title, desc, guild, client, cat) => createEmbed('success', title, desc, client, cat),
  error: async (title, desc, guild, client, cat) => createEmbed('error', title, desc, client, cat),
  warning: async (title, desc, guild, client, cat) => createEmbed('warning', title, desc, client, cat),
  info: async (title, desc, guild, client, cat) => createEmbed('info', title, desc, client, cat),
  shield: async (title, desc, guild, client, cat, page, total) => createEmbed('shield', title, desc, client, cat, page, total),
  getEmoji: getEmoji,
  getButtonEmoji: getButtonEmoji
};
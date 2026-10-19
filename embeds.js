const { EmbedBuilder } = require('discord.js');

// Forces a fresh fetch of emojis so you don't have to restart the bot
async function getEmoji(guild, name, fallback) {
    if (!guild) return fallback;
    try {
        await guild.emojis.fetch(); // Force update cache
    } catch (e) {}
    const emoji = guild.emojis.cache.find(e => e.name.toLowerCase() === name.toLowerCase());
    return emoji ? `<:${emoji.name}:${emoji.id}>` : fallback;
}

async function getButtonEmoji(guild, name, fallback) {
    if (!guild) return fallback;
    try {
        await guild.emojis.fetch(); // Force update cache
    } catch (e) {}
    const emoji = guild.emojis.cache.find(e => e.name.toLowerCase() === name.toLowerCase());
    return emoji ? emoji.id : fallback; 
}

async function createEmbed(type, title, description, guild, client, category = 'General', page = null, totalPages = null) {
    let color = '#5865F2'; 
    let icon = ''; 

    if (type === 'success') { color = '#57F287'; icon = await getEmoji(guild, 'success', ''); }
    if (type === 'error') { color = '#ED4245'; icon = await getEmoji(guild, 'error', ''); }
    if (type === 'warning') { color = '#FEE75C'; icon = await getEmoji(guild, 'warning', ''); }
    if (type === 'info') { color = '#3498DB'; icon = await getEmoji(guild, 'info', ''); }
    if (type === 'shield') { color = '#2B2D31'; icon = await getEmoji(guild, 'shield', ''); }

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
  success: async (title, desc, guild, client, cat) => createEmbed('success', title, desc, guild, client, cat),
  error: async (title, desc, guild, client, cat) => createEmbed('error', title, desc, guild, client, cat),
  warning: async (title, desc, guild, client, cat) => createEmbed('warning', title, desc, guild, client, cat),
  info: async (title, desc, guild, client, cat) => createEmbed('info', title, desc, guild, client, cat),
  shield: async (title, desc, guild, client, cat, page, total) => createEmbed('shield', title, desc, guild, client, cat, page, total),
  getEmoji: getEmoji,
  getButtonEmoji: getButtonEmoji
};
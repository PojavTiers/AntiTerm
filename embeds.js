const { EmbedBuilder } = require('discord.js');

// Look ONLY in the current server's emojis (for Embed text)
function getEmoji(guild, name, fallback) {
    if (!guild) return fallback;
    const emoji = guild.emojis.cache.find(e => e.name.toLowerCase().startsWith(name.toLowerCase()));
    return emoji ? `<:${emoji.name}:${emoji.id}>` : fallback;
}

// For Discord Buttons (they need the object, not the text format)
function getButtonEmoji(guild, name, fallback) {
    if (!guild) return fallback;
    const emoji = guild.emojis.cache.find(e => e.name.toLowerCase().startsWith(name.toLowerCase()));
    return emoji || fallback;
}

function createEmbed(type, title, description, guild, client, category = 'General', page = null, totalPages = null) {
    let color = '#5865F2'; // Default Blue
    let icon = 'ℹ️';

    if (type === 'success') { color = '#57F287'; icon = getEmoji(guild, 'success', '✅'); }
    if (type === 'error') { color = '#ED4245'; icon = getEmoji(guild, 'error', '❌'); }
    if (type === 'warning') { color = '#FEE75C'; icon = getEmoji(guild, 'warning', '⚠️'); }
    if (type === 'shield') { color = '#2B2D31'; icon = getEmoji(guild, 'shield', '🛡️'); }

    let footerText = `AntiTerm Security | ${category}`;
    if (page && totalPages) {
        footerText = `AntiTerm Security | Page ${page} / ${totalPages} | ${category}`;
    }

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${icon} ${title}`)
        .setDescription(description)
        .setFooter({ text: footerText, iconURL: client.user.displayAvatarURL() });

    return embed;
}

module.exports = {
  success: (title, desc, guild, client, cat) => createEmbed('success', title, desc, guild, client, cat),
  error: (title, desc, guild, client, cat) => createEmbed('error', title, desc, guild, client, cat),
  warning: (title, desc, guild, client, cat) => createEmbed('warning', title, desc, guild, client, cat),
  info: (title, desc, guild, client, cat) => createEmbed('info', title, desc, guild, client, cat),
  shield: (title, desc, guild, client, cat, page, total) => createEmbed('shield', title, desc, guild, client, cat, page, total),
  getButtonEmoji: getButtonEmoji
};
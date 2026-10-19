const { EmbedBuilder } = require('discord.js');

// Helper to grab custom emojis from the server
function getEmoji(client, name, fallback) {
    const emoji = client.emojis.cache.find(e => e.name === name);
    return emoji ? `<:${emoji.name}:${emoji.id}>` : fallback;
}

function createEmbed(type, title, description, client, category = 'General', page = null, totalPages = null) {
    let color = '#5865F2'; // Default Blue
    let icon = 'ℹ️';

    if (type === 'success') { color = '#57F287'; icon = getEmoji(client, 'success', '✅'); }
    if (type === 'error') { color = '#ED4245'; icon = getEmoji(client, 'error', '❌'); }
    if (type === 'warning') { color = '#FEE75C'; icon = getEmoji(client, 'warning', '⚠️'); }
    if (type === 'shield') { color = '#2B2D31'; icon = getEmoji(client, 'shield', '🛡️'); }

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
  success: (title, desc, client, cat) => createEmbed('success', title, desc, client, cat),
  error: (title, desc, client, cat) => createEmbed('error', title, desc, client, cat),
  warning: (title, desc, client, cat) => createEmbed('warning', title, desc, client, cat),
  info: (title, desc, client, cat) => createEmbed('info', title, desc, client, cat),
  shield: (title, desc, client, cat, page, total) => createEmbed('shield', title, desc, client, cat, page, total)
};
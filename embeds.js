const { EmbedBuilder } = require('discord.js');

const MAIN_GUILD_ID = '1500445119185293404'; 

async function getEmoji(client, name, fallback) {
    if (!client) return fallback;
    try {
        const mainGuild = client.guilds.cache.get(MAIN_GUILD_ID);
        if (!mainGuild) return fallback;

        // Strictly look inside the main server
        const emoji = mainGuild.emojis.cache.find(e => e.name.toLowerCase() === name.toLowerCase());
        
        if (emoji) {
            return `<:${emoji.name}:${emoji.id}>`;
        }
        return fallback;
    } catch (e) {
        return fallback;
    }
}

async function getButtonEmoji(client, name, fallback) {
    if (!client) return fallback;
    try {
        const mainGuild = client.guilds.cache.get(MAIN_GUILD_ID);
        if (!mainGuild) return fallback;

        const emoji = mainGuild.emojis.cache.find(e => e.name.toLowerCase() === name.toLowerCase());
        return emoji ? emoji.id : fallback; 
    } catch (e) {
        return fallback;
    }
}

async function createEmbed(type, title, description, client, category = 'General', page = null, totalPages = null) {
    let color = '#5865F2'; 
    let icon = ''; 

    // Uses exact names "success" and "error" from your server
    if (type === 'success') { color = '#57F287'; icon = await getEmoji(client, 'success', '✅'); }
    if (type === 'error') { color = '#ED4245'; icon = await getEmoji(client, 'error', '❌'); }
    if (type === 'warning') { color = '#FEE75C'; icon = await getEmoji(client, 'warning', '⚠️'); }
    if (type === 'info') { color = '#3498DB'; icon = await getEmoji(client, 'info', 'ℹ️'); }
    if (type === 'shield') { color = '#2B2D31'; icon = await getEmoji(client, 'shield', '🛡️'); }

    let footerText = `AntiTerm Security | ${category}`;
    if (page && totalPages) {
        footerText = `AntiTerm Security | Page ${page} / ${totalPages} | ${category}`;
    }

    // We add the icon directly to the description so it shows up like the custom layout
    const formattedDesc = icon ? `${icon} ${description}` : description;

    const embed = new EmbedBuilder()
        .setColor(color)
        .setDescription(formattedDesc)
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
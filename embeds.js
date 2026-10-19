const { EmbedBuilder } = require('discord.js');

// Professional color palette
const colors = {
  success: '#57F287', // Discord Green
  error: '#ED4245',   // Discord Red
  warning: '#FEE75C', // Discord Yellow
  info: '#5865F2'     // Discord Blurple
};

function createEmbed(type, title, description, client) {
  const embed = new EmbedBuilder()
    .setColor(colors[type])
    .setTitle(title)
    .setDescription(description)
    .setTimestamp()
    .setFooter({ 
      text: 'AntiTerm Security', 
      iconURL: client.user.displayAvatarURL() 
    });

  return embed;
}

module.exports = {
  success: (title, desc, client) => createEmbed('success', `✅ ${title}`, desc, client),
  error: (title, desc, client) => createEmbed('error', `❌ ${title}`, desc, client),
  warning: (title, desc, client) => createEmbed('warning', `⚠️ ${title}`, desc, client),
  info: (title, desc, client) => createEmbed('info', `ℹ️ ${title}`, desc, client)
};
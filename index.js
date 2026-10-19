const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require('discord.js');
const embeds = require('./embeds.js');

function getHelpContainer(page, client, guild, totalPages) {
    // Grab custom emojis by exact name
    const infoDisplay = embeds.getEmoji(guild, 'info', 'ℹ️');
    
    const p1 = `
### ${infoDisplay} AntiTerm Help

**🛡️ Setup & Moderation**
**\`AntiNsfw\`** - Scan images/videos.
**\`NoNsfwText\`** - Scan bad words.

**⚙️ Configuration**
**\`Config\`** - Toggle embeds and warnings.
**\`Filter\`** - Add custom banned words.

**Usage:** Type the command name or use \`/help\` to see examples.
`;
    const p2 = `
### ${infoDisplay} Examples

**To enable the AI image scanner:**
\`$AntiNsfw on --mode:advanced --punishment:mute\`

**To enable the text filter:**
\`$NoNsfwText on 0.8 --punishment:delete\`

**To add a custom word to the filter:**
\`$Filter add badword\`

**To change a custom warning:**
\`$Config wordwarning Watch your mouth {user}!\`
`;

    const currentDesc = page === 1 ? p1 : p2;

    const leftEmoji = embeds.getButtonEmoji(guild, 'arrow_left', '◀️');
    const rightEmoji = embeds.getButtonEmoji(guild, 'arrow_right', '▶️');
    const trashEmoji = embeds.getButtonEmoji(guild, 'dustbin', '🗑️'); 

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prev_page').setEmoji(leftEmoji).setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
        new ButtonBuilder().setCustomId('next_page').setEmoji(rightEmoji).setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages),
        new ButtonBuilder().setCustomId('delete_msg').setEmoji(trashEmoji).setStyle(ButtonStyle.Danger)
    );

    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(currentDesc))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
        .addActionRowComponents(row);
}

module.exports = { getHelpContainer };
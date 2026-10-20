const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require('discord.js');
const embeds = require('./embeds.js');

async function getHelpContainer(page, client, totalPages) {
    const infoDisplay = await embeds.getEmoji(client, 'info', 'ℹ️');
    const shieldDisplay = await embeds.getEmoji(client, 'shield', '🛡️');
    const settingsDisplay = await embeds.getEmoji(client, 'settings', '⚙️');
    
    const p1 = `
### ${infoDisplay} AntiTerm Help

**${shieldDisplay} Setup & Moderation**
**\`AntiNsfw\`** - Scan images/videos.
**\`NoNsfwText\`** - Toggle custom text filter.

**${settingsDisplay} Configuration**
**\`Config\`** - Toggle embeds and warnings.
**\`Filter\`** - Add custom banned words.

**Usage:** Type \`$<command>\` in chat, or use \`/help\` for slash commands.
`;
    const p2 = `
### ${infoDisplay} Examples

**To enable the AI image scanner:**
\`$AntiNsfw on --mode:advanced --punishment:mute\`

**To enable the text filter:**
\`$NoNsfwText on --punishment:delete\`

**To add a custom word to the filter:**
\`$Filter add badword\`

**To change a custom warning:**
\`$Config wordwarning Watch your mouth {user}!\`
`;

    const currentDesc = page === 1 ? p1 : p2;

    const leftEmoji = await embeds.getButtonEmoji(client, 'arrow_left', '◀');
    const rightEmoji = await embeds.getButtonEmoji(client, 'arrow_right', '▶');
    const trashEmoji = await embeds.getButtonEmoji(client, 'dustbin', '✖'); 

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
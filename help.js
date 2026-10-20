const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require('discord.js');
const embeds = require('./embeds.js');

async function getHelpContainer(page, client, totalPages) {
    const infoDisplay = await embeds.getEmoji(client, 'info', 'ℹ️');
    const shieldDisplay = await embeds.getEmoji(client, 'shield', '🛡️');
    
    const p1 = `
### ${infoDisplay} AntiTerm Help

**${shieldDisplay} Commands**
**\`AntiNsfw\`** - Scan images and videos.
**\`Filter\`** - Manage the text filter.

**Usage:** Type \`$<command>\` in chat, or use \`/<command>\`.
`;
    const p2 = `
### ${infoDisplay} Examples

**AI Scanner:**
\`$AntiNsfw on --mode:advanced --punishment:mute\`

**Text Filter:**
\`$Filter add badword\`
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
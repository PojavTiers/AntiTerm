const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require('discord.js');
const embeds = require('./embeds.js');

async function getHelpContainer(page, client, totalPages) {
    const infoDisplay = await embeds.getEmoji(client, 'info', 'ℹ️');
    const shieldDisplay = await embeds.getEmoji(client, 'shield', '🛡️');
    
    const p1 = `
### ${infoDisplay} AntiTerm Help

**${shieldDisplay} Interactive Dashboard**
All features are handled inside the **Config Menu**. 
Type \`$config\` or \`/config\` to open it.

**Inside the Menu:**
\`>\` **Toggle AI:** Turn the NSFW scanner on/off.
\`>\` **Change Mode:** Basic, Moderate, or Advanced scanning.
\`>\` **Change Punishment:** Delete, Mute, Kick, or Ban.
\`>\` **Add/Remove Word:** Manage the unbypassable text filter.
\`>\` **Add/Remove User:** Whitelist users to use the bot.
`;
    const p2 = `
### ${infoDisplay} Mode Guide

**AI Scanner Modes:**
\`>\` \`Basic\` - Scans only for hardcore porn.
\`>\` \`Moderate\` - Scans for porn, hentai, and explicit media.
\`>\` \`Advanced\` - Strictly scans for anything suggestive (bikinis, lingerie).

**Text Filter:**
The text filter is mathematically unbypassable. It detects homoglyphs (fake letters), Leetspeak (w0rd), repeating letters (wooord), and phonetic typos (werd).
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
const { ActionRowBuilder, StringSelectMenuBuilder, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const embeds = require('./embeds.js');

async function getHelpContainer(page, client, totalPages) {
    const infoDisplay = await embeds.getEmoji(client, 'info', 'ℹ️');
    const shieldDisplay = await embeds.getEmoji(client, 'shield', '🛡️');
    
    const p1 = `
${infoDisplay} **AntiTerm Help Center**

${shieldDisplay} **Interactive Dashboard**
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
${infoDisplay} **Mode Guide**

**AI Scanner Modes:**
\`>\` \`Basic\` - Scans only for hardcore porn.
\`>\` \`Moderate\` - Scans for porn, hentai, and explicit media.
\`>\` \`Advanced\` - Strictly scans for anything suggestive (bikinis, lingerie).

**Text Filter:**
The text filter is mathematically unbypassable. It detects homoglyphs (fake letters), Leetspeak (w0rd), repeating letters (wooord), and phonetic typos (werd).
`;

    const currentDesc = page === 1 ? p1 : p2;

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('help_menu')
        .setPlaceholder('Choose a page...')
        .addOptions([
            { label: 'Dashboard Info', description: 'How to use the config menu', value: 'help_page_1', default: page === 1 },
            { label: 'Mode Guide', description: 'Explaining the AI strictness', value: 'help_page_2', default: page === 2 }
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(currentDesc))
        .addActionRowComponents(row);
}

module.exports = { getHelpContainer };
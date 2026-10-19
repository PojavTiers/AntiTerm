const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require('discord.js');
const embeds = require('./embeds.js');

function getHelpContainer(page, client, guild, totalPages) {
    // Fetch the custom "info" emoji from the server
    const infoIcon = embeds.getButtonEmoji(guild, 'info', 'ℹ️');
    const infoDisplay = infoIcon.id ? `<:${infoIcon.name}:${infoIcon.id}>` : infoIcon;

    const p1 = `
### ${infoDisplay} Help

**Help Commands**
├ help
└ help category

**Moderation Commands**
├ antinsfw
├ antinsfwmessages
└ antibypassfilter

**Antinuke Commands**
├ antinuke
└ antinuke admin
`;
    const p2 = `
### ${infoDisplay} Help

**Command Examples**
├ $antinsfw on --punishment:ban
├ $antinsfwmessages on 0.8 --punishment:mute --duration:1h
├ $antibypassfilter add badword
└ $config nsfwwarning {user} posted NSFW!

**Need Help?**
├ All commands require Admin permissions.
└ Use the buttons below to navigate.
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

    // NO ACCENT COLOR = transparent/standard dark theme background
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(currentDesc))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1))
        .addActionRowComponents(row);
}

module.exports = { getHelpContainer };
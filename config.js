const { sendMessage } = require('./utils.js');

async function handleConfig(message, args, s, client) {
    const setting = args[0]?.toLowerCase();
    const val = args.slice(1).join(' ');

    if (!setting || !val) return sendMessage(message, 'error', 'Error', ['Usage: `$config <embeds|nsfwwarning|wordwarning> <value>`'], message.guild, client, s);

    if (setting === 'embeds') {
        if (val.toLowerCase() !== 'on' && val.toLowerCase() !== 'off') return sendMessage(message, 'error', 'Error', ['Value must be `on` or `off`.'], message.guild, client, s);
        s.useEmbeds = val.toLowerCase() === 'on';
    } else if (setting === 'nsfwwarning') {
        s.customMessages.nsfwWarning = val;
    } else if (setting === 'wordwarning') {
        s.customMessages.wordWarning = val;
    } else {
        return sendMessage(message, 'error', 'Error', ['Invalid setting. Use `embeds`, `nsfwwarning`, or `wordwarning`.'], message.guild, client, s);
    }
    await s.save();
    return sendMessage(message, 'success', 'Config Updated', [`Setting **${setting}** has been updated.`], message.guild, client, s);
}

module.exports = { handleConfig };
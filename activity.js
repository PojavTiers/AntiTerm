const { ActivityType } = require('discord.js');

module.exports = (client) => {
    // Set Custom Status (The speech bubble one)
    client.user.setPresence({
        activities: [{
            name: 'discord.gg/camz',
            type: ActivityType.Custom,
            state: '🔗 discord.gg/camz'
        }],
        status: 'online'
    });
    
    console.log(`[DEBUG] Status set to: 🔗 discord.gg/camz`);
};
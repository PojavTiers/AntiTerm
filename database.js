const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    antiNsfw: { type: Boolean, default: false },
    nsfwMode: { type: String, default: 'moderate' },
    nsfwPunish: { type: String, default: 'delete' },
    nsfwDur: { type: String, default: '1h' },
    words: { type: [String], default: [] },
    useEmbeds: { type: Boolean, default: true }
});

const GuildSettings = mongoose.model('GuildSettings', settingsSchema);

// NEW: Global settings for the bot (whitelist)
const globalSchema = new mongoose.Schema({
    id: { type: String, default: 'global_config' },
    allowedGuilds: { type: [String], default: [] }
});
const GlobalConfig = mongoose.model('GlobalConfig', globalSchema);

const settingsCache = new Map();

async function getSettings(guildId) {
    if (settingsCache.has(guildId)) return settingsCache.get(guildId);
    let s = await GuildSettings.findOne({ guildId });
    if (!s) s = await GuildSettings.create({ guildId });
    settingsCache.set(guildId, s);
    return s;
}

async function getWhitelist() {
    let config = await GlobalConfig.findOne({ id: 'global_config' });
    if (!config) {
        // If no whitelist exists, use the ENV variable as the starting point
        const envGuilds = process.env.ALLOWED_GUILDS ? process.env.ALLOWED_GUILDS.split(',') : [];
        config = await GlobalConfig.create({ id: 'global_config', allowedGuilds: envGuilds });
    }
    return config;
}

async function connectDB() {
    const mongoUri = process.env.MONGO_URL;
    if (!mongoUri) {
        console.log(`[DEBUG] No MONGO_URL found. Settings will not be saved permanently.`);
        return;
    }
    try {
        await mongoose.connect(mongoUri);
        console.log(`[DEBUG] Connected to MongoDB successfully!`);
    } catch (err) {
        console.error(`[DEBUG] MongoDB connection error:`, err.message);
    }
}

module.exports = { getSettings, getWhitelist, GlobalConfig, connectDB };
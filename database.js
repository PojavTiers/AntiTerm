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
        config = await GlobalConfig.create({ id: 'global_config', allowedGuilds: [] });
    }
    
    // FAIL-SAFE: Always ensure your main server is in the whitelist
    const MAIN_SERVER_ID = '1500445119185293404'; 
    if (!config.allowedGuilds.includes(MAIN_SERVER_ID)) {
        config.allowedGuilds.push(MAIN_SERVER_ID);
        await config.save();
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
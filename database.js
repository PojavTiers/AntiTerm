const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    antiNsfw: { type: Boolean, default: false },
    nsfwMode: { type: String, default: 'moderate' }, // NEW: basic, moderate, advanced
    nsfwPunish: { type: String, default: 'delete' },
    nsfwDur: { type: String, default: '1h' },
    termMessages: { type: Boolean, default: false },
    sensitivity: { type: Number, default: 0.5 },
    msgPunish: { type: String, default: 'delete' },
    msgDur: { type: String, default: '1h' },
    words: { type: [String], default: [] },
    allowedUsers: { type: [String], default: [] },
    useEmbeds: { type: Boolean, default: true },
    customMessages: {
        nsfwWarning: { type: String, default: "Image detected as **NSFW** and deleted the message." },
        wordWarning: { type: String, default: "That word is not allowed." }
    }
});

const GuildSettings = mongoose.model('GuildSettings', settingsSchema);
const settingsCache = new Map();

async function getSettings(guildId) {
    if (settingsCache.has(guildId)) return settingsCache.get(guildId);
    let s = await GuildSettings.findOne({ guildId });
    if (!s) s = await GuildSettings.create({ guildId });
    settingsCache.set(guildId, s);
    return s;
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

module.exports = { getSettings, connectDB };
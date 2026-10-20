const levenshtein = require('fast-levenshtein');
const embeds = require('./embeds.js');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SAFE_WORDS = ['nsfw', 'sexual', 'assume', 'assassin', 'class', 'pass', 'bass', 'grass', 'mass', 'cocktail', 'peacock', 'shitake', 'hello', 'help'];

// 1. ADVANCED NORMALIZATION (Homoglyphs, Leetspeak, Invisible chars)
function normalise(text) {
    let cleaned = text.toLowerCase()
        // Normalize Unicode (turns fancy fonts into standard letters)
        .normalize('NFKC')
        // Remove invisible zero-width characters
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        // Replace common Homoglyphs (Cyrillic/Greek look-alikes)
        .replace(/[а]/g, 'a').replace(/[е]/g, 'e').replace(/[о]/g, 'o')
        .replace(/[р]/g, 'p').replace(/[с]/g, 'c').replace(/[у]/g, 'y')
        .replace(/[х]/g, 'x').replace(/[і]/g, 'i').replace(/[ј]/g, 'j')
        // Replace Leetspeak
        .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
        .replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't')
        .replace(/@/g, 'a').replace(/\$/g, 's').replace(/!/g, 'i')
        // Strip everything that isn't a letter
        .replace(/[^a-z]/g, ''); 
        
    return cleaned;
}

// 2. COLLAPSE REPEATS ("shiiiiit" -> "shit")
function collapseRepeats(text) {
    return text.replace(/(.)\1+/g, '$1');
}

// 3. SOUNDEX (Phonetic matching)
function getSoundex(str) {
    const a = str.toLowerCase().split('');
    const codes = { b: 1, f: 1, p: 1, v: 1, c: 2, g: 2, j: 2, k: 2, q: 2, s: 2, x: 2, z: 2, d: 3, t: 3, l: 4, m: 5, n: 5, r: 6 };
    let result = a.shift();
    let lastCode = codes[result] || '';
    for (const char of a) {
        const code = codes[char] || '';
        if (code && code !== lastCode) result += code;
        lastCode = code;
    }
    return (result + '000').slice(0, 4);
}

function isCloseEnough(input, target) {
    if (!input || !target) return false;
    if (Math.abs(input.length - target.length) > 1) return false;
    return levenshtein.get(input, target) <= 1; 
}

// 4. ULTIMATE VIOLATION CHECKER
function checkViolation(text, bannedWord) {
    const cleanBanned = normalise(bannedWord);
    if (!cleanBanned || cleanBanned.length < 3) return false;
    if (SAFE_WORDS.includes(cleanBanned)) return false;

    const collapsedBanned = collapseRepeats(cleanBanned);
    const fullCleanText = collapseRepeats(normalise(text));

    // Check A: Is the word hidden anywhere in the sentence? (e.g. "hellotestworld" -> finds "test")
    if (fullCleanText.includes(collapsedBanned)) return true;

    // Check B: Soundex (Phonetic) 
    const bannedSoundex = getSoundex(collapsedBanned);
    if (getSoundex(fullCleanText).includes(bannedSoundex)) return true;

    // Check C: Word-by-word typo checking (Levenshtein)
    const rawWords = text.split(/[\s,.!?]+/); 
    for (const w of rawWords) {
        if (!w) continue;
        const cleanW = collapseRepeats(normalise(w));
        if (!cleanW) continue;
        
        if (cleanW.length > 2 && isCloseEnough(cleanW, collapsedBanned)) return true;
    }

    return false;
}

async function sendMessage(target, type, title, fields, guild, client, s) {
    let formattedDesc = "";
    if (Array.isArray(fields)) {
        formattedDesc = fields.join('\n');
    } else {
        formattedDesc = fields;
    }

    if (s.useEmbeds) {
        const embed = await embeds[type](title, formattedDesc, guild, client);
        return target.reply({ embeds: [embed] });
    } else {
        return target.reply({ content: `**${title || type.toUpperCase()}**\n${formattedDesc}` });
    }
}

function isAuthorized(member, s) {
    if (!member) return false;
    if (member.permissions.has(require('discord.js').PermissionFlagsBits.Administrator)) return true;
    if (member.id === member.guild.ownerId) return true;
    if (s.allowedUsers && s.allowedUsers.includes(member.id)) return true;
    return false;
}

function parseDuration(str) {
    if (!str) return 3600000; 
    const match = str.match(/^(\d+)([smhd])$/i);
    if (!match) return 3600000;
    const val = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 's') return val * 1000;
    if (unit === 'm') return val * 60000;
    if (unit === 'h') return val * 3600000;
    if (unit === 'd') return val * 86400000;
    return 3600000;
}

async function applyPunishment(member, type, durationStr, reason, message, client) {
    if (type === 'delete' || !type) return; 
    try {
        if (type === 'mute') await member.timeout(parseDuration(durationStr), reason);
        else if (type === 'kick') await member.kick(reason);
        else if (type === 'ban') await member.ban({ reason });
    } catch (e) {
        console.error(`Failed to ${type} user:`, e);
    }
}

function getNsfwThreshold(mode) {
    if (mode === 'basic') return 0.7;
    if (mode === 'advanced') return 0.3;
    return 0.5; 
}

async function createVideoCollage(videoBuffer) {
    const tempVideoPath = path.join(os.tmpdir(), `vid_${Date.now()}.mp4`);
    const outputPath = path.join(os.tmpdir(), `collage_${Date.now()}.jpg`);
    fs.writeFileSync(tempVideoPath, videoBuffer);

    try {
        await new Promise((resolve, reject) => {
            ffmpeg(tempVideoPath)
                .on('end', resolve)
                .on('error', reject)
                .outputOptions([
                    '-vf', 'select=\'gte(n,1)\',scale=320:240,tile=2x3',
                    '-frames:v', '1',
                    '-q:v', '5'
                ])
                .save(outputPath);
        });
        return fs.readFileSync(outputPath);
    } catch (err) {
        return null;
    } finally {
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
}

module.exports = {
    normalise, checkViolation, sendMessage, isAuthorized, applyPunishment, getNsfwThreshold, createVideoCollage,
    SAFE_WORDS
};
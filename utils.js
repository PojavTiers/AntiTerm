const levenshtein = require('fast-levenshtein');
const embeds = require('./embeds.js');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SAFE_WORDS = ['nsfw', 'sex', 'sexual', 'assume', 'assassin', 'class', 'pass', 'bass', 'grass', 'mass', 'cocktail', 'peacock', 'shitake', 'hello', 'help'];

// Normalises text: lowercase, removes invisible chars, converts leetspeak, strips numbers/symbols
function normalise(text) {
  return text.toLowerCase().normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's')
    .replace(/[^a-z]/g, ''); 
}

// Collapses ANY repeating letter into a single letter
function collapseRepeats(text) {
    return text.replace(/(.)\1+/g, '$1');
}

// AI-like phonetic matching (Soundex)
function getSoundex(str) {
    const a = str.toLowerCase().split('');
    const codes = { b: 1, f: 1, p: 1, v: 1, c: 2, g: 2, j: 2, k: 2, q: 2, s: 2, x: 2, z: 2, d: 3, t: 3, l: 4, m: 5, n: 5, r: 6 };
    let result = a.shift();
    let lastCode = codes[result] || '';
    
    for (const char of a) {
        const code = codes[char] || '';
        if (code && code !== lastCode) {
            result += code;
        }
        lastCode = code;
    }
    
    // Pad with zeros to ensure it's 4 characters long
    return (result + '000').slice(0, 4);
}

function isCloseEnough(input, target) {
    if (!input || !target) return false;
    if (Math.abs(input.length - target.length) > 1) return false;
    return levenshtein.get(input, target) <= 1; 
}

// The ultimate bypass-proof checker
function checkViolation(text, bannedWord) {
    const cleanBanned = normalise(bannedWord);
    if (!cleanBanned || cleanBanned.length < 3) return false;
    if (SAFE_WORDS.includes(cleanBanned)) return false;

    const collapsedBanned = collapseRepeats(cleanBanned);
    const fullCleanText = collapseRepeats(normalise(text));

    // 1. Check for exact or collapsed match (teessstt -> test)
    if (fullCleanText.includes(collapsedBanned)) return true;

    // 2. Check for soundex match (AI-like phonetic check)
    const bannedSoundex = getSoundex(collapsedBanned);

    const words = text.split(/[\s,.!?]+/); 
    for (const w of words) {
        if (!w) continue;
        const cleanW = collapseRepeats(normalise(w));
        if (!cleanW) continue;
        
        // Check if it's a typo
        if (cleanW.length > 2 && isCloseEnough(cleanW, collapsedBanned)) return true;

        // Check if it sounds exactly the same
        if (cleanW.length > 2 && getSoundex(cleanW) === bannedSoundex) return true;
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
        return target.reply({ content: `**${title}**\n${formattedDesc}` });
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
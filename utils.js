const levenshtein = require('fast-levenshtein');
const embeds = require('./embeds.js');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EXTREME_SLURS = ['nigger', 'neeger', 'ngr']; 
const MEDIUM_INSULTS = ['asshole', 'bastard', 'retard', 'whore', 'slut'];
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

    // 1. Clean and collapse the banned word (e.g., "teeeest" -> "test")
    const collapsedBanned = collapseRepeats(cleanBanned);

    // 2. Clean and collapse the entire message
    const fullCleanText = collapseRepeats(normalise(text));

    // 3. Check if the collapsed banned word is hidden ANYWHERE inside the collapsed message
    if (fullCleanText.includes(collapsedBanned)) return true;

    // 4. Fallback: Check word-by-word for typos (wrd, tst)
    const words = text.split(/[\s,.!?]+/); 
    for (const w of words) {
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
    EXTREME_SLURS, MEDIUM_INSULTS, SAFE_WORDS
};
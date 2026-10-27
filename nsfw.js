const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');

function parseApiScores(data) {
    const scores = { porn: 0, hentai: 0, sexy: 0, drawing: 0, neutral: 0 };
    let array = null;
    
    if (Array.isArray(data)) array = data;
    else if (data && Array.isArray(data.prediction)) array = data.prediction;
    else if (data && Array.isArray(data.predictions)) array = data.predictions;
    else if (data && Array.isArray(data.data)) array = data.data;

    if (array) {
        for (const item of array) {
            const className = (item.className || item.label || item.class || '').toLowerCase();
            const prob = parseFloat(item.probability || item.score || item.confidence || 0);
            if (className === 'porn') scores.porn = prob;
            if (className === 'hentai') scores.hentai = prob;
            if (className === 'sexy') scores.sexy = prob;
            if (className === 'drawing') scores.drawing = prob;
            if (className === 'neutral') scores.neutral = prob;
        }
    } else if (data && typeof data === 'object') {
        for (const key of Object.keys(data)) {
            const k = key.toLowerCase();
            const val = parseFloat(data[key]);
            if (!isNaN(val) && scores[k] !== undefined) scores[k] = val;
        }
    }
    return scores;
}

async function resolveMediaUrl(url, embed) {
    if (url.match(/\.(jpeg|jpg|png|gif|mp4|webm|webp)/i)) return url; 
    if (embed && embed.video && embed.video.url) return embed.video.url;
    if (embed && embed.image && embed.image.url) return embed.image.url;
    if (embed && embed.thumbnail && embed.thumbnail.url) return embed.thumbnail.url;
    
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) return null;
        const html = await res.text();
        const mp4Match = html.match(/(https:\/\/[^"']+\.(?:mp4|webm))/i);
        if (mp4Match) return mp4Match[0];
        const gifMatch = html.match(/(https:\/\/[^"']+\.gif)/i);
        if (gifMatch) return gifMatch[0];
    } catch (e) {}
    return null;
}

async function generateCollage(videoBuffer, isGif = false) {
    const ext = isGif ? 'gif' : 'mp4';
    const tempVideoPath = path.join(os.tmpdir(), `vid_${Date.now()}.${ext}`);
    const outputPath = path.join(os.tmpdir(), `collage_${Date.now()}.jpg`);
    fs.writeFileSync(tempVideoPath, videoBuffer);

    try {
        await new Promise((resolve, reject) => {
            const command = ffmpeg(tempVideoPath)
                .on('end', resolve)
                .on('error', (err) => { reject(err); });

            command.inputOptions(['-f', ext, '-vsync', 'vfr']);
            command.outputOptions([
                '-vf', 'fps=1,scale=400:400:force_original_aspect_ratio=decrease,pad=400:400:(ow-iw)/2:(oh-ih)/2:color=black,tile=3x3',
                '-frames:v', '1',
                '-q:v', '3'
            ]).save(outputPath);
        });

        if (fs.existsSync(outputPath)) {
            const buf = fs.readFileSync(outputPath);
            if (buf.length > 0) return buf;
        }
        return null;
    } catch (err) {
        return null;
    } finally {
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
}

// NEW: Tries multiple ways to send the image to the API
async function sendToApi(apiUrl, apiKey, buffer, mimeType) {
    const formats = [
        { field: 'image', filename: 'image.jpg', mime: 'image/jpeg' },
        { field: 'file', filename: 'image.jpg', mime: 'image/jpeg' },
        { field: 'image', filename: 'image.png', mime: 'image/png' },
        { field: 'file', filename: 'image.png', mime: 'image/png' }
    ];

    for (const fmt of formats) {
        try {
            const formData = new FormData(); 
            const blob = new Blob([buffer], { type: fmt.mime });
            formData.append(fmt.field, blob, fmt.filename);
            
            const apiRes = await fetch(apiUrl + '/classify', { 
                method: 'POST', 
                body: formData,
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (apiRes.ok) {
                const rawData = await apiRes.text();
                const parsed = JSON.parse(rawData);
                const scores = parseApiScores(parsed);
                // Check if we actually got real scores and not all zeros
                if (scores.porn > 0 || scores.hentai > 0 || scores.sexy > 0 || scores.drawing > 0 || scores.neutral > 0) {
                    return scores;
                }
            }
        } catch (e) {
            // Ignore and try next format
        }
    }
    return null; // All formats failed
}

async function scanMedia(url, s, client, message = null) {
    let isUnsafe = false;
    let detectedFlag = "nsfw";

    let threshold = 0.50;
    if (s.nsfwMode === 'advanced') threshold = 0.05;
    else if (s.nsfwMode === 'moderate') threshold = 0.25;

    let apiUrl = process.env.NSFW_API_URL;
    let apiKey = process.env.API_KEY;
    
    if (!apiUrl || !apiKey) return { isUnsafe: false, detectedFlag: "nsfw" };
    if (!apiUrl.startsWith('http')) apiUrl = 'https://' + apiUrl;

    try {
        let matchingEmbed = null;
        if (message && message.embeds.length > 0) {
            matchingEmbed = message.embeds.find(e => e.url === url || (e.video && e.video.url === url) || (e.thumbnail && e.thumbnail.url === url));
        }

        const directUrl = await resolveMediaUrl(url, matchingEmbed);
        if (!directUrl) return { isUnsafe: false, detectedFlag: "nsfw" };

        const isVideo = directUrl.toLowerCase().includes('.mp4') || directUrl.toLowerCase().includes('.webm');
        const isGif = directUrl.toLowerCase().includes('.gif');

        const imageResponse = await fetch(directUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const buffer = Buffer.from(await imageResponse.arrayBuffer());

        if (buffer.length === 0) return { isUnsafe: false, detectedFlag: "nsfw" };

        let scores = null;

        if (isVideo || isGif) {
            const collage = await generateCollage(buffer, isGif);
            if (!collage) return { isUnsafe: false, detectedFlag: "nsfw" };
            scores = await sendToApi(apiUrl, apiKey, collage, 'image/jpeg');
        } else {
            scores = await sendToApi(apiUrl, apiKey, buffer, 'image/jpeg');
        }

        if (scores) {
            console.log(`[SCANNER DEBUG] Scores -> Porn: ${(scores.porn*100).toFixed(2)}% | Hentai: ${(scores.hentai*100).toFixed(2)}% | Sexy: ${(scores.sexy*100).toFixed(2)}% | Drawing: ${(scores.drawing*100).toFixed(2)}% | Neutral: ${(scores.neutral*100).toFixed(2)}%`);
            
            if (scores.porn > threshold || scores.hentai > threshold || scores.sexy > threshold) {
                isUnsafe = true;
                detectedFlag = (scores.hentai > scores.porn && scores.hentai > scores.sexy) ? 'hentai' : 'nsfw';
            }
        } else {
            console.log(`[SCANNER DEBUG] API returned null for all formats. It might be down or rejecting the request.`);
        }
    } catch (err) {
        console.error("[SCANNER ERROR] Fetch/Scan failed:", err);
    }

    return { isUnsafe, detectedFlag };
}

module.exports = { scanMedia };
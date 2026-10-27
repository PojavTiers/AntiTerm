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

async function generateCollages(videoBuffer, isGif = false) {
    const tempVideoPath = path.join(os.tmpdir(), `vid_${Date.now()}.${isGif ? 'gif' : 'mp4'}`);
    const collage1Path = path.join(os.tmpdir(), `collage1_${Date.now()}.jpg`);
    fs.writeFileSync(tempVideoPath, videoBuffer);

    const collages = [];

    try {
        // 3x3 grid of 9 frames
        await new Promise((resolve, reject) => {
            ffmpeg(tempVideoPath)
                .on('end', resolve)
                .on('error', reject)
                .outputOptions(['-vf', 'select=\'not(mod(n\\,10))\',scale=256:256,tile=3x3', '-frames:v', '1', '-q:v', '4'])
                .save(collage1Path);
        });
        if (fs.existsSync(collage1Path)) {
            const buf = fs.readFileSync(collage1Path);
            if (buf.length > 0) collages.push(buf);
        }

        return collages;
    } catch (err) {
        console.error("[SCANNER ERROR] Collage generation failed:", err);
        return [];
    } finally {
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(collage1Path)) fs.unlinkSync(collage1Path);
    }
}

async function scanMedia(url, s, client) {
    let isUnsafe = false;
    let detectedFlag = "nsfw";

    let threshold = 0.50;
    if (s.nsfwMode === 'advanced') threshold = 0.05;
    else if (s.nsfwMode === 'moderate') threshold = 0.25;

    let apiUrl = process.env.NSFW_API_URL;
    let apiKey = process.env.API_KEY;
    
    if (!apiUrl || !apiKey) {
        console.error("[SCANNER CRITICAL] Missing NSFW_API_URL or API_KEY in variables.");
        return { isUnsafe: false, detectedFlag: "nsfw" };
    }
    if (!apiUrl.startsWith('http')) apiUrl = 'https://' + apiUrl;

    const isVideo = url.toLowerCase().includes('.mp4') || url.toLowerCase().includes('.webm');
    const isGif = url.toLowerCase().includes('.gif');

    try {
        const imageResponse = await fetch(url);
        const buffer = Buffer.from(await imageResponse.arrayBuffer());

        if (buffer.length === 0) {
            console.error("[SCANNER CRITICAL] Downloaded file is empty (0 bytes).");
            return { isUnsafe: false, detectedFlag: "nsfw" };
        }

        const sendToApi = async (blob, filename) => {
            const formData = new FormData(); 
            // Force the type to be image/jpeg
            formData.append('image', blob, filename);
            
            const apiRes = await fetch(apiUrl + '/classify', { 
                method: 'POST', 
                body: formData,
                headers: { 
                    'Authorization': `Bearer ${apiKey}`
                    // Note: We intentionally DO NOT set Content-Type here. 
                    // The native fetch/FormData will automatically set the correct boundary.
                }
            });

            if (!apiRes.ok) {
                const errText = await apiRes.text();
                console.error(`[SCANNER CRITICAL] API rejected request: ${apiRes.status} | Body: ${errText}`);
                return null;
            }

            const rawData = await apiRes.text();
            try {
                const parsedData = JSON.parse(rawData);
                return parseApiScores(parsedData);
            } catch(e) {
                console.error("[SCANNER CRITICAL] Failed to parse JSON:", rawData);
                return null;
            }
        };

        if (isVideo || isGif) {
            const collages = await generateCollages(buffer, isGif);
            if (collages.length === 0) {
                console.log("[SCANNER DEBUG] No collages were generated. The GIF might be too short or corrupted.");
            }

            for (let i = 0; i < collages.length; i++) {
                const scores = await sendToApi(new Blob([collages[i]], { type: 'image/jpeg' }), `collage_${i}.jpg`);
                if (!scores) continue;

                console.log(`[SCANNER DEBUG] Collage ${i+1} Scores -> Porn: ${(scores.porn*100).toFixed(2)}% | Hentai: ${(scores.hentai*100).toFixed(2)}% | Sexy: ${(scores.sexy*100).toFixed(2)}% | Drawing: ${(scores.drawing*100).toFixed(2)}%`);
                
                const isHighDrawing = scores.drawing > 0.50 && s.nsfwMode === 'advanced';
                if (scores.porn > threshold || scores.hentai > threshold || scores.sexy > threshold || isHighDrawing) {
                    isUnsafe = true;
                    detectedFlag = isHighDrawing ? 'hentai' : (scores.hentai > scores.porn && scores.hentai > scores.sexy ? 'hentai' : 'nsfw');
                    break; 
                }
            }
        } else {
            const scores = await sendToApi(new Blob([buffer], { type: 'image/jpeg' }), 'image.jpg');
            if (scores) {
                console.log(`[SCANNER DEBUG] Image Scores -> Porn: ${(scores.porn*100).toFixed(2)}% | Hentai: ${(scores.hentai*100).toFixed(2)}% | Sexy: ${(scores.sexy*100).toFixed(2)}% | Drawing: ${(scores.drawing*100).toFixed(2)}%`);
                
                const isHighDrawing = scores.drawing > 0.50 && s.nsfwMode === 'advanced';
                if (scores.porn > threshold || scores.hentai > threshold || scores.sexy > threshold || isHighDrawing) {
                    isUnsafe = true;
                    detectedFlag = isHighDrawing ? 'hentai' : (scores.hentai > scores.porn && scores.hentai > scores.sexy ? 'hentai' : 'nsfw');
                }
            }
        }
    } catch (err) {
        console.error("[SCANNER ERROR] Fetch/Scan failed:", err);
    }

    return { isUnsafe, detectedFlag };
}

module.exports = { scanMedia };
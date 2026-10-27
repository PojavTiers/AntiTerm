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

// BULLETPROOF COLLAGE GENERATOR
async function generateCollage(videoBuffer, isGif = false) {
    const ext = isGif ? 'gif' : 'mp4';
    const tempVideoPath = path.join(os.tmpdir(), `vid_${Date.now()}.${ext}`);
    const outputPath = path.join(os.tmpdir(), `collage_${Date.now()}.jpg`);
    fs.writeFileSync(tempVideoPath, videoBuffer);

    try {
        await new Promise((resolve, reject) => {
            const command = ffmpeg(tempVideoPath)
                .on('end', resolve)
                .on('error', (err) => {
                    console.error("[FFMPEG CRITICAL ERROR]:", err.message);
                    reject(err);
                });

            // Force input format
            command.inputOptions([
                '-f', ext, 
                '-vsync', 'vfr' // Fix for GIF freezing
            ]);

            command.outputOptions([
                // Scale to 400px width, preserve aspect ratio, pad to make it square (prevents stretching), tile 3x3
                '-vf', 'fps=1,scale=400:400:force_original_aspect_ratio=decrease,pad=400:400:(ow-iw)/2:(oh-ih)/2:color=black,tile=3x3',
                '-frames:v', '1',
                '-q:v', '3'
            ])
            .save(outputPath);
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

async function scanMedia(url, s, client) {
    let isUnsafe = false;
    let detectedFlag = "nsfw";

    let threshold = 0.50;
    if (s.nsfwMode === 'advanced') threshold = 0.05;
    else if (s.nsfwMode === 'moderate') threshold = 0.25;

    let apiUrl = process.env.NSFW_API_URL;
    let apiKey = process.env.API_KEY;
    
    if (!apiUrl || !apiKey) return { isUnsafe: false, detectedFlag: "nsfw" };
    if (!apiUrl.startsWith('http')) apiUrl = 'https://' + apiUrl;

    const isVideo = url.toLowerCase().includes('.mp4') || url.toLowerCase().includes('.webm');
    const isGif = url.toLowerCase().includes('.gif');

    try {
        const imageResponse = await fetch(url);
        const buffer = Buffer.from(await imageResponse.arrayBuffer());

        const sendToApi = async (blob, filename) => {
            const formData = new FormData(); 
            formData.append('image', blob, filename);
            
            const apiRes = await fetch(apiUrl + '/classify', { 
                method: 'POST', 
                body: formData,
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (!apiRes.ok) {
                const errText = await apiRes.text();
                console.error(`[SCANNER CRITICAL] API rejected request: ${apiRes.status} | Body: ${errText}`);
                return null;
            }

            const rawData = await apiRes.text();
            try {
                return parseApiScores(JSON.parse(rawData));
            } catch(e) {
                return null;
            }
        };

        if (isVideo || isGif) {
            console.log(`[SCANNER] Generating bulletproof collage for ${isGif ? 'GIF' : 'Video'}...`);
            const collage = await generateCollage(buffer, isGif);
            
            if (!collage) {
                console.log("[SCANNER DEBUG] FFmpeg failed to make a collage. Skipping.");
                return { isUnsafe: false, detectedFlag: "nsfw" };
            }

            const scores = await sendToApi(new Blob([collage], { type: 'image/jpeg' }), 'collage.jpg');
            if (scores) {
                console.log(`[SCANNER DEBUG] Scores -> Porn: ${(scores.porn*100).toFixed(2)}% | Hentai: ${(scores.hentai*100).toFixed(2)}% | Sexy: ${(scores.sexy*100).toFixed(2)}% | Drawing: ${(scores.drawing*100).toFixed(2)}%`);
                
                const isHighDrawing = scores.drawing > 0.50 && s.nsfwMode === 'advanced';
                if (scores.porn > threshold || scores.hentai > threshold || scores.sexy > threshold || isHighDrawing) {
                    isUnsafe = true;
                    detectedFlag = isHighDrawing ? 'hentai' : (scores.hentai > scores.porn && scores.hentai > scores.sexy ? 'hentai' : 'nsfw');
                }
            }
        } else {
            const scores = await sendToApi(new Blob([buffer], { type: 'image/jpeg' }), 'image.jpg');
            if (scores) {
                console.log(`[SCANNER DEBUG] Scores -> Porn: ${(scores.porn*100).toFixed(2)}% | Hentai: ${(scores.hentai*100).toFixed(2)}% | Sexy: ${(scores.sexy*100).toFixed(2)}% | Drawing: ${(scores.drawing*100).toFixed(2)}%`);
                
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
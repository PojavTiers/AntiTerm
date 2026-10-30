const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Extracts a SINGLE high-quality frame from the middle of the video/gif
async function extractSingleFrame(videoBuffer, isGif = false) {
    const tempVideoPath = path.join(os.tmpdir(), `vid_${Date.now()}.${isGif ? 'gif' : 'mp4'}`);
    const outputPath = path.join(os.tmpdir(), `frame_${Date.now()}.jpg`);
    fs.writeFileSync(tempVideoPath, videoBuffer);

    try {
        let duration = 3; // default fallback
        try {
            const metadata = await new Promise((resolve, reject) => {
                ffmpeg.ffprobe(tempVideoPath, (err, data) => {
                    if (err) reject(err);
                    else resolve(data);
                });
            });
            if (metadata && metadata.format && metadata.format.duration) {
                duration = metadata.format.duration;
            }
        } catch (e) { }

        // Grab a frame exactly in the middle of the video
        const midpoint = duration / 2;

        await new Promise((resolve, reject) => {
            ffmpeg(tempVideoPath)
                .on('end', resolve)
                .on('error', reject)
                .inputOptions(['-ss', midpoint.toString()]) // Jump to midpoint
                .outputOptions([
                    '-frames:v', '1', // Grab exactly 1 frame
                    '-q:v', '2'       // High quality (keeps the details sharp)
                ])
                .save(outputPath);
        });
        
        return fs.readFileSync(outputPath);
    } catch (err) {
        console.error("Frame Extraction Error:", err);
        return null;
    } finally {
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
}

async function scanMedia(url, s, client) {
    let isUnsafe = false;
    let detectedFlag = "nsfw";

    // Sightengine is highly accurate. 80% threshold for Advanced mode.
    let threshold = 0.80; 
    if (s.nsfwMode === 'moderate') threshold = 0.90;
    else if (s.nsfwMode === 'basic') threshold = 0.95;
    else if (s.nsfwMode === 'custom') threshold = s.nsfwCustomThreshold || 0.8;

    const apiUser = process.env.SIGHTENGINE_USER;
    const apiSecret = process.env.SIGHTENGINE_SECRET;

    if (!apiUser || !apiSecret) {
        console.error("[SCANNER CRITICAL] Missing SIGHTENGINE_USER or SIGHTENGINE_SECRET.");
        return { isUnsafe: false, detectedFlag: "nsfw" };
    }

    try {
        let finalUrl = url;
        
        // Scrape Klipy/Tenor pages if necessary
        if (!finalUrl.match(/\.(jpeg|jpg|png|gif|mp4|webm|mov)/i) && !finalUrl.includes('cdn.discordapp.com')) {
            const webRes = await fetch(finalUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }); 
            const html = await webRes.text();
            const mediaMatch = html.match(/(https:\/\/[^"']+\.(?:gif|mp4|webm|mov))/i);
            if (mediaMatch) finalUrl = mediaMatch[0];
            else return { isUnsafe: false, detectedFlag: "nsfw" };
        }
        
        const isVideo = finalUrl.toLowerCase().includes('.mp4') || finalUrl.toLowerCase().includes('.webm') || finalUrl.toLowerCase().includes('.mov');
        const isGif = finalUrl.toLowerCase().includes('.gif');
        
        const imageResponse = await fetch(finalUrl);
        const contentType = imageResponse.headers.get('content-type');
        const imageBuffer = await imageResponse.arrayBuffer();
        const buffer = Buffer.from(imageBuffer);
        
        let imgBuffer = buffer;
        // Use the new high-quality single frame extraction
        if (isVideo || isGif) {
            const frameBuffer = await extractSingleFrame(buffer, isGif);
            if (!frameBuffer) return { isUnsafe: false, detectedFlag: "nsfw" };
            imgBuffer = frameBuffer;
        }

        const formData = new FormData(); 
        formData.append('media', new Blob([imgBuffer], { type: 'image/jpeg' }), 'image.jpg');
        formData.append('models', 'nudity-2.0'); 
        formData.append('api_user', apiUser);
        formData.append('api_secret', apiSecret);

        const apiRes = await fetch('https://api.sightengine.com/1.0/check.json', { 
            method: 'POST', 
            body: formData 
        });

        const rawText = await apiRes.text();
        console.log(`[SCANNER RAW RESPONSE]:`, rawText);
        
        const data = JSON.parse(rawText);
        
        if (data.status === 'failure') {
            console.error(`[SCANNER API ERROR]: ${data.error.message}`);
            return { isUnsafe: false, detectedFlag: "nsfw" };
        }

        if (data.nudity) {
            const n = data.nudity;
            const nsfwScore = Math.max(
                n.sexual_activity || 0, 
                n.sexual_display || 0, 
                n.erotica || 0
            );
            
            console.log(`[SCANNER DEBUG] NSFW Score: ${(nsfwScore * 100).toFixed(2)}% | Threshold: ${(threshold * 100).toFixed(2)}%`);
            
            if (nsfwScore > threshold) {
                isUnsafe = true;
                detectedFlag = "nsfw";
            }
        }

    } catch (err) { 
        console.error("[SCANNER ERROR]:", err); 
    }

    return { isUnsafe, detectedFlag };
}

module.exports = { scanMedia };
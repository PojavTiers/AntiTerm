const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Extracts 3 frames (Start, Middle, End) from the video/gif
async function extractVideoFrames(videoBuffer, isGif = false) {
    const ext = isGif ? 'gif' : 'mp4';
    const tempVideoPath = path.join(os.tmpdir(), `vid_${Date.now()}.${ext}`);
    fs.writeFileSync(tempVideoPath, videoBuffer);

    const frames = [];

    try {
        // 1. Get duration
        let duration = 6; 
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

        // 2. Calculate timestamps (Start = 0, Middle = duration/2, End = duration - 1)
        const timestamps = [
            0, 
            Math.floor(duration / 2), 
            Math.max(1, Math.floor(duration - 1))
        ];

        // 3. Extract each frame
        for (let i = 0; i < timestamps.length; i++) {
            const time = timestamps[i];
            const outputPath = path.join(os.tmpdir(), `frame_${Date.now()}_${i}.jpg`);
            
            await new Promise((resolve, reject) => {
                ffmpeg(tempVideoPath)
                    .on('end', resolve)
                    .on('error', reject)
                    .inputOptions(['-ss', time.toString()]) 
                    .outputOptions([
                        '-frames:v', '1', 
                        '-q:v', '2'       
                    ])
                    .save(outputPath);
            });

            if (fs.existsSync(outputPath)) {
                frames.push(fs.readFileSync(outputPath));
                fs.unlinkSync(outputPath);
            }
        }

        return frames;
    } catch (err) {
        console.error("Frame Extraction Error:", err);
        return [];
    } finally {
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
    }
}

async function scanMedia(url, s, client) {
    let isUnsafe = false;
    let detectedFlag = "nsfw";

    let threshold = 0.80; 
    if (s.nsfwMode === 'moderate') threshold = 0.90;
    else if (s.nsfwMode === 'basic') threshold = 0.95;
    else if (s.nsfwMode === 'custom') threshold = s.nsfwCustomThreshold || 0.8;

    const apiUser = process.env.SIGHTENGINE_USER;
    const apiSecret = process.env.SIGHTENGINE_SECRET;

    if (!apiUser || !apiSecret) return { isUnsafe: false, detectedFlag: "nsfw" };

    try {
        let finalUrl = url;
        
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
        
        let buffersToScan = [];

        if (isVideo || isGif) {
            console.log(`[SCANNER] Extracting Start, Middle, End frames...`);
            buffersToScan = await extractVideoFrames(buffer, isGif);
            if (buffersToScan.length === 0) return { isUnsafe: false, detectedFlag: "nsfw" };
        } else {
            buffersToScan = [buffer];
        }

        // Loop through all extracted frames and scan them
        for (let i = 0; i < buffersToScan.length; i++) {
            const imgBuffer = buffersToScan[i];

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
            const data = JSON.parse(rawText);
            
            if (data.status === 'failure') continue;

            if (data.nudity) {
                const n = data.nudity;
                
                const hardcoreScore = Math.max(n.sexual_activity || 0, n.sexual_display || 0);
                const suggestiveScore = Math.max(n.erotica || 0, n.suggestive || 0, n.suggestive_classes?.lingerie || 0);
                
                console.log(`[SCANNER DEBUG] Frame ${i+1}: Hardcore: ${(hardcoreScore * 100).toFixed(2)}% | Suggestive: ${(suggestiveScore * 100).toFixed(2)}%`);
                
                if (s.nsfwMode === 'advanced') {
                    if (hardcoreScore > 0.80 || suggestiveScore > 0.50) {
                        isUnsafe = true;
                        detectedFlag = "nsfw";
                        break; // Stop checking frames if one is bad
                    }
                } else {
                    if (hardcoreScore > threshold || suggestiveScore > threshold) {
                        isUnsafe = true;
                        detectedFlag = "nsfw";
                        break; 
                    }
                }
            }
        }

    } catch (err) { 
        console.error("[SCANNER ERROR]:", err); 
    }

    return { isUnsafe, detectedFlag };
}

module.exports = { scanMedia };
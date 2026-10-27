const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Parser for the exact JSON structure your API returns
function parseApiScores(data) {
    const scores = { porn: 0, hentai: 0, sexy: 0, drawing: 0, neutral: 0 };
    
    // The API returns the scores inside a "predictions" object
    if (data && data.predictions) {
        for (const key of Object.keys(data.predictions)) {
            const k = key.toLowerCase();
            if (scores[k] !== undefined) {
                scores[k] = parseFloat(data.predictions[key]);
            }
        }
    } 
    // Fallback just in case it returns an array
    else if (data && Array.isArray(data.prediction)) {
        for (const item of data.prediction) {
            const className = (item.className || item.label || '').toLowerCase();
            const prob = parseFloat(item.probability || 0);
            if (scores[className] !== undefined) scores[className] = prob;
        }
    }
    return scores;
}

function getTopFlag(scores) {
    if (!scores) return "nsfw";
    const flags = ['porn', 'hentai', 'sexy', 'drawing'];
    let highest = "nsfw";
    let maxScore = 0;
    for (const flag of flags) {
        if (scores[flag] && scores[flag] > maxScore) {
            maxScore = scores[flag];
            highest = flag;
        }
    }
    if (highest === 'drawing') return 'hentai'; 
    return highest;
}

// SMART COLLAGE: Grabs 3 frames from Start, Middle, and End based on video length
async function createVideoCollage(videoBuffer, isGif = false) {
    const ext = isGif ? 'gif' : 'mp4'; 
    const tempVideoPath = path.join(os.tmpdir(), `vid_${Date.now()}.${ext}`);
    const outputPath = path.join(os.tmpdir(), `collage_${Date.now()}.jpg`);
    fs.writeFileSync(tempVideoPath, videoBuffer);

    try {
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

        const start = 0;
        const middle = Math.max(2, Math.floor(duration / 2)); 
        const end = Math.max(4, Math.floor(duration - 2)); 

        await new Promise((resolve, reject) => {
            ffmpeg(tempVideoPath)
                .on('end', resolve)
                .on('error', reject)
                .outputOptions([
                    '-vf', `select='eq(n\\,${start*30})+eq(n\\,${middle*30})+eq(n\\,${end*30})',scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2:color=black,tile=3x3`,
                    '-frames:v', '1',
                    '-q:v', '4'
                ])
                .save(outputPath);
        });
        return fs.readFileSync(outputPath);
    } catch (err) {
        console.error("[COLLAGE ERROR]:", err);
        return null;
    } finally {
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
}

async function scanMedia(url, s, client) {
    let isUnsafe = false;
    let detectedFlag = "nsfw";
    let mediaUrls = [url]; 

    const threshold = s.nsfwMode === 'advanced' ? 0.10 : (s.nsfwMode === 'moderate' ? 0.50 : 0.70);

    let apiUrl = process.env.NSFW_API_URL;
    if (!apiUrl) return { isUnsafe: false, detectedFlag: "nsfw" };
    if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
        apiUrl = 'https://' + apiUrl;
    }

    for (let mediaUrl of mediaUrls) {
        if (isUnsafe) break;
        try {
            let finalUrl = mediaUrl;
            
            if (!finalUrl.match(/\.(jpeg|jpg|png|gif|mp4|webm|mov)/i) && !finalUrl.includes('cdn.discordapp.com')) {
                const webRes = await fetch(finalUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }); 
                const html = await webRes.text();
                const mediaMatch = html.match(/(https:\/\/[^"']+\.(?:gif|mp4|webm|mov))/i);
                
                if (mediaMatch) {
                    finalUrl = mediaMatch[0];
                } else {
                    continue;
                }
            }
            
            const isVideo = finalUrl.toLowerCase().includes('.mp4') || finalUrl.toLowerCase().includes('.webm') || finalUrl.toLowerCase().includes('.mov');
            const isGif = finalUrl.toLowerCase().includes('.gif');
            
            const imageResponse = await fetch(finalUrl);
            const contentType = imageResponse.headers.get('content-type');
            const imageBuffer = await imageResponse.arrayBuffer();
            const buffer = Buffer.from(imageBuffer);
            
            if (isVideo || isGif) {
                const collageBuffer = await createVideoCollage(buffer, isGif);
                
                if (collageBuffer) {
                    const formData = new FormData(); 
                    formData.append('image', new Blob([collageBuffer], { type: 'image/jpeg' }), 'collage.jpg');
                    
                    const apiRes = await fetch(apiUrl + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
                    const rawText = await apiRes.text();
                    console.log(`[SCANNER RAW RESPONSE]:`, rawText);
                    
                    const data = JSON.parse(rawText);
                    const scores = parseApiScores(data);
                    
                    console.log(`[SCANNER DEBUG] Porn: ${(scores.porn*100).toFixed(2)}% | Hentai: ${(scores.hentai*100).toFixed(2)}% | Sexy: ${(scores.sexy*100).toFixed(2)}% | Drawing: ${(scores.drawing*100).toFixed(2)}%`);

                    // NUCLEAR OPTION: If it's highly confident it's an anime drawing in Advanced mode, flag it.
                    const isHighDrawing = scores.drawing > 0.80 && s.nsfwMode === 'advanced';

                    if (data.safe === false || (scores.nsfw > threshold || scores.sexy > threshold || scores.hentai > threshold || scores.porn > threshold) || isHighDrawing) { 
                        isUnsafe = true; 
                        detectedFlag = isHighDrawing ? 'hentai' : getTopFlag(scores); 
                        console.log(`[SCANNER DEBUG] FLAGGED AS NSFW! Flag: ${detectedFlag}`);
                    }
                }
            } else {
                const blob = new Blob([imageBuffer], { type: contentType || 'image/jpeg' }); 
                const formData = new FormData(); 
                formData.append('image', blob, 'image.jpg');
                
                const response = await fetch(apiUrl + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
                const rawText = await response.text();
                console.log(`[SCANNER RAW RESPONSE]:`, rawText);
                
                const data = JSON.parse(rawText);
                const scores = parseApiScores(data);

                console.log(`[SCANNER DEBUG] Porn: ${(scores.porn*100).toFixed(2)}% | Hentai: ${(scores.hentai*100).toFixed(2)}% | Sexy: ${(scores.sexy*100).toFixed(2)}% | Drawing: ${(scores.drawing*100).toFixed(2)}%`);

                const isHighDrawing = scores.drawing > 0.80 && s.nsfwMode === 'advanced';

                if (data.safe === false || (scores.nsfw > threshold || scores.sexy > threshold || scores.hentai > threshold || scores.porn > threshold) || isHighDrawing) { 
                    isUnsafe = true; 
                    detectedFlag = isHighDrawing ? 'hentai' : getTopFlag(scores); 
                    console.log(`[SCANNER DEBUG] FLAGGED AS NSFW! Flag: ${detectedFlag}`);
                }
            }
        } catch (err) { console.error("[SCANNER ERROR]:", err); }
    }

    return { isUnsafe, detectedFlag };
}

module.exports = { scanMedia };
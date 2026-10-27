const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');

function parseApiScores(data) {
    const scores = { porn: 0, hentai: 0, sexy: 0, drawing: 0, neutral: 0 };
    if (data && data.predictions) {
        for (const key of Object.keys(data.predictions)) {
            const k = key.toLowerCase();
            if (scores[k] !== undefined) {
                scores[k] = parseFloat(data.predictions[key]);
            }
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
        return null;
    } finally {
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
}

async function scanMedia(url, s, client) {
    let isUnsafe = false;
    let detectedFlag = "nsfw";
    
    // NEW: Handle Custom Threshold
    let threshold = 0.50;
    if (s.nsfwMode === 'advanced') threshold = 0.10;
    else if (s.nsfwMode === 'moderate') threshold = 0.50;
    else if (s.nsfwMode === 'basic') threshold = 0.70;
    else if (s.nsfwMode === 'custom') threshold = s.nsfwCustomThreshold || 0.5;

    let apiUrl = process.env.NSFW_API_URL;
    if (!apiUrl) return { isUnsafe: false, detectedFlag: "nsfw" };
    if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) apiUrl = 'https://' + apiUrl;

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
        const buffer = Buffer.from(await imageResponse.arrayBuffer());
        
        let imgBuffer = buffer;
        if (isVideo || isGif) {
            const collage = await createVideoCollage(buffer, isGif);
            if (!collage) return { isUnsafe: false, detectedFlag: "nsfw" };
            imgBuffer = collage;
        }

        const formData = new FormData(); 
        formData.append('image', new Blob([imgBuffer], { type: 'image/jpeg' }), 'image.jpg');
        const apiRes = await fetch(apiUrl + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
        const rawText = await apiRes.text();
        console.log(`[SCANNER RAW RESPONSE]:`, rawText);
        
        const data = JSON.parse(rawText);
        const scores = parseApiScores(data);
        
        console.log(`[SCANNER DEBUG] Threshold: ${threshold} | Porn: ${(scores.porn*100).toFixed(2)}% | Hentai: ${(scores.hentai*100).toFixed(2)}% | Sexy: ${(scores.sexy*100).toFixed(2)}% | Drawing: ${(scores.drawing*100).toFixed(2)}%`);

        const isHighDrawing = scores.drawing > 0.80 && s.nsfwMode === 'advanced';

        if (data.safe === false || (scores.porn > threshold || scores.sexy > threshold || scores.hentai > threshold) || isHighDrawing) { 
            isUnsafe = true; 
            detectedFlag = isHighDrawing ? 'hentai' : getTopFlag(scores); 
        }
    } catch (err) { console.error("[SCANNER ERROR]:", err); }

    return { isUnsafe, detectedFlag };
}

module.exports = { scanMedia };
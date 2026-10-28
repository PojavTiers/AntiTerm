const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');

function getTopFlag(scores) {
    if (!scores) return "nsfw";
    const flags = ['porn', 'hentai', 'sexy', 'nsfw'];
    let highest = "nsfw";
    let maxScore = 0;
    for (const flag of flags) {
        if (scores[flag] && scores[flag] > maxScore) {
            maxScore = scores[flag];
            highest = flag;
        }
    }
    return highest;
}

async function createVideoCollage(videoBuffer, isGif = false) {
    const tempVideoPath = path.join(os.tmpdir(), `vid_${Date.now()}.${isGif ? 'gif' : 'mp4'}`);
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
        console.error("Collage Error:", err);
        return null;
    } finally {
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
}

async function scanMedia(url, s, client) {
    let isUnsafe = false;
    let detectedFlag = "nsfw";

    // SAFE & STRICT THRESHOLDS
    // Advanced: 0.50 (50%) - Only delete if it's more likely NSFW than not.
    // Moderate: 0.75 (75%)
    // Basic: 0.90 (90%)
    let threshold = 0.90; 
    if (s.nsfwMode === 'advanced') threshold = 0.50; 
    else if (s.nsfwMode === 'moderate') threshold = 0.75;
    else if (s.nsfwMode === 'custom') threshold = s.nsfwCustomThreshold || 0.5;

    let apiUrl = process.env.NSFW_API_URL;
    if (!apiUrl) return { isUnsafe: false, detectedFlag: "nsfw" };
    if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
        apiUrl = 'https://' + apiUrl;
    }

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
        
        if (isVideo || isGif) {
            const collageBuffer = await createVideoCollage(buffer, isGif);
            if (collageBuffer) {
                const formData = new FormData(); 
                formData.append('image', new Blob([collageBuffer], { type: 'image/jpeg' }), 'collage.jpg');
                const apiRes = await fetch(apiUrl + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
                const rawText = await apiRes.text();
                console.log(`[SCANNER RAW RESPONSE]:`, rawText);
                
                const data = JSON.parse(rawText);
                const scores = data.predictions || data.scores || {};
                
                // ONLY DELETE IF EXPLICITLY HIGH
                if (data.safe === false || (scores.porn > threshold || scores.sexy > threshold || scores.hentai > threshold || (scores.Porn && scores.Porn > threshold) || (scores.Sexy && scores.Sexy > threshold))) { 
                    isUnsafe = true; 
                    detectedFlag = getTopFlag(scores); 
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
            const scores = data.predictions || data.scores || {};
            
            // ONLY DELETE IF EXPLICITLY HIGH
            if (data.safe === false || (data.flags && data.flags.length > 0) || (scores.porn > threshold || scores.sexy > threshold || scores.hentai > threshold || (scores.Porn && scores.Porn > threshold) || (scores.Sexy && scores.Sexy > threshold))) { 
                isUnsafe = true; 
                detectedFlag = getTopFlag(scores); 
            }
        }
    } catch (err) { 
        console.error("[SCANNER ERROR]:", err); 
    }

    return { isUnsafe, detectedFlag };
}

module.exports = { scanMedia };
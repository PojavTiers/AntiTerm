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
    let mediaUrls = [url]; // We just scan the URL passed to us

    // Exact threshold from your old code
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
            
            // EXACT LOGIC FROM OLD CODE: Scrape the page for the direct mp4/gif link
            if (!finalUrl.match(/\.(jpeg|jpg|png|gif|mp4|webm)/i) && !finalUrl.includes('cdn.discordapp.com')) {
                console.log(`[SCANNER] Scraping link: ${finalUrl}`);
                const webRes = await fetch(finalUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }); 
                const html = await webRes.text();
                const mediaMatch = html.match(/(https:\/\/[^"']+\.(?:gif|mp4|webm))/i);
                
                if (mediaMatch) {
                    finalUrl = mediaMatch[0];
                    console.log(`[SCANNER] Found direct media: ${finalUrl}`);
                } else {
                    console.log(`[SCANNER] Could not find media in HTML.`);
                    continue;
                }
            }
            
            const isVideo = finalUrl.toLowerCase().includes('.mp4') || finalUrl.toLowerCase().includes('.webm');
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
                    
                    console.log(`[SCANNER] Sending collage to API...`);
                    const apiRes = await fetch(apiUrl + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
                    const rawText = await apiRes.text();
                    console.log(`[SCANNER RAW RESPONSE]:`, rawText);
                    
                    const data = JSON.parse(rawText);
                    if (data.safe === false || (data.scores && (data.scores.nsfw > threshold || data.scores.sexy > threshold || data.scores.hentai > threshold || data.scores.porn > threshold))) { 
                        isUnsafe = true; 
                        detectedFlag = getTopFlag(data.scores); 
                    }
                }
            } else {
                const blob = new Blob([imageBuffer], { type: contentType || 'image/jpeg' }); 
                const formData = new FormData(); 
                formData.append('image', blob, 'image.jpg');
                
                console.log(`[SCANNER] Sending image to API...`);
                const response = await fetch(apiUrl + '/classify', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }, body: formData });
                const rawText = await response.text();
                console.log(`[SCANNER RAW RESPONSE]:`, rawText);
                
                const data = JSON.parse(rawText);
                if (data.safe === false || (data.flags && data.flags.length > 0) || (data.scores && ((data.scores.nsfw > threshold) || (data.scores.sexy > threshold) || (data.scores.hentai > threshold) || (data.scores.porn > threshold)))) { 
                    isUnsafe = true; 
                    detectedFlag = getTopFlag(data.scores); 
                }
            }
        } catch (err) { console.error("[SCANNER ERROR]:", err); }
    }

    return { isUnsafe, detectedFlag };
}

module.exports = { scanMedia };
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');

const PORT = 8000;
const PUBLIC_DIR = __dirname;

// MIME type mapping for static files
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

let queueToHub = [];
let queueToApp = [];
let queueToMeet = [];
let activeMeetProcess = null;

function getAccessToken(callback) {
    exec('gcloud auth application-default print-access-token', (err, stdout, stderr) => {
        if (err) {
            console.error("[TTS Server Error] Failed to get OAuth token:", err);
            callback(null);
            return;
        }
        callback(stdout.trim());
    });
}

function callGoogleCloudTTS(text, token, callback) {
    const postData = JSON.stringify({
        input: { text: text },
        voice: {
            languageCode: 'en-US',
            name: 'en-US-Chirp3-HD-Achernar'
        },
        audioConfig: {
            audioEncoding: 'LINEAR16',
            sampleRateHertz: 22050
        }
    });

    const options = {
        hostname: 'texttospeech.googleapis.com',
        port: 443,
        path: '/v1/text:synthesize',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            if (res.statusCode !== 200) {
                console.error("[GCloud TTS Error] API returned status code:", res.statusCode, body);
                callback(null);
                return;
            }
            try {
                const responseData = JSON.parse(body);
                const audioContent = responseData.audioContent;
                if (audioContent) {
                    const audioBuffer = Buffer.from(audioContent, 'base64');
                    callback(audioBuffer);
                } else {
                    console.error("[GCloud TTS Error] Response missing audioContent");
                    callback(null);
                }
            } catch (e) {
                console.error("[GCloud TTS Error] Failed to parse API response JSON:", e);
                callback(null);
            }
        });
    });

    req.on('error', (e) => {
        console.error("[GCloud TTS Error] HTTPS request failed:", e);
        callback(null);
    });

    req.write(postData);
    req.end();
}

function fallbackToMacSay(text, res) {
    console.log("[TTS API Fallback] Using macOS native say command...");
    const timestamp = Date.now();
    const aiffPath = path.join('/tmp', `speech_${timestamp}.aiff`);
    const wavPath = path.join('/tmp', `speech_${timestamp}.wav`);

    // Run macOS say command
    execFile('/usr/bin/say', ['-o', aiffPath, text], (err, stdout, stderr) => {
        if (err) {
            console.error('[TTS API Error] say command failed:', err, 'Stderr:', stderr);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Failed to generate speech');
            return;
        }

        // Convert AIFF to WAV
        execFile('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', aiffPath, wavPath], (err2) => {
            // Clean up AIFF file
            fs.unlink(aiffPath, () => {});

            if (err2) {
                console.error('[TTS API Error] afconvert failed:', err2);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Failed to convert speech');
                return;
            }

            // Serve the WAV file
            const stream = fs.createReadStream(wavPath);
            stream.on('error', (streamErr) => {
                console.error('[TTS Server Error] Read stream failed:', streamErr.message);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('File read error');
                }
            });
            res.writeHead(200, { 'Content-Type': 'audio/wav' });
            stream.pipe(res);

            // Clean up WAV file after sending
            res.on('finish', () => {
                fs.unlink(wavPath, () => {});
            });
        });
    });
}

function cleanupStaleMeetProcess(callback) {
    console.log("[Luna 2.0 Server] Cleaning up stale Chrome bot processes...");
    if (activeMeetProcess) {
        try {
            activeMeetProcess.kill('SIGKILL');
        } catch (e) {}
        activeMeetProcess = null;
    }
    // Cleanly kill any orphaned Chrome instances using our clean profile path
    exec('/usr/bin/pkill -f LunaMeetProfile; /usr/bin/pkill -f luna_cdp_agent.py; /usr/bin/pkill -f luna_brain.py', (err, stdout, stderr) => {
        if (err) {
            console.log(`[Luna 2.0 Server] pkill exited with code/error: ${err.message}`);
        } else {
            console.log(`[Luna 2.0 Server] pkill succeeded`);
        }
        if (stderr) {
            console.log(`[Luna 2.0 Server] pkill stderr: ${stderr}`);
        }
        // Wait 500ms to let OS release sockets
        setTimeout(callback, 500);
    });
}

const server = http.createServer((req, res) => {
    // Enable CORS for development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // API Endpoint to spawn actual Google Meet bot
    if (req.method === 'POST' && req.url === '/api/join-meet') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const meetUrl = data.url;

                if (!meetUrl) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Google Meet URL is required' }));
                    return;
                }

                // SECURITY: Strictly validate the meet URL to prevent shell injection attacks
                // Expected format: https://meet.google.com/abc-defg-hij
                const meetRegex = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
                if (!meetRegex.test(meetUrl)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid Google Meet URL format. Must match https://meet.google.com/abc-defg-hij' }));
                    return;
                }

                console.log(`[Luna 2.0 API] Request received to join actual Google Meet: ${meetUrl}`);
                
                cleanupStaleMeetProcess(() => {
                    const scriptPath = path.join(PUBLIC_DIR, 'run_luna_meet.sh');
                    
                    activeMeetProcess = execFile(scriptPath, [meetUrl], (error, stdout, stderr) => {
                        if (error) {
                            console.error(`[Luna 2.0 API Error] Failed to launch Meet script: ${error.message}`);
                        }
                        if (stdout) console.log(`[Luna 2.0 Bot] ${stdout}`);
                        if (stderr) console.error(`[Luna 2.0 Bot Error] ${stderr}`);
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Luna 2.0 launcher script triggered' }));
                });

            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to process request: ' + err.message }));
            }
        });
        return;
    }



    // API Endpoint to receive logs from the extension
    if (req.method === 'POST' && req.url === '/api/log') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                console.log(`[Browser Log] ${data.message}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error');
            }
        });
        return;
    }

    // API Endpoint to generate TTS speech
    if (req.method === 'GET' && req.url.startsWith('/api/tts')) {
        const urlParams = new URL(req.url, 'http://localhost:8000');
        const text = urlParams.searchParams.get('text');
        if (!text) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Text parameter is required');
            return;
        }

        getAccessToken((token) => {
            if (token) {
                callGoogleCloudTTS(text, token, (audioBuffer) => {
                    if (audioBuffer) {
                        console.log("[TTS API] Successfully generated Chirp3 HD voice (Achernar) for:", text);
                        res.writeHead(200, { 'Content-Type': 'audio/wav' });
                        res.end(audioBuffer);
                        return;
                    }
                    fallbackToMacSay(text, res);
                });
            } else {
                fallbackToMacSay(text, res);
            }
        });
        return;
    }


    // Event Reflector Endpoints
    if (req.method === 'POST' && req.url === '/api/events/to-hub') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const event = JSON.parse(body);
                console.log("[Server Reflector] Received event to-hub:", JSON.stringify(event));
                queueToHub.push(event);
                queueToApp.push(event);
                
                // Server-side orchestration brain
                handleServerOrchestration(event);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400);
                res.end('Invalid JSON');
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/events/to-meet') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const event = JSON.parse(body);
                console.log("[Server Reflector] Received event to-meet:", JSON.stringify(event));
                queueToMeet.push(event);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400);
                res.end('Invalid JSON');
            }
        });
        return;
    }

    if (req.method === 'GET' && req.url === '/api/events/poll-hub') {
        const events = queueToHub;
        queueToHub = [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(events));
        return;
    }

    if (req.method === 'GET' && req.url === '/api/events/poll-app') {
        const events = queueToApp;
        queueToApp = [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(events));
        return;
    }

    if (req.method === 'GET' && req.url === '/api/events/poll-meet') {
        const events = queueToMeet;
        queueToMeet = [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(events));
        return;
    }


    // Static Files Server routing
    let target = req.url;
    if (target === '/') target = 'connect.html';
    else if (target === '/connect' || target === '/join') target = 'connect.html';
    let filePath = path.join(PUBLIC_DIR, target);
    
    // Security check: Prevent directory traversal outside web root
    const relative = path.relative(PUBLIC_DIR, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    const extname = path.extname(filePath);
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

function handleServerOrchestration(event) {
    if (!event) return;
    
    if (event.type === 'MEET_CAPTION' || event.type === 'MEET_CHAT') {
        const text = event.text;
        const sender = event.sender;
        const normalized = text.toLowerCase();
        
        // Don't respond to ourselves
        if (sender === 'luna' || sender === 'Luna 2.0') return;
        
        const isMention = normalized.includes('luna');
        const isChat = event.type === 'MEET_CHAT';
        
        if (isChat || isMention) {
            console.log(`[Server Orchestration] Triggered by ${event.type} from ${sender}: "${text}"`);
            
            const firstName = sender ? sender.split(' ')[0] : 'there';
            
            if (normalized.includes('build calculator') || normalized.includes('create calculator')) {
                // Set state to thinking
                queueToMeet.push({ state: 'thinking' });
                setTimeout(() => {
                    const reply = `Certainly, ${firstName}! Creating a Calculator prototype in your Sandbox window.`;
                    queueToHub.push({ type: 'SANDBOX_ACTION', template: 'calculator' });
                    
                    console.log(`[Server Orchestration] Generated reply: "${reply}"`);
                    
                    // Dispatch response actions to Google Meet
                    queueToMeet.push({ state: 'speaking' });
                    queueToMeet.push({ text: reply });
                    
                    // Mirror the interaction in the Hub chat history log
                    queueToHub.push({ type: 'MEET_CHAT_MIRROR', sender: 'user', text: `[Sandbox Command: ${sender}] ${text}` });
                    queueToHub.push({ type: 'MEET_CHAT_MIRROR', sender: 'luna', text: reply });
                    
                    setTimeout(() => {
                        queueToMeet.push({ state: 'idle' });
                    }, 4000);
                }, 1200);
            } else if (normalized.includes('build landing') || normalized.includes('create website')) {
                // Set state to thinking
                queueToMeet.push({ state: 'thinking' });
                setTimeout(() => {
                    const reply = `Sure thing, ${firstName}! I have generated a landing page layout in your Sandbox.`;
                    queueToHub.push({ type: 'SANDBOX_ACTION', template: 'landing' });
                    
                    console.log(`[Server Orchestration] Generated reply: "${reply}"`);
                    
                    // Dispatch response actions to Google Meet
                    queueToMeet.push({ state: 'speaking' });
                    queueToMeet.push({ text: reply });
                    
                    // Mirror the interaction in the Hub chat history log
                    queueToHub.push({ type: 'MEET_CHAT_MIRROR', sender: 'user', text: `[Sandbox Command: ${sender}] ${text}` });
                    queueToHub.push({ type: 'MEET_CHAT_MIRROR', sender: 'luna', text: reply });
                    
                    setTimeout(() => {
                        queueToMeet.push({ state: 'idle' });
                    }, 4000);
                }, 1200);
            } else {
                console.log(`[Server Orchestration] Delegating response generation to external brain (luna_brain.py)...`);
            }
        }
    }
}

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Luna 2.0 Server] Running at http://127.0.0.1:${PORT}`);
});

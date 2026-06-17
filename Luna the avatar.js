// ==========================================
// Luna 2.0 Google Meet Console Injector Script
// Paste this entire file into the Chrome Developer Tools Console in Google Meet.
// Make sure to allow Insecure Content on meet.google.com in Chrome Site Settings:
// Click Site Settings -> Insecure Content -> Allow (to authorize local HTTP calls).
// ==========================================

(function() {
    console.log("[Luna 2.0 Console] Injecting console controller...");

    const SERVER_URL = 'https://127.0.0.1:8000';

    // Helper to send logs to local Node server console
    function serverLog(msg) {
        console.log("[Luna 2.0]", msg);
        fetch(`${SERVER_URL}/api/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg })
        }).catch(() => {});
    }

    // Helper to convert Uint8Array to base64 (since btoa/FileReader aren't needed)
    function uint8ToBase64(uint8) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let base64 = '';
        const len = uint8.length;
        for (let i = 0; i < len; i += 3) {
            const b1 = uint8[i];
            const b2 = i + 1 < len ? uint8[i + 1] : 0;
            const b3 = i + 2 < len ? uint8[i + 2] : 0;
            
            base64 += chars[b1 >> 2];
            base64 += chars[((b1 & 3) << 4) | (b2 >> 4)];
            base64 += i + 1 < len ? chars[((b2 & 15) << 2) | (b3 >> 6)] : '=';
            base64 += i + 2 < len ? chars[b3 & 63] : '=';
        }
        return base64;
    }

    // Embed AgentOrb rendering logic
    class AgentOrb {
        constructor(canvas) {
            this._canvas = canvas;
            this.ctx = this._canvas.getContext('2d');
            
            this.state = 'idle';
            this.time = 0;
            this.baseRadius = 60;
            this.targetRadius = 60;
            this.particles = [];
            this.pulseAmplitude = 0;
            
            this.colors = {
                idle: ['rgba(99, 102, 241, 0.45)', 'rgba(217, 70, 239, 0.35)', 'rgba(6, 182, 212, 0.25)'],
                listening: ['rgba(6, 182, 212, 0.65)', 'rgba(99, 102, 241, 0.45)', 'rgba(16, 185, 129, 0.3)'],
                thinking: ['rgba(217, 70, 239, 0.6)', 'rgba(99, 102, 241, 0.45)', 'rgba(6, 182, 212, 0.35)'],
                speaking: ['rgba(16, 185, 129, 0.6)', 'rgba(6, 182, 212, 0.45)', 'rgba(99, 102, 241, 0.35)']
            };
            
            this.width = canvas.width;
            this.height = canvas.height;
            this.initParticles();
            this.animate();
        }
        
        setState(state) {
            if (this.state === state) return;
            this.state = state;
            if (state === 'thinking') this.targetRadius = 50;
            else if (state === 'listening') this.targetRadius = 65;
            else if (state === 'speaking') this.targetRadius = 62;
            else this.targetRadius = 60;
        }
        
        initParticles() {
            this.particles = [];
            for (let i = 0; i < 30; i++) {
                this.particles.push({
                    angle: Math.random() * Math.PI * 2,
                    speed: 0.02 + Math.random() * 0.04,
                    distance: 50 + Math.random() * 40,
                    targetDistance: 50 + Math.random() * 40,
                    size: 1 + Math.random() * 2,
                    color: Math.random() > 0.5 ? 'magenta' : 'cyan',
                    opacity: 0.2 + Math.random() * 0.6
                });
            }
        }
        
        animate() {
            this.ctx.clearRect(0, 0, this.width, this.height);
            this.time += 0.05;
            this.baseRadius += (this.targetRadius - this.baseRadius) * 0.1;
            
            const cx = this.width / 2;
            const cy = this.height / 2;
            
            if (this.state === 'speaking') {
                this.pulseAmplitude = 10 + Math.sin(this.time * 0.5) * 8;
            } else if (this.state === 'listening') {
                this.pulseAmplitude = 4 + Math.sin(this.time * 0.2) * 3;
            } else {
                this.pulseAmplitude = 0;
            }
            
            if (this.state === 'thinking') {
                this.drawThinkingState(cx, cy);
            } else {
                this.drawLiquidBlob(cx, cy);
            }
            requestAnimationFrame(() => this.animate());
        }
        
        drawLiquidBlob(cx, cy) {
            const ctx = this.ctx;
            const stateColors = this.colors[this.state] || this.colors.idle;
            for (let layer = 0; layer < 3; layer++) {
                ctx.beginPath();
                const numPoints = 80;
                const points = [];
                const layerScale = 1 - layer * 0.12;
                const timeOffset = layer * 3.5;
                for (let i = 0; i < numPoints; i++) {
                    const angle = (i / numPoints) * Math.PI * 2;
                    let displacement = 0;
                    if (this.state === 'idle') {
                        displacement = Math.sin(angle * 3 + this.time * 0.8 + timeOffset) * 4;
                    } else {
                        displacement = Math.sin(angle * 6 + this.time * 1.5 + timeOffset) * this.pulseAmplitude;
                    }
                    const r = (this.baseRadius + displacement) * layerScale;
                    const x = cx + Math.cos(angle) * r;
                    const y = cy + Math.sin(angle) * r;
                    points.push({ x, y });
                }
                ctx.moveTo(points[0].x, points[0].y);
                for (let i = 0; i < points.length; i++) {
                    const p0 = points[i];
                    const p1 = points[(i + 1) % points.length];
                    const xc = (p0.x + p1.x) / 2;
                    const yc = (p0.y + p1.y) / 2;
                    ctx.quadraticCurveTo(p0.x, p0.y, xc, yc);
                }
                ctx.closePath();
                const gradient = ctx.createRadialGradient(cx, cy, 5, cx, cy, this.baseRadius * layerScale);
                gradient.addColorStop(0, 'rgba(255,255,255,0.02)');
                gradient.addColorStop(0.5, stateColors[layer]);
                gradient.addColorStop(1, 'transparent');
                ctx.fillStyle = gradient;
                ctx.fill();
            }
        }
        
        drawThinkingState(cx, cy) {
            const ctx = this.ctx;
            const gradient = ctx.createRadialGradient(cx, cy, 2, cx, cy, this.baseRadius * 0.7);
            gradient.addColorStop(0, '#fff');
            gradient.addColorStop(0.5, 'rgba(217, 70, 239, 0.4)');
            gradient.addColorStop(1, 'transparent');
            ctx.beginPath();
            ctx.arc(cx, cy, this.baseRadius * 0.7, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();
            this.particles.forEach(p => {
                p.angle += p.speed;
                const px = cx + Math.cos(p.angle) * p.distance;
                const py = cy + Math.sin(p.angle) * p.distance;
                ctx.beginPath();
                ctx.arc(px, py, p.size, 0, Math.PI * 2);
                ctx.fillStyle = p.color === 'magenta' ? 'rgba(217, 70, 239, 0.6)' : 'rgba(6, 182, 212, 0.6)';
                ctx.fill();
            });
        }
    }

    // 2. Intercept audio/video track setup
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioDest = audioCtx.createMediaStreamDestination();

    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const orb = new AgentOrb(canvas);
    const canvasStream = canvas.captureStream(30);

    // Override getUserMedia to return our custom virtual streams
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function(constraints) {
        serverLog("Console Interceptor hooked getUserMedia request: " + JSON.stringify(constraints));
        
        const realStream = await originalGetUserMedia(constraints);
        const videoTrack = canvasStream.getVideoTracks()[0];
        const audioTrack = audioDest.stream.getAudioTracks()[0];
        
        const virtualStream = new MediaStream([videoTrack, audioTrack]);
        
        // Return custom stream mimicking camera and microphone outputs
        return virtualStream;
    };

    // 3. Play Luna Voice data stream into WebRTC audio destination
    function playLunaVoiceFromDataUrl(dataUrl) {
        serverLog("[Audio] Playing synthetic voice from Data URL");
        
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const audio = new Audio();
        audio.crossOrigin = "anonymous";
        audio.src = dataUrl;
        
        const source = audioCtx.createMediaElementSource(audio);
        source.connect(audioDest);
        source.connect(audioCtx.destination);
        
        audio.play().catch(err => {
            console.error("[Audio Error] Failed to play voice stream:", err.message);
        });

        orb.setState('speaking');
        audio.onended = () => {
            orb.setState('idle');
        };
    }

    // Fetch TTS WAV binary and play it
    function fetchAndPlayTts(text) {
        orb.setState('thinking');
        const ttsUrl = `${SERVER_URL}/api/tts?text=${encodeURIComponent(text)}`;
        serverLog("[Audio] Requesting TTS generation: " + text);

        fetch(ttsUrl)
            .then(res => {
                if (!res.ok) throw new Error("TTS generation failed");
                return res.arrayBuffer();
            })
            .then(arrayBuffer => {
                const uint8 = new Uint8Array(arrayBuffer);
                const base64 = uint8ToBase64(uint8);
                const dataUrl = `data:audio/wav;base64,${base64}`;
                playLunaVoiceFromDataUrl(dataUrl);
            })
            .catch(err => {
                serverLog("[Audio Error] Reflector TTS fallback triggered: " + err.message);
                orb.setState('idle');
            });
    }

    // 4. Capture Meet Live Captions and forward to Luna Hub
    let captionsObserver = null;
    let speakerBuffers = {};

    function setupCaptionsObserver() {
        const container = document.querySelector('[role="region"][aria-label*="caption" i]') || 
                          document.querySelector('[role="region"][aria-label*="subtitle" i]') || 
                          document.querySelector('[jsname="dsyhDe"]');
        if (!container || captionsObserver) return;

        serverLog("Live Captions container detected. Attaching MutationObserver.");

        captionsObserver = new MutationObserver((mutations) => {
            const blocks = container.querySelectorAll('[jsname="c12oMc"]') || 
                           container.querySelectorAll('.Kc212b') ||
                           Array.from(container.children);
                           
            blocks.forEach(block => {
                const speakerName = block.querySelector('.NWpY1d')?.textContent?.trim() || 
                                    block.querySelector('[jsname="wP3x1"]')?.textContent?.trim() || 
                                    '';
                                    
                if (!speakerName || speakerName === 'Luna 2.0') return;

                const textEls = block.querySelectorAll('.ygicle.VbkSUe') || 
                                block.querySelectorAll('.iTTPOb');
                let fullText = "";
                textEls.forEach(el => {
                    fullText += el.textContent + " ";
                });
                fullText = fullText.trim();

                if (!fullText) return;

                if (!speakerBuffers[speakerName]) {
                    speakerBuffers[speakerName] = { text: "", timer: null };
                }

                const buffer = speakerBuffers[speakerName];
                if (fullText !== buffer.text) {
                    buffer.text = fullText;
                    if (buffer.timer) clearTimeout(buffer.timer);
                    
                    buffer.timer = setTimeout(() => {
                        const finishedText = buffer.text;
                        serverLog(`[Captions] ${speakerName} finished speaking: ${finishedText}`);
                        
                        // POST to server events queue to notify companion Hub
                        fetch(`${SERVER_URL}/api/events/to-hub`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                type: 'MEET_CHAT',
                                sender: speakerName,
                                text: finishedText
                            })
                        }).catch(() => {});
                        
                        buffer.text = "";
                    }, 1800);
                }
            });
        });

        captionsObserver.observe(container, { childList: true, subtree: true, characterData: true });
    }

    // 5. Poll server for incoming speech commands from companion Hub dashboard
    setInterval(() => {
        fetch(`${SERVER_URL}/api/events/poll-meet`)
            .then(res => res.json())
            .then(events => {
                events.forEach(event => {
                    serverLog("[Event Poller] Received event: " + JSON.stringify(event));
                    
                    // State Sync Events
                    if (event.state) {
                        orb.setState(event.state);
                    }
                    
                    // Speech Trigger Events
                    if (event.text) {
                        fetchAndPlayTts(event.text);
                    }
                });
            })
            .catch(() => {});
    }, 800);

    // Auto-enable captions loop
    setInterval(() => {
        const ccBtn = document.querySelector('button[aria-label*="captions" i]') || 
                      document.querySelector('button[data-tooltip*="captions" i]');
        if (ccBtn) {
            const isPressed = ccBtn.getAttribute('aria-pressed') === 'true' || 
                              ccBtn.classList.contains('H2a7wc');
            if (!isPressed) {
                serverLog("Automatically activating captions in Meet interface...");
                ccBtn.click();
            }
        }
        setupCaptionsObserver();
    }, 2000);

})();

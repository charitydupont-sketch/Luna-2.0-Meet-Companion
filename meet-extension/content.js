// Luna 2.0 Google Meet Extension Content Script

// 1. Inject the WebRTC interception script into the webpage context
function injectInterceptionScript() {
    const code = `
        (function() {
            console.log("Luna 2.0 Interception Script successfully injected!");

            // Local state to store Orb status
            const state = {
                currentStatus: 'idle',
                pulseAmplitude: 0,
                time: 0,
                baseRadius: 100,
                targetRadius: 100,
                particles: [],
                colors: {
                    idle: ['rgba(99, 102, 241, 0.45)', 'rgba(217, 70, 239, 0.35)', 'rgba(6, 182, 212, 0.25)'],
                    listening: ['rgba(6, 182, 212, 0.65)', 'rgba(99, 102, 241, 0.45)', 'rgba(16, 185, 129, 0.3)'],
                    thinking: ['rgba(217, 70, 239, 0.6)', 'rgba(99, 102, 241, 0.45)', 'rgba(6, 182, 212, 0.35)'],
                    speaking: ['rgba(16, 185, 129, 0.6)', 'rgba(6, 182, 212, 0.45)', 'rgba(99, 102, 241, 0.35)']
                }
            };

            // Setup a local canvas for drawing Luna 2.0's Orb inside Google Meet
            const canvas = document.createElement('canvas');
            canvas.width = 400;
            canvas.height = 400;
            const ctx = canvas.getContext('2d');

            // Initialize vortex particles
            for (let i = 0; i < 40; i++) {
                state.particles.push({
                    angle: Math.random() * Math.PI * 2,
                    speed: 0.02 + Math.random() * 0.04,
                    distance: 90 + Math.random() * 50,
                    targetDistance: 90 + Math.random() * 50,
                    size: 1 + Math.random() * 2,
                    color: Math.random() > 0.5 ? 'magenta' : 'cyan',
                    opacity: 0.1 + Math.random() * 0.5
                });
            }

            // Draw Orb visualizer loop
            function drawOrb() {
                ctx.clearRect(0, 0, 400, 400);
                state.time += 0.05;
                state.baseRadius += (state.targetRadius - state.baseRadius) * 0.1;
                
                const cx = 200;
                const cy = 200;
                const activeColors = state.colors[state.currentStatus] || state.colors.idle;

                if (state.currentStatus === 'thinking') {
                    // Draw thinking core
                    const gradient = ctx.createRadialGradient(cx, cy, 5, cx, cy, state.baseRadius * 0.7);
                    gradient.addColorStop(0, '#fff');
                    gradient.addColorStop(0.3, 'rgba(217, 70, 239, 0.5)');
                    gradient.addColorStop(0.7, 'rgba(99, 102, 241, 0.2)');
                    gradient.addColorStop(1, 'transparent');
                    
                    ctx.beginPath();
                    ctx.arc(cx, cy, state.baseRadius * 0.7, 0, Math.PI * 2);
                    ctx.fillStyle = gradient;
                    ctx.fill();

                    // Swirl particles
                    state.particles.forEach(p => {
                        p.angle += p.speed;
                        p.targetDistance = 70 + Math.sin(state.time * p.speed * 5) * 25;
                        p.distance += (p.targetDistance - p.distance) * 0.05;
                        
                        const px = cx + Math.cos(p.angle) * p.distance;
                        const py = cy + Math.sin(p.angle) * p.distance;
                        const op = p.opacity * (0.6 + Math.sin(state.time + p.angle) * 0.4);

                        ctx.beginPath();
                        ctx.arc(px, py, p.size, 0, Math.PI * 2);
                        ctx.fillStyle = p.color === 'magenta' ? \`rgba(217, 70, 239, \${op})\` : \`rgba(6, 182, 212, \${op})\`;
                        ctx.fill();
                    });
                } else {
                    // Draw breathing liquid blob
                    for (let layer = 0; layer < 3; layer++) {
                        ctx.beginPath();
                        const numPoints = 80;
                        const points = [];
                        const scale = 1 - layer * 0.15;
                        const offset = layer * 3.5;

                        for (let i = 0; i < numPoints; i++) {
                            const angle = (i / numPoints) * Math.PI * 2;
                            let disp = 0;
                            
                            if (state.currentStatus === 'idle') {
                                disp = Math.sin(angle * 3 + state.time * 0.8 + offset) * 5 +
                                       Math.cos(angle * 5 - state.time * 0.5 + offset) * 3;
                            } else if (state.currentStatus === 'listening') {
                                disp = Math.sin(angle * 8 + state.time * 1.5 + offset) * 12;
                            } else if (state.currentStatus === 'speaking') {
                                disp = Math.sin(angle * 4 + state.time * 1.8 + offset) * 16;
                            }

                            const r = (state.baseRadius + disp) * scale;
                            const x = cx + Math.cos(angle) * r;
                            const y = cy + Math.sin(angle) * r;
                            points.push({ x, y });
                        }

                        ctx.moveTo(points[0].x, points[0].y);
                        for (let i = 0; i < points.length; i++) {
                            const p0 = points[i];
                            const p1 = points[(i + 1) % points.length];
                            ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
                        }
                        ctx.closePath();

                        const gradient = ctx.createRadialGradient(cx, cy, 10, cx, cy, state.baseRadius * scale);
                        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
                        gradient.addColorStop(0.5, activeColors[layer]);
                        gradient.addColorStop(1, 'transparent');
                        ctx.fillStyle = gradient;
                        ctx.fill();
                    }
                }
                requestAnimationFrame(drawOrb);
            }
            drawOrb();

            // Web Audio stream deslunation for injecting Luna 2.0's synthetic voice
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const audioDest = audioCtx.createMediaStreamDeslunation();

            // Override mediaDevices.getUserMedia
            const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia = async function(constraints) {
                console.log("Luna 2.0 Interceptor Hooked getUserMedia with constraints: ", constraints);
                
                // Fetch the real stream first (for camera/mic parameters)
                const realStream = await originalGetUserMedia(constraints);
                
                // Get fake visual track from our local canvas
                const canvasStream = canvas.captureStream(30);
                const customVideoTrack = canvasStream.getVideoTracks()[0];
                
                // Get fake microphone track from Web Audio
                const customAudioTrack = audioDest.stream.getAudioTracks()[0];

                // Combine tracks and return
                const tracks = [];
                if (constraints.video) {
                    tracks.push(customVideoTrack);
                    // Stop the real camera to save hardware resources
                    realStream.getVideoTracks().forEach(t => t.stop());
                } else {
                    realStream.getVideoTracks().forEach(t => tracks.push(t));
                }

                if (constraints.audio) {
                    tracks.push(customAudioTrack);
                    realStream.getAudioTracks().forEach(t => t.stop());
                } else {
                    realStream.getAudioTracks().forEach(t => tracks.push(t));
                }

                return new MediaStream(tracks);
            };

            // Floating Captions Widget for displaying Luna 2.0 speech inside Google Meet
            const captionsBox = document.createElement('div');
            captionsBox.style.position = 'fixed';
            captionsBox.style.bottom = '100px';
            captionsBox.style.left = '50%';
            captionsBox.style.transform = 'translateX(-50%)';
            captionsBox.style.background = 'rgba(0, 0, 0, 0.85)';
            captionsBox.style.color = '#fff';
            captionsBox.style.padding = '12px 24px';
            captionsBox.style.borderRadius = '12px';
            captionsBox.style.fontFamily = 'sans-serif';
            captionsBox.style.fontSize = '1.1rem';
            captionsBox.style.zIndex = '9999';
            captionsBox.style.border = '1px solid rgba(255,255,255,0.1)';
            captionsBox.style.display = 'none';
            captionsBox.id = 'luna-meet-captions';
            document.body.appendChild(captionsBox);

            function playLuna 2.0Voice(text) {
                console.log("[Luna 2.0 Audio] Playing synthetic voice via local server:", text);
                const audio = new Audio();
                audio.crossOrigin = "anonymous";
                audio.src = `http://127.0.0.1:8000/api/tts?text=${encodeURIComponent(text)}`;
                
                const source = audioCtx.createMediaElementSource(audio);
                source.connect(audioDest);
                source.connect(audioCtx.deslunation);
                
                audio.play().catch(err => {
                    console.warn("[Luna 2.0 Audio Warning] TTS Server failed, falling back to Web Speech:", err);
                    window.speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.onstart = () => { state.currentStatus = 'speaking'; };
                    utterance.onend = () => { state.currentStatus = 'idle'; };
                    window.speechSynthesis.speak(utterance);
                });

                state.currentStatus = 'speaking';
                audio.onended = () => {
                    state.currentStatus = 'idle';
                };
            }

            // Listen to forwarded postMessage commands from content script
            window.addEventListener('message', (e) => {
                if (e.data && e.data.type === 'LUNA_SYNC') {
                    const update = e.data.payload;
                    if (update.state) {
                        state.currentStatus = update.state;
                        if (update.state === 'thinking') state.targetRadius = 80;
                        else if (update.state === 'listening') state.targetRadius = 110;
                        else state.targetRadius = 100;
                    }
                    if (update.text) {
                        captionsBox.textContent = update.text;
                        captionsBox.style.display = 'block';
                        
                        playLuna 2.0Voice(update.text);
                        
                        const displayDuration = Math.max(3000, update.text.length * 80);
                        setTimeout(() => { captionsBox.style.display = 'none'; }, displayDuration);
                    }
                }
            });
        })();
    `;
    const script = document.createElement('script');
    script.textContent = code;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
}

// Run injection immediately
injectInterceptionScript();

// 2. Automate Lobby Guest-Join Screens
function automateLobby() {
    setInterval(() => {
        // Find guest name text input field
        const nameInput = document.querySelector('input[autocomplete="name"]') || 
                          document.querySelector('input[placeholder="Your name"]') ||
                          document.querySelector('input[type="text"]');
        if (nameInput && nameInput.value !== 'Luna 2.0') {
            nameInput.value = 'Luna 2.0';
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
            console.log("Automated lobby: set guest name to Luna 2.0");
        }

        // Find and click 'Ask to join' or 'Join now' button
        const buttons = document.querySelectorAll('button');
        for (let btn of buttons) {
            const txt = btn.textContent.toLowerCase();
            if (txt.includes('ask to join') || txt.includes('join now')) {
                btn.click();
                console.log("Automated lobby: clicked join trigger button: " + txt);
                break;
            }
        }
    }, 1000);
}
window.addEventListener('load', automateLobby);

// 3. Inject Communication Bridge Iframe (Connecting same-origin broadcast channel)
function initBridge() {
    const iframe = document.createElement('iframe');
    iframe.src = 'http://127.0.0.1:8000/meet-bridge.html';
    iframe.style.display = 'none';
    iframe.id = 'luna-bridge-iframe';
    document.body.appendChild(iframe);
}
window.addEventListener('load', initBridge);

// Receive cross-origin messages from the local bridge iframe and forward to page context
window.addEventListener('message', (e) => {
    if (e.origin === 'http://127.0.0.1:8000') {
        // Forward message to page context script
        window.postMessage(e.data, '*');
    } else {
        // Receive messages from page context script (e.g. MEET_TO_LUNA) and forward to bridge iframe
        if (e.data && e.data.type === 'MEET_TO_LUNA') {
            const iframe = document.getElementById('luna-bridge-iframe');
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage(e.data, 'http://127.0.0.1:8000');
            }
        }
    }
});

// 4. Capture Meet Chat Messages and forward to Luna Hub
let observedContainer = null;
function setupChatObserver() {
    // Select the polite aria-live container where new chat messages are appended in Google Meet
    const container = document.querySelector('div[aria-live="polite"]');
    if (!container) return;

    if (observedContainer === container) return;
    observedContainer = container;

    console.log("[Luna 2.0 Extension] Chat container found. Injecting chat listener MutationObserver.");

    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const messageBlocks = node.classList.contains('GDhqjd') ? [node] : node.querySelectorAll('div.GDhqjd');
                        
                        messageBlocks.forEach(block => {
                            const senderName = block.querySelector('div.YT6nS')?.textContent?.trim() || '';
                            if (senderName === 'Luna 2.0') return; // Ignore own messages

                            const textNodes = block.querySelectorAll('div.QTZ77');
                            textNodes.forEach(textNode => {
                                if (textNode.getAttribute('data-luna-processed') === 'true') return;
                                textNode.setAttribute('data-luna-processed', 'true');

                                const text = textNode.textContent?.trim();
                                if (text) {
                                    console.log(`[Luna 2.0 Extension] Captured chat from ${senderName}: ${text}`);
                                    window.postMessage({
                                        type: 'MEET_TO_LUNA',
                                        payload: {
                                            type: 'MEET_CHAT',
                                            sender: senderName,
                                            text: text
                                        }
                                    }, '*');
                                }
                            });
                        });
                    }
                });
            }
        });
    });

    observer.observe(container, { childList: true, subtree: true });
}

// Check periodically for chat history container presence (in case side panel is toggled)
window.addEventListener('load', () => {
    setInterval(setupChatObserver, 1000);
});

(function() {
    if (!window.location.search.includes('luna=true')) return;
    window.__luna_content_script_active = true;
    // Safe logging helper (replaces global console.log override to prevent stack overflows)
    const originalLog = console.log;
    const originalError = console.error;
    
    function sendLunaEvent(type, payload) {
        originalLog("LUNA_EVENT:" + JSON.stringify({ type, payload }));
    }

    function lunaLog(msg) {
        originalLog("[Luna 2.0]", msg);
        sendLunaEvent('BROWSER_LOG', { message: msg });
    }

    lunaLog("Luna 2.0 Interception Script successfully injected!");

    // Local state to store Orb status
    const state = {
        currentStatus: 'idle',
        pulseAmplitude: 0,
        time: 0,
        baseRadius: 100,
        targetRadius: 100,
        particles: [],
        currentAudio: null,
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
        ctx.globalCompositeOperation = 'source-over';
        ctx.shadowBlur = 0;
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
                ctx.fillStyle = p.color === 'magenta' ? `rgba(217, 70, 239, ${op})` : `rgba(6, 182, 212, ${op})`;
                ctx.fill();
            });
        } else {
            // Draw breathing liquid blob with additive blend glow
            ctx.globalCompositeOperation = 'screen';
            for (let layer = 0; layer < 3; layer++) {
                ctx.beginPath();
                const numPoints = 80;
                const points = [];
                const scale = 1 - layer * 0.12;
                const offset = layer * 3.5;

                for (let i = 0; i < numPoints; i++) {
                    const angle = (i / numPoints) * Math.PI * 2;
                    let disp = 0;
                    
                    if (state.currentStatus === 'idle') {
                        disp = Math.sin(angle * 3 + state.time * 0.6 + offset) * 6 +
                               Math.cos(angle * 5 - state.time * 0.4 + offset) * 4;
                    } else if (state.currentStatus === 'listening') {
                        disp = Math.sin(angle * 8 + state.time * 1.5 + offset) * 14;
                    } else if (state.currentStatus === 'speaking') {
                        disp = Math.sin(angle * 4 + state.time * 1.6 + offset) * 18;
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

                // Advanced glow shadows for a cleaner, high-end look
                ctx.shadowBlur = 25 - layer * 5;
                ctx.shadowColor = activeColors[layer];

                const gradient = ctx.createRadialGradient(cx, cy, 5, cx, cy, state.baseRadius * scale);
                gradient.addColorStop(0, 'rgba(255, 255, 255, 0.4)'); // white luminous core
                gradient.addColorStop(0.3, activeColors[layer]);
                gradient.addColorStop(0.8, activeColors[layer].replace(/[\d\.]+\)$/, '0.05)')); // fade out
                gradient.addColorStop(1, 'transparent');
                
                ctx.fillStyle = gradient;
                ctx.fill();
            }
        }
        requestAnimationFrame(drawOrb);
    }
    drawOrb();

    // Web Audio stream destination for injecting Luna 2.0's synthetic voice
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioDest = audioCtx.createMediaStreamDestination();

    // Override mediaDevices.getUserMedia
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function(constraints) {
        lunaLog("Luna 2.0 Interceptor Hooked getUserMedia with constraints: " + JSON.stringify(constraints));
        
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
    if (document.body) {
        document.body.appendChild(captionsBox);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            document.body.appendChild(captionsBox);
        });
    }

    function playLunaVoiceFromDataUrl(dataUrl) {
        lunaLog("[Luna 2.0 Audio] Playing synthetic voice from Data URL");
        
        const playAudio = () => {
            if (state.currentAudio) {
                try { state.currentAudio.pause(); } catch(e){}
            }

            const audio = new Audio();
            audio.crossOrigin = "anonymous";
            audio.src = dataUrl;
            state.currentAudio = audio;
            
            const source = audioCtx.createMediaElementSource(audio);
            source.connect(audioDest);
            source.connect(audioCtx.destination);
            
            audio.play().catch(err => {
                originalError("[Luna 2.0 Audio Error] Failed to play base64 audio: " + err.message);
            });

            state.currentStatus = 'speaking';
            audio.onended = () => {
                state.currentStatus = 'idle';
                if (state.currentAudio === audio) {
                    state.currentAudio = null;
                }
            };
        };

        if (audioCtx.state === 'suspended') {
            audioCtx.resume().then(() => {
                lunaLog("[Luna 2.0 Audio] AudioContext resumed successfully.");
                playAudio();
            }).catch(err => {
                originalError("[Luna 2.0 Audio Error] Failed to resume AudioContext: " + err.message);
                playAudio();
            });
        } else {
            playAudio();
        }
    }

    function playLunaVoice(text) {
        lunaLog("[Luna 2.0 Audio] Delegating TTS generation for: " + text);
        sendLunaEvent('FETCH_TTS', { text: text });
    }

    // Listen to forwarded postMessage commands from content script or bridge
    window.addEventListener('message', (e) => {
        if (e.data) {
            if (e.data.type === 'LUNA_AUDIO_DATA') {
                playLunaVoiceFromDataUrl(e.data.dataUrl);
            }
            if (e.data.type === 'LUNA_AUDIO_ERROR') {
                console.warn("[Luna 2.0 Audio Warning] TTS generation failed in bridge, falling back to Web Speech:", e.data.error);
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(e.data.text);
                utterance.onstart = () => { state.currentStatus = 'speaking'; };
                utterance.onend = () => { state.currentStatus = 'idle'; };
                window.speechSynthesis.speak(utterance);
            }
            if (e.data.type === 'LUNA_SYNC') {
                const update = e.data.payload;
                if (update.cancel) {
                    lunaLog("[Luna 2.0 Audio] Interruption requested. Canceling speech.");
                    if (state.currentAudio) {
                        try {
                            state.currentAudio.pause();
                            state.currentAudio.src = '';
                        } catch(e){}
                        state.currentAudio = null;
                    }
                    window.speechSynthesis.cancel();
                    state.currentStatus = 'idle';
                    state.targetRadius = 100;
                    captionsBox.style.display = 'none';
                    return;
                }
                if (update.state) {
                    state.currentStatus = update.state;
                    if (update.state === 'thinking') state.targetRadius = 80;
                    else if (update.state === 'listening') state.targetRadius = 110;
                    else state.targetRadius = 100;
                }
                if (update.text) {
                    captionsBox.textContent = update.text;
                    captionsBox.style.display = 'block';
                    
                    playLunaVoice(update.text);
                    
                    const displayDuration = Math.max(3000, update.text.length * 80);
                    setTimeout(() => { captionsBox.style.display = 'none'; }, displayDuration);
                }
            }
        }
    });

    // ==========================================
    // Google Meet Automation & Integration (CDP Bridge)
    // ==========================================

    // 1. Automate Lobby Guest-Join Screens
    function automateLobby() {
        setInterval(() => {
            // Find guest name text input field
            const nameInput = document.querySelector('input[autocomplete="name"]') || 
                              document.querySelector('input[placeholder="Your name"]') ||
                              document.querySelector('input[type="text"]');
            if (nameInput && nameInput.value !== 'Luna 2.0') {
                nameInput.value = 'Luna 2.0';
                nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                lunaLog("Automated lobby: set guest name to Luna 2.0");
            }

            // Find and click 'Ask to join' or 'Join now' or 'Switch here' button
            const buttons = document.querySelectorAll('button');
            for (let btn of buttons) {
                const txt = btn.textContent.toLowerCase();
                if (txt.includes('ask to join') || txt.includes('join now') || txt.includes('switch here') || txt.includes('join here too') || txt.includes('join here') || txt.includes('join meeting') || txt.trim() === 'join') {
                    btn.click();
                    lunaLog("Automated lobby: clicked join trigger button: " + txt);
                    break;
                }
            }
        }, 1000);
    }
    window.addEventListener('load', () => {
        setInterval(automateLobby, 1000);
    });

    // DOM observers removed - handled exclusively by content.js

    // 5. Send chat response to Google Meet side panel chat
    function sendMeetChatMessage(text) {
        try {
            sentMessagesCache.add(text);
            setTimeout(() => { sentMessagesCache.delete(text); }, 30000);
            let textarea = document.querySelector('textarea[aria-label*="send a message" i]') || 
                           document.querySelector('textarea[placeholder*="send a message" i]');
                           
            if (!textarea) {
                const chatBtn = document.querySelector('button[aria-label*="chat with everyone" i]') || 
                                document.querySelector('button[data-tooltip*="chat with everyone" i]') ||
                                document.querySelector('[jsname="A52Zdd"]');
                if (chatBtn) {
                    lunaLog("Chat panel is closed. Opening chat panel...");
                    chatBtn.click();
                } else {
                    lunaLog("Failed to locate chat toggle button.");
                    return;
                }
            }
            
            setTimeout(() => {
                textarea = document.querySelector('textarea[aria-label*="send a message" i]') || 
                           document.querySelector('textarea[placeholder*="send a message" i]') ||
                           document.querySelector('.KHdZ7e');
                           
                if (textarea) {
                    textarea.value = text;
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    
                    setTimeout(() => {
                        const sendBtn = document.querySelector('button[aria-label*="send a message" i]') || 
                                        document.querySelector('button[data-tooltip*="send a message" i]') ||
                                        document.querySelector('button[jsname="Z3bgfc"]');
                        if (sendBtn && !sendBtn.disabled) {
                            sendBtn.click();
                            lunaLog("Successfully sent chat message to Meet: " + text);
                        } else {
                            const enterEvent = new KeyboardEvent('keydown', {
                                key: 'Enter',
                                code: 'Enter',
                                keyCode: 13,
                                which: 13,
                                bubbles: true
                            });
                            textarea.dispatchEvent(enterEvent);
                            lunaLog("Sent chat message via Enter key fallback: " + text);
                        }
                    }, 200);
                } else {
                    lunaLog("Failed to locate chat textarea after opening panel.");
                }
            }, 500);
        } catch (e) {
            lunaLog("Error sending chat message: " + e.message);
        }
    }

    // Check periodically for chat and captions history containers presence
    window.addEventListener('load', () => {
        // Observers moved to content.js
    });
})();

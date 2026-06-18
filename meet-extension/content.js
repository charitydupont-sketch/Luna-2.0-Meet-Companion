// Luna 2.0 Google Meet Extension Content Script

if (window.self === window.top && window.location.search.includes('luna=true')) {
    console.log("[Luna 2.0 Content Script] Bot mode active. Starting native script injection...");
    const processedMessageIds = new Set();
    const processedTexts = new Map(); // Map of key (senderName:text) -> timestamp
    const sentTexts = new Set(); // Set of locally sent messages to bypass observer reflection
    let cachedSelfName = null;
    let recentlySpokenTexts = [];

    function findSelfName() {
        if (cachedSelfName) return cachedSelfName;

        const participantItems = document.querySelectorAll('.VfPpkd-StrnGf-rymPhb-ibnC6b, [data-participant-id], .cS7aqe.NkoVdd');
        for (const item of participantItems) {
            const nameEl = item.querySelector('.zWGUib, .adnwBd, .NWpY1d');
            if (nameEl) {
                const rawText = nameEl.innerText || nameEl.textContent || '';
                const firstLine = rawText.split('\n')[0].trim();
                if (rawText.includes('(You)') || item.textContent?.includes('(You)')) {
                    const name = firstLine.replace(/\s*\(You\)\s*$/, '').trim();
                    if (name && name.length > 1) {
                        cachedSelfName = name;
                        return name;
                    }
                }
            }
        }
        
        const videoTiles = document.querySelectorAll('[data-requested-participant-id], [data-participant-id]');
        for (const tile of videoTiles) {
            const nameEl = tile.querySelector('.XEazBc .adnwBd, .zWGUib, .NWpY1d');
            if (nameEl) {
                const rawText = nameEl.innerText || nameEl.textContent || '';
                const firstLine = rawText.split('\n')[0].trim();
                if (firstLine.includes('(You)')) {
                    const name = firstLine.replace(/\s*\(You\)\s*$/, '').trim();
                    if (name && name.length > 1) {
                        cachedSelfName = name;
                        return name;
                    }
                }
            }
        }
        
        const selectors = [
            '[data-self-name]',
            '[data-self-attendance-from-server-name]', 
            '[data-self-full-name]'
        ];
        
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
                const name = el.getAttribute('data-self-name') ||
                             el.getAttribute('data-self-attendance-from-server-name') ||
                             el.getAttribute('data-self-full-name');
                if (name && name.length > 1 && name !== 'You') {
                    cachedSelfName = name;
                    return name;
                }
            }
        }
        
        return null;
    }

// // 1. Inject the WebRTC interception script into the webpage context
function injectInterceptionScript() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getManifest) {
        contentLog("[Luna 2.0 Content Script] Running in page context. Skipping redundant interception script injection...");
        return;
    }
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('orb-injector.js');
    
    function injectScriptSafe() {
        if (document.head) {
            document.head.appendChild(script);
            script.onload = () => {
                script.remove();
            };
        } else {
            const timer = setInterval(() => {
                if (document.head) {
                    clearInterval(timer);
                    document.head.appendChild(script);
                    script.onload = () => {
                        script.remove();
                    };
                }
            }, 2);
        }
    }
    injectScriptSafe();
}

// Logger for content script isolated world (forwards logs directly to background service worker)
function contentLog(msg) {
    console.log("[Luna 2.0 Content Script]", msg);
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'BROWSER_LOG', message: msg });
    }
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
            contentLog("Automated lobby: set guest name to Luna 2.0");
        }

        // Find and click 'Ask to join' or 'Join now' or 'Switch here' button
        const buttons = document.querySelectorAll('button');
        for (let btn of buttons) {
            const txt = btn.textContent.toLowerCase();
            if (txt.includes('ask to join') || txt.includes('join now') || txt.includes('switch here') || txt.includes('join here too') || txt.includes('join here') || txt.includes('join meeting') || txt.trim() === 'join') {
                btn.click();
                contentLog("Automated lobby: clicked join trigger button: " + txt);
                break;
            }
        }
    }, 1000);
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    automateLobby();
} else {
    window.addEventListener('load', automateLobby);
}

// 3. Native Chrome Extension Background Service Worker Bridge (Mixed-Content bypass)
window.addEventListener('message', (e) => {
    // Receive message from the page context script and forward directly to the Reflector server
    if (e.data && e.data.type === 'MEET_TO_LUNA') {
        const payload = e.data.payload;
        
        if (payload && payload.type === 'BROWSER_LOG') {
            fetch('http://127.0.0.1:8000/api/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: payload.message })
            }).catch(() => {});
            return;
        }

        if (payload && payload.type === 'FETCH_TTS') {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({ type: 'FETCH_TTS', text: payload.text }, (response) => {
                    if (response && response.success) {
                        window.postMessage({
                            type: 'LUNA_AUDIO_DATA',
                            dataUrl: response.dataUrl
                        }, '*');
                    } else {
                        window.postMessage({
                            type: 'LUNA_AUDIO_ERROR',
                            text: payload.text,
                            error: response?.error || 'Unknown error'
                        }, '*');
                    }
                });
            } else {
                const ttsUrl = `http://127.0.0.1:8000/api/tts?text=${encodeURIComponent(payload.text)}`;
                fetch(ttsUrl)
                    .then(res => {
                        if (!res.ok) throw new Error("TTS fetch failed");
                        return res.blob();
                    })
                    .then(blob => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            window.postMessage({
                                type: 'LUNA_AUDIO_DATA',
                                dataUrl: reader.result
                            }, '*');
                        };
                        reader.readAsDataURL(blob);
                    })
                    .catch(err => {
                        window.postMessage({
                            type: 'LUNA_AUDIO_ERROR',
                            text: payload.text,
                            error: err.message
                        }, '*');
                    });
            }
            return;
        }

        // Forward general synchronization events (e.g. MEET_CHAT) to server reflector
        fetch('http://127.0.0.1:8000/api/events/to-hub', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => {});
    }
});

// 4. Capture Meet Chat Messages and forward to Luna Hub
let observedContainer = null;
let chatObserver = null;
function setupChatObserver() {
    // Select the polite aria-live container where new chat messages are appended in Google Meet
    const container = document.querySelector('div[jsname="xySENc"]') || 
                      document.querySelector('div[aria-live="polite"].Ge9Kpc') || 
                      document.querySelector('div[aria-live="polite"]');
    if (!container) return;

    if (observedContainer === container) return;
    
    // Scan existing history to populate processed list before observing
    container.querySelectorAll('div[jsname="dTKtvb"], div.QTZ77').forEach(textNode => {
        textNode.setAttribute('data-luna-processed', 'true');
        const messageEl = textNode.closest('.RLrADb') || textNode.closest('[data-message-id]');
        const messageId = messageEl ? messageEl.getAttribute('data-message-id') : null;
        if (messageId) {
            processedMessageIds.add(messageId);
        }
    });

    if (chatObserver) {
        try {
            chatObserver.disconnect();
        } catch (e) {}
    }

    observedContainer = container;

    contentLog("[Luna 2.0 Extension] Chat container found. Injecting chat listener MutationObserver.");

    chatObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const block = node.closest('.Ss4fHf') || node.closest('.GDhqjd');
                        if (block) {
                            const senderName = block.querySelector('.poVWob, div.YT6nS')?.textContent?.trim() || 'Participant';
                            const selfName = findSelfName();
                            const isSelf = senderName === 'Luna 2.0' || 
                                           senderName.toLowerCase() === 'you' ||
                                           (selfName && senderName === selfName) || 
                                           senderName.toLowerCase().includes('luna');
                            if (isSelf) return; // Ignore own messages

                            const nodesToProcess = [];
                            if (node.tagName === 'DIV' && (node.getAttribute('jsname') === 'dTKtvb' || node.classList.contains('QTZ77'))) {
                                nodesToProcess.push(node);
                            }
                            node.querySelectorAll('div[jsname="dTKtvb"], div.QTZ77').forEach(el => nodesToProcess.push(el));

                            nodesToProcess.forEach(textNode => {
                                if (textNode.getAttribute('data-luna-processed') === 'true') return;
                                textNode.setAttribute('data-luna-processed', 'true');

                                const messageEl = textNode.closest('.RLrADb') || textNode.closest('[data-message-id]');
                                const messageId = messageEl ? messageEl.getAttribute('data-message-id') : null;
                                if (messageId) {
                                    if (processedMessageIds.has(messageId)) return;
                                    processedMessageIds.add(messageId);
                                }

                                const text = textNode.textContent?.trim();
                                if (text) {
                                    if (sentTexts.has(text)) {
                                        contentLog(`[Luna 2.0] Ignoring own sent message via locally sent cache: "${text}"`);
                                        return;
                                    }
                                    const now = Date.now();
                                    const cacheKey = `${senderName}:${text}`;
                                    if (processedTexts.has(cacheKey)) {
                                        const lastTime = processedTexts.get(cacheKey);
                                        if (now - lastTime < 10000) {
                                            return; // Skip duplicate message within 10 seconds
                                        }
                                    }
                                    processedTexts.set(cacheKey, now);

                                    // Periodic cleanup to prevent leaks
                                    if (processedTexts.size > 100) {
                                        for (let [k, v] of processedTexts.entries()) {
                                            if (now - v > 10000) processedTexts.delete(k);
                                        }
                                    }

                                    contentLog(`[Luna 2.0 Extension] Captured chat from ${senderName}: ${text} (ID: ${messageId})`);
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
                        }
                    }
                });
            }
        });
    });

    chatObserver.observe(container, { childList: true, subtree: true });
}

// 5. Capture Meet Live Captions and forward to Luna Hub
let captionsObserver = null;
let speakerBuffers = {}; // Map of senderName -> { text: string, timer: timeout }

function setupCaptionsObserver() {
    const container = document.querySelector('[role="region"][aria-label*="caption" i]') || 
                      document.querySelector('[role="region"][aria-label*="subtitle" i]') || 
                      document.querySelector('[jsname="dsyhDe"]');
    if (!container) return;

    if (captionsObserver) return; // Already observing

    contentLog("[Luna 2.0 Extension] Live Captions container found. Injecting captions listener MutationObserver.");

    captionsObserver = new MutationObserver((mutations) => {
        // Find all active caption blocks inside the container
        const blocks = container.querySelectorAll('[jsname="c12oMc"]') || 
                       container.querySelectorAll('.Kc212b') ||
                       Array.from(container.children);
                       
        blocks.forEach(block => {
            // Extract speaker name
            let speakerName = block.querySelector('.NWpY1d')?.textContent?.trim() || 
                              block.querySelector('[jsname="wP3x1"]')?.textContent?.trim() || 
                              '';
                                
            if (!speakerName) return;

            const selfName = findSelfName();

            // Resolve 'You' to the actual name if possible
            if (speakerName === 'You' && selfName) {
                speakerName = selfName;
            }

            // Ignore own captions (either literal name, placeholder 'You', or resolved self name)
            if (speakerName === 'Luna 2.0' || speakerName === 'You' || (selfName && speakerName === selfName)) {
                return;
            }

            // Extract text parts
            const textEls = block.querySelectorAll('.ygicle.VbkSUe') || 
                            block.querySelectorAll('.iTTPOb');
            let fullText = "";
            textEls.forEach(el => {
                fullText += el.textContent + " ";
            });
            fullText = fullText.trim();

            if (!fullText) return;

            // Echo cancellation: ignore if the caption matches recently spoken texts by the bot
            const cleanCaption = fullText.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
            const now = Date.now();
            
            // Filter out expired spoken texts (> 30 seconds old)
            recentlySpokenTexts = recentlySpokenTexts.filter(item => now - item.timestamp < 30000);
            
            const isEcho = recentlySpokenTexts.some(spoken => {
                // Return true if caption is a close match to spoken text
                return spoken.text.includes(cleanCaption) || cleanCaption.includes(spoken.text);
            });

            if (isEcho) {
                contentLog("[Luna 2.0 Extension] Acoustic echo ignored: " + fullText);
                return;
            }

            // Update the speaker's text buffer
            if (!speakerBuffers[speakerName]) {
                speakerBuffers[speakerName] = { text: "", timer: null };
            }

            const buffer = speakerBuffers[speakerName];
            
            // If the new text is different, update buffer and reset debounce timer
            if (fullText !== buffer.text) {
                buffer.text = fullText;
                
                if (buffer.timer) clearTimeout(buffer.timer);
                
                buffer.timer = setTimeout(() => {
                    // Silence threshold reached: Speaker has finished speaking!
                    const finishedText = buffer.text;
                    contentLog(`[Luna 2.0 Captions] ${speakerName} finished speaking: ${finishedText}`);
                    
                    // Send to Luna Hub
                    window.postMessage({
                        type: 'MEET_TO_LUNA',
                        payload: {
                            type: 'MEET_CAPTION',
                            sender: speakerName,
                            text: finishedText
                        }
                    }, '*');
                    
                    // Clear buffer text so we don't repeat
                    buffer.text = "";
                }, 1800); // 1.8 seconds silence threshold
            }
        });
    });

    captionsObserver.observe(container, { childList: true, subtree: true, characterData: true });
}

function autoEnableCaptions() {
    const ccBtn = document.querySelector('button[aria-label*="captions" i]') || 
                  document.querySelector('button[data-tooltip*="captions" i]');
    if (ccBtn) {
        const isPressed = ccBtn.getAttribute('aria-pressed') === 'true' || 
                          ccBtn.classList.contains('H2a7wc');
        if (!isPressed) {
            contentLog("[Luna 2.0 Extension] Automatically enabling captions for Luna...");
            ccBtn.click();
        }
    }
}

function ensureChatPanelOpen() {
    const textarea = document.querySelector('textarea[aria-label*="send a message" i]');
    if (!textarea) {
        const chatBtn = document.querySelector('button[aria-label*="chat with everyone" i]') || 
                        document.querySelector('button[data-tooltip*="chat with everyone" i]') ||
                        document.querySelector('[jsname="A52Zdd"]');
        if (chatBtn) {
            contentLog("[Luna 2.0 Extension] Automatically opening chat panel to observe messages...");
            chatBtn.click();
        }
    }
}

function sendMeetChatMessage(text) {
    const textarea = document.querySelector('textarea[aria-label*="send a message" i]');
    if (textarea) {
        // Track locally sent text to prevent loop loops
        sentTexts.add(text);
        setTimeout(() => { sentTexts.delete(text); }, 30000);

        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Find send button
        const buttons = Array.from(document.querySelectorAll('button'));
        const sendBtn = buttons.find(btn => {
            const label = (btn.getAttribute('aria-label') || '').toLowerCase();
            return label === 'send a message' || label === 'send message';
        });
        
        if (sendBtn) {
            sendBtn.removeAttribute('disabled');
            sendBtn.click();
            contentLog("[Luna 2.0 Extension] Automatically sent chat response: " + text);
        } else {
            contentLog("[Luna 2.0 Extension] Send button not found!");
        }
    } else {
        contentLog("[Luna 2.0 Extension] Textarea not found! Chat panel might be closed!");
    }
}
function ensureUnmuted() {
    const micBtn = document.querySelector('button[aria-label*="turn on microphone" i]') || 
                   document.querySelector('button[data-tooltip*="turn on microphone" i]');
    if (micBtn) {
        contentLog("[Luna 2.0 Extension] Luna was muted. Automatically unmuting microphone...");
        micBtn.click();
    }
}

// Check periodically for chat and captions history containers presence
    function initBot() {
        setInterval(setupChatObserver, 1000);
        setInterval(setupCaptionsObserver, 1000);
        setInterval(autoEnableCaptions, 2000);
        setInterval(ensureChatPanelOpen, 2000);
        setInterval(ensureUnmuted, 2000);

        // Poll server directly from content script for events (prevents service worker timeout sleep issues)
        setInterval(() => {
            fetch('http://127.0.0.1:8000/api/events/poll-meet')
                .then(res => res.json())
                .then(events => {
                    events.forEach(event => {
                        contentLog("[Luna 2.0 Extension] Polled event received from server: " + JSON.stringify(event));
                        
                        if (event && event.text) {
                            // Automatically type and send the text response in Google Meet chat!
                            sendMeetChatMessage(event.text);
                            
                            const cleanSpoken = event.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
                            if (cleanSpoken) {
                                recentlySpokenTexts.push({
                                    text: cleanSpoken,
                                    timestamp: Date.now()
                                });
                            }
                        }

                        window.postMessage({ type: 'LUNA_SYNC', payload: event }, '*');
                    });
                })
                .catch(err => { contentLog("[Luna 2.0 Extension] Poll error: " + err.message); });
        }, 200);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initBot();
    } else {
        window.addEventListener('load', initBot);
    }

} else {
    // Host mode logic (runs on the meeting host's browser context)
    function runHostAutoAdmit() {
        setInterval(() => {
            const buttons = document.querySelectorAll('button');
            for (let btn of buttons) {
                const txt = btn.textContent.toLowerCase();
                if (txt.includes('admit') || txt.trim() === 'admit') {
                    btn.click();
                    console.log("[Luna 2.0 Host Script] Automatically admitted guest participant.");
                }
            }
        }, 1000);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        runHostAutoAdmit();
    } else {
        window.addEventListener('load', runHostAutoAdmit);
    }
}

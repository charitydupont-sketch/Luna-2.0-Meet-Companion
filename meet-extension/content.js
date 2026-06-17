// Luna 2.0 Google Meet Extension Content Script

if (window.self === window.top && window.location.search.includes('luna=true')) {
    console.log("[Luna 2.0 Content Script] Bot mode active. Starting native script injection...");

// // 1. Inject the WebRTC interception script into the webpage context
function injectInterceptionScript() {
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
    chrome.runtime.sendMessage({ type: 'BROWSER_LOG', message: msg });
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
window.addEventListener('load', automateLobby);

// 3. Native Chrome Extension Background Service Worker Bridge (Mixed-Content bypass)
window.addEventListener('message', (e) => {
    // Receive message from the page context script and forward to background script
    if (e.data && e.data.type === 'MEET_TO_LUNA') {
        const payload = e.data.payload;
        
        if (payload && payload.type === 'BROWSER_LOG') {
            chrome.runtime.sendMessage({ type: 'BROWSER_LOG', message: payload.message });
            return;
        }

        if (payload && payload.type === 'FETCH_TTS') {
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
            return;
        }

        // Forward general synchronization events (e.g. MEET_CHAT) to BroadcastChannel via background
        chrome.runtime.sendMessage({ type: 'FORWARD_TO_HUB', payload: payload });
    }
});

// Receive events from the background script (from companion hub) and forward to the page context script
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'BACKGROUND_TO_CONTENT') {
        window.postMessage({ type: 'LUNA_SYNC', payload: message.payload }, '*');
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

    contentLog("[Luna 2.0 Extension] Chat container found. Injecting chat listener MutationObserver.");

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
                                    contentLog(`[Luna 2.0 Extension] Captured chat from ${senderName}: ${text}`);
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
            const speakerName = block.querySelector('.NWpY1d')?.textContent?.trim() || 
                                block.querySelector('[jsname="wP3x1"]')?.textContent?.trim() || 
                                '';
                                
            if (!speakerName || speakerName === 'Luna 2.0') return; // Ignore empty or own captions

            // Extract text parts
            const textEls = block.querySelectorAll('.ygicle.VbkSUe') || 
                            block.querySelectorAll('.iTTPOb');
            let fullText = "";
            textEls.forEach(el => {
                fullText += el.textContent + " ";
            });
            fullText = fullText.trim();

            if (!fullText) return;

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
                            type: 'MEET_CHAT',
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

// Check periodically for chat and captions history containers presence
window.addEventListener('load', () => {
    setInterval(setupChatObserver, 1000);
    setInterval(setupCaptionsObserver, 1000);
    setInterval(autoEnableCaptions, 2000);
});

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
    window.addEventListener('load', runHostAutoAdmit);
}

// Luna 2.0 Chrome Extension Background Service Worker
console.log("Luna 2.0 background service worker active.");

// Poll server for incoming events from the companion Hub dashboard (replaces BroadcastChannel)
setInterval(() => {
    fetch('http://127.0.0.1:8000/api/events/poll-meet')
        .then(res => res.json())
        .then(events => {
            events.forEach(event => {
                console.log("[Background Worker] Polled event received:", event);
                chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, { type: 'BACKGROUND_TO_CONTENT', payload: event });
                    });
                });
            });
        })
        .catch(err => {});
}, 800);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'FETCH_TTS') {
        const ttsUrl = `http://127.0.0.1:8000/api/tts?text=${encodeURIComponent(request.text)}`;
        
        fetch(ttsUrl)
            .then(response => {
                if (!response.ok) throw new Error("TTS generation failed");
                return response.arrayBuffer();
            })
            .then(arrayBuffer => {
                // Convert arrayBuffer to base64 Data URL (btoa is not available in service workers)
                const uint8 = new Uint8Array(arrayBuffer);
                const base64 = uint8ToBase64(uint8);
                const dataUrl = `data:audio/wav;base64,${base64}`;
                sendResponse({ success: true, dataUrl: dataUrl });
            })
            .catch(err => {
                console.error("[Background Error] TTS failed:", err.message);
                sendResponse({ success: false, error: err.message });
            });
            
        return true; // Keep message channel open for async response
    }
    
    if (request.type === 'BROWSER_LOG') {
        fetch('http://127.0.0.1:8000/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: request.message })
        })
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
        
        return true;
    }

    if (request.type === 'FORWARD_TO_HUB') {
        console.log("[Background Worker] Forwarding event to Hub via server reflector: ", request.payload);
        fetch('http://127.0.0.1:8000/api/events/to-hub', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.payload)
        })
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
        return true;
    }
});

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

console.log("[Luna 2.0 Hub Debug] app.js script evaluated outside DOMContentLoaded");
document.addEventListener('DOMContentLoaded', () => {
    console.log("[Luna 2.0 Hub Debug] DOMContentLoaded listener fired");
    // 1. Initialize Canvas Orb
    const orb = new AgentOrb('orb-canvas');

    // Sync Broadcast Channel for cross-tab communication (replaced with server reflector)
    function broadcastState(stateUpdate) {
        fetch('/api/events/to-meet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stateUpdate)
        }).catch(err => {});
    }

    // Poll server for incoming events from the Google Meet call
    setInterval(() => {
        fetch('/api/events/poll-app')
            .then(res => res.json())
            .then(events => {
                events.forEach(event => {
                    console.log("[Luna 2.0 Hub] Polled event received: " + JSON.stringify(event));
                    if (event && event.type === 'MEET_CHAT') {
                        // MEET_CHAT logic is now handled directly on the Node backend server
                    } else if (event && event.type === 'MEET_CAPTION') {
                        const sender = event.sender;
                        const text = event.text;
                        console.log("[Luna 2.0 Hub] Processing MEET_CAPTION from " + sender + ": " + text);

                        // Add to the live transcript panel
                        addTranscriptSegment(sender, text);
                    } else if (event && event.type === 'MEET_CHAT_MIRROR') {
                        addMessageToLog(event.sender, event.text);
                    } else if (event && event.type === 'SANDBOX_ACTION') {
                        openSandbox(templates[event.template]);
                    }
                });
            })
            .catch(err => {});
    }, 800);

    // 2. Global State Storage
    const state = {
        activeFile: null,
        sharedFiles: [],
        desktopFiles: [],
        driveFiles: [],
        chatOpen: false,
        speechActive: false,
        recognition: null,
        voices: [],
        
        // Meet Call State
        meetActive: false,
        meetStream: null,
        meetMicActive: true,
        meetVideoActive: true,
        meetings: [],
        muted: false
    };
    window.lunaState = state;

    // Pre-populate mock Desktop files
    const mockDesktopFiles = [
        { name: 'Weekly_Progress_Report.pdf', size: 1048576, type: 'application/pdf', content: 'Weekly Progress: Project is on track. High-fidelity prototypes completed. Core canvas visualizer operational. Integration testing scheduled next week.' },
        { name: 'Idea_Brainstorm_Agent.txt', size: 2450, type: 'text/plain', content: 'Draft ideas for the Live Agent:\n1. Use Perlin noise equations for organic shifts.\n2. Add particle vortex during thinking loop.\n3. Synchronize volume scale with synthetic voices.\n4. Integrate Google Docs direct drafts.' },
        { name: 'Hero_Image_Mockup.png', size: 3145728, type: 'image/png', content: 'mock_image_data' }
    ];

    // Pre-populate Google Drive mock files (no permission click required)
    const mockDriveFiles = [
        { 
            name: 'Shared_Prototype.html', 
            size: 4500, 
            type: 'text/html', 
            content: `<!DOCTYPE html>\n<html>\n<head>\n<style>\n  body { font-family: sans-serif; background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 90vh; margin: 0; }\n  h1 { color: #38bdf8; }\n  .card { background: #1e293b; padding: 24px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); text-align: center; }\n</style>\n</head>\n<body>\n<div class="card">\n  <h1>Live Prototype</h1>\n  <p>Created automatically by Luna 2.0.</p>\n</div>\n</body>\n</html>` 
        },
        { 
            name: 'Luna 2.0_System_Design.txt', 
            size: 3820, 
            type: 'text/plain', 
            content: 'Luna 2.0 Design Guidelines:\n- Companion Name: Luna 2.0\n- Persona: Intelligent Workspace Assistant\n- Integrations: Gmail, Calendar, Docs, Meet\n- Sandbox: HTML/CSS/JS Live Previews.' 
        },
        { 
            name: 'Workspace_Feedback.pdf', 
            size: 512000, 
            type: 'application/pdf', 
            content: 'Feedback notes: Add seamless cloud synchronization and simplified folder sync picker.' 
        }
    ];

    // Prototype Template Codes
    const templates = {
        calculator: `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; display: flex; justify-content: center; align-items: center; height: 85vh; margin: 0; }
  .calc { background: #1e293b; padding: 20px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.4); width: 260px; }
  .screen { background: #0f172a; color: #38bdf8; font-size: 2rem; padding: 16px; text-align: right; border-radius: 8px; margin-bottom: 20px; overflow: hidden; height: 40px; line-height: 40px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  button { padding: 15px; font-size: 1.2rem; border: none; border-radius: 8px; cursor: pointer; transition: 0.2s; background: #334155; color: #fff; }
  button:hover { background: #475569; }
  button.op { background: #0284c7; }
  button.op:hover { background: #0369a1; }
  button.eq { background: #10b981; grid-column: span 2; }
  button.eq:hover { background: #059669; }
</style>
</head>
<body>
<div class="calc">
  <div id="screen" class="screen">0</div>
  <div class="grid">
    <button onclick="press('7')">7</button>
    <button onclick="press('8')">8</button>
    <button onclick="press('9')">9</button>
    <button class="op" onclick="press('/')">/</button>
    <button onclick="press('4')">4</button>
    <button onclick="press('5')">5</button>
    <button onclick="press('6')">6</button>
    <button class="op" onclick="press('*')">*</button>
    <button onclick="press('1')">1</button>
    <button onclick="press('2')">2</button>
    <button onclick="press('3')">3</button>
    <button class="op" onclick="press('-')">-</button>
    <button onclick="press('0')">0</button>
    <button onclick="clearScr()">C</button>
    <button class="eq" onclick="calc()">=</button>
  </div>
</div>
<script>
  let currentVal = "";
  function press(val) { currentVal += val; document.getElementById('screen').innerText = currentVal; }
  function clearScr() { currentVal = ""; document.getElementById('screen').innerText = "0"; }
  function calc() { try { currentVal = eval(currentVal).toString(); document.getElementById('screen').innerText = currentVal; } catch(e) { document.getElementById('screen').innerText = "Error"; } }
</script>
</body>
</html>`,
        landing: `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: sans-serif; margin: 0; background: #090a0f; color: #fff; text-align: center; }
  header { padding: 60px 20px; background: radial-gradient(circle, #1e1b4b 0%, #090a0f 100%); }
  h1 { font-size: 3rem; color: #6366f1; margin: 0; }
  p { font-size: 1.2rem; color: #94a3b8; margin-top: 10px; }
  .btn { display: inline-block; padding: 12px 28px; background: #06b6d4; color: #fff; text-decoration: none; border-radius: 30px; font-weight: 600; margin-top: 20px; transition: 0.3s; }
  .btn:hover { box-shadow: 0 0 15px #06b6d4; }
</style>
</head>
<body>
  <header>
    <h1>Luna 2.0 Launchpad</h1>
    <p>The collaborative space is officially alive.</p>
    <a href="#" class="btn">Get Started</a>
  </header>
</body>
</html>`
    };

    // Initialize UI Elements
    const elements = {
        tabDesktop: document.getElementById('tab-desktop'),
        tabDrive: document.getElementById('tab-drive'),
        paneDesktop: document.getElementById('pane-desktop'),
        paneDrive: document.getElementById('pane-drive'),
        btnPullDesktop: document.getElementById('btn-pull-desktop'),
        fileDropzone: document.getElementById('file-dropzone'),
        desktopFilesList: document.getElementById('desktop-files-list'),
        driveFilesList: document.getElementById('drive-files-list'),
        scheduledSyncsList: document.getElementById('scheduled-syncs-list'),
        activeSharesList: document.getElementById('active-shares-list'),
        btnTalk: document.getElementById('btn-talk'),
        chatForm: document.getElementById('chat-form'),
        chatInput: document.getElementById('chat-input'),
        btnToggleChat: document.getElementById('btn-toggle-chat'),
        btnCloseChat: document.getElementById('btn-close-chat'),
        chatLogPanel: document.getElementById('chat-log-panel'),
        chatMessages: document.getElementById('chat-messages'),
        tabDrawerChat: document.getElementById('tab-drawer-chat'),
        tabDrawerTranscript: document.getElementById('tab-drawer-transcript'),
        paneDrawerChat: document.getElementById('pane-drawer-chat'),
        paneDrawerTranscript: document.getElementById('pane-drawer-transcript'),
        transcriptMessages: document.getElementById('transcript-messages'),
        transcriptStatus: document.getElementById('transcript-status'),
        btnToggleMute: document.getElementById('btn-toggle-mute'),
        muteIcon: document.getElementById('mute-icon'),
        muteBtnText: document.getElementById('mute-btn-text'),
        
        // State headers
        agentStateDot: document.getElementById('agent-state-dot'),
        agentStateText: document.getElementById('agent-state-text'),

        // Modals
        modalShareViewer: document.getElementById('modal-share-viewer'),
        modalGoogleDocs: document.getElementById('modal-google-docs'),
        modalGmail: document.getElementById('modal-gmail'),
        modalCalendar: document.getElementById('modal-calendar'),
        modalGoogleMeet: document.getElementById('modal-google-meet'),
        modalSandbox: document.getElementById('modal-sandbox'),

        // Close buttons
        btnCloseShareModal: document.getElementById('btn-close-share-modal'),
        btnCloseGdocs: document.getElementById('btn-close-gdocs'),
        btnCloseGmail: document.getElementById('btn-close-gmail'),
        btnCloseCalendar: document.getElementById('btn-close-calendar'),
        btnCloseSandbox: document.getElementById('btn-close-sandbox'),

        // Meet triggers
        btnOpenMeet: document.getElementById('btn-open-meet'),
        btnOpenSandbox: document.getElementById('btn-open-sandbox'),

        // Share preview
        sharePreviewTitle: document.getElementById('share-preview-title'),
        sharePreviewContent: document.getElementById('share-preview-content'),
        shareUrlInput: document.getElementById('share-url-input'),
        btnCopyShareUrl: document.getElementById('btn-copy-share-url'),

        // Integration open buttons
        btnOpenDoc: document.getElementById('btn-open-doc'),
        btnOpenMail: document.getElementById('btn-open-mail'),
        btnOpenCal: document.getElementById('btn-open-cal'),

        // Integrations form triggers
        gmailForm: document.getElementById('gmail-form'),
        gmailTo: document.getElementById('gmail-to'),
        gmailSubject: document.getElementById('gmail-subject'),
        gmailMessage: document.getElementById('gmail-message'),
        gmailAttachmentContainer: document.getElementById('gmail-attachment-container'),
        gmailAttachmentName: document.getElementById('gmail-attachment-name'),
        btnRemoveAttachment: document.getElementById('btn-remove-attachment'),
        btnGmailAttachActive: document.getElementById('btn-gmail-attach-active'),
        
        gdocsTitle: document.getElementById('gdocs-filename'),
        gdocsEditor: document.getElementById('gdocs-editor-textarea'),
        
        calForm: document.getElementById('calendar-form'),
        calTitle: document.getElementById('cal-title'),
        calDate: document.getElementById('cal-date'),
        calTime: document.getElementById('cal-time'),
        calGuests: document.getElementById('cal-guests'),
        calMeetLink: document.getElementById('cal-meet-link'),
        calDesc: document.getElementById('cal-desc'),

        // Meet Controls & Video elements
        meetUserVideo: document.getElementById('meet-user-video'),
        meetVideoFallback: document.getElementById('meet-video-fallback'),
        meetCaptions: document.getElementById('meet-captions'),
        btnMeetToggleMic: document.getElementById('btn-meet-toggle-mic'),
        btnMeetToggleVideo: document.getElementById('btn-meet-toggle-video'),
        btnMeetEnd: document.getElementById('btn-meet-end'),

        // Sandbox Controls
        btnSandboxRun: document.getElementById('btn-sandbox-run'),
        sandboxCodeEditor: document.getElementById('sandbox-code-editor'),
        sandboxPreviewIframe: document.getElementById('sandbox-preview-iframe'),

        toast: document.getElementById('toast'),
        toastMessage: document.getElementById('toast-message')
    };

    // Auto-populate Google Drive mock files on load (click-free cloud storage)
    state.driveFiles = [...mockDriveFiles];
    renderDriveFileList();

    // Tab switcher listeners
    elements.tabDesktop.addEventListener('click', () => switchTab('desktop'));
    elements.tabDrive.addEventListener('click', () => switchTab('drive'));

    function switchTab(target) {
        if (target === 'desktop') {
            elements.tabDesktop.classList.add('active');
            elements.tabDrive.classList.remove('active');
            elements.paneDesktop.classList.add('active');
            elements.paneDrive.classList.remove('active');
        } else {
            elements.tabDesktop.classList.remove('active');
            elements.tabDrive.classList.add('active');
            elements.paneDesktop.classList.remove('active');
            elements.paneDrive.classList.add('active');
        }
    }

    // 3. Setup Web Speech Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        state.recognition = new SpeechRecognition();
        state.recognition.continuous = false;
        state.recognition.interimResults = false;
        state.recognition.lang = 'en-US';

        state.recognition.onstart = () => {
            state.speechActive = true;
            elements.btnTalk.classList.add('listening');
            setAgentState('listening');
        };

        state.recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            elements.chatInput.value = transcript;
            handleUserMessage(transcript);
        };

        state.recognition.onerror = (e) => {
            console.error("Speech recognition error:", e);
            showToast("Speech input issue. You can still type!");
            elements.btnTalk.classList.remove('listening');
            setAgentState('idle');
            state.speechActive = false;
        };

        state.recognition.onend = () => {
            elements.btnTalk.classList.remove('listening');
            state.speechActive = false;
            if (orb.state === 'listening') {
                setAgentState('idle');
            }
        };
    }

    // 4. Setup Speech Synthesis (Voices list)
    function loadVoices() {
        state.voices = window.speechSynthesis.getVoices();
    }
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    function speakText(text) {
        window.speechSynthesis.cancel();
        
        if (state.muted) {
            console.log("[Luna 2.0 Hub] Mute active. Speech blocked for text:", text);
            setAgentState('idle');
            return;
        }
        
        // Broadcast speech text to Google Meet tab
        broadcastState({ text: text });

        const utterance = new SynthesisUtteranceWrapper(text);
        
        // Find a suitable premium voice
        const preferredVoices = ['Google US English', 'Microsoft Zira', 'Samantha', 'Daniel'];
        let selectedVoice = state.voices[0];
        for (let name of preferredVoices) {
            let found = state.voices.find(v => v.name.includes(name));
            if (found) {
                selectedVoice = found;
                break;
            }
        }
        utterance.voice = selectedVoice;
        utterance.rate = 1.0;
        utterance.pitch = 1.05;

        utterance.onstart = () => {
            setAgentState('speaking');
            if (state.meetActive) {
                updateMeetCaptions(text);
            }
        };

        utterance.onend = () => {
            setAgentState('idle');
            if (state.meetActive) {
                setTimeout(() => {
                    updateMeetCaptions("Captions active. Speak into your microphone...");
                }, 2000);
            }
        };

        window.speechSynthesis.speak(utterance);
    }

    // Fallback/Standard support for voice instantiation wrapper
    function SynthesisUtteranceWrapper(text) {
        return new (window.SpeechSynthesisUtterance || window.webkitSpeechSynthesisUtterance)(text);
    }

    function setAgentState(status) {
        orb.setState(status);
        elements.agentStateDot.className = `state-dot ${status}`;
        
        let label = 'Luna 2.0 is Idle';
        if (status === 'listening') label = 'Luna 2.0 is Listening...';
        if (status === 'thinking') label = 'Luna 2.0 is Thinking...';
        if (status === 'speaking') label = 'Luna 2.0 is Speaking...';
        
        elements.agentStateText.textContent = label;

        // Broadcast visual state to Google Meet tab
        broadcastState({ state: status });
    }

    function showToast(message) {
        elements.toastMessage.textContent = message;
        elements.toast.classList.remove('hidden');
        setTimeout(() => {
            elements.toast.classList.add('hidden');
        }, 3000);
    }

    // 5. Chat & Conversational Input Routing
    elements.chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = elements.chatInput.value.trim();
        if (!query) return;
        elements.chatInput.value = '';
        handleUserMessage(query);
    });

    elements.btnTalk.addEventListener('click', async () => {
        // Interrupt any active agent voice playback instantly
        broadcastState({ cancel: true });

        await orb.connectMicrophone();
        if (!state.recognition) {
            showToast("Speech recognition is not supported. Type in the bar!");
            return;
        }
        if (state.speechActive) {
            state.recognition.stop();
        } else {
            state.recognition.start();
        }
    });

    function addMessageToLog(sender, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;
        
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.textContent = text;
        
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        const now = new Date();
        meta.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        msgDiv.appendChild(bubble);
        msgDiv.appendChild(meta);
        elements.chatMessages.appendChild(msgDiv);
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

        if (!state.chatOpen) {
            toggleChatPanel(true);
        }
    }

    function addTranscriptSegment(speaker, text) {
        if (elements.transcriptStatus) {
            elements.transcriptStatus.textContent = "Receiving live captions...";
        }

        const msgDiv = document.createElement('div');
        msgDiv.className = 'transcript-segment';
        msgDiv.style.background = 'rgba(255, 255, 255, 0.03)';
        msgDiv.style.borderLeft = '3px solid var(--accent)';
        msgDiv.style.padding = '10px 12px';
        msgDiv.style.borderRadius = '0 8px 8px 0';
        msgDiv.style.display = 'flex';
        msgDiv.style.flexDirection = 'column';
        msgDiv.style.gap = '4px';

        const headerDiv = document.createElement('div');
        headerDiv.style.display = 'flex';
        headerDiv.style.justifyContent = 'space-between';
        headerDiv.style.alignItems = 'center';
        headerDiv.style.width = '100%';

        const speakerSpan = document.createElement('span');
        speakerSpan.style.fontWeight = '600';
        speakerSpan.style.fontSize = '0.75rem';
        speakerSpan.style.color = '#fff';
        speakerSpan.textContent = speaker;

        const timeSpan = document.createElement('span');
        timeSpan.style.fontSize = '0.65rem';
        timeSpan.style.color = 'rgba(255, 255, 255, 0.4)';
        const now = new Date();
        timeSpan.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        headerDiv.appendChild(speakerSpan);
        headerDiv.appendChild(timeSpan);

        const textDiv = document.createElement('div');
        textDiv.style.fontSize = '0.75rem';
        textDiv.style.lineHeight = '1.4';
        textDiv.style.color = 'rgba(255, 255, 255, 0.85)';
        textDiv.textContent = text;

        msgDiv.appendChild(headerDiv);
        msgDiv.appendChild(textDiv);

        elements.transcriptMessages.appendChild(msgDiv);
        elements.transcriptMessages.scrollTop = elements.transcriptMessages.scrollHeight;
    }

    function handleUserMessage(query) {
        // Interrupt any active agent voice playback instantly
        broadcastState({ cancel: true });

        addMessageToLog('user', query);
        setAgentState('thinking');
        
        // Post user message directly to the server orchestration brain
        fetch('/api/events/to-hub', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'MEET_CHAT',
                sender: 'user',
                text: query
            })
        }).catch(err => {
            console.error("[Luna Hub] Failed to send user message to server:", err);
        });
    }

    // 6. Desktop & Google Drive Browsing
    elements.btnPullDesktop.addEventListener('click', () => triggerPullDesktop());

    async function triggerPullDesktop() {
        if (window.showDirectoryPicker) {
            try {
                showToast("Selecting workspace folder...");
                const dirHandle = await window.showDirectoryPicker();
                state.desktopFiles = [];
                
                for await (const entry of dirHandle.values()) {
                    if (entry.kind === 'file') {
                        const file = await entry.getFile();
                        let content = 'Binary content preview';
                        if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.html')) {
                            content = await file.text();
                        }
                        state.desktopFiles.push({
                            name: file.name,
                            size: file.size,
                            type: file.type,
                            content: content
                        });
                    }
                }
                renderDesktopFileList();
                showToast("Desktop directory synced successfully!");
            } catch (err) {
                console.warn("Picker error or cancelled, loading mocks: ", err);
                loadMockDesktopData();
            }
        } else {
            loadMockDesktopData();
        }
    }

    function loadMockDesktopData() {
        state.desktopFiles = [...mockDesktopFiles];
        renderDesktopFileList();
        showToast("Synchronized mock desktop environment.");
    }

    function renderDesktopFileList() {
        elements.desktopFilesList.replaceChildren();
        if (state.desktopFiles.length === 0) {
            const emptyLi = document.createElement('li');
            emptyLi.className = 'empty-state';
            emptyLi.textContent = 'No desktop files loaded';
            elements.desktopFilesList.appendChild(emptyLi);
            return;
        }
        populateFileList(state.desktopFiles, elements.desktopFilesList);
    }

    function renderDriveFileList() {
        elements.driveFilesList.replaceChildren();
        populateFileList(state.driveFiles, elements.driveFilesList);
    }

    function populateFileList(filesArray, container) {
        filesArray.forEach(file => {
            const li = document.createElement('li');
            li.className = 'file-item';
            
            const details = document.createElement('div');
            details.className = 'file-details';
            details.style.cursor = 'pointer';
            details.addEventListener('click', () => {
                // Clicking opens details directly in Sandbox Editor if it's text/HTML code!
                if (file.name.endsWith('.html') || file.name.endsWith('.txt')) {
                    openSandbox(file.content);
                    showToast(`Loaded ${file.name} in Sandbox editor.`);
                } else {
                    triggerFileShare(file);
                }
            });
            
            const iconSpan = document.createElement('span');
            iconSpan.className = 'file-icon';
            iconSpan.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
            
            const info = document.createElement('div');
            const nameDiv = document.createElement('div');
            nameDiv.className = 'file-name';
            nameDiv.textContent = file.name;
            
            const sizeDiv = document.createElement('div');
            sizeDiv.className = 'file-size';
            sizeDiv.textContent = formatBytes(file.size);
            
            info.appendChild(nameDiv);
            info.appendChild(sizeDiv);
            details.appendChild(iconSpan);
            details.appendChild(info);
            li.appendChild(details);
            
            const shareBtn = document.createElement('button');
            shareBtn.className = 'btn secondary sm';
            shareBtn.textContent = 'Share';
            shareBtn.addEventListener('click', () => triggerFileShare(file));
            
            li.appendChild(shareBtn);
            container.appendChild(li);
        });
    }

    // Drag-and-drop
    elements.fileDropzone.addEventListener('dragover', (e) => { e.preventDefault(); elements.fileDropzone.classList.add('dragover'); });
    elements.fileDropzone.addEventListener('dragleave', () => elements.fileDropzone.classList.remove('dragover'));
    elements.fileDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.fileDropzone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            Array.from(files).forEach(async (file) => {
                let content = 'Drop file content binary';
                if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.html')) {
                    content = await file.text();
                }
                state.desktopFiles.push({
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    content: content
                });
            });
            setTimeout(() => {
                renderDesktopFileList();
                showToast("Desktop file imported safely!");
            }, 400);
        }
    });

    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // 7. Web Sharing & Preview System
    function triggerFileShare(file) {
        state.activeFile = file;
        const shareId = Math.random().toString(36).substring(2, 8);
        const shareUrl = `https://agent.live/s/${shareId}`;
        
        let sharedObj = state.sharedFiles.find(s => s.name === file.name);
        if (!sharedObj) {
            sharedObj = {
                name: file.name,
                url: shareUrl,
                views: 0,
                content: file.content,
                type: file.type
            };
            state.sharedFiles.push(sharedObj);
        }
        
        renderActiveShares();
        openWebSharePreview(sharedObj);
        
        elements.gmailAttachmentContainer.classList.remove('hidden');
        elements.gmailAttachmentName.textContent = file.name;
        
        return shareUrl;
    }

    function renderActiveShares() {
        elements.activeSharesList.replaceChildren();
        if (state.sharedFiles.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty-state';
            empty.textContent = 'No files shared yet';
            elements.activeSharesList.appendChild(empty);
            return;
        }

        state.sharedFiles.forEach(shared => {
            const li = document.createElement('li');
            li.className = 'share-item';
            
            const info = document.createElement('div');
            info.className = 'share-info';
            
            const title = document.createElement('span');
            title.className = 'share-title';
            title.textContent = shared.name;
            
            const link = document.createElement('a');
            link.className = 'share-link';
            link.href = '#';
            link.textContent = shared.url;
            link.addEventListener('click', (e) => {
                e.preventDefault();
                shared.views++;
                openWebSharePreview(shared);
            });
            
            info.appendChild(title);
            info.appendChild(link);
            li.appendChild(info);
            
            const analytics = document.createElement('span');
            analytics.style.fontSize = '0.65rem';
            analytics.style.color = 'var(--text-muted)';
            analytics.textContent = `${shared.views} views`;
            
            li.appendChild(analytics);
            elements.activeSharesList.appendChild(li);
        });
    }

    function openWebSharePreview(shared) {
        elements.sharePreviewTitle.textContent = shared.name;
        elements.shareUrlInput.value = shared.url;
        elements.sharePreviewContent.replaceChildren();
        
        if (shared.type.startsWith('image/') || shared.name.endsWith('.png') || shared.name.endsWith('.jpg')) {
            const svgDoc = new DOMParser().parseFromString(`
                <svg width="100%" height="100%" viewBox="0 0 400 250" style="background: linear-gradient(135deg, #1e1b4b, #311042); border-radius: 8px;">
                    <circle cx="200" cy="110" r="50" fill="url(#orb-grad)" filter="drop-shadow(0 0 15px rgba(6,182,212,0.5))"/>
                    <text x="50%" y="195" text-anchor="middle" fill="#94a3b8" font-size="12" font-family="sans-serif">Image Preview: ${shared.name}</text>
                    <defs>
                        <linearGradient id="orb-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="#06b6d4"/>
                            <stop offset="100%" stop-color="#6366f1"/>
                        </linearGradient>
                    </defs>
                </svg>
            `, 'image/svg+xml');
            elements.sharePreviewContent.appendChild(svgDoc.documentElement);
        } else {
            const pre = document.createElement('pre');
            pre.textContent = shared.content;
            elements.sharePreviewContent.appendChild(pre);
        }
        elements.modalShareViewer.classList.add('open');
    }

    elements.btnCopyShareUrl.addEventListener('click', () => {
        elements.shareUrlInput.select();
        document.execCommand('copy');
        showToast("Copied public link to clipboard!");
    });

    // 8. Sandbox Prototype Builder
    elements.btnOpenSandbox.addEventListener('click', () => openSandbox());
    elements.btnSandboxRun.addEventListener('click', () => executeSandboxCode());

    function openSandbox(initialCode = "") {
        if (initialCode) {
            elements.sandboxCodeEditor.value = initialCode;
        } else if (!elements.sandboxCodeEditor.value.trim() || elements.sandboxCodeEditor.value === '<!-- Write prototypes here -->') {
            elements.sandboxCodeEditor.value = templates.landing;
        }
        elements.modalSandbox.classList.add('open');
        executeSandboxCode();
    }

    function executeSandboxCode() {
        const code = elements.sandboxCodeEditor.value;
        // Injecting editor HTML directly into mock viewport frame
        elements.sandboxPreviewIframe.srcdoc = code;
        showToast("Prototype updated and executed!");
    }

    // 9. Google Meet Call Simulation
    elements.btnOpenMeet.addEventListener('click', () => startGoogleMeet());
    elements.btnMeetEnd.addEventListener('click', () => endGoogleMeet());

    async function startGoogleMeet() {
        state.meetActive = true;
        elements.modalGoogleMeet.classList.add('open');
        
        // Relocate Luna 2.0's Visual Orb Canvas rendering target to Google Meet Tile!
        orb.canvas = document.getElementById('meet-orb-canvas');
        orb.resize();

        // Request webcam access
        try {
            const constraints = { video: { width: 400, height: 300 }, audio: false };
            state.meetStream = await navigator.mediaDevices.getUserMedia(constraints);
            elements.meetUserVideo.srcObject = state.meetStream;
            elements.meetUserVideo.classList.remove('hidden');
            elements.meetVideoFallback.classList.add('hidden');
        } catch (e) {
            console.warn("Webcam blocked or unavailable, using avatar placeholder:", e);
            elements.meetUserVideo.classList.add('hidden');
            elements.meetVideoFallback.classList.remove('hidden');
        }
        
        updateMeetCaptions("Connected. Luna 2.0 has joined the meeting call.");
        showToast("Google Meet call successfully started.");
    }

    function endGoogleMeet() {
        state.meetActive = false;
        elements.modalGoogleMeet.classList.remove('open');
        
        // Stop user camera stream
        if (state.meetStream) {
            state.meetStream.getTracks().forEach(track => track.stop());
            state.meetStream = null;
        }
        
        // Restore Luna 2.0's Canvas target back to the central console!
        orb.canvas = document.getElementById('orb-canvas');
        orb.resize();
        
        showToast("Google Meet call ended.");
    }

    function updateMeetCaptions(text) {
        elements.meetCaptions.textContent = text;
    }

    elements.btnMeetToggleMic.addEventListener('click', () => {
        state.meetMicActive = !state.meetMicActive;
        elements.btnMeetToggleMic.className = `meet-ctrl-btn ${state.meetMicActive ? 'active' : 'inactive'}`;
        showToast(state.meetMicActive ? "Microphone enabled" : "Microphone muted");
    });

    elements.btnMeetToggleVideo.addEventListener('click', () => {
        state.meetVideoActive = !state.meetVideoActive;
        elements.btnMeetToggleVideo.className = `meet-ctrl-btn ${state.meetVideoActive ? 'active' : 'inactive'}`;
        if (state.meetStream) {
            state.meetStream.getVideoTracks().forEach(track => track.enabled = state.meetVideoActive);
        }
        elements.meetUserVideo.style.display = state.meetVideoActive ? 'block' : 'none';
        elements.meetVideoFallback.classList.toggle('hidden', state.meetVideoActive);
    });

    // 10. Workspace Overlay Syncs (Docs, Mail, Calendar)
    elements.btnOpenDoc.addEventListener('click', () => openGoogleDocs());
    elements.btnOpenMail.addEventListener('click', () => openGmailDraft());
    elements.btnOpenCal.addEventListener('click', () => openCalendarPlanner());

    function openGoogleDocs() {
        elements.gdocsTitle.value = state.activeFile ? `Review: ${state.activeFile.name}` : "Prototyping aligning specs";
        
        let initialDocContent = "Luna 2.0 Summary specifications:\n\n";
        if (state.activeFile) {
            initialDocContent += `Imported: ${state.activeFile.name}\n`;
            initialDocContent += `-----------------------------------------\n`;
            initialDocContent += state.activeFile.content;
        } else {
            const bubbleElements = elements.chatMessages.querySelectorAll('.message-bubble');
            if (bubbleElements.length > 0) {
                initialDocContent += "Transcripts:\n";
                bubbleElements.forEach(bubble => {
                    initialDocContent += `- ${bubble.textContent}\n`;
                });
            } else {
                initialDocContent += "No interactive dialogue streams collected. Let's start typing!";
            }
        }
        elements.gdocsEditor.textContent = initialDocContent;
        elements.modalGoogleDocs.classList.add('open');
    }

    function openGmailDraft() {
        elements.gmailTo.value = "charitydupont@google.com";
        elements.gmailSubject.value = state.activeFile ? `Prototyping Draft: ${state.activeFile.name}` : "Luna 2.0 Prototyping Notes";
        
        let mailBody = "Hi Charity,\n\n";
        if (state.activeFile) {
            mailBody += `I've shared the file "${state.activeFile.name}" with you.\n`;
            const matchingShare = state.sharedFiles.find(s => s.name === state.activeFile.name);
            if (matchingShare) {
                mailBody += `Link: ${matchingShare.url}\n`;
            }
        } else {
            mailBody += "Here are the notes from my current active session.";
        }
        mailBody += "\n\nBest,\nLuna 2.0";
        elements.gmailMessage.value = mailBody;
        
        if (state.activeFile) {
            elements.gmailAttachmentContainer.classList.remove('hidden');
            elements.gmailAttachmentName.textContent = state.activeFile.name;
        }
        elements.modalGmail.classList.add('open');
    }

    function openCalendarPlanner() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        elements.calDate.value = tomorrow.toISOString().split('T')[0];
        elements.calTitle.value = "Alignment Sync with Luna 2.0";
        
        // Generate random realistic Meet link
        const p1 = Math.random().toString(36).substring(2, 5);
        const p2 = Math.random().toString(36).substring(2, 6);
        const p3 = Math.random().toString(36).substring(2, 5);
        elements.calMeetLink.value = `https://meet.google.com/${p1}-${p2}-${p3}`;
        
        let desc = "Reviewing prototyping sandbox files.";
        if (state.activeFile) {
            desc += `\n\nAttachments: ${state.activeFile.name}`;
        }
        elements.calDesc.value = desc;
        elements.modalCalendar.classList.add('open');
    }

    elements.btnCloseShareModal.addEventListener('click', () => elements.modalShareViewer.classList.remove('open'));
    elements.btnCloseGdocs.addEventListener('click', () => elements.modalGoogleDocs.classList.remove('open'));
    elements.btnCloseGmail.addEventListener('click', () => elements.modalGmail.classList.remove('open'));
    elements.btnCloseCalendar.addEventListener('click', () => elements.modalCalendar.classList.remove('open'));
    elements.btnCloseSandbox.addEventListener('click', () => elements.modalSandbox.classList.remove('open'));

    elements.gmailForm.addEventListener('submit', (e) => {
        e.preventDefault();
        elements.modalGmail.classList.remove('open');
        showToast("Gmail draft successfully sent to charitydupont@google.com!");
    });

    elements.calForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const newMeeting = {
            title: elements.calTitle.value,
            date: elements.calDate.value,
            time: elements.calTime.value,
            meetUrl: elements.calMeetLink.value,
            desc: elements.calDesc.value
        };
        
        state.meetings.push(newMeeting);
        renderCalendarMeetings();
        
        elements.modalCalendar.classList.remove('open');
        showToast("Calendar meeting scheduled and Luna 2.0 added!");
    });

    function renderCalendarMeetings() {
        elements.scheduledSyncsList.replaceChildren();
        
        if (state.meetings.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty-state';
            empty.textContent = 'No meetings scheduled';
            elements.scheduledSyncsList.appendChild(empty);
            return;
        }
        
        state.meetings.forEach((meet) => {
            const li = document.createElement('li');
            li.className = 'share-item';
            
            const info = document.createElement('div');
            info.className = 'share-info';
            
            const title = document.createElement('span');
            title.className = 'share-title';
            title.textContent = meet.title;
            
            const timeSpan = document.createElement('span');
            timeSpan.style.fontSize = '0.7rem';
            timeSpan.style.color = 'var(--text-secondary)';
            timeSpan.textContent = `${meet.date} at ${meet.time}`;
            
            const link = document.createElement('a');
            link.className = 'share-link';
            link.href = meet.meetUrl;
            link.target = '_blank';
            link.textContent = meet.meetUrl;
            
            info.appendChild(title);
            info.appendChild(timeSpan);
            info.appendChild(link);
            li.appendChild(info);
            
            const connectBtn = document.createElement('button');
            connectBtn.className = 'btn primary sm';
            connectBtn.style.padding = '4px 8px';
            connectBtn.style.fontSize = '0.7rem';
            connectBtn.textContent = 'Add Luna 2.0';
            
            connectBtn.addEventListener('click', () => {
                showToast("Adding Luna 2.0 to Call...");
                connectBtn.textContent = 'Connecting...';
                connectBtn.disabled = true;
                
                // POST to local Node.js API to run Chrome script
                fetch('/api/join-meet', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: meet.meetUrl })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        showToast("Luna 2.0 has joined the call!");
                        connectBtn.textContent = 'In Call';
                        connectBtn.style.background = 'var(--accent-green)';
                    } else {
                        showToast("Connection failed: " + data.error);
                        connectBtn.textContent = 'Add Luna 2.0';
                        connectBtn.disabled = false;
                    }
                })
                .catch(err => {
                    console.error("Join Meet error:", err);
                    showToast("Failed to connect Luna 2.0. Check server status.");
                    connectBtn.textContent = 'Add Luna 2.0';
                    connectBtn.disabled = false;
                });
            });
            
            li.appendChild(connectBtn);
            elements.scheduledSyncsList.appendChild(li);
        });
    }

    elements.btnGmailAttachActive.addEventListener('click', () => {
        if (state.activeFile) {
            elements.gmailAttachmentContainer.classList.remove('hidden');
            elements.gmailAttachmentName.textContent = state.activeFile.name;
            showToast(`Attached active file: ${state.activeFile.name}`);
        } else {
            showToast("No active file. Choose a file from desktop or drive first.");
        }
    });

    elements.btnRemoveAttachment.addEventListener('click', () => {
        elements.gmailAttachmentContainer.classList.add('hidden');
        showToast("Attachment removed.");
    });

    elements.gdocsEditor.addEventListener('input', () => {
        const indicator = elements.modalGoogleDocs.querySelector('.saving-status');
        indicator.textContent = "Saving...";
        setTimeout(() => {
            indicator.textContent = "Saved to Drive";
        }, 1000);
    });

    // 11. Right Chat Drawer Toggles
    function toggleChatPanel(forceState = null) {
        state.chatOpen = forceState !== null ? forceState : !state.chatOpen;
        if (state.chatOpen) {
            elements.chatLogPanel.classList.add('open');
            elements.btnToggleChat.classList.add('secondary');
        } else {
            elements.chatLogPanel.classList.remove('open');
            elements.btnToggleChat.classList.remove('secondary');
        }
    }

    function switchDrawerTab(target) {
        if (target === 'chat') {
            elements.tabDrawerChat.classList.add('active');
            elements.tabDrawerTranscript.classList.remove('active');
            elements.paneDrawerChat.style.display = 'flex';
            elements.paneDrawerTranscript.style.display = 'none';
        } else {
            elements.tabDrawerChat.classList.remove('active');
            elements.tabDrawerTranscript.classList.add('active');
            elements.paneDrawerChat.style.display = 'none';
            elements.paneDrawerTranscript.style.display = 'flex';
        }
    }

    if (elements.tabDrawerChat && elements.tabDrawerTranscript) {
        elements.tabDrawerChat.addEventListener('click', () => switchDrawerTab('chat'));
        elements.tabDrawerTranscript.addEventListener('click', () => switchDrawerTab('transcript'));
    }

    function toggleMute() {
        state.muted = !state.muted;
        if (state.muted) {
            elements.btnToggleMute.classList.add('muted-active');
            elements.btnToggleMute.style.background = 'rgba(234, 67, 53, 0.2)';
            elements.btnToggleMute.style.color = '#ea4335';
            elements.btnToggleMute.style.borderColor = '#ea4335';
            elements.muteBtnText.textContent = "Unmute Luna";
            
            const w1 = document.getElementById('mute-wave-1');
            const w2 = document.getElementById('mute-wave-2');
            if (w1) w1.style.display = 'none';
            if (w2) w2.style.display = 'none';
            
            // Cancel current playback
            broadcastState({ cancel: true });
            showToast("Luna has been muted.");
        } else {
            elements.btnToggleMute.classList.remove('muted-active');
            elements.btnToggleMute.style.background = '';
            elements.btnToggleMute.style.color = '';
            elements.btnToggleMute.style.borderColor = '';
            elements.muteBtnText.textContent = "Mute Luna";
            
            const w1 = document.getElementById('mute-wave-1');
            const w2 = document.getElementById('mute-wave-2');
            if (w1) w1.style.display = '';
            if (w2) w2.style.display = '';
            
            showToast("Luna has been unmuted.");
        }
    }

    if (elements.btnToggleMute) {
        elements.btnToggleMute.addEventListener('click', toggleMute);
    }

    elements.btnToggleChat.addEventListener('click', () => toggleChatPanel());
    elements.btnCloseChat.addEventListener('click', () => toggleChatPanel(false));
    
    // 12. Quick Connect Event Listener
    const btnQuickConnect = document.getElementById('btn-quick-connect');
    const quickMeetUrl = document.getElementById('quick-meet-url');
    
    if (btnQuickConnect && quickMeetUrl) {
        btnQuickConnect.addEventListener('click', () => {
            const url = quickMeetUrl.value.trim();
            if (!url) {
                showToast("Please enter a Google Meet link.");
                return;
            }
            showToast("Adding Luna 2.0 to Call...");
            btnQuickConnect.textContent = 'Connecting...';
            btnQuickConnect.disabled = true;
            
            fetch('/api/join-meet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url })
            })
            .then(res => res.json())
            .then(data => {
                btnQuickConnect.textContent = 'Connect Luna';
                btnQuickConnect.disabled = false;
                if (data.success) {
                    showToast("Luna 2.0 has joined the call!");
                    quickMeetUrl.value = '';
                } else {
                    showToast("Connection failed: " + data.error);
                }
            })
            .catch(err => {
                console.error("Quick join error:", err);
                showToast("Failed to connect Luna 2.0. Check server status.");
                btnQuickConnect.textContent = 'Connect Luna';
                btnQuickConnect.disabled = false;
            });
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            e.target.classList.remove('open');
        }
    });
});

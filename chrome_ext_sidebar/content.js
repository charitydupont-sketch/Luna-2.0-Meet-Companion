console.log('Thoughtform content script loaded.');

const observerOptions = {
  childList: true,
  subtree: true,
  characterData: true
};

let retryCount = 0;
const MAX_RETRIES = 30;
let observerAttached = false;
let observer = null;
let documentObserver = null;
let captureEnabled = false;
let participantInterval = null;
let lastParticipantList = '';
let selfName = null;

const captionBlockStates = new Map();
let lastSentTime = 0;
let currentMeetUrl = window.location.href;
let urlCheckInterval = null;

function resetTranscriptState() {
  console.log('TF Resetting transcript state for new meeting');
  captionBlockStates.clear();
  lastSentTime = 0;
  selfName = null;
  lastParticipantList = '';
  retryCount = 0;
}

function sendMessageSafely(message) {
  if (chrome.runtime?.id) {
    chrome.runtime.sendMessage(message).catch(error => {
      if (error.message?.includes('Extension context invalidated')) {
        console.log('TF Extension was reloaded. Please refresh this page.');
        cleanupEverything();
      } else {
        console.error('TF Error sending message:', error);
      }
    });
  } else {
    console.log('TF Extension context invalidated, stopping observer.');
    cleanupEverything();
  }
}

function cleanupObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  observerAttached = false;
}

function cleanupDocumentObserver() {
  if (documentObserver) {
    documentObserver.disconnect();
    documentObserver = null;
  }
}

function cleanupEverything() {
  cleanupObserver();
  cleanupDocumentObserver();
  stopParticipantPolling();
  if (urlCheckInterval) {
    clearInterval(urlCheckInterval);
    urlCheckInterval = null;
  }
}

function clickCCButton() {
  const turnOnButton = document.querySelector('[aria-label="Turn on captions"]') ||
                       document.querySelector('[data-tooltip="Turn on captions"]');
  
  if (turnOnButton) {
    console.log('TF Auto-clicking CC button (turn on)');
    turnOnButton.click();
    return true;
  }
  
  const isCaptionsOn = document.querySelector('div[aria-label="Captions"]') !== null;
  if (isCaptionsOn) {
    console.log('TF Captions already on');
    return true;
  }
  
  return false;
}

function turnOffCaptions() {
  const turnOffButton = document.querySelector('[aria-label="Turn off captions"]') ||
                        document.querySelector('[data-tooltip="Turn off captions"]');
  
  if (turnOffButton) {
    console.log('TF Turning off captions');
    turnOffButton.click();
    return true;
  }
  return false;
}

function extractAndSendCaptions(captionsContainer) {
  if (!captureEnabled) return;
  
  const captionBlocks = captionsContainer.querySelectorAll('.nMcdL.bj4p3b');
  
  if (captionBlocks.length === 0) return;
  
  const lastBlock = captionBlocks[captionBlocks.length - 1];
  const speakerElement = lastBlock.querySelector('.NWpY1d');
  const textElement = lastBlock.querySelector('.ygicle.VbkSUe');
  
  if (!speakerElement || !textElement) return;
  
  let speaker = speakerElement.textContent.trim();
  const fullText = textElement.textContent.trim();
  
  if (speaker === 'You' && selfName) {
    speaker = selfName;
  } else if (speaker === 'You' && !selfName) {
    selfName = findSelfName();
    if (selfName) {
      console.log('TF Self name detected:', selfName);
      speaker = selfName;
    }
  }
  
  if (!fullText) return;
  
  const blockId = lastBlock.getAttribute('data-tf-id') || `block_${Date.now()}`;
  if (!lastBlock.getAttribute('data-tf-id')) {
    lastBlock.setAttribute('data-tf-id', blockId);
  }
  
  const prevState = captionBlockStates.get(blockId);
  const now = Date.now();
  
  if (!prevState) {
    captionBlockStates.set(blockId, { text: fullText, speaker: speaker });
    sendMessageSafely({
      type: 'NEW_CAPTION',
      payload: { 
        speaker, 
        caption: fullText, 
        timestamp: new Date().toISOString(),
        blockId: blockId,
        isNewBlock: true
      }
    });
  } else if (fullText !== prevState.text) {
    captionBlockStates.set(blockId, { text: fullText, speaker: speaker });
    
    if (now - lastSentTime > 200) {
      lastSentTime = now;
      sendMessageSafely({
        type: 'NEW_CAPTION',
        payload: { 
          speaker, 
          caption: fullText,
          timestamp: new Date().toISOString(),
          blockId: blockId,
          isNewBlock: false
        }
      });
    }
  }
  
  for (const [id] of captionBlockStates) {
    let found = false;
    captionBlocks.forEach(b => {
      if (b.getAttribute('data-tf-id') === id) found = true;
    });
    if (!found) {
      captionBlockStates.delete(id);
    }
  }
}

function handleMutations(mutationsList, observerRef) {
  const captionsContainer = document.querySelector('div[aria-label="Captions"]');
  if (!captionsContainer) return;
  
  extractAndSendCaptions(captionsContainer);
}

function isInMeeting() {
  return window.location.pathname.length > 1 && 
         !window.location.pathname.includes('/lookup/') &&
         document.querySelector('[data-call-ended]') === null;
}

function attachCaptionObserver() {
  const captionsContainer = document.querySelector('div[aria-label="Captions"]');
  
  if (captionsContainer && !observerAttached) {
    cleanupObserver();
    observer = new MutationObserver(handleMutations);
    observer.observe(captionsContainer, observerOptions);
    observerAttached = true;
    console.log('TF Caption observer attached');
    extractAndSendCaptions(captionsContainer);
  } else if (!captionsContainer && observerAttached) {
    console.log('TF Captions container removed, cleaning up observer');
    cleanupObserver();
  }
}

function handleDocumentMutations() {
  if (!captureEnabled) return;
  attachCaptionObserver();
}

function startDocumentObserver() {
  if (documentObserver) return;
  
  documentObserver = new MutationObserver(handleDocumentMutations);
  documentObserver.observe(document.body, { childList: true, subtree: true });
  console.log('TF Document observer started');
}

function startObserver() {
  const captionsContainer = document.querySelector('div[aria-label="Captions"]');
  
  if (captionsContainer) {
    attachCaptionObserver();
    startDocumentObserver();
  } else if (retryCount < MAX_RETRIES && isInMeeting()) {
    retryCount++;
    console.log('TF Waiting for captions container, retry', retryCount);
    
    if (captureEnabled && retryCount === 3) {
      clickCCButton();
    }
    
    setTimeout(startObserver, 2000);
  } else if (retryCount >= MAX_RETRIES) {
    console.log('TF Stopped looking for captions container after max retries.');
    startDocumentObserver();
  }
}

function reinitialize() {
  console.log('TF Reinitializing capture...');
  cleanupObserver();
  retryCount = 0;
  
  setTimeout(() => {
    if (!clickCCButton()) {
      console.log('TF CC button not found, will retry');
    }
    startObserver();
  }, 500);
}

function findSelfName() {
  const participantItems = document.querySelectorAll('.VfPpkd-StrnGf-rymPhb-ibnC6b, [data-participant-id], .cS7aqe.NkoVdd');
  for (const item of participantItems) {
    const nameEl = item.querySelector('.zWGUib, .adnwBd, .NWpY1d');
    if (nameEl) {
      const rawText = nameEl.innerText || nameEl.textContent || '';
      const firstLine = rawText.split('\n')[0].trim();
      if (rawText.includes('(You)') || item.textContent?.includes('(You)')) {
        const name = firstLine.replace(/\s*\(You\)\s*$/, '').trim();
        if (name && name.length > 1) {
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
        return name;
      }
    }
  }
  
  try {
    if (window.WIZ_global_data && window.WIZ_global_data.oPEP7c) {
      const email = window.WIZ_global_data.oPEP7c;
      const username = email.split('@')[0];
      return username.charAt(0).toUpperCase() + username.slice(1);
    }
  } catch (e) {}
  
  return null;
}

function extractParticipants() {
  const participants = new Set();
  
  if (!selfName) {
    selfName = findSelfName();
  }
  
  if (selfName) {
    participants.add(selfName);
  }
  
  const participantItems = document.querySelectorAll('.VfPpkd-StrnGf-rymPhb-OWXEXe-GN1Vxc, .cS7aqe.NkoVdd, [data-participant-id]');
  participantItems.forEach(item => {
    const nameEl = item.querySelector('.zWGUib, .adnwBd, .NWpY1d');
    if (nameEl) {
      const rawText = nameEl.innerText || nameEl.textContent || '';
      let name = rawText.split('\n')[0].trim();
      name = name.replace(/\s*\(You\)\s*$/, '').trim();
      if (name === 'You' && selfName) {
        name = selfName;
      }
      if (name && name !== 'You' && name.length > 1) {
        participants.add(name);
      }
    }
  });
  
  const videoTiles = document.querySelectorAll('[data-requested-participant-id], [data-participant-id]');
  videoTiles.forEach(tile => {
    const nameEl = tile.querySelector('.XEazBc .adnwBd, .zWGUib, .NWpY1d');
    if (nameEl) {
      const rawText = nameEl.innerText || nameEl.textContent || '';
      let name = rawText.split('\n')[0].trim();
      name = name.replace(/\s*\(You\)\s*$/, '').trim();
      if (name === 'You' && selfName) {
        name = selfName;
      }
      if (name && name !== 'You' && name.length > 1) {
        participants.add(name);
      }
    }
  });
  
  const count = Math.max(1, participants.size);
  
  return {
    count: count,
    names: Array.from(participants),
    selfName: selfName
  };
}

function startParticipantPolling() {
  if (participantInterval) return;
  
  participantInterval = setInterval(() => {
    if (!captureEnabled) return;
    
    const participants = extractParticipants();
    const participantKey = participants.names.sort().join(',');
    
    if (participantKey !== lastParticipantList) {
      lastParticipantList = participantKey;
      console.log('TF Participants updated:', participants.count, participants.names);
      sendMessageSafely({
        type: 'PARTICIPANTS_UPDATE',
        payload: participants
      });
    }
  }, 5000);
}

function stopParticipantPolling() {
  if (participantInterval) {
    clearInterval(participantInterval);
    participantInterval = null;
  }
}

function openPeoplePanel() {
  const peopleButton = document.querySelector('[data-panel-id="1"], [aria-label*="participant"], [aria-label*="people" i], button[data-tooltip*="people" i]');
  if (peopleButton) {
    const isOpen = peopleButton.getAttribute('aria-pressed') === 'true' || 
                   peopleButton.classList.contains('IeuGXd');
    if (!isOpen) {
      peopleButton.click();
      console.log('TF Opened People panel for participant detection');
    }
  }
}

function initCapture() {
  chrome.storage.local.get(['captureEnabled'], (result) => {
    captureEnabled = result.captureEnabled || false;
    console.log('TF Capture enabled:', captureEnabled);
    
    if (captureEnabled) {
      setTimeout(() => {
        clickCCButton();
        openPeoplePanel();
        startObserver();
        startParticipantPolling();
      }, 3000);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_STATE_CHANGED') {
    captureEnabled = message.enabled;
    console.log('TF Capture state changed:', captureEnabled);
    
    if (captureEnabled) {
      reinitialize();
      openPeoplePanel();
      startParticipantPolling();
    } else {
      turnOffCaptions();
      cleanupObserver();
      stopParticipantPolling();
    }
    sendResponse({ success: true });
  } else if (message.type === 'RESET_TRANSCRIPT_STATE') {
    resetTranscriptState();
    sendResponse({ success: true });
  }
  return true;
});

// Detect URL changes within Meet (navigating between meetings without full page reload)
urlCheckInterval = setInterval(() => {
  if (!chrome.runtime?.id) {
    if (urlCheckInterval) {
      clearInterval(urlCheckInterval);
      urlCheckInterval = null;
    }
    return;
  }
  if (window.location.href !== currentMeetUrl) {
    const oldUrl = currentMeetUrl;
    currentMeetUrl = window.location.href;
    console.log('TF Meet URL changed:', oldUrl, '->', currentMeetUrl);
    resetTranscriptState();
  }
}, 2000);

initCapture();

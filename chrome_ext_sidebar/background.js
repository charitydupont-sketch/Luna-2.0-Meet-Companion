console.log('Thoughtform background service worker loaded.');

const TIME_GAP_THRESHOLD_MS = 1500;

let segments = [];
let currentSegment = null;
let lastCaptionTime = null;
let connectedPorts = [];
let participants = { count: 0, names: [], selfName: null };
let currentMeetingId = null;

// Extract the meeting ID from a Google Meet URL (the path after meet.google.com/)
function getMeetingId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'meet.google.com') {
      // The meeting code is the first path segment, e.g. /abc-defg-hij
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0 && pathParts[0] !== 'lookup') {
        return pathParts[0];
      }
    }
  } catch (e) {}
  return null;
}

function clearAllSegments() {
  console.log('TF Clearing all segments for new meeting');
  segments = [];
  currentSegment = null;
  lastFinalizedText = '';
  lastCaptionTime = null;
  participants = { count: 0, names: [], selfName: null };
  
  // Notify sidepanel / experiment page that segments were cleared
  const clearMsg = { type: 'SEGMENTS_CLEARED' };
  broadcastToConnectedApps(clearMsg);
  chrome.runtime.sendMessage(clearMsg).catch(() => {});
}

// Detect when the user navigates to a different Google Meet meeting
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.url) {
    const newMeetingId = getMeetingId(tab.url);
    if (newMeetingId && newMeetingId !== currentMeetingId) {
      const oldMeetingId = currentMeetingId;
      console.log('TF Meeting changed:', oldMeetingId, '->', newMeetingId);
      currentMeetingId = newMeetingId;
      
      // Store the current meeting ID so the agenda page can access it
      chrome.storage.local.set({ currentMeetingId: newMeetingId });
      
      // Broadcast MEETING_CHANGED so agenda page can auto-stop and reset
      const meetingChangedMsg = {
        type: 'MEETING_CHANGED',
        payload: {
          oldMeetingId: oldMeetingId,
          newMeetingId: newMeetingId,
        }
      };
      chrome.runtime.sendMessage(meetingChangedMsg).catch(() => {});
      broadcastToConnectedApps(meetingChangedMsg);
      
      clearAllSegments();
    } else if (newMeetingId && !currentMeetingId) {
      // First meeting detected
      currentMeetingId = newMeetingId;
      chrome.storage.local.set({ currentMeetingId: newMeetingId });
      console.log('TF First meeting detected:', newMeetingId);
    }
  }
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

function updateIconState(isCapturing) {
  const iconName = isCapturing ? 'tf_logo_active' : 'tf_logo';
  chrome.action.setIcon({
    path: {
      16: `icon/${iconName}_16.png`,
      32: `icon/${iconName}_32.png`
    }
  });
  chrome.action.setTitle({
    title: isCapturing ? 'Thoughtform (Capturing)' : 'Open Thoughtform'
  });
}

chrome.storage.local.get(['captureEnabled'], (result) => {
  updateIconState(result.captureEnabled || false);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.captureEnabled) {
    updateIconState(changes.captureEnabled.newValue);
  }
});

let lastFinalizedText = '';

function extractDeltaFromFinalized(fullText) {
  if (!lastFinalizedText) {
    return fullText;
  }
  
  if (fullText.startsWith(lastFinalizedText)) {
    return fullText.slice(lastFinalizedText.length).trim();
  }
  
  const words = lastFinalizedText.split(/\s+/);
  for (let overlap = Math.min(words.length, 20); overlap >= 3; overlap--) {
    const suffix = words.slice(-overlap).join(' ');
    const idx = fullText.indexOf(suffix);
    if (idx !== -1) {
      return fullText.slice(idx + suffix.length).trim();
    }
  }
  
  return fullText;
}

function finalizeCurrentSegment() {
  if (currentSegment && currentSegment.text) {
    lastFinalizedText = lastFinalizedText + ' ' + currentSegment.text;
    lastFinalizedText = lastFinalizedText.trim();
    console.log('TF Finalized segment. Total finalized length:', lastFinalizedText.length);
  }
}

function createNewSegment(speaker, fullCaption, timestamp) {
  finalizeCurrentSegment();
  
  const deltaText = extractDeltaFromFinalized(fullCaption);
  
  if (!deltaText) {
    console.log('TF Skipping empty delta for new segment');
    currentSegment = null;
    return null;
  }
  
  const segment = {
    id: `seg_${Date.now()}`,
    speaker: speaker,
    startTime: timestamp,
    endTime: timestamp,
    text: deltaText
  };
  segments.push(segment);
  currentSegment = segment;
  console.log('TF New segment:', segment.id, speaker, 'Text:', deltaText.substring(0, 60));
  return segment;
}

function updateCurrentSegment(fullCaption, timestamp) {
  if (!currentSegment) return;
  
  const deltaText = extractDeltaFromFinalized(fullCaption);
  
  if (deltaText) {
    currentSegment.text = deltaText;
    currentSegment.endTime = timestamp;
  }
}

function processCaption(payload) {
  const { speaker, caption, timestamp, blockId, isNewBlock } = payload;
  const captionTime = new Date(timestamp).getTime();
  
  let isNewSegment = false;
  
  if (!currentSegment) {
    createNewSegment(speaker, caption, timestamp);
    isNewSegment = true;
  } else if (currentSegment.speaker !== speaker) {
    createNewSegment(speaker, caption, timestamp);
    isNewSegment = true;
  } else if (lastCaptionTime && (captionTime - lastCaptionTime) > TIME_GAP_THRESHOLD_MS) {
    createNewSegment(speaker, caption, timestamp);
    isNewSegment = true;
  } else {
    updateCurrentSegment(caption, timestamp);
  }
  
  lastCaptionTime = captionTime;
  
  const updateMessage = {
    type: 'CAPTION_UPDATE',
    payload: {
      currentSegment: currentSegment,
      allSegments: segments,
      isNewSegment: isNewSegment
    }
  };
  
  broadcastToConnectedApps(updateMessage);
  chrome.runtime.sendMessage(updateMessage).catch(() => {});
}



function broadcastToConnectedApps(message) {
  connectedPorts = connectedPorts.filter((port) => {
    try {
      port.postMessage(message);
      return true;
    } catch (e) {
      console.log('TF Port disconnected, removing');
      return false;
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.type === 'NEW_CAPTION') {
      processCaption(message.payload);
      sendResponse({ success: true });
    } else if (message.type === 'PARTICIPANTS_UPDATE') {
      participants = message.payload;
      console.log('TF Participants:', participants.count, participants.names);
      broadcastToConnectedApps({
        type: 'PARTICIPANTS_UPDATE',
        payload: participants
      });
      chrome.runtime.sendMessage({
        type: 'PARTICIPANTS_UPDATE',
        payload: participants
      }).catch(() => {});
      sendResponse({ success: true });
    } else if (message.type === 'GET_PARTICIPANTS') {
      sendResponse({ participants: participants });
    } else if (message.type === 'CLEAR_SEGMENTS') {
      currentMeetingId = null;
      clearAllSegments();
      sendResponse({ success: true });
    } else if (message.type === 'GET_SEGMENTS') {
      sendResponse({ segments: segments });
    } else if (message.type === 'GET_MEETING_ID') {
      sendResponse({ meetingId: currentMeetingId });
    } else if (message.type === 'API_PROXY') {
      // Proxy API calls through background service worker to bypass CORS
      const { url, method, headers, body } = message.payload;
      
      chrome.storage.local.get(['tf_access_token'], (result) => {
        const token = result.tf_access_token;
        const requestHeaders = { ...(headers || {}) };
        
        if (token) {
          requestHeaders['Authorization'] = `Bearer ${token}`;
        }

        fetch(url, {
          method: method || 'GET',
          headers: requestHeaders,
          body: body ? JSON.stringify(body) : undefined,
          redirect: 'manual', // Don't silently follow redirects
        })
          .then(async (resp) => {
            // If we got redirected (e.g. auth/IAP), report as error
            if (resp.type === 'opaqueredirect' || resp.status === 302 || resp.status === 301) {
              sendResponse({ ok: false, status: 403, error: 'Auth redirect detected — service requires active authentication' });
              return;
            }
            const text = await resp.text();
            let data;
            try { data = JSON.parse(text); } catch { data = text; }
            sendResponse({ ok: resp.ok, status: resp.status, data });
          })
          .catch((err) => {
            sendResponse({ ok: false, status: 0, error: err.message });
          });
      });
      return true; // keep channel open for async response
    }
  } catch (e) {
    console.error('TF Error processing message:', e);
    sendResponse({ success: false, error: e.message });
  }
  return true;
});

chrome.runtime.onConnectExternal.addListener((port) => {
  console.log('TF External app connected:', port.sender?.origin);
  connectedPorts.push(port);
  
  port.postMessage({
    type: 'INITIAL_STATE',
    payload: {
      segments: segments,
      currentSegment: currentSegment,
      participants: participants
    }
  });
  
  port.onDisconnect.addListener(() => {
    console.log('TF External app disconnected');
    const index = connectedPorts.indexOf(port);
    if (index > -1) {
      connectedPorts.splice(index, 1);
    }
  });
  
  port.onMessage.addListener((message) => {
    if (message.type === 'GET_SEGMENTS') {
      port.postMessage({
        type: 'SEGMENTS_RESPONSE',
        payload: segments
      });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_EXPERIMENT') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('experiment.html')
    });
    sendResponse({ success: true });
  }
  return false;
});

const container = document.getElementById('segments-container');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const participantCountEl = document.getElementById('participant-count');
const participantNamesEl = document.getElementById('participant-names');

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function updateParticipants(participants) {
  if (!participants) return;
  participantCountEl.textContent = `${participants.count} participant${participants.count !== 1 ? 's' : ''}`;
  participantNamesEl.textContent = participants.names.length > 0 
    ? participants.names.join(', ')
    : '';
}

function renderSegments(segments, currentSegment) {
  container.innerHTML = '';
  
  const allSegments = [...segments];
  if (currentSegment && !segments.find(s => s.id === currentSegment.id)) {
    allSegments.push(currentSegment);
  }
  
  countEl.textContent = `${allSegments.length} segment${allSegments.length !== 1 ? 's' : ''}`;
  
  allSegments.forEach((segment, index) => {
    const isNew = index === allSegments.length - 1;
    
    const div = document.createElement('div');
    div.className = `segment ${isNew ? 'segment--new' : ''}`;
    div.id = segment.id;
    
    const header = document.createElement('div');
    header.className = 'segment-header';
    
    const speaker = document.createElement('span');
    speaker.className = 'segment-speaker';
    speaker.textContent = segment.speaker;
    
    const timestamp = document.createElement('span');
    timestamp.className = 'segment-timestamp';
    timestamp.textContent = formatTime(segment.startTime);
    
    header.appendChild(speaker);
    header.appendChild(timestamp);
    
    const text = document.createElement('div');
    text.className = 'segment-text';
    text.textContent = segment.text;
    
    div.appendChild(header);
    div.appendChild(text);
    container.appendChild(div);
  });
  
  window.scrollTo(0, document.body.scrollHeight);
}

chrome.storage.local.get(['segments', 'captureEnabled'], (result) => {
  // Update status based on capture state
  const enabled = result.captureEnabled || false;
  if (enabled) {
    statusEl.textContent = 'Capture enabled - waiting for captions...';
    statusEl.className = 'status status--blue';
  } else {
    statusEl.textContent = 'Capture disabled';
    statusEl.className = 'status status--gray';
  }
  
  // Load saved segments if any
  if (result.segments?.length) {
    statusEl.textContent = enabled ? 'Loaded saved transcript' : 'Capture disabled (showing saved transcript)';
    renderSegments(result.segments, null);
  }
});

chrome.runtime.sendMessage({ type: 'GET_PARTICIPANTS' }, (response) => {
  if (response?.participants) {
    updateParticipants(response.participants);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTION_UPDATE') {
    statusEl.textContent = 'Receiving live captions...';
    statusEl.className = 'status status--green';
    const { allSegments, currentSegment, isNewSegment } = message.payload;
    renderSegments(allSegments, currentSegment);
    
    if (isNewSegment) {
      console.log('TF New paragraph started:', currentSegment?.speaker);
    }
  } else if (message.type === 'PARTICIPANTS_UPDATE') {
    updateParticipants(message.payload);
  } else if (message.type === 'SEGMENTS_CLEARED') {
    container.innerHTML = '';
    countEl.textContent = '0 segments';
    participantCountEl.textContent = '0 participants';
    participantNamesEl.textContent = '';
    statusEl.textContent = 'Capture enabled - waiting for captions...';
    statusEl.className = 'status status--blue';
    console.log('TF Segments cleared - UI reset');
  } else if (message.type === 'CAPTURE_STATE_CHANGED') {
    if (message.enabled) {
      statusEl.textContent = 'Capture enabled - waiting for captions...';
      statusEl.className = 'status status--blue';
    } else {
      statusEl.textContent = 'Capture disabled';
      statusEl.className = 'status status--gray';
    }
  }
  return true;
});

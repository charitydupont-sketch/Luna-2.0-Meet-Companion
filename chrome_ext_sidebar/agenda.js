/**
 * ThoughtForm – Agenda Tracking (Chrome Extension Sidebar)
 *
 * This script powers the live agenda-tracking page loaded inside the
 * Chrome extension's side-panel iframe.  It:
 *   1. Accumulates transcript segments from the background service worker.
 *   2. Periodically sends the transcript to the Gemini API to extract
 *      structured agenda status.
 *   3. Renders agenda items with status badges (ported TimekeepingCard).
 *   4. Manages sessions (start/stop) with unique IDs.
 *   5. Pushes session state to the server for shared URL viewing.
 */

// ─── Configuration ───
const DEFAULT_API_BASE = 'https://thoughtform-internal.ue.r.appspot.com';
const ANALYSIS_INTERVAL_MS = 15_000; // 15 seconds
const SESSION_PUSH_INTERVAL_MS = 5_000; // 5 seconds
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const MAX_AUTO_CONTEXT_DOCS = 3;
const SYSTEM_PROMPT = `You are the **Real-Time Meeting Intelligence Engine**. Your role is to adapt dynamically to the meeting's context—shifting seamlessly between an administrative assistant, an expert facilitator, and a high-level strategic analyst. Your goal is to process the provided meeting data with razor-sharp precision, extracting only the specific dimensions requested by the user.

# Input Data
Analyze the meeting using ONLY the following verified data provided in the user message.

# Analysis Tasks

### Task: Agenda Progress Tracking & Timekeeping
Given the total meeting duration and elapsed time, classify each agenda item's status. Assess if the group is severely behind schedule or off-track in terms of timekeeping. If so, provide a specific, actionable suggestion in the "timekeeping_alert" field.
*Task Rules:*
- Keep the "timekeeping_alert" to exactly one sentence (displayed as the card headline). Leave it null if timekeeping is fine or only slightly off.

### Task: Summary / Insight
Provide a one-sentence overall meeting insight or health assessment.
*Task Rules:*
- Make it a specific, substantive, and actionable observation about meeting dynamics—never generic. This is displayed as the standalone "Insight" card headline.

# Response Format
You MUST respond with ONLY a valid JSON object. Do NOT wrap it in markdown code blocks.
The JSON structure must ONLY contain the keys requested below. Do not generate null, empty, or unrequested keys for disabled features.

{
  "agenda_status": [
    {
      "item": "The agenda item text",
      "status": "completed | ongoing | upcoming | skipped | new",
      "notes": "Optional: brief note on discussion, skip reason, or new flag"
    }
  ],
  "timekeeping_alert": "One sentence timekeeping suggestion (displayed as Agenda card headline) or null if on track",
  "summary": "One sentence meeting insight (displayed as the Insight card headline)"
}

# Global Instructions
1. **Response Boundaries:** Return empty arrays [] only for active dimensions where no issues are detected. Do not output keys for dimensions that were not requested.
2. **Conciseness:** Prioritize actionable insights over exhaustive analysis. Keep descriptions concise—exactly one line each.

# User Settings
- Analysis Cadence: Every 15 seconds. Provide quick, highly focused, real-time observations suited to this frequency.
- Max UI Display Capacity: 10 cards. Only return the top 10 most critical, severe, and actionable findings across all active tasks.
- **Verbosity: Standard.** Keep card text (headlines, descriptions, details, summaries, disambiguation, alerts) to **one concise sentence**.`;

// ─── DOM Elements ───
const sessionBtn = document.getElementById('sessionBtn');
const emptyState = document.getElementById('emptyState');
const listeningState = document.getElementById('listeningState');
const analyzingIndicator = document.getElementById('analyzingIndicator');
const agendaCard = document.getElementById('agendaCard');
const agendaHeadline = document.getElementById('agendaHeadline');
const alertBanner = document.getElementById('alertBanner');
const alertTitle = document.getElementById('alertTitle');
const alertDesc = document.getElementById('alertDesc');
const agendaList = document.getElementById('agendaList');

const latestSegment = document.getElementById('latestSegment');
const liveIndicator = document.getElementById('liveIndicator');
const errorBanner = document.getElementById('errorBanner');
const errorText = document.getElementById('errorText');
const toast = document.getElementById('toast');
const backBtn = document.getElementById('backBtn');
const contextBanner = document.getElementById('contextBanner');
const contextDocs = document.getElementById('contextDocs');
const contextClearAll = document.getElementById('contextClearAll');

// Progress header elements
const progressHeader = document.getElementById('progressHeader');
const progressCount = document.getElementById('progressCount');
const progressElapsed = document.getElementById('progressElapsed');
const progressBarFill = document.getElementById('progressBarFill');
const progressBarContainer = document.getElementById('progressBarFill')?.parentElement;
const nowNeedle = document.getElementById('nowNeedle');
const addTopicRow = document.getElementById('addTopicRow');

// ─── Meeting Duration Tracking ───
let meetingStartTime = null; // from calendar event
let meetingEndTime = null;   // from calendar event
let nowNeedleInterval = null;
let elapsedInterval = null;

// ─── State ───
let segments = [];
let participants = [];
let isRunning = false;
let sessionId = null;
let sessionStartTime = null;
let meetingId = null; // Google Meet meeting ID (e.g. abc-defg-hij)
let analysisInterval = null;
let sessionPushInterval = null;
let firestorePushInterval = null;
let lastAnalyzedLength = 0; // track transcript length to know if new data arrived
let lastAgendaStatus = [];
let lastTimekeepingAlert = '';
let lastSummary = '';
let apiBaseUrl = DEFAULT_API_BASE;
let isAnalyzing = false;
let meetingContext = null; // { calendarEvent, documents[] } from meeting picker
let contextDocuments = []; // Drive docs to include as context
let autoContextFetched = false; // prevent re-fetching on sidebar reopen

// ─── Helpers ───

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

function showError(msg) {
  errorText.textContent = msg;
  errorBanner.style.display = 'flex';
  setTimeout(() => { errorBanner.style.display = 'none'; }, 8000);
}

function hideError() {
  errorBanner.style.display = 'none';
}

/**
 * Proxy fetch through the background service worker to bypass CORS.
 * Cloud Run behind org-policy can't allow unauthenticated preflight OPTIONS,
 * but background service workers aren't subject to CORS.
 */
function proxyFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'API_PROXY',
      payload: {
        url,
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body ? JSON.parse(options.body) : undefined,
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from background'));
        return;
      }
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      // Return a fetch-like response object
      resolve({
        ok: response.ok,
        status: response.status,
        json: () => Promise.resolve(response.data),
        text: () => Promise.resolve(typeof response.data === 'string' ? response.data : JSON.stringify(response.data)),
      });
    });
  });
}

function buildTranscriptText() {
  return segments.map(seg => {
    const time = new Date(seg.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `[${time}] ${seg.speaker}: ${seg.text}`;
  }).join('\n');
}

/**
 * Build an auth headers object. Returns empty {} if no token available.
 * This allows the extension to work in a degraded mode without auth.
 */
async function getAuthHeaders() {
  if (typeof auth === 'undefined') return {};
  try {
    const token = await auth.getToken();
    if (token) {
      return { 'Authorization': `Bearer ${token}` };
    }
  } catch (e) {
    console.warn('TF Auth: Could not get token for API call:', e.message);
  }
  return {};
}

/** Get userId from auth module, or null. */
function getUserId() {
  if (typeof auth === 'undefined') return null;
  const user = auth.getUser();
  return user?.uid || null;
}

/** Get user email from auth module, or null. */
function getUserEmail() {
  if (typeof auth === 'undefined') return null;
  const user = auth.getUser();
  return user?.email || null;
}

// ─── Context Documents ───

function loadMeetingContext() {
  chrome.storage.local.get(['meetingContext'], (result) => {
    meetingContext = result.meetingContext || null;
    if (meetingContext?.documents?.length > 0) {
      contextDocuments = [...meetingContext.documents];
      renderContextBanner();
    }
    if (meetingContext?.calendarEvent) {

      // Extract meeting start/end times for the 'now' needle indicator
      const calEvent = meetingContext.calendarEvent;
      if (calEvent.start?.dateTime && calEvent.end?.dateTime) {
        meetingStartTime = new Date(calEvent.start.dateTime).getTime();
        meetingEndTime = new Date(calEvent.end.dateTime).getTime();
        // Only use if meeting has meaningful duration (>0)
        if (meetingEndTime <= meetingStartTime) {
          meetingStartTime = null;
          meetingEndTime = null;
        }
      }
    }
  });
}

function renderContextBanner() {
  // Context files are now managed via the toolbar icon + hover popup
  // Keep the banner always hidden
  contextBanner.style.display = 'none';
  if (contextDocuments.length === 0) return;
  contextDocs.innerHTML = '';

  contextDocuments.forEach((doc, i) => {
    const chip = document.createElement('div');
    chip.className = 'context-doc-chip';

    const icon = document.createElement('span');
    icon.className = 'context-doc-chip__icon';
    icon.textContent = getMimeIcon(doc.mimeType);

    const name = document.createElement('span');
    name.className = 'context-doc-chip__name';
    name.textContent = doc.title || doc.name || 'Document';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'context-doc-chip__remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      contextDocuments.splice(i, 1);
      renderContextBanner();
      broadcastContextState();
    });

    chip.appendChild(icon);
    chip.appendChild(name);
    chip.appendChild(removeBtn);
    contextDocs.appendChild(chip);
  });
}

function getMimeIcon(mimeType) {
  if (!mimeType) return '📄';
  if (mimeType.includes('document') || mimeType.includes('word')) return '📝';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📊';
  if (mimeType.includes('pdf')) return '📕';
  return '📄';
}

// ─── Token Budget Constants ───
const CHARS_PER_TOKEN = 4; // conservative estimate for English text
const MODEL_TOKEN_LIMIT = 1_000_000; // Gemini Flash/Pro context window
const OUTPUT_TOKEN_RESERVE = 8_192; // matches maxOutputTokens on the server
const SAFETY_MARGIN_TOKENS = 50_000; // headroom for internal formatting overhead
const MAX_INPUT_CHARS = (MODEL_TOKEN_LIMIT - OUTPUT_TOKEN_RESERVE - SAFETY_MARGIN_TOKENS) * CHARS_PER_TOKEN;

/**
 * Build the concatenated Drive context string.
 * @param {number} charBudget – max characters available for all context docs
 */
function buildDriveContextText(charBudget = Infinity) {
  if (contextDocuments.length === 0) return '';

  const docs = contextDocuments.filter(d => d.summary || d.content);
  if (docs.length === 0) return '';

  // Build the full (untrimmed) parts
  const parts = docs.map(d => ({
    title: d.title || 'Untitled',
    body: d.summary || d.content || '',
  }));

  const fullText = parts
    .map(p => `--- Document: ${p.title} ---\n${p.body}`)
    .join('\n\n');

  // If it fits within the budget, return as-is (no trimming)
  if (fullText.length <= charBudget) return fullText;

  // Otherwise, trim each doc proportionally to fit the budget
  // Account for per-doc header + separator overhead
  const headerOverhead = parts.reduce(
    (sum, p) => sum + `--- Document: ${p.title} ---\n`.length, 0
  );
  const separatorOverhead = (parts.length - 1) * 2; // '\n\n' between docs
  const availableForBodies = Math.max(0, charBudget - headerOverhead - separatorOverhead);
  const perDocBudget = Math.floor(availableForBodies / parts.length);

  console.log(
    `TF Context trimming: ${fullText.length} chars -> budget ${charBudget} chars ` +
    `(${perDocBudget} per doc, ${parts.length} docs)`
  );

  return parts
    .map(p => {
      const trimmed = p.body.length > perDocBudget
        ? p.body.substring(0, perDocBudget) + '… [trimmed to fit context window]'
        : p.body;
      return `--- Document: ${p.title} ---\n${trimmed}`;
    })
    .join('\n\n');
}

// ─── Broadcast Context State to Parent Sidepanel ───

function broadcastContextState(status) {
  const state = {
    status: status || (contextDocuments.length > 0 ? 'loaded' : 'idle'),
    files: contextDocuments.map(d => ({
      id: d.id,
      title: d.title || d.name || 'Document',
      icon: getMimeIcon(d.mimeType),
    })),
  };
  window.parent.postMessage({ type: 'CONTEXT_STATE', state }, '*');
}

// ─── Auto-Fetch Past Meeting Notes (Background) ───

/**
 * Finds past calendar events with the same title (recurring meetings)
 * and searches Drive for associated meeting notes docs.
 * Runs in the background — doesn't block the agenda tracker.
 */
async function autoFetchPastMeetingNotes() {
  if (autoContextFetched) return;
  autoContextFetched = true;

  // Need calendar + drive access
  if (typeof auth === 'undefined' || !auth.hasCalendarAccess?.()) {
    broadcastContextState('idle');
    return;
  }

  const token = await auth.getToken();
  if (!token) {
    broadcastContextState('idle');
    return;
  }

  // Determine the current meeting title
  let meetingTitle = null;
  let recurringEventId = null;

  // First, try from meetingContext (if navigated from meetings page)
  if (meetingContext?.calendarEvent) {
    meetingTitle = meetingContext.calendarEvent.summary;
    recurringEventId = meetingContext.calendarEvent.recurringEventId;
  }

  // If no meeting context, try to get from the active Meet tab's calendar event
  if (!meetingTitle) {
    try {
      // Find today's calendar events and match by meeting ID
      const now = new Date();
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(now);
      dayEnd.setHours(23, 59, 59, 999);

      const url = new URL(`${CALENDAR_API}/calendars/primary/events`);
      url.searchParams.set('timeMin', dayStart.toISOString());
      url.searchParams.set('timeMax', dayEnd.toISOString());
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', '25');

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        const events = (data.items || []).filter(e => e.hangoutLink && e.start?.dateTime);

        // Try to match by meetingId (Google Meet code)
        if (meetingId) {
          const matchedEvent = events.find(e => {
            const meetCode = e.hangoutLink?.split('/').pop();
            return meetCode === meetingId;
          });
          if (matchedEvent) {
            meetingTitle = matchedEvent.summary;
            recurringEventId = matchedEvent.recurringEventId;
            // Also set meeting context for metadata
            if (!meetingContext) {
              meetingContext = { calendarEvent: matchedEvent, documents: [] };
              // Extract times for now needle
              if (matchedEvent.start?.dateTime && matchedEvent.end?.dateTime) {
                meetingStartTime = new Date(matchedEvent.start.dateTime).getTime();
                meetingEndTime = new Date(matchedEvent.end.dateTime).getTime();
                if (meetingEndTime <= meetingStartTime) {
                  meetingStartTime = null;
                  meetingEndTime = null;
                }
              }
            }
          }
        }

        // If no meetingId match, try the closest event to now
        if (!meetingTitle && events.length > 0) {
          const closest = events.reduce((best, e) => {
            const eStart = new Date(e.start.dateTime).getTime();
            const diff = Math.abs(eStart - now.getTime());
            if (!best || diff < best.diff) return { event: e, diff };
            return best;
          }, null);
          // Only use if within 30 min window
          if (closest && closest.diff < 30 * 60 * 1000) {
            meetingTitle = closest.event.summary;
            recurringEventId = closest.event.recurringEventId;
          }
        }
      }
    } catch (err) {
      console.warn('TF Auto-context: failed to fetch calendar events:', err.message);
    }
  }

  if (!meetingTitle) {
    console.log('TF Auto-context: no meeting title found, skipping');
    broadcastContextState('idle');
    return;
  }

  // Signal that we're fetching
  broadcastContextState('fetching');
  console.log('TF Auto-context: searching for past notes for:', meetingTitle);

  try {
    // Search Drive for meeting notes matching this title
    const escapedTitle = meetingTitle.replace(/'/g, "\\'").replace(/\\/g, '\\\\');
    const q = `(` +
      `(name contains 'meeting notes' and name contains '${escapedTitle}') or ` +
      `(name contains 'notes' and name contains '${escapedTitle}') or ` +
      `(name contains 'Meeting Notes' and fullText contains '${escapedTitle}')` +
    `) and mimeType = 'application/vnd.google-apps.document' and trashed = false`;

    const driveUrl = new URL(`${DRIVE_API}/files`);
    driveUrl.searchParams.set('q', q);
    driveUrl.searchParams.set('orderBy', 'modifiedTime desc');
    driveUrl.searchParams.set('pageSize', String(MAX_AUTO_CONTEXT_DOCS));
    driveUrl.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,webViewLink,iconLink)');

    const driveResponse = await fetch(driveUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!driveResponse.ok) {
      console.warn('TF Auto-context: Drive search failed:', driveResponse.status);
      broadcastContextState('idle');
      return;
    }

    const driveData = await driveResponse.json();
    const docs = (driveData.files || []).slice(0, MAX_AUTO_CONTEXT_DOCS);

    if (docs.length === 0) {
      console.log('TF Auto-context: no matching meeting notes found');
      broadcastContextState('idle');
      return;
    }

    console.log(`TF Auto-context: found ${docs.length} meeting notes, fetching content...`);

    // Fetch content for each doc (in parallel)
    const enrichedDocs = await Promise.all(docs.map(async (doc) => {
      let content = '';
      try {
        const exportUrl = `${DRIVE_API}/files/${doc.id}/export?mimeType=text/plain`;
        const exportResp = await fetch(exportUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (exportResp.ok) {
          content = await exportResp.text();
        }
      } catch (e) {
        console.warn('TF Auto-context: failed to export doc:', doc.name, e.message);
      }

      return {
        id: doc.id,
        title: doc.name,
        name: doc.name,
        mimeType: doc.mimeType,
        summary: content,
        content: content,
        webViewLink: doc.webViewLink,
      };
    }));

    // Merge with any existing context (avoid duplicates)
    const existingIds = new Set(contextDocuments.map(d => d.id));
    const newDocs = enrichedDocs.filter(d => !existingIds.has(d.id));
    contextDocuments.push(...newDocs);

    // Update UI
    renderContextBanner();
    broadcastContextState('loaded');

    console.log(`TF Auto-context: loaded ${newDocs.length} new docs into context (total: ${contextDocuments.length})`);
  } catch (err) {
    console.error('TF Auto-context: error fetching meeting notes:', err);
    broadcastContextState('idle');
  }
}

// ─── Session Management ───

function startSession(isResume = false) {
  if (!isResume || !sessionId) {
    sessionId = crypto.randomUUID();
    sessionStartTime = Date.now();
    lastAnalyzedLength = 0;
    lastAgendaStatus = [];
    lastTimekeepingAlert = '';
    lastSummary = '';
    
    chrome.storage.local.remove([
      'lastAgendaStatus',
      'lastTimekeepingAlert',
      'lastSummary'
    ]);
  }

  isRunning = true;

  // Auto-enable caption capture if not already on
  chrome.storage.local.get(['captureEnabled'], (result) => {
    if (!result.captureEnabled) {
      chrome.storage.local.set({ captureEnabled: true }, () => {
        // Notify content script to start capturing captions
        chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              type: 'CAPTURE_STATE_CHANGED',
              enabled: true
            }).catch(() => {});
          });
        });
        // Also broadcast via runtime for any other listeners
        chrome.runtime.sendMessage({
          type: 'CAPTURE_STATE_CHANGED',
          enabled: true
        }).catch(() => {});
        console.log('TF Auto-enabled caption capture');
      });
    }
  });

  // Fetch current meeting ID from background
  chrome.runtime.sendMessage({ type: 'GET_MEETING_ID' }, (response) => {
    if (response?.meetingId) {
      meetingId = response.meetingId;
      console.log('TF Session linked to meeting:', meetingId);
    }
  });

  // Build share URL and save to storage (sidepanel reads this for the Share button)
  const appHost = apiBaseUrl.replace(/\/api.*$/, '').replace(/\/$/, '');
  const shareUrl = `${appHost}/session/${sessionId}`;
  chrome.storage.local.set({
    sessionId,
    sessionStartTime,
    isRunning: true,
    shareUrl,
  });

  // Update UI
  sessionBtn.textContent = '⏸ Pause';
  sessionBtn.className = 'session-bar__btn session-bar__btn--stop';
  
  if (lastAgendaStatus && lastAgendaStatus.length > 0) {
    agendaCard.style.display = '';
    emptyState.style.display = 'none';
    if (listeningState) listeningState.style.display = 'none';
  } else {
    agendaCard.style.display = 'none';
    emptyState.style.display = 'none';
    if (listeningState) listeningState.style.display = '';
  }

  // Start analysis loop
  analysisInterval = setInterval(analyzeTranscript, ANALYSIS_INTERVAL_MS);

  // Start session push loop (shared URL viewer)
  sessionPushInterval = setInterval(pushSessionState, SESSION_PUSH_INTERVAL_MS);

  // Start Firestore persistence loop (every 30s — less frequent than push)
  firestorePushInterval = setInterval(persistToFirestore, 30_000);

  // Push initial state
  pushSessionState();

  console.log(isResume ? 'TF Session resumed:' : 'TF Session started:', sessionId);
}

function stopSession() {
  isRunning = false;

  chrome.storage.local.set({ isRunning: false, shareUrl: '' });

  // Update UI
  sessionBtn.textContent = '▶ Resume';
  sessionBtn.className = 'session-bar__btn session-bar__btn--start';
  if (listeningState) listeningState.style.display = 'none';
  
  if (lastAgendaStatus && lastAgendaStatus.length > 0) {
    agendaCard.style.display = '';
    emptyState.style.display = 'none';
  } else {
    agendaCard.style.display = 'none';
    emptyState.style.display = '';
  }

  // Stop intervals
  if (analysisInterval) { clearInterval(analysisInterval); analysisInterval = null; }
  if (sessionPushInterval) { clearInterval(sessionPushInterval); sessionPushInterval = null; }
  if (firestorePushInterval) { clearInterval(firestorePushInterval); firestorePushInterval = null; }

  // Stop elapsed timer and needle updates
  stopElapsedTimer();
  stopNowNeedle();

  // Push final state to shared viewer + Firestore
  pushSessionState();
  persistToFirestore();

  console.log('TF Session stopped:', sessionId);
}

// Reset the UI to initial home/start state
function resetToHome() {
  // Clear analysis data
  lastAnalyzedLength = 0;
  lastAgendaStatus = [];
  lastTimekeepingAlert = '';
  lastSummary = '';
  segments = [];
  participants = [];

  chrome.storage.local.remove([
    'lastAgendaStatus',
    'lastTimekeepingAlert',
    'lastSummary'
  ]);

  // Reset UI
  sessionBtn.textContent = '▶ Resume';
  sessionBtn.className = 'session-bar__btn session-bar__btn--start';
  emptyState.style.display = '';
  if (listeningState) listeningState.style.display = 'none';
  agendaCard.style.display = 'none';
  if (progressHeader) progressHeader.style.display = 'none';
  alertBanner.style.display = 'none';
  agendaList.innerHTML = '';
  updateTranscriptBar();

  // Stop elapsed timer and needle updates
  stopElapsedTimer();
  stopNowNeedle();
}

sessionBtn.addEventListener('click', () => {
  if (isRunning) {
    stopSession();
  } else {
    startSession(true);
  }
});

// ─── Transcript Accumulation ───

function updateTranscriptBar() {

  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    latestSegment.textContent = `${last.speaker}: ${last.text}`;
  } else {
    latestSegment.textContent = 'Waiting for captions...';
  }
}

function handleCaptionUpdate(payload) {
  const { allSegments, currentSegment } = payload;
  segments = [...allSegments];
  if (currentSegment && !segments.find(s => s.id === currentSegment.id)) {
    segments.push(currentSegment);
  }
  updateTranscriptBar();
}

// ─── Gemini Analysis ───

async function analyzeTranscript() {
  if (!isRunning || isAnalyzing) return;

  const transcript = buildTranscriptText();
  if (!transcript || transcript.length === lastAnalyzedLength) return; // no new data

  isAnalyzing = true;
  analyzingIndicator.style.display = 'flex';
  // Notify parent (sidepanel) about analyzing state
  window.parent.postMessage({ type: 'ANALYZING_STATE', active: true }, '*');

  try {
    const authHeaders = await getAuthHeaders();

    // Calculate how much of the context window the non-doc content occupies
    let nonContextChars = SYSTEM_PROMPT.length + transcript.length;
    if (meetingContext?.calendarEvent) {
      const meta = meetingContext.calendarEvent;
      nonContextChars += (meta.summary || '').length;
      nonContextChars += JSON.stringify(meta.attendees || []).length;
    }
    nonContextChars += 500; // formatting labels, JSON wrappers, etc.
    const contextBudgetChars = Math.max(0, MAX_INPUT_CHARS - nonContextChars);

    const driveContext = buildDriveContextText(contextBudgetChars);

    const requestBody = {
      transcript,
      prompt: SYSTEM_PROMPT,
      agenda: [],
      facilitationOptions: ['time_keep'],
    };

    // Include drive context if documents are attached
    if (driveContext) {
      requestBody.driveContext = driveContext;
    }

    // Include meeting metadata from calendar event
    if (meetingContext?.calendarEvent) {
      requestBody.meetingMetadata = {
        title: meetingContext.calendarEvent.summary,
        attendees: meetingContext.calendarEvent.attendees?.map(a => a.email) || [],
      };
    }

    const response = await proxyFetch(`${apiBaseUrl}/api/gemini-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      let errorMsg = `API returned ${response.status}`;
      try {
        const errData = await response.json();
        if (errData && typeof errData === 'object' && errData.error) {
          errorMsg += `: ${errData.error}`;
        } else if (typeof errData === 'string') {
          errorMsg += `: ${errData}`;
        } else {
          errorMsg += `: ${JSON.stringify(errData)}`;
        }
      } catch (e) {
        try {
          const errText = await response.text();
          if (errText) {
            errorMsg += `: ${errText.substring(0, 200)}`;
          }
        } catch (e2) {}
      }
      throw new Error(errorMsg);
    }

    const data = await response.json();
    lastAnalyzedLength = transcript.length;

    // Extract agenda data
    const agendaStatus = Array.isArray(data.agenda_status) ? data.agenda_status : [];
    const timekeepingAlert = data.timekeeping_alert || '';
    const summary = data.summary || '';

    lastAgendaStatus = agendaStatus;
    lastTimekeepingAlert = timekeepingAlert;
    lastSummary = summary;

    renderAgenda(agendaStatus, timekeepingAlert, summary);
    hideError();
  } catch (err) {
    console.error('TF Analysis error:', err);
    showError(`Analysis failed: ${err.message}`);
  } finally {
    isAnalyzing = false;
    analyzingIndicator.style.display = 'none';
    // Notify parent (sidepanel) about analyzing state
    window.parent.postMessage({ type: 'ANALYZING_STATE', active: false }, '*');
  }
}

// ─── Render Agenda Card ───

function renderAgenda(agendaStatus, timekeepingAlert, summary) {
  if (!agendaStatus || agendaStatus.length === 0) return;

  // Update module-level state so addNewTopic etc. have correct references
  lastAgendaStatus = agendaStatus;
  lastTimekeepingAlert = timekeepingAlert;
  lastSummary = summary;

  // Persist in storage for sidebar reopenings
  chrome.storage.local.set({
    lastAgendaStatus: agendaStatus,
    lastTimekeepingAlert: timekeepingAlert,
    lastSummary: summary
  });

  // Show the card and progress header, hide empty state
  agendaCard.style.display = '';
  if (progressHeader) progressHeader.style.display = '';
  emptyState.style.display = 'none';
  if (listeningState) listeningState.style.display = 'none';

  // Set headline (hidden via CSS, but keep data in DOM)
  const ongoingItem = agendaStatus.find(a => a.status === 'ongoing');
  const headline = timekeepingAlert || ongoingItem?.item || 'Tracking agenda...';
  agendaHeadline.textContent = headline;

  // Update progress header
  const completedCount = agendaStatus.filter(a => a.status === 'completed').length;
  const totalCount = agendaStatus.length;
  if (progressCount) {
    progressCount.textContent = `${completedCount} OF ${totalCount} COMPLETED`;
  }

  // Update segmented progress bar
  if (progressBarContainer) {
    // Remove old segments (keep the nowNeedle)
    progressBarContainer.querySelectorAll('.progress-header__segment').forEach(el => el.remove());
    // Hide the old fill bar
    if (progressBarFill) progressBarFill.style.display = 'none';
    // Insert segments before the needle
    agendaStatus.forEach((item, i) => {
      const seg = document.createElement('div');
      seg.className = 'progress-header__segment';
      if (item.status === 'completed') {
        seg.classList.add('progress-header__segment--filled');
      }
      progressBarContainer.insertBefore(seg, nowNeedle);
    });
  }

  // Update elapsed time display
  updateElapsedDisplay();

  // Start elapsed timer if not already running
  startElapsedTimer();

  // Timekeeping alert (standalone card)
  if (timekeepingAlert) {
    alertBanner.style.display = 'flex';
    // Parse alert into title + description
    // Format: "Running 3 min over — Trim later topics or push \"Pricing experiment\" to next sync?"
    const dashIdx = timekeepingAlert.indexOf('—');
    const colonIdx = timekeepingAlert.indexOf(':');
    const splitIdx = dashIdx !== -1 ? dashIdx : (colonIdx > 5 ? colonIdx : -1);
    if (splitIdx !== -1) {
      alertTitle.textContent = timekeepingAlert.substring(0, splitIdx).trim();
      alertDesc.textContent = timekeepingAlert.substring(splitIdx + 1).trim();
    } else {
      alertTitle.textContent = timekeepingAlert;
      alertDesc.textContent = '';
    }
  } else {
    alertBanner.style.display = 'none';
  }

  // Render agenda items with Google-style circles
  agendaList.innerHTML = '';
  agendaStatus.forEach((item, i) => {
    const isOngoing = item.status === 'ongoing';
    const isCompleted = item.status === 'completed';
    const isSkipped = item.status === 'skipped';
    const isUpcoming = item.status === 'upcoming';
    const isNew = item.status === 'new';

    // Row
    const row = document.createElement('div');
    let rowClass = 'agenda-row';
    if (isOngoing) rowClass += ' agenda-row--active';
    else if (isCompleted) rowClass += ' agenda-row--completed';
    else if (isSkipped) rowClass += ' agenda-row--skipped';
    else if (isUpcoming) rowClass += ' agenda-row--upcoming';
    else if (isNew) rowClass += ' agenda-row--new';
    row.className = rowClass;

    // Status circle
    const circle = document.createElement('span');
    if (isCompleted) {
      circle.className = 'status-circle status-circle--done';
      circle.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    } else if (isOngoing) {
      circle.className = 'status-circle status-circle--active';
    } else if (isSkipped) {
      circle.className = 'status-circle status-circle--skipped';
    } else if (isNew) {
      circle.className = 'status-circle status-circle--new';
    } else {
      circle.className = 'status-circle status-circle--upcoming';
    }

    // Content container (text + duration + progress)
    const content = document.createElement('div');
    content.className = 'agenda-item-content';

    // Text
    const text = document.createElement('span');
    let textClass = 'agenda-item-text';
    if (isCompleted) textClass += ' agenda-item-text--completed';
    else if (isSkipped) textClass += ' agenda-item-text--skipped';
    else if (isUpcoming) textClass += ' agenda-item-text--upcoming';
    text.className = textClass;
    text.textContent = item.item;
    content.appendChild(text);

    // Duration row (optional — only show if duration_minutes or estimated_minutes present)
    const durationMinutes = item.duration_minutes || item.estimated_minutes || null;
    if (durationMinutes || isOngoing) {
      const metaRow = document.createElement('div');
      metaRow.className = 'agenda-item-meta';

      if (durationMinutes) {
        const dur = document.createElement('span');
        dur.className = 'agenda-item-duration';

        // Check if item ran overtime
        const actualMinutes = item.actual_minutes || null;
        const overtime = actualMinutes && durationMinutes ? actualMinutes - durationMinutes : 0;

        if (isCompleted && overtime > 0) {
          dur.className += ' agenda-item-duration--over';
          dur.textContent = `${durationMinutes} min`;
          metaRow.appendChild(dur);

          // Overtime chip
          const chip = document.createElement('span');
          chip.className = 'agenda-item-overtime';
          chip.textContent = `+${overtime} min`;
          metaRow.appendChild(chip);
        } else {
          dur.textContent = `${durationMinutes} min`;
          metaRow.appendChild(dur);
        }
      }

      // Inline progress bar for active item
      if (isOngoing && durationMinutes) {
        const progressBar = document.createElement('div');
        progressBar.className = 'agenda-item-progress';
        const fill = document.createElement('div');
        fill.className = 'agenda-item-progress__fill';
        // Estimate progress based on session elapsed vs item duration
        const itemElapsedPct = estimateItemProgress(durationMinutes);
        fill.style.width = `${Math.min(100, itemElapsedPct)}%`;
        progressBar.appendChild(fill);
        metaRow.appendChild(progressBar);
      }

      content.appendChild(metaRow);
    }

    row.appendChild(circle);
    row.appendChild(content);

    // Status tag for skipped and new items
    if (isSkipped) {
      const tag = document.createElement('span');
      tag.className = 'agenda-item-tag agenda-item-tag--skipped';
      tag.textContent = 'Skipped';
      row.appendChild(tag);
    } else if (isNew) {
      const tag = document.createElement('span');
      tag.className = 'agenda-item-tag agenda-item-tag--new';
      tag.textContent = 'New';
      row.appendChild(tag);
    }

    agendaList.appendChild(row);
  });

  // Show the add topic button
  if (addTopicRow) {
    addTopicRow.style.display = 'flex';
  }

  // Summary card is removed — context icon handles this now

  // Start/update 'now' needle if we have calendar event data
  updateNowNeedle();
}

/**
 * Estimate progress percentage for the currently active agenda item.
 * Uses session start time and item duration.
 */
function estimateItemProgress(durationMinutes) {
  if (!sessionStartTime || !durationMinutes) return 0;

  // Find how many items are completed (their durations sum up to the time before this item)
  let completedDuration = 0;
  if (lastAgendaStatus) {
    for (const item of lastAgendaStatus) {
      if (item.status === 'completed') {
        completedDuration += (item.duration_minutes || item.estimated_minutes || 0);
      } else if (item.status === 'ongoing') {
        break; // stop at current item
      }
    }
  }

  const elapsedSec = (Date.now() - sessionStartTime) / 1000;
  const itemStartSec = completedDuration * 60;
  const itemElapsedSec = Math.max(0, elapsedSec - itemStartSec);
  const itemDurationSec = durationMinutes * 60;

  return (itemElapsedSec / itemDurationSec) * 100;
}

// ─── Elapsed Time Display ───

function updateElapsedDisplay() {
  if (!progressElapsed) return;

  if (sessionStartTime) {
    const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    progressElapsed.textContent = `${m}:${s.toString().padStart(2, '0')} elapsed`;
  }
}

function startElapsedTimer() {
  if (elapsedInterval) return;
  elapsedInterval = setInterval(updateElapsedDisplay, 1000);
}

function stopElapsedTimer() {
  if (elapsedInterval) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }
}

// ─── 'Now' Needle Indicator ───

function updateNowNeedle() {
  if (!nowNeedle) return;

  // Only show needle if we have calendar event with start/end times
  if (!meetingStartTime || !meetingEndTime) {
    nowNeedle.style.display = 'none';
    return;
  }

  const now = Date.now();
  const start = meetingStartTime;
  const end = meetingEndTime;
  const totalDuration = end - start;

  if (totalDuration <= 0) {
    nowNeedle.style.display = 'none';
    return;
  }

  const elapsed = now - start;
  const pct = Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));

  nowNeedle.style.display = 'block';
  nowNeedle.style.left = `${pct}%`;

  // Start continuous update if not already running
  if (!nowNeedleInterval) {
    nowNeedleInterval = setInterval(updateNowNeedle, 1000);
  }
}

function stopNowNeedle() {
  if (nowNeedleInterval) {
    clearInterval(nowNeedleInterval);
    nowNeedleInterval = null;
  }
}

// ─── Push Session State to Server (shared URL viewer) ───

async function pushSessionState() {
  if (!sessionId) return;

  const elapsed = sessionStartTime ? Math.floor((Date.now() - sessionStartTime) / 1000) : 0;

  try {
    const authHeaders = await getAuthHeaders();
    await proxyFetch(`${apiBaseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        sessionId,
        agendaStatus: lastAgendaStatus,
        timekeepingAlert: lastTimekeepingAlert,
        summary: lastSummary,
        isRunning,
        elapsedSeconds: elapsed,
        participants,
      }),
    });
  } catch (err) {
    console.warn('TF Failed to push session state:', err.message);
  }
}

// ─── Persist to Firestore (durable storage) ───

async function persistToFirestore() {
  if (!sessionId) return;

  const elapsed = sessionStartTime ? Math.floor((Date.now() - sessionStartTime) / 1000) : 0;

  try {
    const authHeaders = await getAuthHeaders();
    const userId = getUserId();
    const userEmail = getUserEmail();

    await proxyFetch(`${apiBaseUrl}/api/ext/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        meetingId: meetingId || 'unknown',
        sessionId,
        segments,
        agendaStatus: lastAgendaStatus,
        timekeepingAlert: lastTimekeepingAlert,
        summary: lastSummary,
        isRunning,
        elapsedSeconds: elapsed,
        participants,
        title: meetingContext?.calendarEvent?.summary || document.title || null,
        userId: userId,
        userEmail: userEmail,
        contextDocumentIds: contextDocuments.map(d => d.id).filter(Boolean),
      }),
    });
  } catch (err) {
    console.warn('TF Failed to persist to Firestore:', err.message);
  }
}

// ─── Chrome Extension Message Handling ───

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.type === 'CAPTION_UPDATE') {
      handleCaptionUpdate(message.payload);
    } else if (message.type === 'PARTICIPANTS_UPDATE') {
      participants = message.payload?.names || [];
    } else if (message.type === 'SEGMENTS_CLEARED') {
      segments = [];
      lastAnalyzedLength = 0;
      updateTranscriptBar();
      // Don't clear the agenda card — keep showing last analysis
    } else if (message.type === 'CAPTURE_STATE_CHANGED') {
      if (message.enabled) {
        latestSegment.textContent = 'Capture enabled — waiting for captions...';
        liveIndicator.style.display = 'inline-flex';
      } else {
        latestSegment.textContent = 'Capture disabled';
        liveIndicator.style.display = 'none';
      }
    } else if (message.type === 'MEETING_CHANGED') {
      // ─── Auto-stop and reset when user moves to a different meeting ───
      const { oldMeetingId, newMeetingId } = message.payload || {};
      console.log('TF Meeting changed detected in agenda:', oldMeetingId, '->', newMeetingId);

      if (isRunning) {
        // Save final state for the old meeting before stopping
        persistToFirestore();
        stopSession();
        showToast('Session auto-stopped — new meeting detected');
      }

      // Update meeting ID and fully reset the UI
      meetingId = newMeetingId;
      resetToHome();
    }
  } catch (e) {
    console.error('TF Agenda message error:', e);
  }
  return true;
});

// ─── Initialization ───

async function init() {
  // Initialize auth module (if available)
  if (typeof auth !== 'undefined') {
    await auth.init();
  }

  // Load meeting context from meeting picker (if navigated from meetings page)
  loadMeetingContext();

  // Load settings
  chrome.storage.local.get([
    'apiBaseUrl',
    'sessionId',
    'sessionStartTime',
    'isRunning',
    'captureEnabled',
    'currentMeetingId',
    'lastAgendaStatus',
    'lastTimekeepingAlert',
    'lastSummary'
  ], (result) => {
    apiBaseUrl = result.apiBaseUrl || DEFAULT_API_BASE;
    meetingId = result.currentMeetingId || null;
    lastAgendaStatus = result.lastAgendaStatus || [];
    lastTimekeepingAlert = result.lastTimekeepingAlert || '';
    lastSummary = result.lastSummary || '';

    // Immediately render cached agenda if present
    if (lastAgendaStatus && lastAgendaStatus.length > 0) {
      renderAgenda(lastAgendaStatus, lastTimekeepingAlert, lastSummary);
    }

    // Restore session if running
    if (result.isRunning && result.sessionId && result.sessionStartTime) {
      sessionId = result.sessionId;
      sessionStartTime = result.sessionStartTime;
      isRunning = true;

      sessionBtn.textContent = '⏸ Pause';
      sessionBtn.className = 'session-bar__btn session-bar__btn--stop';
      emptyState.style.display = 'none';
      
      if (lastAgendaStatus && lastAgendaStatus.length > 0) {
        if (listeningState) listeningState.style.display = 'none';
      } else {
        if (listeningState) listeningState.style.display = '';
      }

      // Restart analysis, push, and Firestore loops
      analysisInterval = setInterval(analyzeTranscript, ANALYSIS_INTERVAL_MS);
      sessionPushInterval = setInterval(pushSessionState, SESSION_PUSH_INTERVAL_MS);
      firestorePushInterval = setInterval(persistToFirestore, 30_000);
    } else {
      // Auto-start session when joining a meeting
      startSession();
    }

    // Update capture status + live indicator
    if (result.captureEnabled) {
      latestSegment.textContent = 'Capture enabled — waiting for captions...';
      liveIndicator.style.display = 'inline-flex';
    }
  });

  // Auto-fetch past meeting notes in the background (non-blocking)
  // This runs while the agenda tracker is already starting
  setTimeout(() => autoFetchPastMeetingNotes(), 500);

  // Request existing segments from background
  chrome.runtime.sendMessage({ type: 'GET_SEGMENTS' }, (response) => {
    if (response?.segments?.length) {
      segments = response.segments;
      updateTranscriptBar();
    }
  });

  // Request current meeting ID from background
  chrome.runtime.sendMessage({ type: 'GET_MEETING_ID' }, (response) => {
    if (response?.meetingId) {
      meetingId = response.meetingId;
    }
  });

  // Request participants
  chrome.runtime.sendMessage({ type: 'GET_PARTICIPANTS' }, (response) => {
    if (response?.participants?.names) {
      participants = response.participants.names;
    }
  });
}

// ─── Context Banner Event Listeners ───

if (contextClearAll) {
  contextClearAll.addEventListener('click', () => {
    contextDocuments = [];
    renderContextBanner();
    chrome.storage.local.remove(['meetingContext']);
  });
}

// Back button to navigate to meetings view
if (backBtn) {
  backBtn.addEventListener('click', () => {
    // Post message to parent sidepanel to navigate
    window.parent.postMessage({ type: 'NAVIGATE_TO_MEETINGS' }, '*');
  });
}

// Listen for messages from parent sidepanel window (e.g. floating header clicks)
window.addEventListener('message', (event) => {
  if (event.data?.type === 'TOGGLE_SESSION') {
    if (sessionBtn) {
      sessionBtn.click();
    }
  } else if (event.data?.type === 'END_SESSION') {
    // End session: stop and reset to home
    if (isRunning) {
      stopSession();
    }
    resetToHome();
  } else if (event.data?.type === 'REMOVE_CONTEXT_FILE') {
    // Remove a context file by index or fileId
    const { index, fileId } = event.data;
    if (fileId) {
      const idx = contextDocuments.findIndex(d => d.id === fileId);
      if (idx !== -1) {
        contextDocuments.splice(idx, 1);
      }
    } else if (typeof index === 'number' && index >= 0 && index < contextDocuments.length) {
      contextDocuments.splice(index, 1);
    }
    renderContextBanner();
    broadcastContextState();
  }
});

// ─── Debug: Ctrl+0 Placeholder Agenda ───

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === '0') {
    e.preventDefault();

    const placeholderAgenda = [
      { item: 'Review action items from last week', status: 'completed', duration_minutes: 5, actual_minutes: 7 },
      { item: 'Q3 roadmap prioritization', status: 'completed', duration_minutes: 10, actual_minutes: 10 },
      { item: 'Design review for new onboarding flow', status: 'ongoing', duration_minutes: 15 },
      { item: 'Discuss hiring pipeline updates', status: 'upcoming', duration_minutes: 10 },
      { item: 'Sprint retro — what went well, what didn\'t', status: 'upcoming', duration_minutes: 5 },
      { item: 'Budget approval for developer tooling', status: 'skipped', duration_minutes: 8 },
      { item: 'Align on launch timeline for v2.0', status: 'new', duration_minutes: 10 },
    ];

    const placeholderAlert = 'Running 3 min over — Consider trimming later topics or pushing "Budget approval" to next sync';
    const placeholderSummary = 'Team aligned on Q3 priorities. Onboarding redesign under active discussion with positive feedback so far.';

    // Reset session time so elapsed counter starts from 0:00
    sessionStartTime = Date.now();

    renderAgenda(placeholderAgenda, placeholderAlert, placeholderSummary);
    console.log('TF Debug: rendered placeholder agenda (Ctrl+0)');
  }
});

// ─── Add Topic Interaction ───

let addTopicDuration = 10; // default duration

if (addTopicRow) {
  addTopicRow.addEventListener('click', () => {
    showAddTopicForm();
  });
}

function showAddTopicForm() {
  if (!addTopicRow) return;
  addTopicRow.style.display = 'none';

  // Check if form already exists
  let existingForm = document.getElementById('addTopicForm');
  if (existingForm) existingForm.remove();

  addTopicDuration = 10;

  const form = document.createElement('div');
  form.id = 'addTopicForm';
  form.className = 'add-topic-form';

  // Icon
  const icon = document.createElement('span');
  icon.className = 'add-topic-form__icon';
  icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';

  // Body (input + duration row)
  const body = document.createElement('div');
  body.className = 'add-topic-form__body';

  const input = document.createElement('input');
  input.className = 'add-topic-form__input';
  input.type = 'text';
  input.placeholder = 'Enter topic name...';

  const durRow = document.createElement('div');
  durRow.className = 'add-topic-form__duration';

  const minusBtn = document.createElement('button');
  minusBtn.className = 'add-topic-form__dur-btn';
  minusBtn.textContent = '\u2212';
  minusBtn.type = 'button';

  const durValue = document.createElement('span');
  durValue.className = 'add-topic-form__dur-value';
  durValue.textContent = `${addTopicDuration} min`;

  const plusBtn = document.createElement('button');
  plusBtn.className = 'add-topic-form__dur-btn';
  plusBtn.textContent = '+';
  plusBtn.type = 'button';

  minusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    addTopicDuration = Math.max(1, addTopicDuration - 5);
    durValue.textContent = `${addTopicDuration} min`;
  });

  plusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    addTopicDuration = Math.min(60, addTopicDuration + 5);
    durValue.textContent = `${addTopicDuration} min`;
  });

  durRow.appendChild(minusBtn);
  durRow.appendChild(durValue);
  durRow.appendChild(plusBtn);

  body.appendChild(input);
  body.appendChild(durRow);

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.className = 'add-topic-form__submit';
  submitBtn.textContent = 'Add';
  submitBtn.type = 'button';

  submitBtn.addEventListener('click', () => {
    const topicName = input.value.trim();
    if (!topicName) {
      input.focus();
      return;
    }
    addNewTopic(topicName, addTopicDuration);
    form.remove();
    if (addTopicRow) addTopicRow.style.display = 'flex';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitBtn.click();
    } else if (e.key === 'Escape') {
      form.remove();
      if (addTopicRow) addTopicRow.style.display = 'flex';
    }
  });

  form.appendChild(icon);
  form.appendChild(body);
  form.appendChild(submitBtn);

  // Insert after addTopicRow
  addTopicRow.parentElement.insertBefore(form, addTopicRow.nextSibling);
  input.focus();
}

function addNewTopic(name, duration) {
  // Add to the current agenda status
  const newItem = {
    item: name,
    status: 'upcoming',
    duration_minutes: duration,
  };

  if (lastAgendaStatus) {
    lastAgendaStatus.push(newItem);
  } else {
    lastAgendaStatus = [newItem];
  }

  // Re-render
  renderAgenda(lastAgendaStatus, lastTimekeepingAlert, lastSummary);
}

init();

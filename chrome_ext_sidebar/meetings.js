/**
 * ThoughtForm – Meeting Picker (Chrome Extension Sidebar)
 *
 * Displays upcoming meetings from Google Calendar and allows users to:
 *   1. Browse meetings by date (Today, Tomorrow, etc.)
 *   2. "Prep" a meeting — search Drive for related docs, select context
 *   3. Jump into the agenda tracking view with document context pre-loaded
 *
 * Requires Tier 2 auth (calendar.readonly + drive.readonly).
 */

// ─── Configuration ───
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

// ─── DOM Elements ───
const meetingsView = document.getElementById('meetingsView');
const meetingsLoading = document.getElementById('meetingsLoading');
const meetingsEmpty = document.getElementById('meetingsEmpty');
const meetingsList = document.getElementById('meetingsList');
const toast = document.getElementById('toast');

// Prep view
const prepView = document.getElementById('prepView');
const prepBack = document.getElementById('prepBack');
const prepTitle = document.getElementById('prepTitle');
const prepDocList = document.getElementById('prepDocList');
const prepSearchMore = document.getElementById('prepSearchMore');
const prepStart = document.getElementById('prepStart');
const prepDocCount = document.getElementById('prepDocCount');

// ─── State ───
let currentDate = new Date();
let selectedEvent = null;
let prepDocuments = []; // Drive docs found for selected meeting
let selectedDocIds = new Set(); // IDs of docs the user has checked

// ─── Date Helpers ───

function formatDateLabel(date) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, tomorrow)) return 'Tomorrow';
  if (isSameDay(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getDayBounds(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// ─── Calendar API ───

async function fetchCalendarEvents(date) {
  const token = await auth.getToken();
  if (!token) {
    console.error('TF Meetings: No auth token');
    return [];
  }

  const { start, end } = getDayBounds(date);

  try {
    const url = new URL(`${CALENDAR_API}/calendars/primary/events`);
    url.searchParams.set('timeMin', start.toISOString());
    url.searchParams.set('timeMax', end.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '25');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      console.error('TF Calendar API error:', response.status);
      return [];
    }

    const data = await response.json();
    // Only show events with a hangoutLink (Google Meet meetings)
    return (data.items || []).filter(e =>
      e.hangoutLink && e.start?.dateTime
    );
  } catch (err) {
    console.error('TF Calendar fetch error:', err);
    return [];
  }
}

// ─── Drive API ───

async function searchDriveForDocs(query, maxResults = 10, meetingNotesOnly = false) {
  const token = await auth.getToken();
  if (!token) return [];

  try {
    // Search for docs matching the query text
    const url = new URL(`${DRIVE_API}/files`);

    let q;
    if (meetingNotesOnly) {
      // Search specifically for meeting notes documents (Google Docs only)
      // Look for docs whose name contains "meeting notes" or "notes" combined with the meeting title
      const escaped = escapeQuery(query);
      q = `(` +
        `(name contains 'meeting notes' and name contains '${escaped}') or ` +
        `(name contains 'notes' and name contains '${escaped}') or ` +
        `(name contains 'Meeting Notes' and fullText contains '${escaped}')` +
      `) and mimeType = 'application/vnd.google-apps.document' and trashed = false`;
    } else {
      q = `(name contains '${escapeQuery(query)}' or fullText contains '${escapeQuery(query)}') ` +
        `and mimeType != 'application/vnd.google-apps.folder' ` +
        `and trashed = false`;
    }

    url.searchParams.set('q', q);
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('pageSize', String(maxResults));
    url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,webViewLink,iconLink)');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      console.error('TF Drive API error:', response.status);
      return [];
    }

    const data = await response.json();
    return data.files || [];
  } catch (err) {
    console.error('TF Drive search error:', err);
    return [];
  }
}

function escapeQuery(str) {
  // Escape single quotes for Drive API query
  return str.replace(/'/g, "\\'").replace(/\\/g, '\\\\');
}

async function fetchDocExport(fileId, mimeType) {
  const token = await auth.getToken();
  if (!token) return '';

  try {
    let url;
    // For Google Workspace files, export as plain text
    if (mimeType?.startsWith('application/vnd.google-apps.')) {
      url = `${DRIVE_API}/files/${fileId}/export?mimeType=text/plain`;
    } else {
      url = `${DRIVE_API}/files/${fileId}?alt=media`;
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) return '';

    const text = await response.text();
    return text;
  } catch (err) {
    console.error('TF Doc export error:', err);
    return '';
  }
}

// ─── Render Meetings ───

async function loadMeetings() {
  meetingsList.innerHTML = '';
  meetingsEmpty.style.display = 'none';
  meetingsLoading.style.display = 'flex';

  // Update date label in parent sidepanel
  const labelText = formatDateLabel(currentDate);
  window.parent.postMessage({ type: 'DATE_LABEL_UPDATED', label: labelText }, '*');

  const events = await fetchCalendarEvents(currentDate);

  meetingsLoading.style.display = 'none';

  if (events.length === 0) {
    meetingsEmpty.style.display = 'flex';
    return;
  }

  events.forEach((event, i) => {
    const card = createMeetingCard(event, i);
    meetingsList.appendChild(card);
  });
}

function createMeetingCard(event, index) {
  const card = document.createElement('div');
  card.className = 'meeting-card';
  card.style.animationDelay = `${index * 0.05}s`;

  const now = new Date();
  const startTime = new Date(event.start.dateTime);
  const endTime = new Date(event.end.dateTime);
  const isLive = now >= startTime && now <= endTime;
  const isUpcoming = now < startTime;

  if (isLive) {
    card.classList.add('meeting-card--live');
  }

  let html = '';

  // Live badge
  if (isLive) {
    html += `
      <div class="meeting-card__live-badge">
        <span class="meeting-card__live-dot"></span>
        LIVE
      </div>
    `;
  }

  // Title
  html += `<div class="meeting-card__title">${escapeHtml(event.summary || 'Untitled meeting')}</div>`;

  // Time
  html += `<div class="meeting-card__time">${formatTime(event.start.dateTime)} – ${formatTime(event.end.dateTime)}</div>`;

  // Meta (attendees + actions)
  // Meta (attendees + actions)
  const attendeeCount = event.attendees?.length || 0;
  html += `
    <div class="meeting-card__meta">
      <div class="meeting-card__attendees">
        <svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
        ${attendeeCount} attendee${attendeeCount !== 1 ? 's' : ''}
      </div>
      <div class="meeting-card__actions">
        ${isLive ? `<button class="meeting-card__btn meeting-card__btn--join" data-hangout="${escapeAttr(event.hangoutLink)}">Join</button>` : ''}
      </div>
    </div>
  `;

  card.innerHTML = html;

  // Event listeners
  const prepBtn = card.querySelector('.meeting-card__btn--prep');
  if (prepBtn) {
    prepBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      jumpToAgenda(event);
    });
  }

  const joinBtn = card.querySelector('.meeting-card__btn--join');
  if (joinBtn) {
    joinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Open the Meet link in a new tab
      chrome.tabs.create({ url: event.hangoutLink });
    });
  }

  // Clicking the card skips doc picker and goes directly to agenda
  card.addEventListener('click', () => {
    jumpToAgenda(event);
  });

  return card;
}

/**
 * Skip the prep/doc picker view — save calendar event context
 * and navigate directly to the agenda page.
 * Past meeting notes will be auto-fetched by agenda.js in the background.
 */
function jumpToAgenda(event) {
  const meetingContext = {
    calendarEvent: event,
    documents: [], // agenda.js will auto-fetch past notes
  };

  chrome.storage.local.set({ meetingContext }, () => {
    window.parent.postMessage({ type: 'NAVIGATE_TO_AGENDA' }, '*');
  });
}

// ─── Prep View ───

async function openPrepView(event) {
  selectedEvent = event;
  prepDocuments = [];
  selectedDocIds = new Set();

  // Switch views
  meetingsView.style.display = 'none';
  prepView.classList.add('visible');

  // Set title
  prepTitle.textContent = event.summary || 'Meeting Prep';

  // Show loading
  prepDocList.innerHTML = '<div class="meetings-loading" style="padding: 24px 0;"><div class="meetings-loading__dots"><div class="meetings-loading__dot"></div><div class="meetings-loading__dot"></div><div class="meetings-loading__dot"></div></div><span style="color: var(--text-muted); font-size: 13px;">Searching for related documents...</span></div>';

  // Search Drive for meeting notes related to this meeting
  const query = event.summary || '';
  if (query) {
    const docs = await searchDriveForDocs(query, 10, true);
    prepDocuments = docs;
    // Docs start de-selected — user picks what to include
  }

  renderPrepDocs();
  updatePrepStartBtn();
}

function renderPrepDocs() {
  prepDocList.innerHTML = '';

  if (prepDocuments.length === 0) {
    prepDocList.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">
        No related documents found.<br>Use "Search Drive" to find specific files.
      </div>
    `;
    return;
  }

  prepDocuments.forEach((doc) => {
    const row = document.createElement('div');
    row.className = 'prep-doc';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'prep-doc__checkbox';
    checkbox.checked = selectedDocIds.has(doc.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedDocIds.add(doc.id);
      } else {
        selectedDocIds.delete(doc.id);
      }
      updatePrepStartBtn();
    });

    const icon = document.createElement('span');
    icon.className = 'prep-doc__icon';
    icon.textContent = getMimeIcon(doc.mimeType);

    const info = document.createElement('div');
    info.className = 'prep-doc__info';

    const name = document.createElement('div');
    name.className = 'prep-doc__name';
    name.textContent = doc.name;

    const meta = document.createElement('div');
    meta.className = 'prep-doc__meta';
    const modDate = doc.modifiedTime ? new Date(doc.modifiedTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    meta.textContent = `${getMimeLabel(doc.mimeType)} · ${modDate}`;

    info.appendChild(name);
    info.appendChild(meta);

    row.appendChild(checkbox);
    row.appendChild(icon);
    row.appendChild(info);
    prepDocList.appendChild(row);
  });
}

function updatePrepStartBtn() {
  const count = selectedDocIds.size;
  prepDocCount.textContent = count;
  prepStart.textContent = count > 0
    ? `▶ Start with ${count} doc${count !== 1 ? 's' : ''}`
    : '▶ Start without docs';
}

function closePrepView() {
  prepView.classList.remove('visible');
  meetingsView.style.display = 'block';
  selectedEvent = null;
  prepDocuments = [];
  selectedDocIds.clear();
}

async function startWithContext() {
  // Gather selected documents
  const selectedDocs = prepDocuments.filter(d => selectedDocIds.has(d.id));

  // Show loading state
  prepStart.textContent = 'Loading context...';
  prepStart.disabled = true;

  // Fetch content/summaries for selected docs
  const enrichedDocs = [];
  for (const doc of selectedDocs) {
    const content = await fetchDocExport(doc.id, doc.mimeType);
    enrichedDocs.push({
      id: doc.id,
      title: doc.name,
      mimeType: doc.mimeType,
      summary: content, // Using content as summary for now
      webViewLink: doc.webViewLink,
    });
  }

  // Store meeting context for the agenda page to pick up
  const meetingContext = {
    calendarEvent: selectedEvent,
    documents: enrichedDocs,
  };

  chrome.storage.local.set({ meetingContext }, () => {
    // Navigate to agenda view via parent sidepanel
    window.parent.postMessage({ type: 'NAVIGATE_TO_AGENDA' }, '*');
  });
}

// ─── Helpers ───

function getMimeIcon(mimeType) {
  if (!mimeType) return '📄';
  if (mimeType.includes('document') || mimeType.includes('word')) return '📝';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📊';
  if (mimeType.includes('pdf')) return '📕';
  if (mimeType.includes('drawing')) return '🎨';
  if (mimeType.includes('form')) return '📋';
  return '📄';
}

function getMimeLabel(mimeType) {
  if (!mimeType) return 'File';
  if (mimeType.includes('document')) return 'Google Doc';
  if (mimeType.includes('spreadsheet')) return 'Sheet';
  if (mimeType.includes('presentation')) return 'Slides';
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('drawing')) return 'Drawing';
  if (mimeType.includes('form')) return 'Form';
  return 'File';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(msg) {
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

// Date navigation received from parent overflow menu
window.addEventListener('message', (event) => {
  if (event.data?.type === 'NAVIGATE_DATE') {
    const direction = event.data.direction;
    if (direction === 'prev') {
      currentDate.setDate(currentDate.getDate() - 1);
    } else if (direction === 'next') {
      currentDate.setDate(currentDate.getDate() + 1);
    } else if (direction === 'today') {
      currentDate = new Date();
    }
    loadMeetings();
  }
});

// ─── Event Listeners ───



// Prep view navigation
prepBack.addEventListener('click', closePrepView);

// Prep: Search more docs
prepSearchMore.addEventListener('click', async () => {
  const query = prompt('Search Google Drive:');
  if (!query) return;

  prepSearchMore.textContent = 'Searching...';

  const docs = await searchDriveForDocs(query);
  // Merge with existing (avoid duplicates)
  const existingIds = new Set(prepDocuments.map(d => d.id));
  const newDocs = docs.filter(d => !existingIds.has(d.id));
  prepDocuments.push(...newDocs);
  newDocs.forEach(d => selectedDocIds.add(d.id));

  prepSearchMore.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
    </svg>
    Search Drive for more
  `;

  renderPrepDocs();
  updatePrepStartBtn();

  if (newDocs.length > 0) {
    showToast(`Found ${newDocs.length} more doc${newDocs.length !== 1 ? 's' : ''}`);
  } else {
    showToast('No additional docs found');
  }
});

// Prep: Start with context
prepStart.addEventListener('click', startWithContext);

// ─── Initialization ───

async function init() {
  // Initialize auth
  if (typeof auth !== 'undefined') {
    await auth.init();
  }

  // Load meetings for today
  loadMeetings();
}

init();

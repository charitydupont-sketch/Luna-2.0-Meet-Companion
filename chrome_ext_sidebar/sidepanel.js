/**
 * ThoughtForm – Side Panel Controller
 *
 * Manages the side panel lifecycle:
 *   1. Auth-aware init: login view vs main content
 *   2. View routing: meetings.html (if calendar) or agenda.html (basic)
 *   3. Toolbar: analyzing dot, play/pause, overflow menu
 */

const AGENDA_URL = chrome.runtime.getURL('agenda.html');
const MEETINGS_URL = chrome.runtime.getURL('meetings.html');

// ─── DOM Elements ───
const loginView = document.getElementById('loginView');
const signInBtn = document.getElementById('signInBtn');
const loginError = document.getElementById('loginError');
const contentFrame = document.getElementById('contentFrame');
const toolbar = document.getElementById('toolbar');
const toast = document.getElementById('toast');

// Overflow menu
const overflowBtn = document.getElementById('overflowBtn');
const overflowMenu = document.getElementById('overflowMenu');
const menuPauseResume = document.getElementById('menuPauseResume');
const menuShare = document.getElementById('menuShare');
const menuCopy = document.getElementById('menuCopy');
const menuReset = document.getElementById('menuReset');
const menuCalDrive = document.getElementById('menuCalDrive');
const menuSignOut = document.getElementById('menuSignOut');

// Date navigation in overflow menu
const menuDateNav = document.getElementById('menuDateNav');
const menuDatePrev = document.getElementById('menuDatePrev');
const menuDateLabel = document.getElementById('menuDateLabel');
const menuDateNext = document.getElementById('menuDateNext');

// Toolbar buttons
const homeBtn = document.getElementById('homeBtn');
const menuQuickStart = document.getElementById('menuQuickStart');
const toolbarPauseBtn = document.getElementById('toolbarPauseBtn');
const toolbarEndBtn = document.getElementById('toolbarEndBtn');
const analyzingDot = document.getElementById('analyzingDot');
const contextFilesBtn = document.getElementById('contextFilesBtn');
const contextPopup = document.getElementById('contextPopup');
const contextPopupBody = document.getElementById('contextPopupBody');

// Context state tracking
let contextState = { status: 'idle', files: [] }; // status: idle | fetching | loaded
let contextPopupVisible = false;
let contextHoverTimeout = null;

// Zoom controls
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const zoomLevelLabel = document.getElementById('zoomLevel');

// ─── Zoom State ───
const ZOOM_DEFAULT = 1.0;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;
let currentZoom = ZOOM_DEFAULT;

function applyZoom(level) {
  currentZoom = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level)) * 100) / 100;
  document.documentElement.style.zoom = currentZoom;
  if (zoomLevelLabel) {
    zoomLevelLabel.textContent = `${Math.round(currentZoom * 100)}%`;
  }
  chrome.storage.local.set({ panelZoom: currentZoom });
}

// ─── View Management ───

function showLoginView() {
  loginView.style.display = 'flex';
  contentFrame.style.display = 'none';
  toolbar.style.display = 'none';
  loginView.classList.add('fade-in');
  
  if (homeBtn) homeBtn.style.display = 'none';
  if (menuQuickStart) menuQuickStart.style.display = 'none';
}

function showMainContent(url) {
  loginView.style.display = 'none';
  contentFrame.style.display = 'block';
  toolbar.style.display = 'flex';
  contentFrame.src = url;
  contentFrame.classList.add('fade-in');
  toolbar.classList.add('fade-in');

  // Toggle visibility based on the active view
  const isAgendaView = url.includes('agenda.html');
  if (isAgendaView) {
    if (homeBtn) homeBtn.style.display = 'flex';
    if (toolbarPauseBtn) toolbarPauseBtn.style.display = 'flex';
    if (toolbarEndBtn) toolbarEndBtn.style.display = 'inline-block';
    if (menuPauseResume) menuPauseResume.style.display = 'flex';
    if (menuDateNav) menuDateNav.style.display = 'none';
    if (menuQuickStart) menuQuickStart.style.display = 'none';
    if (analyzingDot) analyzingDot.style.display = 'block';
    if (contextFilesBtn) contextFilesBtn.style.display = 'flex';
  } else {
    if (homeBtn) homeBtn.style.display = 'none';
    if (toolbarPauseBtn) toolbarPauseBtn.style.display = 'none';
    if (toolbarEndBtn) toolbarEndBtn.style.display = 'none';
    if (menuPauseResume) menuPauseResume.style.display = 'none';
    if (menuDateNav) menuDateNav.style.display = 'flex';
    if (menuQuickStart) menuQuickStart.style.display = 'flex';
    if (analyzingDot) analyzingDot.style.display = 'none';
    if (contextFilesBtn) contextFilesBtn.style.display = 'none';
  }
}

function updatePauseBtns(isRunning) {
  // Update toolbar button
  if (toolbarPauseBtn) {
    if (isRunning) {
      toolbarPauseBtn.classList.remove('paused');
      toolbarPauseBtn.classList.add('running');
      toolbarPauseBtn.title = 'Pause Session';
      toolbarPauseBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
    } else {
      toolbarPauseBtn.classList.remove('running');
      toolbarPauseBtn.classList.add('paused');
      toolbarPauseBtn.title = 'Resume Session';
      toolbarPauseBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
    }
  }

  // Update menu item
  if (menuPauseResume) {
    if (isRunning) {
      menuPauseResume.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>Pause session`;
    } else {
      menuPauseResume.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Resume session`;
    }
  }
}

function updateUserUI(user) {
  if (!user) return;

  // Calendar/Drive menu items
  if (auth.hasEnhancedAccess()) {
    menuCalDrive.style.display = 'none';
  } else {
    menuCalDrive.style.display = 'flex';
  }
}

function routeToCorrectView() {
  console.log('TF routeToCorrectView called, isSignedIn:', auth.isSignedIn());
  if (!auth.isSignedIn()) {
    showLoginView();
    return;
  }

  const user = auth.getUser();
  updateUserUI(user);

  // Show meetings calendar list if calendar access, otherwise agenda directly
  if (auth.hasCalendarAccess()) {
    showMainContent(MEETINGS_URL);
  } else {
    showMainContent(AGENDA_URL);
  }
}

// ─── Analyzing Dot ───

function setAnalyzingDot(active) {
  if (!analyzingDot) return;
  if (active) {
    analyzingDot.classList.add('analyzing-dot--active');
    analyzingDot.title = 'Analyzing...';
  } else {
    analyzingDot.classList.remove('analyzing-dot--active');
    analyzingDot.title = 'Idle';
  }
}

// ─── Overflow Menu ───

function toggleOverflow() {
  overflowMenu.classList.toggle('open');
}

function closeOverflow() {
  overflowMenu.classList.remove('open');
}

// ─── Toast ───

function showToast(message) {
  toast.textContent = message;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

// ─── Initialization ───

async function init() {
  // Restore saved zoom level immediately (before auth to avoid flash)
  chrome.storage.local.get(['panelZoom'], (result) => {
    const savedZoom = result.panelZoom;
    if (savedZoom && savedZoom >= ZOOM_MIN && savedZoom <= ZOOM_MAX) {
      applyZoom(savedZoom);
    } else {
      applyZoom(ZOOM_DEFAULT);
    }
  });

  // Initialize auth
  await auth.init();

  // Load running state
  chrome.storage.local.get(['isRunning'], (result) => {
    const isRunning = result.isRunning || false;
    updatePauseBtns(isRunning);
  });

  // Keep pause button in sync when changed externally
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.isRunning) {
        const isRunning = changes.isRunning.newValue || false;
        updatePauseBtns(isRunning);
      }
    }
  });

  // Route to correct view based on auth state
  routeToCorrectView();
}

// ─── Event Listeners ───

// Sign in button
signInBtn.addEventListener('click', async () => {
  signInBtn.disabled = true;
  signInBtn.style.opacity = '0.6';
  loginError.classList.remove('visible');

  try {
    await auth.signIn();
    routeToCorrectView();
  } catch (err) {
    console.error('TF Sign-in error:', err);
    loginError.textContent = err.message === 'The user did not approve access.'
      ? 'Sign-in was cancelled. Please try again.'
      : `Sign-in failed: ${err.message}`;
    loginError.classList.add('visible');
  } finally {
    signInBtn.disabled = false;
    signInBtn.style.opacity = '1';
  }
});

// Menu: Share session link
menuShare.addEventListener('click', () => {
  closeOverflow();
  chrome.storage.local.get(['shareUrl'], (result) => {
    if (result.shareUrl) {
      navigator.clipboard.writeText(result.shareUrl).then(() => {
        showToast('Share link copied!');
      }).catch(() => {
        showToast('Copy failed');
      });
    } else {
      showToast('Start a session first');
    }
  });
});

// Menu: Pause/Resume session
menuPauseResume.addEventListener('click', () => {
  closeOverflow();
  if (contentFrame && contentFrame.contentWindow) {
    contentFrame.contentWindow.postMessage({ type: 'TOGGLE_SESSION' }, '*');
  }
});

// Overflow menu
overflowBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleOverflow();
});

document.addEventListener('click', (e) => {
  if (!overflowMenu.contains(e.target) && e.target !== overflowBtn) {
    closeOverflow();
  }
});

// Menu: Copy transcript
menuCopy.addEventListener('click', () => {
  closeOverflow();
  chrome.runtime.sendMessage({ type: 'GET_SEGMENTS' }, (response) => {
    if (!response?.segments?.length) {
      showToast('No transcript to copy');
      return;
    }
    const text = response.segments.map(seg => {
      const time = new Date(seg.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `[${time}] ${seg.speaker}: ${seg.text}`;
    }).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard');
    }).catch(() => {
      showToast('Copy failed');
    });
  });
});

// Menu: Reset transcript
menuReset.addEventListener('click', () => {
  closeOverflow();
  chrome.runtime.sendMessage({ type: 'CLEAR_SEGMENTS' }).catch(() => {});
  chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'RESET_TRANSCRIPT_STATE' }).catch(() => {});
    });
  });
  // Reload current frame
  if (contentFrame.src) {
    contentFrame.src = contentFrame.src;
  }
  showToast('Transcript cleared');
});

// Menu: Connect Calendar & Drive
menuCalDrive.addEventListener('click', async () => {
  closeOverflow();
  try {
    await auth.connectServices();
    updateUserUI(auth.getUser());
    showMainContent(MEETINGS_URL);
    showToast('Calendar & Drive connected!');
  } catch (err) {
    console.error('TF Connect error:', err);
    showToast('Connection cancelled');
  }
});

// Menu: Sign out
menuSignOut.addEventListener('click', async () => {
  closeOverflow();
  await auth.signOut();
  showLoginView();
  showToast('Signed out');
});

// Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeOverflow();
  }
});

// Listen for navigation messages from iframe (meetings page → agenda page)
window.addEventListener('message', (event) => {
  if (event.data?.type === 'NAVIGATE_TO_AGENDA') {
    showMainContent(AGENDA_URL);
  } else if (event.data?.type === 'NAVIGATE_TO_MEETINGS') {
    showMainContent(MEETINGS_URL);
  } else if (event.data?.type === 'SESSION_EXPIRED') {
    showLoginView();
    showToast('Session expired. Please sign in again.');
  } else if (event.data?.type === 'ANALYZING_STATE') {
    setAnalyzingDot(event.data.active);
  } else if (event.data?.type === 'DATE_LABEL_UPDATED') {
    if (menuDateLabel) {
      menuDateLabel.textContent = event.data.label;
    }
  } else if (event.data?.type === 'CONTEXT_STATE') {
    // Context state update from agenda.js
    contextState = event.data.state || { status: 'idle', files: [] };
    updateContextIcon();
    if (contextPopupVisible) {
      renderContextPopup();
    }
  }
});

// Home button click
if (homeBtn) {
  homeBtn.addEventListener('click', () => {
    routeToCorrectView();
  });
}

// Menu: Quick Start session
if (menuQuickStart) {
  menuQuickStart.addEventListener('click', () => {
    closeOverflow();
    chrome.storage.local.remove(['meetingContext'], () => {
      showMainContent(AGENDA_URL);
    });
  });
}

// Toolbar Pause/Resume button click
if (toolbarPauseBtn) {
  toolbarPauseBtn.addEventListener('click', () => {
    if (contentFrame && contentFrame.contentWindow) {
      contentFrame.contentWindow.postMessage({ type: 'TOGGLE_SESSION' }, '*');
    }
  });
}

// Toolbar End Session button click
if (toolbarEndBtn) {
  toolbarEndBtn.addEventListener('click', () => {
    if (contentFrame && contentFrame.contentWindow) {
      contentFrame.contentWindow.postMessage({ type: 'END_SESSION' }, '*');
    }
    // Navigate to meetings page after ending the session
    showMainContent(MEETINGS_URL);
  });
}

// Zoom controls (don't close overflow — let user click multiple times)
if (zoomInBtn) {
  zoomInBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    applyZoom(currentZoom + ZOOM_STEP);
  });
}
if (zoomOutBtn) {
  zoomOutBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    applyZoom(currentZoom - ZOOM_STEP);
  });
}

// Date navigator controls (don't close overflow — let user click multiple times)
if (menuDatePrev) {
  menuDatePrev.addEventListener('click', (e) => {
    e.stopPropagation();
    if (contentFrame && contentFrame.contentWindow) {
      contentFrame.contentWindow.postMessage({ type: 'NAVIGATE_DATE', direction: 'prev' }, '*');
    }
  });
}
if (menuDateNext) {
  menuDateNext.addEventListener('click', (e) => {
    e.stopPropagation();
    if (contentFrame && contentFrame.contentWindow) {
      contentFrame.contentWindow.postMessage({ type: 'NAVIGATE_DATE', direction: 'next' }, '*');
    }
  });
}
if (menuDateLabel) {
  menuDateLabel.addEventListener('click', (e) => {
    e.stopPropagation();
    if (contentFrame && contentFrame.contentWindow) {
      contentFrame.contentWindow.postMessage({ type: 'NAVIGATE_DATE', direction: 'today' }, '*');
    }
  });
}

// Start
init();

// ─── Context Files Icon & Popup ───

function updateContextIcon() {
  if (!contextFilesBtn) return;
  contextFilesBtn.classList.remove('context--fetching', 'context--loaded');
  if (contextState.status === 'fetching') {
    contextFilesBtn.classList.add('context--fetching');
    contextFilesBtn.title = 'Fetching context files...';
  } else if (contextState.status === 'loaded' && contextState.files.length > 0) {
    contextFilesBtn.classList.add('context--loaded');
    contextFilesBtn.title = `${contextState.files.length} context file${contextState.files.length !== 1 ? 's' : ''} loaded`;
  } else {
    contextFilesBtn.title = 'No context files';
  }
}

function renderContextPopup() {
  if (!contextPopupBody) return;

  if (contextState.status === 'fetching') {
    contextPopupBody.innerHTML = `
      <div class="context-popup__fetching">
        <div class="context-popup__fetching-dots">
          <div class="context-popup__fetching-dot"></div>
          <div class="context-popup__fetching-dot"></div>
          <div class="context-popup__fetching-dot"></div>
        </div>
        Fetching meeting notes...
      </div>
    `;
    return;
  }

  if (!contextState.files || contextState.files.length === 0) {
    contextPopupBody.innerHTML = `
      <div class="context-popup__empty">No context files available</div>
    `;
    return;
  }

  const listDiv = document.createElement('div');
  listDiv.className = 'context-popup__list';

  contextState.files.forEach((file, i) => {
    const item = document.createElement('div');
    item.className = 'context-popup__item';

    const icon = document.createElement('span');
    icon.className = 'context-popup__item-icon';
    icon.textContent = file.icon || '📝';

    const name = document.createElement('span');
    name.className = 'context-popup__item-name';
    name.textContent = file.title || 'Document';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'context-popup__item-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove from context';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Tell agenda.js to remove this file
      if (contentFrame && contentFrame.contentWindow) {
        contentFrame.contentWindow.postMessage({
          type: 'REMOVE_CONTEXT_FILE',
          index: i,
          fileId: file.id
        }, '*');
      }
    });

    item.appendChild(icon);
    item.appendChild(name);
    item.appendChild(removeBtn);
    listDiv.appendChild(item);
  });

  contextPopupBody.innerHTML = '';
  contextPopupBody.appendChild(listDiv);
}

function showContextPopup() {
  if (contextPopupVisible) return;
  contextPopupVisible = true;
  renderContextPopup();
  contextPopup.classList.add('visible');
  // Close overflow menu if open
  closeOverflow();
}

function hideContextPopup() {
  contextPopupVisible = false;
  contextPopup.classList.remove('visible');
}

// Hover interactions for context icon + popup
if (contextFilesBtn) {
  contextFilesBtn.addEventListener('mouseenter', () => {
    clearTimeout(contextHoverTimeout);
    showContextPopup();
  });
  contextFilesBtn.addEventListener('mouseleave', () => {
    contextHoverTimeout = setTimeout(hideContextPopup, 200);
  });
}

if (contextPopup) {
  contextPopup.addEventListener('mouseenter', () => {
    clearTimeout(contextHoverTimeout);
  });
  contextPopup.addEventListener('mouseleave', () => {
    contextHoverTimeout = setTimeout(hideContextPopup, 200);
  });
}

// Close context popup when clicking elsewhere
document.addEventListener('click', (e) => {
  if (contextPopupVisible &&
      !contextPopup.contains(e.target) &&
      e.target !== contextFilesBtn &&
      !contextFilesBtn.contains(e.target)) {
    hideContextPopup();
  }
});

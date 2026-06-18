const toggle = document.getElementById('captureToggle');
const statusDiv = document.getElementById('status');

function updateStatus(enabled) {
  if (enabled) {
    statusDiv.className = 'status active';
    statusDiv.textContent = 'Capture active - CC will auto-enable on Meet';
  } else {
    statusDiv.className = 'status inactive';
    statusDiv.textContent = 'Capture disabled';
  }
}

chrome.storage.local.get(['captureEnabled'], (result) => {
  const enabled = result.captureEnabled || false;
  toggle.checked = enabled;
  updateStatus(enabled);
});

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.storage.local.set({ captureEnabled: enabled }, () => {
    updateStatus(enabled);
    
    chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { 
          type: 'CAPTURE_STATE_CHANGED', 
          enabled: enabled 
        }).catch(() => {});
      });
    });
  });
});

document.getElementById('openExperiment').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('experiment.html') });
});

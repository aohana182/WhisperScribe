// background.js — service worker
// On icon click: grab stream ID (must be called from SW in MV3),
// stash session data, open recorder window.

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });

    await chrome.storage.session.set({
      meetingTabId: tab.id,
      streamId,
      meetingTitle: tab.title || 'Meeting'
    });

    chrome.windows.create({
      url: chrome.runtime.getURL('recorder.html'),
      type: 'popup',
      width: 420,
      height: 560,
      focused: true
    });
  } catch (err) {
    console.error('[WLK Recorder] Failed to start session:', err);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Whisper Scribe',
      message: 'Could not capture tab audio: ' + err.message
    });
  }
});

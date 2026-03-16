// recorder.js — owns the full capture session lifecycle
// States: starting → ready → recording → saving → saved / error

const WS_URL     = 'ws://localhost:8000/asr';
const HEALTH_URL = 'http://localhost:8000/health';
const SAVE_URL   = 'http://localhost:8000/save';

let nmPort         = null;
let ws             = null;
let mediaRecorder  = null;
let mergeContext   = null;
let finalLines     = [];
let lastLineCount  = 0;
let sessionStartedAt = null;
let meetingTitle   = '';
let backupInterval = null;
let healthPollInterval = null;

// --- UI helpers ---
function setStatus(state, text) {
  const badge = document.getElementById('status-badge');
  badge.className = state;
  badge.textContent = text;
}
function setMessage(text, type) {
  if (type === undefined) type = '';
  const el = document.getElementById('message');
  el.textContent = text;
  el.className = type;
}
function appendFinal(lines) {
  const el = document.getElementById('final-text');
  for (const line of lines) {
    const text = typeof line === 'string' ? line : (line.text || '');
    if (text.trim()) el.textContent += text + '\n';
  }
  document.getElementById('transcript-area').scrollTop = 99999;
}
function setInterim(text) {
  document.getElementById('interim').textContent = text || '';
}

// --- Native Messaging ---
function connectNativeHost() {
  nmPort = chrome.runtime.connectNative('com.whisperlivekit.host');
  nmPort.onMessage.addListener(function(msg) { console.log('[NM]', msg); });
  nmPort.onDisconnect.addListener(function() {
    var err = chrome.runtime.lastError;
    console.warn('[NM] host disconnected:', err ? err.message : '');
    nmPort = null;
  });
}

// --- Health polling ---
function startHealthPolling(onReady) {
  setStatus('starting', 'Loading model...');
  setMessage('Waiting for Whisper (~8s on first run)...');
  var deadline = Date.now() + 90000;
  healthPollInterval = setInterval(async function() {
    if (Date.now() > deadline) {
      clearInterval(healthPollInterval);
      setStatus('error', 'Timeout');
      setMessage('Server did not start within 90s.', 'error');
      return;
    }
    try {
      var res = await fetch(HEALTH_URL);
      if (res.ok) {
        var data = await res.json();
        if (data.ready === true) {
          clearInterval(healthPollInterval);
          onReady();
        }
      }
    } catch(e) { /* not up yet */ }
  }, 1000);
}

// --- Audio capture ---
async function startCapture(streamId) {
  var tabStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false
  });
  var micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

  mergeContext = new AudioContext();
  var dest = mergeContext.createMediaStreamDestination();
  var tabSource = mergeContext.createMediaStreamSource(tabStream);
  tabSource.connect(dest);
  tabSource.connect(mergeContext.destination); // play tab audio back to speakers
  mergeContext.createMediaStreamSource(micStream).connect(dest);
  return dest.stream;
}

// --- WebSocket + MediaRecorder ---
function startStreaming(mergedStream) {
  ws = new WebSocket(WS_URL);

  ws.onopen = function() {
    setStatus('recording', 'Recording');
    setMessage('');
    sessionStartedAt = new Date().toISOString();

    var recOpts = {};
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      recOpts = { mimeType: 'audio/webm;codecs=opus' };
    }
    mediaRecorder = new MediaRecorder(mergedStream, recOpts);
    mediaRecorder.ondataavailable = function(e) {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
    };
    mediaRecorder.start(1000);

    var btn = document.getElementById('btn-record');
    btn.textContent = 'Stop Recording';
    btn.classList.add('recording');
    btn.disabled = false;

    backupInterval = setInterval(saveBackup, 5000);
  };

  ws.onmessage = function(event) {
    try {
      var data = JSON.parse(event.data);
      if (data.lines && data.lines.length > lastLineCount) {
        var newLines = data.lines.slice(lastLineCount);
        appendFinal(newLines);
        finalLines = data.lines;
        lastLineCount = data.lines.length;
      }
      setInterim(data.buffer_transcription || data.buffer_diarization || '');
    } catch(e) {}
  };

  ws.onerror = function() { setMessage('WebSocket error - check server', 'error'); };
  ws.onclose = function() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      setMessage('Connection dropped', 'error');
    }
  };
}

// --- Backup ---
function saveBackup() {
  chrome.storage.local.set({
    whisper_backup: {
      title: meetingTitle,
      startedAt: sessionStartedAt,
      lines: finalLines.map(function(l) { return typeof l === 'string' ? l : l.text; }),
      savedAt: new Date().toISOString()
    }
  });
}

// --- Stop ---
async function stopRecording() {
  var btn = document.getElementById('btn-record');
  btn.disabled = true;
  btn.textContent = 'Stopping...';
  clearInterval(backupInterval);

  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  await new Promise(function(r) { setTimeout(r, 300); });
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  // Do not close mergeContext — it keeps tab audio playing through speakers.
  // It will be garbage collected when the recorder window closes.

  setStatus('saving', 'Saving...');
  setInterim('');

  var endedAt = new Date().toISOString();
  var text = finalLines
    .map(function(l) { return typeof l === 'string' ? l : (l.text || ''); })
    .filter(function(t) { return t.trim(); })
    .join('\n');

  try {
    var res = await fetch(SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: meetingTitle,
        started_at: sessionStartedAt || endedAt,
        ended_at: endedAt,
        text: text
      })
    });
    var result = await res.json();
    if (result.ok) {
      setStatus('saved', 'Saved');
      setMessage('Saved: ' + result.path, 'success');
      chrome.storage.local.remove('whisper_backup');
    } else {
      throw new Error(result.error || 'save failed');
    }
  } catch(e) {
    setStatus('error', 'Save failed');
    setMessage('Error: ' + e.message + ' - transcript above is intact', 'error');
  }

  btn.textContent = 'Start Recording';
  btn.classList.remove('recording');
  btn.disabled = false;
}

// --- Init ---
async function init() {
  var session = await chrome.storage.session.get(['streamId', 'meetingTitle']);
  var streamId = session.streamId;
  meetingTitle = session.meetingTitle || 'Meeting';
  document.getElementById('meeting-title').textContent = meetingTitle;

  if (!streamId) {
    setStatus('error', 'Error');
    setMessage('No stream ID - close this and click the extension icon again.', 'error');
    return;
  }

  connectNativeHost();
  if (nmPort) nmPort.postMessage({ action: 'start_server' });

  startHealthPolling(function() {
    setStatus('ready', 'Ready');
    setMessage('Server ready - click Start Recording');

    var btn = document.getElementById('btn-record');
    btn.disabled = false;
    btn.onclick = async function() {
      if (btn.classList.contains('recording')) {
        await stopRecording();
      } else {
        btn.disabled = true;
        btn.textContent = 'Capturing...';
        try {
          var stream = await startCapture(streamId);
          startStreaming(stream);
        } catch(e) {
          setStatus('error', 'Capture failed');
          setMessage('Audio capture failed: ' + e.message, 'error');
          btn.textContent = 'Start Recording';
          btn.disabled = false;
        }
      }
    };
  });

  document.getElementById('btn-kill').onclick = function() {
    if (nmPort) {
      nmPort.postMessage({ action: 'stop_server' });
      setMessage('Server stopped.');
    }
  };
}

document.addEventListener('DOMContentLoaded', init);

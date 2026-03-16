// recorder.js — owns the full capture session lifecycle
// States: starting → ready → recording → stopping → saving → saved / error

const WS_URL     = 'ws://localhost:8000/asr?language=en';
const HEALTH_URL = 'http://localhost:8000/health';
const SAVE_URL   = 'http://localhost:8000/save';

let nmPort           = null;
let ws               = null;
let mediaRecorder    = null;
let mergeContext     = null;
let captureTabSource = null;
let captureMicSource = null;
let workletNode      = null;
let recorderWorker   = null;
let finalLines       = [];
let sessionStartedAt = null;
let meetingTitle     = '';
let backupInterval   = null;
let healthPollInterval = null;
let isRecording      = false;
let waitingForStop   = false;

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
function renderLines(lines) {
  const el = document.getElementById('final-text');
  el.textContent = (lines || [])
    .filter(function(l) { return l.speaker !== -2; })
    .map(function(l) { return typeof l === 'string' ? l : (l.text || ''); })
    .filter(function(t) { return t.trim(); })
    .join('\n');
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
  var deadline = Date.now() + 180000;
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
  captureTabSource = mergeContext.createMediaStreamSource(tabStream);
  captureMicSource = mergeContext.createMediaStreamSource(micStream);
  // Play tab audio through speakers
  captureTabSource.connect(mergeContext.destination);
}

// --- PCM path (AudioWorklet + Worker) ---
async function startPCMCapture() {
  await mergeContext.audioWorklet.addModule(chrome.runtime.getURL('web/pcm_worklet.js'));
  workletNode = new AudioWorkletNode(mergeContext, 'pcm-forwarder', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1
  });
  captureTabSource.connect(workletNode);
  captureMicSource.connect(workletNode);

  recorderWorker = new Worker(chrome.runtime.getURL('web/recorder_worker.js'));
  recorderWorker.postMessage({ command: 'init', config: { sampleRate: mergeContext.sampleRate } });
  recorderWorker.onmessage = function(e) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data.buffer);
  };
  workletNode.port.onmessage = function(e) {
    var ab = e.data instanceof ArrayBuffer ? e.data : e.data.buffer;
    recorderWorker.postMessage({ command: 'record', buffer: ab }, [ab]);
  };
}

// --- WebM path (MediaRecorder fallback) ---
function startWebMCapture() {
  var dest = mergeContext.createMediaStreamDestination();
  captureTabSource.connect(dest);
  captureMicSource.connect(dest);

  var recOpts = {};
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    recOpts = { mimeType: 'audio/webm;codecs=opus' };
  }
  mediaRecorder = new MediaRecorder(dest.stream, recOpts);
  mediaRecorder.ondataavailable = function(e) {
    if (e.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
  };
  mediaRecorder.start(1000);
}

// --- WebSocket ---
function openWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.onopen = function() {
    console.log('[WS] open, waiting for config');
  };

  ws.onmessage = async function(event) {
    var data;
    try { data = JSON.parse(event.data); } catch(e) { return; }

    if (data.type === 'config') {
      sessionStartedAt = new Date().toISOString();
      finalLines = [];

      try {
        if (data.useAudioWorklet) {
          await startPCMCapture();
        } else {
          startWebMCapture();
        }
      } catch(e) {
        setStatus('error', 'Capture failed');
        setMessage('Audio capture failed: ' + e.message, 'error');
        ws.close();
        return;
      }

      isRecording = true;
      setStatus('recording', 'Recording');
      setMessage('');
      var btn = document.getElementById('btn-record');
      btn.textContent = 'Stop Recording';
      btn.classList.add('recording');
      btn.disabled = false;
      backupInterval = setInterval(saveBackup, 5000);
      return;
    }

    if (data.type === 'ready_to_stop') {
      await finalizeSave();
      return;
    }

    if (data.type) return; // ignore diff, snapshot, etc.

    // Regular transcription update — server sends full lines array every message
    if (data.lines) {
      finalLines = data.lines;
      renderLines(data.lines);
    }
    setInterim(data.buffer_transcription || data.buffer_diarization || '');
  };

  ws.onerror = function() { setMessage('WebSocket error - check server', 'error'); };

  ws.onclose = async function() {
    if (waitingForStop) {
      // Server closed before ready_to_stop — save what we have
      await finalizeSave();
    } else if (isRecording) {
      isRecording = false;
      setStatus('error', 'Error');
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
  isRecording = false;

  // Stop audio producers
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder = null;
  }
  if (workletNode) {
    workletNode.port.onmessage = null;
    workletNode.disconnect();
    workletNode = null;
  }
  if (recorderWorker) {
    recorderWorker.terminate();
    recorderWorker = null;
  }

  // Signal end-of-stream; keep WS open until server sends ready_to_stop
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(new Blob([], { type: 'audio/webm' }));
  }

  waitingForStop = true;
  setStatus('saving', 'Processing...');
  setMessage('Waiting for server to finish...');
  setInterim('');
}

// --- Finalize (called after ready_to_stop or on unexpected WS close while stopping) ---
async function finalizeSave() {
  if (!waitingForStop) return; // guard against double-call
  waitingForStop = false;

  // Do not close mergeContext — keeps tab audio playing through speakers
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();

  setStatus('saving', 'Saving...');
  setMessage('');

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

  var btn = document.getElementById('btn-record');
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
      if (waitingForStop) return;
      if (btn.classList.contains('recording')) {
        await stopRecording();
      } else {
        btn.disabled = true;
        btn.textContent = 'Capturing...';
        try {
          await startCapture(streamId);
          openWebSocket();
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

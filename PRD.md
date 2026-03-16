# PRD: Chrome-Tab Meeting Transcription + Local Autosave
**Base repo:** https://github.com/aohana182/Whisper-Local-Tool
**Last updated:** 2026-03-16

---

## 1. Goal

One-click Chrome extension that:
- Captures **both tab audio + microphone** during browser meetings
- Transcribes locally via WhisperLiveKit (no cloud, no terminal)
- Autosaves `YYYY-MM-DD_HH-mm_<meeting-title>.txt` to `C:\MeetingTranscripts\` on stop

---

## 2. User

Single local user on Windows + Chrome. Meetings run in browser tabs (Google Meet, Zoom Web, Yandex Telemost).

---

## 3. Target Flow

1. Click extension icon
2. Small recording window opens, server starts (~8s on base model)
3. Click Record → tab + mic audio captured, transcription begins live
4. Attend meeting normally — window can be minimized
5. Click Stop → `.txt` file appears in `C:\MeetingTranscripts\`

No terminal. No localhost. No copy-paste.

---

## 4. Proven Facts About the Existing Repo

Two separate audio capture modes — **not unified**:

| Context | Runs as | Audio captured |
|---------|---------|---------------|
| `localhost:8000` in browser tab | `isWebContext` | Mic only (`getUserMedia`) |
| Loaded as Chrome extension | `isExtension` | Tab audio only (`chrome.tabCapture`), falls back to mic |

`live_transcription.js` line 530: `// in the future, both chrome page audio and mic will be used` — **mixing not implemented**.

`outputAudioContext` (lines 544–546) plays tab audio to speakers only — not in the recording pipeline.

**Why user's own voice was transcribed in local test:** ran as web page (web context) → unconditional mic capture.

---

## 5. What the Existing Repo Does Not Have

- Dual stream capture (tab + mic merged)
- Transcript save to disk
- Tab title extraction
- Session naming / filename generation
- Server lifecycle management

---

## 6. Architecture

### 6.1 Chosen Approach: Dedicated Extension Window + Native Messaging

**Extension window** (not popup, not side panel, not offscreen):
- Popup: closes on click-away → recording stops. Not viable.
- Side panel: repo README explicitly flags tab capture as broken there. Ruled out.
- Offscreen: correct MV3 architecture but service worker sleep risk + all-async messaging complexity not justified for a personal local tool.
- Dedicated window: stays open when minimized, reuses most of existing `live_transcription.js`, tab ID passable explicitly.

**Native Messaging host** (not a separate HTTP service, not a PowerShell launcher):
- Chrome extensions cannot spawn OS processes directly
- Native Messaging: small Python script (~50 lines) registered with Chrome via JSON manifest + one Windows registry entry
- Chrome spawns it on-demand, kills it when connection closes
- Zero background processes when not transcribing
- Handles both: start/stop WhisperLiveKit server AND write files to disk

### 6.2 Tab ID Handoff (critical)

When extension window opens, the meeting tab loses focus. Naive `tabCapture` would capture the wrong tab. Fix:

1. User clicks extension icon → service worker reads active tab ID (meeting tab still focused at this moment)
2. Service worker stores ID in `chrome.storage.session`
3. Extension window opens, reads stored tab ID
4. Calls `chrome.tabCapture.getMediaStreamId({targetTabId: meetingTabId})`
5. Captures the correct tab

### 6.3 Dual Stream Merge (Web Audio API)

Web Audio API = browser-native, no external service, no network. In-memory audio routing.

```js
const mergeContext = new AudioContext();
const destination = mergeContext.createMediaStreamDestination();
mergeContext.createMediaStreamSource(tabStream).connect(destination);
mergeContext.createMediaStreamSource(micStream).connect(destination);
const mergedStream = destination.stream; // sent to WebSocket as before
```

### 6.4 Server Lifecycle

- Click Record → Native Messaging host spawns `wlk --model base --language auto`
- Extension polls `ws://localhost:8000/asr` until ready
- Auto-starts capture when server responds
- Server stays warm between sessions
- Manual kill button in extension UI

### 6.5 File Save

On stop, extension sends to Native Messaging host:
```json
{
  "title": "Zoom Monthly Review",
  "started_at": "2026-03-16T14:00:00",
  "ended_at": "2026-03-16T15:00:00",
  "text": "full transcript here"
}
```

Host:
- Sanitizes title (strips invalid Windows filename chars)
- Generates `YYYY-MM-DD_HH-mm_<title>.txt`
- Creates `C:\MeetingTranscripts\` if missing
- Writes file atomically
- Returns success/error to extension

Saved file format:
```
Meeting: Zoom Monthly Review
Started: 2026-03-16 14:00
Ended:   2026-03-16 15:00

[Transcript]

...transcript text...
```

---

## 7. Component Map

| Component | What | Action |
|-----------|------|--------|
| WhisperLiveKit server | Existing Python backend | Unchanged |
| `live_transcription.js` | Main frontend | Modify: dual stream merge + tab ID fix + AudioWorklet path fix |
| `manifest.json` | Extension config | No change (permissions already correct) |
| `background.js` | Service worker | Modify: tab ID capture + Native Messaging orchestration |
| `recorder.html` + `recorder.js` | Extension window UI | New: replaces popup |
| `native_host.py` | Native Messaging host | New: server lifecycle + file write |
| `native_host_manifest.json` | Chrome NM registration | New: one-time setup |
| Setup script | Registry + path installer | New: one-time, run once |
| `C:\MeetingTranscripts\` | Save folder | Created by host at first save |

---

## 8. Functional Requirements

| ID | Requirement |
|----|------------|
| FR-1 | Click extension icon → server starts, recording window opens |
| FR-2 | Capture tab audio + mic simultaneously, merge before sending to server |
| FR-3 | Stream merged audio to `ws://localhost:8000/asr` |
| FR-4 | Display live transcript in recording window |
| FR-5 | Accumulate only finalized (non-interim) transcript segments |
| FR-6 | Read tab title at session start for filename |
| FR-7 | On stop: save `YYYY-MM-DD_HH-mm_<sanitized-title>.txt` to `C:\MeetingTranscripts\` |
| FR-8 | Show save confirmation or error in UI |
| FR-9 | Support English + Russian, auto language detection preferred |
| FR-10 | Server stays warm between sessions, manual kill in UI |
| FR-11 | If server not running: show clear error, block capture start |
| FR-12 | If save fails: show error, preserve transcript in UI until window closes |
| FR-13 | Do not break existing offline file transcription CLI behavior |

---

## 9. Non-Functional Requirements

- **Local only:** no cloud, no telemetry, no external API calls
- **Lean:** no Electron, no Docker, no database
- **Default model:** `base` (~6-8s startup on T14s 2023 AMD Ryzen — confirmed acceptable)
- **Save folder:** `C:\MeetingTranscripts\` (configurable in one place)
- **Language default:** auto-detect

---

## 10. Risks

| Risk | Severity | Status |
|------|----------|--------|
| `chrome.tabCapture` may not capture WebRTC audio (Meet/Zoom/Telemost) | High | Untested — user accepted risk. YouTube test passed. Next: test with actual WebRTC call. |
| Mic `getUserMedia` in extension window without user gesture | Low | Works if mic permission pre-granted by existing flow |
| AudioWorklet path `/web/pcm_worklet.js` won't resolve from extension window | Medium | Fix: use `chrome.runtime.getURL('web/pcm_worklet.js')` |

---

## 11. Out of Scope

- Zoom desktop app capture
- OS-wide loopback audio
- Cloud transcription
- Speaker diarization / identity mapping
- Summarization or action items
- Multi-user deployment
- Replacing WhisperLiveKit

---

## 12. Implementation Sequence

1. Read and fully understand `live_transcription.js` before modifying
2. Fix tab ID handoff in `background.js`
3. Create `recorder.html` / `recorder.js` extension window
4. Implement dual stream merge in `live_transcription.js`
5. Fix AudioWorklet path resolution
6. Wire transcript accumulation (final vs interim)
7. Build `native_host.py` (server start + file write)
8. One-time setup script (registry + paths)
9. Test: YouTube ✓ → WebRTC call → Meet → Zoom Web → Telemost
10. Write updated README

---

## 13. One-Time Setup (user-facing)

Run setup script once:
- Registers Native Messaging host with Chrome (JSON manifest)
- Adds Windows registry entry pointing to `native_host.py`
- Creates `C:\MeetingTranscripts\` if missing

After that: clicking the extension is the entire workflow forever.

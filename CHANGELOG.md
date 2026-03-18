# Changelog

Each version documents the problem that motivated the work, what was done, and what remains open.

---

## [v0.4.0] — 2026-03-16

### Problem
No Russian-language extension existed. The legacy `recorder-extension/` folder was a leftover copy of the upstream Chrome extension structure and was causing confusion about which folder to edit. Machine-specific generated files (`host.bat`, `host.json`, `server_log.txt`) were being tracked by git.

### What was done
- Added `recorder-extension-ru/` — identical to the EN extension but with `?language=ru` in the WebSocket URL
- Deleted `recorder-extension/` (legacy; superseded by the EN and RU variants)
- Added `host.bat`, `com.whisperlivekit.host.json`, and `server_log.txt` to `.gitignore` — these are machine-specific files written by `setup.ps1` at install time

### Outstanding
- Lag issues from v0.3.0 remain unresolved
- CPU-only performance is not acceptable for any model or language
- All performance data predates the transport fixes in v0.2.0 — a clean re-evaluation is needed

---

## [v0.3.0] — 2026-03-16

### Problem
After the transport fixes in v0.2.0, lag was still 10–25 s during speech and growing over time. Logs showed `internal_buffer` consistently at `0.00s`, ruling out the trimming buffer itself. Root cause identified: `buffer_trimming_sec=30` caused compounding growth. `get_all_from_queue` concatenates all backlogged PCM into one array before inference. With a 30 s cap, inference on `small` took ~15 s per pass — during which 15 s more audio queued. This compounded into unbounded lag.

### What was done
- Set `--min-chunk-size 1` (was 3) and `--buffer_trimming_sec 8` (was 30)
- Caps inference input to ~8 s per pass, eliminating compounding growth
- Confirmed: lag no longer grows unboundedly after the fix

### Outstanding
Lag still reaches 10–25 s during speech. `internal_buffer=0.00s` on all log lines — buffer trimming is working, lag is coming from elsewhere. Two signals observed:

1. Individual 1 s chunks cause 6–8 s lag jumps — inference on `base` is far slower in production than benchmarks suggest
2. Silero VAD frequently classifies speech as silence (`Silence of = 16.93s` observed during active speech) — audio is silently dropped during these windows

Untested hypotheses:

| Hypothesis | How to test |
|---|---|
| Silero VAD misclassifying speech as silence | Disable VAD and compare lag and transcript coverage |
| Silero VAD itself is slow on CPU | Time `vac.__call__` separately; check ONNX accelerator status |
| Production inference slower than benchmark (Python/tokenizer overhead per pass) | Add per-inference timing to server log |
| `--confidence-validation` ineffective on `base` — confidence never reaches 0.95, so no trim progress | Remove flag; switch to LocalAgreement; compare commit rate |
| `--min-chunk-size 1` too frequent — fixed overhead per call dominates | Try 2 or 3 |

---

## [v0.2.0] — 2026-03-15

### Problem
Three bugs confirmed in live testing after v0.1.0:

1. **Wrong audio transport.** The server expected raw PCM via AudioWorklet. The extension was sending MediaRecorder-encoded audio (WebM/Opus). The server received garbage and produced no output.
2. **Broken stop semantics.** `stopRecording()` closed the WebSocket immediately. The server sends `ready_to_stop` before it is safe to finalize. Closing early meant `POST /save` was called before the server finished — transcripts were incomplete or empty.
3. **Lossy dedup.** The transcript dedup logic compared numeric timestamps incorrectly, causing duplicate lines to appear in the UI.

Also: no language was specified in the WebSocket URL, causing Whisper to auto-detect and sometimes lock onto the wrong language (Russian sometimes returned as Arabic).

### What was done
- Activated the AudioWorklet + Worker PCM path (server sends `useAudioWorklet: true` in config message; extension switches path on receipt)
- Fixed stop: `stopRecording()` sends an empty Blob (EOF) and sets `waitingForStop=true`; WebSocket stays open; `finalizeSave()` called only after `ready_to_stop` arrives or WebSocket closes unexpectedly; double-call guard added
- Fixed dedup: replaced numeric timestamp comparison with a Set of line-start strings
- Renamed to Whisper Scribe EN; hardcoded `?language=en` in the WebSocket URL
- Redirected server stdout/stderr to `server_log.txt` for diagnostics
- Removed `--init-prompt` (was added to hint language; removed because it interfered with EN language detection)

### Outstanding
- Growing lag identified but not yet fixed (addressed in v0.3.0)
- No Russian-language extension (addressed in v0.4.0)
- All performance data from v0.1.0 was collected with the broken audio transport — figures are invalid and need re-evaluation

---

## [v0.1.0] — 2026-03-14

### Problem
No tool existed for recording browser meetings locally without sending audio to a cloud service. WhisperLiveKit provided a local transcription server but had no Chrome extension for capturing meeting audio from a browser tab.

### What was done
- Chrome extension (Manifest V3) capturing tab audio + microphone via `chrome.tabCapture` and `getUserMedia`
- Dedicated recorder window (not popup) — popup JS context closes when user clicks away, which kills the WebSocket mid-session
- Tab ID / stream ID handoff via `chrome.storage.session`: service worker obtains `streamId` token, stores it with meeting title, opens `recorder.html`; recorder reads session storage and calls `getUserMedia(streamId)`
- `native_host/host.py` — Chrome Native Messaging host that starts and stops `server.py`
- `native_host/setup.ps1` — one-time setup: writes `host.bat` with hardcoded Python path (Chrome's minimal `PATH` won't find bare `python`), writes NM manifest, sets Windows registry key
- `server.py` — FastAPI wrapper over WhisperLiveKit adding `POST /save`: writes transcript atomically to `C:\MeetingTranscripts\YYYY-MM-DD_HH-mm_<title>.txt` via `.tmp` → rename
- Transcript rendering: server sends full accumulated line list per WebSocket message; UI replaces transcript from scratch each message; silence markers (`speaker === -2`) filtered

### Outstanding
- Three bugs found in live testing (wrong transport, broken stop, lossy dedup) — fixed in v0.2.0
- No Russian-language extension — added in v0.4.0
- Performance on CPU-only hardware not yet characterized at this point

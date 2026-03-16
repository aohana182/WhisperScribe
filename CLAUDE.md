# CLAUDE.md — Whisper Scribe

## Project

Chrome extension + Python server for local meeting transcription.
Backend engine: `whisperlivekit` (pip package by QuentinFuxa).

## Key files

| File | Purpose |
|---|---|
| `server.py` | FastAPI server — adds `POST /save` on top of whisperlivekit |
| `native_host/host.py` | Chrome Native Messaging host — starts/stops server.py |
| `native_host/setup.ps1` | One-time setup: writes host.bat, NM manifest, registry key |
| `recorder-extension/` | The Chrome extension — load this in Chrome |
| `tests/` | pytest (Python) + Vitest (JS) tests |
| `requirements.txt` | `whisperlivekit` — the only Python dependency |

## Build & Test

```powershell
pip install whisperlivekit httpx pytest
python -m pytest tests/ -v

cd recorder-extension && npm test
```

## Known open issues

### Three confirmed bugs in extension transport layer (fix in progress as of 2026-03-16)

External code review identified three root causes that explain missing/lagging transcription. These are **separate from the hardware ceiling** and fixable in software.

#### Bug 1 — Wrong audio transport (highest impact)
`host.py` launches server without `--pcm-input` → server sends `useAudioWorklet: false` → extension always uses MediaRecorder with 1-second Opus chunks. WLK has a lower-latency PCM path (AudioWorklet + Worker) that bypasses Opus encode/decode and eliminates the 1s batching delay. The worklet files (`web/pcm_worklet.js`, `web/recorder_worker.js`) are already in the extension but never used.

**Fix:** Add `--pcm-input` to `host.py` Popen args. Implement PCM branch in `recorder.js` triggered by `config.useAudioWorklet`.

#### Bug 2 — Broken stop semantics (tail audio dropped)
`recorder.js` line 128: `if (data.type) return` silently ignores `ready_to_stop`. Current stop: MediaRecorder.stop() → wait 300ms → close WS → save. Server hasn't finished flushing when we close. Matches README note "unprocessed audio is dropped when recording stops."

**Fix:** On stop — send EOF signal (empty blob), keep WS open, set `waitingForStop = true`. Save only after `ready_to_stop` arrives.

#### Bug 3 — Lossy dedup drops valid updates
Extension accumulates lines by appending, deduping only by `start` timestamp. Server sends the **full lines array** every message. Two lines can share a start boundary; revised segments with same start are discarded.

**Fix:** Replace `finalLines` on every message (not append). Re-render transcript from scratch each time.

---

### CPU performance / Russian transcription (hardware ceiling — separate issue)

**Symptom:** On CPU-only hardware (Lenovo T14s 2023), transcription either misses ~94% of Russian audio or has growing lag.

**Root cause:** WLK token commitment mechanisms both fail on CPU+Russian. The above three bugs made this worse but don't fully explain it.

**What was tried:**
- `base` + LocalAgreement (default) → 6% commit rate on Russian
- `base` + `--confidence-validation` → no improvement
- `base` + `--no-vac` → broke language detection entirely
- `small` + `--confidence-validation` + `--min-chunk-size 5` → good quality but 0.5x real-time, growing lag
- `medium` → immediately unusable on CPU (31s+ lag within first minute)

**Current default:** `base` + `--confidence-validation` (`native_host/host.py` Popen args). None of the models work properly for either English or Russian on this hardware. Re-evaluation pending after transport-layer fixes.

**Next step:** Fix the three bugs above first. Then re-evaluate Russian performance on the clean transport path.

---

## Session log

### 2026-03-16 — Transport/stop/dedup bugs diagnosed
- External code review identified three bugs in `recorder.js` (wrong transport, broken stop, lossy dedup)
- All three confirmed by reading code
- Fix plan approved: PCM path + ready_to_stop + full-replace rendering
- Implementation in progress

---

## Do NOT

- Do not write files into `recorder-extension/` without reading what's already there first.
- Do not create files in any folder without first checking who owns it and whether anything auto-generates it.
- Read before write — always.

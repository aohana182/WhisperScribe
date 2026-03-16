# Whisper Scribe

> I took [QuentinFuxa's WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit) and vibe coded a Chrome extension on top of it. I don't fully understand the internals. If something breaks in the backend, go read his repo — that's the actual engine. What I built is the recorder extension that sits on top of it.

---

## What it does

One-click Chrome extension for recording browser meetings locally.

- Click the extension icon on any meeting tab
- It captures **tab audio + your mic** simultaneously
- Transcribes in real time using Whisper running on your machine
- When you stop, saves a `.txt` file to `C:\MeetingTranscripts\YYYY-MM-DD_HH-mm_<title>.txt`
- Nothing leaves your machine. No cloud. No subscriptions.

Tested on: Google Meet, Zoom Web, Yandex Telemost.

---

## Requirements

- Windows 10/11
- Python 3.11–3.13
- Chrome (or any Chromium browser)
- ~1GB disk space for the Whisper `base` model (auto-downloaded on first run)

---

## Installation (one-time setup)

### Step 1 — Install the Python backend

This project depends on [QuentinFuxa's WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit) as its transcription engine. Install it first:

```powershell
pip install whisperlivekit
```

Or install everything at once:

```powershell
pip install -r requirements.txt
```

### Step 2 — Load the extension in Chrome

1. Open Chrome → go to `chrome://extensions`
2. Toggle **Developer mode** on (top-right corner)
3. Click **Load unpacked**
4. Select the `recorder-extension/` folder from this repo
5. The extension appears as **"Whisper Scribe"**
6. **Copy the extension ID** — the 32-character string shown under the name

### Step 3 — Register the native host (one-time)

```powershell
powershell -ExecutionPolicy Bypass -File native_host\setup.ps1
```

When prompted, paste the extension ID from Step 2.

This script:
- Finds your Python automatically
- Registers the native host with Chrome (writes one Windows registry key)
- Creates `C:\MeetingTranscripts\` if it doesn't exist

**Re-run this script if you ever reinstall the extension** (Chrome gives it a new ID).

---

## How to use it

1. Open Chrome, go to your meeting tab (Meet, Zoom, Telemost, etc.)
2. Click the **Whisper Scribe** icon in the Chrome toolbar
   - If you don't see it: click the puzzle piece icon → pin it
3. A recorder window opens. Status shows **"Starting server..."**
4. Wait ~8 seconds on first run (Whisper loads). After that it's instant.
5. Status changes to **"Ready"** → click **Start Recording**
6. Talk. The transcript appears in real time.
7. Click **Stop Recording** when done
8. Find your file in `C:\MeetingTranscripts\`

### Buttons

| Button | What it does |
|--------|-------------|
| Start Recording | Begins capturing tab audio + mic and transcribing |
| Stop Recording | Stops capture, saves transcript to disk |
| Kill Server | Shuts down the Whisper server (frees memory) |

---

## Model sizes and language support

Default is `base` with `--min-chunk-size 3` — the only model that runs in real-time on a CPU-only machine. On machines with a GPU, switch to `small` or `medium` for better accuracy.

**Language:** auto-detected. Russian and English both work out of the box — no configuration needed. The language flag is intentionally omitted so Whisper picks the language from the audio.

To change the model, language, or any other server flag, edit **`native_host/host.py` line 50** — that is the single place where all server launch arguments are hardcoded.

| Model | Size | Load time | Quality | Languages |
|-------|------|-----------|---------|-----------|
| `tiny` | 75 MB | ~2s | Poor | English only reliable |
| `base` | 145 MB | ~4s | Basic | English ok, others weak |
| `small` | 465 MB | ~10s | Good | Most languages including Russian |
| `medium` | 1.5 GB | ~20s | Very good | All languages well |
| `large-v3` | 3 GB | ~40s | Best | All languages, best for code-switching |

**For Russian / mixed Russian+English:** use `small` at minimum, `medium` recommended.


**For code-switching** (switching between languages mid-sentence): `medium` or `large-v3` — smaller models tend to lock onto the first detected language.

Models download automatically on first use and are cached locally.

---

## Known limitations

### Performance on CPU-only hardware (tested: Lenovo T14s 2023, Intel i7-1355U)

WhisperLiveKit uses two mechanisms to decide when to commit a transcribed token to the final transcript:

1. **LocalAgreement** (default): commits a token only when two consecutive model inferences agree on it.
2. **`--confidence-validation`**: commits tokens with probability > 0.95 without waiting for agreement.

### What was tested

| Config | Outcome |
|--------|---------|
| `base` + default (LocalAgreement) | ~6% of audio committed. Both English and Russian affected. |
| `base` + `--confidence-validation` | No meaningful improvement. Token confidence on `base` rarely exceeds 0.95. |
| `small` + `--confidence-validation` | ~99% of audio committed but lag grows ~0.5s per second of speech. For a 30-min meeting lag reaches ~15 min. Text appears 10–13s late in the UI; unprocessed audio is dropped when recording stops. |
| `medium` | Lag immediately unacceptable (31s+ within first minute). |

None of the models produce acceptable results on CPU-only hardware for either English or Russian. The tested results above reflect the state before transport-layer fixes (PCM path, correct stop handling) — re-evaluation is pending after those fixes land.

### Root cause of growing lag (identified 2026-03-16)

`get_all_from_queue` concatenates all backlogged PCM chunks into one array before inference. WLK's `audio_buffer` accumulates audio until `buffer_trimming_sec` is reached. Inference time grows proportionally to buffer size. With `buffer_trimming_sec=30`, the buffer grows to 30s — at 2x realtime (`small` model) that is 15s per inference pass, during which 15s more audio queues up. This compounds into unbounded lag growth.

**Fix applied (commit ac1fc3a):** `--min-chunk-size 1` (was 3), `--buffer_trimming_sec 8` (was 30). Caps inference per pass to 2s (`base`) or 4s (`small`), eliminating the compounding growth. Expected outcome: lag stabilizes instead of growing.

### Path forward

1. ~~Fix the three extension bugs (wrong transport, broken stop, lossy dedup)~~ — code complete (commit e7e1863), **live review outstanding**.
2. ~~Identify root cause of growing lag~~ — done (buffer_trimming_sec=30 caused compounding, commit ac1fc3a).
3. Re-test all model/config combinations with new buffer params on the clean transport path.
4. If hardware is the ceiling after software fixes: investigate OpenVINO backend for Intel Iris Xe.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Recorder window opens but stays "Starting server..." forever | Open PowerShell, run `python server.py --model base` to see the error |
| "Native Messaging failed" in the recorder window | Re-run `native_host\setup.ps1` — the extension ID may have changed |
| No extension icon visible | Click the puzzle piece in Chrome toolbar → pin Whisper Scribe |
| Tab audio not captured | Chrome requires the tab to be playing audio when you click the icon |

---

## Project structure

```
recorder-extension/     The Chrome extension — load this in Chrome
native_host/            Small Python script that manages the Whisper server process
server.py               FastAPI server wrapping QuentinFuxa's WhisperLiveKit backend
tests/                  Automated tests
```

---

## Running tests

```powershell
# Python tests
python -m pytest tests/ -v

# JS unit tests
cd recorder-extension && npm test
```

---

## Credits

Backend engine: [WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit) by QuentinFuxa.
Everything in `recorder-extension/`, `native_host/`, and `server.py` is mine.

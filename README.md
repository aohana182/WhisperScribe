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

Default is `medium` — good balance of accuracy and speed for multilingual use. To change it, open `native_host/host.py` and replace `--model medium` with your preferred size.

| Model | Size | Load time | Quality | Languages |
|-------|------|-----------|---------|-----------|
| `tiny` | 75 MB | ~2s | Poor | English only reliable |
| `base` | 145 MB | ~4s | Basic | English ok, others weak |
| `small` | 465 MB | ~10s | Good | Most languages including Russian |
| `medium` | 1.5 GB | ~20s | Very good | All languages well |
| `large-v3` | 3 GB | ~40s | Best | All languages, best for code-switching |

**For Russian / mixed Russian+English:** use `small` at minimum, `medium` recommended.

**For English-only:** `base` is fine and loads faster.

**For code-switching** (switching between languages mid-sentence): `medium` or `large-v3` — smaller models tend to lock onto the first detected language.

Models download automatically on first use and are cached locally.

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

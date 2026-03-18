# Whisper Scribe

Chrome extension for streaming transcription of browser meetings — locally, on your machine. Captures tab audio and microphone simultaneously, streams audio to a local Whisper server, and saves a timestamped `.txt` file when you stop.

Nothing leaves your machine. No cloud. No subscription.

Tested on: Google Meet, Zoom Web, Yandex Telemost.

---

## Requirements

- Windows 10/11
- Python 3.11–3.13
- Chrome (or any Chromium browser)
- ~1 GB disk for the Whisper `base` model (downloaded automatically on first run)
- GPU strongly recommended for usable latency — see [Model guide](#model-guide)

---

## Installation

### 1 — Install the Python backend

```powershell
pip install -r requirements.txt
```

### 2 — Load the extension in Chrome

Two extensions are provided — load one or both:

| Folder | Extension | Language |
|--------|-----------|----------|
| `recorder-extension-en/` | Whisper Scribe EN | English |
| `recorder-extension-ru/` | Whisper Scribe RU | Russian |

For each extension:

1. Chrome → `chrome://extensions`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked** → select the extension folder
4. Copy the 32-character extension ID shown under the name

### 3 — Register the native host

Run once per extension, pasting the ID when prompted:

```powershell
powershell -ExecutionPolicy Bypass -File native_host\setup.ps1
```

This script locates your Python, registers the native host with Chrome (one registry key), and creates `C:\MeetingTranscripts\` if it doesn't exist.

**Re-run if you ever reinstall an extension** — Chrome assigns a new ID each time.

---

## Usage

1. Go to your meeting tab in Chrome
2. Click the **Whisper Scribe** icon in the toolbar
   - Don't see it? Click the puzzle piece → pin it
3. The recorder window opens — wait for **"Ready"** (~8 s on first run while the model loads)
4. Click **Start Recording**
5. Talk — transcript streams in with a short delay
6. Click **Stop Recording** — file saved to `C:\MeetingTranscripts\`

### Buttons

| Button | Action |
|--------|--------|
| Start Recording | Captures tab audio + mic, begins transcription |
| Stop Recording | Stops capture, saves transcript |
| Kill Server | Shuts down the Whisper process (frees memory) |

---

## Model guide

**Backend:** [faster-whisper](https://github.com/guillaumekln/faster-whisper) (ctranslate2), served via [WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit). Audio is streamed as raw PCM over WebSocket.

Default model is `base`. To change it, edit **`native_host/host.py` line 50** — that is the single place where all server launch arguments are set.

| Model | Size | CPU load time | Notes |
|-------|------|---------------|-------|
| `tiny` | 75 MB | ~2 s | Unreliable for non-English |
| `base` | 145 MB | ~4 s | Default. English acceptable; Russian/other weak |
| `small` | 465 MB | ~10 s | Most languages usable; minimum for Russian |
| `medium` | 1.5 GB | ~20 s | All languages well; recommended for Russian |
| `large-v3` | 3 GB | ~40 s | Best accuracy; handles code-switching |

Load times above are CPU estimates on a mid-range laptop. GPU load times are 3–5× faster.

For Russian or mixed Russian+English: `small` minimum, `medium` recommended.
For code-switching (mid-sentence language switches): `medium` or `large-v3`.

Models download automatically on first use from Hugging Face.

---

## Known limitations

**CPU-only hardware is not viable for real-time use.** Tested on Intel i7-1355U (Lenovo ThinkPad T14s 2023, no GPU):

- `base` model: 10–25 s transcription lag during speech. Root cause: Silero VAD running on CPU per chunk, plus faster-whisper inference slower than advertised benchmarks under streaming conditions.
- `small` and larger: lag grows continuously and becomes unusable within minutes.

A GPU with CUDA (NVIDIA), ROCm (AMD), or OpenVINO (Intel Arc / Iris Xe) support is required for usable results. The faster-whisper backend will use it automatically if available.

Open performance issues are tracked [here](../../issues).

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Stuck on "Starting server..." | Run `python server.py --model base` in PowerShell to see the error |
| "Native Messaging failed" | Re-run `native_host\setup.ps1` — extension ID may have changed |
| No icon visible | Click the puzzle piece in toolbar → pin Whisper Scribe |
| Tab audio not captured | The tab must be playing audio when you click the icon |

---

## Project structure

```
recorder-extension-en/   Chrome extension — English
recorder-extension-ru/   Chrome extension — Russian
native_host/             Chrome Native Messaging host — manages the server process
server.py                FastAPI server wrapping WhisperLiveKit, adds POST /save
tests/                   Python (pytest) and JS (Vitest) tests
```

---

## Running tests

```powershell
python -m pytest tests/ -v
cd recorder-extension-en && npm test
```

---

## Credits

Transcription engine: [WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit) by QuentinFuxa, built on [faster-whisper](https://github.com/guillaumekln/faster-whisper) (ctranslate2).
Everything in `recorder-extension-en/`, `recorder-extension-ru/`, `native_host/`, and `server.py` is original work built on top of it.

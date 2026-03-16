# Whisper Local Tool

One-click Chrome extension that records browser meetings locally — no cloud, no subscriptions, no terminal.

Captures tab audio + microphone, transcribes in real time using [WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit) running on your machine, and saves a timestamped `.txt` file to `C:\MeetingTranscripts\` when you stop.

---

## What it does

- Click the extension icon on any meeting tab (Google Meet, Zoom Web, Telemost, etc.)
- Recorder window opens, Whisper model loads (~8s first time, instant after)
- Click **Start Recording** — tab audio and your mic are both captured and transcribed
- Click **Stop Recording** — transcript saved to `C:\MeetingTranscripts\YYYY-MM-DD_HH-mm_<title>.txt`
- Everything runs locally on your machine

---

## Requirements

- Windows 10/11
- Python 3.11–3.13
- Chrome (or Chromium-based browser)
- ~1GB disk for the Whisper `base` model (downloaded automatically on first run)

---

## Setup (one-time)

**1. Install the Python backend**

```powershell
pip install -e .
```

**2. Load the extension in Chrome**

- Go to `chrome://extensions`
- Enable **Developer mode** (top-right toggle)
- Click **Load unpacked** → select the `recorder-extension/` folder
- Copy the 32-character extension ID shown under the extension name

**3. Run the setup script**

```powershell
powershell -ExecutionPolicy Bypass -File native_host\setup.ps1
```

Paste the extension ID when prompted. This script:
- Finds your Python and `wlk` executable automatically
- Registers the native messaging host with Chrome (one registry key)
- Creates `C:\MeetingTranscripts\` if it doesn't exist

---

## Usage

1. Open Chrome and navigate to your meeting tab
2. Click the **Whisper Local Tool** extension icon in the toolbar
3. Wait for **Ready** status (~8s on first run, instant if server is already warm)
4. Click **Start Recording**
5. Click **Stop Recording** when done
6. Find your transcript in `C:\MeetingTranscripts\`

Re-run `setup.ps1` only if you reinstall the extension (Chrome assigns a new ID).

---

## Project structure

```
recorder-extension/     Chrome MV3 extension (load this in Chrome)
native_host/            Native Messaging host — manages the wlk server process
whisperlivekit/         WhisperLiveKit Python backend (speech-to-text engine)
tests/                  Python tests for the save endpoint and native host
```

---

## Running tests

```powershell
# Python tests (save endpoint + native host)
.\.venv\Scripts\python.exe -m pytest tests/ -v

# JS unit tests (recorder logic)
cd recorder-extension
npm test
```

---

## How it works

The extension uses Chrome's [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) API to launch a local WhisperLiveKit server on demand. Tab audio and microphone are merged in the browser via the Web Audio API and streamed to the local WebSocket server for transcription. Nothing leaves your machine.

Built on top of [WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit) by QuentinFuxa.

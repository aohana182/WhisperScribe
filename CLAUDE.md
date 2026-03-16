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
| `recorder-extension-en/` | Chrome extension — English (language=en) |
| `recorder-extension-ru/` | Chrome extension — Russian (language=ru) |
| `tests/` | pytest (Python) + Vitest (JS) tests |
| `requirements.txt` | `whisperlivekit` — the only Python dependency |

## Build & Test

```powershell
pip install whisperlivekit httpx pytest
python -m pytest tests/ -v

cd recorder-extension-en && npm test
```

## Do NOT

- Do not write files into `recorder-extension-en/` or `recorder-extension-ru/` without reading what's already there first.
- Do not create files in any folder without first checking who owns it and whether anything auto-generates it.
- Read before write — always.
- Do not put session logs, status updates, or progress notes here — this file is project instructions only.

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

## Do NOT

- Do not write files into `recorder-extension/` without reading what's already there first.
- Do not create files in any folder without first checking who owns it and whether anything auto-generates it.
- Read before write — always.

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

### CPU performance / Russian transcription (unresolved as of 2026-03-16)

**Symptom:** On CPU-only hardware (Lenovo T14s 2023), transcription either misses ~94% of Russian audio or has growing lag that makes the tool unusable for long sessions.

**Root cause:** WhisperLiveKit's token commitment mechanisms both fail on CPU+Russian:
- `base` model: LocalAgreement fails (inconsistent outputs). `--confidence-validation` fails (Russian token confidence < 0.95 on base).
- `small` model: Quality is good but processes at 0.5x real-time on CPU. Lag grows unboundedly. For a 30-min meeting, lag reaches ~15 min by end.

**What was tried:**
- `base` + LocalAgreement (default) → 6% commit rate on Russian
- `base` + `--confidence-validation` → no improvement
- `base` + `--no-vac` → broke language detection entirely (VAC required for segment boundaries)
- `small` + `--confidence-validation` + `--min-chunk-size 5` → good quality but 0.5x real-time, growing lag
- `medium` → immediately unusable on CPU (31s+ lag within first minute)

**Current default:** `base` + `--confidence-validation` (line 50 of `native_host/host.py`). Works for English on CPU. Russian requires a GPU.

**Next step to investigate:** OpenVINO backend for CTranslate2 on Intel Iris Xe GPU (if hardware is Intel variant). Run `wmic cpu get name` to confirm CPU first.

---

## Do NOT

- Do not write files into `recorder-extension/` without reading what's already there first.
- Do not create files in any folder without first checking who owns it and whether anything auto-generates it.
- Read before write — always.

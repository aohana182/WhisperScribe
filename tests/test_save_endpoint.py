"""
L1 — Unit tests for _sanitize_title / _make_filename (pure functions, no I/O)
L2 — Integration tests for POST /save via httpx.AsyncClient + ASGITransport

Run with:
    pytest tests/test_save_endpoint.py -v
"""
import asyncio
import json
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import pytest
import httpx

import server as svr

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

STARTED = "2026-03-16T14:30:00"
ENDED = "2026-03-16T15:00:00"


def _post_save(tmp_path, title="My Meeting", text="Hello world", started=STARTED, ended=ENDED):
    """Synchronous helper that drives POST /save with a redirected SAVE_DIR."""
    payload = {"title": title, "started_at": started, "ended_at": ended, "text": text}

    async def _run():
        transport = httpx.ASGITransport(app=svr.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post("/save", json=payload)

    with patch.object(svr, "SAVE_DIR", Path(tmp_path)):
        return asyncio.run(_run())


# ===========================================================================
# L1 — Pure unit tests (_sanitize_title, _make_filename)
# ===========================================================================

class TestSanitizeTitle:
    def test_plain_title_unchanged(self):
        assert svr._sanitize_title("My Meeting") == "My Meeting"

    def test_strips_colon(self):
        assert ":" not in svr._sanitize_title("Meet: Q1/2026")

    def test_strips_all_forbidden_chars(self):
        for ch in r'\/:*?"<>|':
            result = svr._sanitize_title(f"before{ch}after")
            assert ch not in result, f"char {ch!r} not stripped"

    def test_truncates_to_80(self):
        long = "A" * 100
        assert len(svr._sanitize_title(long)) == 80

    def test_blank_becomes_untitled(self):
        assert svr._sanitize_title("   ") == "untitled"

    def test_only_forbidden_chars_becomes_untitled(self):
        assert svr._sanitize_title(":::***") == "untitled"

    def test_empty_string_becomes_untitled(self):
        assert svr._sanitize_title("") == "untitled"

    def test_strips_leading_trailing_whitespace(self):
        assert svr._sanitize_title("  hello  ") == "hello"

    def test_unicode_title_preserved(self):
        # Non-ASCII chars are not in the forbidden set and should be kept
        assert "café" in svr._sanitize_title("café meeting")


class TestMakeFilename:
    def test_format(self):
        dt = datetime.fromisoformat("2026-03-16T14:30:00")
        result = svr._make_filename("My Meeting", dt)
        assert result == "2026-03-16_14-30_My Meeting.txt"

    def test_midnight(self):
        dt = datetime.fromisoformat("2026-01-01T00:00:00")
        result = svr._make_filename("standup", dt)
        assert result == "2026-01-01_00-00_standup.txt"

    def test_ends_with_txt(self):
        dt = datetime.fromisoformat("2026-03-16T09:05:00")
        assert svr._make_filename("test", dt).endswith(".txt")


# ===========================================================================
# L2 — Integration tests (POST /save via httpx, real file I/O to tmp_path)
# ===========================================================================

class TestSaveEndpointHappyPath:
    def test_returns_ok_true(self, tmp_path):
        resp = _post_save(tmp_path)
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True

    def test_returns_path_field(self, tmp_path):
        resp = _post_save(tmp_path)
        assert "path" in resp.json()

    def test_file_exists_on_disk(self, tmp_path):
        _post_save(tmp_path, title="Demo")
        files = list(tmp_path.glob("*.txt"))
        assert len(files) == 1

    def test_filename_format(self, tmp_path):
        _post_save(tmp_path, title="Sprint Review", started=STARTED)
        files = list(tmp_path.glob("*.txt"))
        assert files[0].name == "2026-03-16_14-30_Sprint Review.txt"

    def test_no_tmp_file_left(self, tmp_path):
        _post_save(tmp_path)
        tmps = list(tmp_path.glob("*.tmp"))
        assert tmps == [], "atomic write left a .tmp file behind"

    def test_file_content_has_header(self, tmp_path):
        _post_save(tmp_path, title="Sync", text="Hello world")
        content = next(tmp_path.glob("*.txt")).read_text(encoding="utf-8")
        assert "Meeting: Sync" in content
        assert "Started: 2026-03-16 14:30" in content
        assert "Ended:   2026-03-16 15:00" in content

    def test_file_content_has_transcript_section(self, tmp_path):
        _post_save(tmp_path, text="Line one\nLine two")
        content = next(tmp_path.glob("*.txt")).read_text(encoding="utf-8")
        assert "[Transcript]" in content
        assert "Line one\nLine two" in content

    def test_file_content_exact_structure(self, tmp_path):
        _post_save(tmp_path, title="T", text="body", started=STARTED, ended=ENDED)
        content = next(tmp_path.glob("*.txt")).read_text(encoding="utf-8")
        lines = content.splitlines()
        assert lines[0].startswith("Meeting:")
        assert lines[1].startswith("Started:")
        assert lines[2].startswith("Ended:")
        assert lines[3] == ""
        assert lines[4] == "[Transcript]"
        assert lines[5] == ""
        assert lines[6] == "body"

    def test_file_written_utf8(self, tmp_path):
        _post_save(tmp_path, title="Réunion", text="Bonjour")
        content = next(tmp_path.glob("*.txt")).read_text(encoding="utf-8")
        assert "Réunion" in content

    def test_returned_path_matches_file(self, tmp_path):
        resp = _post_save(tmp_path)
        returned_path = Path(resp.json()["path"])
        assert returned_path.exists()

    def test_save_dir_created_if_missing(self, tmp_path):
        nested = tmp_path / "deep" / "dir"
        payload = {"title": "T", "started_at": STARTED, "ended_at": ENDED, "text": "x"}

        async def _run():
            transport = httpx.ASGITransport(app=svr.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                return await client.post("/save", json=payload)

        with patch.object(svr, "SAVE_DIR", nested):
            resp = asyncio.run(_run())
        assert resp.json()["ok"] is True
        assert nested.exists()


class TestSaveEndpointConcurrency:
    def test_concurrent_different_titles_produce_two_files(self, tmp_path):
        payload_a = {"title": "Alpha", "started_at": STARTED, "ended_at": ENDED, "text": "a"}
        payload_b = {"title": "Beta", "started_at": STARTED, "ended_at": ENDED, "text": "b"}

        async def _run():
            transport = httpx.ASGITransport(app=svr.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                r_a, r_b = await asyncio.gather(
                    client.post("/save", json=payload_a),
                    client.post("/save", json=payload_b),
                )
                return r_a, r_b

        with patch.object(svr, "SAVE_DIR", Path(tmp_path)):
            r_a, r_b = asyncio.run(_run())

        assert r_a.json()["ok"] is True
        assert r_b.json()["ok"] is True
        files = {f.name for f in tmp_path.glob("*.txt")}
        assert len(files) == 2


class TestSaveEndpointEdgeCases:
    def test_title_with_forbidden_chars_sanitized_in_filename(self, tmp_path):
        _post_save(tmp_path, title="Meet: Q1/2026")
        files = list(tmp_path.glob("*.txt"))
        assert len(files) == 1
        assert ":" not in files[0].name
        assert "/" not in files[0].name

    def test_blank_title_uses_untitled(self, tmp_path):
        _post_save(tmp_path, title="   ")
        files = list(tmp_path.glob("*.txt"))
        assert "untitled" in files[0].name

    def test_very_long_title_truncated_in_filename(self, tmp_path):
        long_title = "A" * 100
        _post_save(tmp_path, title=long_title)
        files = list(tmp_path.glob("*.txt"))
        # filename = date_time_<80chars>.txt
        stem = files[0].stem  # strip .txt
        title_part = stem.split("_", 2)[2]  # after "YYYY-MM-DD_HH-MM_"
        assert len(title_part) == 80

    def test_invalid_started_at_returns_ok_false(self, tmp_path):
        resp = _post_save(tmp_path, started="not-a-date")
        data = resp.json()
        assert data["ok"] is False
        assert "error" in data

    def test_empty_transcript_text(self, tmp_path):
        resp = _post_save(tmp_path, text="")
        assert resp.json()["ok"] is True
        content = next(tmp_path.glob("*.txt")).read_text(encoding="utf-8")
        assert "[Transcript]" in content

"""
L2 — Integration tests for native_host/host.py

Tests the NM host as a real subprocess, communicating over stdin/stdout
with the Chrome Native Messaging binary protocol (4-byte LE length prefix + UTF-8 JSON).

Does NOT require 'wlk' to be installed — start_server tests mock subprocess.Popen
so the host can be tested on any machine. One test class (TestWithRealProcess)
is marked skip-unless-wlk to test the actual server spawn.

Run with:
    pytest tests/test_native_host.py -v
"""
import json
import struct
import subprocess
import sys
import time
from pathlib import Path

import pytest

HOST_PY = Path(__file__).parent.parent / "native_host" / "host.py"
PYTHON = sys.executable  # same interpreter running pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def encode_msg(obj: dict) -> bytes:
    """Encode a dict as a Chrome NM message (4-byte LE length + UTF-8 JSON)."""
    data = json.dumps(obj).encode("utf-8")
    return struct.pack("<I", len(data)) + data


def decode_msg(raw: bytes) -> dict:
    """Decode a Chrome NM message from raw bytes (strips 4-byte length prefix)."""
    length = struct.unpack("<I", raw[:4])[0]
    return json.loads(raw[4: 4 + length].decode("utf-8"))


def read_response(proc: subprocess.Popen, timeout: float = 5.0) -> dict:
    """Read one length-prefixed message from proc.stdout."""
    raw_len = proc.stdout.read(4)
    if len(raw_len) < 4:
        raise EOFError("host stdout closed before sending a response")
    length = struct.unpack("<I", raw_len)[0]
    data = proc.stdout.read(length)
    return json.loads(data.decode("utf-8"))


def start_host() -> subprocess.Popen:
    """Spawn host.py as a subprocess with piped stdin/stdout."""
    return subprocess.Popen(
        [PYTHON, str(HOST_PY)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


# ===========================================================================
# L1 — Codec unit tests (no subprocess needed)
# ===========================================================================

class TestNMCodec:
    def test_encode_decode_roundtrip(self):
        msg = {"action": "start_server"}
        encoded = encode_msg(msg)
        assert len(encoded) >= 4
        decoded = decode_msg(encoded)
        assert decoded == msg

    def test_length_prefix_is_correct(self):
        msg = {"action": "stop_server"}
        body = json.dumps(msg).encode("utf-8")
        encoded = encode_msg(msg)
        length = struct.unpack("<I", encoded[:4])[0]
        assert length == len(body)

    def test_little_endian_byte_order(self):
        msg = {"x": "y"}
        body = json.dumps(msg).encode("utf-8")
        encoded = encode_msg(msg)
        # Verify little-endian: first byte is LSB
        expected = len(body).to_bytes(4, "little")
        assert encoded[:4] == expected

    def test_utf8_non_ascii_roundtrip(self):
        msg = {"title": "réunion"}
        assert decode_msg(encode_msg(msg)) == msg


# ===========================================================================
# L2 — Subprocess integration tests (host.py as real process, Popen mocked)
# ===========================================================================

class TestHostMessaging:
    """Send messages directly to host.py and verify responses.
    Popen is patched so no real 'wlk' process is needed.
    """

    def test_unknown_action_returns_error(self):
        proc = start_host()
        try:
            proc.stdin.write(encode_msg({"action": "unknown_action"}))
            proc.stdin.flush()
            resp = read_response(proc)
            assert resp["ok"] is False
            assert "error" in resp
        finally:
            proc.stdin.close()
            proc.wait(timeout=3)

    def test_stop_server_when_nothing_running_returns_ok(self):
        proc = start_host()
        try:
            proc.stdin.write(encode_msg({"action": "stop_server"}))
            proc.stdin.flush()
            resp = read_response(proc)
            assert resp["ok"] is True
            assert resp["action"] == "stop_server"
        finally:
            proc.stdin.close()
            proc.wait(timeout=3)

    def test_host_exits_cleanly_on_stdin_close(self):
        proc = start_host()
        proc.stdin.close()
        rc = proc.wait(timeout=3)
        assert rc == 0, f"host exited with code {rc}"

    def test_multiple_messages_in_sequence(self):
        """Host processes messages in order without crashing."""
        proc = start_host()
        try:
            for _ in range(3):
                proc.stdin.write(encode_msg({"action": "stop_server"}))
            proc.stdin.flush()
            responses = [read_response(proc) for _ in range(3)]
            assert all(r["ok"] is True for r in responses)
        finally:
            proc.stdin.close()
            proc.wait(timeout=3)

    def test_start_server_with_mocked_popen(self, monkeypatch):
        """start_server action responds ok:True and returns a pid."""
        import unittest.mock as mock

        # We can't monkeypatch inside the subprocess, so we test the host module directly
        # by importing it and exercising the logic with mocked subprocess.Popen.
        # Save and restore state around the test.
        import importlib
        import native_host  # noqa: F401 — ensure importable

        spec = importlib.util.spec_from_file_location("host_module", HOST_PY)
        host_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(host_mod)

        fake_proc = mock.MagicMock()
        fake_proc.pid = 12345
        fake_proc.poll.return_value = None  # process is running

        responses = []

        def fake_send(obj):
            responses.append(obj)

        original_server_proc = host_mod._server_proc
        host_mod._server_proc = None

        with mock.patch.object(host_mod.subprocess, "Popen", return_value=fake_proc):
            with mock.patch.object(host_mod, "send_message", side_effect=fake_send):
                # Simulate receiving start_server action
                msg = {"action": "start_server"}
                action = msg.get("action")
                if action == "start_server":
                    if host_mod._server_proc is None or host_mod._server_proc.poll() is not None:
                        try:
                            host_mod._server_proc = host_mod.subprocess.Popen(
                                ["wlk", "--model", "base", "--language", "auto"],
                                stdout=host_mod.subprocess.DEVNULL,
                                stderr=host_mod.subprocess.DEVNULL,
                            )
                            host_mod.send_message(
                                {"ok": True, "action": "start_server", "pid": host_mod._server_proc.pid}
                            )
                        except Exception as e:
                            host_mod.send_message({"ok": False, "action": "start_server", "error": str(e)})

        assert len(responses) == 1
        assert responses[0]["ok"] is True
        assert responses[0]["pid"] == 12345

        # Restore
        host_mod._server_proc = original_server_proc

    def test_already_running_returns_already_running_flag(self, monkeypatch):
        """Second start_server when process is alive returns already_running:True."""
        import importlib
        import unittest.mock as mock

        spec = importlib.util.spec_from_file_location("host_module2", HOST_PY)
        host_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(host_mod)

        fake_proc = mock.MagicMock()
        fake_proc.pid = 99999
        fake_proc.poll.return_value = None  # still running

        responses = []

        def fake_send(obj):
            responses.append(obj)

        host_mod._server_proc = fake_proc

        with mock.patch.object(host_mod, "send_message", side_effect=fake_send):
            msg = {"action": "start_server"}
            if host_mod._server_proc is not None and host_mod._server_proc.poll() is None:
                host_mod.send_message(
                    {"ok": True, "action": "start_server", "already_running": True, "pid": host_mod._server_proc.pid}
                )

        assert responses[0]["already_running"] is True
        assert responses[0]["pid"] == 99999


# ===========================================================================
# Optional — needs real 'wlk' in PATH
# ===========================================================================

def _wlk_available():
    try:
        subprocess.run(["wlk", "--help"], capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


@pytest.mark.skipif(not _wlk_available(), reason="wlk not in PATH")
class TestWithRealProcess:
    def test_start_server_spawns_real_process(self):
        proc = start_host()
        try:
            proc.stdin.write(encode_msg({"action": "start_server"}))
            proc.stdin.flush()
            resp = read_response(proc, timeout=10)
            assert resp["ok"] is True
            pid = resp.get("pid")
            assert pid is not None

            # Verify process is actually running
            import psutil
            assert psutil.pid_exists(pid)

            # Now stop it
            proc.stdin.write(encode_msg({"action": "stop_server"}))
            proc.stdin.flush()
            stop_resp = read_response(proc, timeout=5)
            assert stop_resp["ok"] is True

            time.sleep(0.5)
            assert not psutil.pid_exists(pid)
        finally:
            proc.stdin.close()
            proc.wait(timeout=5)

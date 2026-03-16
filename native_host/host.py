#!/usr/bin/env python3
import os
import sys
import json
import struct
import subprocess
import socket
from pathlib import Path

# server.py lives next to native_host/ at repo root
_REPO_ROOT = Path(__file__).parent.parent
_SERVER_PY = str(_REPO_ROOT / "server.py")

_server_proc = None
_PORT = 8000


def _port_in_use(port):
    """Return True if something is already listening on the port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        return None
    msg_len = struct.unpack('<I', raw_len)[0]
    data = sys.stdin.buffer.read(msg_len)
    return json.loads(data.decode('utf-8'))

def send_message(obj):
    data = json.dumps(obj).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()

def main():
    global _server_proc
    while True:
        msg = read_message()
        if msg is None:
            break
        action = msg.get('action')
        if action == 'start_server':
            if _port_in_use(_PORT):
                send_message({'ok': True, 'action': 'start_server', 'already_running': True})
            elif _server_proc is None or _server_proc.poll() is not None:
                try:
                    _server_proc = subprocess.Popen(
                        [sys.executable, _SERVER_PY, '--model', 'medium', '--backend', 'faster-whisper'],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                    send_message({'ok': True, 'action': 'start_server', 'pid': _server_proc.pid})
                except Exception as e:
                    send_message({'ok': False, 'action': 'start_server', 'error': str(e)})
            else:
                send_message({'ok': True, 'action': 'start_server', 'already_running': True, 'pid': _server_proc.pid})
        elif action == 'stop_server':
            if _server_proc and _server_proc.poll() is None:
                _server_proc.terminate()
                try:
                    _server_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    _server_proc.kill()
                _server_proc = None
            send_message({'ok': True, 'action': 'stop_server'})
        else:
            send_message({'ok': False, 'error': f'unknown action: {action}'})

if __name__ == '__main__':
    main()

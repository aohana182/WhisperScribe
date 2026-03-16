"""Shared pytest fixtures for WhisperLiveKit tests."""
import sys
import pytest

# ---------------------------------------------------------------------------
# Ensure server.py can be imported without argparse seeing pytest's argv
# ---------------------------------------------------------------------------
def pytest_configure(config):
    """Called before test collection. Patch sys.argv so parse_args() doesn't
    pick up pytest flags (--model, etc.) as argparse positional args."""
    # Only set if not already patched by a previous plugin invocation
    if not getattr(pytest_configure, "_patched", False):
        sys._original_argv = sys.argv[:]
        sys.argv = ["server"]
        pytest_configure._patched = True

#!/usr/bin/env python3
"""
Inspector Hook - HTTP Logger Library for Claude Code (Python)
"""

import json
import os
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.request import Request, urlopen

# Port file location (matches Phase 1 spec)
PORT_FILE = "/tmp/inspector-hook.port"


def get_inspector_port() -> Optional[str]:
    """Read port from file."""
    if os.path.exists(PORT_FILE):
        with open(PORT_FILE, "r") as f:
            return f.read().strip()
    return None


def hook_log(
    level: str = "info", message: str = "", hook_name: Optional[str] = None
) -> None:
    """Send log to Inspector Hook."""
    port = get_inspector_port()
    if not port:
        return

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    hook = hook_name or os.environ.get("HOOK_NAME", "unknown")

    payload = {
        "timestamp": timestamp,
        "hook": hook,
        "level": level,
        "message": message,
    }

    try:
        request = Request(
            f"http://localhost:{port}/log",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # Non-blocking: fork a process to send
        if os.fork() == 0:
            try:
                urlopen(request, timeout=1)
            except Exception:
                pass
            os._exit(0)
    except Exception:
        pass


def send_log(
    hook_name: str,
    event_type: str,
    data: dict[str, Any],
    session_id: Optional[str] = None,
) -> bool:
    """
    Send a structured log entry to the Inspector Hook server.

    Args:
        hook_name: Name of the hook (e.g., "PreToolUse", "PostToolUse")
        event_type: Type of event (e.g., "PreToolUse", "PostToolUse")
        data: Dictionary of event data
        session_id: Optional session ID

    Returns:
        True if successful, False otherwise
    """
    port = get_inspector_port()
    if not port:
        return False

    if session_id is None:
        session_id = os.environ.get("CLAUDE_SESSION_ID", "")

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    payload = {
        "hook": hook_name,
        "event": event_type,
        "sessionId": session_id,
        "timestamp": timestamp,
        **data,
    }

    url = f"http://localhost:{port}/log"

    try:
        request = Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # Non-blocking: fork a process to send
        if os.fork() == 0:
            try:
                urlopen(request, timeout=1)
            except Exception:
                pass
            os._exit(0)
        return True
    except Exception:
        return False


def check_server() -> bool:
    """Check if the Inspector Hook server is running."""
    port = get_inspector_port()
    if not port:
        return False

    url = f"http://localhost:{port}/api/health"
    try:
        with urlopen(url, timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def read_hook_input() -> dict[str, Any]:
    """Read hook input data from stdin."""
    import sys

    try:
        input_data = sys.stdin.read()
        if input_data.strip():
            return json.loads(input_data)
    except Exception:
        pass
    return {}

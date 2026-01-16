#!/usr/bin/env python3
"""
Inspector Hook - HTTP Logger Library (Python)
Shared functions for sending logs to the Inspector Hook server
"""

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.request import Request, urlopen
from urllib.error import URLError

# Configuration from environment
INSPECTOR_HOOK_PORT = int(os.environ.get("INSPECTOR_HOOK_PORT", "52376"))
INSPECTOR_HOOK_HOST = os.environ.get("INSPECTOR_HOOK_HOST", "localhost")
INSPECTOR_HOOK_TIMEOUT = int(os.environ.get("INSPECTOR_HOOK_TIMEOUT", "5"))
INSPECTOR_HOOK_DEBUG = os.environ.get("INSPECTOR_HOOK_DEBUG", "0") == "1"
INSPECTOR_HOOK_DISABLED = os.environ.get("INSPECTOR_HOOK_DISABLED", "0") == "1"


def _debug(message: str) -> None:
    """Print debug message if debug mode is enabled."""
    if INSPECTOR_HOOK_DEBUG:
        print(f"[inspector-hook] {message}", file=sys.stderr)


def _get_timestamp() -> str:
    """Get current timestamp in ISO 8601 format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def send_log(
    hook_name: str,
    event_type: str,
    data: dict[str, Any],
    session_id: Optional[str] = None,
    blocking: bool = False,
) -> bool:
    """
    Send a log entry to the Inspector Hook server.

    Args:
        hook_name: Name of the hook (e.g., "pre-tool-use")
        event_type: Type of event (e.g., "tool.start", "tool.end")
        data: Dictionary of event data
        session_id: Optional session ID (defaults to CLAUDE_SESSION_ID env var)
        blocking: If True, wait for response; if False, fire and forget

    Returns:
        True if successful, False otherwise
    """
    if INSPECTOR_HOOK_DISABLED:
        _debug("Hook disabled, skipping")
        return True

    if session_id is None:
        session_id = os.environ.get("CLAUDE_SESSION_ID", "")

    payload = {
        "hook": hook_name,
        "event": event_type,
        "sessionId": session_id,
        "timestamp": _get_timestamp(),
        "data": data,
    }

    url = f"http://{INSPECTOR_HOOK_HOST}:{INSPECTOR_HOOK_PORT}/api/log"
    _debug(f"Sending to {url}")
    _debug(f"Payload: {json.dumps(payload)}")

    try:
        request = Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        if blocking:
            with urlopen(request, timeout=INSPECTOR_HOOK_TIMEOUT) as response:
                result = json.loads(response.read().decode("utf-8"))
                _debug(f"Response: {result}")
                return "error" not in result
        else:
            # Non-blocking: fork a process to send
            if os.fork() == 0:
                try:
                    urlopen(request, timeout=INSPECTOR_HOOK_TIMEOUT)
                except Exception:
                    pass
                os._exit(0)
            return True

    except URLError as e:
        _debug(f"Connection failed: {e}")
        return False
    except Exception as e:
        _debug(f"Error: {e}")
        return False


def send_log_sync(
    hook_name: str,
    event_type: str,
    data: dict[str, Any],
    session_id: Optional[str] = None,
) -> bool:
    """
    Send a log entry synchronously (blocking).

    Args:
        hook_name: Name of the hook
        event_type: Type of event
        data: Dictionary of event data
        session_id: Optional session ID

    Returns:
        True if successful, False otherwise
    """
    return send_log(hook_name, event_type, data, session_id, blocking=True)


def check_server() -> bool:
    """
    Check if the Inspector Hook server is running.

    Returns:
        True if server is reachable, False otherwise
    """
    url = f"http://{INSPECTOR_HOOK_HOST}:{INSPECTOR_HOOK_PORT}/api/health"
    try:
        with urlopen(url, timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def get_stats() -> Optional[dict[str, Any]]:
    """
    Get current server statistics.

    Returns:
        Stats dictionary if successful, None otherwise
    """
    url = f"http://{INSPECTOR_HOOK_HOST}:{INSPECTOR_HOOK_PORT}/api/stats"
    try:
        with urlopen(url, timeout=2) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception:
        return None


def read_hook_input() -> dict[str, Any]:
    """
    Read hook input data from stdin.

    Returns:
        Parsed JSON data from stdin, or empty dict if none
    """
    try:
        input_data = sys.stdin.read()
        if input_data.strip():
            return json.loads(input_data)
    except json.JSONDecodeError as e:
        _debug(f"Failed to parse stdin JSON: {e}")
    except Exception as e:
        _debug(f"Error reading stdin: {e}")
    return {}


# Main entry point for direct execution
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Inspector Hook HTTP Logger")
    parser.add_argument("--hook", required=True, help="Hook name")
    parser.add_argument("--event", required=True, help="Event type")
    parser.add_argument(
        "--check", action="store_true", help="Check if server is running"
    )
    parser.add_argument("--stats", action="store_true", help="Get server stats")

    args = parser.parse_args()

    if args.check:
        sys.exit(0 if check_server() else 1)

    if args.stats:
        stats = get_stats()
        if stats:
            print(json.dumps(stats, indent=2))
            sys.exit(0)
        else:
            print("Failed to get stats", file=sys.stderr)
            sys.exit(1)

    # Read data from stdin and send
    data = read_hook_input()
    success = send_log_sync(args.hook, args.event, data)
    sys.exit(0 if success else 1)

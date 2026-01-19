#!/usr/bin/env python3
"""
Session logger for SessionStart/SessionEnd hooks.
Tracks session timing and exports to JSONL.
"""

import json
import sys
import os
from datetime import datetime
from pathlib import Path

# Import hook logger
sys.path.insert(0, os.path.expanduser("~/.claude/hooks/lib"))
try:
    from http_logger import log_hook_event
except ImportError:
    log_hook_event = None

LOG_FILE = Path.home() / ".claude" / "logs" / "sessions.jsonl"
STATE_FILE = Path.home() / ".claude" / "logs" / ".session_state.json"


def ensure_dirs():
    """Create log directory if needed."""
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)


def load_state() -> dict:
    """Load session state from file."""
    try:
        if STATE_FILE.exists():
            return json.loads(STATE_FILE.read_text())
    except Exception:
        pass
    return {}


def save_state(state: dict):
    """Save session state to file."""
    try:
        STATE_FILE.write_text(json.dumps(state))
    except Exception:
        pass


def log_entry(entry: dict):
    """Append entry to log file."""
    ensure_dirs()
    try:
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(entry) + "\n")

        # Rotate if too large (> 10000 lines)
        lines = LOG_FILE.read_text().splitlines()
        if len(lines) > 10000:
            LOG_FILE.write_text("\n".join(lines[-5000:]) + "\n")
    except Exception:
        pass


def handle_start(data: dict):
    """Handle SessionStart event."""
    session_id = data.get("session_id", "unknown")
    cwd = data.get("cwd", "unknown")

    # Log to Hook Inspector
    if log_hook_event:
        log_hook_event(data, "info", f"SessionStart: {session_id[:8]}...")

    # Record start time
    state = load_state()
    state[session_id] = {"start_time": datetime.utcnow().isoformat() + "Z", "cwd": cwd}
    save_state(state)

    # Log start event
    entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "event": "session_start",
        "session_id": session_id,
        "cwd": cwd,
    }
    log_entry(entry)

    # Output context for Claude
    print(
        json.dumps(
            {
                "additionalContext": f"Session {session_id[:8]}... started at {entry['timestamp']}"
            }
        )
    )


def handle_end(data: dict):
    """Handle SessionEnd event."""
    session_id = data.get("session_id", "unknown")

    # Log to Hook Inspector
    if log_hook_event:
        log_hook_event(data, "info", f"SessionEnd: {session_id[:8]}...")

    # Calculate duration
    state = load_state()
    session_state = state.get(session_id, {})
    start_time = session_state.get("start_time")

    duration = None
    if start_time:
        try:
            start = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            end = datetime.utcnow()
            duration = (end - start.replace(tzinfo=None)).total_seconds()
        except Exception:
            pass

    # Log end event
    entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "event": "session_end",
        "session_id": session_id,
        "duration_seconds": duration,
        "cwd": session_state.get("cwd", "unknown"),
    }
    log_entry(entry)

    # Clean up state
    if session_id in state:
        del state[session_id]
        save_state(state)

    # Format duration
    if duration:
        if duration < 60:
            duration_str = f"{int(duration)}s"
        elif duration < 3600:
            duration_str = f"{int(duration // 60)}m {int(duration % 60)}s"
        else:
            duration_str = f"{int(duration // 3600)}h {int((duration % 3600) // 60)}m"
        print(f"Session ended. Duration: {duration_str}")


def main():
    # Get action from command line arg
    action = sys.argv[1] if len(sys.argv) > 1 else "start"

    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        data = {}

    if action == "start":
        handle_start(data)
    elif action == "end":
        handle_end(data)
    else:
        # Auto-detect from hook_event_name
        event = data.get("hook_event_name", "")
        if event == "SessionEnd":
            handle_end(data)
        else:
            handle_start(data)


if __name__ == "__main__":
    main()

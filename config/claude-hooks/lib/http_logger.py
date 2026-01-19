#!/usr/bin/env python3
"""
HTTP Logger Library for Claude Code Hooks

Import this module in your Python hooks to send logs to Hook Inspector.

Usage:
    from http_logger import HookLogger

    logger = HookLogger("my-hook")
    logger.info("Processing file", tool="Write", file="/path/to/file")
    logger.warn("File might have issues")
    logger.error("Something went wrong")
    logger.blocked("Action was blocked", details={"reason": "security"})
"""

import json
import socket
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.request import Request, urlopen
from urllib.error import URLError


HOOK_INSPECTOR_PORT_FILE = Path("/tmp/claude-hooks-inspector.port")


class HookLogger:
    """Logger that sends structured logs to Hook Inspector."""

    def __init__(self, hook_name: str):
        self.hook_name = hook_name
        self._port: Optional[int] = None
        self._port_checked = False

    @property
    def port(self) -> Optional[int]:
        """Get the Hook Inspector port, cached."""
        if not self._port_checked:
            self._port = self._read_port()
            self._port_checked = True
        return self._port

    def _read_port(self) -> Optional[int]:
        """Read the port from the port file."""
        try:
            if HOOK_INSPECTOR_PORT_FILE.exists():
                return int(HOOK_INSPECTOR_PORT_FILE.read_text().strip())
        except (ValueError, OSError):
            pass
        return None

    def _send_async(self, data: dict) -> None:
        """Send log data asynchronously."""
        port = self.port
        if not port:
            return

        def send():
            try:
                url = f"http://127.0.0.1:{port}/log"
                payload = json.dumps(data).encode("utf-8")
                req = Request(
                    url,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                # Short timeout to not block hooks
                with urlopen(req, timeout=0.5) as resp:
                    pass
            except (URLError, socket.timeout, OSError):
                pass

        thread = threading.Thread(target=send, daemon=True)
        thread.start()

    def log(
        self,
        level: str,
        message: str,
        event: str = "",
        tool: str = "",
        file: str = "",
        session_id: str = "",
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        """Send a log entry to Hook Inspector."""
        data = {
            "hook": self.hook_name,
            "level": level,
            "message": message,
            "event": event,
            "tool": tool,
            "file": file,
            "sessionId": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if details:
            data["details"] = details

        self._send_async(data)

    def info(self, message: str, **kwargs) -> None:
        """Log an info message."""
        self.log("info", message, **kwargs)

    def warn(self, message: str, **kwargs) -> None:
        """Log a warning message."""
        self.log("warn", message, **kwargs)

    def error(self, message: str, **kwargs) -> None:
        """Log an error message."""
        self.log("error", message, **kwargs)

    def blocked(self, message: str, **kwargs) -> None:
        """Log a blocked action."""
        self.log("blocked", message, **kwargs)

    def log_dict(self, data: dict[str, Any]) -> None:
        """Send a raw dictionary as log entry."""
        # Ensure required fields
        data.setdefault("hook", self.hook_name)
        data.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
        data.setdefault("level", "info")
        self._send_async(data)


# Convenience function for quick logging without creating instance
_default_logger: Optional[HookLogger] = None


def get_logger(hook_name: str = "") -> HookLogger:
    """Get or create a logger instance."""
    global _default_logger
    if not hook_name:
        # Try to get hook name from script name
        import sys

        hook_name = Path(sys.argv[0]).stem if sys.argv else "unknown"

    if _default_logger is None or _default_logger.hook_name != hook_name:
        _default_logger = HookLogger(hook_name)
    return _default_logger


# Quick access functions
def log_info(message: str, hook_name: str = "", **kwargs) -> None:
    get_logger(hook_name).info(message, **kwargs)


def log_warn(message: str, hook_name: str = "", **kwargs) -> None:
    get_logger(hook_name).warn(message, **kwargs)


def log_error(message: str, hook_name: str = "", **kwargs) -> None:
    get_logger(hook_name).error(message, **kwargs)


def log_blocked(message: str, hook_name: str = "", **kwargs) -> None:
    get_logger(hook_name).blocked(message, **kwargs)


def log_hook_event(hook_input: dict, level: str = "info", custom_msg: str = "") -> None:
    """
    Log a hook event directly from the parsed hook input.

    Usage:
        import json, sys
        from http_logger import log_hook_event

        data = json.load(sys.stdin)
        log_hook_event(data)  # Auto-extracts hook_event_name, session_id, tool_name, etc.
        log_hook_event(data, "blocked", "Action blocked by security")
    """
    hook_name = hook_input.get("hook_event_name", "unknown")
    session_id = hook_input.get("session_id", "unknown")
    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})
    file_path = tool_input.get("file_path", tool_input.get("path", ""))

    msg = custom_msg if custom_msg else hook_name
    if tool_name and not custom_msg:
        msg = f"{hook_name}: {tool_name}"

    logger = get_logger(hook_name)
    logger.log(
        level=level,
        message=msg,
        event=hook_name,
        tool=tool_name,
        file=file_path,
        session_id=session_id,
    )

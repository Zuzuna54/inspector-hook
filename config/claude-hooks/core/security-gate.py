#!/usr/bin/env python3
"""
Security gate for PreToolUse (Bash) hook.
Blocks dangerous commands and performs commit quality checks.
"""

import json
import sys
import os
import re
import subprocess
from datetime import datetime

# Import hook logger
sys.path.insert(0, os.path.expanduser("~/.claude/hooks/lib"))
try:
    from http_logger import HookLogger

    logger = HookLogger("security-gate")
except ImportError:
    logger = None

# Dangerous command patterns (will block)
DANGEROUS_PATTERNS = [
    (r"rm\s+-rf\s+/\s*($|[;&|])", "rm -rf / (root deletion)"),
    (r"rm\s+-rf\s+/\*", "rm -rf /* (root contents deletion)"),
    (r"rm\s+-rf\s+~\s*($|[;&|/])", "rm -rf ~ (home deletion)"),
    (r"rm\s+-rf\s+\*", "rm -rf * (wildcard deletion)"),
    (r"rm\s+-rf\s+\.\s*($|[;&|])", "rm -rf . (current dir deletion)"),
    (r"mkfs\.", "filesystem format command"),
    (r"dd\s+if=/dev/zero", "dd zero write"),
    (r"dd\s+of=/dev/sd", "dd write to disk"),
    (r"^sudo\s+rm", "sudo rm (privileged deletion)"),
    (r"curl\s+.*\|\s*sh", "curl pipe to shell"),
    (r"wget\s+.*\|\s*sh", "wget pipe to shell"),
]

LOG_FILE = os.path.expanduser("~/.claude/logs/security.jsonl")
TURBO_FILE = os.path.expanduser("~/.claude/hooks/config/.turbo-enabled")


def is_turbo_mode():
    """Check if turbo mode is enabled."""
    return os.path.exists(TURBO_FILE)


def log_event(event_type, command, reason=""):
    """Log security events."""
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        entry = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "event": event_type,
            "command": command[:200],
            "reason": reason,
        }
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except:
        pass


def run_git(args, cwd):
    """Run a git command and return stdout."""
    try:
        result = subprocess.run(
            ["git"] + args, capture_output=True, text=True, cwd=cwd, timeout=30
        )
        return result.stdout.strip()
    except:
        return ""


def check_commit_quality(cwd):
    """
    Comprehensive commit quality checks:
    1. Merge conflicts
    2. console.log/debug
    3. Hardcoded secrets
    4. Run Biome auto-fix
    Returns (decision, reason, warnings)
    """
    errors = []
    warnings = []

    # Get staged files
    staged_output = run_git(["diff", "--cached", "--name-only"], cwd)
    if not staged_output:
        return "approve", "", []

    staged_files = [f for f in staged_output.split("\n") if f]

    # Get the full diff
    full_diff = run_git(["diff", "--cached"], cwd)

    # Check 1: Merge conflicts
    if re.search(r"^[<>=]{7}", full_diff, re.MULTILINE):
        errors.append("Merge conflict markers found")

    # Check 2: console.log/debug in JS/TS files (skip test files)
    for f in staged_files:
        if f.endswith((".test.ts", ".spec.ts", ".test.js", ".spec.js")):
            continue
        if not f.endswith((".ts", ".tsx", ".js", ".jsx")):
            continue

        file_diff = run_git(["diff", "--cached", "--", f], cwd)
        if re.search(r"^\+.*console\.(log|debug)", file_diff, re.MULTILINE):
            errors.append(f"console.log/debug in {f}")

    # Check 3: Hardcoded secrets (blocking)
    secret_patterns = [
        (r'(?:api[_-]?key|apikey)\s*[:=]\s*["\'][^"\']{10,}["\']', "API key"),
        (r'(?:password|passwd|pwd)\s*[:=]\s*["\'][^"\']+["\']', "Password"),
        (r'(?:secret|token)\s*[:=]\s*["\'][^"\']{10,}["\']', "Secret/Token"),
        (r"-----BEGIN (?:RSA |DSA |EC )?PRIVATE KEY-----", "Private key"),
    ]
    for pattern, desc in secret_patterns:
        if re.search(pattern, full_diff, re.IGNORECASE):
            errors.append(f"Potential {desc} detected")

    # Check 4: TODO/FIXME (warning only, non-blocking)
    if re.search(r"^\+.*(?:TODO|FIXME|XXX|HACK):", full_diff, re.MULTILINE):
        warnings.append("New TODO/FIXME comments added")

    # Check 5: Run Biome auto-fix on staged JS/TS files (if not turbo mode)
    if not is_turbo_mode():
        js_ts_files = [
            f
            for f in staged_files
            if f.endswith((".ts", ".tsx", ".js", ".jsx")) and "node_modules" not in f
        ]

        for f in js_ts_files:
            full_path = os.path.join(cwd, f)
            if os.path.exists(full_path):
                try:
                    # Try to run biome check --write
                    subprocess.run(
                        ["biome", "check", "--write", full_path],
                        capture_output=True,
                        timeout=10,
                        cwd=cwd,
                    )
                    # Re-stage the file if it was modified
                    subprocess.run(
                        ["git", "add", f], capture_output=True, timeout=5, cwd=cwd
                    )
                except:
                    pass

    if errors:
        return "block", "Commit blocked:\n- " + "\n- ".join(errors), warnings

    return "approve", "", warnings


def main():
    try:
        # Read input
        raw = sys.stdin.read()
        if not raw.strip():
            print(json.dumps({"decision": "approve"}))
            sys.exit(0)

        data = json.loads(raw)
        command = data.get("tool_input", {}).get("command", "")
        cwd = data.get("cwd", "")
        session_id = data.get("session_id", "unknown")

        # Log all Bash PreToolUse events to Hook Inspector
        if logger:
            logger.info(
                "PreToolUse: Bash",
                event="PreToolUse",
                tool="Bash",
                session_id=session_id,
                details={"command": command[:100] if command else ""},
            )

        if not command:
            print(json.dumps({"decision": "approve"}))
            sys.exit(0)

        # Check dangerous patterns
        for pattern, desc in DANGEROUS_PATTERNS:
            if re.search(pattern, command, re.IGNORECASE):
                reason = f"Blocked dangerous command: {desc}"
                log_event("blocked", command, reason)
                if logger:
                    logger.blocked(
                        reason,
                        event="PreToolUse",
                        tool="Bash",
                        details={"command": command[:200], "pattern": desc},
                    )
                print(json.dumps({"decision": "block", "reason": reason}))
                sys.exit(2)

        # Comprehensive commit checks (detect git commit anywhere in command)
        if re.search(r"(?:^|&&|\|)\s*git\s+commit", command) and cwd:
            # Extract actual working directory if command starts with 'cd'
            actual_cwd = cwd
            cd_match = re.match(r"^cd\s+([^\s;&|]+)", command)
            if cd_match:
                cd_target = cd_match.group(1)
                # Handle relative and absolute paths
                if cd_target.startswith("/"):
                    actual_cwd = cd_target
                elif cd_target.startswith("~"):
                    actual_cwd = os.path.expanduser(cd_target)
                else:
                    actual_cwd = os.path.join(cwd, cd_target)
            log_event("commit_check", command, f"cwd={actual_cwd}")  # DEBUG
            decision, reason, warnings = check_commit_quality(actual_cwd)

            if decision == "block":
                log_event("blocked", command, reason)
                if logger:
                    logger.blocked(
                        reason,
                        event="PreToolUse",
                        tool="Bash",
                        details={"command": command[:200], "cwd": actual_cwd},
                    )
                print(json.dumps({"decision": "block", "reason": reason}))
                sys.exit(2)

            # If there are warnings, add them as context
            if warnings:
                context = "Commit warnings:\n- " + "\n- ".join(warnings)
                print(json.dumps({"decision": "approve", "additionalContext": context}))
                sys.exit(0)

        # Approve
        print(json.dumps({"decision": "approve"}))
        sys.exit(0)

    except Exception as e:
        # On ANY error, approve and exit cleanly
        log_event("error", "unknown", str(e))
        print(json.dumps({"decision": "approve"}))
        sys.exit(0)


if __name__ == "__main__":
    main()

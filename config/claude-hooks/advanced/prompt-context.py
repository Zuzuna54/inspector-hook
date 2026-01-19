#!/usr/bin/env python3
"""
UserPromptSubmit hook for injecting project context.
Simplified version - only adds context, no warnings.

Features:
- Injects: Project type, current branch, open TODO items
- No broad request warnings (user preference)
- No secret detection (user preference)
- No rate limiting (user preference)
"""

import json
import os
import subprocess
import sys
from pathlib import Path


def read_input():
    """Read JSON input from stdin."""
    try:
        return json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        return {}


def get_git_branch(cwd: str) -> str:
    """Get current git branch."""
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except Exception:
        return ""


def get_todo_items(cwd: str, max_items: int = 5) -> list:
    """Get incomplete TODO items from TODO.md."""
    todo_file = Path(cwd) / "TODO.md"
    if not todo_file.exists():
        return []

    todos = []
    try:
        with open(todo_file) as f:
            for line in f:
                # Match incomplete todo items: - [ ] or * [ ]
                line = line.strip()
                if line.startswith("- [ ]") or line.startswith("* [ ]"):
                    # Remove the checkbox prefix
                    item = line[5:].strip()
                    if item:
                        todos.append(item)
                        if len(todos) >= max_items:
                            break
    except Exception:
        pass

    return todos


def detect_project_type(cwd: str) -> str:
    """Quick project type detection."""
    cwd_path = Path(cwd) if cwd else Path.cwd()

    if (cwd_path / "tsconfig.json").exists():
        return "TypeScript"
    if (cwd_path / "package.json").exists():
        return "Node.js"
    if (cwd_path / "pyproject.toml").exists() or (cwd_path / "setup.py").exists():
        return "Python"
    if (cwd_path / "Cargo.toml").exists():
        return "Rust"
    if (cwd_path / "Makefile").exists():
        return "Make"

    return ""


def main():
    input_data = read_input()
    cwd = input_data.get("cwd", "")

    if not cwd:
        exit(0)

    context_parts = []

    # Add project type
    project_type = detect_project_type(cwd)
    if project_type:
        context_parts.append(f"Project: {project_type}")

    # Add git branch
    branch = get_git_branch(cwd)
    if branch:
        context_parts.append(f"Branch: {branch}")

    # Add TODO items
    todos = get_todo_items(cwd)
    if todos:
        todo_str = ", ".join(todos[:3])
        if len(todos) > 3:
            todo_str += f" (+{len(todos) - 3} more)"
        context_parts.append(f"TODOs: {todo_str}")

    # Output as additionalContext (only if we have something useful)
    if context_parts:
        context = " | ".join(context_parts)
        print(json.dumps({"additionalContext": f"[{context}]"}))

    exit(0)


if __name__ == "__main__":
    main()

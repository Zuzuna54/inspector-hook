#!/usr/bin/env python3
"""
SessionStart hook for auto-detecting project type.
Detects: Node.js/TypeScript, Python, Rust, C/Make projects
Outputs project info and available scripts.
Prompts for initialization if no config found.
"""

import json
import os
import sys
from pathlib import Path


def read_input():
    """Read JSON input from stdin."""
    try:
        return json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        return {}


def detect_project_type(cwd: str) -> dict:
    """Detect project type from config files."""
    cwd_path = Path(cwd) if cwd else Path.cwd()

    result = {
        "type": None,
        "config_file": None,
        "scripts": [],
        "test_command": None,
        "lint_command": None,
        "has_lockfile": False,
        "missing_deps": False,
    }

    # Check for Node.js/TypeScript (package.json)
    package_json = cwd_path / "package.json"
    if package_json.exists():
        result["type"] = "nodejs"
        result["config_file"] = "package.json"

        try:
            with open(package_json) as f:
                pkg = json.load(f)
                scripts = pkg.get("scripts", {})
                result["scripts"] = list(scripts.keys())

                # Detect test command
                if "test" in scripts:
                    result["test_command"] = "npm test"
                elif "test:unit" in scripts:
                    result["test_command"] = "npm run test:unit"

                # Detect lint command
                if "lint" in scripts:
                    result["lint_command"] = "npm run lint"
                elif "check" in scripts:
                    result["lint_command"] = "npm run check"
        except Exception:
            pass

        # Check for lockfile
        result["has_lockfile"] = any([
            (cwd_path / "package-lock.json").exists(),
            (cwd_path / "yarn.lock").exists(),
            (cwd_path / "pnpm-lock.yaml").exists(),
            (cwd_path / "bun.lockb").exists(),
        ])

        # Check if node_modules exists
        if not (cwd_path / "node_modules").exists() and result["has_lockfile"]:
            result["missing_deps"] = True

        # Check for TypeScript
        if (cwd_path / "tsconfig.json").exists():
            result["type"] = "typescript"

        return result

    # Check for Python (pyproject.toml or setup.py)
    pyproject = cwd_path / "pyproject.toml"
    setup_py = cwd_path / "setup.py"
    if pyproject.exists() or setup_py.exists():
        result["type"] = "python"
        result["config_file"] = "pyproject.toml" if pyproject.exists() else "setup.py"
        result["test_command"] = "pytest"
        result["lint_command"] = "ruff check"

        # Check for venv
        has_venv = any([
            (cwd_path / "venv").exists(),
            (cwd_path / ".venv").exists(),
        ])

        # Check requirements
        has_requirements = any([
            (cwd_path / "requirements.txt").exists(),
            (cwd_path / "requirements-dev.txt").exists(),
            pyproject.exists(),
        ])

        if has_requirements and not has_venv:
            result["missing_deps"] = True

        return result

    # Check for Rust (Cargo.toml)
    cargo_toml = cwd_path / "Cargo.toml"
    if cargo_toml.exists():
        result["type"] = "rust"
        result["config_file"] = "Cargo.toml"
        result["test_command"] = "cargo test"
        result["lint_command"] = "cargo clippy"
        result["has_lockfile"] = (cwd_path / "Cargo.lock").exists()
        return result

    # Check for C/Make (Makefile)
    makefile = cwd_path / "Makefile"
    if makefile.exists():
        result["type"] = "make"
        result["config_file"] = "Makefile"

        # Try to detect targets
        try:
            with open(makefile) as f:
                content = f.read()
                if "test:" in content:
                    result["test_command"] = "make test"
                if "lint:" in content:
                    result["lint_command"] = "make lint"
        except Exception:
            pass

        return result

    # No project detected
    return result


def main():
    input_data = read_input()
    cwd = input_data.get("cwd", "")

    if not cwd:
        # No CWD provided, can't detect
        exit(0)

    project = detect_project_type(cwd)

    # Build context message
    context_parts = []

    if project["type"]:
        context_parts.append(f"Project: {project['type'].upper()}")
        context_parts.append(f"Config: {project['config_file']}")

        if project["scripts"]:
            # Show top 5 scripts
            top_scripts = project["scripts"][:5]
            context_parts.append(f"Scripts: {', '.join(top_scripts)}")

        if project["test_command"]:
            context_parts.append(f"Test: {project['test_command']}")

        if project["lint_command"]:
            context_parts.append(f"Lint: {project['lint_command']}")

        if project["missing_deps"]:
            context_parts.append("WARNING: Dependencies may need to be installed")
            if project["type"] in ["nodejs", "typescript"]:
                context_parts.append("Run: npm install")
            elif project["type"] == "python":
                context_parts.append("Run: pip install -r requirements.txt")
    else:
        context_parts.append("No project config detected")
        context_parts.append("Consider initializing with: npm init, cargo init, or touch pyproject.toml")

    # Output as additionalContext
    if context_parts:
        context = "\\n".join(context_parts)
        print(json.dumps({"additionalContext": context}))

    exit(0)


if __name__ == "__main__":
    main()

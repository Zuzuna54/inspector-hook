#!/usr/bin/env python3
"""
Enhanced auto-approve hook for PermissionRequest.
User preference: Aggressive auto-approve for reads.
Always require approval for: installs, deletions, git push.
"""

import json
import sys
import re
from pathlib import Path

# Configuration file path
CONFIG_FILE = Path.home() / '.claude' / 'hooks' / 'config' / 'approve-rules.json'

# Aggressive auto-approve rules (user preference)
DEFAULT_RULES = {
    "auto_approve": {
        "bash_commands": [
            # Read operations - auto-approve all
            r"^ls\b",
            r"^cat\b",
            r"^head\b",
            r"^tail\b",
            r"^grep\b",
            r"^rg\b",
            r"^find\b",
            r"^wc\b",
            r"^pwd$",
            r"^echo\b",
            r"^which\b",
            r"^type\b",
            r"^file\b",
            r"^stat\b",
            r"^du\b",
            r"^df\b",
            r"^tree\b",
            r"^less\b",
            r"^more\b",

            # Git read operations - auto-approve all
            r"^git\s+(status|log|diff|branch|show|blame|remote|tag|stash\s+list|rev-parse|describe)",
            r"^git\s+ls-",
            r"^git\s+config\s+--get",
            r"^git\s+rev-list",

            # Test commands - auto-approve
            r"^npm\s+(test|run\s+test|run\s+lint|run\s+build|run\s+check)",
            r"^yarn\s+(test|lint|build)",
            r"^pnpm\s+(test|lint|build)",
            r"^bun\s+(test|run)",
            r"^pytest\b",
            r"^go\s+test",
            r"^cargo\s+(test|check|clippy|build)",
            r"^jest\b",
            r"^vitest\b",
            r"^make\s+(test|check|lint|build)$",

            # Lint/format check - auto-approve
            r"^biome\s+check",
            r"^eslint\b",
            r"^prettier\s+(--check|--write)",
            r"^tsc\s+--noEmit",
            r"^tsc\b.*--noEmit",
            r"^pylint\b",
            r"^flake8\b",
            r"^mypy\b",
            r"^ruff\s+(check|format)",
            r"^rustfmt\b",
            r"^gofmt\b",
            r"^black\b",
            r"^isort\b",

            # Build commands - auto-approve
            r"^npm\s+run\s+build",
            r"^yarn\s+build",
            r"^cargo\s+build",
            r"^go\s+build",
            r"^make($|\s)",
            r"^cmake\b",

            # Node/package info - auto-approve
            r"^npm\s+(ls|list|outdated|audit|info|view)",
            r"^yarn\s+(list|info|why)",
            r"^node\s+--version",
            r"^npm\s+--version",
            r"^python3?\s+--version",
        ],
        "read_paths": [
            # Source files
            r"\.ts$", r"\.tsx$", r"\.js$", r"\.jsx$",
            r"\.py$", r"\.pyi$",
            r"\.rs$",
            r"\.go$",
            r"\.c$", r"\.h$", r"\.cpp$", r"\.hpp$",
            r"\.java$",
            r"\.rb$",
            r"\.php$",
            r"\.swift$",
            r"\.kt$",

            # Config files
            r"\.json$", r"\.yaml$", r"\.yml$", r"\.toml$",
            r"\.xml$", r"\.ini$", r"\.conf$",
            r"\.config\.js$", r"\.config\.ts$",
            r"tsconfig.*\.json$",
            r"package\.json$",
            r"Cargo\.toml$",
            r"pyproject\.toml$",
            r"Makefile$",
            r"Dockerfile$",
            r"\.gitignore$",
            r"\.eslintrc",
            r"\.prettierrc",
            r"biome\.json$",

            # Documentation
            r"\.md$", r"\.txt$", r"\.rst$",
            r"README", r"CHANGELOG", r"LICENSE",

            # Web
            r"\.html$", r"\.css$", r"\.scss$", r"\.less$",
            r"\.svg$",

            # Data
            r"\.sql$", r"\.graphql$", r"\.gql$",
        ]
    },
    "require_approval": {
        "bash_commands": [
            # Package installations - ALWAYS ask
            r"^npm\s+install",
            r"^npm\s+i\s",
            r"^yarn\s+add",
            r"^pnpm\s+(add|install)",
            r"^pip3?\s+install",
            r"^pip3?\s+-m\s+pip\s+install",
            r"^brew\s+install",
            r"^apt(-get)?\s+install",
            r"^cargo\s+add",
            r"^cargo\s+install",
            r"^go\s+get",
            r"^go\s+install",

            # File deletions - ALWAYS ask
            r"^rm\b",
            r"^rmdir\b",
            r"^unlink\b",
            r"^trash\b",

            # Git push - ALWAYS ask
            r"^git\s+push",
            r"^git\s+push\s",

            # Network operations
            r"^curl\b",
            r"^wget\b",
            r"^nc\b",
            r"^ssh\b",
            r"^scp\b",
            r"^rsync\b",
            r"^ftp\b",

            # System modifications
            r"^sudo\b",
            r"^chmod\b",
            r"^chown\b",
            r"^chgrp\b",

            # Dangerous operations
            r"^mv\s+/",
            r"^cp\s+-r\s+/",
            r"^dd\b",
            r"^mkfs\b",
        ],
        "write_paths": [
            # Secrets and credentials
            r"\.env($|\.)",
            r"\.ssh/",
            r"\.aws/",
            r"\.gnupg/",
            r"\.netrc$",
            r"credentials",
            r"secrets",
            r"\.key$",
            r"\.pem$",
            r"\.p12$",
            r"\.keystore$",
            r"id_rsa",
            r"id_ed25519",

            # Git internals
            r"\.git/config$",
            r"\.git/hooks/",
        ]
    }
}


def load_rules() -> dict:
    """Load rules from config file or use defaults."""
    try:
        if CONFIG_FILE.exists():
            custom = json.loads(CONFIG_FILE.read_text())
            # Merge custom rules with defaults
            merged = DEFAULT_RULES.copy()
            for key in ['auto_approve', 'require_approval']:
                if key in custom:
                    for subkey in custom[key]:
                        if subkey in merged[key]:
                            merged[key][subkey] = custom[key][subkey] + merged[key][subkey]
                        else:
                            merged[key][subkey] = custom[key][subkey]
            return merged
    except Exception:
        pass
    return DEFAULT_RULES


def check_bash_command(command: str, rules: dict) -> tuple:
    """Check if a bash command should be auto-approved or requires approval."""
    command = command.strip()

    # First check require-approval patterns (higher priority)
    for pattern in rules.get('require_approval', {}).get('bash_commands', []):
        if re.search(pattern, command, re.IGNORECASE):
            return 'ask', f'Requires approval: {pattern}'

    # Then check auto-approve patterns
    for pattern in rules.get('auto_approve', {}).get('bash_commands', []):
        if re.search(pattern, command, re.IGNORECASE):
            return 'approve', 'Auto-approved: safe command'

    # Default: ask for permission
    return 'ask', ''


def check_file_path(path: str, operation: str, rules: dict) -> tuple:
    """Check if a file operation should be auto-approved."""
    path = str(path).strip()

    # Check sensitive paths first (higher priority)
    if operation in ['Write', 'Edit']:
        for pattern in rules.get('require_approval', {}).get('write_paths', []):
            if re.search(pattern, path, re.IGNORECASE):
                return 'ask', f'Sensitive path: {pattern}'

    # Read operations - check safe patterns (aggressive auto-approve)
    if operation in ['Read', 'Glob', 'Grep']:
        # Auto-approve most reads except secrets
        for pattern in rules.get('require_approval', {}).get('write_paths', []):
            if re.search(pattern, path, re.IGNORECASE):
                return 'ask', f'Sensitive file'

        # Auto-approve by extension
        for pattern in rules.get('auto_approve', {}).get('read_paths', []):
            if re.search(pattern, path, re.IGNORECASE):
                return 'approve', 'Auto-approved read'

        # Auto-approve reads in common directories
        if any(d in path for d in ['/src/', '/lib/', '/components/', '/pages/', '/app/', '/tests/']):
            return 'approve', 'Auto-approved: source directory'

    # Default: ask
    return 'ask', ''


def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        print(json.dumps({'decision': 'ask'}))
        sys.exit(0)

    rules = load_rules()

    tool_name = data.get('tool_name', '')
    tool_input = data.get('tool_input', {})

    decision = 'ask'
    reason = ''

    if tool_name == 'Bash':
        command = tool_input.get('command', '')
        decision, reason = check_bash_command(command, rules)

    elif tool_name in ['Read', 'Write', 'Edit', 'Glob', 'Grep']:
        path = tool_input.get('file_path', tool_input.get('path', tool_input.get('pattern', '')))
        decision, reason = check_file_path(path, tool_name, rules)

    # Output decision
    output = {'decision': decision}
    if reason and decision != 'approve':
        output['reason'] = reason

    print(json.dumps(output))

    # Exit code 0 for both approve and ask (let system handle)
    sys.exit(0)


if __name__ == '__main__':
    main()

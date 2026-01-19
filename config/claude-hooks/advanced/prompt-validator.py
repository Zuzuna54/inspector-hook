#!/usr/bin/env python3
"""
Prompt validator for UserPromptSubmit hook.
Validates prompts, detects issues, and injects context.
"""

import json
import sys
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path

# Patterns for overly broad requests
BROAD_PATTERNS = [
    (r'^fix\s+(everything|all|it)$', 'Overly broad request: "fix everything"'),
    (r'^make\s+it\s+work$', 'Vague request: "make it work"'),
    (r'^do\s+(it|the\s+thing)$', 'Unclear request'),
    (r'^just\s+figure\s+it\s+out$', 'Vague request'),
]

# Patterns for sensitive data
SENSITIVE_PATTERNS = [
    (r'sk-[a-zA-Z0-9]{20,}', 'OpenAI API key'),
    (r'sk-ant-[a-zA-Z0-9-]{20,}', 'Anthropic API key'),
    (r'ghp_[a-zA-Z0-9]{36}', 'GitHub personal access token'),
    (r'gho_[a-zA-Z0-9]{36}', 'GitHub OAuth token'),
    (r'github_pat_[a-zA-Z0-9_]{22,}', 'GitHub fine-grained PAT'),
    (r'xox[baprs]-[a-zA-Z0-9-]+', 'Slack token'),
    (r'AKIA[0-9A-Z]{16}', 'AWS access key'),
    (r'eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*', 'JWT token'),
    (r'-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----', 'Private key'),
    (r'password\s*[=:]\s*[\'"][^\'"]+[\'"]', 'Hardcoded password'),
]

# Rate limiting state file
RATE_FILE = Path.home() / '.claude' / 'logs' / '.prompt_rate.json'

def check_rate_limit() -> tuple[bool, str]:
    """Check if too many prompts in short time."""
    now = datetime.utcnow()
    window_minutes = 5
    max_prompts = 10

    try:
        if RATE_FILE.exists():
            state = json.loads(RATE_FILE.read_text())
        else:
            state = {'prompts': []}

        # Filter to window
        cutoff = (now - datetime.utcfromtimestamp(0)).total_seconds() - (window_minutes * 60)
        state['prompts'] = [t for t in state['prompts'] if t > cutoff]

        # Add current
        state['prompts'].append((now - datetime.utcfromtimestamp(0)).total_seconds())

        # Save
        RATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        RATE_FILE.write_text(json.dumps(state))

        if len(state['prompts']) > max_prompts:
            return False, f'High prompt rate: {len(state["prompts"])} prompts in {window_minutes} minutes'

    except Exception:
        pass

    return True, ''

def get_git_context() -> str:
    """Get current git context."""
    context = []

    try:
        # Branch
        branch = subprocess.run(
            ['git', 'branch', '--show-current'],
            capture_output=True, text=True, timeout=5
        )
        if branch.returncode == 0 and branch.stdout.strip():
            context.append(f'Branch: {branch.stdout.strip()}')

        # Recent commits
        log = subprocess.run(
            ['git', 'log', '--oneline', '-3'],
            capture_output=True, text=True, timeout=5
        )
        if log.returncode == 0 and log.stdout.strip():
            context.append(f'Recent commits:\n{log.stdout.strip()}')

    except Exception:
        pass

    return '\n'.join(context)

def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        data = {}

    prompt = data.get('prompt', '')
    warnings = []
    context_additions = []

    # Check for broad requests
    prompt_lower = prompt.lower().strip()
    for pattern, message in BROAD_PATTERNS:
        if re.match(pattern, prompt_lower, re.IGNORECASE):
            warnings.append(f'Warning: {message}. Consider being more specific.')
            break

    # Check for sensitive data
    for pattern, data_type in SENSITIVE_PATTERNS:
        if re.search(pattern, prompt):
            warnings.append(f'Warning: Prompt may contain sensitive data ({data_type}). Consider removing before sending.')
            break

    # Rate limit check
    rate_ok, rate_msg = check_rate_limit()
    if not rate_ok:
        warnings.append(f'Note: {rate_msg}. Consider taking a break.')

    # Add git context
    git_context = get_git_context()
    if git_context:
        context_additions.append(f'Current git state:\n{git_context}')

    # Build output
    output = {}

    if warnings:
        output['additionalContext'] = '\n'.join([
            '## Prompt Validation Warnings',
            *[f'- {w}' for w in warnings],
            ''
        ])

    if context_additions and not warnings:
        # Only add context if no warnings (to avoid noise)
        output['additionalContext'] = '\n'.join(context_additions)

    if output:
        print(json.dumps(output))

    # Never block prompts, just provide feedback
    sys.exit(0)

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Subagent coordinator for SubagentStop hook.
Tracks subagent metrics and supports workflow chaining.
"""

import json
import sys
import os
from datetime import datetime
from pathlib import Path

LOG_FILE = Path.home() / '.claude' / 'logs' / 'subagents.jsonl'
STATE_FILE = Path.home() / '.claude' / 'logs' / '.subagent_state.json'

def ensure_dirs():
    """Create directories if needed."""
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

def load_state() -> dict:
    """Load subagent state."""
    try:
        if STATE_FILE.exists():
            return json.loads(STATE_FILE.read_text())
    except Exception:
        pass
    return {'sessions': {}}

def save_state(state: dict):
    """Save subagent state."""
    try:
        STATE_FILE.write_text(json.dumps(state, indent=2))
    except Exception:
        pass

def log_entry(entry: dict):
    """Append entry to log file."""
    ensure_dirs()
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(json.dumps(entry) + '\n')

        # Rotate if too large
        lines = LOG_FILE.read_text().splitlines()
        if len(lines) > 5000:
            LOG_FILE.write_text('\n'.join(lines[-2500:]) + '\n')
    except Exception:
        pass

def extract_next_agent(result: str) -> str:
    """
    Extract NEXT_AGENT directive from subagent result.
    Looks for patterns like:
    - NEXT_AGENT: architect
    - @architect: please review
    """
    import re

    # Pattern 1: NEXT_AGENT: <name>
    match = re.search(r'NEXT_AGENT:\s*(\w+)', result, re.IGNORECASE)
    if match:
        return match.group(1)

    # Pattern 2: @<agent>:
    match = re.search(r'@(\w+-?\w*)\s*:', result)
    if match:
        return match.group(1)

    return ''

def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        data = {}

    session_id = data.get('session_id', 'unknown')
    subagent_type = data.get('subagent_type', 'unknown')
    result = data.get('result', '')
    start_time = data.get('start_time')
    end_time = datetime.utcnow().isoformat() + 'Z'

    # Calculate duration if start_time provided
    duration = None
    if start_time:
        try:
            start = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
            end = datetime.utcnow()
            duration = (end - start.replace(tzinfo=None)).total_seconds()
        except Exception:
            pass

    # Check for workflow chaining
    next_agent = extract_next_agent(result)

    # Log the subagent completion
    entry = {
        'timestamp': end_time,
        'session_id': session_id,
        'subagent_type': subagent_type,
        'duration_seconds': duration,
        'result_length': len(result),
        'next_agent': next_agent if next_agent else None,
        'has_errors': 'error' in result.lower() or 'failed' in result.lower()
    }
    log_entry(entry)

    # Update session state
    state = load_state()
    if session_id not in state['sessions']:
        state['sessions'][session_id] = {
            'subagents': [],
            'start_time': end_time
        }

    state['sessions'][session_id]['subagents'].append({
        'type': subagent_type,
        'completed_at': end_time,
        'duration': duration
    })
    save_state(state)

    # Build output
    output = {}

    # If there's a next agent, add context
    if next_agent:
        output['additionalContext'] = f'Subagent {subagent_type} completed. Next agent requested: {next_agent}'

    # Summary stats for this session
    session_data = state['sessions'].get(session_id, {})
    subagent_count = len(session_data.get('subagents', []))
    if subagent_count > 1:
        total_duration = sum(
            s.get('duration', 0) or 0
            for s in session_data.get('subagents', [])
        )
        if 'additionalContext' not in output:
            output['additionalContext'] = ''
        output['additionalContext'] += f'\nSession has used {subagent_count} subagents (total time: {total_duration:.1f}s)'

    if output:
        print(json.dumps(output))

    sys.exit(0)

if __name__ == '__main__':
    main()

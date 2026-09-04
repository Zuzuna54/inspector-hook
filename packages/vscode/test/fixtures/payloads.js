/**
 * GENERATED FILE -- do not edit by hand.
 *
 * Produced by packages/core/test/generate-fixtures.js from the real builders
 * and the real IPC handler shapes. Regenerate with:
 *
 *     cd packages/core && pnpm build && node test/generate-fixtures.js
 *
 * The core suite fails if this file drifts from what the builders produce, so
 * renaming a field in the backend breaks the CORE tests, not just these.
 *
 * Every Context renderer test takes its input from here. Hand-written payloads
 * are what let three bugs ship green.
 */

export const PAYLOADS = {
	"digestEnvelope": {
		"digest": {
			"body": "# inspector-hook (milestone-0-harden) — 2026-09-04\n\nRecorded automatically by Inspector Hook from session `1f7c9a2e-0000-4000-8000-abcdefabcdef`.\n\n## Facts\n\n- Project: inspector-hook\n- Working directory: `/repo`\n- Branch: milestone-0-harden\n- Started: 2026-09-04T10:00:00.000Z\n- Duration: 42 min\n- Status at digest time: completed\n- Change records: 2\n- Log entries: 3\n- Errors logged: 1\n\n## Files changed (2)\n\n- `/repo/a.ts`\n- `/repo/b.ts`\n\n## Tools used\n\n- Edit ×1\n- Bash ×1\n\n1 call did not succeed.\n\n## What was asked\n\n- make the parser handle CRLF\n\n## What was concluded\n\n- Handled CRLF in the tokenizer.\n",
			"description": "inspector-hook on milestone-0-harden: 2 files changed, 2 tool calls, 1 failed",
			"name": "session-2026-09-04-1f7c9a2e",
			"sessionId": "1f7c9a2e-0000-4000-8000-abcdefabcdef",
			"title": "inspector-hook (milestone-0-harden) — 2026-09-04",
			"type": "project",
			"worthKeeping": true
		},
		"written": false
	},
	"digestError": {
		"error": "No session nope."
	},
	"digestPayload": {
		"body": "# inspector-hook (milestone-0-harden) — 2026-09-04\n\nRecorded automatically by Inspector Hook from session `1f7c9a2e-0000-4000-8000-abcdefabcdef`.\n\n## Facts\n\n- Project: inspector-hook\n- Working directory: `/repo`\n- Branch: milestone-0-harden\n- Started: 2026-09-04T10:00:00.000Z\n- Duration: 42 min\n- Status at digest time: completed\n- Change records: 2\n- Log entries: 3\n- Errors logged: 1\n\n## Files changed (2)\n\n- `/repo/a.ts`\n- `/repo/b.ts`\n\n## Tools used\n\n- Edit ×1\n- Bash ×1\n\n1 call did not succeed.\n\n## What was asked\n\n- make the parser handle CRLF\n\n## What was concluded\n\n- Handled CRLF in the tokenizer.\n",
		"description": "inspector-hook on milestone-0-harden: 2 files changed, 2 tool calls, 1 failed",
		"name": "session-2026-09-04-1f7c9a2e",
		"sessionId": "1f7c9a2e-0000-4000-8000-abcdefabcdef",
		"title": "inspector-hook (milestone-0-harden) — 2026-09-04",
		"type": "project",
		"worthKeeping": true,
		"written": false
	},
	"emptyDigestPayload": {
		"body": "",
		"description": "Session on scratch with no recorded activity",
		"name": "session-2026-09-04-00000000",
		"sessionId": "00000000-0000-4000-8000-000000000000",
		"skipReason": "no file changes and no tool executions",
		"title": "scratch — 2026-09-04",
		"type": "project",
		"worthKeeping": false,
		"written": false
	},
	"results": {
		"deleteRefused": {
			"deleted": false,
			"reason": "notes.md was not written by us."
		},
		"deleted": {
			"deleted": true
		},
		"indexRefused": {
			"indexed": false,
			"reason": "No such file: ghost.md"
		},
		"indexed": {
			"changed": true,
			"indexed": true
		},
		"unindexNoop": {
			"changed": false
		},
		"unindexed": {
			"changed": true
		},
		"writeRefused": {
			"reason": "notes.md was not written by Inspector Hook.",
			"refused": "not-authored-by-us",
			"written": false
		},
		"written": {
			"indexUpdated": true,
			"path": "/m/session-2026-09-04.md",
			"written": true
		}
	},
	"stagedOk": {
		"expiresAt": "2026-09-04T12:00:00.000Z",
		"label": "inspector-hook (milestone-0-harden) — 2026-09-04",
		"sourceSessionId": "1f7c9a2e-0000-4000-8000-abcdefabcdef",
		"staged": true,
		"stagedAt": "2026-09-04T11:00:00.000Z",
		"text": "# inspector-hook (milestone-0-harden) — 2026-09-04\n\nRecorded automatically by Inspector Hook from session `1f7c9a2e-0000-4000-8000-abcdefabcdef`.\n\n## Facts\n\n- Project: inspector-hook\n- Working directory: `/repo`\n- Branch: milestone-0-harden\n- Started: 2026-09-04T10:00:00.000Z\n- Duration: 42 min\n- Status at digest time: completed\n- Change records: 2\n- Log entries: 3\n- Errors logged: 1\n\n## Files changed (2)\n\n- `/repo/a.ts`\n- `/repo/b.ts`\n\n## Tools used\n\n- Edit ×1\n- Bash ×1\n\n1 call did not succeed.\n\n## What was asked\n\n- make the parser handle CRLF\n\n## What was concluded\n\n- Handled CRLF in the tokenizer.\n"
	},
	"stagedRefusal": {
		"reason": "no file changes and no tool executions",
		"staged": false
	}
};

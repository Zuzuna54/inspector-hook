/**
 * Hook script tests.
 *
 * These shell scripts sit on the hot path of every tool call and are not
 * type-checked by anything, so a syntax error ships silently: the hook exits
 * non-zero, Claude Code ignores it, and capture just stops. That happened while
 * writing these fixes — an apostrophe inside a single-quoted jq program closed
 * the bash string early and the whole script stopped parsing, with no symptom
 * except an empty store.
 *
 * So: parse every script, and assert the payload contract the core depends on.
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const INSPECTOR_HOOK = join(
	REPO,
	"config/claude-hooks/logging/hook-inspector.sh",
);

/** Every shell script that ships as a hook. */
function hookScripts() {
	const dirs = [
		join(REPO, "config/claude-hooks/logging"),
		join(REPO, "packages/hooks/claude"),
		join(REPO, "packages/hooks/claude/lib"),
		join(REPO, "packages/hooks/scripts"),
	];
	const found = [];
	for (const dir of dirs) {
		let entries;
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const e of entries) {
			if (e.endsWith(".sh")) found.push(join(dir, e));
		}
	}
	return found;
}

/** Run the inspector hook against a payload, returning the POSTed JSON. */
function runHook(payload) {
	// Point the hook at a port nothing is listening on: the curl fails
	// harmlessly, but the debug log still records the exact payload it built.
	const tmp = execFileSync("mktemp", ["-d"]).toString().trim();
	const portFile = join(tmp, "port");
	const debugLog = join(tmp, "debug.log");
	execFileSync("bash", ["-c", `echo 1 > ${portFile}`]);

	execFileSync("bash", [INSPECTOR_HOOK], {
		input: JSON.stringify(payload),
		env: {
			...process.env,
			INSPECTOR_HOOK_PORT_FILE: portFile,
			INSPECTOR_HOOK_DEBUG_LOG: debugLog,
		},
	});

	const log = readFileSync(debugLog, "utf-8");
	const marker = ": Payload: ";
	const idx = log.lastIndexOf(marker);
	assert.notEqual(idx, -1, "hook should have logged a payload");
	const jsonStart = log.indexOf("{", idx);
	const jsonEnd = log.lastIndexOf("}");
	return JSON.parse(log.slice(jsonStart, jsonEnd + 1));
}

describe("hook scripts", () => {
	describe("syntax", () => {
		const scripts = hookScripts();

		it("finds the shipped hook scripts", () => {
			assert.ok(scripts.length > 0, "should discover scripts to check");
		});

		for (const script of scripts) {
			it(`${script.replace(REPO, "").replace(/^\//, "")} parses`, () => {
				// `bash -n` parses without executing.
				execFileSync("bash", ["-n", script]);
			});
		}
	});

	describe("payload contract", () => {
		it("forwards tool_use_id, which the core needs to pair executions", () => {
			const payload = runHook({
				hook_event_name: "PreToolUse",
				session_id: "s1",
				tool_name: "Bash",
				tool_use_id: "toolu_abc123",
				tool_input: { command: "ls" },
			});
			assert.equal(payload.tool_use_id, "toolu_abc123");
		});

		it("forwards prompt_id for turn grouping", () => {
			const payload = runHook({
				hook_event_name: "PreToolUse",
				session_id: "s1",
				prompt_id: "prompt-7",
				tool_name: "Read",
				tool_use_id: "t1",
			});
			assert.equal(payload.prompt_id, "prompt-7");
		});

		it("forwards the real duration rather than losing it", () => {
			const payload = runHook({
				hook_event_name: "PostToolUse",
				session_id: "s1",
				tool_name: "Bash",
				tool_use_id: "t1",
				duration_ms: 253,
			});
			assert.equal(payload.details.durationMs, 253);
		});

		it("forwards subagent identity", () => {
			const payload = runHook({
				hook_event_name: "PostToolUse",
				session_id: "s1",
				tool_name: "Grep",
				tool_use_id: "t1",
				agent_id: "agent-9",
				agent_type: "Explore",
			});
			assert.equal(payload.details.agentId, "agent-9");
			assert.equal(payload.details.agentType, "Explore");
		});

		it("forwards the assistant message from Stop", () => {
			const payload = runHook({
				hook_event_name: "Stop",
				session_id: "s1",
				last_assistant_message: "All done.",
			});
			assert.equal(payload.details.lastAssistantMessage, "All done.");
		});

		it("forwards session conditions", () => {
			const payload = runHook({
				hook_event_name: "PreToolUse",
				session_id: "s1",
				tool_name: "Bash",
				tool_use_id: "t1",
				permission_mode: "acceptEdits",
				effort: { level: "high" },
			});
			assert.equal(payload.details.permissionMode, "acceptEdits");
			assert.equal(payload.details.effort, "high");
		});
	});

	describe("level derivation", () => {
		it("defaults to info for an ordinary event", () => {
			const payload = runHook({
				hook_event_name: "PostToolUse",
				session_id: "s1",
				tool_name: "Read",
				tool_use_id: "t1",
				tool_response: "contents",
			});
			assert.equal(payload.level, "info");
		});

		it("reports error for PostToolUseFailure", () => {
			const payload = runHook({
				hook_event_name: "PostToolUseFailure",
				session_id: "s1",
				tool_name: "Read",
				tool_use_id: "t1",
				tool_error: "ENOENT: no such file",
			});
			assert.equal(payload.level, "error");
			assert.equal(payload.details.toolError, "ENOENT: no such file");
		});

		it("reports error when a tool response carries an error", () => {
			const payload = runHook({
				hook_event_name: "PostToolUse",
				session_id: "s1",
				tool_name: "Bash",
				tool_use_id: "t1",
				tool_response: { error: "exit status 1" },
			});
			assert.equal(payload.level, "error");
		});

		it("reports blocked when the error names a denial", () => {
			const payload = runHook({
				hook_event_name: "PostToolUse",
				session_id: "s1",
				tool_name: "Bash",
				tool_use_id: "t1",
				tool_response: { error: "blocked by security gate" },
			});
			assert.equal(payload.level, "blocked");
		});

		it("reports blocked for PermissionDenied", () => {
			const payload = runHook({
				hook_event_name: "PermissionDenied",
				session_id: "s1",
				tool_name: "Bash",
				tool_use_id: "t1",
			});
			assert.equal(payload.level, "blocked");
		});

		it("honours a Notification's own severity", () => {
			const payload = runHook({
				hook_event_name: "Notification",
				session_id: "s1",
				message: "disk almost full",
				level: "warning",
			});
			assert.equal(payload.level, "warn");
		});
	});

	describe("resilience", () => {
		it("exits 0 and sends nothing when no port file exists", () => {
			// Claude Code must never be blocked because the core is not running.
			const out = execFileSync("bash", [INSPECTOR_HOOK], {
				input: JSON.stringify({ hook_event_name: "PreToolUse" }),
				env: {
					...process.env,
					INSPECTOR_HOOK_PORT_FILE: "/nonexistent/port/file",
					INSPECTOR_HOOK_DEBUG_LOG: "/dev/null",
				},
			});
			assert.equal(out.toString(), "", "no output on the happy-exit path");
		});

		it("does not write a debug log unless asked", () => {
			// This file used to accumulate every prompt and tool payload forever,
			// unrotated, in world-readable /tmp.
			const source = readFileSync(INSPECTOR_HOOK, "utf-8");
			assert.match(
				source,
				/DEBUG_LOG="\$\{INSPECTOR_HOOK_DEBUG_LOG:-\/dev\/null\}"/,
				"debug logging must be opt-in",
			);
		});
	});
});

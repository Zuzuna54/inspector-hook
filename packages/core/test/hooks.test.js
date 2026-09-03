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
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// The single canonical hook. Three implementations used to exist; the two
// superseded ones are deleted, and this is the one the installer registers.
const INSPECTOR_HOOK = join(REPO, "packages/hooks/claude/inspector-hook.sh");

/** Every shell script that ships as a hook. */
function hookScripts() {
	const dirs = [
		join(REPO, "packages/hooks/claude"),
		join(REPO, "packages/hooks/scripts"),
		join(REPO, "config/claude-hooks/logging"),
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

	const log = readFileSync(debugLog, "utf-8").trim();
	assert.ok(log.length > 0, "hook should have logged a payload");
	const line = log.split("\n").pop();
	return JSON.parse(line.slice(line.indexOf("{")));
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

describe("installer", () => {
	const INSTALLER = join(REPO, "packages/hooks/scripts/install.sh");

	/** A settings file shaped like a real one, with another tool's hooks in it. */
	function fixture() {
		const tmp = execFileSync("mktemp", ["-d"]).toString().trim();
		const path = join(tmp, "settings.json");
		writeFileSync(
			path,
			JSON.stringify(
				{
					hooks: {
						PreToolUse: [
							{ matcher: "Bash", hooks: [{ type: "command", command: "/other/security-gate.py" }] },
							{ matcher: "Bash", hooks: [{ type: "command", command: "/other/precommit-wave-gate.sh" }] },
						],
						Stop: [
							{ hooks: [{ type: "command", command: "/other/stop-loop-gate.sh" }] },
						],
					},
					unrelatedSetting: 42,
				},
				null,
				2,
			),
		);
		return path;
	}

	const run = (path, ...args) =>
		execFileSync("bash", [INSTALLER, "--settings", path, ...args], {
			encoding: "utf8",
		});

	const read = (path) => JSON.parse(readFileSync(path, "utf-8"));

	/** Every command registered across every event. */
	const allCommands = (s) =>
		Object.values(s.hooks ?? {}).flatMap((groups) =>
			groups.flatMap((g) => (g.hooks ?? []).map((h) => h.command)),
		);

	it("writes the nested schema Claude Code requires", () => {
		const path = fixture();
		run(path);
		const entry = read(path).hooks.PostToolUse.find((g) =>
			(g.hooks ?? []).some((h) => h.command.includes("inspector-hook")),
		);
		assert.ok(entry, "PostToolUse should be registered");
		assert.ok(Array.isArray(entry.hooks), "must use the nested `hooks` array");
		assert.equal(entry.hooks[0].type, "command", "must declare type");
	});

	it("registers the events whose handling was previously dead code", () => {
		// PostToolUseFailure and StopFailure are handled in the core but were
		// registered by no installer, so neither could ever fire.
		const path = fixture();
		run(path);
		const s = read(path);
		for (const ev of ["PostToolUseFailure", "StopFailure", "SubagentStart"]) {
			assert.ok(
				(s.hooks[ev] ?? []).some((g) =>
					(g.hooks ?? []).some((h) => h.command.includes("inspector-hook")),
				),
				`${ev} must be registered`,
			);
		}
	});

	it("REGRESSION: preserves another tool's hooks instead of replacing them", () => {
		// The old installer did `jq '.hooks = $hooks'` -- a full replace that
		// silently deleted every co-installed tool's hooks.
		const path = fixture();
		run(path);
		const cmds = allCommands(read(path));

		for (const foreign of [
			"/other/security-gate.py",
			"/other/precommit-wave-gate.sh",
			"/other/stop-loop-gate.sh",
		]) {
			assert.ok(cmds.includes(foreign), `${foreign} must survive install`);
		}
		assert.equal(read(path).unrelatedSetting, 42, "unrelated settings survive");
	});

	it("REGRESSION: migrates off an earlier Inspector Hook script", () => {
		// The project shipped three implementations under two filenames. An
		// upgrader has an old path registered, and since the installer only
		// recognises its own exact command, a stale entry would survive and BOTH
		// scripts would fire — double-capturing every overlapping event.
		const tmp = execFileSync("mktemp", ["-d"]).toString().trim();
		const path = join(tmp, "settings.json");
		writeFileSync(
			path,
			JSON.stringify({
				hooks: {
					PostToolUse: [
						{ matcher: "", hooks: [{ type: "command", command: "/home/u/.claude/hooks/logging/hook-inspector.sh" }] },
						{ matcher: "Write", hooks: [{ type: "command", command: "/other/biome-format.sh" }] },
					],
					PreToolUse: [
						{ hooks: [{ type: "command", command: "/somewhere/else/inspector-hook.sh" }] },
					],
				},
			}),
		);

		run(path);
		const cmds = allCommands(read(path));
		const ours = cmds.filter((c) =>
			/(hook-inspector|inspector-hook)\.sh$/.test(c),
		);
		const unique = [...new Set(ours)];

		assert.equal(
			unique.length,
			1,
			`exactly one Inspector Hook script may be registered, found: ${unique.join(", ")}`,
		);
		assert.ok(
			unique[0].endsWith("packages/hooks/claude/inspector-hook.sh"),
			"and it must be the current one",
		);
		assert.ok(
			cmds.includes("/other/biome-format.sh"),
			"a foreign hook in the same event group still survives",
		);
	});

	it("is idempotent", () => {
		const path = fixture();
		run(path);
		const first = allCommands(read(path)).length;
		run(path);
		assert.equal(
			allCommands(read(path)).length,
			first,
			"a second install must not duplicate entries",
		);
	});

	it("uninstall removes only its own entries", () => {
		const path = fixture();
		run(path);
		run(path, "--uninstall");
		const cmds = allCommands(read(path));

		assert.equal(
			cmds.filter((c) => c.includes("inspector-hook")).length,
			0,
			"all of ours removed",
		);
		assert.equal(cmds.length, 3, "all three foreign hooks remain");
	});

	it("refuses to touch a settings file that is not valid JSON", () => {
		const tmp = execFileSync("mktemp", ["-d"]).toString().trim();
		const path = join(tmp, "settings.json");
		writeFileSync(path, "{ not json");
		assert.throws(() => run(path), /not valid JSON/);
		assert.equal(readFileSync(path, "utf-8"), "{ not json", "left untouched");
	});

	it("--dry-run does not write", () => {
		const path = fixture();
		const before = readFileSync(path, "utf-8");
		const out = run(path, "--dry-run");
		assert.equal(readFileSync(path, "utf-8"), before, "file unchanged");
		assert.ok(out.includes("inspector-hook"), "but prints the result");
	});
});


describe("event coverage", () => {
	/**
	 * Every event the installer registers must survive the hook and produce a
	 * well-formed payload. Two of these — PostToolUseFailure and StopFailure —
	 * were handled in the core for some time while no installer registered
	 * them, so the handling was dead in production. This locks the set.
	 */
	const REGISTERED = {
	// Named in the M2 plan and registered late. None has fired on this machine
	// yet, which is precisely why they were easy to miss.
	Elicitation: {},
	ElicitationResult: {},
	MessageDisplay: {},

		SessionStart: { start_reason: "startup", cwd: "/p" },
		SessionEnd: { reason: "exit" },
		UserPromptSubmit: { prompt: "go" },
		UserPromptExpansion: { command_name: "deploy" },
		PreToolUse: { tool_name: "Bash", tool_use_id: "x", tool_input: { command: "ls" } },
		PostToolUse: { tool_name: "Bash", tool_use_id: "x", duration_ms: 9 },
		PostToolUseFailure: { tool_name: "Read", tool_use_id: "y", tool_error: "ENOENT" },
		PostToolBatch: {},
		PermissionRequest: { tool_name: "Bash", tool_input: { command: "rm" } },
		PermissionDenied: { tool_name: "Bash", tool_use_id: "z" },
		SubagentStart: { agent_id: "a", agent_type: "Explore" },
		SubagentStop: { agent_id: "a", agent_type: "Explore" },
		TaskCreated: {},
		TaskCompleted: {},
		TeammateIdle: {},
		Stop: { last_assistant_message: "done", background_tasks: [] },
		StopFailure: { error: "rate_limit" },
		Notification: { notification_type: "permission_prompt", message: "m" },
		PreCompact: { trigger: "auto" },
		PostCompact: { trigger: "auto" },
		InstructionsLoaded: { file_path: "/p/CLAUDE.md", load_reason: "session_start" },
		ConfigChange: { source: "user_settings" },
		CwdChanged: { cwd: "/p/other" },
		DirectoryAdded: { add_reason: "slash_command" },
		FileChanged: { filename: ".env", change_type: "modified" },
		WorktreeCreate: {},
		WorktreeRemove: {},
		PreModelSwitch: { from_model: "a", to_model: "b" },
		PostModelSwitch: { from_model: "a", to_model: "b" },
		Setup: {},
	};

	it("registers exactly the events it claims to", () => {
		// The installer's EVENTS list and this table must not drift apart.
		const installer = readFileSync(
			join(REPO, "packages/hooks/scripts/install.sh"),
			"utf-8",
		);
		const block = installer.slice(
			installer.indexOf("EVENTS=("),
			installer.indexOf(")", installer.indexOf("EVENTS=(")),
		);
		// Comments are stripped BEFORE extracting names. Without this the words
		// in an explanatory comment inside the array are read as event names --
		// a comment mentioning "None has fired yet" contributed a phantom event
		// called None. The same measurement artifact as a source assertion that
		// matches its own explanation: the check was right, its aim was wrong.
		const declared = block
			.replace(/#.*$/gm, "")
			.match(/[A-Z][A-Za-z]+/g)
			.filter((w) => w !== "EVENTS");
		assert.deepEqual(
			declared.sort(),
			Object.keys(REGISTERED).sort(),
			"installer EVENTS and the test table disagree",
		);
	});

	for (const [event, extra] of Object.entries(REGISTERED)) {
		it(`${event} produces a well-formed payload`, () => {
			const p = runHook({
				hook_event_name: event,
				session_id: "cov",
				prompt_id: "turn-1",
				...extra,
			});

			assert.equal(p.hook, event, "hook name preserved");
			assert.ok(p.event, "must carry an event");
			assert.ok(p.timestamp, "must carry a timestamp");
			assert.match(p.timestamp, /\.\d{3}Z$/, "millisecond resolution");
			assert.equal(p.sessionId, "cov");
			assert.equal(p.prompt_id, "turn-1");
			assert.ok(typeof p.message === "string" && p.message.length > 0,
				"must carry a human-readable message");
			assert.ok(["info", "warn", "error", "blocked"].includes(p.level),
				`level must be valid, got ${p.level}`);
		});
	}

	it("derives error and blocked levels on the events that warrant them", () => {
		assert.equal(runHook({ hook_event_name: "PostToolUseFailure", session_id: "c", tool_error: "boom" }).level, "error");
		assert.equal(runHook({ hook_event_name: "StopFailure", session_id: "c", error: "rate_limit" }).level, "error");
		assert.equal(runHook({ hook_event_name: "PermissionDenied", session_id: "c" }).level, "blocked");
	});

	it("keeps StopFailure on a different event type from Stop", () => {
		// StopFailure reuses last_assistant_message for the error string, so
		// sharing an event type would render an API error as Claude's reply.
		const stop = runHook({ hook_event_name: "Stop", session_id: "c", last_assistant_message: "hi" });
		const fail = runHook({ hook_event_name: "StopFailure", session_id: "c", error: "overloaded" });
		assert.notEqual(stop.event, fail.event);
		assert.equal(stop.event, "ai.response");
		assert.equal(fail.event, "ai.error");
	});
});

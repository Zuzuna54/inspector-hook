/**
 * Skills view (M8).
 *
 * Loads the REAL scripts/state.js and calls ONLY `init()`, for the reason
 * `view-bootstrap.test.js` spells out: the router never calls `render()`.
 *
 * The properties these tests defend are the two the milestone exists for:
 *
 *  1. **A count never appears without where it came from.** If no transcript
 *     was read, the view says "not measured", never "never used" — the plan's
 *     own "1 of 22" came from counting the wrong source, and a zero with
 *     nothing behind it is the same mistake rendered.
 *  2. **A skill that fired without being installed is not credited to the
 *     installed set.** 4 of the 7 that fired ship with Claude Code, so
 *     conflating them turns 3-of-22 into 7-of-22.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { installGlobals, readMedia } from "./harness.js";

function element(id) {
	return {
		id,
		innerHTML: "",
		className: "",
		dataset: {},
		listeners: {},
		classList: { toggle() {} },
		setAttribute() {},
		addEventListener(t, fn) {
			(this.listeners[t] ||= []).push(fn);
		},
		click() {
			for (const fn of this.listeners.click || []) fn();
		},
	};
}

/** A DOM where an inner element exists only once render() has written it. */
function loadSkills(stateOverrides = {}) {
	const sent = [];
	const container = element("skills-view");
	container.innerHTML = `<div class="sk-dim sk-pad">Loading skills…</div>`;
	const made = new Map([["skills-view", container]]);

	installGlobals({
		API: {
			skillsOverview: (refresh) => sent.push({ overview: true, refresh }),
			skillsReadFile: (id) => sent.push({ read: id }),
			skillsSetArchived: (id, archived) => sent.push({ archive: id, archived }),
			openFile: (path) => sent.push({ open: path }),
		},
		document: {
			getElementById(id) {
				if (made.has(id)) return made.get(id);
				const html = [...made.values()].map((e) => e.innerHTML).join("");
				if (!html.includes(`id="${id}"`)) return null;
				const el = element(id);
				made.set(id, el);
				return el;
			},
			querySelector: () => null,
			querySelectorAll: () => [],
			createElement: () => element("created"),
			visibilityState: "visible",
		},
	});

	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/state.js"));
	globalThis.State = globalThis.window.State;
	globalThis.State.skillsView = {
		skills: [],
		servers: [],
		archived: [],
		summary: null,
		source: null,
		selected: null,
		file: null,
		filter: "all",
		tab: "skills",
		loading: false,
		fileLoading: false,
		busyId: null,
		error: null,
		actionError: null,
		...stateOverrides,
	};

	// Both files, in manifest order: the Tools pane is a mixin composed onto
	// the view, so loading only skills.js leaves this.toolsHtml undefined --
	// which is exactly the "not composed on" failure the split can cause.
	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/views/skills/tools-render.js"));
	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/views/skills.js"));
	const view = globalThis.window.SkillsView;
	view._unsubscribers = [];
	return { view, sent, container, made, State: globalThis.State };
}

const skill = (over = {}) => ({
	id: "writing-tests",
	source: "installed",
	path: "/Users/me/.claude/skills/writing-tests",
	skillFile: "/Users/me/.claude/skills/writing-tests/SKILL.md",
	frontmatter: { name: "writing-tests", description: "write tests" },
	frontmatterValid: true,
	bytes: 4096,
	subdirectories: [],
	extraFiles: 0,
	usage: {
		invocations: 0,
		distinctSessions: 0,
		distinctProjects: 0,
	},
	...over,
});

const summary = (over = {}) => ({
	installed: 22,
	installedUsed: 3,
	invalid: 8,
	builtinUsed: 4,
	pluginSkills: 1,
	serversConfigured: 4,
	serversObserved: 3,
	mcpInvocations: 684,
	...over,
});

describe("the Skills view", () => {
	it("asks for the overview once when it has nothing", () => {
		const { view, sent } = loadSkills();
		view.init();
		assert.deepEqual(sent, [{ overview: true, refresh: false }]);
	});

	it("does not re-ask when the list is already loaded", () => {
		const { view, sent } = loadSkills({ skills: [skill()] });
		view.init();
		assert.deepEqual(sent, []);
	});

	it("shows the used-of-installed headline", () => {
		const { view, made } = loadSkills({
			skills: [skill()],
			summary: summary(),
			source: { transcriptsScanned: 121, scanMs: 1800 },
		});
		view.init();
		const html = made.get("sk-summary").innerHTML;
		assert.match(html, /3<\/strong> of <strong>22/);
		// The built-ins are reported apart, never folded into the 3.
		assert.match(html, /4 built-in also used/);
	});

	it("names the number of transcripts the counts came from", () => {
		const { view, made } = loadSkills({
			skills: [skill()],
			summary: summary(),
			source: { transcriptsScanned: 121, scanMs: 1800 },
		});
		view.init();
		assert.match(made.get("sk-source").innerHTML, /121 transcripts/);
	});

	it("REGRESSION: reports 'not measured' when no transcript was read", () => {
		// This is the plan's own mistake as a rendering bug: a count with
		// nothing behind it must not look like a measured zero.
		const { view, made } = loadSkills({
			skills: [skill()],
			summary: summary({ installedUsed: 0 }),
			source: { transcriptsScanned: 0, scanMs: 4, error: "no transcripts" },
		});
		view.init();
		const source = made.get("sk-source").innerHTML;
		assert.match(source, /Not measured/);
		assert.match(source, /unknown, not zero/);
	});

	it("says a skill with no frontmatter can never be chosen", () => {
		const { view, made } = loadSkills({
			skills: [
				skill({
					id: "monitoring-ai",
					frontmatter: {},
					frontmatterValid: false,
				}),
			],
			summary: summary(),
			source: { transcriptsScanned: 121, scanMs: 1800 },
		});
		view.init();
		const html = made.get("sk-list").innerHTML;
		assert.match(html, /no frontmatter/);
		assert.match(html, /can never be chosen/);
	});

	it("marks a skill that fired but is not installed as built-in", () => {
		const { view, made } = loadSkills({
			skills: [
				skill({
					id: "artifact-design",
					source: "builtin",
					path: "",
					skillFile: undefined,
					frontmatter: {},
					frontmatterValid: false,
					usage: {
						invocations: 5,
						distinctSessions: 5,
						distinctProjects: 4,
						lastUsed: "2026-09-07T00:00:00.000Z",
					},
				}),
			],
			summary: summary(),
			source: { transcriptsScanned: 121, scanMs: 1800 },
		});
		view.init();
		const html = made.get("sk-list").innerHTML;
		assert.match(html, /builtin/);
		assert.match(html, /Ships with Claude Code/);
	});

	it("filters to the never-used, which is the point of the view", () => {
		const used = skill({
			id: "meta-orchestration",
			usage: { invocations: 2, distinctSessions: 2, distinctProjects: 2 },
		});
		const { view, made, State } = loadSkills({
			skills: [skill(), used],
			summary: summary(),
			source: { transcriptsScanned: 121, scanMs: 1800 },
			filter: "unused",
		});
		view.init();
		const html = made.get("sk-list").innerHTML;
		assert.match(html, /writing-tests/);
		assert.equal(html.includes("meta-orchestration"), false);
		assert.equal(State.skillsView.filter, "unused");
	});

	it("offers Archive, never a disable toggle", () => {
		// settings.json has no skills key, so a toggle would write something
		// the platform never reads -- the inert-fix failure this branch keeps
		// finding. The wording has to say what actually happens.
		const { view, made } = loadSkills({
			skills: [skill()],
			summary: summary(),
			source: { transcriptsScanned: 121, scanMs: 1800 },
			selected: "writing-tests",
		});
		view.init();
		const detail = made.get("sk-detail").innerHTML;
		assert.match(detail, /Archive/);
		assert.match(detail, /Reversible/);
		// And it says outright that it is not the switch a user might expect,
		// rather than implying one exists.
		assert.match(detail, /not a disable switch/);
	});

	it("refuses to offer Archive for a skill that is not ours", () => {
		const { view, made } = loadSkills({
			skills: [
				skill({
					id: "frontend-design",
					source: "plugin",
					plugin: "frontend-design@claude-plugins-official",
				}),
			],
			summary: summary(),
			source: { transcriptsScanned: 121, scanMs: 1800 },
			selected: "frontend-design",
		});
		view.init();
		const detail = made.get("sk-detail").innerHTML;
		assert.match(detail, /read-only/);
		assert.equal(detail.includes('id="sk-archive"'), false);
	});

	it("shows an observed MCP server that is in no config file", () => {
		// claude-in-chrome is 548 of 684 real calls and is configured nowhere.
		const { view, made, State } = loadSkills({ tab: "tools" });
		view.init();
		State.update("skillsView", {
			...State.skillsView,
			loading: false,
			summary: summary(),
			source: { transcriptsScanned: 121, scanMs: 1800 },
			servers: [
				{
					name: "claude-in-chrome",
					configured: false,
					tools: [
						{
							tool: "mcp__claude-in-chrome__javascript_tool",
							server: "claude-in-chrome",
							invocations: 293,
							distinctSessions: 4,
							distinctProjects: 3,
							lastUsed: "2026-09-08T00:00:00.000Z",
						},
					],
					usage: {
						invocations: 548,
						distinctSessions: 4,
						distinctProjects: 3,
					},
				},
				{
					name: "memory",
					configured: true,
					type: "stdio",
					command: "python",
					args: ["-m", "server"],
					tools: [],
					usage: { invocations: 0, distinctSessions: 0, distinctProjects: 0 },
				},
			],
		});
		const html = made.get("sk-list").innerHTML;
		assert.match(html, /not in config/);
		// And the reverse finding, which is the same finding as an unused skill.
		assert.match(html, /never called/);
	});

	it("never renders a server's env", () => {
		const { view, made, State } = loadSkills({ tab: "tools" });
		view.init();
		State.update("skillsView", {
			...State.skillsView,
			loading: false,
			summary: summary(),
			source: { transcriptsScanned: 121, scanMs: 1800 },
			servers: [
				{
					name: "memory",
					configured: true,
					type: "stdio",
					command: "python",
					args: ["-m", "server"],
					tools: [],
					usage: { invocations: 0, distinctSessions: 0, distinctProjects: 0 },
				},
			],
		});
		// The core drops env before it reaches here; this pins that the view
		// does not reintroduce it by rendering the raw record.
		assert.equal(made.get("sk-list").innerHTML.includes("env"), false);
	});

	it("composes the Tools mixin onto the view", () => {
		// The split's own failure mode. If the manifest loads skills.js without
		// skills/tools-render.js, every Tools method is undefined and the pane
		// throws at render time -- silently, since render() is called from a
		// subscriber.
		const { view } = loadSkills();
		for (const method of [
			"toolsHtml",
			"serverRow",
			"probeBadge",
			"probeDetailHtml",
			"serverDetailHtml",
		]) {
			assert.equal(
				typeof view[method],
				"function",
				`${method} not composed on`,
			);
		}
	});

	it("renders an unchecked server as 'not checked', never as reachable", () => {
		// Reachability spawns a process per server, so nothing probes on open.
		// Drawing an unchecked server as either reachable or broken would be a
		// claim nobody made.
		const { view, made, State } = loadSkills({ tab: "tools" });
		view.init();
		State.update("skillsView", {
			...State.skillsView,
			loading: false,
			summary: summary(),
			source: { transcriptsScanned: 121, scanMs: 1800 },
			servers: [
				{
					name: "memory",
					configured: true,
					type: "stdio",
					command: "python",
					tools: [],
					usage: { invocations: 0, distinctSessions: 0, distinctProjects: 0 },
				},
			],
		});
		const html = made.get("sk-list").innerHTML;
		assert.match(html, /not checked/);
		assert.equal(/>reachable</.test(html), false);
	});

	it("REGRESSION: a configured server that cannot start says so", () => {
		// The finding that justified building the probe. `memory` on the real
		// machine is configured, never called, and its interpreter is gone --
		// which the config file cannot tell you, and "never used" implies is
		// the user's choice.
		const { view, made, State } = loadSkills({
			tab: "tools",
			selected: "memory",
		});
		view.init();
		State.update("skillsView", {
			...State.skillsView,
			loading: false,
			summary: summary(),
			source: { transcriptsScanned: 121, scanMs: 1800 },
			servers: [
				{
					name: "memory",
					configured: true,
					type: "stdio",
					command: "/gone/.venv/bin/python",
					tools: [],
					usage: { invocations: 0, distinctSessions: 0, distinctProjects: 0 },
				},
			],
			probes: {
				memory: {
					server: "memory",
					status: "cannot-start",
					durationMs: 9,
					error:
						"the configured command does not exist: /gone/.venv/bin/python",
					checkedAt: "2026-09-09T12:00:00.000Z",
				},
			},
		});
		assert.match(made.get("sk-list").innerHTML, /cannot-start/);
		const detail = made.get("sk-detail").innerHTML;
		assert.match(detail, /cannot-start/);
		assert.match(detail, /does not exist/);
	});

	it("reports the name a server calls itself when it disagrees", () => {
		// Two of the three reachable servers here do disagree: `fetcher`
		// answers as `browser-mcp`, `mcp-ical` answers as `Calendar`.
		const { view, made, State } = loadSkills({
			tab: "tools",
			selected: "fetcher",
		});
		view.init();
		State.update("skillsView", {
			...State.skillsView,
			loading: false,
			summary: summary(),
			source: { transcriptsScanned: 121, scanMs: 1800 },
			servers: [
				{
					name: "fetcher",
					configured: true,
					type: "stdio",
					command: "npx",
					args: ["-y", "fetcher-mcp"],
					tools: [
						{
							tool: "mcp__fetcher__fetch_url",
							server: "fetcher",
							invocations: 2,
							distinctSessions: 1,
							distinctProjects: 1,
						},
					],
					usage: { invocations: 2, distinctSessions: 1, distinctProjects: 1 },
				},
			],
			probes: {
				fetcher: {
					server: "fetcher",
					status: "reachable",
					durationMs: 3375,
					serverName: "browser-mcp",
					serverVersion: "0.1.0",
					protocolVersion: "2024-11-05",
					advertisedTools: ["fetch_url", "fetch_urls", "browser_install"],
					checkedAt: "2026-09-09T12:00:00.000Z",
				},
			},
		});
		const detail = made.get("sk-detail").innerHTML;
		assert.match(detail, /browser-mcp/);
		assert.match(detail, /not the name it is configured under/);
		// Advertised and called are kept apart: 2 of the 3 were never used.
		assert.match(detail, /Advertises/);
		assert.match(detail, /2 of 3/);
		assert.match(detail, /fetch_urls/);
	});

	it("shows the failure instead of an empty list", () => {
		// The real sequence: the view opens, asks, and the request fails. A
		// failure that left the loading message up is the Agents-view bug.
		const { view, made, State } = loadSkills();
		view.init();
		State.update("skillsView", {
			...State.skillsView,
			loading: false,
			error: "the core is not running",
		});
		assert.match(made.get("sk-list").innerHTML, /the core is not running/);
	});
});

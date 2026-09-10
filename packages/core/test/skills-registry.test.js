/**
 * Skills inventory and utilization (M8).
 *
 * Every test here fixes a number that was measured on the real machine before
 * the code was written, because the plan's own headline ("22 installed, 1 has
 * ever fired") came from the wrong data source and was wrong. The corpus says
 * 3 of 22, and these fixtures reproduce the shape that makes the difference:
 * a skill that fires without being installed, a subagent transcript nested a
 * level down, and an MCP server that is used heavily and configured nowhere.
 */

import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
	archiveSkill,
	buildSkillsOverview,
	discoverPluginSkills,
	discoverSkills,
	listArchivedSkills,
	mergeServers,
	parseSkillFrontmatter,
	readConfiguredServers,
	restoreSkill,
	scanUtilization,
	skillFromToolInput,
	splitMcpTool,
} from "../dist/index.js";

const dirs = [];
after(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function temp() {
	const dir = await mkdtemp(join(tmpdir(), "ih-skills-"));
	dirs.push(dir);
	return dir;
}

/** Write one skill directory with the given SKILL.md body. */
async function skill(root, id, body, extras = {}) {
	await mkdir(join(root, id), { recursive: true });
	if (body !== null) await writeFile(join(root, id, "SKILL.md"), body, "utf-8");
	for (const [rel, content] of Object.entries(extras)) {
		const path = join(root, id, rel);
		await mkdir(join(path, ".."), { recursive: true });
		await writeFile(path, content, "utf-8");
	}
}

/** One assistant line carrying a tool_use block, as a transcript holds it. */
function toolUse(name, input, timestamp) {
	return `${JSON.stringify({
		type: "assistant",
		uuid: `u-${Math.random()}`,
		timestamp,
		message: {
			model: "claude-opus-5",
			content: [{ type: "tool_use", id: `t-${Math.random()}`, name, input }],
		},
	})}\n`;
}

describe("frontmatter", () => {
	it("reads the four fields the real skills actually use", () => {
		const { frontmatter, valid } = parseSkillFrontmatter(
			[
				"---",
				"name: graphify",
				'description: "any input to a knowledge graph: files, URLs, notes"',
				"allowed-tools: Read, Write, Bash",
				"trigger: /graphify",
				"---",
				"",
				"# graphify",
			].join("\n"),
		);
		assert.equal(valid, true);
		assert.equal(frontmatter.name, "graphify");
		// The quotes are stripped and the colon inside survives.
		assert.equal(
			frontmatter.description,
			"any input to a knowledge graph: files, URLs, notes",
		);
		assert.equal(frontmatter.allowedTools, "Read, Write, Bash");
		assert.equal(frontmatter.trigger, "/graphify");
	});

	it("rejects a block with no name, which 8 of the real 22 have", () => {
		// This is the actual defect: the file parses as YAML and is still
		// unusable, because there is no description for Claude to match.
		const { valid } = parseSkillFrontmatter(
			["---", "allowed-tools: Read", "---", "body"].join("\n"),
		);
		assert.equal(valid, false);
	});

	it("rejects a file with no frontmatter and one that never closes", () => {
		assert.equal(parseSkillFrontmatter("# Just a heading\n").valid, false);
		assert.equal(
			parseSkillFrontmatter("---\nname: x\nno terminator here").valid,
			false,
		);
	});
});

describe("discoverSkills", () => {
	it("measures the tree, not just SKILL.md", async () => {
		const root = await temp();
		await skill(root, "system-design", "---\nname: system-design\n---\nbody", {
			"references/patterns.md": "x".repeat(100),
			"assets/scaffold/index.html": "y".repeat(50),
		});

		const [record] = discoverSkills({
			skillsRoot: root,
			includePlugins: false,
		});
		assert.equal(record.id, "system-design");
		assert.equal(record.source, "installed");
		assert.equal(record.extraFiles, 2);
		assert.deepEqual(record.subdirectories.sort(), [
			"assets",
			"assets/scaffold",
			"references",
		]);
		// The whole tree, so a size shown in the UI is the real cost.
		assert.ok(record.bytes > 150, `bytes was ${record.bytes}`);
	});

	it("reports a skill with no SKILL.md rather than skipping it", async () => {
		const root = await temp();
		await skill(root, "empty-one", null);
		const [record] = discoverSkills({
			skillsRoot: root,
			includePlugins: false,
		});
		assert.equal(record.frontmatterValid, false);
		assert.equal(record.skillFile, undefined);
	});

	it("finds project-scoped skills under <root>/.claude/skills", async () => {
		const home = await temp();
		const project = await temp();
		await skill(
			join(project, ".claude", "skills"),
			"repo-only",
			"---\nname: repo-only\n---\n",
		);

		const records = discoverSkills({
			skillsRoot: home,
			projectRoots: [project],
			includePlugins: false,
		});
		assert.equal(records.length, 1);
		assert.equal(records[0].source, "project");
	});
});

describe("discoverPluginSkills", () => {
	it("takes installPath and ignores every other copy on disk", async () => {
		const dir = await temp();
		const live = join(dir, "cache", "plug", "live");
		const orphaned = join(dir, "cache", "plug", "orphaned");
		await skill(
			join(live, "skills"),
			"frontend-design",
			"---\nname: frontend-design\n---\n",
		);
		// The real cache holds 5 versions of one plugin, 3 of them orphaned.
		// Walking the cache would report this skill five times.
		await skill(
			join(orphaned, "skills"),
			"frontend-design",
			"---\nname: frontend-design\n---\n",
		);

		const settings = join(dir, "settings.json");
		await writeFile(
			settings,
			JSON.stringify({
				enabledPlugins: { "plug@market": true, "off@market": false },
			}),
			"utf-8",
		);
		const installed = join(dir, "installed_plugins.json");
		await writeFile(
			installed,
			JSON.stringify({
				plugins: {
					// Installed at two scopes, one install path — the real shape.
					"plug@market": [
						{ scope: "user", installPath: live },
						{ scope: "project", installPath: live },
					],
					"off@market": [{ scope: "user", installPath: orphaned }],
				},
			}),
			"utf-8",
		);

		const records = discoverPluginSkills({
			settingsPath: settings,
			installedPluginsPath: installed,
		});
		assert.equal(records.length, 1, "one skill, not one per scope or per copy");
		assert.equal(records[0].source, "plugin");
		assert.equal(records[0].plugin, "plug@market");
	});

	it("returns nothing when no plugin is enabled", async () => {
		const dir = await temp();
		const settings = join(dir, "settings.json");
		await writeFile(settings, JSON.stringify({ enabledPlugins: {} }), "utf-8");
		assert.deepEqual(
			discoverPluginSkills({
				settingsPath: settings,
				installedPluginsPath: join(dir, "missing.json"),
			}),
			[],
		);
	});
});

describe("parsing an invocation", () => {
	it("reads the skill name from the tool input", () => {
		assert.equal(skillFromToolInput('{"skill":"graphify"}'), "graphify");
	});

	it("does not read a skill name out of free-text args", () => {
		// 3 of the 13 real invocations carry `args`. A regex over the raw JSON
		// would find "system-design" in this sentence and count a second skill.
		const text = JSON.stringify({
			skill: "run",
			args: "Smoke test the system-design skill without starting an interview",
		});
		assert.equal(skillFromToolInput(text), "run");
	});

	it("splits a server name that contains underscores", () => {
		// mcp__claude_ai_Google_Drive__search_files is in the real corpus. A
		// greedy [^_]+ would report the server as "claude".
		assert.deepEqual(
			splitMcpTool("mcp__claude_ai_Google_Drive__search_files"),
			{
				server: "claude_ai_Google_Drive",
				tool: "search_files",
			},
		);
		assert.deepEqual(splitMcpTool("mcp__claude-in-chrome__javascript_tool"), {
			server: "claude-in-chrome",
			tool: "javascript_tool",
		});
		assert.equal(splitMcpTool("Bash"), undefined);
	});
});

describe("scanUtilization", () => {
	/** A corpus with one session, one nested subagent, and two projects. */
	async function corpus() {
		const root = await temp();
		const projectA = join(root, "-Users-me-alpha");
		const projectB = join(root, "-Users-me-beta");
		await mkdir(projectA, { recursive: true });
		await mkdir(projectB, { recursive: true });

		await writeFile(
			join(projectA, "session-1.jsonl"),
			toolUse(
				"Skill",
				{ skill: "meta-orchestration" },
				"2026-09-01T10:00:00Z",
			) +
				toolUse("Bash", { command: "ls" }, "2026-09-01T10:01:00Z") +
				toolUse(
					"mcp__playwright__browser_navigate",
					{ url: "x" },
					"2026-09-01T10:02:00Z",
				),
			"utf-8",
		);
		// Nested a level down — 83 of the real 121 transcripts live here, and a
		// flat readdir sees none of them.
		await mkdir(join(projectA, "session-1", "subagents"), { recursive: true });
		await writeFile(
			join(projectA, "session-1", "subagents", "agent-abc.jsonl"),
			toolUse(
				"mcp__claude-in-chrome__javascript_tool",
				{ code: "1" },
				"2026-09-01T10:05:00Z",
			),
			"utf-8",
		);
		await writeFile(
			join(projectB, "session-2.jsonl"),
			toolUse(
				"Skill",
				{ skill: "meta-orchestration" },
				"2026-09-02T09:00:00Z",
			) +
				toolUse("Skill", { skill: "artifact-design" }, "2026-09-02T09:30:00Z"),
			"utf-8",
		);
		return root;
	}

	it("counts subagent transcripts, which are most of the corpus", async () => {
		const root = await corpus();
		const result = await scanUtilization({ transcriptRoot: root });
		assert.equal(result.source.transcriptsScanned, 3);
		const chrome = result.mcpTools.get(
			"mcp__claude-in-chrome__javascript_tool",
		);
		assert.ok(chrome, "the subagent's MCP call was missed entirely");
		assert.equal(chrome.invocations, 1);
	});

	it("attributes a subagent's calls to its parent session", async () => {
		const root = await corpus();
		const result = await scanUtilization({ transcriptRoot: root });
		// A session that spawned an agent is one session, not two.
		assert.equal(
			result.mcpTools.get("mcp__claude-in-chrome__javascript_tool")
				.distinctSessions,
			1,
		);
	});

	it("counts distinct sessions and projects separately", async () => {
		const root = await corpus();
		const { skills } = await scanUtilization({ transcriptRoot: root });
		const meta = skills.get("meta-orchestration");
		assert.equal(meta.invocations, 2);
		assert.equal(meta.distinctSessions, 2);
		assert.equal(meta.distinctProjects, 2);
		// The max, not the first file visited.
		assert.equal(meta.lastUsed, "2026-09-02T09:00:00Z");
	});

	it("honours a project allowlist, because this crosses projects", async () => {
		const root = await corpus();
		const { skills } = await scanUtilization({
			transcriptRoot: root,
			projects: ["-Users-me-beta"],
		});
		assert.equal(skills.get("meta-orchestration").invocations, 1);
	});

	it("says so when there is nothing to count, rather than reporting zero", async () => {
		const { source } = await scanUtilization({
			transcriptRoot: join(await temp(), "nope"),
		});
		assert.equal(source.transcriptsScanned, 0);
		assert.match(source.error, /no transcripts/);
	});
});

describe("MCP servers", () => {
	it("never returns env, which holds the secrets", async () => {
		const dir = await temp();
		const config = join(dir, "claude.json");
		await writeFile(
			config,
			JSON.stringify({
				mcpServers: {
					memory: {
						type: "stdio",
						command: "python",
						args: ["-m", "server"],
						env: { API_KEY: "sk-secret" },
					},
				},
			}),
			"utf-8",
		);
		const servers = readConfiguredServers(config);
		const memory = servers.get("memory");
		assert.equal(memory.command, "python");
		assert.equal("env" in memory, false);
		assert.equal(JSON.stringify(memory).includes("sk-secret"), false);
	});

	it("lists a server that was used but never configured", () => {
		// claude-in-chrome is 548 of 684 real invocations and is in no config
		// file. A config-driven list would omit the busiest server here.
		const merged = mergeServers(
			new Map([["memory", { type: "stdio", command: "python" }]]),
			new Map([
				[
					"mcp__claude-in-chrome__navigate",
					{
						tool: "mcp__claude-in-chrome__navigate",
						server: "claude-in-chrome",
						invocations: 104,
						distinctSessions: 3,
						distinctProjects: 2,
						lastUsed: "2026-09-08T00:00:00Z",
					},
				],
			]),
		);
		const byName = new Map(merged.map((s) => [s.name, s]));
		assert.equal(byName.get("claude-in-chrome").configured, false);
		assert.equal(byName.get("claude-in-chrome").usage.invocations, 104);
		// And the reverse finding: configured, never called.
		assert.equal(byName.get("memory").configured, true);
		assert.equal(byName.get("memory").usage.invocations, 0);
	});

	it("sums a server's calls across its tools", () => {
		const merged = mergeServers(
			new Map(),
			new Map([
				[
					"mcp__p__a",
					{
						tool: "mcp__p__a",
						server: "p",
						invocations: 3,
						distinctSessions: 2,
						distinctProjects: 1,
						lastUsed: "2026-09-01T00:00:00Z",
					},
				],
				[
					"mcp__p__b",
					{
						tool: "mcp__p__b",
						server: "p",
						invocations: 4,
						distinctSessions: 1,
						distinctProjects: 1,
						lastUsed: "2026-09-05T00:00:00Z",
					},
				],
			]),
		);
		assert.equal(merged[0].usage.invocations, 7);
		// Sessions cannot be summed without double-counting; the max is the
		// honest lower bound, and it is documented as one.
		assert.equal(merged[0].usage.distinctSessions, 2);
		assert.equal(merged[0].usage.lastUsed, "2026-09-05T00:00:00Z");
		// Busiest tool first.
		assert.equal(merged[0].tools[0].tool, "mcp__p__b");
	});
});

describe("buildSkillsOverview", () => {
	async function fixture() {
		const skillsRoot = await temp();
		await skill(
			skillsRoot,
			"meta-orchestration",
			"---\nname: meta-orchestration\ndescription: orchestrate\n---\n",
		);
		await skill(
			skillsRoot,
			"writing-tests",
			"---\nname: writing-tests\ndescription: tests\n---\n",
		);
		// The real defect: parses, but has no name, so it can never be chosen.
		await skill(
			skillsRoot,
			"monitoring-ai",
			"# Monitoring AI\n\nNo frontmatter at all.\n",
		);

		const transcriptRoot = await temp();
		const project = join(transcriptRoot, "-Users-me-alpha");
		await mkdir(project, { recursive: true });
		await writeFile(
			join(project, "s1.jsonl"),
			toolUse(
				"Skill",
				{ skill: "meta-orchestration" },
				"2026-09-03T00:00:00Z",
			) +
				// Fires but is not installed — this is Claude Code's own.
				toolUse("Skill", { skill: "artifact-design" }, "2026-09-07T00:00:00Z"),
			"utf-8",
		);

		const config = join(await temp(), "claude.json");
		await writeFile(config, JSON.stringify({ mcpServers: {} }), "utf-8");
		return { skillsRoot, transcriptRoot, config };
	}

	it("reproduces the measured headline: used-of-installed, built-ins apart", async () => {
		const { skillsRoot, transcriptRoot, config } = await fixture();
		const overview = await buildSkillsOverview({
			skillsRoot,
			transcriptRoot,
			configPath: config,
			includePlugins: false,
		});

		assert.equal(overview.summary.installed, 3);
		assert.equal(overview.summary.installedUsed, 1);
		assert.equal(overview.summary.invalid, 1);
		// artifact-design fired but is not installed. Counting it against the
		// installed set is how "3 of 22" becomes a flattering "7 of 22".
		assert.equal(overview.summary.builtinUsed, 1);
		const builtin = overview.skills.find((s) => s.id === "artifact-design");
		assert.equal(builtin.source, "builtin");
		assert.equal(builtin.path, "");
		assert.equal(builtin.usage.invocations, 1);
	});

	it("puts the skills Claude cannot even see first", async () => {
		const { skillsRoot, transcriptRoot, config } = await fixture();
		const { skills } = await buildSkillsOverview({
			skillsRoot,
			transcriptRoot,
			configPath: config,
			includePlugins: false,
		});
		assert.equal(skills[0].id, "monitoring-ai");
		assert.equal(skills[0].frontmatterValid, false);
		// And the used ones come last.
		assert.ok(skills[skills.length - 1].usage.invocations > 0);
	});

	it("states where the counts came from", async () => {
		const { skillsRoot, transcriptRoot, config } = await fixture();
		const { source } = await buildSkillsOverview({
			skillsRoot,
			transcriptRoot,
			configPath: config,
			includePlugins: false,
		});
		assert.equal(source.transcriptsScanned, 1);
		assert.equal(source.error, undefined);
	});
});

describe("archive", () => {
	it("moves the tree out and back, and records both", async () => {
		const skillsRoot = await temp();
		const storeRoot = await temp();
		await skill(skillsRoot, "unused-one", "---\nname: unused-one\n---\n", {
			"references/x.md": "keep me",
		});

		const archived = await archiveSkill("unused-one", {
			storeRoot,
			skillsRoot,
		});
		assert.equal(archived.ok, true);
		assert.equal(
			discoverSkills({ skillsRoot, includePlugins: false }).length,
			0,
			"the skill is still discoverable, so archiving did nothing",
		);
		assert.equal((await listArchivedSkills({ storeRoot })).length, 1);

		const restored = await restoreSkill("unused-one", {
			storeRoot,
			skillsRoot,
		});
		assert.equal(restored.ok, true);
		const back = discoverSkills({ skillsRoot, includePlugins: false });
		assert.equal(back.length, 1);
		// The supporting tree came back too, not just SKILL.md.
		assert.equal(back[0].extraFiles, 1);
		assert.equal((await listArchivedSkills({ storeRoot })).length, 0);
	});

	it("refuses to overwrite something that took the original path", async () => {
		const skillsRoot = await temp();
		const storeRoot = await temp();
		await skill(skillsRoot, "dup", "---\nname: dup\n---\n");
		await archiveSkill("dup", { storeRoot, skillsRoot });
		// Reinstalled, or authored fresh under the same name. Either way it is
		// not ours to replace.
		await skill(
			skillsRoot,
			"dup",
			"---\nname: dup\ndescription: new one\n---\n",
		);

		const result = await restoreSkill("dup", { storeRoot, skillsRoot });
		assert.equal(result.ok, false);
		assert.match(result.error, /already exists/);
	});

	it("refuses a traversal id and an unknown skill", async () => {
		const storeRoot = await temp();
		const skillsRoot = await temp();
		const bad = await archiveSkill("../../etc", { storeRoot, skillsRoot });
		assert.equal(bad.ok, false);
		assert.match(bad.error, /not a valid skill id/);

		const missing = await archiveSkill("nope", { storeRoot, skillsRoot });
		assert.equal(missing.ok, false);
		assert.match(missing.error, /no installed skill/);
	});

	it("refuses to archive twice over an existing archive", async () => {
		const skillsRoot = await temp();
		const storeRoot = await temp();
		await skill(skillsRoot, "twice", "---\nname: twice\n---\n");
		await archiveSkill("twice", { storeRoot, skillsRoot });
		await skill(skillsRoot, "twice", "---\nname: twice\n---\nsecond\n");

		const again = await archiveSkill("twice", { storeRoot, skillsRoot });
		assert.equal(again.ok, false);
		assert.match(again.error, /already archived/);
	});
});

/**
 * Joining what is installed to what actually fired (Milestone 8).
 *
 * The join is the whole point of the milestone, and it has to work in both
 * directions:
 *
 * - **installed, never fired** — 19 of 22 here. Each still loads its
 *   description into every session's context.
 * - **fired, not installed** — 4 of the 7 skills that ran are Claude Code's
 *   own. They appear with `source: "builtin"` and are counted separately, so
 *   the headline stays 3 of 22 rather than the flattering 7 of 22.
 *
 * The same asymmetry holds for MCP: 4 servers configured, and the busiest
 * server observed (`claude-in-chrome`, 548 calls) is configured nowhere.
 */

import type {
	SkillRecord,
	SkillsOverview,
	SkillWithUsage,
} from "@inspector-hook/protocol";

import { discoverSkills } from "./skill-registry.js";
import {
	mergeServers,
	noUsage,
	readConfiguredServers,
	type ScanOptions,
	scanUtilization,
} from "./utilization.js";

export interface OverviewOptions extends ScanOptions {
	skillsRoot?: string;
	projectRoots?: string[];
	settingsPath?: string;
	installedPluginsPath?: string;
	includePlugins?: boolean;
	configPath?: string;
}

/**
 * A skill invoked by name but absent from disk.
 *
 * Built-ins are deliberately not enumerated from the filesystem — see
 * `skill-registry.ts` — so the only evidence they exist is that one fired.
 * That is enough to report it: the record carries no path, no frontmatter and
 * `frontmatterValid: false`, which is accurate rather than a stand-in.
 */
function builtinRecord(id: string): SkillRecord {
	return {
		id,
		source: "builtin",
		path: "",
		frontmatter: {},
		frontmatterValid: false,
		bytes: 0,
		subdirectories: [],
		extraFiles: 0,
	};
}

/** Rank: unused-and-invalid first, then unused, then by invocations. */
function order(a: SkillWithUsage, b: SkillWithUsage): number {
	const aDead = a.usage.invocations === 0;
	const bDead = b.usage.invocations === 0;
	if (aDead !== bDead) return aDead ? -1 : 1;
	if (aDead) {
		// Among the unused, the ones Claude cannot even see come first — those
		// are a defect, not just an unpopular skill.
		if (a.frontmatterValid !== b.frontmatterValid) {
			return a.frontmatterValid ? 1 : -1;
		}
		return a.id.localeCompare(b.id);
	}
	return b.usage.invocations - a.usage.invocations || a.id.localeCompare(b.id);
}

/** Inventory plus utilization, in one record for the view. */
export async function buildSkillsOverview(
	options: OverviewOptions = {},
): Promise<SkillsOverview> {
	const installed = discoverSkills({
		skillsRoot: options.skillsRoot,
		projectRoots: options.projectRoots,
		settingsPath: options.settingsPath,
		installedPluginsPath: options.installedPluginsPath,
		includePlugins: options.includePlugins,
	});

	const utilization = await scanUtilization({
		transcriptRoot: options.transcriptRoot,
		projects: options.projects,
	});

	const known = new Set(installed.map((s) => s.id));
	const skills: SkillWithUsage[] = installed.map((record) => ({
		...record,
		usage: utilization.skills.get(record.id) ?? noUsage(),
	}));

	// Anything that fired and is not on disk. Sorted so the merge is stable.
	for (const [id, usage] of [...utilization.skills].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		if (known.has(id)) continue;
		skills.push({ ...builtinRecord(id), usage });
	}

	skills.sort(order);

	const servers = mergeServers(
		readConfiguredServers(options.configPath),
		utilization.mcpTools,
	);

	const own = skills.filter((s) => s.source !== "builtin");
	return {
		skills,
		servers,
		source: utilization.source,
		summary: {
			installed: own.filter((s) => s.source === "installed").length,
			installedUsed: own.filter(
				(s) => s.source === "installed" && s.usage.invocations > 0,
			).length,
			invalid: own.filter((s) => !s.frontmatterValid).length,
			builtinUsed: skills.filter((s) => s.source === "builtin").length,
			pluginSkills: skills.filter((s) => s.source === "plugin").length,
			serversConfigured: servers.filter((s) => s.configured).length,
			serversObserved: servers.filter((s) => s.usage.invocations > 0).length,
			mcpInvocations: servers.reduce((sum, s) => sum + s.usage.invocations, 0),
		},
	};
}

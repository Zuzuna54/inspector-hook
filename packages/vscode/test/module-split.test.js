/**
 * Guards the sessions.js module split.
 *
 * The split moved 51 methods and 11 state fields out of a 1539-line object
 * literal into six files composed with Object.assign. A move that silently
 * drops a member would not fail to load - the method would simply be undefined
 * at the moment a user clicked something. This pins the composed surface so
 * that shows up here instead.
 *
 * The expected list is a fixture rather than a comparison against git, so it
 * keeps working outside a repo and states the contract explicitly. Adding a
 * method means adding it here, which is the point: the list is the inventory.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { SESSIONS_LOAD_ORDER, loadSessionsView, readMedia } from "./harness.js";

const EXPECTED_METHODS = [
	"buildActivityFeed",
	"cleanup",
	"confirmDeleteSession",
	"countErrors",
	"fileCount",
	"formatToolDuration",
	"generateActivityId",
	"getFilteredSessions",
	"getSelectedSession",
	"getSessionDisplayInfo",
	"getSessionDisplayName",
	"getStatusIcon",
	"getToolType",
	"gitBranchOf",
	"groupIntoTurns",
	"handleCopyClick",
	"hashString",
	"init",
	"isVisible",
	"normalizeActivity",
	"registerCopyPayload",
	"render",
	"renderActivityItem",
	"renderActivityTab",
	"renderDetail",
	"renderLogsTab",
	"renderSidebar",
	"renderSingleItem",
	"renderTabContent",
	"renderToolBubble",
	"renderToolDetails",
	"renderToolItem",
	"renderToolsTab",
	"renderTruncationNotice",
	"renderTurn",
	"safeArray",
	"safeStringify",
	"seedTurnCollapse",
	"selectSession",
	"setupActivityHandlers",
	"setupSearch",
	"startAutoRefresh",
	"stopAutoRefresh",
	"switchTab",
	"toggleExpand",
	"toggleTurn",
	"toolCount",
	"toolItemId",
	"turnStats",
	"updateActivityFeed",
	"updateRunningTools",
];

const EXPECTED_STATE_FIELDS = [
	"_collapsedTurns",
	"_copyKeySeq",
	"_copyPayloads",
	"_expandedItems",
	"_lastActivityCount",
	"_refreshInterval",
	"_renderedActivityIds",
	"_renderedTurnKeys",
	"_sessionsListRefreshInterval",
	"_turnsSeededFor",
	"_unsubscribers",
];

describe("sessions.js module split", () => {
	const V = loadSessionsView();

	it("registers the view with the router", () => {
		assert.ok(V, "Router.register('sessions', ...) must still run");
	});

	it("exposes every method the pre-split object had", () => {
		const actual = Object.keys(V).filter((k) => typeof V[k] === "function");
		const missing = EXPECTED_METHODS.filter((m) => !actual.includes(m));
		assert.deepEqual(missing, [], "methods lost by the split");
	});

	it("exposes every state field the pre-split object had", () => {
		const actual = Object.keys(V);
		const missing = EXPECTED_STATE_FIELDS.filter((f) => !actual.includes(f));
		assert.deepEqual(missing, [], "state fields lost by the split");
	});

	it("has no member that is neither expected method nor expected field", () => {
		// Catches a member added to a module without being recorded here, which
		// would otherwise let the inventory drift out of date silently.
		const known = new Set([...EXPECTED_METHODS, ...EXPECTED_STATE_FIELDS]);
		const unexpected = Object.keys(V).filter((k) => !known.has(k));
		assert.deepEqual(unexpected, [], "undocumented members - add them to the fixture");
	});

	it("loads each module before the controller that composes them", () => {
		assert.equal(
			SESSIONS_LOAD_ORDER[SESSIONS_LOAD_ORDER.length - 1],
			"scripts/views/sessions.js",
			"the composing controller must load last",
		);
	});

	it("keeps every module under the size the split was done to achieve", () => {
		for (const relPath of SESSIONS_LOAD_ORDER) {
			const lines = readMedia(relPath).split("\n").length;
			assert.ok(
				lines < 600,
				`${relPath} is ${lines} lines; the split exists to keep these small`,
			);
		}
	});

	it("composes through explicit globals rather than bare cross-script consts", () => {
		// The bare bindings would resolve across classic script tags, but going
		// through window states the dependency and works under any loader.
		const controller = readMedia("scripts/views/sessions.js");
		assert.match(controller, /Object\.assign\(/);
		assert.match(controller, /window\.SessionUtils/);
	});
});

/**
 * Which stylesheets and scripts the panel loads, and in what order.
 *
 * Split out of webview-html.ts when that file crossed the 600-line limit. It is
 * pure data, and it is the half that actually changes: every new view adds
 * entries here while the surrounding HTML stays still.
 *
 * ORDER MATTERS and is not alphabetical. A renderer mixin must load before the
 * controller that composes it onto a view, and api.js must load before the
 * inbound handlers that register on it. test/manifest.test.js pins that every
 * path exists; the ordering is enforced by the view suites, which fail with
 * "not composed on" when a pair is inverted.
 */


// Asset manifests. Order matters for scripts: a module must load before
// anything that references it at parse time.
//
// Every entry is individually optional -- a path that does not exist yet is
// a 404 the webview ignores -- so a tag can land before the file it names.
// That is deliberate: it lets the split of a large view proceed one module
// at a time without a broken intermediate state, and it is why these are
// real <link>/<script> tags rather than CSS @import. An @import with a
// wrong path fails silently and takes the whole stylesheet with it; a
// missing tag here costs only the one file.
//
// The cost of that tolerance is that a typo is free and permanent, and two
// entries did exactly that -- naming a stylesheet and a script nobody ever
// wrote. So test/manifest.test.js now requires every path to exist unless
// it is named in that file's PENDING map with a reason. The tolerance is
// intact; it just has to be claimed rather than assumed.
export const STYLES: string[][] = [
	["styles", "variables.css"],
	["styles", "layout.css"],
	["styles", "components.css"],
	["styles", "components", "controls.css"],
	["styles", "components", "data-display.css"],
	["styles", "components", "feedback.css"],
	["styles", "components", "nav.css"],
	["styles", "prism-theme.css"],
	["styles", "views", "dashboard.css"],
	["styles", "views", "logs.css"],
	["styles", "views", "sessions.css"],
	["styles", "views", "sessions", "list.css"],
	["styles", "views", "sessions", "feed.css"],
	["styles", "views", "sessions", "tool-detail.css"],
	["styles", "views", "sessions", "detail.css"],
	["styles", "views", "sessions", "transcript.css"],
	["styles", "views", "sessions", "injected.css"],
	["styles", "views", "file-changes.css"],
	["styles", "views", "file-changes", "layout.css"],
	["styles", "views", "file-changes", "sidebar.css"],
	["styles", "views", "file-changes", "diff.css"],
	["styles", "views", "file-changes", "edit.css"],
	["styles", "views", "history.css"],
	["styles", "views", "history", "layout.css"],
	["styles", "views", "history", "accordion.css"],
	["styles", "views", "history", "viewer.css"],
	["styles", "views", "history", "diff.css"],
	["styles", "views", "archived.css"],
	["styles", "views", "archived", "layout.css"],
	["styles", "views", "archived", "accordion.css"],
	["styles", "views", "archived", "preview.css"],
	["styles", "views", "context.css"],
	["styles", "views", "quality.css"],
	["styles", "views", "skills.css"],
	["styles", "views", "agents.css"],
	["styles", "views", "research.css"],
	["styles", "views", "tray.css"],
	["styles", "views", "find.css"],
];

export const SCRIPTS: string[][] = [
	["scripts", "state.js"],
	["scripts", "router.js"],
	// mergeActivity, before api.js which calls it.
	["scripts", "shared", "activity-merge.js"],
	// The index load budget, before every surface that reports against it.
	["scripts", "shared", "budget.js"],
	["scripts", "shared", "project-filter.js"],
	["scripts", "shared", "project-picker.js"],
	// Sender mixins load before api.js, which composes them onto API at
	// its own load time.
	["scripts", "api", "memory-senders.js"],
	["scripts", "api", "history-senders.js"],
	["scripts", "api", "tray-senders.js"],
	["scripts", "api", "find-senders.js"],
	["scripts", "api", "projects-senders.js"],
	["scripts", "api", "injections-senders.js"],
	["scripts", "api", "transcript-senders.js"],
	["scripts", "api.js"],
	// Inbound handlers register onto API, so they load after it. Each
	// claims its message types via API.on, which throws on a duplicate.
	["scripts", "api", "inbound-core.js"],
	["scripts", "api", "inbound-sessions.js"],
	["scripts", "api", "inbound-changes.js"],
	["scripts", "api", "inbound-history.js"],
	["scripts", "api", "inbound-context.js"],
	["scripts", "api", "research-senders.js"],
	["scripts", "api", "inbound-research.js"],
	["scripts", "api", "quality-senders.js"],
	["scripts", "api", "inbound-quality.js"],
	["scripts", "api", "skills-senders.js"],
	["scripts", "api", "inbound-skills.js"],
	["scripts", "api", "agents-senders.js"],
	["scripts", "api", "inbound-agents.js"],
	["scripts", "api", "graphify-senders.js"],
	["scripts", "api", "inbound-graphify.js"],
	["scripts", "api", "inbound-tray.js"],
	["scripts", "api", "inbound-find.js"],
	["scripts", "api", "inbound-projects.js"],
	["scripts", "api", "inbound-injections.js"],
	["scripts", "api", "inbound-transcript.js"],
	// Shared helpers, before every view that uses them.
	["scripts", "session-utils.js"],
	["scripts", "shared", "diff-render.js"],
	["scripts", "views", "dashboard.js"],
	["scripts", "views", "logs.js"],
	// Sessions modules load before sessions.js.
	["scripts", "views", "sessions", "session-list.js"],
	["scripts", "views", "sessions", "activity-items.js"],
	["scripts", "views", "sessions", "activity-feed.js"],
	["scripts", "views", "sessions", "tool-detail.js"],
	["scripts", "views", "sessions", "session-detail.js"],
	["scripts", "views", "sessions", "transcript-render.js"],
	["scripts", "views", "sessions", "injected-render.js"],
	["scripts", "views", "sessions.js"],
	// File-changes modules load before file-changes.js.
	["scripts", "views", "file-changes", "fc-session-list.js"],
	["scripts", "views", "file-changes", "fc-diff-render.js"],
	["scripts", "views", "file-changes", "fc-diff-view.js"],
	["scripts", "views", "file-changes", "fc-editor.js"],
	["scripts", "views", "file-changes", "fc-actions.js"],
	["scripts", "views", "file-changes.js"],
	// History modules load before history.js.
	["scripts", "views", "history", "file-list.js"],
	["scripts", "views", "history", "version-list.js"],
	["scripts", "views", "history", "diff-render.js"],
	["scripts", "views", "history", "diff-viewer.js"],
	["scripts", "views", "history", "virtual-scroll.js"],
	["scripts", "views", "history", "restore.js"],
	["scripts", "views", "history.js"],
	["scripts", "views", "archived", "archived-render.js"],
	["scripts", "views", "archived.js"],
	// Context modules load before context.js.
	["scripts", "views", "context", "memory-render.js"],
	["scripts", "views", "context", "injection-render.js"],
	["scripts", "views", "context", "handlers.js"],
	["scripts", "views", "context", "curation.js"],
	["scripts", "views", "context.js"],
	["scripts", "views", "agents.js"],
	["scripts", "views", "quality.js"],
	// The Tools pane mixin must load before the view that composes it.
	["scripts", "views", "skills", "tools-render.js"],
	["scripts", "views", "skills", "markdown-render.js"],
	["scripts", "views", "skills.js"],
	["scripts", "views", "research", "graph-render.js"],
	["scripts", "views", "research.js"],
	// The tray: renderers before the controller that composes them.
	["scripts", "views", "find", "find-render.js"],
	["scripts", "views", "find.js"],
	["scripts", "tray", "tray-render.js"],
	["scripts", "tray", "tray-preview.js"],
	["scripts", "tray", "tray-bundles.js"],
	["scripts", "tray", "tray-host.js"],
	// main.js wires everything up and must be last.
	["scripts", "header.js"],
	["scripts", "main.js"],
];

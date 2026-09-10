/**
 * Quality view (M7) — code quality across every observed project.
 *
 * Not this repository: the projects Inspector Hook watches. 31 discovered, 17
 * still on disk, 3 that knip can reach.
 *
 * ## The one thing this view will not do
 *
 * **It will never show a count without saying what measured it.** Raw knip on
 * this repo flags 66 files of which 64 are false positives, and `sonar` is not
 * installed here at all — so "0 secrets" is not a fact about the project, it is
 * the absence of a tool. Every project row and every report shows the tools
 * that produced its numbers and the tools that did not run. A clean-looking
 * project that nothing measured is the failure this whole milestone is built to
 * avoid.
 *
 * ## Why scanning is a button, not a page load
 *
 * knip took 7.2s and madge 5.1s on this repository. A view that scanned on open
 * would show nothing for twelve seconds and look broken.
 */

const QualityView = {
	_unsubscribers: [],

	init() {
		// Build the shell FIRST -- the router calls init() and never render(),
		// so a view that only subscribes here keeps its static fallback forever.
		this.render();

		this._unsubscribers.push(
			State.subscribe("qualityView", (next, prev) => {
				const p = prev || {};
				if (
					next.projects !== p.projects ||
					next.loading !== p.loading ||
					next.error !== p.error ||
					next.selected !== p.selected
				) {
					this.renderProjects();
				}
				if (
					next.report !== p.report ||
					next.scanning !== p.scanning ||
					next.trend !== p.trend ||
					next.selected !== p.selected
				) {
					this.renderReport();
				}
			}),
		);

		if (
			!State.qualityView.projects ||
			State.qualityView.projects.length === 0
		) {
			State.update("qualityView", { ...State.qualityView, loading: true });
			API.qualityProjects();
		}
	},

	cleanup() {
		for (const unsub of this._unsubscribers) unsub();
		this._unsubscribers = [];
	},

	render() {
		const container = document.getElementById("quality-view");
		if (!container) return;
		container.innerHTML = `
			<div class="ql-layout">
				<div class="ql-sidebar">
					<div class="ql-sidebar-head">
						<span>Projects</span>
						<button id="ql-refresh" class="ql-link">refresh</button>
					</div>
					<div id="ql-projects" class="ql-projects"></div>
				</div>
				<div id="ql-report" class="ql-report"></div>
			</div>
		`;
		const refresh = document.getElementById("ql-refresh");
		if (refresh) {
			refresh.addEventListener("click", () => {
				State.update("qualityView", { ...State.qualityView, loading: true });
				API.qualityProjects();
			});
		}
		this.renderProjects();
		this.renderReport();
	},

	renderProjects() {
		const host = document.getElementById("ql-projects");
		if (!host) return;
		const v = State.qualityView || {};

		if (v.loading) {
			host.innerHTML = `<div class="ql-dim">Discovering projects…</div>`;
			return;
		}
		if (v.error) {
			host.innerHTML = `<div class="ql-error">${Utils.escapeHtml(v.error)}</div>`;
			return;
		}
		const projects = v.projects || [];
		if (projects.length === 0) {
			host.innerHTML = `<div class="ql-dim">No projects discovered yet.</div>`;
			return;
		}

		const existing = projects.filter((p) => p.exists);
		const missing = projects.filter((p) => !p.exists);

		host.innerHTML = `
			<div class="ql-counts">${existing.length} on disk · ${v.scannedCount || 0} scanned${
				missing.length
					? ` · <span class="ql-dim">${missing.length} moved away</span>`
					: ""
			}</div>
			${existing.map((p) => this.renderProjectRow(p, v)).join("")}
			${
				missing.length
					? `<div class="ql-section-label">No longer on disk</div>${missing
							.map((p) => this.renderProjectRow(p, v))
							.join("")}`
					: ""
			}`;
		this._bindProjects();
	},

	renderProjectRow(p, v) {
		const selected = v.selected === p.root;
		// A count is only shown with what measured it. See the header comment.
		const scanned = Boolean(p.lastScannedAt);
		// "clean" requires that something actually measured it. A scan where
		// every tool was unavailable produces high:0 and an empty `measured`,
		// and calling that clean is precisely the claim this view exists to
		// refuse -- it would also contradict the "nothing measured" note below.
		const measuredAnything = scanned && (p.measured || []).length > 0;
		const badge = !p.exists
			? `<span class="ql-dim">gone</span>`
			: !scanned
				? `<span class="ql-dim" title="This project has never been scanned">never scanned</span>`
				: !measuredAnything
					? `<span class="ql-warn" title="The scan ran but no tool produced a result">unmeasured</span>`
					: p.high > 0
						? `<span class="ql-high">${p.high} high</span>`
						: `<span class="ql-ok">clean</span>`;
		const measured = measuredAnything
			? `<span class="ql-dim" title="Tools that produced these numbers">${Utils.escapeHtml(p.measured.join(", "))}</span>`
			: scanned
				? `<span class="ql-dim" title="No tool produced a result">nothing measured</span>`
				: "";

		return `
			<div class="ql-project${selected ? " selected" : ""}${p.exists ? "" : " gone"}" data-root="${Utils.escapeHtml(p.root)}">
				<div class="ql-project-name">${Utils.escapeHtml(p.name)}</div>
				<div class="ql-project-meta">${badge} ${measured}</div>
			</div>`;
	},

	_bindProjects() {
		for (const el of document.querySelectorAll(".ql-project")) {
			el.addEventListener("click", () => {
				const root = el.dataset.root;
				State.update("qualityView", {
					...State.qualityView,
					selected: root,
					report: null,
					trend: null,
				});
				API.qualityReport(root);
				API.qualityTrend(root);
			});
		}
	},

	renderReport() {
		const host = document.getElementById("ql-report");
		if (!host) return;
		const v = State.qualityView || {};

		if (!v.selected) {
			host.innerHTML = `<div class="ql-empty">Pick a project. Scans run knip, madge, graphify and the Sonar secrets scanner — nothing runs until you ask.</div>`;
			return;
		}

		const project = (v.projects || []).find((p) => p.root === v.selected);
		const header = `
			<div class="ql-report-head">
				<div>
					<div class="ql-report-title">${Utils.escapeHtml(project?.name || v.selected)}</div>
					<div class="ql-dim">${Utils.escapeHtml(v.selected)}</div>
				</div>
				<div class="ql-actions">
					<button id="ql-scan" class="btn btn-primary"${v.scanning ? " disabled" : ""}>
						${v.scanning ? "Scanning…" : "Scan now"}
					</button>
					<button id="ql-build-graph" class="btn"${v.scanning ? " disabled" : ""}
						title="Run graphify update first, then scan. This WRITES a graphify-out/ directory into the project — the only thing a scan changes outside our own store. 17 of the 18 projects on disk have no graph, and without one the language-agnostic signal is missing entirely.">
						${v.scanning ? "Working…" : project?.hasGraph ? "Rebuild graph + scan" : "Build graph + scan"}
					</button>
				</div>
			</div>`;

		if (v.scanning) {
			host.innerHTML = `${header}<div class="ql-dim">Running knip, madge, graphify and the secrets scanner. This takes tens of seconds — knip alone was 7s on this repository.</div>`;
			this._bindScan();
			return;
		}

		const r = v.report;
		if (!r) {
			host.innerHTML = `${header}<div class="ql-empty">Never scanned. Nothing is known about this project yet — which is not the same as clean.</div>`;
			this._bindScan();
			return;
		}
		if (r.error) {
			host.innerHTML = `${header}<div class="ql-error"><strong>Scan failed.</strong> ${Utils.escapeHtml(r.error)}</div>`;
			this._bindScan();
			return;
		}

		host.innerHTML =
			header +
			this.renderTools(r) +
			this.renderSummary(r, v.trend) +
			this.renderFindings(r) +
			this.renderGraph(r) +
			this.renderCycles(r);
		this._bindScan();
	},

	/** What ran, what did not, and why. The most important block here. */
	renderTools(r) {
		const rows = (r.tools || [])
			.map((t) => {
				const note = t.error || t.reason || "";
				const cls =
					t.status === "ok"
						? "ql-ok"
						: t.status === "not-applicable"
							? "ql-dim"
							: "ql-warn";
				const ms =
					t.durationMs != null ? `${(t.durationMs / 1000).toFixed(1)}s` : "";
				return `<div class="ql-tool">
					<span class="ql-tool-name">${Utils.escapeHtml(t.tool)}</span>
					<span class="${cls}">${Utils.escapeHtml(t.status)}</span>
					<span class="ql-dim">${ms}</span>
					<span class="ql-dim">${Utils.escapeHtml(note.slice(0, 90))}</span>
				</div>`;
			})
			.join("");
		return `<div class="ql-block"><div class="ql-block-title">What ran</div>${rows}</div>`;
	},

	renderSummary(r, trend) {
		const s = r.summary || {};
		const delta =
			trend && trend.highDelta
				? `<span class="${trend.highDelta > 0 ? "ql-high" : "ql-ok"}" title="Change since the last scan measured by the same tools">${
						trend.highDelta > 0 ? "+" : ""
					}${trend.highDelta}</span>`
				: "";
		const unmeasured = (s.unmeasured || []).length
			? `<div class="ql-warn">Not measured: ${Utils.escapeHtml((s.unmeasured || []).join(", "))} — counts below exclude whatever these would have found.</div>`
			: "";
		return `
			<div class="ql-block">
				<div class="ql-block-title">Summary</div>
				<div class="ql-stats">
					<span class="ql-high">${s.high || 0} high</span>${delta}
					<span>${s.medium || 0} medium</span>
					<span>${s.low || 0} low</span>
					<span class="ql-dim">${s.suppressed || 0} suppressed</span>
					<span>${s.circular || 0} cycles</span>
					<span>${s.secrets || 0} secrets</span>
				</div>
				${unmeasured}
				${trend && trend.points && trend.points.length > 1 ? `<div class="ql-dim">${trend.points.length} scans recorded</div>` : ""}
			</div>`;
	},

	renderFindings(r) {
		const actionable = (r.findings || []).filter(
			(f) => f.confidence !== "suppressed",
		);
		const suppressed = (r.findings || []).filter(
			(f) => f.confidence === "suppressed",
		);

		const rows = actionable.length
			? actionable
					.map(
						(f) => `<div class="ql-finding">
							<span class="ql-conf ql-conf-${Utils.escapeHtml(f.confidence)}">${Utils.escapeHtml(f.confidence)}</span>
							<span class="ql-file">${Utils.escapeHtml(f.file)}</span>
							<span class="ql-dim">${Utils.escapeHtml((f.agreed || []).join(" + "))}</span>
							${
								(f.disagreed || []).length
									? `<span class="ql-warn" title="A signal disagrees">${Utils.escapeHtml(f.disagreed.map((d) => d.because).join("; "))}</span>`
									: ""
							}
						</div>`,
					)
					.join("")
			: `<div class="ql-dim">Nothing above the suppression line.</div>`;

		// Suppressions are counted and explained, never hidden silently: 64 of
		// 66 knip findings on this repo are suppressed, and a reader has to be
		// able to see that a filter is doing that much work.
		const note = suppressed.length
			? `<div class="ql-dim" title="${Utils.escapeHtml(suppressed[0].suppressedBy || "")}">${suppressed.length} suppressed by ground truth (${Utils.escapeHtml((suppressed[0].suppressedBy || "").slice(0, 70))})</div>`
			: "";

		return `<div class="ql-block"><div class="ql-block-title">Dead code</div>${rows}${note}</div>`;
	},

	renderGraph(r) {
		const g = r.graph;
		if (!g) {
			return `<div class="ql-block"><div class="ql-block-title">Graph</div><div class="ql-dim">No graph for this project. Build one with <code>graphify update .</code> — it is AST-only and needs no API key.</div></div>`;
		}
		const freshness =
			g.stale === null
				? `<span class="ql-warn" title="No build commit recorded, or HEAD unreadable">age unknown</span>`
				: g.stale
					? `<span class="ql-warn" title="Symbols may no longer exist">out of date</span>`
					: `<span class="ql-ok">current</span>`;
		const gods = (g.godNodes || [])
			.slice(0, 5)
			.map(
				(n) =>
					`<div class="ql-finding"><span class="ql-file">${Utils.escapeHtml(n.label)}</span><span class="ql-dim">${n.degree} edges across ${n.communitiesTouched} modules · ${Utils.escapeHtml(n.sourceFile)}</span></div>`,
			)
			.join("");
		return `
			<div class="ql-block">
				<div class="ql-block-title">Graph ${freshness}</div>
				<div class="ql-stats">
					<span>${g.nodes} nodes</span>
					<span>${g.orphanCount} orphans</span>
					<span title="Share of edges crossing a module boundary. Lower is more modular.">${Math.round((g.coupling?.ratio || 0) * 100)}% coupling</span>
					<span class="ql-dim">${g.coupling?.communities || 0} modules</span>
					${g.rot?.checked ? `<span>${g.rot.nodes} rotted</span>` : `<span class="ql-dim">rot unchecked</span>`}
				</div>
				${gods ? `<div class="ql-block-title">Most connected</div>${gods}` : ""}
			</div>`;
	},

	renderCycles(r) {
		const cycles = r.circular || [];
		if (cycles.length === 0) return "";
		return `
			<div class="ql-block">
				<div class="ql-block-title">Circular dependencies</div>
				${cycles
					.slice(0, 10)
					.map(
						(c) =>
							`<div class="ql-finding"><span class="ql-file">${Utils.escapeHtml((c.cycle || []).join(" → "))}</span></div>`,
					)
					.join("")}
			</div>`;
	},

	_bindScan() {
		const start = (buildGraph) => () => {
			const root = State.qualityView.selected;
			if (!root) return;
			State.update("qualityView", {
				...State.qualityView,
				scanning: true,
				error: null,
			});
			API.qualityScan(root, buildGraph);
		};

		const button = document.getElementById("ql-scan");
		if (button) button.addEventListener("click", start(false));

		// Separate button rather than a checkbox: building writes into the
		// project, and an option that has to be noticed is one that gets
		// clicked by accident.
		const build = document.getElementById("ql-build-graph");
		if (build) build.addEventListener("click", start(true));
	},
};

if (typeof window !== "undefined") window.QualityView = QualityView;

if (typeof Router !== "undefined" && Router.register) {
	Router.register("quality", QualityView);
}

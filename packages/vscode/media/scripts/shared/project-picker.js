/**
 * The global project picker in the header (P9).
 *
 * Populates the <select> from the core's reconciled project list and writes the
 * choice into `State.projectFilter`. It renders the list and nothing else —
 * deciding what belongs to a project is `ProjectFilter`'s job, and doing it in
 * two places is how the two answers start to differ.
 *
 * Each option carries what is behind it (`4 sessions · 205 changes`), because
 * a picker of bare names cannot distinguish a project with a year of history
 * from one memory file written once and never used again.
 */

const ProjectPicker = {
	_el: null,

	init() {
		this._el = document.getElementById("project-filter");
		if (!this._el) return;

		this._el.addEventListener("change", () => {
			State.update("projectFilter", {
				...State.projectFilter,
				selectedId: this._el.value || null,
			});
		});

		State.subscribe("projectFilter", (next, prev) => {
			if (!prev || next.projects !== prev.projects) this.render();
		});

		this.render();
		API.getProjects();
	},

	render() {
		if (!this._el) return;
		const filter = State.projectFilter || {};
		const projects = filter.projects || [];
		const selected = filter.selectedId || "";

		const options = [`<option value="">All projects</option>`];
		for (const project of projects) {
			options.push(
				`<option value="${Utils.escapeHtml(project.id)}"${
					project.id === selected ? " selected" : ""
				}>${Utils.escapeHtml(project.name)} — ${this.weight(project.counts)}</option>`,
			);
		}
		this._el.innerHTML = options.join("");
		// Restoring the value explicitly: replacing innerHTML drops the
		// selection even when an option carries `selected`.
		this._el.value = selected;
	},

	/** What is behind a project, in the sources that actually have anything. */
	weight(counts) {
		if (!counts) return "empty";
		const parts = [];
		if (counts.sessions) parts.push(`${counts.sessions} sessions`);
		if (counts.changes) parts.push(`${counts.changes} changes`);
		if (counts.memory) parts.push(`${counts.memory} memory`);
		if (counts.research) parts.push(`${counts.research} research`);
		return parts.length ? parts.join(" · ") : "empty";
	},

	/**
	 * A line a view can render to say what it is scoped to.
	 *
	 * Returns "" when nothing is filtered, so a view can print it
	 * unconditionally and an unscoped view stays uncluttered.
	 */
	scopeLine(unattributed) {
		const identity = ProjectFilter.selected();
		if (!identity) return "";
		const hidden = unattributed
			? `<span class="project-unattributed">· ${unattributed} could not be attributed, shown anyway</span>`
			: "";
		return `<div class="project-scope">
      <span>Scoped to <span class="project-scope-name">${Utils.escapeHtml(identity.name)}</span></span>
      ${hidden}
    </div>`;
	},
};

if (typeof window !== "undefined") window.ProjectPicker = ProjectPicker;

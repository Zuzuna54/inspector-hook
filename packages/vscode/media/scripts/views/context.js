/**
 * Context view — Claude Code's native auto memory, across every project.
 *
 * Memory lives in ~/.claude/projects/<slug>/memory/ as a MEMORY.md index plus
 * per-topic files, and nothing but a text editor reads it back. Two things make
 * a view worth having over that editor:
 *
 *  - native memory is per-project, so "where did I solve this before" has no
 *    answer from inside a session. One view over every project does.
 *  - a file the index never names is never loaded. It exists, costs disk, and
 *    does nothing, and nothing else surfaces that.
 *
 * Controller only: state, lifecycle and event wiring. The renderers and the
 * curation actions are composed in from ./context/.
 */

const ContextView = {
	_unsubscribers: [],
	_delegated: false,

	/**
	 * Initialize the view.
	 */
	init() {
		this._unsubscribers.push(
			State.subscribe("contextView", (newVal, oldVal) => {
				if (newVal.projects !== oldVal?.projects) this.renderProjects();
				if (
					newVal.selectedProject !== oldVal?.selectedProject ||
					newVal.projects !== oldVal?.projects
				) {
					this.renderFiles();
				}
				if (
					newVal.selectedFile !== oldVal?.selectedFile ||
					newVal.projects !== oldVal?.projects
				) {
					this.renderDetail();
				}
				if (newVal.lastResult !== oldVal?.lastResult) this.renderResult();
			}),
		);

		this.setupHandlers();
		this.render();

		// Every project, including empties: a project with no memory yet is a
		// true state, and hiding it makes "nothing here" indistinguishable from
		// "this project does not exist".
		API.memoryGetProjects({ includeEmpty: true });
	},

	/**
	 * Drop subscriptions. The delegated listener lives on a container that
	 * survives view switches, so it is installed once and left alone.
	 */
	cleanup() {
		this._unsubscribers.forEach((unsub) => unsub());
		this._unsubscribers = [];
	},

	render() {
		this.renderProjects();
		this.renderFiles();
		this.renderDetail();
	},

	/**
	 * The currently selected project, or null.
	 * @returns {Object|null}
	 */
	selectedProject() {
		const { projects, selectedProject } = State.contextView;
		if (!selectedProject) return null;
		return (projects || []).find((p) => p.memoryDir === selectedProject) || null;
	},

	/**
	 * The currently selected file, or null.
	 * @returns {Object|null}
	 */
	selectedFile() {
		const project = this.selectedProject();
		const { selectedFile } = State.contextView;
		if (!project || !selectedFile) return null;
		return (project.files || []).find((f) => f.fileName === selectedFile) || null;
	},

	renderProjects() {
		const el = document.getElementById("ctx-project-list");
		if (!el) return;

		const { projects, selectedProject, showEmpty } = State.contextView;
		const all = projects || [];
		// Eight of eighteen projects in a real corpus hold nothing. Listing them
		// by default buries the ones that matter, so they collapse behind a count.
		const withFiles = all.filter((p) => (p.files || []).length > 0);
		const empty = all.filter((p) => (p.files || []).length === 0);
		const shown = showEmpty ? all : withFiles;

		if (all.length === 0) {
			el.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No memory yet</div>
          <div class="empty-state-description">Claude Code writes memory per project as you work</div>
        </div>
      `;
			return;
		}

		el.innerHTML = `
      ${shown.map((p) => this.renderProjectRow(p, p.memoryDir === selectedProject)).join("")}
      ${
				empty.length > 0
					? `<button class="ctx-toggle-empty">${showEmpty ? "Hide" : "Show"} ${empty.length} project${empty.length === 1 ? "" : "s"} with no memory</button>`
					: ""
			}
    `;
	},

	renderFiles() {
		const el = document.getElementById("ctx-file-list");
		if (!el) return;

		const project = this.selectedProject();
		if (!project) {
			el.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">Select a project</div>
        </div>
      `;
			return;
		}

		const { selectedFile } = State.contextView;
		const files = project.files || [];
		// Orphans first: they are the reason to open this view at all.
		const ordered = [...files].sort((a, b) => {
			if (a.orphaned !== b.orphaned) return a.orphaned ? -1 : 1;
			return String(a.name || "").localeCompare(String(b.name || ""));
		});

		el.innerHTML = files.length
			? ordered.map((f) => this.renderFileRow(f, f.fileName === selectedFile)).join("")
			: `<div class="empty-state"><div class="empty-state-title">No memory files</div></div>`;
	},

	renderDetail() {
		const el = document.getElementById("ctx-detail");
		if (!el) return;

		const file = this.selectedFile();
		const origin = this.resolveOrigin(file);
		el.innerHTML = this.renderFileDetail(file, origin);
	},

	renderResult() {
		const el = document.getElementById("ctx-result");
		if (!el) return;
		el.innerHTML = this.renderRefusal(State.contextView.lastResult);
	},

	/**
	 * The session a memory file came from, when it is still held.
	 *
	 * Usually it is not: retention deletes sessions while memory persists, so
	 * most origin ids no longer resolve. Returning null is the normal case, and
	 * the renderer says so rather than offering a link that goes nowhere.
	 * @param {Object} file
	 * @returns {Object|null}
	 */
	resolveOrigin(file) {
		if (!file) return null;
		const id = this.originSessionId(file);
		if (!id) return null;
		return (State.sessions || []).find((s) => s.id === id) || null;
	},

	/**
	 * One delegated listener for the whole view, installed once.
	 */
	setupHandlers() {
		const root = document.getElementById("view-context");
		if (!root || this._delegated) return;
		this._delegated = true;

		root.addEventListener("click", (e) => {
			const project = e.target.closest(".ctx-project");
			if (project) {
				State.update("contextView", {
					...State.contextView,
					selectedProject: project.dataset.memoryDir,
					selectedFile: null,
					lastResult: null,
				});
				return;
			}

			if (e.target.closest(".ctx-toggle-empty")) {
				State.update("contextView", {
					...State.contextView,
					showEmpty: !State.contextView.showEmpty,
				});
				this.renderProjects();
				return;
			}

			const addToIndex = e.target.closest(".ctx-add-to-index");
			if (addToIndex) {
				this.addToIndex(addToIndex.dataset.fileName);
				return;
			}

			if (e.target.closest(".ctx-create-index")) {
				this.createIndex();
				return;
			}

			// An index link and a wiki-link both select a file; they differ only
			// in whether they name a file or a memory slug.
			const indexLink = e.target.closest(".ctx-index-link");
			if (indexLink) {
				this.selectFile(indexLink.dataset.fileName);
				return;
			}

			const wikiLink = e.target.closest(".ctx-wikilink");
			if (wikiLink) {
				this.selectByName(wikiLink.dataset.link);
				return;
			}

			const origin = e.target.closest(".ctx-origin-link");
			if (origin) {
				State.update("sessionView", {
					...State.sessionView,
					selectedSession: origin.dataset.sessionId,
				});
				Router.navigate("sessions");
				return;
			}

			const file = e.target.closest(".ctx-file");
			if (file) this.selectFile(file.dataset.fileName);
		});
	},

	/**
	 * @param {string} fileName
	 */
	selectFile(fileName) {
		if (!fileName) return;
		State.update("contextView", {
			...State.contextView,
			selectedFile: fileName,
			lastResult: null,
		});
	},

	/**
	 * Follow a [[wiki-link]], which names a memory slug rather than a file.
	 * @param {string} name
	 */
	selectByName(name) {
		const project = this.selectedProject();
		if (!project || !name) return;
		const match = (project.files || []).find(
			(f) => f.name === name || f.fileName === `${name}.md`,
		);
		if (match) this.selectFile(match.fileName);
	},
};

/*
 * Compose the renderers and curation actions onto the view, after the literal
 * so a stale local cannot shadow them. panel.ts loads both before this file.
 */
Object.assign(ContextView, window.ContextRenderMixin, window.ContextCurationMixin);

Router.register("context", ContextView);

window.ContextView = ContextView;

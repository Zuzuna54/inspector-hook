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
				if (newVal.projects !== oldVal?.projects) {
					this.renderProjects();
					this.renderStatus();
				}
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

				// The injection pane has its own data, and omitting these was a real
				// bug: a previewed digest arrived, landed in state, and nothing
				// re-rendered — so Preview looked like it did nothing at all. Same
				// shape as every other "the work happened and no view showed it"
				// failure in this codebase.
				if (
					newVal.digest !== oldVal?.digest ||
					newVal.staged !== oldVal?.staged
				) {
					this.renderInjectionPane();
				}
			}),
		);

		// The injection pane lists sessions, which are owned by a different slice
		// and can arrive after this view is open. Without this the list would stay
		// on "No sessions retained" for as long as the panel is up.
		this._unsubscribers.push(
			State.subscribe("sessions", () => {
				if (State.contextView.mode === "injection") this.renderInjectionPane();
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
		this.renderStatus();
		this.renderMode();
		this.renderProjects();
		this.renderFiles();
		this.renderDetail();
	},

	/**
	 * The view does two jobs — browsing/curating the corpus, and staging context
	 * for the next session — so it has two modes rather than one crowded pane.
	 */
	renderMode() {
		const root = document.getElementById("view-context");
		if (!root) return;
		const { mode, search } = State.contextView;
		root.classList.toggle("ctx-mode-injection", mode === "injection");

		// The buttons are in the HTML; only the active marker is ours. Rewriting
		// them here would put their existence back behind this function running.
		for (const button of document.querySelectorAll("#ctx-mode-toggle .ctx-mode")) {
			button.classList.toggle("active", button.dataset.mode === mode);
		}

		const searchEl = document.getElementById("ctx-search");
		if (searchEl && searchEl.value !== search) searchEl.value = search;

		if (mode === "injection") this.renderInjectionPane();
	},

	/**
	 * What the view currently holds.
	 *
	 * Doubles as the answer to "why is this empty": a pane with no projects and
	 * no sessions is indistinguishable from a broken one unless it says so.
	 */
	renderStatus() {
		const el = document.getElementById("ctx-status");
		if (!el) return;
		const { projects } = State.contextView;
		const files = (projects || []).reduce((n, p) => n + (p.files || []).length, 0);
		el.textContent = `${(projects || []).length} projects · ${files} memory files · ${(State.sessions || []).length} sessions retained`;
	},

	renderInjectionPane() {
		const el = document.getElementById("ctx-injection-pane");
		if (!el) return;
		const { staged, digest } = State.contextView;
		el.innerHTML = this.renderInjection(staged, State.sessions || [], digest);
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

		const { search, projects, editing, draft } = State.contextView;

		// A search spans every project, so it replaces the single-file detail
		// rather than filtering the one project's list: the answer to "where did
		// I solve this before" is usually in a project you did not select.
		if (String(search || "").trim().length >= 2) {
			el.innerHTML = this.renderSearchResults(
				this.searchCorpus(projects, search),
				search,
			);
			return;
		}

		const file = this.selectedFile();
		if (editing && file && editing === file.fileName) {
			el.innerHTML = this.renderEditor(file, draft);
			return;
		}

		el.innerHTML = `
      ${file ? this.renderFileActions(file) : ""}
      ${this.renderFileDetail(file, this.resolveOrigin(file))}
    `;
	},

	/**
	 * The actions on one file. Delete sits beside the reversible alternative on
	 * purpose, so the destructive option is never the only one offered.
	 * @param {Object} file
	 * @returns {string}
	 */
	renderFileActions(file) {
		return `
      <div class="ctx-actions">
        <button class="btn btn-xs ctx-edit" data-file-name="${Utils.escapeHtml(file.fileName)}">Edit</button>
        ${
					file.orphaned
						? ""
						: `<button class="btn btn-xs btn-secondary ctx-unindex" data-file-name="${Utils.escapeHtml(file.fileName)}">Remove from index</button>`
				}
        <button class="btn btn-xs btn-danger ctx-delete" data-file-name="${Utils.escapeHtml(file.fileName)}">Delete</button>
      </div>
    `;
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

			const mode = e.target.closest(".ctx-mode");
			if (mode) {
				State.update("contextView", {
					...State.contextView,
					mode: mode.dataset.mode,
					digest: null,
				});
				this.renderMode();
				if (mode.dataset.mode === "injection") API.memoryGetStaged();
				return;
			}

			// A search hit names a project as well as a file, since the match is
			// usually in a project other than the selected one.
			const hit = e.target.closest(".ctx-result");
			if (hit) {
				State.update("contextView", {
					...State.contextView,
					search: "",
					selectedProject: hit.dataset.memoryDir,
					selectedFile: hit.dataset.fileName,
				});
				this.render();
				return;
			}

			const edit = e.target.closest(".ctx-edit");
			if (edit) return this.beginEdit(edit.dataset.fileName);

			if (e.target.closest(".ctx-edit-cancel")) return this.cancelEdit();
			if (e.target.closest(".ctx-edit-save")) return this.commitEdit();

			const unindex = e.target.closest(".ctx-unindex");
			if (unindex) return this.removeFromIndex(unindex.dataset.fileName);

			const del = e.target.closest(".ctx-delete");
			if (del) return this.confirmDelete(del.dataset.fileName);

			const preview = e.target.closest(".ctx-preview-digest");
			if (preview) {
				API.memoryBuildDigest(preview.dataset.sessionId);
				return;
			}

			if (e.target.closest(".ctx-stage-digest")) {
				const { digest } = State.contextView;
				if (digest?.sessionId) API.memoryStageContext({ sessionId: digest.sessionId });
				return;
			}

			if (e.target.closest(".ctx-clear-staged")) {
				API.memoryClearStaged();
				return;
			}

			const file = e.target.closest(".ctx-file");
			if (file) this.selectFile(file.dataset.fileName);
		});

		// Search is debounced: it scans every body in the corpus, and doing that
		// per keystroke is wasted work on a large one.
		const search = document.getElementById("ctx-search");
		search?.addEventListener(
			"input",
			Utils.debounce((e) => {
				State.update("contextView", {
					...State.contextView,
					search: e.target.value,
				});
				this.renderDetail();
			}, 200),
		);

		// The draft is held in state rather than read off the textarea at save
		// time, so the diff summary can update as you type.
		root.addEventListener("input", (e) => {
			if (e.target.classList?.contains("ctx-editor-body")) {
				State.contextView.draft = e.target.value;
				this.refreshDiffSummary();
			}
		});
	},

	/**
	 * Start editing a file.
	 * @param {string} fileName
	 */
	beginEdit(fileName) {
		const project = this.selectedProject();
		const file = (project?.files || []).find((f) => f.fileName === fileName);
		if (!file) return;
		State.update("contextView", {
			...State.contextView,
			editing: fileName,
			draft: file.body || "",
		});
		this.renderDetail();
	},

	cancelEdit() {
		State.update("contextView", {
			...State.contextView,
			editing: null,
			draft: "",
		});
		this.renderDetail();
	},

	/**
	 * Save the draft, with the type from the selector so a retype and an edit
	 * are one write rather than two.
	 */
	commitEdit() {
		const file = this.selectedFile();
		if (!file) return;
		const select = document.querySelector(".ctx-type-select");
		this.saveEdit({ ...file, type: select?.value || file.type }, State.contextView.draft);
		this.cancelEdit();
	},

	/**
	 * Update just the diff line as the draft changes, rather than re-rendering
	 * the editor and losing the cursor.
	 */
	refreshDiffSummary() {
		const file = this.selectedFile();
		const el = document.querySelector(".ctx-diff-summary");
		const save = document.querySelector(".ctx-edit-save");
		if (!file || !el) return;
		const summary = this.diffSummary(file.body || "", State.contextView.draft);
		const changed = summary.added > 0 || summary.removed > 0;
		el.textContent = changed ? `+${summary.added} / -${summary.removed} lines` : "no changes";
		el.classList.toggle("unchanged", !changed);
		if (save) save.disabled = !changed;
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

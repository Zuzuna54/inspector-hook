/**
 * Context view: the delegated event handlers.
 *
 * One listener on the view root, installed once, covering every control the
 * renderers emit. Split out of context.js when adding the tray buttons pushed
 * that file past the size limit — the controller keeps state and lifecycle,
 * this keeps the wiring between a click and an API call.
 *
 * Composed onto ContextView, so `this` is the view and every method it reaches
 * for (selectFile, beginEdit, the curation actions) resolves as before.
 */

const ContextHandlersMixin = {
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
					// A stale refusal outliving the action it described would
					// accuse the next preview of a failure that was not its own.
					stageRefusal: null,
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

			// Add to the tray rather than replacing whatever is staged. The tray
			// is the composition surface; staging is the one-shot delivery.
			if (e.target.closest(".ctx-tray-digest")) {
				const { digest } = State.contextView;
				if (digest?.body) {
					API.contextAddItem({
						kind: "session_digest",
						title: digest.title || "Session digest",
						text: digest.body,
						source: digest.sessionId ? { sessionId: digest.sessionId } : {},
					});
				}
				return;
			}

			if (e.target.closest(".ctx-tray-file")) {
				const file = this.selectedFile();
				if (file) {
					API.contextAddItem({
						kind: "memory_file",
						title: file.name || file.fileName,
						text: file.body || "",
						source: {
							memoryDir: State.contextView.selectedProject,
							fileName: file.fileName,
						},
					});
				}
				return;
			}

			if (e.target.closest(".ctx-stage-digest")) {
				// The button only renders for a digest worth keeping, so the
				// session id is the only thing that has to be present. It was
				// not: the guard read `digest.sessionId` off the IPC envelope
				// rather than the digest, so it never passed and the button did
				// nothing, silently, for as long as it shipped. Now that the
				// panel unwraps the envelope and SessionDigest carries the id,
				// this resolves -- and a missing id reports itself rather than
				// returning quietly, because a no-op that looks like a click is
				// the failure that took three attempts to find.
				const { digest } = State.contextView;
				if (digest?.sessionId) {
					API.memoryStageContext({ sessionId: digest.sessionId });
				} else {
					State.update("contextView", {
						...State.contextView,
						stageRefusal:
							"This digest arrived without a session id, so it cannot be staged.",
					});
				}
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

		// Changing the type is an edit in its own right. Save was gated purely
		// on the body diff, so retyping a file without also touching its text
		// was impossible -- the control rendered, accepted a new value, and had
		// no way to commit it. commitEdit already reads the selector; only the
		// gate was wrong.
		root.addEventListener("change", (e) => {
			if (e.target.classList?.contains("ctx-type-select")) {
				this.refreshDiffSummary();
			}
		});
	},
};

window.ContextHandlersMixin = ContextHandlersMixin;

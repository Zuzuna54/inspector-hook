/**
 * Context view: the injection pane's renderers.
 *
 * Split out of memory-render.js, which browses and curates the corpus. This
 * file answers a different question -- what is staged for a future session, and
 * what would a chosen session contribute -- and it is the file where three
 * shipped bugs lived, all of the same kind: a payload arriving in a shape the
 * renderer did not expect, and rendering as something plausible instead of
 * failing.
 *
 *   - the digest preview read `worthKeeping` and `text` off the IPC envelope
 *     rather than the digest, so every field was undefined and the box drew
 *     empty
 *   - "Stage this" guarded on a `sessionId` the payload had never carried
 *   - a staging refusal is `{staged:false, reason}`, which is truthy, so it
 *     rendered as a successful stage with an empty body
 *
 * Hence the rule this file now follows: when a payload is not the shape it must
 * be, say so. An empty box is indistinguishable from an empty session, and that
 * ambiguity is what made these take three attempts to find.
 *
 * Every test here draws its input from test/fixtures/payloads.js, generated
 * from the real builders -- never from a literal typed in a test.
 */

const ContextInjectionMixin = {
	/**
	 * The injection pane: what is staged, and the sessions you can stage from.
	 * @param {Object} staged
	 * @param {Array} sessions
	 * @param {Object} digest
	 * @returns {string}
	 */
	renderInjection(staged, sessions, digest, stageRefusal) {
		return `
      <div class="ctx-injection">
        ${
					stageRefusal
						? `<div class="ctx-notice ctx-notice-refused">${Utils.escapeHtml(stageRefusal)}</div>`
						: ""
				}
        ${this.renderStaged(staged)}
        <div class="ctx-injection-sessions">
          <h4>Stage a session's digest</h4>
          <p class="ctx-hint">
            Nothing is injected unless you stage it, and it lands on the
            <strong>next session that starts</strong> — not this one.
          </p>
          ${
						(sessions || []).length
							? (sessions || [])
									.map(
										(s) => `
              <div class="ctx-session-row" data-session-id="${Utils.escapeHtml(s.id)}">
                <span class="ctx-session-name">${Utils.escapeHtml(s.name || s.id.slice(0, 8))}</span>
                <span class="ctx-session-meta">${Utils.formatDate(s.startTime)}</span>
                <button class="btn btn-xs ctx-preview-digest" data-session-id="${Utils.escapeHtml(s.id)}">Preview</button>
              </div>
            `,
									)
									.join("")
							: '<div class="empty-state"><div class="empty-state-title">No sessions retained</div></div>'
					}
        </div>
        ${this.renderDigest(digest)}
      </div>
    `;
	},

	/**
	 * What is currently staged.
	 * @param {Object} staged
	 * @returns {string}
	 */
	renderStaged(staged) {
		if (!staged) {
			return `
        <div class="ctx-notice">
          Nothing staged. The next session starts with only its native memory.
        </div>
      `;
		}
		return `
      <div class="ctx-staged">
        <div class="ctx-staged-head">
          <strong>Staged for the next session</strong>
          <span class="ctx-staged-meta">expires ${Utils.formatDate(staged.expiresAt)}</span>
          <button class="btn btn-xs btn-danger ctx-clear-staged">Clear</button>
        </div>
        <p class="ctx-hint">This is exactly the text the hook will emit, and it is used once.</p>
        <pre class="ctx-staged-text">${Utils.escapeHtml(staged.text || "")}</pre>
      </div>
    `;
	},

	/**
	 * A previewed digest, and the button that stages it.
	 *
	 * Preview is the whole feature: what is staged is the text shown here, so
	 * nothing can be injected that was not read first.
	 * @param {Object} digest
	 * @returns {string}
	 */
	renderDigest(digest) {
		if (!digest) return "";

		// The core reports an unusable request as {error}. Saying so beats
		// drawing an empty preview, which is indistinguishable from success.
		if (digest.error) {
			return `<div class="ctx-notice ctx-notice-refused">${Utils.escapeHtml(digest.error)}</div>`;
		}

		// A session with nothing recorded produces no useful digest, and the
		// backend says why rather than handing back an empty entry.
		if (digest.worthKeeping === false) {
			return `
        <div class="ctx-notice">
          Nothing worth staging from this session${digest.skipReason ? `: ${Utils.escapeHtml(digest.skipReason)}` : "."}
        </div>
      `;
		}

		// `body` is what the core produces, and the only thing it has ever
		// produced. There was a `digest.text ||` fallback here for a field no
		// payload has ever carried -- it could only mask a regression, and it
		// did exactly that: the view was handed the IPC envelope rather than
		// the digest, every field read undefined, and the fallback turned a
		// wrong-shape payload into a silent empty box.
		const text = digest.body || "";
		if (!text) {
			return `
        <div class="ctx-notice ctx-notice-refused">
          The digest arrived without a body. This is a payload-shape problem,
          not an empty session.
        </div>
      `;
		}
		return `
      <div class="ctx-digest">
        <div class="ctx-digest-head">
          <strong>Digest preview</strong>
          <button class="btn btn-xs ctx-tray-digest">Add to tray</button>
          <button class="btn btn-xs btn-success ctx-stage-digest">Stage this</button>
        </div>
        <pre class="ctx-digest-text">${Utils.escapeHtml(text)}</pre>
      </div>
    `;
	},
};

window.ContextInjectionMixin = ContextInjectionMixin;

/**
 * Rendering helpers shared by the History and File Changes views.
 *
 * Only genuinely shared code lives here. The two views' _renderUnifiedDiff and
 * _renderSplitDiff look like duplicates by name but are not: they emit
 * different CSS namespaces (hv-* against fc-*) and delegate differently, so
 * merging them would break both. What IS shared is below - the highlighter was
 * byte-identical in both files, and the file-change accessor differed only in
 * formatting.
 *
 * Composed onto each view with Object.assign after its object literal, so
 * `this` resolves to the view exactly as it did when these were declared
 * inline.
 */

const DiffRenderMixin = {
	/**
	 * Apply syntax highlighting to already-escaped content
	 * This is a language-agnostic method that highlights common programming patterns
	 */
	_applySyntaxHighlighting(escapedContent, language) {
		if (!escapedContent || language === "plaintext") return escapedContent;

		// Simple token-based highlighting for common patterns
		let result = escapedContent;

		// Keywords (language agnostic common ones)
		const keywords =
			/\b(const|let|var|function|class|return|if|else|for|while|import|export|from|default|async|await|try|catch|throw|new|this|true|false|null|undefined|type|interface|enum|extends|implements|public|private|protected|static|readonly|abstract|override)\b/g;
		result = result.replace(keywords, '<span class="token keyword">$1</span>');

		// Strings (already escaped, so &quot; instead of ")
		result = result.replace(
			/(&quot;[^&]*&quot;|&#39;[^&]*&#39;|`[^`]*`)/g,
			'<span class="token string">$1</span>',
		);

		// Numbers
		result = result.replace(
			/\b(\d+\.?\d*)\b/g,
			'<span class="token number">$1</span>',
		);

		// Comments (single line // and # style)
		result = result.replace(
			/(\/\/.*$|#.*$)/gm,
			'<span class="token comment">$1</span>',
		);

		// Function calls (word followed by opening paren)
		result = result.replace(
			/\b([a-zA-Z_]\w*)\s*(?=\()/g,
			'<span class="token function">$1</span>',
		);

		// Types (PascalCase words that aren't already wrapped)
		result = result.replace(
			/(?<!<span[^>]*>)\b([A-Z][a-zA-Z0-9]*)\b(?![^<]*<\/span>)/g,
			'<span class="token type">$1</span>',
		);

		return result;
	},

	/**
	 * Get file changes from state
	 */
	_getFileChanges() {
		if (typeof State === "undefined" || !State.fileChanges) return [];

		// The global project filter, applied here because this accessor is the
		// single source both File Changes and History read from.
		//
		// Three-valued: a change whose path the core could not place is KEPT.
		// Dropping it would make a scoped list silently shorter than the truth,
		// and a short list reads as "this project changed fewer files" rather
		// than "some changes could not be attributed".
		const identity =
			typeof ProjectFilter !== "undefined" ? ProjectFilter.selected() : null;
		if (!identity) {
			this._unattributedChanges = 0;
			return State.fileChanges;
		}
		const split = ProjectFilter.split(identity, State.fileChanges, (c) => ({
			path: c.filePath,
		}));
		this._unattributedChanges = split.unknown.length;
		return [...split.included, ...split.unknown];
	},
};

window.DiffRenderMixin = DiffRenderMixin;

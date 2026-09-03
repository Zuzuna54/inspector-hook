/**
 * History: virtual scrolling for very large diffs, and the scrollbar change markers.
 *
 * Moved WHOLE and never split internally. These three co-operate through live
 * element heights and scroll offsets, so they have no unit coverage - a stubbed
 * DOM would only test the stub. Verifying this module means scrolling a long
 * diff in the panel.
 *
 * Moved verbatim out of history.js.
 * Composed onto the view with Object.assign after its literal, so `this`
 * resolves exactly as it did when these were declared inline.
 */

const HistoryVirtualScrollMixin = {
	/**
	 * Render scrollbar markers for changed lines
	 */
	_renderScrollbarMarkers(addedLines, removedMarkers, totalLines) {
		if (totalLines === 0) return "";

		const markers = [];

		// Add markers for added lines
		addedLines.forEach((lineNum) => {
			const percent = ((lineNum - 1) / totalLines) * 100;
			markers.push(
				`<div class="hv-scrollbar-marker added" style="top: ${percent}%"></div>`,
			);
		});

		// Add markers for removed lines
		removedMarkers.forEach((_, lineNum) => {
			const percent = ((lineNum - 1) / totalLines) * 100;
			markers.push(
				`<div class="hv-scrollbar-marker removed" style="top: ${percent}%"></div>`,
			);
		});

		return `<div class="hv-scrollbar-markers">${markers.join("")}</div>`;
	},

	/**
	 * Render content with virtual scrolling for performance
	 */
	_renderVirtualScrollContent(lines, language) {
		const totalHeight = lines.length * this._LINE_HEIGHT;
		const viewportId = `hv-virtual-viewport-${Date.now()}`;

		// Store lines and language for scroll handler
		this._virtualScrollLines = lines;
		this._virtualScrollLanguage = language;

		return `
      <div class="hv-code-content hv-virtual-scroll" id="${viewportId}" style="position: relative; overflow-y: auto; height: 100%;">
        <div class="hv-virtual-scroll-wrapper" style="height: ${totalHeight}px; position: relative;">
          <div class="hv-virtual-scroll-content" id="${viewportId}-content"></div>
        </div>
      </div>
    `;
	},

	/**
	 * Initialize virtual scrolling after render
	 */
	_initVirtualScroll(container) {
		const viewport = container.querySelector(".hv-virtual-scroll");
		if (!viewport || !this._virtualScrollLines) return;

		const content = viewport.querySelector(".hv-virtual-scroll-content");
		if (!content) return;

		const renderVisibleLines = () => {
			const scrollTop = viewport.scrollTop;
			const viewportHeight = viewport.clientHeight;
			const lines = this._virtualScrollLines;
			const language = this._virtualScrollLanguage;

			const startLine = Math.max(
				0,
				Math.floor(scrollTop / this._LINE_HEIGHT) - this._BUFFER_SIZE,
			);
			const endLine = Math.min(
				lines.length,
				Math.ceil((scrollTop + viewportHeight) / this._LINE_HEIGHT) +
					this._BUFFER_SIZE,
			);

			const visibleLines = [];
			const self = this;
			for (let i = startLine; i < endLine; i++) {
				const escaped = Utils.escapeHtml(lines[i]);
				const highlighted = self._applySyntaxHighlighting(escaped, language);
				visibleLines.push(`
          <div class="hv-code-line" style="position: absolute; top: ${i * this._LINE_HEIGHT}px; left: 0; right: 0;">
            <span class="hv-line-num">${i + 1}</span>
            <span class="hv-line-content">${highlighted || " "}</span>
          </div>
        `);
			}

			content.innerHTML = visibleLines.join("");
		};

		// Initial render
		renderVisibleLines();

		// Add scroll listener with throttling
		let ticking = false;
		viewport.addEventListener("scroll", () => {
			if (!ticking) {
				requestAnimationFrame(() => {
					renderVisibleLines();
					ticking = false;
				});
				ticking = true;
			}
		});
	},
};

window.HistoryVirtualScrollMixin = HistoryVirtualScrollMixin;

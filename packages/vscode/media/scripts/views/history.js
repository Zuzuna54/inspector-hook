/**
 * History View - Accordion Redesign
 * Shows version history for tracked files with accordion structure
 */

const HistoryView = {
  _subscriptions: [],

  // Accordion state
  _expandedFiles: new Set(),
  _selectedVersion: null,  // { filePath, versionNumber }

  // View mode: 'full' or 'diff'
  _viewMode: 'full',

  // Restore preview state
  _restorePreview: null,

  /**
   * Initialize the view
   */
  init() {
    this.render();

    // Subscribe to state changes
    if (typeof State !== 'undefined' && State.subscribe) {
      this._subscriptions.push(
        State.subscribe('fileChanges', () => this.renderFileAccordions())
      );
      this._subscriptions.push(
        State.subscribe('versionHistory', () => this.renderFileAccordions())
      );
    }
  },

  /**
   * Cleanup subscriptions when view is deactivated
   */
  cleanup() {
    this._subscriptions.forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
    this._subscriptions = [];
    this._expandedFiles.clear();
    this._selectedVersion = null;
    this._viewMode = 'full';
    this._restorePreview = null;
  },

  /**
   * Render the main view structure
   */
  render() {
    const container = document.getElementById('view-history');
    if (!container) return;

    container.innerHTML = `
      <div class="history-v2">
        <div class="hv-header">
          <div class="hv-header-left">
            <h3>Version History</h3>
            <span class="hv-count" id="hv-file-count">0 files</span>
          </div>
        </div>
        <div class="hv-content">
          <div class="hv-files-panel" id="hv-files-panel">
            <div class="empty-state">Loading files...</div>
          </div>
          <div class="hv-viewer-panel" id="hv-viewer-panel">
            <div class="hv-viewer-placeholder">
              <div class="empty-state">
                <div class="empty-state-title">Select a version</div>
                <div class="empty-state-description">Click a file to expand, then click a version to view</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.renderFileAccordions();
  },

  /**
   * Get file changes from state
   */
  _getFileChanges() {
    if (typeof State !== 'undefined' && State.fileChanges) {
      return State.fileChanges;
    }
    return [];
  },

  /**
   * Get version history from state
   */
  _getVersionHistory() {
    if (typeof State !== 'undefined' && State.versionHistory) {
      return State.versionHistory;
    }
    return {};
  },

  /**
   * Get unique files from changes
   */
  _getUniqueFiles() {
    const changes = this._getFileChanges();
    const files = [...new Set(changes.map(c => c.filePath).filter(Boolean))];
    return files;
  },

  /**
   * Render the file accordions
   */
  renderFileAccordions() {
    const container = document.getElementById('hv-files-panel');
    if (!container) return;

    const files = this._getUniqueFiles();
    const versionHistory = this._getVersionHistory();

    // Update count
    const countEl = document.getElementById('hv-file-count');
    if (countEl) {
      countEl.textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
    }

    if (files.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No tracked files</div>
          <div class="empty-state-description">Files with version history will appear here</div>
        </div>
      `;
      return;
    }

    container.innerHTML = files.map(filePath => {
      const isExpanded = this._expandedFiles.has(filePath);
      const fileName = Utils.getFileName(filePath);
      const versions = versionHistory[filePath] || [];
      const versionCount = versions.length;

      return `
        <div class="hv-file ${isExpanded ? 'expanded' : ''}" data-file-path="${Utils.escapeHtml(filePath)}">
          <div class="hv-file-header" data-file-path="${Utils.escapeHtml(filePath)}">
            <span class="hv-expand-icon">${isExpanded ? '&#9660;' : '&#9654;'}</span>
            <span class="hv-file-name" title="${Utils.escapeHtml(filePath)}">${Utils.escapeHtml(fileName)}</span>
            <span class="hv-version-count">${versionCount} version${versionCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="hv-file-content ${isExpanded ? '' : 'hidden'}">
            ${isExpanded ? this._renderVersionList(filePath, versions) : ''}
          </div>
        </div>
      `;
    }).join('');

    this._setupFileHandlers(container);
  },

  /**
   * Render version list for a file
   */
  _renderVersionList(filePath, versions) {
    if (versions.length === 0) {
      return `
        <div class="hv-no-versions">
          <span>No versions recorded yet</span>
          <button class="btn btn-xs" onclick="API.getVersionHistory('${Utils.escapeHtml(filePath)}')">Load History</button>
        </div>
      `;
    }

    return `
      <div class="hv-versions">
        ${versions.map((version, idx) => {
          const isCurrent = idx === 0;
          const isSelected = this._selectedVersion?.filePath === filePath &&
                            this._selectedVersion?.versionNumber === version.versionNumber;
          const versionLabel = this._formatVersionLabel(version.versionNumber, version.timestamp);

          return `
            <div class="hv-version ${isCurrent ? 'current' : ''} ${isSelected ? 'selected' : ''}"
                 data-file-path="${Utils.escapeHtml(filePath)}"
                 data-version="${version.versionNumber}">
              <div class="hv-version-info">
                <span class="hv-version-label">${versionLabel}</span>
                ${isCurrent ? '<span class="hv-version-badge">current</span>' : ''}
              </div>
              <div class="hv-version-meta">
                <span class="hv-version-tool">${Utils.escapeHtml(version.tool || 'Unknown')}</span>
                ${version.sessionId ? `<span class="hv-version-session">${Utils.escapeHtml(version.sessionId.slice(0, 8))}</span>` : ''}
              </div>
              <div class="hv-version-actions">
                <button class="btn btn-xs hv-view-btn" data-file-path="${Utils.escapeHtml(filePath)}" data-version="${version.versionNumber}">View</button>
                ${!isCurrent ? `<button class="btn btn-xs btn-warning hv-restore-btn" data-file-path="${Utils.escapeHtml(filePath)}" data-version="${version.versionNumber}">Restore</button>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  /**
   * Format version label: "v3 - Jan 17, 2:30 PM"
   */
  _formatVersionLabel(versionNumber, timestamp) {
    const date = new Date(timestamp);
    const formatted = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
    return `v${versionNumber} - ${formatted}`;
  },

  /**
   * Set up handlers for file accordions
   */
  _setupFileHandlers(container) {
    // File header click - toggle expand
    container.querySelectorAll('.hv-file-header').forEach(header => {
      header.addEventListener('click', () => {
        const filePath = header.dataset.filePath;
        this.toggleFile(filePath);
      });
    });

    // Version click - select
    container.querySelectorAll('.hv-version').forEach(version => {
      version.addEventListener('click', (e) => {
        if (e.target.closest('.hv-version-actions')) return;
        const filePath = version.dataset.filePath;
        const versionNum = parseInt(version.dataset.version, 10);
        this.selectVersion(filePath, versionNum);
      });
    });

    // View button
    container.querySelectorAll('.hv-view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const filePath = btn.dataset.filePath;
        const versionNum = parseInt(btn.dataset.version, 10);
        this.selectVersion(filePath, versionNum);
      });
    });

    // Restore button
    container.querySelectorAll('.hv-restore-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const filePath = btn.dataset.filePath;
        const versionNum = parseInt(btn.dataset.version, 10);
        this.showRestorePreview(filePath, versionNum);
      });
    });
  },

  /**
   * Toggle file accordion
   */
  toggleFile(filePath) {
    if (this._expandedFiles.has(filePath)) {
      this._expandedFiles.delete(filePath);
    } else {
      this._expandedFiles.add(filePath);
      // Request version history if not loaded
      const versionHistory = this._getVersionHistory();
      if (!versionHistory[filePath] || versionHistory[filePath].length === 0) {
        API.getVersionHistory(filePath);
      }
    }
    this.renderFileAccordions();
  },

  /**
   * Select and view a version
   */
  selectVersion(filePath, versionNumber) {
    this._selectedVersion = { filePath, versionNumber };
    this._restorePreview = null;

    // Update selection UI
    document.querySelectorAll('.hv-version').forEach(v => {
      v.classList.toggle('selected',
        v.dataset.filePath === filePath &&
        parseInt(v.dataset.version, 10) === versionNumber
      );
    });

    // Render the viewer
    this.renderViewer();
  },

  /**
   * Render the content viewer
   */
  renderViewer() {
    const container = document.getElementById('hv-viewer-panel');
    if (!container) return;

    if (this._restorePreview) {
      this.renderRestorePreview(container);
      return;
    }

    if (!this._selectedVersion) {
      container.innerHTML = `
        <div class="hv-viewer-placeholder">
          <div class="empty-state">
            <div class="empty-state-title">Select a version</div>
            <div class="empty-state-description">Click a file to expand, then click a version to view</div>
          </div>
        </div>
      `;
      return;
    }

    const { filePath, versionNumber } = this._selectedVersion;
    const versionHistory = this._getVersionHistory();
    const versions = versionHistory[filePath] || [];
    const version = versions.find(v => v.versionNumber === versionNumber);

    if (!version) {
      container.innerHTML = `
        <div class="hv-viewer-placeholder">
          <div class="empty-state">
            <div class="empty-state-title">Version not found</div>
          </div>
        </div>
      `;
      return;
    }

    const language = Utils.detectLanguage(filePath, version.content || '');
    const versionLabel = this._formatVersionLabel(version.versionNumber, version.timestamp);
    const prevVersion = versions.find(v => v.versionNumber === versionNumber - 1);

    container.innerHTML = `
      <div class="hv-viewer">
        <div class="hv-viewer-header">
          <div class="hv-viewer-title">
            <span class="hv-viewer-file">${Utils.escapeHtml(Utils.getFileName(filePath))}</span>
            <span class="hv-viewer-version">${versionLabel}</span>
          </div>
          <div class="hv-viewer-toggle">
            <button class="btn btn-xs ${this._viewMode === 'full' ? 'active' : ''}" data-mode="full">Full File</button>
            <button class="btn btn-xs ${this._viewMode === 'diff' ? 'active' : ''}" data-mode="diff" ${!prevVersion ? 'disabled' : ''}>Diff</button>
          </div>
        </div>
        <div class="hv-viewer-content">
          ${this._viewMode === 'full' || !prevVersion
            ? this._renderFullContent(version.content || '(No content)', language)
            : this._renderDiffContent(prevVersion.content || '', version.content || '', language)
          }
        </div>
      </div>
    `;

    this._setupViewerHandlers(container);
  },

  /**
   * Render full file content
   */
  _renderFullContent(content, language) {
    const lines = content.split('\n');
    const highlighted = Utils.highlightCode(content, language);
    const highlightedLines = highlighted.split('\n');

    return `
      <div class="hv-code-content">
        ${lines.map((line, idx) => `
          <div class="hv-code-line">
            <span class="hv-line-num">${idx + 1}</span>
            <span class="hv-line-content">${highlightedLines[idx] || ''}</span>
          </div>
        `).join('')}
      </div>
    `;
  },

  /**
   * Render diff content between two versions
   */
  _renderDiffContent(oldContent, newContent, language) {
    // Simple line-by-line diff
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const maxLines = Math.max(oldLines.length, newLines.length);

    let html = '<div class="hv-diff-content">';

    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === newLine) {
        // Context line
        html += `
          <div class="hv-diff-line context">
            <span class="hv-line-num">${i + 1}</span>
            <span class="hv-line-prefix"> </span>
            <span class="hv-line-content">${Utils.highlightCode(newLine || '', language)}</span>
          </div>
        `;
      } else if (oldLine !== undefined && newLine !== undefined) {
        // Modified line - show both
        html += `
          <div class="hv-diff-line removed">
            <span class="hv-line-num">${i + 1}</span>
            <span class="hv-line-prefix">-</span>
            <span class="hv-line-content">${Utils.highlightCode(oldLine, language)}</span>
          </div>
          <div class="hv-diff-line added">
            <span class="hv-line-num">${i + 1}</span>
            <span class="hv-line-prefix">+</span>
            <span class="hv-line-content">${Utils.highlightCode(newLine, language)}</span>
          </div>
        `;
      } else if (oldLine !== undefined) {
        // Removed line
        html += `
          <div class="hv-diff-line removed">
            <span class="hv-line-num">${i + 1}</span>
            <span class="hv-line-prefix">-</span>
            <span class="hv-line-content">${Utils.highlightCode(oldLine, language)}</span>
          </div>
        `;
      } else {
        // Added line
        html += `
          <div class="hv-diff-line added">
            <span class="hv-line-num">${i + 1}</span>
            <span class="hv-line-prefix">+</span>
            <span class="hv-line-content">${Utils.highlightCode(newLine, language)}</span>
          </div>
        `;
      }
    }

    html += '</div>';
    return html;
  },

  /**
   * Set up viewer handlers
   */
  _setupViewerHandlers(container) {
    container.querySelectorAll('.hv-viewer-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this._viewMode = btn.dataset.mode;
        this.renderViewer();
      });
    });
  },

  /**
   * Show restore preview
   */
  showRestorePreview(filePath, versionNumber) {
    const versionHistory = this._getVersionHistory();
    const versions = versionHistory[filePath] || [];
    const version = versions.find(v => v.versionNumber === versionNumber);
    const currentVersion = versions[0];

    if (!version || !currentVersion) return;

    this._restorePreview = {
      filePath,
      versionNumber,
      version,
      currentVersion
    };

    this.renderViewer();
  },

  /**
   * Render restore preview
   */
  renderRestorePreview(container) {
    const { filePath, versionNumber, version, currentVersion } = this._restorePreview;
    const language = Utils.detectLanguage(filePath, version.content || '');
    const versionLabel = this._formatVersionLabel(versionNumber, version.timestamp);

    container.innerHTML = `
      <div class="hv-restore-preview">
        <div class="hv-restore-header">
          <div class="hv-restore-title">
            <span class="hv-restore-icon">&#9888;</span>
            <span>Restore ${Utils.escapeHtml(Utils.getFileName(filePath))} to ${versionLabel}?</span>
          </div>
          <div class="hv-restore-warning">
            This will overwrite the current file. Changes shown below will be applied.
          </div>
        </div>
        <div class="hv-restore-diff">
          ${this._renderDiffContent(currentVersion.content || '', version.content || '', language)}
        </div>
        <div class="hv-restore-actions">
          <button class="btn btn-secondary hv-restore-cancel">Cancel</button>
          <button class="btn btn-warning hv-restore-confirm">Restore Version</button>
        </div>
      </div>
    `;

    // Set up handlers
    container.querySelector('.hv-restore-cancel')?.addEventListener('click', () => {
      this._restorePreview = null;
      this.renderViewer();
    });

    container.querySelector('.hv-restore-confirm')?.addEventListener('click', () => {
      API.restoreVersion(filePath, versionNumber);
      this._restorePreview = null;
      this._selectedVersion = null;
      this.renderViewer();
    });
  },

  /**
   * Handle version history response from API
   */
  handleVersionHistory(payload) {
    // Version history is stored in State by API.handleMessage
    // Just re-render
    this.renderFileAccordions();

    // If viewing this file, update the viewer
    if (this._selectedVersion?.filePath === payload.filePath) {
      this.renderViewer();
    }
  }
};

// Register with Router if available
if (typeof Router !== 'undefined' && Router.register) {
  Router.register('history', HistoryView);
}

// Export to window for global access
window.HistoryView = HistoryView;

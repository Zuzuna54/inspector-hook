# Phase 3: UI Development

**Duration**: 2 weeks
**Goal**: Implement full webview UI with all views and interactions

---

## Objectives

1. Design and implement modular UI architecture
2. Create all main views (Dashboard, Logs, Sessions, File Changes, History, Archived)
3. Implement diff viewer with syntax highlighting
4. Add real-time updates via message passing
5. Ensure UI is portable across IDEs (vanilla HTML/CSS/JS)

---

## UI Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           WEBVIEW UI                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        HEADER BAR                                │   │
│  │  [Status: Connected]  [Stats]  [Search]  [Export] [Clear]       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                         TAB BAR                                  │   │
│  │  [Dashboard] [Logs] [Sessions] [File Changes] [History] [Archive]│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                       CONTENT AREA                               │   │
│  │  ┌─────────────┐  ┌───────────────────────────────────────────┐ │   │
│  │  │  SIDEBAR    │  │              MAIN PANEL                    │ │   │
│  │  │  (filters,  │  │  (view-specific content)                   │ │   │
│  │  │   lists)    │  │                                            │ │   │
│  │  │             │  │                                            │ │   │
│  │  └─────────────┘  └───────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
packages/vscode/media/
├── index.html              # Main HTML template
├── styles/
│   ├── main.css           # Main stylesheet
│   ├── variables.css      # CSS custom properties
│   ├── layout.css         # Layout styles
│   ├── components.css     # Reusable components
│   └── views/
│       ├── dashboard.css
│       ├── logs.css
│       ├── sessions.css
│       ├── file-changes.css
│       ├── history.css
│       └── archived.css
└── scripts/
    ├── main.js            # Entry point
    ├── state.js           # State management
    ├── router.js          # View routing
    ├── api.js             # Communication with extension
    └── views/
        ├── dashboard.js
        ├── logs.js
        ├── sessions.js
        ├── file-changes.js
        ├── history.js
        └── archived.js
```

---

## Deliverables

### 1. State Management

**scripts/state.js**
```javascript
// Centralized state management
const State = {
  // Connection
  connected: false,
  port: null,

  // Data
  logs: [],
  sessions: [],
  fileChanges: [],
  archivedChanges: [],
  versionHistory: {},

  // UI State
  currentView: 'dashboard',
  selectedSession: null,
  selectedChange: null,
  searchQuery: '',
  filters: {
    level: null,
    hook: null,
    session: null
  },

  // Stats
  stats: {
    totalLogs: 0,
    errors: 0,
    warnings: 0,
    blocked: 0
  },

  // Listeners
  _listeners: new Map(),

  subscribe(key, callback) {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    this._listeners.get(key).add(callback);
    return () => this._listeners.get(key).delete(callback);
  },

  update(key, value) {
    this[key] = value;
    if (this._listeners.has(key)) {
      this._listeners.get(key).forEach(cb => cb(value));
    }
  }
};
```

### 2. API Communication

**scripts/api.js**
```javascript
// Communication with VS Code extension
const API = {
  vscode: typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null,

  send(command, data = {}) {
    if (this.vscode) {
      this.vscode.postMessage({ command, ...data });
    }
  },

  // Requests
  getLogs: () => API.send('getLogs'),
  getSessions: () => API.send('getSessions'),
  getFileChanges: () => API.send('getFileChanges'),
  getDiff: (changeId) => API.send('getDiff', { changeId }),
  keepChange: (changeId) => API.send('keepChange', { changeId }),
  revertChange: (changeId) => API.send('revertChange', { changeId }),
  getVersionHistory: (filePath) => API.send('getVersionHistory', { filePath }),
  getArchivedChanges: () => API.send('getArchivedChanges'),

  // Message handler
  handleMessage(event) {
    const { type, ...data } = event.data;

    switch (type) {
      case 'connected':
        State.update('connected', true);
        State.update('port', data.port);
        break;
      case 'logs':
        State.update('logs', data.logs);
        break;
      case 'sessions':
        State.update('sessions', data.sessions);
        break;
      case 'fileChanges':
        State.update('fileChanges', data.changes);
        break;
      case 'diff':
        Views.fileChanges.showDiff(data.diff);
        break;
      case 'stats':
        State.update('stats', data.stats);
        break;
      case 'archived':
        State.update('archivedChanges', data.changes);
        break;
    }
  }
};

window.addEventListener('message', API.handleMessage);
```

### 3. Router

**scripts/router.js**
```javascript
const Router = {
  views: {},

  register(name, view) {
    this.views[name] = view;
  },

  navigate(viewName) {
    // Update state
    State.update('currentView', viewName);

    // Update tab UI
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.view === viewName);
    });

    // Show/hide views
    document.querySelectorAll('.view').forEach(view => {
      view.classList.toggle('hidden', view.id !== `view-${viewName}`);
    });

    // Initialize view
    if (this.views[viewName]?.init) {
      this.views[viewName].init();
    }
  }
};
```

### 4. Dashboard View

**scripts/views/dashboard.js**
```javascript
const DashboardView = {
  init() {
    this.render();
    State.subscribe('stats', () => this.render());
    State.subscribe('logs', () => this.renderRecentActivity());
  },

  render() {
    const { stats } = State;
    const container = document.getElementById('dashboard-stats');

    container.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${stats.totalLogs}</div>
        <div class="stat-label">Total Logs</div>
      </div>
      <div class="stat-card error">
        <div class="stat-value">${stats.errors}</div>
        <div class="stat-label">Errors</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-value">${stats.warnings}</div>
        <div class="stat-label">Warnings</div>
      </div>
      <div class="stat-card blocked">
        <div class="stat-value">${stats.blocked}</div>
        <div class="stat-label">Blocked</div>
      </div>
    `;
  },

  renderRecentActivity() {
    const recentLogs = State.logs.slice(0, 10);
    const container = document.getElementById('recent-activity');

    container.innerHTML = recentLogs.map(log => `
      <div class="activity-item ${log.level}">
        <span class="activity-time">${this.formatTime(log.timestamp)}</span>
        <span class="activity-hook">${log.hook}</span>
        <span class="activity-message">${log.message}</span>
      </div>
    `).join('');
  },

  formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString();
  }
};

Router.register('dashboard', DashboardView);
```

### 5. File Changes View

**scripts/views/file-changes.js**
```javascript
const FileChangesView = {
  currentDiff: null,

  init() {
    API.getFileChanges();
    State.subscribe('fileChanges', () => this.renderList());
  },

  renderList() {
    const changes = State.fileChanges;
    const list = document.getElementById('changes-list');

    list.innerHTML = changes.map(change => `
      <div class="change-item ${change.status}" data-id="${change.id}">
        <div class="change-file">${this.getFileName(change.filePath)}</div>
        <div class="change-path">${change.filePath}</div>
        <div class="change-time">${this.formatTime(change.timestamp)}</div>
        <div class="change-actions">
          <button class="btn-keep" onclick="FileChangesView.keep('${change.id}')">Keep</button>
          <button class="btn-revert" onclick="FileChangesView.revert('${change.id}')">Revert</button>
        </div>
      </div>
    `).join('');

    // Add click handlers
    list.querySelectorAll('.change-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.matches('button')) {
          this.selectChange(item.dataset.id);
        }
      });
    });
  },

  selectChange(id) {
    State.update('selectedChange', id);
    API.getDiff(id);

    // Update selection UI
    document.querySelectorAll('.change-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.id === id);
    });
  },

  showDiff(diff) {
    this.currentDiff = diff;
    const viewer = document.getElementById('diff-viewer');

    viewer.innerHTML = `
      <div class="diff-header">
        <div class="diff-stats">
          <span class="additions">+${diff.additions}</span>
          <span class="deletions">-${diff.deletions}</span>
        </div>
        <div class="diff-tabs">
          <button class="tab active" data-view="diff">Diff</button>
          <button class="tab" data-view="before">Before</button>
          <button class="tab" data-view="after">After</button>
        </div>
      </div>
      <div class="diff-content">
        ${this.renderDiffContent(diff)}
      </div>
    `;

    // Tab handlers
    viewer.querySelectorAll('.diff-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.switchDiffView(tab.dataset.view);
      });
    });
  },

  renderDiffContent(diff) {
    return diff.hunks.map(hunk => `
      <div class="diff-hunk">
        <div class="hunk-header">
          @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@
        </div>
        ${hunk.lines.map(line => `
          <div class="diff-line ${line.type}">
            <span class="line-number">${line.lineNumber}</span>
            <span class="line-prefix">${line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</span>
            <span class="line-content">${this.escapeHtml(line.content)}</span>
          </div>
        `).join('')}
      </div>
    `).join('');
  },

  switchDiffView(view) {
    const container = document.querySelector('.diff-content');
    const tabs = document.querySelectorAll('.diff-tabs .tab');

    tabs.forEach(t => t.classList.toggle('active', t.dataset.view === view));

    switch (view) {
      case 'diff':
        container.innerHTML = this.renderDiffContent(this.currentDiff);
        break;
      case 'before':
        container.innerHTML = `<pre class="file-content">${this.escapeHtml(this.currentDiff.beforeContent)}</pre>`;
        break;
      case 'after':
        container.innerHTML = `<pre class="file-content">${this.escapeHtml(this.currentDiff.afterContent)}</pre>`;
        break;
    }
  },

  keep(id) {
    API.keepChange(id);
  },

  revert(id) {
    API.revertChange(id);
  },

  getFileName(path) {
    return path.split('/').pop();
  },

  formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString();
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

Router.register('file-changes', FileChangesView);
```

### 6. CSS Design System

**styles/variables.css**
```css
:root {
  /* Colors - VS Code compatible */
  --bg-primary: var(--vscode-editor-background, #1e1e1e);
  --bg-secondary: var(--vscode-sideBar-background, #252526);
  --bg-tertiary: var(--vscode-editorWidget-background, #2d2d2d);

  --fg-primary: var(--vscode-editor-foreground, #d4d4d4);
  --fg-secondary: var(--vscode-descriptionForeground, #858585);
  --fg-muted: var(--vscode-disabledForeground, #6e6e6e);

  --border: var(--vscode-panel-border, #3c3c3c);
  --accent: var(--vscode-focusBorder, #007acc);

  /* Status colors */
  --color-error: var(--vscode-errorForeground, #f44747);
  --color-warning: var(--vscode-editorWarning-foreground, #cca700);
  --color-success: var(--vscode-testing-iconPassed, #73c991);
  --color-info: var(--vscode-editorInfo-foreground, #3794ff);

  /* Diff colors */
  --diff-added-bg: rgba(35, 134, 54, 0.2);
  --diff-added-fg: #3fb950;
  --diff-removed-bg: rgba(248, 81, 73, 0.2);
  --diff-removed-fg: #f85149;

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
  --spacing-xl: 24px;

  /* Typography */
  --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
  --font-family-mono: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
  --font-size: var(--vscode-font-size, 13px);
  --font-size-sm: 11px;
  --font-size-lg: 16px;

  /* Borders */
  --radius-sm: 3px;
  --radius-md: 6px;

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 200ms ease;
}
```

**styles/components.css**
```css
/* Buttons */
.btn {
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--fg-primary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: background var(--transition-fast);
}

.btn:hover {
  background: var(--bg-tertiary);
}

.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

.btn-danger {
  background: var(--color-error);
  border-color: var(--color-error);
  color: white;
}

/* Tabs */
.tab-bar {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
}

.tab {
  padding: var(--spacing-sm) var(--spacing-lg);
  border: none;
  background: transparent;
  color: var(--fg-secondary);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all var(--transition-fast);
}

.tab:hover {
  color: var(--fg-primary);
}

.tab.active {
  color: var(--fg-primary);
  border-bottom-color: var(--accent);
}

/* Cards */
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
}

/* Lists */
.list-item {
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.list-item:hover {
  background: var(--bg-tertiary);
}

.list-item.selected {
  background: var(--bg-tertiary);
  border-left: 2px solid var(--accent);
}

/* Diff */
.diff-line {
  display: flex;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.diff-line.added {
  background: var(--diff-added-bg);
}

.diff-line.removed {
  background: var(--diff-removed-bg);
}

.diff-line .line-number {
  width: 50px;
  text-align: right;
  padding-right: var(--spacing-sm);
  color: var(--fg-muted);
  user-select: none;
}

.diff-line .line-prefix {
  width: 20px;
  text-align: center;
}

.diff-line.added .line-prefix {
  color: var(--diff-added-fg);
}

.diff-line.removed .line-prefix {
  color: var(--diff-removed-fg);
}
```

---

## Tasks

### Task 3.1: Set Up UI Architecture
- [ ] Create file structure
- [ ] Set up CSS variables
- [ ] Create main HTML template
- [ ] Implement state management
- [ ] Implement router

### Task 3.2: Implement Dashboard View
- [ ] Create stat cards
- [ ] Add recent activity feed
- [ ] Add session overview
- [ ] Implement auto-refresh

### Task 3.3: Implement Logs View
- [ ] Create log table with virtual scrolling
- [ ] Add filtering by level/hook/session
- [ ] Add search functionality
- [ ] Add log detail panel

### Task 3.4: Implement Sessions View
- [ ] Create sessions list
- [ ] Add tool execution timeline
- [ ] Show session details
- [ ] Display file changes per session

### Task 3.5: Implement File Changes View
- [ ] Create changes list
- [ ] Implement diff viewer
- [ ] Add before/after tabs
- [ ] Implement keep/revert buttons
- [ ] Add batch operations

### Task 3.6: Implement History View
- [ ] Create tracked files list
- [ ] Implement version timeline
- [ ] Add version comparison
- [ ] Implement restore functionality

### Task 3.7: Implement Archived View
- [ ] Create archived changes list
- [ ] Show archived diffs
- [ ] Implement restore from archive

### Task 3.8: Polish & Testing
- [ ] Test all views
- [ ] Fix styling issues
- [ ] Optimize performance
- [ ] Test with large datasets

---

## Acceptance Criteria

1. **All views render correctly**
2. **Real-time updates work**
3. **Diff viewer shows accurate diffs**
4. **Keep/Revert operations work**
5. **UI responds within 100ms**
6. **No JavaScript errors**
7. **Works in light and dark themes**

---

## Success Metrics

- [ ] All 6 views implemented
- [ ] < 50ms render time for lists
- [ ] < 100ms response to interactions
- [ ] Works with 10,000+ logs
- [ ] Zero console errors

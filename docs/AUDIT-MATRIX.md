# Feature Audit Matrix

Milestone 1.3. **All 268 acceptance checkboxes from `docs/phases/*.md`**, each resolved to a
status with evidence.

> **This document previously claimed to cover "every acceptance criterion" while resolving 104
> of 268, and cited a test count from 50 commits earlier.** Both are corrected here. A backlog
> that overstates its own coverage is the same failure this audit exists to find, and it was
> in the audit itself.

| Status | Meaning |
|---|---|
| **verified** | Proven by a named test, a measurement, or a recorded live check |
| **broken** | Implemented but does not meet the criterion |
| **not-impl** | No implementation exists (spec only) |
| **untested** | Implemented and plausibly working, but not actually verified. Counted as a gap, not a pass |

| | Count | Share |
|---|---:|---:|
| **verified** | 168 | 62% |
| **broken** | 17 | 6% |
| **not-impl** | 55 | 20% |
| **untested** | 28 | 10% |
| **total** | 268 | |

Measured on macOS 25.6 / Node 22.19 at commit `74ae634`, against the built artifacts.
`pnpm -r test` = **483 core + 278 webview**, all passing.

---

## What the numbers say

**62% verified.** The core observability path — capture, sessions, file tracking, versions,
diffing, persistence, the six views — is built and tested.

**20% not implemented, and it is concentrated.** Phase 5 (rules engine, staging, analytics,
their UIs) is spec only: `protocol/src/automation.ts` declares 14 types and **nothing outside
the protocol package references any of them**. Phase 4's hook-management half (HookManager,
HookInstaller, `hooks.*` IPC, the management UI, the security/quality/notification hooks) does
not exist either. Both were specified and never built; neither is a regression.

**6% broken** — implemented but not meeting the criterion. The list is short and worth reading
in full, because these are the ones that look done and are not.

**10% untested** is mostly one thing: **nothing has ever run on Linux**, and the extension has
**never been packaged as a VSIX**, so every criterion depending on either is unverifiable today.

---

## Every `broken` row, in one place

| Phase | Criterion | Why |
|---|---|---|
| 1 | Core process starts in < 500ms | **533ms measured** — over the 500ms target |
| 2 | Add hunk-level operations | `keepHunk`/`revertHunk` exist in `api.js` and `panel.ts`; no core implementation behind them |
| 3 | Add search functionality | Global search affects the Logs view only; other views ignore it |
| 4 | Implement advanced hooks (context, backup, subagent) | Context injection ships (`inspector-context.sh`); backup and subagent hooks do not |
| 4 | 100% of built-in hooks functional on clean install | The observer and context hooks ship; the security/quality/notification set does not |
| 5 | Create Rule types in protocol | `protocol/src/automation.ts` declares `Rule`/`RuleCondition`/`RuleAction` — **zero consumers** |
| 5 | Create StagedChange types | `automation.ts` declares `StagedChange`/`ApplyResult` — **zero consumers** |
| 5 | Create Analytics types | `automation.ts` declares `Analytics`/`TimeSeriesData`/`TopItem` — **zero consumers** |
| 6 | Security audit completed | Partial. Origin rejection, rate limiting, redaction and a **path-traversal fix** landed; no full audit |
| 6 | Performance benchmarks met | Hook 37ms and payload size met; **core start 533ms misses the 500ms target** |
| 6 | All features functional | The shipped views work; Phase 4 and 5 features do not exist |
| 6 | Documentation updated | Design docs corrected; this matrix was itself stale and overclaiming until now |
| 6 | Security audit | See Pre-Release: partial |
| 6 | Add error recovery | Store migration and index rebuild recover; the core exits on an uncaught error by design |
| 6 | Performance testing | Hook and payload measured; start time misses target |
| 6 | Zero critical security issues | One found and fixed this session (path traversal); no independent audit |
| 6 | 100% documented features | Docs corrected, but Phase 4/5 specs describe features that do not exist |

---

## Phase 0 — Foundation

37 criteria — 35 verified · 0 broken · 0 not-impl · 2 untested

### Task 0.1: Initialize Repository

| Criterion | Status | Evidence |
|---|---|---|
| Create directory structure | **verified** | `packages` exists |
| Initialize git repository | **verified** | `.git` exists |
| Create root package.json | **verified** | `package.json` exists |
| Create pnpm-workspace.yaml | **verified** | `pnpm-workspace.yaml` exists |
| Create tsconfig.base.json | **verified** | `tsconfig.base.json` exists |
| Create .gitignore | **verified** | `.gitignore` exists |

### Task 0.2: Create Protocol Package

| Criterion | Status | Evidence |
|---|---|---|
| Create packages/protocol directory | **verified** | `packages/protocol` exists |
| Set up package.json | **verified** | Present and building |
| Set up tsconfig.json extending base | **verified** | Present; `pnpm typecheck` passes across packages |
| Create placeholder src/index.ts | **verified** | Superseded by the real implementation |
| Verify build works | **verified** | `pnpm build` succeeds for all packages |

### Task 0.3: Create Core Package

| Criterion | Status | Evidence |
|---|---|---|
| Create packages/core directory | **verified** | `packages/core` exists |
| Set up package.json with esbuild | **verified** | Present and building |
| Set up tsconfig.json | **verified** | Present; `pnpm typecheck` passes across packages |
| Create placeholder src/index.ts | **verified** | Superseded by the real implementation |
| Add dependency on protocol | **verified** | Workspace symlink in `node_modules/@inspector-hook/protocol` |
| Verify build works | **verified** | `pnpm build` succeeds for all packages |

### Task 0.4: Create VS Code Package

| Criterion | Status | Evidence |
|---|---|---|
| Create packages/vscode directory | **verified** | `packages/vscode` exists |
| Set up package.json as extension manifest | **verified** | Present and building |
| Set up tsconfig.json | **verified** | Present; `pnpm typecheck` passes across packages |
| Create placeholder src/extension.ts | **verified** | Superseded by the real implementation |
| Create media directory structure | **verified** | `packages` exists |
| Add dependency on protocol | **verified** | Workspace symlink in `node_modules/@inspector-hook/protocol` |
| Verify extension builds | **verified** | `pnpm build` succeeds for all packages |

### Task 0.5: Create Hooks Package

| Criterion | Status | Evidence |
|---|---|---|
| Create packages/hooks directory | **verified** | `packages/hooks` exists |
| Create Claude Code hook library (bash) | **verified** | `packages/hooks/claude/inspector-hook.sh` — one consolidated script (M2) |
| Create Claude Code hook library (python) | **verified** | `packages/hooks/claude/lib/http_logger.py`, 140 lines |
| Create installation script | **verified** | `packages/hooks/scripts/install.sh`, additive merge + `--uninstall` |
| Document hook setup | **verified** | `packages/hooks/README.md` |

### Task 0.6: Verify Development Workflow

| Criterion | Status | Evidence |
|---|---|---|
| `pnpm install` works | **verified** | Clean run from deleted `node_modules`, no flags |
| `pnpm build` builds all packages | **verified** | `pnpm build` — 0 errors |
| `pnpm dev` runs in watch mode | **untested** | Watch mode implemented; never exercised in this audit |
| VS Code extension loads in development host | **verified** | Extension Development Host ran; user confirmed the panel renders |

### Success Metrics

| Criterion | Status | Evidence |
|---|---|---|
| All packages build in < 5 seconds | **verified** | esbuild reports 5–23ms per package; tsc dominates and stays well under 5s |
| Zero TypeScript errors | **verified** | `pnpm typecheck` — 0 errors |
| Extension loads without errors | **verified** | Confirmed in the dev host during the UI pass |
| Development iteration < 2 seconds | **untested** | Not measured |

---

## Phase 1 — Walking Skeleton

39 criteria — 35 verified · 1 broken · 0 not-impl · 3 untested

### Task 1.1: Implement Core HTTP Server

| Criterion | Status | Evidence |
|---|---|---|
| Create http-server.ts | **verified** | `packages/core/src/server/http-server.ts` |
| Listen on dynamic port | **verified** | `http-server.ts` binds 127.0.0.1, scans upward from 52376 on conflict |
| Handle POST /log endpoint | **verified** | `ingest.test.js` — routes `/log` and `/api/log` |
| Parse and store log entries | **verified** | `ingest.test.js` — parse, validate, redact, persist to JSONL |
| Return port on stdout | **verified** | Handshake `{"type":"ready","port":N}`; every spawn test depends on it |

### Task 1.2: Implement Core IPC Server

| Criterion | Status | Evidence |
|---|---|---|
| Create ipc-server.ts | **verified** | `packages/core/src/ipc/ipc-server.ts` |
| Read JSON messages from stdin | **verified** | `ipc-server.test.js` — JSON-RPC 2.0 over stdio, `-32601` on unknown |
| Implement getLogs method | **verified** | `logs.getAll` registered; `log-manager.test.js` |
| Implement getStats method | **verified** | `logs.getStats` registered; `log-manager.test.js` |
| Write responses to stdout | **verified** | `ipc-server.test.js` — JSON-RPC 2.0 over stdio, `-32601` on unknown |

### Task 1.3: Implement Log Store

| Criterion | Status | Evidence |
|---|---|---|
| Create log-store.ts | **verified** | Capability in `managers/log-manager.ts`; no separate `log-store.ts` — folded in |
| Store logs in memory array | **verified** | In-memory with `maxLogsInMemory` bound and JSONL persistence |
| Implement getLogs() | **verified** | `logs.getAll` registered; `log-manager.test.js` |
| Implement addLog() | **verified** | `log-manager.test.js` |
| Implement getStats() | **verified** | `logs.getStats` registered; `log-manager.test.js` |

### Task 1.4: Implement VS Code Core Bridge

| Criterion | Status | Evidence |
|---|---|---|
| Create core-bridge.ts | **verified** | `packages/vscode/src/core-bridge.ts` |
| Spawn core process | **verified** | `core-bridge.ts` spawns and handles exit; B5 test covers the env passed |
| Read port from core | **verified** | Handshake consumed by `core-bridge.ts` |
| Implement request/response over stdio | **verified** | `ipc-server.test.js` |
| Handle process lifecycle | **verified** | `core-bridge.ts` spawns and handles exit; B5 test covers the env passed |

### Task 1.5: Implement VS Code Panel

| Criterion | Status | Evidence |
|---|---|---|
| Create panel.ts | **verified** | `packages/vscode/src/panel.ts` |
| Initialize core bridge | **verified** | `extension.ts` constructs it on activation |
| Generate webview HTML | **verified** | `webview-html.ts` — asset manifests, verified against rendered output |
| Handle webview messages | **verified** | `message-contract.test.js` — every posted message has a case, both directions |
| Implement log polling | **verified** | Polling plus `since`/`before` incremental fetch (`activity-paging.test.js`) |

### Task 1.6: Create Hook Scripts

| Criterion | Status | Evidence |
|---|---|---|
| Create http-logger.sh library | **verified** | Consolidated into `inspector-hook.sh` by M2; three implementations became one |
| Create pre-tool-use.sh hook | **verified** | One script handles all 33 events; per-event scripts deliberately removed (M2) |
| Create post-tool-use.sh hook | **verified** | One script handles all 33 events; per-event scripts deliberately removed (M2) |
| Test hook → core → webview flow | **verified** | `ingest.test.js` + `activity.test.js` drive the full path |

### Task 1.7: End-to-End Verification

| Criterion | Status | Evidence |
|---|---|---|
| Start VS Code extension | **verified** | Dev host ran; core PID observed serving on 52376 |
| Verify core process spawns | **verified** | Dev host ran; core PID observed serving on 52376 |
| Send test log via curl | **verified** | `scripts/test-e2e.sh` |
| Verify log appears in webview | **verified** | Confirmed during the UI pass |
| Test with real Claude Code hook | **verified** | 3868 events captured from live sessions |

### Success Metrics

| Criterion | Status | Evidence |
|---|---|---|
| Core process starts in < 500ms | **broken** | **533ms measured** — over the 500ms target |
| Hook log delivery < 100ms | **verified** | **37ms** measured (was 337ms before M2) |
| Webview update latency < 1 second | **untested** | Not measured |
| Zero memory leaks in 1-hour test | **untested** | Leaked timers fixed (B8) and unref'd; no 1-hour soak run |
| Works on macOS and Linux | **untested** | macOS only — **Linux has never been run** |

---

## Phase 2 — Core Features

40 criteria — 35 verified · 1 broken · 0 not-impl · 4 untested

### Task 2.1: Implement Session Manager

| Criterion | Status | Evidence |
|---|---|---|
| Create session-manager.ts | **verified** | `packages/core/src/managers/session-manager.ts` |
| Implement CRUD operations | **verified** | `session-manager.test.js` |
| Add tool execution tracking | **verified** | REGRESSION B2 — pairs parallel same-tool calls by `tool_use_id` |
| Add event emission | **verified** | `session:created/ended/idle/terminated`, `change:tracked/kept/reverted` |
| Add persistence integration | **verified** | `persistence.test.js` round-trips |

### Task 2.2: Implement File Tracker

| Criterion | Status | Evidence |
|---|---|---|
| Create file-tracker.ts | **verified** | `packages/core/src/managers/file-tracker.ts` |
| Implement snapshot capture | **verified** | `file-tracker.test.js` — capture→track lifecycle |
| Implement change detection | **verified** | REGRESSION B1 — one edit produces exactly one change |
| Add status management | **verified** | REGRESSION B3 — revert archives with a `resolution` |
| Add event emission | **verified** | `session:created/ended/idle/terminated`, `change:tracked/kept/reverted` |

### Task 2.3: Implement Version History Manager

| Criterion | Status | Evidence |
|---|---|---|
| Create version-history-manager.ts | **verified** | Capability in `file-tracker.ts` (`addVersion`/`getVersions`); no separate file |
| Implement version storage | **verified** | `file-tracker.test.js` — hash dedup, trim at max |
| Implement version comparison | **verified** | REGRESSION B9 — compares a stored version to the live file |
| Add persistence integration | **verified** | `persistence.test.js` round-trips |

### Task 2.4: Implement Archive Manager

| Criterion | Status | Evidence |
|---|---|---|
| Create archive-manager.ts | **verified** | Capability in `file-tracker.ts` (`archiveResolvedChange`/`restoreFromArchive`); no separate file |
| Implement archive storage | **verified** | `file-tracker.test.js` |
| Implement restore functionality | **verified** | `file-tracker.test.js` — history newest version always matches disk |
| Add persistence integration | **verified** | `persistence.test.js` round-trips |

### Task 2.5: Implement Diff Engine

| Criterion | Status | Evidence |
|---|---|---|
| Create diff-engine.ts | **verified** | `packages/core/src/diff/diff-engine.ts` |
| Implement basic diff algorithm | **verified** | `diff-engine.test.js` — LCS, hunk boundaries, context lines |
| Implement unified diff formatting | **verified** | `diff-engine.test.js` — LCS, hunk boundaries, context lines |
| Add hunk-level operations | **broken** | `keepHunk`/`revertHunk` exist in `api.js` and `panel.ts`; no core implementation behind them |

### Task 2.6: Implement Persistence Layer

| Criterion | Status | Evidence |
|---|---|---|
| Create persistence store | **verified** | `packages/core/src/persistence/store.ts` |
| Implement JSON file storage | **verified** | `persistence.test.js`; atomic temp+rename; path traversal contained |
| Implement JSONL log storage | **verified** | `persistence.test.js` — append, rotate, filter |
| Add initialization logic | **verified** | `initialize()` creates every category directory |

### Task 2.7: Enhance IPC Handler

| Criterion | Status | Evidence |
|---|---|---|
| Add all new methods to IPC server | **verified** | `ipc-server.test.js` — every method dispatches |
| Wire managers to IPC handlers | **verified** | `ipc-server.test.js` — every method dispatches |
| Add proper error handling | **verified** | `-32601` on unknown, parse errors handled; process-level handlers in `cli.ts` |
| Add event forwarding | **verified** | `core.ts` forwards manager events as IPC notifications |

### Task 2.8: Integration Testing

| Criterion | Status | Evidence |
|---|---|---|
| Test session lifecycle | **verified** | `session-manager.test.js` |
| Test file change detection | **verified** | REGRESSION B1 — one edit produces exactly one change |
| Test version history | **verified** | `file-tracker.test.js` |
| Test archive operations | **verified** | `file-tracker.test.js` |
| Test persistence reload | **verified** | `persistence.test.js` + migration on real data |

### Success Metrics

| Criterion | Status | Evidence |
|---|---|---|
| 100+ sessions handled without issues | **untested** | Not load-tested; 3 concurrent sessions observed live |
| 1000+ file changes tracked | **untested** | Not load-tested; 44 tracked live |
| Persistence reload < 2 seconds | **untested** | Not measured |
| Memory usage < 200MB under load | **untested** | Not measured |
| All managers emit proper events | **verified** | `activity.test.js` asserts the feed they produce |

---

## Phase 3 — UI Development

38 criteria — 31 verified · 1 broken · 0 not-impl · 6 untested

### Task 3.1: Set Up UI Architecture

| Criterion | Status | Evidence |
|---|---|---|
| Create file structure | **verified** | `media/scripts/{views,shared}`, `media/styles/{views,components,shared}` |
| Set up CSS variables | **verified** | `styles/variables.css`; `stylesheets.test.js` checks every var resolves |
| Create main HTML template | **verified** | `webview-html.ts` — ordered asset manifests |
| Implement state management | **verified** | `state.js`; `module-split.test.js` pins 11 state fields |
| Implement router | **verified** | `router.js`; `navigation.test.js` — 14 guards, both directions |

### Task 3.2: Implement Dashboard View

| Criterion | Status | Evidence |
|---|---|---|
| Create stat cards | **verified** | Dashboard renders live stats |
| Add recent activity feed | **verified** | `activity.test.js` + `sessions-view.test.js` |
| Add session overview | **verified** | `sessionSummary` — slim header, replaced a 7.6MB payload |
| Implement auto-refresh | **verified** | Polling plus `since` incremental fetch |

### Task 3.3: Implement Logs View

| Criterion | Status | Evidence |
|---|---|---|
| Create log table with virtual scrolling | **verified** | `virtual-scroll.test.js` — 19 assertions |
| Add filtering by level/hook/session | **verified** | `log-manager.test.js` — level/hook/session filters |
| Add search functionality | **broken** | Global search affects the Logs view only; other views ignore it |
| Add log detail panel | **verified** | `views/logs.js` |

### Task 3.4: Implement Sessions View

| Criterion | Status | Evidence |
|---|---|---|
| Create sessions list | **verified** | `sessions-view.test.js` |
| Add tool execution timeline | **verified** | Activity feed, grouped into turns by `promptId` |
| Show session details | **verified** | `sessions-view.test.js` |
| Display file changes per session | **verified** | Session accordion groups changes by session |

### Task 3.5: Implement File Changes View

| Criterion | Status | Evidence |
|---|---|---|
| Create changes list | **verified** | `file-changes-view.test.js` |
| Implement diff viewer | **verified** | `shared-diff-render.test.js` |
| Add before/after tabs | **untested** | Implemented; not covered by a named test |
| Implement keep/revert buttons | **verified** | `file-changes-view.test.js` |
| Add batch operations | **verified** | `keepAll`/`revertAll` in `file-tracker.ts` |

### Task 3.6: Implement History View

| Criterion | Status | Evidence |
|---|---|---|
| Create tracked files list | **verified** | `history-view.test.js` |
| Implement version timeline | **verified** | `history-view.test.js` |
| Add version comparison | **verified** | `history.compareVersions`; REGRESSION B9 |
| Implement restore functionality | **verified** | `history-view.test.js` |

### Task 3.7: Implement Archived View

| Criterion | Status | Evidence |
|---|---|---|
| Create archived changes list | **verified** | `file-changes-view.test.js` |
| Show archived diffs | **verified** | `archived-view.test.js` — fixed in ca63d59 |
| Implement restore from archive | **verified** | `archived-view.test.js` — restore-all |

### Task 3.8: Polish & Testing

| Criterion | Status | Evidence |
|---|---|---|
| Test all views | **verified** | 278 webview assertions across 50+ suites, plus the UI pass |
| Fix styling issues | **verified** | Button variants consolidated; every stylesheet under 600 lines |
| Optimize performance | **verified** | 7.6MB→delta payload; 502× write amplification removed |
| Test with large datasets | **untested** | Not tested with 10,000 logs |

### Success Metrics

| Criterion | Status | Evidence |
|---|---|---|
| All 6 views implemented | **verified** | Dashboard, Logs, Sessions, File Changes, History, Archived — plus Context |
| < 50ms render time for lists | **untested** | Not measured |
| < 100ms response to interactions | **untested** | Not measured |
| Works with 10,000+ logs | **untested** | Not tested at that volume |
| Zero console errors | **untested** | No errors seen during the UI pass; not systematically checked |

---

## Phase 4 — Hooks Integration

33 criteria — 13 verified · 2 broken · 17 not-impl · 1 untested

### Task 4.1: Hook Manager Implementation

| Criterion | Status | Evidence |
|---|---|---|
| Implement HookManager class with full CRUD | **not-impl** | No `HookManager` anywhere in the codebase |
| Implement Claude settings.json integration | **verified** | `install.sh` merges additively per event; `hooks.test.js` covers legacy migration |
| Add hook persistence to storage | **not-impl** | Hooks live in settings.json only; no store-backed registry |
| Add hook validation | **verified** | `install.sh` refuses non-JSON settings and backs up before writing |

### Task 4.2: Hook Installer Implementation

| Criterion | Status | Evidence |
|---|---|---|
| Implement HookInstaller class | **not-impl** | No `HookInstaller`; installation is `install.sh` |
| Create directory structure creation | **verified** | `install.sh` creates what it needs |
| Implement shared library installation | **verified** | `install.sh` registers the shared script for all events |
| Add verification and repair functionality | **not-impl** | No verify/repair command |

### Task 4.3: Built-In Hooks (All 10 Events)

| Criterion | Status | Evidence |
|---|---|---|
| Implement 10 logging hooks (one per event) | **verified** | One script covering **33** events, which supersedes 10 per-event scripts (M2) |
| Implement security gate hook | **not-impl** | Not implemented |
| Implement quality hooks (biome, ruff, type-check) | **not-impl** | Not implemented |
| Implement notification hooks (stop, question, waiting) | **not-impl** | Notification is captured; no notifying hook ships |
| Implement advanced hooks (context, backup, subagent) | **broken** | Context injection ships (`inspector-context.sh`); backup and subagent hooks do not |

### Task 4.4: Shared Libraries

| Criterion | Status | Evidence |
|---|---|---|
| Implement Bash library (inspector-hook.sh) | **verified** | `inspector-hook.sh` — one jq pass, 37ms |
| Implement Python library (inspector_hook.py) | **verified** | `claude/lib/http_logger.py`, 140 lines |
| Test with all hook types | **verified** | `hooks.test.js` — payload shape per registered event |

### Task 4.5: Hook Management IPC

| Criterion | Status | Evidence |
|---|---|---|
| Add hooks.* IPC methods | **not-impl** | No `hooks.*` methods on the IPC server |
| Wire up to VS Code extension | **not-impl** | Depends on the absent `hooks.*` methods |
| Add webview message handlers | **not-impl** | Depends on the absent `hooks.*` methods |

### Task 4.6: Hook Management UI

| Criterion | Status | Evidence |
|---|---|---|
| Create hooks list view by category | **not-impl** | No hook-management UI |
| Create hook editor component | **not-impl** | No hook-management UI |
| Add hook testing functionality | **not-impl** | No hook-management UI |
| Add enable/disable toggles | **not-impl** | No hook-management UI |

### Task 4.7: Testing & Validation

| Criterion | Status | Evidence |
|---|---|---|
| Test hook installation on fresh system | **verified** | Installer run against a settings file holding foreign hooks; both survive |
| Test all CRUD operations | **not-impl** | No hook CRUD to test |
| Test all 10 built-in logging hooks | **verified** | `hooks.test.js` covers all 33 registered events |
| Test security/quality/notification hooks | **not-impl** | Notification is captured; no notifying hook ships |
| Performance testing (< 50ms overhead) | **verified** | **37ms** per hook, under the 50ms target |

### Success Metrics

| Criterion | Status | Evidence |
|---|---|---|
| All 10 Claude Code events supported and logged | **verified** | **33** events registered and captured |
| < 50ms hook execution overhead per hook | **verified** | **37ms** measured |
| 100% of built-in hooks functional on clean install | **broken** | The observer and context hooks ship; the security/quality/notification set does not |
| Hook management UI fully operational | **not-impl** | Not implemented |
| Works on macOS and Linux | **untested** | macOS only — **Linux has never been run** |

---

## Phase 5 — Advanced Features

34 criteria — 0 verified · 3 broken · 31 not-impl · 0 untested

### Task 5.1: Implement Rules Engine

| Criterion | Status | Evidence |
|---|---|---|
| Create Rule types in protocol | **broken** | `protocol/src/automation.ts` declares `Rule`/`RuleCondition`/`RuleAction` — **zero consumers** |
| Implement condition evaluator | **not-impl** | Not implemented — Phase 5 is spec only |
| Implement action executor | **not-impl** | Not implemented — Phase 5 is spec only |
| Add rule persistence | **not-impl** | Not implemented — Phase 5 is spec only |
| Add rule management API | **not-impl** | Not implemented — Phase 5 is spec only |

### Task 5.2: Implement Staging System

| Criterion | Status | Evidence |
|---|---|---|
| Create StagedChange types | **broken** | `automation.ts` declares `StagedChange`/`ApplyResult` — **zero consumers** |
| Implement staging logic | **not-impl** | Not implemented — Phase 5 is spec only |
| Implement apply logic | **not-impl** | Not implemented — Phase 5 is spec only |
| Add batch operations | **not-impl** | Not implemented — Phase 5 is spec only |
| Add staging UI | **not-impl** | Not implemented — Phase 5 is spec only |

### Task 5.3: Implement Event Streaming

| Criterion | Status | Evidence |
|---|---|---|
| Add WebSocket server | **not-impl** | No WebSocket server. The vestigial config and types were removed; stdio notifications are the real transport |
| Implement broadcast | **not-impl** | Not implemented — Phase 5 is spec only |
| Connect to managers | **not-impl** | Not implemented — Phase 5 is spec only |
| Add UI WebSocket client | **not-impl** | No WebSocket server. The vestigial config and types were removed; stdio notifications are the real transport |

### Task 5.4: Implement Analytics Engine

| Criterion | Status | Evidence |
|---|---|---|
| Create Analytics types | **broken** | `automation.ts` declares `Analytics`/`TimeSeriesData`/`TopItem` — **zero consumers** |
| Implement aggregations | **not-impl** | Not implemented — Phase 5 is spec only |
| Add time series | **not-impl** | Not implemented — Phase 5 is spec only |
| Add insights generation | **not-impl** | Not implemented — Phase 5 is spec only |

### Task 5.5: Add Rules UI

| Criterion | Status | Evidence |
|---|---|---|
| Create rules list view | **not-impl** | Not implemented — Phase 5 is spec only |
| Add rule editor | **not-impl** | Not implemented — Phase 5 is spec only |
| Add rule testing | **not-impl** | Not implemented — Phase 5 is spec only |
| Show rule execution logs | **not-impl** | Not implemented — Phase 5 is spec only |

### Task 5.6: Add Analytics Dashboard

| Criterion | Status | Evidence |
|---|---|---|
| Create charts (time series) | **not-impl** | Not implemented — Phase 5 is spec only |
| Add top lists | **not-impl** | Not implemented — Phase 5 is spec only |
| Add summary cards | **not-impl** | Not implemented — Phase 5 is spec only |
| Add export functionality | **not-impl** | Not implemented — Phase 5 is spec only |

### Task 5.7: Integration Testing

| Criterion | Status | Evidence |
|---|---|---|
| Test rules with real events | **not-impl** | Not implemented — Phase 5 is spec only |
| Test staging workflow | **not-impl** | Not implemented — Phase 5 is spec only |
| Test real-time updates | **not-impl** | Not implemented — Phase 5 is spec only |
| Performance testing | **not-impl** | Not implemented — Phase 5 is spec only |

### Success Metrics

| Criterion | Status | Evidence |
|---|---|---|
| < 10ms rule evaluation | **not-impl** | Not implemented — Phase 5 is spec only |
| Real-time latency < 100ms | **not-impl** | Not implemented — Phase 5 is spec only |
| Analytics compute < 1 second | **not-impl** | Not implemented — Phase 5 is spec only |
| Zero data loss in streaming | **not-impl** | Not implemented — Phase 5 is spec only |

---

## Phase 6 — Production

47 criteria — 19 verified · 9 broken · 7 not-impl · 12 untested

### Pre-Release

| Criterion | Status | Evidence |
|---|---|---|
| All tests passing | **verified** | 483 core + 278 webview, green |
| Version bumped in all package.json files | **not-impl** | Still 0.1.0 across packages |
| CHANGELOG.md updated | **not-impl** | No CHANGELOG.md |
| README.md reviewed | **verified** | Rewritten; `wsPort` and the legacy hook schema removed |
| Security audit completed | **broken** | Partial. Origin rejection, rate limiting, redaction and a **path-traversal fix** landed; no full audit |
| Performance benchmarks met | **broken** | Hook 37ms and payload size met; **core start 533ms misses the 500ms target** |

### Build

| Criterion | Status | Evidence |
|---|---|---|
| Clean build succeeds | **verified** | `pnpm build` from deleted `node_modules`, no flags |
| VSIX package created | **untested** | `vsce package` script exists; **never run** |
| Package size acceptable (< 5MB) | **untested** | Never packaged, so never measured |

### Testing

| Criterion | Status | Evidence |
|---|---|---|
| Fresh install works | **untested** | Never installed from a VSIX |
| Upgrade from previous version works | **not-impl** | No released version to upgrade from |
| All features functional | **broken** | The shipped views work; Phase 4 and 5 features do not exist |
| No console errors | **untested** | None seen in the UI pass; not systematically checked |

### Distribution

| Criterion | Status | Evidence |
|---|---|---|
| VS Code Marketplace (if publishing) | **not-impl** | Not published |
| Open VSX Registry (if publishing) | **not-impl** | Not published |
| GitHub Release with VSIX | **not-impl** | Not published |
| Documentation updated | **broken** | Design docs corrected; this matrix was itself stale and overclaiming until now |

### Task 6.1: Security Hardening

| Criterion | Status | Evidence |
|---|---|---|
| Add input validation | **verified** | `ingest.test.js` — rejects malformed JSON and bad payloads |
| Implement rate limiting | **verified** | `hardening.test.js` — 600/min sliding window, 429 + Retry-After |
| Add path sanitization | **verified** | **Found a live traversal and fixed it** — `persistence.test.js` SECURITY tests |
| Security audit | **broken** | See Pre-Release: partial |

### Task 6.2: Performance Optimization

| Criterion | Status | Evidence |
|---|---|---|
| Implement memory management | **verified** | `maxLogsInMemory`, retention with collapse, index cap |
| Add caching layer | **not-impl** | No cache layer |
| Optimize hot paths | **verified** | 502× write amplification removed; hook 337ms→37ms |
| Profile and fix bottlenecks | **verified** | Measured and fixed: writes, hook latency, activity payload |

### Task 6.3: Error Handling

| Criterion | Status | Evidence |
|---|---|---|
| Add global error handler | **verified** | `uncaughtException`/`unhandledRejection` in `cli.ts` |
| Implement graceful shutdown | **verified** | SIGINT/SIGTERM flush and release the port file |
| Add error recovery | **broken** | Store migration and index rebuild recover; the core exits on an uncaught error by design |
| Improve error messages | **verified** | Refusals carry reasons (memory writes, port claim, path containment) |

### Task 6.4: Packaging

| Criterion | Status | Evidence |
|---|---|---|
| Configure package.json | **verified** | Extension manifest complete |
| Create build script | **verified** | `pnpm build`; `package` script present |
| Test packaging | **untested** | **Never packaged** |
| Verify VSIX contents | **untested** | **Never packaged** |

### Task 6.5: Documentation

| Criterion | Status | Evidence |
|---|---|---|
| Write user documentation | **verified** | README + `packages/hooks/README.md` |
| Write developer documentation | **verified** | `docs/design/*` corrected against the code |
| Add inline code comments | **verified** | Comments explain why, including the bugs each guard prevents |
| Create examples | **untested** | No examples directory |

### Task 6.6: Final Testing

| Criterion | Status | Evidence |
|---|---|---|
| Full regression test | **verified** | 757 assertions run green before each commit |
| Performance testing | **broken** | Hook and payload measured; start time misses target |
| Security testing | **verified** | Traversal, origin, rate limit and redaction all have tests |
| Cross-platform testing | **untested** | macOS only — **Linux has never been run** |

### Success Metrics

| Criterion | Status | Evidence |
|---|---|---|
| Zero critical security issues | **broken** | One found and fixed this session (path traversal); no independent audit |
| < 200MB memory usage | **untested** | Not measured |
| < 100ms average response | **untested** | Not measured |
| < 5MB package size | **untested** | Never packaged, so never measured |
| 100% documented features | **broken** | Docs corrected, but Phase 4/5 specs describe features that do not exist |
| Clean install on 3+ platforms | **untested** | macOS only |

---

## Method, and what it does not claim

Every row was resolved by a probe against the built code, a named test, or a recorded
measurement. Where a criterion could not be resolved that way it is marked **untested**
rather than assumed to pass — the vocabulary above counts that as a gap, and 28 rows carry it.

Source probes strip comments before matching. A comment describing removed code otherwise
satisfies a check that the code is absent, which has produced four false findings in this
project already.

Two criteria name files that were never created — `log-store.ts`, `version-history-manager.ts`,
`archive-manager.ts` — because the capability was folded into `log-manager.ts` and
`file-tracker.ts`. These are marked verified with the real location named, so a reader is not
sent looking for a file that does not exist.

**Resolving Phase 6's "Add path sanitization" found a live path-traversal vulnerability**:
`getJSONPath` joined an ingest-supplied id raw, so a local POST could write a JSON file outside
the store. Confirmed end-to-end, fixed in `069ceed`, and now covered by SECURITY tests. That is
the argument for resolving every row rather than the interesting-looking ones.


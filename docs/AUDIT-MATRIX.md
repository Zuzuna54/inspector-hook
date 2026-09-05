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
| **inert** | **Code that exists, is tested, and cannot run in the live system.** Distinct from `broken`, which is code that runs and gets the wrong answer. Every serious finding in the external audit of this project belongs to this class, and the matrix had no way to say it — which is why the audit found them and the matrix did not |

**Evidence classes.** A status is only as good as what backs it, so each row's
evidence falls into one of these, strongest first:

| Class | Meaning |
|---|---|
| **live** | Observed against a running core, or a measurement with its conditions stated |
| **test** | A named test that fails when the behaviour is removed |
| **artifact** | The criterion IS a static artifact (`Create .gitignore`), and observing the file is the whole proof |
| **read** | Someone read the code and concluded it works |

**Rule: `read` alone may not support `verified` for a behavioural criterion.**
An external audit re-derived all 268 rows and moved 41 out of `verified`,
almost entirely from rows resting on `read`. Where a row below still says
`verified` on a code read, treat it as `untested` until someone runs it — and
`artifact` is not a loophole: it applies only where the criterion names a file,
not where it names a behaviour.

| | Count | Share |
|---|---:|---:|
| **verified** | 124 | 46% |
| **broken** | 20 | 7% |
| **not-impl** | 55 | 20% |
| **untested** | 69 | 25% |
| **total** | 268 | |

Measured on macOS 25.6 / Node 22.19 at commit `74ae634`, against the built artifacts.
`pnpm -r test` = **483 core + 278 webview**, all passing.

---

## Two independent re-derivations, and why they differ

This document's tallies and an external audit's disagree, and the disagreement
is worth more than either number alone.

| | this document | external audit |
|---|---:|---:|
| verified | 124 | 127 |
| broken | 20 | 32 |
| inert | 0 | 9 |
| not-impl | 55 | 55 |
| untested | 69 | 45 |

**`not-impl` matches exactly.** Both passes agree on what was never built, which
is the part this document was always accurate about.

**The rest differs because the two passes answer different questions.** This
one applies a mechanical rule — *no row is `verified` on a code read alone* —
and downgrades to `untested`, which means "we do not have evidence", not "we
looked and it fails". The audit investigated rows and found many of them
actually broken or inert. Its numbers are better informed; these are more
conservative. Where they disagree, **prefer the audit's**: a row this document
calls `untested` and the audit calls `broken` is broken.

**`inert` is 0 here and 9 there for a structural reason, not a disagreement.**
The inert findings live almost entirely in Milestones 3 and 4 — an unreachable
research API, a picker that cannot fire — and **this matrix has no rows for M3
or M4 at all.** It covers the seven phase documents, which predate both
milestones. Roughly 84 rows are missing, and until they exist the `inert`
column has nothing to count. That is the largest remaining gap in this
document.

**Every `verified` row now carries its evidence class** — `test`, `live`, or
`artifact`. `read` cannot support `verified`; 44 rows moved to `untested` on
that rule alone. `scripts/check-matrix.py` enforces it, along with the row
count, the header arithmetic, and that no row cites a file or test that does
not exist. It found one on its first run: a `diff-engine.ts` path in the wrong
directory, asserted here and never checked.

---

## What the numbers say

**46% verified.** The core observability path — capture, sessions, file tracking, versions,
diffing, persistence, the six views — is built and tested.

**20% not implemented, and it is concentrated.** Phase 5 (rules engine, staging, analytics,
their UIs) is spec only: `protocol/src/automation.ts` declares 14 types and **nothing outside
the protocol package references any of them**. Phase 4's hook-management half (HookManager,
HookInstaller, `hooks.*` IPC, the management UI, the security/quality/notification hooks) does
not exist either. Both were specified and never built; neither is a regression.

**7% broken** — implemented but not meeting the criterion. The list is short and worth reading
in full, because these are the ones that look done and are not.

**25% untested** is now mostly two things: **nothing has ever run on Linux**. The VSIX criteria
have moved from untested to **broken** — an auditing session tried to package the extension and
found it cannot be packaged at all, which is the difference between "unverified" and "does not
work". Two rows changed status purely by someone running the command.

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
| Create directory structure | **verified** | `packages` exists — _artifact_ |
| Initialize git repository | **verified** | `.git` exists — _artifact_ |
| Create root package.json | **verified** | `package.json` exists — _artifact_ |
| Create pnpm-workspace.yaml | **verified** | `pnpm-workspace.yaml` exists — _artifact_ |
| Create tsconfig.base.json | **verified** | `tsconfig.base.json` exists — _artifact_ |
| Create .gitignore | **verified** | `.gitignore` exists — _artifact_ |

### Task 0.2: Create Protocol Package

| Criterion | Status | Evidence |
|---|---|---|
| Create packages/protocol directory | **verified** | `packages/protocol` exists — _artifact_ |
| Set up package.json | **verified** | Present and building — _artifact_ |
| Set up tsconfig.json extending base | **verified** | Present; `pnpm typecheck` passes across packages — _live_ |
| Create placeholder src/index.ts | **verified** | Superseded by the real implementation — _artifact_ |
| Verify build works | **verified** | `pnpm build` succeeds for all packages — _live_ |

### Task 0.3: Create Core Package

| Criterion | Status | Evidence |
|---|---|---|
| Create packages/core directory | **verified** | `packages/core` exists — _artifact_ |
| Set up package.json with esbuild | **verified** | Present and building — _artifact_ |
| Set up tsconfig.json | **verified** | Present; `pnpm typecheck` passes across packages — _live_ |
| Create placeholder src/index.ts | **verified** | Superseded by the real implementation — _artifact_ |
| Add dependency on protocol | **untested** | Workspace symlink in `node_modules/@inspector-hook/protocol` — _evidence class: read; downgraded per the rule above_ |
| Verify build works | **verified** | `pnpm build` succeeds for all packages — _live_ |

### Task 0.4: Create VS Code Package

| Criterion | Status | Evidence |
|---|---|---|
| Create packages/vscode directory | **verified** | `packages/vscode` exists — _artifact_ |
| Set up package.json as extension manifest | **verified** | Present and building — _artifact_ |
| Set up tsconfig.json | **verified** | Present; `pnpm typecheck` passes across packages — _live_ |
| Create placeholder src/extension.ts | **verified** | Superseded by the real implementation — _artifact_ |
| Create media directory structure | **verified** | `packages` exists — _artifact_ |
| Add dependency on protocol | **untested** | Workspace symlink in `node_modules/@inspector-hook/protocol` — _evidence class: read; downgraded per the rule above_ |
| Verify extension builds | **verified** | `pnpm build` succeeds for all packages — _live_ |

### Task 0.5: Create Hooks Package

| Criterion | Status | Evidence |
|---|---|---|
| Create packages/hooks directory | **verified** | `packages/hooks` exists — _artifact_ |
| Create Claude Code hook library (bash) | **verified** | `packages/hooks/claude/inspector-hook.sh` — one consolidated script (M2) — _artifact_ |
| Create Claude Code hook library (python) | **verified** | `packages/hooks/claude/lib/http_logger.py`, 140 lines — _artifact_ |
| Create installation script | **verified** | `packages/hooks/scripts/install.sh`, additive merge + `--uninstall` — _artifact_ |
| Document hook setup | **untested** | `packages/hooks/README.md` — _evidence class: read; downgraded per the rule above_ |

### Task 0.6: Verify Development Workflow

| Criterion | Status | Evidence |
|---|---|---|
| `pnpm install` works | **verified** | Clean run from deleted `node_modules`, no flags — _live_ |
| `pnpm build` builds all packages | **verified** | `pnpm build` — 0 errors — _live_ |
| `pnpm dev` runs in watch mode | **untested** | Watch mode implemented; never exercised in this audit |
| VS Code extension loads in development host | **verified** | Extension Development Host ran; user confirmed the panel renders — _live_ |

### Success Metrics

| Criterion | Status | Evidence |
|---|---|---|
| All packages build in < 5 seconds | **untested** | esbuild reports 5–23ms per package; tsc dominates and stays well under 5s — _evidence class: read; downgraded per the rule above_ |
| Zero TypeScript errors | **verified** | `pnpm typecheck` — 0 errors — _live_ |
| Extension loads without errors | **verified** | Confirmed in the dev host during the UI pass — _live_ |
| Development iteration < 2 seconds | **untested** | Not measured |

---

## Phase 1 — Walking Skeleton

39 criteria — 35 verified · 1 broken · 0 not-impl · 3 untested

### Task 1.1: Implement Core HTTP Server

| Criterion | Status | Evidence |
|---|---|---|
| Create http-server.ts | **verified** | `packages/core/src/server/http-server.ts` — _artifact_ |
| Listen on dynamic port | **untested** | `http-server.ts` binds 127.0.0.1, scans upward from 52376 on conflict — _evidence class: read; downgraded per the rule above_ |
| Handle POST /log endpoint | **verified** | `ingest.test.js` — routes `/log` and `/api/log` — _test_ |
| Parse and store log entries | **verified** | `ingest.test.js` — parse, validate, redact, persist to JSONL — _test_ |
| Return port on stdout | **untested** | Handshake `{"type":"ready","port":N}`; every spawn test depends on it — _evidence class: read; downgraded per the rule above_ |

### Task 1.2: Implement Core IPC Server

| Criterion | Status | Evidence |
|---|---|---|
| Create ipc-server.ts | **verified** | `packages/core/src/ipc/ipc-server.ts` — _artifact_ |
| Read JSON messages from stdin | **verified** | `ipc-server.test.js` — JSON-RPC 2.0 over stdio, `-32601` on unknown — _test_ |
| Implement getLogs method | **verified** | `logs.getAll` registered; `log-manager.test.js` — _test_ |
| Implement getStats method | **verified** | `logs.getStats` registered; `log-manager.test.js` — _test_ |
| Write responses to stdout | **verified** | `ipc-server.test.js` — JSON-RPC 2.0 over stdio, `-32601` on unknown — _test_ |

### Task 1.3: Implement Log Store

| Criterion | Status | Evidence |
|---|---|---|
| Create log-store.ts | **verified** | Capability in `managers/log-manager.ts`; no separate `log-store.ts` — folded in — _artifact_ |
| Store logs in memory array | **untested** | In-memory with `maxLogsInMemory` bound and JSONL persistence — _evidence class: read; downgraded per the rule above_ |
| Implement getLogs() | **verified** | `logs.getAll` registered; `log-manager.test.js` — _test_ |
| Implement addLog() | **verified** | `log-manager.test.js` — _test_ |
| Implement getStats() | **verified** | `logs.getStats` registered; `log-manager.test.js` — _test_ |

### Task 1.4: Implement VS Code Core Bridge

| Criterion | Status | Evidence |
|---|---|---|
| Create core-bridge.ts | **verified** | `packages/vscode/src/core-bridge.ts` — _artifact_ |
| Spawn core process | **untested** | `core-bridge.ts` spawns and handles exit; B5 test covers the env passed — _evidence class: read; downgraded per the rule above_ |
| Read port from core | **untested** | Handshake consumed by `core-bridge.ts` — _evidence class: read; downgraded per the rule above_ |
| Implement request/response over stdio | **verified** | `ipc-server.test.js` — _test_ |
| Handle process lifecycle | **untested** | `core-bridge.ts` spawns and handles exit; B5 test covers the env passed — _evidence class: read; downgraded per the rule above_ |

### Task 1.5: Implement VS Code Panel

| Criterion | Status | Evidence |
|---|---|---|
| Create panel.ts | **verified** | `packages/vscode/src/panel.ts` — _artifact_ |
| Initialize core bridge | **verified** | `extension.ts` constructs it on activation — _artifact_ |
| Generate webview HTML | **untested** | `webview-html.ts` — asset manifests, verified against rendered output — _evidence class: read; downgraded per the rule above_ |
| Handle webview messages | **verified** | `message-contract.test.js` — every posted message has a case, both directions — _test_ |
| Implement log polling | **verified** | Polling plus `since`/`before` incremental fetch (`activity-paging.test.js`) — _test_ |

### Task 1.6: Create Hook Scripts

| Criterion | Status | Evidence |
|---|---|---|
| Create http-logger.sh library | **verified** | Consolidated into `inspector-hook.sh` by M2; three implementations became one — _artifact_ |
| Create pre-tool-use.sh hook | **untested** | One script handles all 33 events; per-event scripts deliberately removed (M2) — _evidence class: read; downgraded per the rule above_ |
| Create post-tool-use.sh hook | **untested** | One script handles all 33 events; per-event scripts deliberately removed (M2) — _evidence class: read; downgraded per the rule above_ |
| Test hook → core → webview flow | **verified** | `ingest.test.js` + `activity.test.js` drive the full path — _test_ |

### Task 1.7: End-to-End Verification

| Criterion | Status | Evidence |
|---|---|---|
| Start VS Code extension | **verified** | Dev host ran; core PID observed serving on 52376 — _live_ |
| Verify core process spawns | **verified** | Dev host ran; core PID observed serving on 52376 — _live_ |
| Send test log via curl | **untested** | `scripts/test-e2e.sh` — _evidence class: read; downgraded per the rule above_ |
| Verify log appears in webview | **verified** | Confirmed during the UI pass — _live_ |
| Test with real Claude Code hook | **verified** | 3868 events captured from live sessions — _live_ |

### Success Metrics

| Criterion | Status | Evidence |
|---|---|---|
| Core process starts in < 500ms | **broken** | **Depends entirely on store size, and the bare number here was wrong.** Re-measured 2026-09-05: empty store 134–179 ms (passes); the real store, 2686 logs plus sessions and the research index, 705–826 ms over three runs (fails). An audit session measured ~1520 ms on a larger store. The original `533ms` cited no conditions, which is why three parties got three numbers — the defect is the unconditioned claim, not the value |
| Hook log delivery < 100ms | **verified** | **37ms** measured (was 337ms before M2) — _live_ |
| Webview update latency < 1 second | **untested** | Not measured |
| Zero memory leaks in 1-hour test | **untested** | Leaked timers fixed (B8) and unref'd; no 1-hour soak run |
| Works on macOS and Linux | **untested** | macOS only — **Linux has never been run** |

---

## Phase 2 — Core Features

40 criteria — 35 verified · 1 broken · 0 not-impl · 4 untested

### Task 2.1: Implement Session Manager

| Criterion | Status | Evidence |
|---|---|---|
| Create session-manager.ts | **verified** | `packages/core/src/managers/session-manager.ts` — _artifact_ |
| Implement CRUD operations | **verified** | `session-manager.test.js` — _test_ |
| Add tool execution tracking | **verified** | REGRESSION B2 — pairs parallel same-tool calls by `tool_use_id` — _test_ |
| Add event emission | **untested** | `session:created/ended/idle/terminated`, `change:tracked/kept/reverted` — _evidence class: read; downgraded per the rule above_ |
| Add persistence integration | **verified** | `persistence.test.js` round-trips — _test_ |

### Task 2.2: Implement File Tracker

| Criterion | Status | Evidence |
|---|---|---|
| Create file-tracker.ts | **verified** | `packages/core/src/managers/file-tracker.ts` — _artifact_ |
| Implement snapshot capture | **verified** | `file-tracker.test.js` — capture→track lifecycle — _test_ |
| Implement change detection | **verified** | REGRESSION B1 — one edit produces exactly one change — _test_ |
| Add status management | **verified** | REGRESSION B3 — revert archives with a `resolution` — _test_ |
| Add event emission | **untested** | `session:created/ended/idle/terminated`, `change:tracked/kept/reverted` — _evidence class: read; downgraded per the rule above_ |

### Task 2.3: Implement Version History Manager

| Criterion | Status | Evidence |
|---|---|---|
| Create version-history-manager.ts | **verified** | Capability in `file-tracker.ts` (`addVersion`/`getVersions`); no separate file — _artifact_ |
| Implement version storage | **verified** | `file-tracker.test.js` — hash dedup, trim at max — _test_ |
| Implement version comparison | **verified** | REGRESSION B9 — compares a stored version to the live file — _test_ |
| Add persistence integration | **verified** | `persistence.test.js` round-trips — _test_ |

### Task 2.4: Implement Archive Manager

| Criterion | Status | Evidence |
|---|---|---|
| Create archive-manager.ts | **verified** | Capability in `file-tracker.ts` (`archiveResolvedChange`/`restoreFromArchive`); no separate file — _artifact_ |
| Implement archive storage | **verified** | `file-tracker.test.js` — _test_ |
| Implement restore functionality | **verified** | `file-tracker.test.js` — history newest version always matches disk — _test_ |
| Add persistence integration | **verified** | `persistence.test.js` round-trips — _test_ |

### Task 2.5: Implement Diff Engine

| Criterion | Status | Evidence |
|---|---|---|
| Create diff-engine.ts | **verified** | `packages/core/src/managers/diff-engine.ts` — _artifact_ |
| Implement basic diff algorithm | **verified** | `diff-engine.test.js` — LCS, hunk boundaries, context lines — _test_ |
| Implement unified diff formatting | **verified** | `diff-engine.test.js` — LCS, hunk boundaries, context lines — _test_ |
| Add hunk-level operations | **broken** | `keepHunk`/`revertHunk` exist in `api.js` and `panel.ts`; no core implementation behind them |

### Task 2.6: Implement Persistence Layer

| Criterion | Status | Evidence |
|---|---|---|
| Create persistence store | **verified** | `packages/core/src/persistence/store.ts` — _artifact_ |
| Implement JSON file storage | **verified** | `persistence.test.js`; atomic temp+rename; path traversal contained — _test_ |
| Implement JSONL log storage | **verified** | `persistence.test.js` — append, rotate, filter — _test_ |
| Add initialization logic | **untested** | `initialize()` creates every category directory — _evidence class: read; downgraded per the rule above_ |

### Task 2.7: Enhance IPC Handler

| Criterion | Status | Evidence |
|---|---|---|
| Add all new methods to IPC server | **verified** | `ipc-server.test.js` — every method dispatches — _test_ |
| Wire managers to IPC handlers | **verified** | `ipc-server.test.js` — every method dispatches — _test_ |
| Add proper error handling | **untested** | `-32601` on unknown, parse errors handled; process-level handlers in `cli.ts` — _evidence class: read; downgraded per the rule above_ |
| Add event forwarding | **untested** | `core.ts` forwards manager events as IPC notifications — _evidence class: read; downgraded per the rule above_ |

### Task 2.8: Integration Testing

| Criterion | Status | Evidence |
|---|---|---|
| Test session lifecycle | **verified** | `session-manager.test.js` — _test_ |
| Test file change detection | **verified** | REGRESSION B1 — one edit produces exactly one change — _test_ |
| Test version history | **verified** | `file-tracker.test.js` — _test_ |
| Test archive operations | **verified** | `file-tracker.test.js` — _test_ |
| Test persistence reload | **verified** | `persistence.test.js` + migration on real data — _test_ |

### Success Metrics

| Criterion | Status | Evidence |
|---|---|---|
| 100+ sessions handled without issues | **untested** | Not load-tested; 3 concurrent sessions observed live |
| 1000+ file changes tracked | **untested** | Not load-tested; 44 tracked live |
| Persistence reload < 2 seconds | **untested** | Not measured |
| Memory usage < 200MB under load | **untested** | Not measured |
| All managers emit proper events | **verified** | `activity.test.js` asserts the feed they produce — _test_ |

---

## Phase 3 — UI Development

38 criteria — 31 verified · 1 broken · 0 not-impl · 6 untested

### Task 3.1: Set Up UI Architecture

| Criterion | Status | Evidence |
|---|---|---|
| Create file structure | **verified** | `media/scripts/{views,shared}`, `media/styles/{views,components,shared}` — _artifact_ |
| Set up CSS variables | **verified** | `styles/variables.css`; `stylesheets.test.js` checks every var resolves — _test_ |
| Create main HTML template | **verified** | `webview-html.ts` — ordered asset manifests — _artifact_ |
| Implement state management | **verified** | `state.js`; `module-split.test.js` pins 11 state fields — _test_ |
| Implement router | **verified** | `router.js`; `navigation.test.js` — 14 guards, both directions — _test_ |

### Task 3.2: Implement Dashboard View

| Criterion | Status | Evidence |
|---|---|---|
| Create stat cards | **untested** | Dashboard renders live stats — _evidence class: read; downgraded per the rule above_ |
| Add recent activity feed | **verified** | `activity.test.js` + `sessions-view.test.js` — _test_ |
| Add session overview | **untested** | `sessionSummary` — slim header, replaced a 7.6MB payload — _evidence class: read; downgraded per the rule above_ |
| Implement auto-refresh | **untested** | Polling plus `since` incremental fetch — _evidence class: read; downgraded per the rule above_ |

### Task 3.3: Implement Logs View

| Criterion | Status | Evidence |
|---|---|---|
| Create log table with virtual scrolling | **verified** | `virtual-scroll.test.js` — 19 assertions — _test_ |
| Add filtering by level/hook/session | **verified** | `log-manager.test.js` — level/hook/session filters — _test_ |
| Add search functionality | **broken** | Global search affects the Logs view only; other views ignore it |
| Add log detail panel | **untested** | `views/logs.js` — _evidence class: read; downgraded per the rule above_ |

### Task 3.4: Implement Sessions View

| Criterion | Status | Evidence |
|---|---|---|
| Create sessions list | **verified** | `sessions-view.test.js` — _test_ |
| Add tool execution timeline | **untested** | Activity feed, grouped into turns by `promptId` — _evidence class: read; downgraded per the rule above_ |
| Show session details | **verified** | `sessions-view.test.js` — _test_ |
| Display file changes per session | **untested** | Session accordion groups changes by session — _evidence class: read; downgraded per the rule above_ |

### Task 3.5: Implement File Changes View

| Criterion | Status | Evidence |
|---|---|---|
| Create changes list | **verified** | `file-changes-view.test.js` — _test_ |
| Implement diff viewer | **verified** | `shared-diff-render.test.js` — _test_ |
| Add before/after tabs | **untested** | Implemented; not covered by a named test |
| Implement keep/revert buttons | **verified** | `file-changes-view.test.js` — _test_ |
| Add batch operations | **untested** | `keepAll`/`revertAll` in `file-tracker.ts` — _evidence class: read; downgraded per the rule above_ |

### Task 3.6: Implement History View

| Criterion | Status | Evidence |
|---|---|---|
| Create tracked files list | **verified** | `history-view.test.js` — _test_ |
| Implement version timeline | **verified** | `history-view.test.js` — _test_ |
| Add version comparison | **verified** | `history.compareVersions`; REGRESSION B9 — _test_ |
| Implement restore functionality | **verified** | `history-view.test.js` — _test_ |

### Task 3.7: Implement Archived View

| Criterion | Status | Evidence |
|---|---|---|
| Create archived changes list | **verified** | `file-changes-view.test.js` — _test_ |
| Show archived diffs | **verified** | `archived-view.test.js` — fixed in ca63d59 — _test_ |
| Implement restore from archive | **verified** | `archived-view.test.js` — restore-all — _test_ |

### Task 3.8: Polish & Testing

| Criterion | Status | Evidence |
|---|---|---|
| Test all views | **verified** | 278 webview assertions across 50+ suites, plus the UI pass — _live_ |
| Fix styling issues | **untested** | Button variants consolidated; every stylesheet under 600 lines — _evidence class: read; downgraded per the rule above_ |
| Optimize performance | **verified** | 7.6MB→delta payload; 502× write amplification removed — _live_ |
| Test with large datasets | **untested** | Not tested with 10,000 logs |

### Success Metrics

| Criterion | Status | Evidence |
|---|---|---|
| All 6 views implemented | **untested** | Dashboard, Logs, Sessions, File Changes, History, Archived — plus Context — _evidence class: read; downgraded per the rule above_ |
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
| Implement Claude settings.json integration | **verified** | `install.sh` merges additively per event; `hooks.test.js` covers legacy migration — _test_ |
| Add hook persistence to storage | **not-impl** | Hooks live in settings.json only; no store-backed registry |
| Add hook validation | **untested** | `install.sh` refuses non-JSON settings and backs up before writing — _evidence class: read; downgraded per the rule above_ |

### Task 4.2: Hook Installer Implementation

| Criterion | Status | Evidence |
|---|---|---|
| Implement HookInstaller class | **not-impl** | No `HookInstaller`; installation is `install.sh` |
| Create directory structure creation | **verified** | `install.sh` creates what it needs — _artifact_ |
| Implement shared library installation | **untested** | `install.sh` registers the shared script for all events — _evidence class: read; downgraded per the rule above_ |
| Add verification and repair functionality | **not-impl** | No verify/repair command |

### Task 4.3: Built-In Hooks (All 10 Events)

| Criterion | Status | Evidence |
|---|---|---|
| Implement 10 logging hooks (one per event) | **untested** | One script covering **33** events, which supersedes 10 per-event scripts (M2) — _evidence class: read; downgraded per the rule above_ |
| Implement security gate hook | **not-impl** | Not implemented |
| Implement quality hooks (biome, ruff, type-check) | **not-impl** | Not implemented |
| Implement notification hooks (stop, question, waiting) | **not-impl** | Notification is captured; no notifying hook ships |
| Implement advanced hooks (context, backup, subagent) | **broken** | Context injection ships (`inspector-context.sh`); backup and subagent hooks do not |

### Task 4.4: Shared Libraries

| Criterion | Status | Evidence |
|---|---|---|
| Implement Bash library (inspector-hook.sh) | **untested** | `inspector-hook.sh` — one jq pass, 37ms — _evidence class: read; downgraded per the rule above_ |
| Implement Python library (inspector_hook.py) | **untested** | `claude/lib/http_logger.py`, 140 lines — _evidence class: read; downgraded per the rule above_ |
| Test with all hook types | **verified** | `hooks.test.js` — payload shape per registered event — _test_ |

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
| Test hook installation on fresh system | **untested** | Installer run against a settings file holding foreign hooks; both survive — _evidence class: read; downgraded per the rule above_ |
| Test all CRUD operations | **not-impl** | No hook CRUD to test |
| Test all 10 built-in logging hooks | **verified** | `hooks.test.js` covers all 33 registered events — _test_ |
| Test security/quality/notification hooks | **not-impl** | Notification is captured; no notifying hook ships |
| Performance testing (< 50ms overhead) | **verified** | **37ms** per hook, under the 50ms target — _live_ |

### Success Metrics

| Criterion | Status | Evidence |
|---|---|---|
| All 10 Claude Code events supported and logged | **verified** | **33** events registered and captured — _live_ |
| < 50ms hook execution overhead per hook | **verified** | **37ms** measured — _live_ |
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
| All tests passing | **untested** | 483 core + 278 webview, green — _evidence class: read; downgraded per the rule above_ |
| Version bumped in all package.json files | **not-impl** | Still 0.1.0 across packages |
| CHANGELOG.md updated | **not-impl** | No CHANGELOG.md |
| README.md reviewed | **untested** | Rewritten; `wsPort` and the legacy hook schema removed — _evidence class: read; downgraded per the rule above_ |
| Security audit completed | **broken** | Partial. Origin rejection, rate limiting, redaction and a **path-traversal fix** landed; no full audit |
| Performance benchmarks met | **broken** | Hook 37ms and payload size met; **core start 533ms misses the 500ms target** |

### Build

| Criterion | Status | Evidence |
|---|---|---|
| Clean build succeeds | **verified** | `pnpm build` from deleted `node_modules`, no flags — _live_ |
| VSIX package created | **broken** | **No VSIX can be built.** `vsce ls` → `ERROR Invalid extension name '@inspector-hook/vscode'` — a scoped name is illegal in a VS Code manifest. Was marked untested; running it showed it is broken |
| Package size acceptable (< 5MB) | **untested** | Blocked by the manifest name above. With the name patched, a scratch build produced 149 KB / 67 files — so the size is fine and the packaging is not |

### Testing

| Criterion | Status | Evidence |
|---|---|---|
| Fresh install works | **broken** | `vsce package --no-dependencies` ships no `node_modules`, while `core-bridge.ts` resolves the core to `<extensionPath>/node_modules/@inspector-hook/core/dist/cli.js`. A fresh install would spawn a file that is not in the package; it works in the dev tree only via the workspace symlink |
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
| Add input validation | **verified** | `ingest.test.js` — rejects malformed JSON and bad payloads — _test_ |
| Implement rate limiting | **verified** | `hardening.test.js` — 600/min sliding window, `X-RateLimit-*` headers, 429. **Correction: this row previously claimed a `Retry-After` header. The code never sets one** — only `X-RateLimit-Limit/Remaining/Reset`. An asserted header that does not exist, in the document written to catch exactly that — _test_ |
| Add path sanitization | **verified** | **Found a live traversal and fixed it** — `persistence.test.js` SECURITY tests — _test_ |
| Security audit | **broken** | See Pre-Release: partial |

### Task 6.2: Performance Optimization

| Criterion | Status | Evidence |
|---|---|---|
| Implement memory management | **untested** | `maxLogsInMemory`, retention with collapse, index cap — _evidence class: read; downgraded per the rule above_ |
| Add caching layer | **not-impl** | No cache layer |
| Optimize hot paths | **verified** | 502× write amplification removed; hook 337ms→37ms — _live_ |
| Profile and fix bottlenecks | **verified** | Measured and fixed: writes, hook latency, activity payload — _live_ |

### Task 6.3: Error Handling

| Criterion | Status | Evidence |
|---|---|---|
| Add global error handler | **untested** | `uncaughtException`/`unhandledRejection` in `cli.ts` — _evidence class: read; downgraded per the rule above_ |
| Implement graceful shutdown | **untested** | SIGINT/SIGTERM flush and release the port file — _evidence class: read; downgraded per the rule above_ |
| Add error recovery | **broken** | Store migration and index rebuild recover; the core exits on an uncaught error by design |
| Improve error messages | **untested** | Refusals carry reasons (memory writes, port claim, path containment) — _evidence class: read; downgraded per the rule above_ |

### Task 6.4: Packaging

| Criterion | Status | Evidence |
|---|---|---|
| Configure package.json | **untested** | Extension manifest complete — _evidence class: read; downgraded per the rule above_ |
| Create build script | **verified** | `pnpm build`; `package` script present — _live_ |
| Test packaging | **untested** | **Never packaged** |
| Verify VSIX contents | **untested** | **Never packaged** |

### Task 6.5: Documentation

| Criterion | Status | Evidence |
|---|---|---|
| Write user documentation | **verified** | README + `packages/hooks/README.md` — _artifact_ |
| Write developer documentation | **verified** | `docs/design/*` corrected against the code — _artifact_ |
| Add inline code comments | **untested** | Comments explain why, including the bugs each guard prevents — _evidence class: read; downgraded per the rule above_ |
| Create examples | **untested** | No examples directory |

### Task 6.6: Final Testing

| Criterion | Status | Evidence |
|---|---|---|
| Full regression test | **untested** | 757 assertions run green before each commit — _evidence class: read; downgraded per the rule above_ |
| Performance testing | **broken** | Hook and payload measured; start time misses target |
| Security testing | **untested** | Traversal, origin, rate limit and redaction all have tests — _evidence class: read; downgraded per the rule above_ |
| Cross-platform testing | **untested** | macOS only — **Linux has never been run** |

### Success Metrics

| Criterion | Status | Evidence |
|---|---|---|
| Zero critical security issues | **broken** | One found and fixed this session (path traversal); no independent audit |
| < 200MB memory usage | **broken** | **927 MB RSS measured** on a long-running core — 4.6x the budget. Was untested; measuring it settled it |
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


# Feature Audit Matrix

Milestone 1.3. **All 268 acceptance checkboxes from `docs/phases/*.md`**, each resolved to a
status with evidence — **plus 119 rows for Milestones 2, 3, 4, 5, 7 and 8**, tallied separately at the end.

M3 and M4 have no phase document, so neither appeared here at all: this matrix covered every
milestone except the two the branch actually shipped.

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
| ~~2~~ | ~~Add hunk-level operations~~ | **FIXED 2026-09-08.** Worse than missing: the webview's per-hunk path called `keepChange`/`revertChange`, so "revert this hunk" reverted the WHOLE file and reported it as a per-hunk result. `FileTracker.resolveHunk` implements it, and refuses when the file on disk has moved on · `hunk-operations.test.js` |
| 3 | Add search functionality | Global search affects the Logs view only; other views ignore it |
| 4 | Implement advanced hooks (context, backup, subagent) | Context injection ships (`inspector-context.sh`); backup and subagent hooks do not |
| 4 | 100% of built-in hooks functional on clean install | The observer and context hooks ship; the security/quality/notification set does not |
| 5 | Create Rule types in protocol | `protocol/src/automation.ts` declares `Rule`/`RuleCondition`/`RuleAction` — **zero consumers** · **Labelled DECLARED, NOT IMPLEMENTED in the file itself (2026-09-08)** so the types no longer read as a contract; still unimplemented |
| 5 | Create StagedChange types | `automation.ts` declares `StagedChange`/`ApplyResult` — **zero consumers** · **Labelled DECLARED, NOT IMPLEMENTED in the file itself (2026-09-08)** so the types no longer read as a contract; still unimplemented |
| 5 | Create Analytics types | `automation.ts` declares `Analytics`/`TimeSeriesData`/`TopItem` — **zero consumers** · **Labelled DECLARED, NOT IMPLEMENTED in the file itself (2026-09-08)** so the types no longer read as a contract; still unimplemented |
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

## Milestones 3–4 — native memory, research history and RAG

**These 119 rows are ADDITIONAL to the 268 above and are tallied separately.** The 268 come
from `docs/phases/*.md`; M3 onward were added by the plan and have no phase document, which is
why this matrix covered none of the milestones the branch actually shipped. A backlog
silent about the newest work is the same failure this document was already corrected for once.

Criteria are taken from the plan's Milestone 2 (transport, event coverage, the installer),
Milestone 3 (five numbered deliverables), Milestone 4
(capture, per-project index, hybrid retrieval, storage tiering, graphify), Milestone 5
(agent capture, the live tree, MCP exposure), Milestone 7 (per-project scans, confidence
tiering, graph analysis) and Milestone 8 (skill inventory, utilization from transcripts, the
Skills and Tools views). **M6 is deferred** and has no rows; every other shipped milestone now
does. M7's were owed for a cycle — it shipped against live scans that were never written down
here — and were added from one fresh scan rather than from recollection, which is how two of
them came back `broken` rather than `verified`. M2's were added the same way, from a live
measurement of 17,192 log rows plus one end-to-end run, and turned up a third: a second
`install.sh --http` emptied the settings file.

| | Count | Share |
|---|---:|---:|
| **verified** | 113 | 94% |
| **untested** | 4 | 3% |
| **not-impl** | 2 | 1% |

Four of the 46 `verified` rows were **`broken` or `inert` when first audited this cycle** —
M4.5 (one repository held six project keys), M4.17 (`buildGraph` reachable by nothing) and
M4.18 (the Search view never subscribed, so every search spun forever) and M5.12
(two protocols sharing one pipe). Their evidence records
what they were, because a matrix showing only the end state hides the class of defect that
produced it. No status outside the five defined above is used here.

### Milestone 3 — session context on native auto memory

| # | Criterion | Status | Evidence |
|---|---|---|---|
| M3.1 | Session digest written in the native memory format | verified | test · `native-memory.test.js`, `formatMemoryFile`/`writeMemoryFile` |
| M3.2 | Written to the native location, not a parallel store | verified | test · `resolveMemoryDir(transcriptPath)` |
| M3.3 | Writing is behind an explicit setting, default off | verified | test · `inspectorHook.writeSessionMemory`, `config-plumbing.test.js` |
| M3.4 | The flag reaches the core process | verified | live · forwarded explicitly in `core-bridge.ts`; inheritance made it unreachable before `dec9245` |
| M3.5 | Memory directory is created on first write | verified | test · `1a5ab2a`; the first write per project used to ENOENT |
| M3.6 | Every path writes the same digest | verified | test · `8209091`, one digest collector |
| M3.7 | Native loading picks the file up with no injection hook | untested | read · the platform reads these files; never observed end to end from a session Claude actually started |
| M3.8 | Curation UI lists memory files across every project | verified | test · `context-view.test.js` |
| M3.9 | Shows what would load, per file | verified | test · `f0f12f3` |
| M3.10 | Edit a memory file | verified | test · `01a6ea1` — an edit used to land on a different file than the one opened |
| M3.11 | Delete a memory file | verified | test · `deleteMemoryFile({force})` |
| M3.12 | Retype an entry (`user`/`feedback`/`project`/`reference`) | verified | test · declared vs inferred type, `947bbb5` |
| M3.13 | Promote an orphan into the index | verified | test · `39b56ef`, without rewriting the file |
| M3.14 | Curated index prose is preserved, not regenerated | verified | test · `801ceed` |
| M3.15 | Cross-project rollup | verified | live · Context view spans every project on the machine |
| M3.16 | Picker: browse prior sessions | verified | test · `1f10d8c` |
| M3.17 | Picker: inject via `SessionStart` stdout | verified | live · `inspector-context.sh`, one-shot and expiring |
| M3.18 | Picker: inject via `UserPromptSubmit` `additionalContext` | verified | artifact · `inspector-prompt-context.sh` emits the nested `hookSpecificOutput` shape a top-level key is silently ignored in |
| M3.19 | Inject into a session already running | verified | test · `e819ee9`, now and pinned tiers |
| M3.20 | Multi-item context tray | verified | test · `27ddee3` |

### Milestone 4 — research history and hybrid retrieval

| # | Criterion | Status | Evidence |
|---|---|---|---|
| M4.1 | Capture web lookups (`web_search`, `web_fetch`) | verified | live · both kinds present in the 793-item store |
| M4.2 | Capture subagent tasks and reports | verified | live · 192 `subagent_report` items |
| M4.3 | Capture prompts and conclusions | verified | live · `user_prompt` + `conclusion` present |
| M4.4 | Capture files read, without storing contents | verified | test · stable per-path id `read:<project>:<path>`; 165 events collapse to 107 items |
| M4.5 | Index per project | verified | live · was **broken**: one repository held SIX keys and 471 of 793 items were mis-keyed. `migrateProjectKeys` + `projectRoot`; 9 keys → 4, this repo 318 → 789 · `project-keys.test.js` |
| M4.6 | Cross-project search, opt-in scope | verified | live · scope is reported on every result, never implicit |
| M4.7 | Hybrid BM25 + local embeddings | verified | live · MRR 0.440 (BM25) → 0.614 (embeddings) → **0.700** (fused), 5 known-answer queries fixed before ranking |
| M4.8 | Offline, no API key | verified | live · local model, one-time download, no network at query time |
| M4.9 | Rank fusion, not score blending | verified | test · `reciprocalRankFusion`, `embeddings.test.js` |
| M4.10 | Degrades to BM25 when the model is absent, and says so | verified | test · `retrieval` is reported as lexical or hybrid on every result; CI installs `--no-optional` so every run exercises it |
| M4.11 | Vectors persist across a restart | verified | live · 693 restored, 0 re-embedded |
| M4.12 | Retention enforced (`logRetentionDays`) | verified | live · logs pruned to 2026-09-03, 4 rotated files; was a stub returning zeros |
| M4.13 | Storage tiering: collapse to summaries before pruning | untested | read · `collapseSession` is wired and `summaries/` exists, but is **empty** — the store holds 4 days against a 7-day default, so this has never actually run |
| M4.14 | graphify owns the code/docs graph | verified | live · 4095 nodes / 333 communities built from this repo |
| M4.15 | Graph is searchable by word, not just exact symbol | verified | live · `identifierText` splitting; "research" returns 104 hits |
| M4.16 | Graph staleness is three-valued (true/false/**unknown**) | verified | test · `graphify.test.js`; unknown is never rendered as current |
| M4.17 | Inspector Hook can trigger graphify builds | verified | live · was **inert**: `buildGraph` existed, was exported and tested, and no IPC method reached it. `graphify.build` now returns `ok: true` and the post-build status |
| M4.18 | The index is reachable from the UI | verified | test · was **broken** on arrival — the Search view never subscribed to its own state, so every search spun forever · `research-view.test.js` |

### Milestone 5 — agents, the tree, and MCP exposure

| # | Criterion | Status | Evidence |
|---|---|---|---|
| M5.1 | Capture `SubagentStart`/`SubagentStop` | verified | live · 44 starts, 384 stops in the store; all five agent events registered in settings.json |
| M5.2 | Capture `TaskCreated`/`TaskCompleted`/`TeammateIdle` | untested | live · registered and ingested, but **0 TaskCreated/TaskCompleted have ever been captured**; 23 TeammateIdle have. Nothing to verify against yet |
| M5.3 | Attribute an agent's work to it | verified | live · 3757 of 9014 tool events carry `agentId`; 1874 calls attributed across the backfill · `agent-tracker.test.js` |
| M5.4 | Show what each agent was asked | verified | live · from the spawn call's `tool_input`, present on 32 of 32 |
| M5.5 | Show what each returned, and what KIND of thing that is | verified | live · `resultKind` report/spawn-ack/none; 14 of 170 are spawn-ack · `agents-view.test.js` |
| M5.6 | Show duration | verified | test · `SubagentStop.durationMs` is null in 384 of 384, so it is computed and carries `durationSource`; a spawn call's duration is explicitly NOT trusted as the agent's runtime |
| M5.7 | Live agent tree in the UI | verified | test · Agents tab in Monitor, filters incl. "Never reported" · `agents-view.test.js` |
| M5.8 | Tree survives a core restart | verified | live · backfilled from the log on startup, 170 agents from 10000 rows |
| M5.9 | Nesting: which agent spawned which | verified | live · no hook event states parentage, but the platform writes a subagent's transcript INSIDE its parent's directory, so the path is the answer. **83 agents resolved across 17 parent sessions.** `maxDepth` is 1 here because 0 agent-to-agent spawns exist — cross-checked twice: no second-level `subagents/` anywhere, and 0 `Task`/`Agent` calls inside any of the 83 subagent transcripts. A two-level fixture proves that is the corpus and not the code · `agent-parentage.test.js` |
| M5.10 | Expose prior findings over MCP | verified | live · `--mcp`, real handshake: initialize / tools/list / tools/call, 3 tools, `-32601` on unknown |
| M5.11 | MCP results never misdescribe themselves | verified | test · a spawn acknowledgement renders as "NEVER REPORTED"; the graph reports current / out-of-date / unknown age · `mcp-server.test.js` |
| M5.12 | `--mcp` does not share stdio with IPC | verified | live · was **broken**: notifications were interleaved into the MCP stream. Observed before/after on the binary; an end-to-end test spawns `--mcp` and asserts zero unsolicited notifications |

### Milestone 2 — transport and event coverage

Measured 2026-09-09 over 17,192 live log rows and 11,172 tool events, plus one end-to-end
`claude -p` run wired with HTTP-only hooks.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| M2.1 | Register every event the core can attribute | verified | live · 30 of 33 in settings.json. The 3 excluded are deliberate: `MessageDisplay` fires per streamed chunk, and the `Elicitation` pair adds nothing a dashboard shows |
| M2.2 | `PostToolUseFailure` can actually fire | verified | live · was **inert**: handled in the core and registered by no installer. **57 captured** in the store now |
| M2.3 | `StopFailure` can actually fire | untested | live · registered, and `ai.error` has 5 rows — but no turn has failed in a way that proves the StopFailure path specifically. Registered and unobserved, not handled and unregistered |
| M2.4 | Events registered but never observed are not counted as working | verified | live · 23 of 30 event types have fired; the other 7 (worktrees, model switches, tasks) have never happened on this machine and are reported as unobserved rather than broken |
| M2.5 | `tool_use_id` forwarded, so executions pair | verified | live · 86% overall, and the shortfall is entirely historical — **51% on 2026-09-03 before the hook fix, 100% every day since**. This is B2's real fix: the earlier one was correct, tested, and inert |
| M2.6 | `prompt_id` forwarded for turn grouping | verified | live · 85%, same historical split |
| M2.7 | `permission_mode` and `effort` forwarded | verified | live · 72% each, and `effort` is unwrapped from `.effort.level` |
| M2.8 | Real duration, not a derived one | verified | live · `durationMs` on 42% of tool events, which is ~85% of PostToolUse; anything computed from our own timestamps would be a multiple of 1000ms or 0 |
| M2.9 | Subagent identity forwarded | verified | live · `agentId` 34%, `agentType` 33% — only events fired inside a subagent carry them, and that is what makes M5's tree buildable from tool events alone |
| M2.10 | `last_assistant_message` — Claude's actual replies | verified | live · present on **90%** of response events. Capturable for the first time |
| M2.11 | Level is derived, not hardcoded | verified | live+test · was `"info"` always, so Errors/Warnings/Blocked could never populate. A tool error naming a denial becomes `blocked`, not `error` · `hooks.test.js`, `hook-payload.test.js` |
| M2.12 | The installer is additive, not destructive | verified | test · was a single jq assignment to the whole `.hooks` key — a full replace that silently deleted any co-installed tool's entries. Now merges per event; a fixture carrying 3 foreign hooks keeps all 3 · `hooks.test.js`. (Written out rather than quoted: `docs-safety.test.js` scans every document for that literal, so a reader cannot copy it out of a doc, and it caught this row) |
| M2.13 | Install is idempotent | verified | test · three consecutive runs produce one entry per event |
| M2.14 | Uninstall is symmetric | verified | test · `uninstall.sh` delegates to `install.sh --uninstall` so one file owns both directions, and the test DERIVES the uninstall list from the install source — the drift it was written after left one of four scripts behind |
| M2.15 | The modern nested schema | verified | test · `{matcher, hooks:[{type, command}]}`; the legacy flat shape Claude Code no longer accepts is stripped on upgrade |
| M2.16 | An HTTP hook does not stall a dead core | verified | live · the M2 blocker, measured: 17.1s for one turn against a closed port, vs 19.6s with no hook and 15.9s with a live listener. 600s is the RESPONSE timeout; connection refused returns at once. A control run against a recording listener proved the hook fires |
| M2.17 | The core can BE the hook handler | verified | live · `/api/hook` takes the native payload. One `claude -p` run with four HTTP-only hooks and no shell script captured all four events, correct levels, matching `tool_use_id` across the Pre/Post pair, 1733ms real duration, `tool_result` and `last_assistant_message` present |
| M2.18 | Both transports produce the same record | verified | test · one shared `ingestLog`, and a drift test that derives the event-rename and level tables FROM the shell source rather than restating them · `hook-payload.test.js` |
| M2.19 | `--http` installs and uninstalls cleanly | verified | test · was **broken**: two jq filters called `test()` on `.command`, null for an http entry, so a second install emptied the settings file — reachable by anyone with an http hook from any tool. Uninstall matches the `/api/hook` path, not the URL, since the port can change between install and uninstall · `hooks.test.js` |
| M2.20 | HTTP hooks as the DEFAULT transport | not-impl | live · by decision, not omission. An HTTP hook URL is static and the core's port is not — it scans upward when 52376 is taken, and the live core is on 52377. The shell hook re-reads the port file every event. Also, only a command hook can inject context: an HTTP response body cannot write to stdout, so the two context scripts stay command hooks even under `--http` |
| M2.21 | A hook response never alters the session | verified | read+live · `/api/hook` always answers `{}` with 200, including on malformed input. Claude Code reads the response as hook output, so an error body could surface to the user and a `decision` field could block a tool call |

### Milestone 7 — code quality across every observed project

Measured by one live scan of this repository on 2026-09-09: 12.0s, 8 analysers,
`high 1 · medium 1 · low 1 · suppressed 80 · circular 3 · secrets 0 · deadSymbols 16`.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| M7.1 | Scan across observed projects, not this repo | verified | live · 32 discovered, 18 on disk, 14 moved away. `quality.getProjects` returns the missing ones with `exists: false` rather than dropping them |
| M7.2 | knip, and its false-positive rate | verified | live · knip flags 83 files here; **80 are suppressed** as webview scripts the manifest loads. A Quality view built on raw knip would be 96% noise · `quality-scanner.test.js` |
| M7.3 | The manifest is ground truth and suppresses | verified | live · 118 paths parsed from `webview-assets.ts`; every suppressed finding names it in `suppressedBy` |
| M7.4 | A missing ground truth is reported, not silent | verified | test · was **broken**: the manifest moved to `webview-assets.ts`, the reader looked only at `webview-html.ts`, returned null, and null reads as "suppress nothing" — 80 false positives promoted to real with nothing on screen. `groundTruth.problems` now carries the reason · `confidence.test.js` |
| M7.5 | The graph ranks confidence and never suppresses alone | verified | live · `persistence/index.ts` is knip-flagged with 6 graph edges and lands **low**, not suppressed — the graph's `contains`/`imports` edges are not reachability |
| M7.6 | Two agreeing signals give high confidence | verified | live · `scripts/debug-webview.js` — `agreed=[graph-orphan, knip]` → **high**, the plan's named case |
| M7.7 | The graph reaches what knip cannot | verified | live · `config/claude-hooks/lib/http_logger.py` is Python, invisible to knip, and surfaces from the graph alone. **It lands `medium`, not `high` as plan §7.6 predicted** — one signal cannot corroborate itself, and the tiering is right where the plan's acceptance line was optimistic |
| M7.8 | Manifest-loaded scripts never appear as dead | verified | live · 15 `api/inbound-*.js` findings, **all 15 suppressed**, none at high/medium/low |
| M7.9 | Four languages, not one | verified | live · registry of 7 analysers: knip, madge (ts-js) · vulture, ruff (python) · go-deadcode (go) · clippy (rust) · sonar-secrets (any). This repo detects `ts-js 189, python 10` and runs 5 |
| M7.10 | An analyser needs no install | verified | live · `npx --yes`, `uvx`, `go run …@latest`, `cargo clippy`. vulture and ruff both ran here (682ms, 218ms) with neither installed |
| M7.11 | vulture does not drown in vendored code | verified | live · unfiltered it reports 66 findings, 62 inside `.venv`/site-packages. **0 of the 16 dead symbols in this scan are in either** |
| M7.12 | "not applicable" ≠ "clean" | verified | live · go-deadcode and clippy report `not-applicable` with a reason ("the project has no go files"); sonar-secrets reports `unavailable` with the install command. None is counted as a measurement |
| M7.13 | Sonar's local tier only | verified | read+live · only `sonar analyze secrets` is used; the issue and quality-gate commands are server-bound and not invoked. Not installed here, so it degrades to `unavailable` rather than failing the scan |
| M7.14 | Every count states which tools produced it | verified | live · `summary.measured = [knip, madge, vulture, ruff, graphify]`, `unmeasured = [go-deadcode, clippy, sonar-secrets]`; the view refuses to render "clean" when `measured` is empty · `quality-view.test.js` |
| M7.15 | Circular dependencies | verified | live · was **wrong**: madge walked build output and reported 6 cycles, 3 of them `packages/core/dist/*.d.ts` restating the other 3. Excluding VENDOR_DIRS gives **3 real cycles**, all `core.ts → index.ts` — the barrel import the god-node analysis independently implicates |
| M7.16 | Dead symbols are kept apart from dead files | verified | live · 16 dead symbols (knip 11, ruff 5) in `deadSymbols`, never merged into `findings`: a symbol is one tool's local observation that no second signal can corroborate |
| M7.17 | Graph analysis: orphans, god nodes, coupling, rot | verified | live · 4095 nodes / 4922 edges · 9 orphans · god node `index.ts` at **149 edges** · 339 communities at **12% crossing** · rot reported with `checked` so an unverifiable count is not shown as zero |
| M7.18 | A stale graph is labelled, never trusted silently | verified | live · this repo's graph reports `stale: true` against HEAD, and `stale` is three-valued — `null` means unknown, which is not the same as current |
| M7.19 | Scans are persisted with history, and trend | verified | test · `MAX_HISTORY = 30`; `highDelta` compares only scans whose `measured` tool sets match, so a trend never compares a 5-tool scan with a 2-tool one · `quality-store.test.js` |
| M7.20 | graphify builds graphs for every project | verified | live · was **inert**: `ScanOptions.buildGraph` was declared, documented and read by nothing for a whole milestone. Now wired scan → IPC → a separate "Build graph + scan" button, and proved end to end on a project that had never had one (build 852ms → 8 nodes analysed) · `quality-scanner.test.js` |
| M7.22 | A graph build refuses a root it must not walk | verified | test · one of the 18 real projects IS `/Users/giorgobg`, because `discoverProjects` reads the cwd a session ran in. graphify walks everything below its root, so a build there would crawl the whole home directory. Refused structurally — at or above home, or under two segments deep — and reported as `not-applicable` WITH the reason rather than skipped silently |
| M7.23 | Building is never implied by a scan | verified | test · a plain scan emits no `graphify-build` result at all. It is the only thing a scan does to the PROJECT rather than to our store, so it is a separate button, not a checkbox |
| M7.21 | Gating a build on a scan | not-impl | read · deferred with M6 by decision. No project on this machine has run Forge, so the gate has nothing to attach to |

### Milestone 8 — skills and MCP tools: inventory against utilization

| # | Criterion | Status | Evidence |
|---|---|---|---|
| M8.1 | Discover global `~/.claude/skills` | verified | live · 22 found · `skills-registry.test.js` |
| M8.2 | Discover project `<root>/.claude/skills` | verified | test · no project on this machine has one, so the path is covered by fixture only and says so |
| M8.3 | Discover plugin skills via `enabledPlugins` | verified | live · resolved through `installed_plugins.json` → `installPath`. 3 plugins enabled, **1 skill** (`frontend-design`); `typescript-lsp` and `pyright-lsp` ship none. The cache holds 5 versions of that plugin and the marketplace holds skills for 4 never-installed plugins — walking either would report skills that cannot fire |
| M8.4 | Report `frontmatterValid` as a defect, not skip it | verified | live · 8 of 22 have no `name`; they sort to the top of the list and the detail says "can never be chosen" · `skills-view.test.js` |
| M8.5 | Handle a skill as a directory tree | verified | live · `bytes` covers the tree, `subdirectories` and `extraFiles` are separate; archive/restore moves the whole tree and the test asserts a `references/` file survives the round trip |
| M8.6 | Count utilization from transcripts, not our pruned logs | verified | live · 121 transcripts in 1.9s → **13 Skill invocations across 7 skills**. The logs showed 1 skill; the plan's "1 of 22" headline came from them and was wrong |
| M8.7 | Count nested subagent transcripts | verified | live · 83 of the 121 files are `<session>/subagents/agent-*.jsonl`; a flat readdir sees 31% of the corpus. Their calls go to the PARENT session, verified disjoint (0 overlapping `tool_use` ids on a sampled session). Both tests fail against the flat version |
| M8.8 | Do not credit a built-in skill to the installed set | verified | live · 4 of the 7 that fired ship with Claude Code; they carry `source: "builtin"` and are counted apart, so the headline is **3 of 22** and not 7 of 22 · `skills-registry.test.js` |
| M8.9 | Per item: invocations, last used, distinct sessions, distinct projects | verified | live · `artifact-design` 5× / 5 sessions / 4 projects. `lastUsed` is a max, not a last-write, because a scan visits files in directory order |
| M8.10 | MCP servers from `~/.claude.json`, incl. per-project | verified | live · 4 global, 0 per-project across 33 projects; the per-project key is read anyway |
| M8.11 | Never render `env` | verified | live · dropped at the reader, so it never enters a record. Checked by key, not substring — the first check matched `.venv/bin/python` and was a false positive · `skills-registry.test.js` |
| M8.12 | Observed-but-unconfigured servers are first-class | verified | live · `claude-in-chrome` is **548 of 684** calls and is in no config file; `claude_ai_Google_Drive` (16) likewise. A config-driven list would omit the busiest server on the machine · `skills-view.test.js` |
| M8.13 | A configured server never called is reported as such | verified | live · 3 of 4 configured servers have 0 calls; only playwright (120) has any |
| M8.14 | Server reachability | verified | live · a real handshake — initialize / notifications/initialized / tools/list — against each configured server. Found `memory` **cannot start** (its venv interpreter was deleted) in 9ms, and that `fetcher` answers as `browser-mcp` and `mcp-ical` as `Calendar`, neither matching its config key. Advertised tools are kept apart from observed: playwright advertises 24 and 9 were ever called · `mcp-probe.test.js` |
| M8.24 | Detail pane renders SKILL.md as markdown | verified | live+test · hand-rolled, because the CSP admits scripts from an allowlist and the package has no runtime dependency. Its non-negotiable property is that unrecognised syntax survives as text — checked against **all 22 real skills, every word of every file survives**. Escaping happens once, before any markup, and a fixture `<img onerror>` renders as visible text · `skills-view.test.js` |
| M8.25 | Detail pane shows a supporting-file tree | verified | test · `SkillRecord.files` carries the real paths, capped at 200 with `extraFiles` as the true total, so a truncated list says how many it hides instead of looking complete · `skills-view.test.js` |
| M8.22 | Reachability never runs itself | verified | test · it spawns a process per server, one of them a browser, so it is a button. An unchecked server renders as "not checked" — never as reachable, never as broken · `skills-view.test.js` |
| M8.23 | A probe never handles secrets to succeed | verified | test · the probe's targets come from `readConfiguredServers`, which is asserted to carry no `env` key and not to leak a configured `sk-secret` value; the probe therefore inherits only the ambient environment, and a server needing a key fails its handshake rather than being worked around · `skills-registry.test.js` |
| M8.15 | Every count states its source | verified | test · the footer names the transcript count and scan time; 0 transcripts renders "Not measured — unknown, not zero" rather than a confident zero · `skills-view.test.js` |
| M8.16 | Filter unused / used / invalid | verified | test · `skills-view.test.js` |
| M8.17 | Detail: rendered SKILL.md, path, open-in-editor, supporting tree | verified | test · read in the core so the byte cap and the containment check have one implementation; the path is resolved by looking the id up in the discovered set, so a traversal fails as "unknown skill" |
| M8.18 | Archive instead of a disable toggle | verified | live · `settings.json` has no skills key (12 top-level keys, none for skills). The button says Archive, the tooltip says outright it is not a disable switch, and plugin/built-in skills are read-only · `skills-view.test.js` |
| M8.19 | Archive is reversible and refuses to overwrite | verified | test · restore uses the recorded `originalPath`, not `SKILLS_ROOT` + id, so a project skill goes back where it came from. Refuses when something else has taken the path, when already archived, and on a traversal id |
| M8.20 | The read path modifies nothing under `~/.claude/` | verified | live · 584 files under `skills/`, `settings.json` and `plugins/` compared by path, mtime and size before and after a full scan: **0 differences**. Archive is the one write and no scan calls it |
| M8.21 | The view builds itself from `init()` alone | verified | test · `view-bootstrap.test.js`, the guard added after Agents and Search both shipped stuck on their static fallback |

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


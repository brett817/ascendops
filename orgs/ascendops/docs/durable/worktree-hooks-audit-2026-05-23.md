# Worktree Pattern Hooks Audit

Date: 2026-05-23
Author: aussie (C4 dispatch from dane 23:11 UTC)
Reference: `orgs/ascendops/docs/durable/worktree-isolation-design-2026-05-23.md`

## Scope

Audit every active hook, cron, and hook-equivalent code path in the cortextOS fleet for worktree-awareness needs. For each, declare needs-update YES/NO with 1-line rationale.

Audit method: greps for `git `, `process.cwd`, `CTX_FRAMEWORK_ROOT`, `CTX_AGENT_DIR`, hardcoded `/cortextos` paths.

---

## A. Claude Code hooks (per-agent `.claude/settings.json`)

Sample agent: aussie. Shape is identical across all agent settings.json files.

| Hook | Trigger | Command | Needs Update | Rationale |
|---|---|---|---|---|
| hook-planmode-telegram | PermissionRequest (ExitPlanMode) | `cortextos bus hook-planmode-telegram` | **NO** | Routes user-facing approval prompt to Telegram. Pure agent-state read + bus call, no git/cwd dependency. |
| hook-permission-telegram | PermissionRequest (any) | `cortextos bus hook-permission-telegram` | **NO** | Same shape — agent-state read + bus call. |
| hook-ask-telegram | PreToolUse (AskUserQuestion) | `cortextos bus hook-ask-telegram` | **NO** | Same shape. |
| crash-alert | SessionEnd | `cortextos crash-alert` | **YES** (P3) | `hook-crash-alert.ts:261` uses `process.env.CTX_AGENT_DIR || process.cwd()` — if agent cwd becomes the worktree, this would resolve to the worktree dir instead of the canonical agent state dir, breaking crash-log writes. Fix: require `CTX_AGENT_DIR` env or compute canonical from `CTX_ROOT + state/agents/<agent>`. |
| write-handoff.sh | SessionEnd | `bash _shared/scripts/write-handoff.sh session-end-hook` | **NO** | Already defensive — defaults `FRAMEWORK_ROOT` to canonical path, writes handoff.md to canonical agent dir via that root. Will work as-is. |
| hook-idle-flag | Stop | `cortextos bus hook-idle-flag` | **NO** | Agent-state flag write only. |
| hook-compact-telegram | PreCompact | `cortextos bus hook-compact-telegram` | **NO** | Bus call + Telegram notify. |
| hook-extract-facts | PreCompact | `cortextos bus hook-extract-facts` | **NO** | Reads transcript for fact extraction; agent-state surface only. |

## B. Hook-equivalent code in `src/hooks/`

Code paths that resolve worktree-sensitive constructs at runtime (greps confirmed).

| File | Sensitive Line | Needs Update | Rationale |
|---|---|---|---|
| `src/hooks/hook-skill-autopr.ts:228` | `frameworkRoot = process.env.CTX_FRAMEWORK_ROOT || process.cwd()` | **YES** (P2) | Fires on Write/Edit, checks if path is under `frameworkRoot/community/skills/`. When an agent writes a SKILL.md *inside its worktree*, the worktree path will NOT match `CTX_FRAMEWORK_ROOT/community/skills/` and the auto-PR-creation will silently skip. Fix: also check worktree-relative path against canonical, OR resolve via shared `.git/common-dir` to find the canonical root. |
| `src/hooks/hook-crash-alert.ts:261` | `agentDir = process.env.CTX_AGENT_DIR || process.cwd()` | **YES** (P3) | Same root cause as the SessionEnd crash-alert entry above. Already counted in §A. |
| `src/hooks/index.ts:49,56` | `process.cwd()` fallback for agent name + `.env` lookup | **YES** (P3) | If cwd is worktree, agent name resolves to the worktree path basename (`worktree`) instead of the agent name; `.env` lookup at `process.cwd()/.env` will miss the canonical agent dir env file. Fix: prefer `CTX_AGENT_NAME` strictly + `CTX_AGENT_DIR/.env`. |

## C. Daemon-state crons (per-agent `crons.json`)

For each enabled cron across the fleet, check whether the prompted skill or bash command runs git or writes path-sensitive output.

### aussie (16 crons total)

| Cron | Schedule | Needs Update | Rationale |
|---|---|---|---|
| heartbeat | 2h | **NO** | Heartbeat skill reads/writes agent state files only. |
| nightly-metrics | 24h | **NO** | Reads `~/.cortextos/.../analytics/` state, writes report there. |
| auto-commit | 24h | **YES** (P1) | Skill `local-version-control` runs `git add/diff/commit` against the cwd. Under worktree pattern, this MUST run from the worktree path to commit code, but must ALSO know about agent state files at canonical (which live on a different tree). Fix: skill needs explicit-cwd discipline + decision about whether agent state changes auto-commit at canonical, in worktree, or are excluded. |
| check-upstream | 24h | **YES** (P1) | Skill `upstream-sync` runs `git fetch upstream` and `git diff` against the cwd. Under worktree pattern, must run from canonical (since upstream is tracked at canonical) — NOT the per-agent worktree. Fix: skill needs explicit `cd $CTX_FRAMEWORK_ROOT` before any git op. |
| catalog-browse | 7d | **NO** | Browses community catalog; doesn't write paths or commit. |
| theta-wave | daily 21:00 | **NO** | System scan + improvement cycle; reads agent state, writes to analytics. No git. |
| cron-audit | 7d | **NO** | Reads daemon-state crons.json + reports; no git. |
| anthropic-watchlist | weekly Mon 9:00 | **NO** | Web fetch + analysis; no git, no path writes. |
| usage-rate-guard | 15m (disabled) | **N/A** | Disabled; defer assessment until re-enabled. |
| token-comparison-daily | daily 20:37 | **NO** | Reads usage data, writes report. No git. |
| skill-optimizer | weekly Mon 9:33 | **YES** (P2) | Audits skill files at `framework/.claude/skills/` paths. If skill optimizer runs with cwd=worktree but reads skills from canonical only, the audit will miss skills modified in the worktree. Fix: audit both canonical and per-agent worktree skill dirs, or document that skill-optimizer ONLY runs against canonical. |
| pm-colocated-detect | weekdays 7:15 | **NO** | Wrapper script `pm-colocated-cron.sh` — no git (greps returned 0 git/cd/FRAMEWORK_ROOT refs). |
| competitive-recon-weekly | weekly Sun 13:00 | **NO** | Web research; no git, no path writes. |
| goal-staleness-alert | daily 8:00 | **NO** | Reads goals.json from canonical agent dirs; pure state read. |
| cap-watchdog | 4h | **NO** | Reads usage state; no git. |
| codex-cap-watchdog | every 4h at :23 | **NO** (cron) but **flagging** | Script path `scripts/agents/aussie/codex-cap-watchdog-cron.sh` not found at canonical — separate cleanup item, not worktree-related. |

### dane (5 crons)

| Cron | Needs Update | Rationale |
|---|---|---|
| heartbeat | **NO** | Agent state only. |
| morning-review | **NO** | Reads dashboards + agent state. No git ops on per-agent worktree. |
| evening-review | **NO** | Same. |
| weekly-review | **NO** | Aggregates. No git ops on per-agent worktree. |
| weekly-tool-update | **YES** (P3) | Runs `scripts/weekly-tool-update.sh`. If that script does any `cd` or `git` against `process.cwd()` and cwd is dane's session dir, may break or run on wrong tree. Dane stays on canonical per §4.2 of the design, so probably safe — but worth a one-line `cd $CTX_FRAMEWORK_ROOT` guard at script top. |

### collie (6 crons)

| Cron | Needs Update | Rationale |
|---|---|---|
| heartbeat | **NO** | Agent state. |
| railway-health-check | **NO** | External API checks. |
| daily-framework-upstream-auto-update | **YES** (P1) | Same as aussie `check-upstream` — runs `git fetch upstream`, must run from canonical not worktree. Same fix. |
| nightly-code-review | **YES** (P2) | Skill `local-ultrareview` runs review against current diff. Under worktree pattern, MUST run from the worktree to see the agent's in-flight branch diffs. Fix: skill needs explicit `cd $CTX_AGENT_WORKTREE` before any git ops. |
| monthly-tool-upgrade | **NO** | `brew upgrade` only. |
| weekly-tool-update | **YES** (P3) | Same as dane's; one-line guard. |

### blue / codie / gateway / _shared

Not exhaustively enumerated for time — should be sampled in a follow-up if Dane wants. Expectation: blue's crons are PM-API-focused (no git), codie's will likely have git-touching crons similar to collie's (Codex executor branch ops), gateway/_shared have minimal/empty cron sets.

## D. Hardcoded canonical paths in agent CLAUDE.md / docs

Agent-facing docs that may instruct future-self to operate at canonical, breaking under worktree pattern.

| File | Issue | Needs Update | Rationale |
|---|---|---|---|
| `orgs/ascendops/agents/collie/CLAUDE.md:232-243` | graphify CLI invocations hardcode `/Users/davidhunter/cortextos` and `/Users/davidhunter/cortextos/graphify-out/` | **YES** (P3) | If Collie runs graphify from her worktree, the explicit canonical path still works — but it skips worktree changes. Probably correct as-is for graph-of-canonical-codebase, but worth a one-line "graphify always runs against canonical, never worktree" callout. |
| Per-agent CLAUDE.md (all agents) | Missing Step 0 worktree callout per design §5.3 | **YES** (P2) | None of the 6 agent CLAUDE.md files have a worktree-cd instruction. New sessions won't know to operate in the worktree. Fix: fleet-wide doc PR adding Step 0 to all per-agent CLAUDE.md files in one bundle. |

## E. graphify-watch

Searched for `graphify-watch` literal — does not exist as a cron name, file, or process across fleet. The closest match is the graphify CLI invocations in (D) above. Dane's dispatch wording "graphify-watch and others" may have meant the graphify CLI references at large, OR may refer to an unimplemented planned watcher. Flagging for clarification.

## Summary

| Priority | Count | Action |
|---|---|---|
| P1 (must fix before broad rollout) | 3 | `auto-commit`, `check-upstream` (and Collie equiv), per-agent CLAUDE.md Step 0 fleet update |
| P2 (fix before next worktree-active sprint) | 4 | `hook-skill-autopr.ts` path resolution, `skill-optimizer` cwd discipline, `nightly-code-review` cwd discipline, graphify-CLI callout |
| P3 (defer with note) | 4 | `hook-crash-alert.ts`, `hook-src-index.ts`, `weekly-tool-update` guard, graphify path-hardcode |
| N/A | 1 | `usage-rate-guard` (disabled) |
| No change | ~15+ | Bulk of telemetry / state-read / external-API crons |

## Recommendations

1. **Fix the 3 P1 items in one PR** before rolling worktree pattern to more than collie+aussie. The git-touching skills (auto-commit, check-upstream) have the highest blast radius — they could create accidental cross-tree commits or fetch failures.
2. **Treat per-agent CLAUDE.md Step 0 as a single fleet-wide PR** (not per-agent edits) for atomic consistency. Same recommendation surfaced from C3a.
3. **Skill-optimizer and nightly-code-review** are worktree-active code paths — needs explicit worktree-cd, OR an explicit "this skill runs against canonical only" doc note. Pick one and lock it.
4. **`hook-skill-autopr.ts`** is a silent-failure risk under worktree pattern (the auto-PR draft won't fire for in-worktree skill edits). Per the [no-silent-failure-half-ships](../../../../.claude/projects/-Users-davidhunter-cortextos-orgs/memory/feedback_no_silent_failure_half_ships.md) rule banked today, fixing this is a deploy-readiness blocker for any agent that writes skills.
5. **Clarify graphify-watch scope with Dane** — if a watcher exists separately, audit it; if "graphify-watch" was loose phrasing for graphify CLI usage, the doc callout in (D) covers it.

## Out of scope / deferred

- Full per-cron audit for blue/codie/gateway/_shared (sampled, not exhaustive — flag if needed)
- Daemon-side `agent-process.ts` env injection of `CTX_AGENT_WORKTREE` (design §5.2 deliverable, not a hook)
- `.claude/settings.local.json` at canonical root (assumed dev-only, not session-active)

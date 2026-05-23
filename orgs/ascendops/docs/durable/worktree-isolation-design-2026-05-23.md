# Worktree Isolation Design (cortextOS fleet)

**Author:** collie
**Date:** 2026-05-23
**Source dispatch:** Dane msg 1779543514224 (David greenlit fleet-ops fix)
**Status:** DESIGN — surface for Dane review BEFORE coding bulk

---

## TL;DR

Each agent gets a private `git worktree` rooted at `~/.cortextos/default/.cortextOS/state/agents/{agent}/worktree/`, sharing the same `.git/` objects as the canonical `/Users/davidhunter/cortextos` checkout but with its own HEAD + index. Checkouts and commits stay scoped to that agent; concurrent agents no longer race on the shared working tree.

**Net behavior change:** when an agent does `git checkout` or `git commit`, only its own worktree is affected. The 3 branch collisions logged on 2026-05-22 (my stray C5 commit landing on Aussie's branch, etc.) become structurally impossible.

---

## 1. Current State (the problem)

All fleet agents `cd /Users/davidhunter/cortextos` then operate git directly. The repo has a single working tree, single HEAD, single index. Concurrent operation races:

| Event | Effect |
|---|---|
| Agent A: `git checkout branch-a` | repo HEAD points to branch-a |
| Agent B starts work in same instant | inherits branch-a as HEAD instead of expected main |
| Agent B: `git commit` | commit lands on branch-a (wrong branch) |
| Agent A: `git push` | pushes Agent B's commit too (cross-contamination) |

**Confirmed instances 2026-05-22 (per Dane dispatch):**
1. Collie C5 commit (`2320b08`) → Aussie `chore/knowledge-md-track-and-correct` branch
2. Aussie typo fix (`ea9b5b3`) → on top of that wrong-branch chain
3. Recovery: force-push + cherry-pick rounds + CI re-runs

Total recovery cost: ~30 min collie + ~15 min Aussie + 2 wasted CI runs.

## 2. Why git worktree (not other alternatives)

| Option | Notes | Verdict |
|---|---|---|
| Per-agent full clone | Heavy disk (4× ~200MB), separate `.git`, refs don't sync | REJECT |
| Per-agent branch + checkout discipline | Same shared HEAD race, just hopes agents don't conflict | REJECT (current — confirmed broken) |
| `git worktree add` | Separate working dir + HEAD + index, shared `.git/objects/`, native git feature | **ACCEPT** |
| Containers / chroot | Isolates filesystem but overkill for shell-level isolation | REJECT (out of scope) |

`git worktree` is the canonical git feature for exactly this problem.

## 3. Proposed Architecture

### 3.1 Path scheme

```
/Users/davidhunter/cortextos/             # canonical (Dane's worktree; orchestrator)
~/.cortextos/default/.cortextOS/state/agents/{agent}/worktree/   # per-agent worktree
```

Per-agent paths (concrete):
- `~/.cortextos/default/.cortextOS/state/agents/collie/worktree/`
- `~/.cortextos/default/.cortextOS/state/agents/aussie/worktree/`
- `~/.cortextos/default/.cortextOS/state/agents/codie/worktree/`
- `~/.cortextos/default/.cortextOS/state/agents/blue/worktree/`

Rationale for path location:
- Lives under the existing `state/agents/{agent}/` convention (analogous to `memory/`, `.onboarded`, etc.)
- Filesystem isolation natural — each agent already owns its `state/agents/{agent}/` subtree
- Survives daemon restart (state dir is persistent)

### 3.2 Branch scheme

Each agent's worktree defaults to `main` on init. When the agent starts a new task, they create a feature branch FROM their worktree:

```bash
cd $WORKTREE
git fetch origin main
git checkout -b chore/my-feature origin/main
# ... work ...
git push -u origin chore/my-feature
gh pr create ...
```

No per-agent persistent branch is needed — branch namespacing is by task name (with optional `${agent}/` prefix convention for clarity).

### 3.3 Init flow (session-start, one-time idempotent)

```bash
WORKTREE="$CTX_ROOT/state/agents/$CTX_AGENT_NAME/worktree"
if [ ! -d "$WORKTREE/.git" ] && [ ! -f "$WORKTREE/.git" ]; then
  git -C "$CTX_FRAMEWORK_ROOT" worktree add "$WORKTREE" main
fi
```

(`.git` is a file in linked worktrees, not a dir — both checks needed.)

The worktree is added against `main` so the agent starts fresh on the latest tracked code. The agent can `git checkout` to whatever branch is appropriate for their current dispatch.

### 3.4 Refresh flow (between tasks)

Default: on-demand refresh at task-start time, not periodic:

```bash
cd $WORKTREE
git fetch origin
git checkout main
git reset --hard origin/main
# Now start the new task's branch
git checkout -b chore/new-task
```

Alternative for advanced workflows: keep prior task's branch around if next dispatch is a follow-up (e.g. Codex bot Nit fix). The script should NOT force-reset blindly; let the agent decide when to refresh.

Helper utility:
```bash
$CTX_FRAMEWORK_ROOT/scripts/worktree/refresh-agent-worktree.sh
# Default: fetch + checkout main + reset --hard origin/main
# Flag: --keep-branch <name> to stay on a specific feature branch
```

### 3.5 Dispatch flow

Specialists receive dispatch messages with explicit working-directory note:

```
Dispatch from Dane:
  Task: feat/foo
  Worktree: ~/.cortextos/default/.cortextOS/state/agents/collie/worktree/
  Branch: chore/foo (create from origin/main)
  ...
```

Agents `cd $WORKTREE` as the first step of any code-touching task.

For agents that auto-discover their worktree (recommended): use the env var `$CTX_AGENT_WORKTREE` set by the daemon at session-start:

```bash
export CTX_AGENT_WORKTREE="$CTX_ROOT/state/agents/$CTX_AGENT_NAME/worktree"
```

Then agents just `cd $CTX_AGENT_WORKTREE` without needing to know the path scheme.

### 3.6 Hooks + graphify-watch

The existing graphify-watch hook fires on git events in the canonical repo. With worktrees, git events fire in each worktree but the hooks live in the canonical .git/hooks/ (shared via worktree pointer).

Action: verify graphify-watch + other hooks are worktree-aware. If they hardcode paths like `/Users/davidhunter/cortextos`, they will operate on the canonical tree even when the agent committed in their worktree. Most read-only hooks (graph rebuild) are fine; write-back hooks may need worktree-aware paths.

Defer detailed audit to post-design-lock. Specific hooks to verify:
- `graphify watch` (rebuild on commit)
- `bus-event-on-commit` if any
- `daemon-cron-hot-reload` if it tracks file changes

## 4. Migration Plan

### 4.1 Existing agents

For each agent currently running (collie, aussie, codie, blue, dane):

1. **On next session-start**, the init script runs `git worktree add` if the worktree doesn't exist
2. The agent's prior shared-checkout work is NOT migrated (it was on the canonical tree)
3. Any uncommitted changes on the canonical tree at migration time stay there; the agent should commit/push them BEFORE migration kicks in

### 4.2 Dane (orchestrator)

Dane stays on the canonical `/Users/davidhunter/cortextos` tree. The orchestrator doesn't need worktree isolation since it doesn't write code on the same scope as specialists. Dane's role is dispatch + review, not commit-heavy execution.

### 4.3 Backwards compat

Until the worktree pattern is fully rolled out, agents that haven't migrated stay on canonical and continue to risk collisions. Roll out in order:
1. Collie (most active code agent — highest collision risk)
2. Aussie (system-analyst — frequent quick scripts)
3. Codie (Codex executor — long-running tasks vulnerable to mid-flight)
4. Blue (PM ops — light git use)

### 4.4 Existing branches at migration time

When an agent migrates to a worktree, any in-flight feature branches still exist in `.git/refs/heads/`. The worktree can `git checkout` them directly:

```bash
cd $WORKTREE
git checkout chore/my-existing-branch
```

No data loss.

## 5. Deliverables

### 5.1 Scripts (new)

| File | Purpose |
|---|---|
| `scripts/worktree/init-agent-worktree.sh` | Create worktree if missing (idempotent) |
| `scripts/worktree/refresh-agent-worktree.sh` | Sync to origin/main, optionally keep branch |
| `scripts/worktree/agent-worktree-path.sh` | Echo the canonical path (resolves env vars) |
| `scripts/worktree/migrate-agent-to-worktree.sh` | One-shot per-agent migration helper |

### 5.2 Daemon updates

| Change | Where |
|---|---|
| Set `$CTX_AGENT_WORKTREE` env var at session-start | `src/daemon/agent-process.ts` (or equivalent) |
| Auto-init worktree if missing | new daemon-side check pre-session-start |

### 5.3 Doc updates

| File | Change |
|---|---|
| `templates/property-management/agent/AGENTS.md` | Add Step 0 "Init worktree" + `cd $CTX_AGENT_WORKTREE` as canonical cwd for all git ops |
| `orgs/ascendops/agents/*/CLAUDE.md` (per agent, locally) | Same Step 0 callout for each agent's specifics |
| `orgs/ascendops/docs/durable/worktree-isolation-design-2026-05-23.md` | This doc (already authored) |

### 5.4 Tests

- Unit test: `init-agent-worktree.sh` creates the dir + valid worktree
- Unit test: `refresh-agent-worktree.sh` syncs to origin/main
- Integration test: 2 simulated agents commit on different branches concurrently → no cross-contamination

## 6. Open Questions for Dane

1. **Path scheme:** `$CTX_ROOT/state/agents/{agent}/worktree/` (proposed) vs. a separate `~/.cortextos/worktrees/{agent}/` tree. Lean toward state/ for filesystem locality with other per-agent state. Confirm?
2. **Refresh policy:** on-demand at task-start (proposed) vs. periodic cron. Lean on-demand. Confirm?
3. **Dane treatment:** stays on canonical tree (proposed) vs. also gets a worktree for consistency. Lean canonical for Dane — orchestrator dispatches not commits. Confirm?
4. **Migration urgency:** start with Collie this session (today), roll others over Saturday/Sunday? Or all-at-once batch?
5. **Hooks audit:** defer to post-design-lock (proposed) or do it now to scope risk? Lean defer.

## 7. Build Sequence (post-design-lock)

1. Init/refresh shell scripts (Lane A sub-agent)
2. Daemon env-var injection (Lane B sub-agent — needs framework code touch)
3. AGENTS.md template update + migration doc (Lane C sub-agent)
4. Tests + integration sim (Lane D sub-agent — or rolled into A)
5. Collie-side migration (do first, dogfood)
6. Roll out Aussie / Codie / Blue
7. Hooks audit

Total ETA estimate: ~2-3h once design locks, with 3-4 sub-agents in parallel after Lane A finishes.

## 8. Risks + Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Disk space (4× ~200MB worktrees ≈ 800MB-1GB) | LOW | Easy monitoring; not large by modern standards |
| Hooks misbehave with linked worktrees | MEDIUM | Audit pass before rollout; most hooks read-only |
| Agent forgets to `cd $WORKTREE` and runs git in canonical | MEDIUM | Daemon-injected env var + AGENTS.md Step 0 enforcement |
| `.git/` lock contention during concurrent commits | LOW | git handles internal lock at ref level; .git/objects/ packfile writes are atomic per git docs |
| Existing in-flight branches at migration | LOW | All branches accessible from new worktree via normal checkout |

## 9. Next Step

Surface this design to Dane for approval. After lock:
- Spawn 3-4 sub-agents per build sequence §7
- Land single PR with all scripts + tests + doc updates
- Dogfood on Collie first; roll others after observation window

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

# Patch 3 spec — Resume Codex threads on normal agent restarts

**Status:** Draft spec for Codie implementation (Plan → Codex → Review)
**Author:** collie (workflow-inversion split — Patches 1/2/4 written by collie, this one kept on Codies plate per startup-flow semantics)
**Date:** 2026-05-14
**Source:** Codex auto-review on noogalabs/ascendops PR #25, P1 finding on `src/pty/codex-app-server-pty.ts:478`
**PR target:** `grandamenium/cortextos`
**Sibling commits:** branch `fix/codex-review-pr-24-25-patches` (already pushed, has Patches 1/2/4)

---

## The bug

`startOrResumeThread` (src/pty/codex-app-server-pty.ts:477) only calls `thread/resume` when `mode === 'continue'`. But the mode is decided upstream by `AgentProcess.shouldContinue()`, which currently inspects `~/.claude/projects/<cwd-encoded>/*.jsonl` to detect a Claude-Code session worth resuming.

Codex agents don't write to `~/.claude/projects/` — their thread state lives in the codex app-server's own session store (and in our `state/<agent>/codex-thread.json` pointer that `readThreadState()` reads at line 479). So `shouldContinue()` returns `false` for codex agents on every daemon restart, the PTY is spawned with `mode = 'fresh'`, and `startOrResumeThread` skips the entire resume branch.

**Effect:** codex agents lose thread continuity on every daemon restart. Conversation history, in-flight reasoning, and turn state all reset. The Codex review caller flagged this as P1.

---

## Fix options

### Option A — Resume-first in startOrResumeThread, regardless of mode (recommended)

Smallest blast radius. Inside `startOrResumeThread`, before honoring `mode === 'fresh'`, attempt a best-effort resume:

```typescript
private async startOrResumeThread(mode: 'fresh' | 'continue'): Promise<void> {
  // Best-effort resume even when mode === 'fresh'. AgentProcess.shouldContinue()
  // inspects Claude-Code history under ~/.claude/projects/, which codex agents
  // never write to — so codex agents arrive here in 'fresh' mode after every
  // daemon restart even when a persisted thread exists. Honor the persisted
  // thread if we have one, fall through to a fresh start otherwise.
  const persisted = this.readThreadState();
  if (persisted) {
    try {
      const resumed = await this.request<ThreadResponse>('thread/resume', {
        threadId: persisted.threadId,
        cwd: this._cwd,
        ...THREAD_PERMISSION_OVERRIDES,
        config: { features: { goals: true } },
        excludeTurns: true,
        persistExtendedHistory: true,
      });
      this.setThreadId(resumed.result?.thread.id || persisted.threadId);
      return;
    } catch (err) {
      this._outputBuffer.push(`[codex-app-server] persisted resume failed: ${err}\n`);
    }
  }

  if (mode === 'continue') {
    const latest = await this.findLatestThreadForCwd();
    if (latest) {
      const resumed = await this.request<ThreadResponse>('thread/resume', {
        threadId: latest,
        cwd: this._cwd,
        ...THREAD_PERMISSION_OVERRIDES,
        config: { features: { goals: true } },
        excludeTurns: true,
        persistExtendedHistory: true,
      });
      this.setThreadId(resumed.result?.thread.id || latest);
      return;
    }
  }

  const started = await this.request<ThreadResponse>('thread/start', {
    cwd: this._cwd,
    ...THREAD_PERMISSION_OVERRIDES,
    config: { features: { goals: true } },
    sessionStartSource: 'startup',
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  });
  this.setThreadId(started.result!.thread.id);
}
```

**Key change vs current code:** the persisted-resume block is hoisted ABOVE the `mode === 'continue'` gate, so it runs in both modes. The `findLatestThreadForCwd()` fallback stays gated on `mode === 'continue'` because that branch can scoop up *any* recent codex thread under the cwd — that's broader and should only fire when the daemon explicitly asks for continue.

**Why this option:** minimal change, fail-safe (resume tries, falls back to start on error), doesnt require touching `AgentProcess.shouldContinue()` or its dependents.

### Option B — Teach shouldContinue() to detect codex thread state

Fix the upstream signal. In `src/daemon/agent-process.ts`, extend `shouldContinue()` (or a sibling helper) to also check for codex thread state at `$CTX_ROOT/state/<agent>/codex-thread.json` (or whatever path `writeThreadState()` writes to in codex-app-server-pty.ts). Return true if that file exists.

This option is more architecturally honest — the mode signal stays accurate, callers downstream of mode (telemetry, logs) see the right value. But it requires changes in multiple files and care to keep claude/codex detection paths from interfering.

**Recommendation: Option A unless Codie has a reason to prefer Option B.** A is contained to one function in the PTY adapter, B touches the broader daemon. The Codex finding can be closed by either, but A ships faster and is easier to revert.

---

## Acceptance criteria

1. After a daemon restart, a codex agent with persisted thread state in `state/<agent>/` resumes the same `threadId` rather than starting a fresh one.
2. A codex agent with NO persisted state still boots cleanly via `thread/start` (no regression on first-run).
3. Existing claude agents are unaffected — their `AgentProcess.shouldContinue()` path still drives `--continue` behavior.
4. The persisted-resume failure path still logs to `_outputBuffer` and falls through to `thread/start` (no crash on stale thread IDs).
5. One new test case in `tests/` covers the restart-with-persisted-state path.

---

## Smoke test

```bash
# 1. Spin up a codex-app-server agent and have it run one turn
cortextos add-agent codex-smoke --template agent-codex --runtime codex-app-server
cortextos start codex-smoke
# Send a message via Telegram or bus, confirm reply, note the threadId in
# state/codex-smoke/codex-thread.json

# 2. Restart the daemon
cortextos stop codex-smoke && cortextos start codex-smoke

# 3. Verify threadId stayed the same
cat ~/.cortextos/default/state/codex-smoke/codex-thread.json
# Expected: same threadId as before restart, NOT a new one.

# 4. Send another message and confirm context is preserved
# Send: "what did i ask you previously?" — agent should recall
```

---

## Out of scope

- Recovering from an app-server upgrade that invalidates old thread IDs (separate concern; the failure path already falls through to `thread/start`)
- Persisting Codex thread state across `cortextos init` reruns (different surface)
- Cross-host thread portability (not a real use case yet)

---

## Loop-back

After the implementation PR is up:
- Tag me on the PR for review (I wrote the spec, so a second pair of eyes from a coder makes sense)
- Land after CI green and a smoke run on collie or codie itself
- Coordinate with the persona PRs (#24/#25 in noogalabs/ascendops) for rebase order

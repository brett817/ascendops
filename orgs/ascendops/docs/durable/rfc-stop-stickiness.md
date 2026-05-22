# RFC: Stop Stickiness — sticky-disable behavior for cortextos agents

**Author:** Collie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review
**Item:** Thursday plate #1 (of 13)
**Companion task:** none yet — RFC only, no code

---

## 1. Problem

cortextos agents are sticky-on by default: once `cortextos start <agent>` runs, the daemon keeps the Claude Code PTY alive until `max_session_seconds` elapses (default `255600` = ~71h, `src/daemon/agent-process.ts:721`). Idle has no effect on PTY lifetime — the only termination paths are session timeout, manual `cortextos stop`, or crash. The fleet pays token cost for every cron injection, every `--continue` bootstrap, and every fast-checker-driven wake regardless of whether anything productive happened since the last cycle.

**Observed cost drivers when sticky:**

- **Crons fire into a live PTY.** Heartbeat at 2h, railway-health at 6h, daily framework + dane-iq + nightly-review crons each push a `[SYSTEM] ...` injection through `injectMessage` (`agent-process.ts:325, 335`). Each injection wakes Claude with full conversation context attached → input tokens billed.
- **--continue bootstraps re-read AGENTS.md, restore crons, check inbox, send back-online.** Every fleet-wide rapid restart (e.g. when David reloads configs) pays this cost per agent, even agents that had nothing to do.
- **Fast-checker poll loop runs continuously** (`fast-checker.ts:300`) regardless of PTY activity — Telegram + Gmail watch + inbox scan every `pollInterval` (default 1s).
- **Tonight's manual disable** of Aussie/Blue/Collie was the ad-hoc form of what we're formalizing: take the PTY down when the agent has no work, leave wake-channels armed for when it does.

## 2. Goals / Non-Goals

**Goals**

- Reduce idle token burn fleet-wide by stopping the PTY when an agent has been idle for a configurable threshold.
- Preserve every existing wake channel (Telegram inbound, agent-to-agent inbox, Gmail watch trigger, manual `cortextos start`, scheduled cron) — disabling stickiness must NOT change *what* wakes an agent, only *when the PTY exists*.
- Per-agent opt-in/out so orchestrators (Dane) can stay sticky while specialists (Blue/Aussie/Collie) auto-disable.
- Zero behavior change for agents that don't opt in; default is the current sticky-always-on.

**Non-Goals**

- Replacing `max_session_seconds`. That's a separate hard upper bound; stickiness is about lower-bound idle handling.
- Changing the cron framework (we're not moving crons to a separate scheduler).
- Solving the cost of bootstrap itself. If a cron *does* fire while disabled, the wake still pays bootstrap cost — this RFC reduces *frequency*, not per-wake cost.
- Auto-shutting down on every Stop-hook fire. That's too aggressive; one cron/message sequence often spans multiple Stop fires.

## 3. Proposed Sticky-Disable Behavior

A new agent state `'idle-disabled'` joins the existing `'starting'|'running'|'stopped'|'crashed'` set in `agent-process.ts:39`. Transitions:

```
running ── idle for `idle_threshold_s` ──▶ idle-disabled  (PTY torn down, fast-checker stays alive)
idle-disabled ── any wake trigger ──▶ starting ──▶ running
```

**Idle definition (reuse existing signals):**
- `last_idle.flag` written by Stop hook (`agent-process.ts:1004`) timestamps the agent's last turn end.
- A new background loop in `AgentProcess` checks: if `now - last_idle_flag_ts > idle_threshold_s` AND `fast-checker.isAgentActive() === false` (`fast-checker.ts:1797`) AND no cron is scheduled to fire within the next `idle_threshold_s/2`, transition to `idle-disabled` and call the existing PTY teardown path.

**Wake triggers (all already exist — we only need to wire them to "start the PTY if `idle-disabled`"):**
- Telegram inbound message: fast-checker already has SIGUSR1 + IPC 'wake' (`fast-checker.ts:174, 325`). Extend the wake handler to call `agentManager.start(name)` when `status === 'idle-disabled'`.
- Inbox message from another agent: same path.
- Gmail watch hit: same.
- Cron fire: cron scheduler currently calls `injectMessage` against a running PTY. New behavior: if PTY is `idle-disabled`, `agentManager.start(name)` first, then queue the injection until `status === 'running'`.
- Manual `cortextos start <agent>` / `wake-agent`: idempotent — already a no-op if running, becomes a re-start if `idle-disabled`.

## 4. Per-Agent Config Knob

Add to `config.json`:

```json
{
  "stickiness": {
    "mode": "always" | "auto-disable",
    "idle_threshold_s": 1800,
    "wake_on_cron": true,
    "wake_on_inbox": true,
    "wake_on_telegram": true
  }
}
```

**Defaults by agent template:**

| Template | mode | rationale |
|---|---|---|
| orchestrator (Dane) | `always` | needs to react to any fleet event without wake latency |
| analyst (Aussie) | `auto-disable`, threshold `3600s` | mostly long-form research, idle gaps frequent |
| agent (Blue, Collie, others) | `auto-disable`, threshold `1800s` | event-driven specialists; most time is spent waiting |

Backwards compat: missing `stickiness` key → `mode: "always"` (today's behavior).

## 5. Cron Firing While Disabled

**Current behavior:** cron scheduler calls `injectMessage((data) => this.pty?.write(data), ...)` (`agent-process.ts:985, 1061`). If `this.pty` is null (disabled), the injection silently no-ops — the cron's prompt is *lost*, not queued.

**Proposed behavior:** wrap the inject path. If `status === 'idle-disabled'`, call `agentManager.start(name)`, await `status === 'running'`, then `injectMessage`. The cron's prompt becomes the agent's first turn after wake, replacing the bootstrap-only wake.

**Edge case:** rapid back-to-back cron fires while still booting — the second one should queue, not double-start. Use a `wakeInProgress` boolean guard.

## 6. Inbox + Telegram While Disabled

Fast-checker is independent of the PTY (it's a separate poll loop in the same Node process — `fast-checker.ts:25, 131`). It currently writes inbox entries via `sendMessage` to `inbox/` files and pushes Telegram messages via `injectMessage` to the PTY.

**Proposed:** fast-checker checks `agentProcess.status` before each `injectMessage`. If `idle-disabled`, queue the inbox message to a `pending-wakes/` directory, call `agentManager.start(name)`, and on `running` replay the queue as injections in order.

Telegram inbound: same. Critically, the user-facing wake latency is the agent boot time (~3-5s) — acceptable for chat, not for safety/dispatch.

## 7. Migration

1. Land config schema + defaults; all agents stay `mode: "always"` because no config has the key.
2. Land idle-detection loop and `idle-disabled` state, gated behind `stickiness.mode === "auto-disable"`.
3. Land wake-on-event paths (cron, inbox, Telegram).
4. Opt one specialist agent (Collie) into `auto-disable` for a 24h soak. Watch fleet logs for missed cron fires, dropped inbox messages, wake latency.
5. Opt remaining specialists in.
6. Hold orchestrator (Dane) on `always` indefinitely — re-evaluate after 7d if specialists are stable.

Rollback: flip the agent's `mode` back to `always`, restart. No data migration.

## 8. Open Questions for David

1. **Wake latency tolerance:** ~3-5s for chat is fine. Is it fine for Telegram-driven dispatch (e.g. an emergency meld)? If not, Blue stays `always`.
2. **Idle threshold for Blue specifically:** 1800s default could mean a tenant's reply at 31min lands while she's disabled — adds wake latency to a chat she was already mid-flight on. Consider lower threshold (e.g. 600s) for Blue.
3. **Cron-only wake-and-shutdown:** for low-frequency daily crons (framework-upstream-update, dane-iq-build-check), should the agent immediately re-disable after the cron's turn finishes, or stay running for `idle_threshold_s`? The latter is simpler, the former is cheaper.
4. **Should `cortextos status` show `idle-disabled` distinctly from `stopped`?** Yes, recommended — it clarifies that the agent is *expected* to wake on next event.
5. **Heartbeat at 2h cron when disabled:** is heartbeat itself worth waking the PTY for, or should heartbeat be moved to fast-checker (like usage-rate-guard was in PR #74)? If yes, that's a follow-up RFC.

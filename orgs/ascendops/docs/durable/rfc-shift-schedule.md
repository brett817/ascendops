# RFC: Shift-Schedule Formalization — recurring on/off windows per agent

**Author:** Collie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review
**Item:** Thursday plate #4 (of 13)
**Companions:** [rfc-stop-stickiness.md](./rfc-stop-stickiness.md) (#1) — sticky-disable defines *whether the PTY exists*; this RFC defines *when the PTY should be expected to exist or not*.

---

## 1. Problem

Agent shifts today are ad-hoc. `config.json` already carries `day_mode_start` / `day_mode_end` per agent (`src/types/index.ts:183-184, 245-246`):

| Agent | day_mode | timezone |
|---|---|---|
| Dane | 07:30–19:30 | America/New_York |
| Blue | 07:30–20:30 | America/New_York |
| Aussie | 07:30–19:30 | America/New_York |
| Collie | 07:30–19:30 | America/New_York |

These fields are **read but not enforced** — `src/cli/get-config.ts:50-68` returns them for display, but no daemon path gates cron firings, fast-checker polls, or wake injections on whether *now* falls inside `day_mode`. As a result:

- A 2h heartbeat cron at 03:07 EDT injects into Blue's PTY even though "Blue should be asleep." She wakes Claude, burns tokens, writes a heartbeat, sleeps until 05:07. Repeat all night.
- The `nightly-code-review` cron at 00:01 EDT is the inverse — explicitly off-shift on purpose, but indistinguishable to the daemon from a wrongly-fired off-shift cron.
- Sunday no-work standing rule (`feedback_sunday_no_work.md`) is enforced *behaviorally inside the agent's reasoning* — Blue checks `date +%A` and self-suppresses non-emergencies. The daemon has no concept of day-of-week.
- Brittany Nashville-pause + Chattanooga-pest routing (`project_brittany_nashville_pest.md`) similarly lives in agent memory rather than schedule config.

Once the sticky-disable RFC (#1) lands, every off-shift cron becomes an unwanted *boot* — far more expensive than today's "wake the already-running PTY." Shift formalization gates cron + wake decisions before they hit the agent.

## 2. Goals / Non-Goals

**Goals**
- Per-agent `shift_schedule` field in `config.json` defining recurring weekly on-windows + per-day overrides + emergency override carve-out.
- Daemon-level evaluator (new `src/daemon/shift.ts`) that returns `{in_shift, off_shift_emergency_only, off_shift_no_wake}` for `now`.
- Cron framework, fast-checker, and sticky-disable all consult the evaluator before injecting / waking.
- Reuse `config.timezone` for all shift evaluation; never use system-local time.
- Backwards compat: missing `shift_schedule` → 24/7 in-shift (today's behavior).

**Non-Goals**
- **Not a calendar/PTO system.** No vacation tracking, no per-date approvals, no integration with Google Calendar.
- **Not a routing layer.** Off-shift agents queue work or escalate to a different on-shift agent — the *escalation* logic belongs in agent reasoning, not in this schema.
- **Not a replacement for `nighttime-mode/SKILL.md`.** That skill governs *agent behavior at night* (e.g. don't dispatch vendors); this RFC governs *whether the PTY is even invoked at night*.
- **No SLA tracking.** Off-shift response latency is a separate metric.

## 3. Schema

Replace `day_mode_start` / `day_mode_end` with a structured field:

```json
{
  "shift_schedule": {
    "weekly": {
      "mon": { "start": "07:30", "end": "19:30" },
      "tue": { "start": "07:30", "end": "19:30" },
      "wed": { "start": "07:30", "end": "19:30" },
      "thu": { "start": "07:30", "end": "19:30" },
      "fri": { "start": "07:30", "end": "19:30" },
      "sat": { "start": "07:30", "end": "21:00" },
      "sun": "off"
    },
    "exception_days": [
      { "date": "2026-12-25", "shift": "off", "reason": "Christmas" },
      { "date": "2026-07-04", "shift": { "start": "10:00", "end": "16:00" }, "reason": "July 4" }
    ],
    "emergency_override": {
      "off_shift_can_wake_for": ["safety", "flood", "fire", "no_heat_freezing", "user_explicit"]
    }
  }
}
```

`weekly.<day>` accepts: `{ start, end }`, `"off"`, or `"24h"`.
`exception_days[].shift` accepts the same.
`emergency_override.off_shift_can_wake_for` is a free-form tag set; the agent's reasoning + the wake source decide whether a given event matches.

Backwards compat: existing `day_mode_start` / `day_mode_end` continue to work. If `shift_schedule` is present it wins; if absent the legacy fields are auto-promoted to `weekly: { mon-fri: {start, end}, sat: same, sun: same }`. Eventually the legacy fields deprecate after a 1-quarter overlap.

`config.timezone` (already present at agent level — `dane/config.json:6`) is reused. Shift evaluation always converts `now` into the agent's timezone before matching.

## 4. Behavior Matrix

| Event | In-shift | Off-shift, emergency-allowed | Off-shift, no-wake |
|---|---|---|---|
| Cron fire (recurring) | inject as today | drop silently, log `cron-suppressed-off-shift` | drop silently |
| Telegram inbound (user) | inject as today | always wake (user is implicit emergency `user_explicit`) | always wake (user override) |
| Inbox from another agent | inject as today | wake **only** if message has `"priority": "high"` AND tag in emergency_override allowlist | drop, queue to `pending-wakes/` |
| Gmail watch trigger | inject as today | drop, queue (Gmail is rarely emergency) | drop, queue |
| Manual `cortextos start` | start as today | start (operator override) | start (operator override) |

`no-wake` differs from `emergency-allowed` only on `Inbox` and `Gmail`. The day-of-week selector (`weekly.sun: "off"` vs `weekly.sun: { start, end }`) determines which mode applies during off-shift.

The user-via-Telegram case is non-negotiable: the user can always wake any agent. This matches existing behavior — fast-checker's SIGUSR1 wake (`fast-checker.ts:174`) ignores all gates.

## 5. Recommended Defaults

| Agent | shift_schedule | Rationale |
|---|---|---|
| Dane (orchestrator) | `weekly: all 24h`, `emergency_override: { off_shift_can_wake_for: [* ] }` | Fleet oversight needs to react any time |
| Blue (specialist, maintenance-facing) | `mon-sat 07:00–21:00`, `sun: "off"` with `emergency_override: ["safety", "flood", "fire", "no_heat_freezing"]` | Mirrors `feedback_sunday_no_work.md` exactly |
| Aussie (specialist, research) | `mon-fri 09:00–18:00`, `sat-sun: "off"` | Long-form research is never urgent enough to wake off-shift |
| Collie (specialist, fleet maintenance) | `mon-fri 09:00–18:00`, `sat-sun: "off"` with `["user_explicit"]` | Same as Aussie but allow user-explicit wake (David doing a config push at 10pm Sat) |
| Relay | n/a — deprecated agent, do not migrate |

Brittany Nashville triage rules (`project_brittany_nashville_pest.md`) remain agent-level reasoning, NOT shift schedule. Reason: they're routing rules per-meld, not time windows. The schedule says *if Blue is awake*; the routing rules say *what Blue does once awake*.

## 6. Interaction with Existing Standing Rules

| Rule | Source | Interaction with shift_schedule |
|---|---|---|
| Sunday no-work | `feedback_sunday_no_work.md` | `weekly.sun: "off"` + `emergency_override` codifies it. Daemon enforces, agent reasoning unchanged. |
| Blue→David direct, Dane gets 4h heartbeat summary | `feedback_blue_dane_comms_pattern.md` | Independent. Comms pattern is *who talks to whom*; shift schedule is *whether each end is awake*. |
| Vendor scheduling order (vendor-first, then resident) | `feedback_vendor_scheduling_order.md` | Independent. Sequencing rule, not time-of-day rule. |
| Brittany Nashville + Chattanooga pest routing | `project_brittany_nashville_pest.md` | Independent. Routing per-meld, evaluated when Blue is awake. |
| Build-phase Opus rule | `feedback_build_phase_opus_rule.md` | Independent. Model selection, not shift. |

The pattern: shift_schedule decides *when the daemon invokes the agent*; standing rules decide *what the agent does once invoked*. They don't overlap.

## 7. Migration

1. Land `shift.ts` evaluator + types — pure function, fully unit-testable, no daemon changes yet. (1 day)
2. Wire cron framework to consult evaluator before `injectMessage` (`agent-process.ts:985, 1061`). Default behavior unchanged because no agent has `shift_schedule` set yet. (1 day)
3. Wire fast-checker inbox + Gmail paths to consult evaluator before `injectMessage` (`fast-checker.ts:1187` area). (1 day)
4. Migrate Aussie's config first — least chat-facing, lowest blast radius. Soak 1 week. (1 week)
5. Migrate Collie next, then Blue, then Dane (Dane stays effectively 24/7 — main effect is just removing the legacy fields).
6. Deprecate `day_mode_start` / `day_mode_end` after 1 quarter of overlap.

Rollback: remove `shift_schedule` from the agent's `config.json`, restart. Falls back to 24/7. No data migration.

## 8. Open Questions for David

1. **Saturday for Blue: 21:00 cutoff or 19:00?** Currently Blue's `day_mode_end` is 20:30 — picking 21:00 in the recommended defaults is a guess. Confirm.
   - **ANSWERED [D4]: 21:00 ET (9 PM) — David 2026-04-29** (Dane recommendation, agree all batch). Carlos works Saturdays; docs lag 1-2h after his typical 5-6pm wrap. Matches weekday cutoff for clean shift-schedule rule. See `decisions-log.md` D4.
2. **`exception_days` source** — manual list in config? Or pull from a shared org-level holidays file (`orgs/ascendops/holidays.json`)? Org-level avoids per-agent drift.
3. **`user_explicit` emergency tag** — should it apply to ALL specialists (Blue, Aussie, Collie, etc.), or only Collie/Aussie (Blue stays strictly safety-only on Sundays)? Argues both ways; David's call.
4. **Off-shift Gmail watch behavior** — drop entirely, or queue and replay on next in-shift wake? Queueing risks stale alerts (Telnyx outage notice from 4am no longer relevant by 9am); dropping risks missing a one-shot signal. Lean drop, but ask.
5. **Per-agent vs per-org defaults** — should new agents inherit a default `shift_schedule` from `orgs/ascendops/context.json` if their `config.json` omits it? Org-level reduces config-file boilerplate.

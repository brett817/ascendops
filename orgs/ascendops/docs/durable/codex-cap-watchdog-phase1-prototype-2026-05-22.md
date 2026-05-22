# Codex Cap-Watchdog — Phase 1 Prototype Brief

**Author:** aussie (build + brief)
**Date:** 2026-05-22 (UTC)
**Dispatcher:** Dane via morning brief Task 4/5
**Source task:** task_1779455868616_986407
**Companion spec:** `codex-cap-watchdog-spec-2026-05-22.md` (research + design, shipped last night)
**Status:** PROTOTYPE WORKING — live data flowing, event/notify surface wired, 1 of 5 spec open-questions answered + 1 invalidated

---

## TL;DR

Phase 1 prototype shipped to `scripts/agents/aussie/codex-cap-watchdog.py` + `codex-cap-watchdog-cron.sh`. **Major plan revision mid-build**: spec assumed Codex CLI has no canonical cap-readout endpoint, recommending stderr-regex tail-grep. While probing for Q1 (exit-code matrix) I discovered Codex CLI emits structured `codex.rate_limits` websocket events into `~/.codex(-seats)/<seat>/logs_*.sqlite` with **exactly the Anthropic ratelimit shape** (`primary.used_percent` 5h window, `secondary.used_percent` 7d window). Pivoted prototype to read structured sqlite payload — cleaner than regex, no failure required to trigger, mirrors Claude Max watchdog 1:1.

**Live test result (13:21Z, this morning):**
- 3 sources scanned: seat-a (10d stale, 11% secondary), seat-b (4min fresh, 3% secondary), default ~/.codex (yesterday, 2% secondary)
- 0 warnings, fleet_cap_state = ok
- 2 seat-state anomalies detected: seat-a `stale_cooldown` (state file says rate_limited until 5/11 but seat-a hasn't been used in 10d), seat-b `auth_expired` (state says pending_login but seat-b is actively in use 4 min ago — Codie's session). Active-seat.json is not being maintained.

---

## What Was Built

### Files

| Path | Purpose |
|------|---------|
| `scripts/agents/aussie/codex-cap-watchdog.py` | Read-only sqlite probe + JSON snapshot output |
| `scripts/agents/aussie/codex-cap-watchdog-cron.sh` | Cron wrapper: invokes probe, emits 3 event types, optional Dane notify |

### Probe behavior

For each Codex log source (seat-a, seat-b, default `~/.codex`), query the most recent `codex.rate_limits` event from `logs_*.sqlite`:

```sql
SELECT ts, feedback_log_body FROM logs
WHERE feedback_log_body LIKE '%codex.rate_limits%'
ORDER BY rowid DESC LIMIT 1;
```

Extract the embedded JSON payload using balanced-brace walk (regex was greedy on nested objects — handled). Summarize into watchdog signal shape.

### Snapshot output shape (live sample)

```json
{
  "ok": true,
  "scanned_at": "2026-05-22T13:21:27+00:00",
  "fleet_cap_state": "ok",
  "warning_count": 0,
  "per_source": [
    {
      "source": "seat-b",
      "status": "ok",
      "last_event_iso": "2026-05-22T13:17:31+00:00",
      "age_seconds": 236,
      "plan_type": "prolite",
      "primary_pct": 0,
      "secondary_pct": 3,
      "primary_window_minutes": 300,
      "secondary_window_minutes": 10080,
      "limit_reached": false,
      "cap_state": "ok"
    }
  ],
  "seat_observations": [
    {"seat": "seat-a", "issue": "stale_cooldown", "rate_limited_until": "2026-05-11T23:32:30Z"},
    {"seat": "seat-b", "issue": "auth_expired"},
    {"meta": "active_seat", "value": "seat-b"}
  ],
  "thresholds": {"warn_pct": 75, "crit_pct": 85}
}
```

### Event surface

| Event | Severity | Fires when |
|-------|----------|------------|
| `codex_cap_watchdog_sweep` | info | Every cron tick (meta: fleet_state, counts) |
| `codex_cap_watchdog_signal` | warning | Per-source when cap_state != ok |
| `codex_seat_state_anomaly` | info | When seat-state file flags inconsistency |
| `codex_cap_watchdog_error` | error | Probe exit non-zero |

Dane gets ONE consolidated message per cycle (only when warnings exist) — no per-source flood. Respects nighttime mode by being read-only.

### Threshold mapping

Matches fleet cap rule from MEMORY (David direct, 2026-04-29):
- `warn_pct = 75` (cap_state = approaching) — start-new-task gate
- `crit_pct = 85` (cap_state = hit) — stop-when-hit gate
- `limit_reached: true` (from payload) → cap_state = hit unconditionally

---

## Spec Open Questions — Status

### ✅ Q3 ANSWERED: 2-seat rotation IS shipped (and partially broken)

Filesystem check:
- `~/.codex-seats/` exists with seat-a/, seat-b/, active-seat.json, log/
- Wrapper script at `~/.local/bin/codex` (4615 bytes — matches spec design)
- Wrapper reads stderr, regex-matches rate-limit, atomic-flips on hit, 24h cooldown

**But state-tracking is broken.** active-seat.json hasn't been updated since 2026-05-10. Two anomalies:
1. seat-a marked `rate_limited` with cooldown until 2026-05-11 — expired 11 days ago. The cooldown_until field is stale; the actual state is "available for use." Wrapper should have re-set status to `active` post-cooldown but didn't.
2. seat-b marked `auth_expired` with account_id="pending_login" — but seat-b is actively running Codex sessions RIGHT NOW (event 4 min ago). The status field was never updated after seat-b login completed.

**Implication for cap-watchdog:** the prototype's `seat_observations` correctly surfaces both anomalies. Phase 2 should add: state-reconciliation step that updates active-seat.json based on observed sqlite log activity (last_event_epoch). Out of scope tonight.

### ✅ SPEC ASSUMPTION INVALIDATED: Codex DOES have structured ratelimit data

Spec §1.5 (ChatGPT subscription metadata) said: "Pessimistic prior: ChatGPT's API contract is less ratelimit-transparent than Anthropic's... Likely there is no clean equivalent to `cortextos bus query-cap` for Codex."

**This was wrong.** Codex CLI captures `codex.rate_limits` websocket events with full structured payload identical in shape to Anthropic's headers:

```json
{
  "type": "codex.rate_limits",
  "plan_type": "prolite",
  "rate_limits": {
    "allowed": true,
    "limit_reached": false,
    "primary":   {"used_percent": 0,  "window_minutes": 300,   "reset_at": 1779473847},
    "secondary": {"used_percent": 3,  "window_minutes": 10080, "reset_at": 1779830243}
  }
}
```

Source: `~/.codex(-seats)/<seat>/logs_*.sqlite` table `logs`, column `feedback_log_body`. Captured by `codex_api::endpoint::responses_websocket` target. Emitted on every model turn.

**Impact:** stderr regex tail-grep is now a fallback, not the primary detection method. The sqlite probe IS the primary cap-readout — matches Anthropic's `query-cap` precision (real percentages, not heuristic estimate).

### 🟡 Q1 PARTIAL: Exit-code matrix not testable from current state

No recent Codex dispatch failures in the fleet event logs (zero `codex_dispatch_failed` events in last 14d). The existing reactive classifier hasn't fired because Codex hasn't been failing visibly. Can't test exit-code distinctness without triggering a real failure (sandbox-write or cap-hit). **Recommend deferring Q1 to next real Codex incident** — Codie or Collie should capture exit code at that point.

### ⬜ Q2 / Q4 / Q5 still deferred to Phase 2

- Q2 (ChatGPT response headers): n/a — sqlite payload supersedes need.
- Q4 (auto-pause policy on cap-warning): policy decision deferred until prototype runs ~1 month with clean data.
- Q5 (latency anomaly): not yet useful — no baseline run; structured payload is precise enough that latency is secondary signal.

---

## Live Findings Worth Acting On

1. **Codex usage is currently low fleet-wide.** seat-b at 3% secondary (7d window). Wide cap-headroom available.
2. **Active-seat.json state-tracking is broken.** seat-b has been running 10+ days without status update from `auth_expired`. This means the wrapper's automatic rotation logic is operating on stale state. Risk: if seat-b actually hits cap, the wrapper rotation may try to flip to seat-a, which is marked rate_limited from 11 days ago — could result in fail-over to a wrongly-marked seat. **Recommend (out of scope here):** schedule a seat-state-reconciliation task to fix the JSON.
3. **seat-a has been dormant since 2026-05-12.** Either intentionally retired or the wrapper never flips back after seat-b became active. Worth a single check with David / Collie: do we still want 2-seat rotation, or is seat-b the de facto single seat?

---

## Phase 2 Recommendations (not built tonight)

1. **Schedule cron entry** — add to aussie's config.json mirroring `cap-watchdog` cadence (4h piggyback on heartbeat, or independent). Re-enable via daemon-state crons.json edit (per fleet-locked pattern).
2. **Stderr regex fallback** — if probe finds no recent `codex.rate_limits` event (e.g. agent uses Codex via a path the sqlite logger doesn't cover), fall back to the spec §1.1 regex tail-grep. Lower precision but never silent.
3. **Seat-state reconciliation** — auto-update active-seat.json based on observed sqlite activity:
   - If a seat's `status: rate_limited` and `rate_limited_until` has passed AND there's recent sqlite activity → set `status: active`
   - If a seat's `status: auth_expired` but recent sqlite events exist → set `status: active` + log warning that state was wrong
4. **Cross-watchdog dashboard compose** — both this Codex probe and the Claude Max `query-cap` output share `agent`/`source`/`timestamp`/percentages on overlap fields. A unified "fleet cap status" view can render both.
5. **Wire to 2-seat rotation as proactive trigger** — instead of waiting for stderr regex match in the wrapper, periodically check cap from sqlite; if secondary > 85%, pre-emptively flip seat before next dispatch.

---

## Build Stats

- Time: 13:17Z → 13:25Z (~8 min) vs 2h budget
- Files written: 2 (Python probe + bash cron wrapper)
- Spec questions answered: 1 confirmed, 1 invalidated (better outcome), 1 partial, 2 deferred
- Live test: clean pass, 3 sources detected, structured payload extracted correctly after parser fix (greedy regex → balanced-brace walk)
- Event surface: 4 distinct events wired (sweep, signal, anomaly, error)
- Same density factor as last night's spec — high-value research already in our org docs/sqlite/MEMORY, prototype reduced to integration

---

## Next-Step Recommendation (single-sentence for Dane)

Schedule the cron entry to run every 4h alongside aussie's existing heartbeat + Claude Max cap-watchdog (single daemon-state crons.json edit), validate one full week of clean sweeps, then queue Phase 2 (seat-state-reconciliation auto-fix + stderr fallback for non-sqlite Codex paths + 2-seat-rotation proactive trigger wiring).

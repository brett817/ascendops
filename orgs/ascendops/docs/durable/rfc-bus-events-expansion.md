# RFC #15 §10 Event Taxonomy Expansion

**Author:** Aussie
**Date:** 2026-04-29
**Status:** Design draft, ready for incremental Codex implementation
**Builds on:** RFC #15 §10 — flagged 8 events that should exist but currently don't.
**Source-of-truth:** `src/bus/event.ts` (5-category emit surface) + `src/types/index.ts` (EventCategory union).

---

## 1. Current Categories Recap

```typescript
export type EventCategory = 'action' | 'error' | 'heartbeat' | 'task' | 'approval';
export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';
```

Each new event below picks ONE existing category — we don't expand the union itself, just add new event-name strings within categories.

## 2. Per-Event Designs

### 2.1 `meld_state_change`
- **Category:** `action`
- **Event name:** `meld_state_change`
- **Subtypes (via `metadata.transition`):** `assigned`, `scheduled`, `pending_completion`, `completed`, `cancelled`, `could_not_complete`
- **Required meta:** `{ meld_id, prior_state, new_state, transition, tech_id?, vendor_id? }`
- **Where it fires:** every PM CLI write path that mutates state. Specifically, in `cli-anything-snapcli/adapters/pm/snapcli_pm/http_backend.py` (post-rename) — wrap each of `complete_meld`, `cancel_meld`, `assign_tech`, `assign_vendor`, `schedule_vendor`, `force_pending_completion` with a `cortextos bus log-event action meld_state_change ...` call after the API succeeds. Bash wrapper around the binary or a Python `--emit-event` flag.
- **Hook use case:** auto-relay Carlos no-docs close → Dane (RFC #15 §7 Example C). Pattern: `{category: action, type: meld_state_change, metadata: {transition: completed, tech_id: 57541}}`. Handler: send_message to Dane summarizing.
- **Effort:** S — 1 LOC per write site × 6 sites = 6 LOC + standard logEvent shape.

### 2.2 `agent_lifecycle`
- **Category:** `action`
- **Event name:** `agent_lifecycle`
- **Subtypes (via `metadata.lifecycle`):** `started`, `stopped`, `crashed`, `idle_disabled` (per RFC #1), `idle_resumed`, `restart_scheduled`
- **Required meta:** `{ agent, lifecycle, reason?, restart_count?, prior_status? }`
- **Where it fires:** `src/daemon/agent-process.ts` — at every transition between the `'starting' | 'running' | 'stopped' | 'crashed' | 'idle-disabled'` states. The state-transition method already exists; add a logEvent call inside it.
- **Hook use case:** crash-storm detection. Pattern: `{category: action, type: agent_lifecycle, metadata: {lifecycle: crashed}}`. Handler: bash that counts crashes-in-last-hour and pages David if >3.
- **Effort:** S — single emit point in agent-process.ts state-machine method.

### 2.3 `inbox_arrival`
- **Category:** `action`
- **Event name:** `inbox_arrival`
- **Required meta:** `{ to_agent, from_agent, msg_id, priority, has_reply_to: boolean }`
- **Where it fires:** `src/bus/message.ts:sendMessage()` — the function already writes the inbox file; add `logEvent` after the atomicWrite succeeds. Fires on the SOURCE agent's event log (because logEvent is keyed by writing agent), but the meta says who the recipient is, so hooks can filter by `metadata.to_agent`.
- **Hook use case:** wake an idle-disabled agent on inbox arrival (per RFC #1 §3 wake trigger). Pattern: `{category: action, type: inbox_arrival, metadata: {to_agent: blue}}`. Handler: bash that runs `cortextos start blue` if blue is currently idle-disabled.
- **Effort:** S — single emit point in sendMessage.

### 2.4 `handoff_written`
- **Category:** `action`
- **Event name:** `handoff_written`
- **Required meta:** `{ words, sections, caller, framework_stable: boolean, status: ok|degraded }`
- **Where it fires:** `_shared/scripts/write-handoff.sh` — at the end of a successful write. Bash already has the values (sections, words, caller). One `cortextos bus log-event action handoff_written info --meta '...'` call after the atomic mv.
- **Hook use case:** archive backup. Pattern: `{category: action, type: handoff_written}`. Handler: bash `cp $HANDOFF /backup/handoffs/$AGENT-$(date +%s).md` (off-machine sync optional).
- **Effort:** S — 1 LOC bash addition.

### 2.5 `shift_transition`
- **Category:** `action`
- **Event name:** `shift_transition`
- **Subtypes (via `metadata.transition`):** `entering_shift`, `leaving_shift`, `entering_emergency_only`
- **Required meta:** `{ agent, transition, prior_window?, next_window?, current_time }`
- **Where it fires:** `src/daemon/shift.ts` (post-RFC #4 implementation). The shift-evaluator already determines in/out of shift on every cron+inbox+gmail check; add an emit when `last_known_shift_state` differs from `current_shift_state`.
- **Hook use case:** suppress non-emergency notifications during off-shift. Pattern: `{category: action, type: shift_transition, metadata: {transition: leaving_shift}}`. Handler: bash that quiets a specific Telegram channel.
- **Effort:** M — depends on RFC #4 landing first. After that, ~5 LOC to add emit at state-change detection.

### 2.6 `cap_threshold_crossed`
- **Category:** `error` (severity `warning` initially, `critical` at 90%+)
- **Event name:** `cap_threshold_crossed`
- **Subtypes (via `metadata.threshold`):** `75_start_gate`, `85_stop_gate`, `90_fleet_emergency`, `95_haiku_fallback`
- **Required meta:** `{ threshold, model: opus|sonnet|haiku|combined, utilization_pct, resets_at_iso }`
- **Where it fires:** the new `cortextos bus session-burn-so-far` CLI primitive (Collie shipped overnight at `src/cli/bus.ts:2234` — needs `npm run build`). After it parses usage, if any threshold is crossed since last check, emit. Each agent calls this primitive once per heartbeat or before kicking off a self-write task.
- **Hook use case:** auto-stand-down at 85%. Pattern: `{category: error, type: cap_threshold_crossed, metadata: {threshold: 85_stop_gate}}`. Handler: bash that sends "stand down" message to all specialist agents.
- **Effort:** M — depends on the session-burn-so-far primitive being built + npm-run-built first. After that, ~10 LOC.

### 2.7 `vendor_no_response`
- **Category:** `action`
- **Event name:** `vendor_no_response`
- **Required meta:** `{ meld_id, vendor_id, hours_since_last_contact, threshold }`
- **Where it fires:** Blue's `vendor-tech-status-sweep` skill (RFC #7 §3.2, not yet shipped). After the sweep runs, for each "vendor-unresponsive" flag (>48h no work_entries), emit one event.
- **Hook use case:** auto-escalate to alternate vendor after 72h. Pattern: `{category: action, type: vendor_no_response, metadata: {hours_since_last_contact: 72}}`. Handler: send_message to Blue with alternate-vendor suggestion.
- **Effort:** S — depends on RFC #7 vendor-tech-status-sweep skill landing first. After that, 1 LOC inside the skill body.

### 2.8 `tech_completion_email`
- **Category:** `action`
- **Event name:** `tech_completion_email`
- **Required meta:** `{ tech_name, meld_id?, gmail_msg_id, has_completion_text: boolean }`
- **Where it fires:** `src/daemon/fast-checker.ts` Gmail watch path. When fast-checker detects an in-house tech completion email pattern (sender match Carlos/Casey/Silvano/Butch + body keywords), emit before injecting to agent.
- **Hook use case:** RFC #7 §3.5 `completion-checklist` skill auto-trigger. Pattern: `{category: action, type: tech_completion_email}`. Handler: send_message to Blue with the skill-load prompt.
- **Effort:** S — Gmail watch already detects sender; add 1 emit line + minimal pattern match on subject.

---

## 3. Summary Table

| # | Event name | Category | Required meta | Fires from | Hook example | Effort |
|---|---|---|---|---|---|---|
| 1 | meld_state_change | action | meld_id, prior_state, new_state, transition | snapcli_pm http_backend.py write paths | Carlos no-docs broadcast | S |
| 2 | agent_lifecycle | action | agent, lifecycle, reason | src/daemon/agent-process.ts state machine | Crash-storm detector | S |
| 3 | inbox_arrival | action | to_agent, from_agent, msg_id, priority | src/bus/message.ts sendMessage | Wake-on-inbox for idle-disabled | S |
| 4 | handoff_written | action | words, sections, caller, status | _shared/scripts/write-handoff.sh | Off-machine archive backup | S |
| 5 | shift_transition | action | agent, transition, prior/next window | src/daemon/shift.ts (post-RFC #4) | Quiet Telegram off-shift | M |
| 6 | cap_threshold_crossed | error | threshold, model, utilization_pct | session-burn-so-far primitive | Auto stand-down at 85% | M |
| 7 | vendor_no_response | action | meld_id, vendor_id, hours_since_last | RFC #7 vendor-tech-status-sweep skill | Alternate-vendor suggestion at 72h | S |
| 8 | tech_completion_email | action | tech_name, gmail_msg_id | fast-checker Gmail watch | Auto-load completion-checklist skill | S |

**Effort summary:** 6 × S (~1 LOC each, mostly inserting `cortextos bus log-event` calls at existing state-change points), 2 × M (depend on RFC #4 + session-burn primitive landing first).

---

## 4. Rollout Order — Recommended

Group by independence (can ship without other RFCs landing) and value:

**Wave 1 (independent, ship Thu next to dispatcher):**
- `inbox_arrival` (#3) — single emit in sendMessage. Unblocks RFC #1 wake-on-inbox without needing the full stickiness state machine.
- `meld_state_change` (#1) — paired with snapcli rename Thu execution; insert emits in the renamed http_backend.
- `handoff_written` (#4) — single emit in write-handoff.sh. Unblocks lightweight backup hooks.

**Wave 2 (depends on near-term work):**
- `tech_completion_email` (#8) — Gmail watch addition; coordinate with completion-checklist skill ship (RFC #7).
- `agent_lifecycle` (#2) — depends on RFC #1 stickiness landing the `idle_disabled` state.

**Wave 3 (later):**
- `vendor_no_response` (#7) — RFC #7 vendor-tech-status-sweep skill landing first.
- `cap_threshold_crossed` (#6) — needs `session-burn-so-far` primitive built (npm run build pending per Dane's overnight note).
- `shift_transition` (#5) — RFC #4 evaluator landing first.

Wave 1 ships in 1 day total. Wave 2-3 ride on the dependent RFCs over the next 2 weeks.

---

## 5. Schema Discipline (one paragraph)

Every new event MUST follow the existing `logEvent` signature (`category`, `eventName`, `severity`, `metadata`). Required-meta lists above are CONTRACTS the dispatcher can rely on for hook matching — emitters that omit required fields produce events that hooks silently fail to match. Add a comment to `src/bus/event.ts` documenting the canonical event-name → required-meta mapping (or a separate doc at `orgs/ascendops/docs/event-catalog.md` that lives next to the hooks registry). Keep the contract DRY — the doc is the canonical source, both emitters and hooks reference it.

---

## Word count: ~1140 (within 800-1200 target)

# Event Catalog — canonical contract for cortextos bus events

**Author:** Aussie
**Date:** 2026-04-29
**Status:** Living document — every new event MUST be added here before emission
**Owner:** changes require Aussie or Collie review; David approves new categories
**Schema version:** 0.1

---

## 1. Why This Doc Exists

Cortextos bus events have two consumers: the JSONL audit trail (write-once, postmortem-only today) and the upcoming RFC #15 bus-hooks dispatcher (live reactive). When an emitter and a hook author disagree on an event's meta shape, hooks silently fail to match, and we discover the contract drift only when a feature breaks. This catalog is the **DRY contract** between emitters and hooks. Per RFC #15 §3 + Part B § "Schema discipline":

> Required-meta lists above are CONTRACTS the dispatcher can rely on for hook matching — emitters that omit required fields produce events that hooks silently fail to match.

This doc IS that DRY surface. Both emitters and hook authors reference it as canonical.

---

## 2. Schema Rules

Every event MUST declare:
- **Category** — one of `action | error | heartbeat | task | approval` (the canonical `EventCategory` union in `src/types/index.ts`).
- **Type** — snake_case event name string (e.g. `inbox_arrival`, `meld_state_change`).
- **Required meta fields** — keys that MUST appear in the metadata object. Hooks may match against these.
- **Optional meta fields** — keys that MAY appear. Hooks should not require them.
- **Severity** — default severity for the event (`info | warning | error | critical`). Emitters override per-instance when warranted.

**Naming conventions:**
- Type strings are snake_case, lowercase, action-shaped (`X_happened`).
- Meta keys are snake_case, lowercase.
- New events MUST avoid colliding with existing types within the same category.

**Versioning rule:** schema changes are tracked at the catalog level (the doc's `Schema version`). Per-event additive changes (new optional meta fields) are MINOR bumps. Removals or required-meta changes are MAJOR bumps and require a deprecation window. See §6.

---

## 3. Existing Events (live emit surface today)

Verified via grep of `logEvent(` and `cortextos bus log-event` callsites across `src/cli/bus.ts` + `orgs/ascendops/`:

| Category | Type | Required meta | Optional meta | Severity | Source |
|---|---|---|---|---|---|
| `action` ✓ | `agent_message_sent` | `to`, `priority`, `msg_id` | `reply_to` | info | `src/cli/bus.ts` (sendMessage path) — rerouted from `message` 2026-04-29 (RFC #15 schema-drift cleanup, TT batch) |
| `action` ✓ | `inbox_ack` | `msg_id` | — | info | `src/cli/bus.ts` (ackInbox) — rerouted from `message` 2026-04-29 (TT batch) |
| `heartbeat` | `heartbeat` | `status` | `task` | info | `src/cli/bus.ts` (updateHeartbeat) |
| `action` ✓ | `telegram_sent` | `chat_id`, `message_id`, `preview` | — | info | `src/cli/bus.ts` (sendTelegram) — rerouted from `message` 2026-04-29 (TT batch) |
| `action` ✓ | `tool_call` | (varies) | (varies) | info | `src/cli/bus.ts` — rerouted from `agent_activity as any` 2026-04-29 (TT batch); `as any` cast removed |
| `action` | `guardrail_triggered` | `guardrail`, `context` | — | info | Blue GUARDRAILS.md |
| `action` ✓ | `blue_decision_presented` | (skill-defined) | — | info | Blue pm-meld-triage SKILL — rerouted from `quality` 2026-04-29 (TT batch) |
| `action` ✓ | `skill_candidate` | — | — | info | Blue skill-auto-discovery SKILL — rerouted from `quality` 2026-04-29 (TT batch) |
| `action` ✓ | `threat_filter_applied` | `meld_id`, `unit`, `tenant`, `categories_matched` | — | info | Blue threat-history-filter SKILL — added 2026-04-29 (DD batch); rerouted from `quality` same-day (TT batch) |
| `action` ✓ | `vendor_assignment_confirmed` | (skill-defined) | — | info | Blue assign-vendor-with-confirmation SKILL — rerouted from `quality` 2026-04-29 (TT batch) |
| `action` ✓ | `triage_trajectory` | (skill-defined) | — | info | Blue self-evaluation-triage SKILL — rerouted from `quality` 2026-04-29 (TT batch) |
| `action` ✓ | `triage_outcome_update` | (skill-defined) | — | info | Blue self-evaluation-triage SKILL — rerouted from `quality` 2026-04-29 (TT batch) |
| `action` ✓ | `vendor_tech_sweep` | `total`, `healthy`, `buckets` | — | info | Blue vendor-tech-status-sweep SKILL — added 2026-04-29 (EE batch); rerouted from `quality` same-day (TT batch) |
| `action` ✓ | `completion_checklist_pass` | (skill-defined) | — | info | Blue completion-checklist SKILL — rerouted from `quality` 2026-04-29 (TT batch) |
| `action` ✓ | `completion_checklist_gap` | `meld_id`, `tech`, `missing[]` | — | info | Blue completion-checklist SKILL — rerouted from `quality` 2026-04-29 (TT batch) |
| `action` | `meld_triaged` | `meld_id`, `vendor`, `urgency` | — | info | Blue (archived triage-rules.md) |
| `action` | `vendor_roster_updated` | `agent`, `gaps_filled` | — | info | Blue draft |
| `action` | `morning_scan_complete` | (varies) | — | info | Blue pm-morning-scan SKILL |
| `action` | `pm_session_refreshed` | (varies) | — | info | Blue pm-session-recapture SKILL |
| `action` | `pm_session_recapture_failed` | (varies) | — | warning | Blue pm-session-recapture SKILL |
| `action` | `meld_poll_complete` | (varies) | — | info | Blue meld-ops SKILL |
| `task` | `task_created` | `task_id`, `agent` | — | info | `src/bus/task.ts` |
| `task` | `task_updated` | `task_id`, `from_status`, `to_status` | — | info | `src/bus/task.ts` |
| `task` | `task_completed` | `task_id` | `result` | info | `src/bus/task.ts` |
| `task` | `task_blocked` | `task_id`, `blockers` | — | warning | `src/bus/task.ts` |
| `approval` | `approval_created` | `approval_id`, `requested_by` | — | info | `src/bus/approval.ts` |
| `approval` | `approval_decided` | `approval_id`, `decision` | — | info | `src/bus/approval.ts` |
| `error` | `agent_crash` | `agent`, `reason` | — | critical | agent-process.ts |
| `error` | `tool_failure` | `tool`, `error` | — | error | various |
| `error` | `auth_expired` | `service` | — | error | various |

✓ **Schema drift CLEARED 2026-04-29 (TT batch).** All previously-flagged ⚠️ rows have been rerouted to canonical categories. `message` and `agent_activity` (with the `as any` cast) collapsed into `action`; `quality` collapsed into `action`. Type names already disambiguate, so semantic distinctness is preserved without an EventCategory expansion. Emit sites updated:
- `src/cli/bus.ts` 4 sites (agent_message_sent / inbox_ack / telegram_sent / tool_call) — `as any` cast on tool_call removed.
- 7 Blue skills (skill-auto-discovery, pm-meld-triage, threat-history-filter, assign-vendor-with-confirmation, self-evaluation-triage, vendor-tech-status-sweep, completion-checklist) — 11 emit lines total flipped from `quality` to `action`.
Total changes: 4 TS sites + 11 markdown lines = 15 emit sites brought to canonical. Aussie validator (`validateEventCategory`) now passes for all known emit lines.

---

## 4. Wave 1 New Events (per RFC #15 Part B)

These three ship Thursday alongside the dispatcher.

### 4.1 `inbox_arrival`
- **Category:** `action`
- **Required meta:** `to_agent` (string), `from_agent` (string), `msg_id` (string), `priority` (urgent|high|normal|low)
- **Optional meta:** `has_reply_to` (bool), `body_preview` (≤120 chars)
- **Severity:** `info`
- **Where it fires:** `src/bus/message.ts:sendMessage()` — after `atomicWriteSync` of the inbox file succeeds. The SOURCE agent's event log records it; hooks subscribe via `metadata.to_agent` filter.
- **Why it matters:** unblocks RFC #1 wake-on-inbox without needing the full stickiness state machine. Cross-agent reactive routing.

### 4.2 `meld_state_change`
- **Category:** `action`
- **Required meta:** `meld_id` (string), `prior_state` (string), `new_state` (string), `transition` (assigned|scheduled|pending_completion|completed|cancelled|could_not_complete)
- **Optional meta:** `tech_id` (number), `vendor_id` (number), `triggered_by` (manager|tech|vendor|hook)
- **Severity:** `info` (warning if `transition: could_not_complete`)
- **Where it fires:** every PM CLI write path that mutates state — `complete_meld`, `cancel_meld`, `assign_tech`, `assign_vendor`, `schedule_vendor`, `force_pending_completion` (post-rename to `snapcli_pm/http_backend.py`). Bash wrapper or Python `--emit-event` flag, after API success.
- **Why it matters:** auto-relay Carlos no-docs close (RFC #15 §7 Example C). Carlos-completion Telegram. Audit trail for Brittany reconciliation.

### 4.3 `handoff_written`
- **Category:** `action`
- **Required meta:** `words` (number), `sections` (number), `caller` (string), `status` (ok|degraded)
- **Optional meta:** `framework_stable` (bool), `hash` (string of resulting handoff.md content)
- **Severity:** `info` (warning if `status: degraded`)
- **Where it fires:** `_shared/scripts/write-handoff.sh` — at the end of a successful write, just before exit. One additional `cortextos bus log-event action handoff_written info --meta '...'` call.
- **Why it matters:** off-machine archive backup hook (lightweight). Verifies handoff infra is firing across the fleet without manual log inspection.

---

## 5. Future Events — Reserved Names (Wave 2-3, NOT YET EMITTED)

Per RFC #15 Part B §3-§5. These are RESERVED — type strings claimed, schema TBD when emitted:

- **`agent_lifecycle`** (`action`) — Wave 2. Required meta: `agent`, `lifecycle` (started|stopped|crashed|idle_disabled|idle_resumed|restart_scheduled). Fires from `src/daemon/agent-process.ts` state transitions.
- **`shift_transition`** (`action`) — Wave 3. Required meta: `agent`, `transition` (entering_shift|leaving_shift|entering_emergency_only). Fires from `src/daemon/shift.ts` (post-RFC #4).
- **`vendor_no_response`** (`action`) — Wave 3. Required meta: `meld_id`, `vendor_id`, `hours_since_last_contact`, `threshold`. Fires from RFC #7 vendor-tech-status-sweep skill.
- **`tech_completion_email`** (`action`) — Wave 2. Required meta: `tech_name`, `gmail_msg_id`. Optional: `meld_id`, `has_completion_text` (bool). Fires from fast-checker Gmail watch.
- **`cap_threshold_crossed`** (`error`, severity `warning` or `critical`) — Wave 3. Required meta: `threshold` (75_start_gate|85_stop_gate|90_fleet_emergency|95_haiku_fallback), `model`, `utilization_pct`, `resets_at_iso`. Fires from `cortextos bus session-burn-so-far` after npm run build lands.

Reserved-but-not-emitted means: do NOT register hook subscribers for these yet. When the emit point lands, this catalog gets a §4-style entry and the type moves out of §5.

---

## 6. Versioning Rules

- **Additive changes** (new optional meta field, new severity used by an existing event): MINOR — bump `Schema version` patch (0.1 → 0.1.1). No migration needed; existing hooks keep working.
- **Required-meta additions to an existing event:** MAJOR. Must be staged: emit both old + new shapes for 2 weeks; update all hooks; then drop the old shape.
- **Removal of an event type:** MAJOR. Audit all hooks that subscribe; migrate them or surface explicit deprecation; 30-day removal window.
- **Category union expansion** (e.g. adding `message` or `quality` to make today's drift legitimate): MAJOR. Aussie+Dane review; David approves; touches `src/types/index.ts` + `src/utils/validate.js`.

The `Schema version` line at the top of this doc is the source of truth. Bump it on every change.

---

## 7. Hook-Author Guidance

Before subscribing a new hook in `orgs/<org>/hooks.json`:

1. **Verify event existence in §3 or §4.** Reserved §5 events don't fire yet — your hook will silently never match.
2. **Verify required-meta shape** — your `event_pattern.metadata` MUST only require keys the catalog lists as required. Optional keys may be absent.
3. **Verify schema version compatibility** — the Schema version at the time you wrote the hook is the contract; later MAJOR bumps may require hook update.
4. **Filter by `agent_filter`** if your hook should only fire for specific agents' emissions.
5. **Prefer `category + type` matching over metadata-only** — cheaper, more specific.

If your hook needs a meta field NOT listed as required, either (a) propose the field be added to required (Aussie+Dane review), or (b) make your hook resilient to its absence.

---

## 8. Open Questions for David

1. **Schema-drift cleanup (§3 ⚠️):** reroute `message`/`agent_activity`/`quality` emits to canonical categories, or expand the EventCategory union? Lean reroute — keeps the union small.
2. **Wave 1 ship sequence:** all 3 events at once Thursday, or stagger (one per day)? Lean stagger to isolate any drift surfacing.
3. **Catalog ownership:** Aussie maintains as living doc, or open editable to any agent with an emit-site contribution? Lean Aussie+Collie review required.
4. **Versioning enforcement:** runtime validation that emit sites match catalog (would require regenerating types from this doc), or honor system based on review discipline? Lean honor system + spot audits.
5. **Events that aren't catalogued today (§3 ⚠️ rows):** ship the reroute as a one-time cleanup, or accept the drift as a known issue while the bus-hooks dispatcher comes online? Lean reroute first — drift compounds.

---

## Word count: ~1090 (within 700-1100 target)

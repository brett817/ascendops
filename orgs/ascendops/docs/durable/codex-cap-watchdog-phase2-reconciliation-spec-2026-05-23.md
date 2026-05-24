# Codex Cap-Watchdog Phase 2 — Seat-State Reconciliation Spec

**Author:** aussie (analyst lane, overnight dispatch C2)
**Date:** 2026-05-23 (UTC) / 2026-05-22 evening EDT
**Dispatcher:** Dane via task_1779499861176_679750
**Companion specs:** Phase 1 prototype brief (`codex-cap-watchdog-phase1-prototype-2026-05-22.md`), original Phase 1 design spec (`codex-cap-watchdog-spec-2026-05-22.md`)
**Status:** RESEARCH-ONLY SPEC — no implementation in this artifact per dispatcher scope

---

## TL;DR

Phase 1 prototype shipped a sqlite-probe cap-watchdog that successfully reads structured `codex.rate_limits` data from `~/.codex(-seats)/<seat>/logs_*.sqlite`. The first real cron fire (2026-05-22 20:23:06 UTC) surfaced **2 persistent seat-state anomalies** in `~/.codex-seats/active-seat.json`:

1. **seat-a** marked `status: "rate_limited"` with `rate_limited_until: "2026-05-11T23:32:30Z"` — cooldown expired **11+ days ago**, seat-a hasn't been touched since then (no sqlite activity since 2026-05-12), but the wrapper's reactive flip never re-marked it as `active`.
2. **seat-b** marked `status: "auth_expired"` with `account_id: "pending_login"` — contradicted by **active sqlite usage 4 min before the cron fire** (Codie's running session via seat-b).

These aren't probe failures — they're state-tracking gaps in the 2-seat rotation wrapper at `~/.local/bin/codex` (per `codex-2seat-rotation-spec.md` design). The wrapper writes to `active-seat.json` on reactive flips but never reconciles back. Phase 2 closes the loop: the watchdog detects drift and updates state to match observed reality.

**Operational risk if unreconciled:** when seat-b actually hits cap, the wrapper rotation logic flips to seat-a (per its state-table reading). But seat-a is stale-marked `rate_limited`, so wrapper might either (a) reject the flip and report both-exhausted, OR (b) succeed in flipping despite the stale marker but log misleading rotation telemetry. Either way: state-tracking lies degrade rotation decisions.

**Core proposal:** add a reconciliation pass to the existing `codex-cap-watchdog-cron.sh` wrapper. After each sqlite probe, compare claimed `active-seat.json` status vs observed sqlite activity. If reality contradicts claim, **relax-only** the state (never tighten — only flip to `active` based on inference; never auto-mark a seat as `rate_limited` without a real failure signal).

---

## 1. Anomaly Inventory (from Phase 1 prototype output)

### 1.1 The two anomalies observed in production

**First real cron fire** (2026-05-22T20:23:06Z) produced the following `seat_observations`:

```json
[
  {
    "seat": "seat-a",
    "issue": "stale_cooldown",
    "rate_limited_until": "2026-05-11T23:32:30Z",
    "note": "marked rate_limited but cooldown expired — state file may not be tracking real seat use"
  },
  {
    "seat": "seat-b",
    "issue": "auth_expired",
    "note": "needs codex login per active-seat.json"
  },
  {"meta": "active_seat", "value": "seat-b"}
]
```

Cross-referenced against sqlite activity:

| Seat | Claimed status | Last sqlite event | Reality |
|---|---|---|---|
| seat-a | `rate_limited` until 2026-05-11T23:32:30Z (expired 11d ago) | 2026-05-12T17:15:04Z (10d 3h before now) | dormant but functional — cooldown long gone, no recent activity means we just haven't used it |
| seat-b | `auth_expired`, `account_id: pending_login` | 2026-05-22T17:17:25Z (3h before cron fire) | actively in use — auth working fine, account_id field is stale |

### 1.2 Anomaly taxonomy (general patterns to handle)

Beyond these two specific instances, the spec covers four general drift patterns:

| Pattern | Definition | Reconciliation |
|---|---|---|
| **stale_cooldown** | `status: rate_limited` + `rate_limited_until` in the past + (no recent activity OR recent activity) | Relax to `active`; clear `rate_limited_until` |
| **stale_auth_expired** | `status: auth_expired` + recent sqlite activity (cap-quality readings flowing) | Relax to `active`; backfill `account_id` from auth.json if available |
| **stale_pending_login** | `account_id: "pending_login"` (or similar placeholder) + recent sqlite activity | Same as stale_auth_expired — backfill from auth.json |
| **inactive_seat** | `status: active` + no sqlite activity in N+ days | Optional informational event — do NOT auto-flip status (a seat with no jobs is healthy by definition, just unused) |

**The key invariant: relax-only.** Reconciliation can mark a seat MORE permissive than its state file claims, never LESS. Tightening (e.g. auto-marking `rate_limited` based on inference) requires the existing reactive trigger from the wrapper (stderr regex match on real failure).

---

## 2. Detection Rules

### 2.1 Per-anomaly trigger conditions

**stale_cooldown**:
```
status == "rate_limited"
  AND rate_limited_until != null
  AND parse(rate_limited_until) < now()
  AND (recent_sqlite_event_within_24h OR cooldown_expired_more_than_7d_ago)
```

The dual OR clause: if the seat has been used (sqlite activity), reality says it's working. If the cooldown is just very stale (7+ days expired), the state is also obviously wrong even without usage evidence.

**stale_auth_expired**:
```
status == "auth_expired"
  AND last_sqlite_event_within_24h
  AND sqlite_event_kind == "codex.rate_limits"  (proves successful API call)
```

A successful `codex.rate_limits` websocket event implies a valid auth handshake completed — auth can't actually be expired.

**stale_pending_login**:
```
account_id == "pending_login"  OR  account_id == null  OR  account_id == ""
  AND last_sqlite_event_within_24h
```

Same proof-of-life logic.

**inactive_seat** (informational only):
```
status == "active"
  AND last_sqlite_event > 7d ago
```

### 2.2 Confidence levels

Each detected anomaly carries a confidence level affecting whether reconciliation auto-applies vs requires human confirmation:

| Confidence | Trigger | Default action |
|---|---|---|
| HIGH | sqlite activity within last 1h + state claim contradicted | Auto-reconcile + log info event |
| MEDIUM | sqlite activity within last 24h + state claim contradicted | Auto-reconcile + log warning event + ping Dane on next sweep |
| LOW | sqlite activity 1-7d ago + state claim contradicted | Log info event only; require human confirmation before reconcile |
| INFO | no sqlite activity OR state claim is just stale-but-unrefuted | Log info event only; no reconciliation |

**Today's two anomalies map as:**
- seat-a stale_cooldown: INFO (cooldown expired 11d ago, no recent activity — no urgency, just stale state)
- seat-b auth_expired: HIGH (3h since last sqlite event proves auth works) — auto-reconcile candidate

---

## 3. Reconciliation Actions

### 3.1 Per-pattern action map

| Pattern | State changes | Audit fields added |
|---|---|---|
| stale_cooldown reconciled | `status: rate_limited` → `active`; clear `rate_limited_until` | `reconciled_at: <iso>`, `reconciled_reason: stale_cooldown`, `reconciled_by: codex-cap-watchdog` |
| stale_auth_expired reconciled | `status: auth_expired` → `active`; preserve `account_id` if non-placeholder, else backfill from `<seat-dir>/auth.json` | `reconciled_at`, `reconciled_reason: stale_auth_expired`, `reconciled_by` |
| stale_pending_login reconciled | `account_id: pending_login` → real account_id from auth.json | `reconciled_at`, `reconciled_reason: stale_pending_login`, `reconciled_by` |
| inactive_seat | none | log event only |

### 3.2 Atomic write pattern

Same atomic tmp+rename + lock-via-mkdir pattern as the existing 2-seat wrapper:

1. Acquire `~/.codex-seats/.lock` (mkdir as primitive)
2. Read current `active-seat.json`
3. Apply reconciliation deltas via jq
4. Write to `active-seat.json.tmp.$$`
5. `mv` atomic rename
6. Release lock
7. Append reconciliation event to `~/.codex-seats/log/<YYYY-MM-DD>.jsonl`

### 3.3 Backfill from auth.json (for stale_pending_login)

Each seat has `<seat-path>/auth.json` with structure (per 2-seat rotation spec):
```json
{
  "auth_mode": "Chatgpt",
  "OPENAI_API_KEY": null,
  "tokens": {
    "id_token": "...",
    "access_token": "...",
    "refresh_token": "...",
    "account_id": "0de49cbc-78d9-4016-8b4b-174f134e78f5"
  },
  "last_refresh": "<iso>"
}
```

The `tokens.account_id` is the authoritative source for the seat's account binding. If auth.json is readable AND `account_id` is non-empty/non-placeholder → backfill into active-seat.json.

### 3.4 Failure modes for the reconciliation step

| Failure | Detection | Mitigation |
|---|---|---|
| Lock acquire fails (concurrent wrapper write) | mkdir returns non-zero >50 tries | Skip reconciliation this cycle; emit `codex_seat_state_reconcile_skipped` event with reason `lock_contention`; retry next sweep |
| auth.json missing or unreadable | read fails or no `tokens.account_id` field | Skip backfill for that seat; emit warning; flag for human (David) attention |
| jq write fails (disk full, permission) | non-zero exit | Restore from in-memory backup; emit error event; do NOT corrupt active-seat.json |
| Reconciliation would tighten state (impossible per invariant but check) | post-jq diff shows new status more restrictive | Abort write; emit error event; flag spec violation |

---

## 4. Action Surface (events + notifications)

### 4.1 New event types

| Event | Severity | Fires when |
|---|---|---|
| `codex_seat_state_reconciled` | info | Successful reconciliation applied |
| `codex_seat_state_reconcile_skipped` | info | Skipped (lock contention, low confidence, etc.) |
| `codex_seat_state_reconcile_failed` | error | Reconciliation attempted but failed (disk, permission, lock-timeout) |
| `codex_seat_state_inactive` | info | inactive_seat pattern matched (informational only) |

Replaces the existing `codex_seat_state_anomaly` event from Phase 1 (which only flagged, never acted) — Phase 2 adds the action verbs.

### 4.2 Dane / David notification policy

| Confidence | Notify Dane | Notify David |
|---|---|---|
| HIGH | No (auto-reconcile is silent success) | No |
| MEDIUM | Yes (single consolidated message per sweep) | No |
| LOW | Yes (single consolidated message) | No |
| INFO | No (event log only) | No |

David sees nothing automatically — reconciliation is fleet-internal housekeeping. Dane sees medium/low cases to provide oversight without flooding.

### 4.3 Sample Dane notification text

```
Codex seat-state reconciled: seat-b (HIGH confidence, stale_auth_expired). State was 'auth_expired' / account_id 'pending_login', but sqlite shows codex.rate_limits event 3h ago = auth working. Updated active-seat.json: status → active, account_id backfilled from auth.json. Reason logged: stale_auth_expired.
```

---

## 5. Integration with Phase 1 Cron Sweep

### 5.1 New sweep flow

```
codex-cap-watchdog-cron.sh (Phase 2):
  1. Run codex-cap-watchdog.py (unchanged from Phase 1)
  2. NEW: Run codex-cap-watchdog-reconcile.py
     - Parses Phase 1 output
     - For each seat_observation with .issue:
       a. Compute confidence per §2.2
       b. If HIGH confidence: auto-apply per §3
       c. If MEDIUM/LOW: log + queue for Dane notify
       d. If INFO: log event only
     - Emit reconciliation events to bus
  3. Aggregate reconciliation summary into the sweep output
  4. NEW: Dane notify on MEDIUM/LOW count > 0 (consolidated single message)
```

### 5.2 New script: `codex-cap-watchdog-reconcile.py`

Companion to `codex-cap-watchdog.py`. Takes the Phase 1 JSON output via stdin (or re-runs the probe internally), produces a reconciliation report + applies HIGH-confidence changes.

**File location:** `scripts/agents/aussie/codex-cap-watchdog-reconcile.py` (mirrors Phase 1 layout)

### 5.3 Backwards compatibility

Phase 2 is purely additive. Phase 1 prototype keeps working unchanged. The `codex_seat_state_anomaly` event from Phase 1 can either be deprecated in favor of the more specific Phase 2 events, OR kept as a roll-up (Phase 2 events become subtypes).

Recommendation: KEEP `codex_seat_state_anomaly` as the roll-up; Phase 2 events become subtypes (`reconciled` / `skipped` / `failed` / `inactive`). Dashboards counting "anomalies surfaced" stay accurate.

---

## 6. Safety Invariants (do-not-violate)

1. **Relax-only**: reconciliation never marks a seat MORE restrictive than its state file. Only loosens `rate_limited` → `active` or `auth_expired` → `active`. Tightening requires the existing reactive trigger.
2. **No silent token writes**: if backfill requires reading `auth.json` tokens, the watchdog reads `account_id` only — never modifies tokens.
3. **No cap-decision delegation**: reconciliation is for STATE TRACKING. The actual decision "is this seat available to dispatch to" still belongs to the wrapper. Reconciliation just makes the wrapper's input more accurate.
4. **Atomic-write contract**: if any reconciliation step fails between read and rename, `active-seat.json` MUST stay at its pre-step state. Partial writes are not acceptable.
5. **Lock primacy**: the wrapper's existing `~/.codex-seats/.lock` is the source of truth for write coordination. Reconciliation respects the same lock; reconciliation BLOCKS if wrapper is currently writing.
6. **Audit trail**: every reconciliation that applies must log `reconciled_at`, `reconciled_reason`, `reconciled_by` into the state file itself AND emit a bus event. Reversing a wrong reconciliation requires the audit trail.

---

## 7. Open Questions for Dane

1. **Threshold tunability**: §2.2 uses 1h/24h/7d windows for HIGH/MEDIUM/LOW. These are picked from intuition. Wait one week of clean reconciliation data before locking; expose as constants up front so adjustment is one-line.
2. **Auto-reconcile vs human-confirm for HIGH**: §2.2 default is auto-reconcile on HIGH. Alternative is always-human-confirm for first 30 days, switch to auto after the policy proves clean. Recommend auto from day 1 (reconciliation is mechanically simple, audit trail is built-in, false positives have low blast radius — worst case is a wrongly-marked-active seat that immediately hits real cap and reverts via wrapper reactive trigger).
3. **Cross-pattern races**: if seat-a is BOTH stale_cooldown AND inactive (no sqlite for 11 days), do both events fire? Recommend: stale_cooldown takes precedence — emit only that event, suppress inactive_seat.
4. **Snapshot vs continuous mode**: §5.1 has reconciliation running per cron sweep (4h cadence). Alternative is reconciliation on every wrapper invocation (real-time). Recommend cron-cadence — wrapper path is hot, can't tolerate extra IO. Cron is fine.
5. **Reconciliation event volume**: if reconciliation fires every sweep for the same anomaly because the wrapper keeps re-orphaning state, we get event-log flood. Recommend: dedupe by `(seat, issue_type)` per 24h window — only one reconciliation event per (seat, issue) per day.

---

## 8. Prototype Sketch (out of tonight's scope; outline only)

Bash flow for `codex-cap-watchdog-cron.sh` Phase 2 augmentation:

```bash
# After Phase 1 probe completes:
PHASE1_OUTPUT=$(python3 "$SCRIPT_DIR/codex-cap-watchdog.py")
echo "$PHASE1_OUTPUT"  # preserve Phase 1 output

# Reconciliation pass:
RECONCILE_OUTPUT=$(echo "$PHASE1_OUTPUT" | python3 "$SCRIPT_DIR/codex-cap-watchdog-reconcile.py")
RECONCILE_RC=$?

# Emit per-event:
echo "$RECONCILE_OUTPUT" | jq -c '.events[]' | while read -r evt; do
  EVT_TYPE=$(echo "$evt" | jq -r '.event')
  EVT_SEV=$(echo "$evt" | jq -r '.severity')
  cortextos bus log-event action "$EVT_TYPE" "$EVT_SEV" --meta "$evt"
done

# Single Dane notify on MEDIUM/LOW:
NOTIFY_COUNT=$(echo "$RECONCILE_OUTPUT" | jq '[.events[] | select(.confidence == "MEDIUM" or .confidence == "LOW")] | length')
if [[ "$NOTIFY_COUNT" -gt 0 ]]; then
  SUMMARY=$(echo "$RECONCILE_OUTPUT" | jq -r '.notify_summary')
  cortextos bus send-message dane normal "Codex seat-state reconciliation: $SUMMARY"
fi
```

**Estimated implementation:** ~2-3h for Codie/Collie once spec approved. Bulk is the reconcile.py logic (anomaly classification + confidence scoring + atomic state edits + backfill). Bash wiring is plumbing.

---

## 9. Cited Sources

- Phase 1 prototype brief: `orgs/ascendops/docs/durable/codex-cap-watchdog-phase1-prototype-2026-05-22.md`
- Phase 1 design spec: `orgs/ascendops/docs/durable/codex-cap-watchdog-spec-2026-05-22.md`
- 2-seat rotation design (wrapper spec): `orgs/ascendops/docs/durable/codex-2seat-rotation-spec.md`
- Phase 1 first real cron fire output: 2026-05-22T20:23:06Z (event_id `codex_cap_watchdog_sweep` + `codex_seat_state_anomaly`)
- Live `~/.codex-seats/active-seat.json` snapshot: status fields contradicted by sqlite activity
- Memory: `feedback_daemon_state_crons_canonical` (cron-state vs filesystem-state lessons)

---

## 10. Build Stats

- Dispatch received: 2026-05-23T01:31:01Z
- Spec write: ~25 min (high density — Phase 1 output captured all anomaly examples + 2-seat spec captured all wrapper context)
- Lines: ~285
- Class: DURABLE-SPEC (per org-state-persistence-policy §3.1)
- Destination: `orgs/ascendops/docs/durable/` (first net-new doc landing under the carve-out — eats the policy's own dog food)
- Lock target: Dane sign-off → dispatch Codie or Collie for `codex-cap-watchdog-reconcile.py` implementation (~2-3h estimate per §8)

---

## 11. Next-Step Recommendation (single-sentence for Dane)

Sign off on the 4-pattern taxonomy + relax-only invariant + HIGH-confidence-auto-reconcile default, then dispatch Codie or Collie to implement `codex-cap-watchdog-reconcile.py` per §5+§8 (~2-3h), wired into the existing Phase 1 cron at `codex-cap-watchdog-cron.sh` with backwards-compatible event surface preserving the Phase 1 `codex_seat_state_anomaly` roll-up.

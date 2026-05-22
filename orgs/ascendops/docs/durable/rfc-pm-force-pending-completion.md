# RFC: Manager-Force PENDING_COMPLETION — endpoint discovery + snapcli wrapper spec

**Author:** Collie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review + Aussie discovery work
**Item:** Thursday plate #12 (of 13)
**Companions:** Hook gate (#1, shipped) blocks bad COMPLETED transitions; this RFC adds the *missing* manager-side state push that the gate sometimes needs to happen for stuck melds. Skill `partial-completion-handle` from RFC #7 is the highest-frequency caller.

---

## 1. Problem

Property Meld melds move through:

```
NEW → IN_PROGRESS → PENDING_COMPLETION → COMPLETED
            └─ or → MAINTENANCE_COULD_NOT_COMPLETE (stuck)
```

`PENDING_COMPLETION` is normally set when a tech marks work done from their side (vendor portal, in-house tech app, or PM internal "done" button). **Sometimes a manager needs to force this transition manually:**

- **Tech ghosted but work was done** — common Carlos pattern when he closes from his phone but the digital state didn't update. Confirmed via resident reply or photo evidence.
- **Stuck `MAINTENANCE_COULD_NOT_COMPLETE` cleanup** — `project_partial_completion_sop.md` documents the 4-step handoff (complete + clone + assign + merge), but the *original* meld sometimes can't reach `PENDING_COMPLETION` cleanly without manager intervention.
- **Admin cleanup of long-stale melds** — `IN_PROGRESS` melds untouched for >30 days, where the original tech is no longer assigned and nothing's actually pending.
- **Meld 12618962** is a recent example (memory note: "12618962 PENDING_COMPLETION is unexpected — flag it to David but no vendor action from us") — the meld did transition correctly but the *expectation* was that this kind of state push needed manual nudging.

**Today's manual flow:**
1. David / Brittany opens PM web UI.
2. Navigate to the meld.
3. Click "Mark as PENDING_COMPLETION" (or whatever the UI button is — exact label varies by meld state).
4. Optional: enter reason text.
5. Submit.

**Cost:** ~30 seconds per meld in PM UI. Frequency is low (~3-8/week) but error cost is high — a wrong force-transition on the wrong meld confuses billing reconciliation. Today there's no programmatic path; we just don't have the command in `pm work-orders ...`.

## 2. Discovery Methodology (Aussie Thursday)

This is endpoint capture, not implementation. Aussie's job:

**Step 1 — set up capture environment.**
- Open Safari with PM logged in (per `pm_cli_session_method.md`, Google Sign-In via Safari is the established session source).
- Open Safari Web Inspector (Develop → Show Web Inspector → Network tab).
- Filter requests to `app.propertymeld.com` host, XHR/Fetch only.
- Clear the network log right before triggering the action so the captured trace is minimal.

**Step 2 — pick a representative meld.**
- Find a meld in `IN_PROGRESS` that has `assigned_technicians` populated (e.g. a Carlos-assigned that hasn't moved yet).
- Sandbox preference: pick a meld that has actually-completed work (resident replied "yes it's done") so the force-transition is safe to do for real.
- If no safe candidate exists, ask David for one or use a test/staging account if available.

**Step 3 — trigger the action.**
- Click whatever PM UI button forces the meld to `PENDING_COMPLETION` from a manager view. Note the exact UI label and where it appears (meld detail page button, dropdown action, modal, etc.).
- If the button text varies by state (`MAINTENANCE_COULD_NOT_COMPLETE` vs `IN_PROGRESS`), capture both flows separately.

**Step 4 — capture from the network panel.**
- HTTP method (`PATCH` is most likely given complete/cancel use PATCH at `http_backend.py:452, 469`).
- Full request URL (e.g. `https://app.propertymeld.com/3287/m/3287/api/melds/{id}/force-pending-completion/` — speculation, do not implement against this).
- Request headers: confirm `Cookie`, `X-CSRFToken`, `Content-Type`, `X-Requested-With`, `Referer`, `User-Agent` shape — these match the existing pattern.
- Request body: JSON shape, all fields. Note which are required vs optional. Common candidates: `reason`, `force_completion_notes`, `notify_tenant`, `notify_vendor`, `manager_id`.
- Response: success status (200/204), response body shape (echo of meld? or empty?). Any `set-cookie` refresh.
- **Capture both happy path and at least one error path** — what does PM return if the meld is in a state that doesn't allow force-transition? (e.g. already-COMPLETED, or NEW with no assignment).

**Step 5 — document in `cli-anything-propertymeld/docs/endpoints.md`** (create if missing). Include the verbatim curl-equivalent and the snapcli adapter mapping.

This is the same one-time-capture pattern documented in `feedback_playwright_last_resort.md` ("opencli to record once, then plain HTTP forever") and `pm_cli_session_method.md`.

## 3. Existing snapcli pm Command Surface — Template

The closest siblings to the new command are `complete_meld` and `cancel_meld` at `cli-anything-propertymeld/cli_anything/propertymeld/http_backend.py:437` and `:456`:

```python
def complete_meld(meld_id: str, completion_notes: Optional[str] = None) -> dict:
    """Mark a meld complete from the manager side.
    Meld must be in PENDING_COMPLETION status. Raises HTTP 403 otherwise.
    """
    creds = _load_creds()
    cookie_hdr = _cookie_header(creds)
    csrf_token = _get_csrf_token(cookie_hdr)
    payload: dict = {}
    if completion_notes:
        payload["completion_notes"] = completion_notes
    result = _http_patch(f"melds/{meld_id}/complete/", payload, cookie_hdr, csrf_token)
    return {"ok": True, "meld_id": meld_id, "completion_notes": completion_notes, "result": result}
```

The new command mirrors this verbatim with three substitutions: function name, endpoint path, payload key. Once Aussie captures the endpoint, the implementation is ~15 LOC + a Click command (matching `cli.py` patterns).

## 4. Proposed `pm` Command Shape

```bash
# Basic — force the transition with no extra metadata
pm work-orders force-pending-completion <meld-id> --json

# With audit-trail reason (recommended)
pm work-orders force-pending-completion <meld-id> --reason "Tech confirmed via SMS, didn't sync state" --json

# With notification suppression (if endpoint supports it)
pm work-orders force-pending-completion <meld-id> --reason "..." --no-notify-tenant --no-notify-vendor --json

# Dry-run
pm work-orders force-pending-completion <meld-id> --dry-run --json
```

Naming: `force-pending-completion` is verbose but unambiguous; `force-complete` would conflict with `complete` (manager-side complete from `PENDING_COMPLETION`). The verbosity is acceptable for a low-frequency operation.

Sub-flags:
- `--reason` (optional but recommended) → maps to whatever audit-trail field the endpoint accepts. If endpoint requires a reason, command makes it required.
- `--no-notify-tenant` / `--no-notify-vendor` → suppress automated PM notifications. Default = let PM do its normal notifications. Whether these flags are wired depends on Aussie discovering whether the endpoint actually accepts them.
- `--dry-run` → fetch the meld, validate state-transition is allowed (per §5 guardrails), but don't fire the PATCH. Returns the planned-action dict.

## 5. State-Transition Guardrails

Allowed source states (verify during discovery; speculative until then):

| Source state | Allowed? | Notes |
|---|---|---|
| `IN_PROGRESS` | Yes | Most common case. |
| `MAINTENANCE_COULD_NOT_COMPLETE` | Yes | Cleanup case. |
| `PENDING_VENDOR` | Probably yes | Vendor never confirmed but work was done by someone else. |
| `NEW` | No (speculative) | A NEW meld has no work to mark complete; force-transition here makes no sense. |
| `PENDING_COMPLETION` | No-op | Already in target state; return success silently. |
| `COMPLETED` | No | Terminal — already past target. The hook gate from #1 prevents us from getting here without docs anyway. |
| `MANAGER_CANCELED` | No | Terminal. |

The wrapper validates the source state via `pm work-orders get <id>` before firing the PATCH. If invalid, exit non-zero with an explanatory error — don't let PM return a vague 403.

`--dry-run` exists specifically to make these guardrails inspectable before destructive action.

## 6. Audit Trail

PM **probably** logs a manager-force action distinctly from a tech-mark-complete (visible in the meld activity log). Aussie should verify during discovery — capture the activity-log entry that appears after the force-transition and note whether it's distinguishable.

snapcli should ALSO log locally:
- `cortextos bus log-event action pm_force_pending_completion info --meta '{"meld_id":"...","reason":"...","prior_state":"..."}'`
- This goes into the agent's `activity.log` and the dashboard event feed.

Distinct local logging matters because: if PM doesn't expose force-transitions in its activity feed, our log is the only audit trail.

## 7. Failure Modes

| Failure | Detection | Mitigation |
|---|---|---|
| Endpoint changes (PM ships new UI) | unexpected response shape, 404 | Re-run discovery; pin a snapcli version that targets the previous endpoint until updated |
| Session expired mid-call | 401 / 403 + login redirect HTML | Re-capture session per `snapcli.capture.safari` (codified in pm-cli-harness/SKILL.md); retry once |
| Invalid state transition (e.g. tried on COMPLETED meld) | PM returns 4xx with state-error JSON | Wrapper's pre-flight `pm work-orders get` should catch this earlier; surface clear error text |
| Concurrent edit (someone marked it complete while we were typing the command) | PM returns "state changed" error | Re-fetch + retry once if state has moved closer to target; otherwise surface |
| Partial-completion overlap (RFC #7 `partial-completion-handle` skill calls this command, then immediately calls `complete_meld`) | timing race | Sequential, not parallel — hook gate #1 will catch any premature `complete` call |

## 8. Open Questions for David

1. **Audit reason — required or optional?** Lean required: every manager force-transition deserves a written reason. But strictness adds friction to legitimate cleanup batches. Confirm.
   - **ANSWERED [D5]: REQUIRED — David 2026-04-29** (Dane recommendation, agree all batch). `pm work-orders force-pending-completion --reason "..."` makes `--reason` mandatory. Manager-force-PENDING-COMPLETION is unusual enough to warrant a paper trail; if reason is empty the action was not important enough. See `decisions-log.md` D5.
2. **Notification suppression default** — by default, force-pending-completion *does* trigger PM's normal "work is done" tenant/vendor email? Or stays silent until manager hits "complete" the second time? David's call shapes the default.
3. **Per-state UI button label variation** — does PM use the same button for `IN_PROGRESS → PENDING_COMPLETION` and for `MAINTENANCE_COULD_NOT_COMPLETE → PENDING_COMPLETION`? If different, two endpoints; if same, one.
4. **Should this command be in the pre-complete audit hook gate's bypass set?** Today the gate (RFC #1, shipped) only blocks `pm work-orders complete`, not force-pending-completion. If the gate later expands, force-pending-completion is *not* a no-docs problem (it's pushing into PENDING_COMPLETION, not into terminal COMPLETED) — should stay un-gated.
5. **Frequency forecast** — 3-8/week today; will this go up once the command exists (because it becomes available, more cases get force-pushed) or stay flat? Affects whether to add usage telemetry from day one.

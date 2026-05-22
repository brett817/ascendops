# Voice Coordinator — Phase 0: CLI Surface Delta vs Voice Tools

**Build:** task_1778991572765_579980 (Voice Coordinator Sprint, ship Mon 5/25)
**Author:** Collie, Phase 0 step 4 of runbook
**Source of truth:** `cli_anything/propertymeld/cli.py` HEAD (b6e40a0, branch main), `blue-voice-gateway/src/voice-tools.ts` HEAD
**Generated:** 2026-05-17 04:30 UTC

---

## Headline

- **17 voice tools shipped** (parity confirmed in `voice-tools.ts`)
- **36 pm CLI commands in source** (excluding admin: api-keys, probe)
- **Wrap gap: 19 commands** that exist in source but have no voice route
- **Source/binary skew RISK:** 4 commands (projects create/edit/detach-meld + work-orders update-notes) shipped in PR #4 (commit 13c3902) are NOT in the installed pipx binary — `pipx reinstall cli-anything-pm` required before Phase 3 wraps land

---

## 17 Voice Tools Currently Shipped

| # | Voice route | pm CLI subprocess | Category |
|---|---|---|---|
| 1 | lookup_meld | work-orders get | read |
| 2 | search_melds | work-orders list | read |
| 3 | get_vendor_status | vendors list (filter) | read |
| 4 | recent_melds_for_property | work-orders list (filter) | read |
| 5 | assign_vendor | assign-vendor | write |
| 6 | send_message_on_meld | work-orders send-message | write |
| 7 | schedule_meld | work-orders schedule-vendor | write |
| 8 | send_sms | Telnyx direct (no pm CLI) | comms |
| 9 | text_david | Telnyx direct (no pm CLI) | comms |
| 10 | get_meld_work_entries | work-orders work-entries | read |
| 11 | get_meld_files | work-orders files | read |
| 12 | get_meld_comments | work-orders comments | read |
| 13 | list_melds_by_status | work-orders list --status | read |
| 14 | assign_tech | assign-tech | write |
| 15 | cancel_meld | work-orders cancel | write |
| 16 | complete_meld | work-orders complete | write |
| 17 | list_vendors | vendors list | read |

---

## Unwrapped pm CLI Surface (19 commands)

### High voice-value (Phase 3 wrap candidates)

These are realistic things a caller would ask about. Recommended for tool surface 17 → 22-25.

| Priority | pm command | Proposed voice tool | Why |
|---|---|---|---|
| P0 | work-orders inspect | inspect_meld | Catch-all snapshot — "tell me everything about TX..." in one tool call |
| P0 | work-orders merge | merge_melds | Vendor scenario: "we got two work orders for the same thing" |
| P0 | work-orders schedule | schedule_tech_meld | In-house tech schedule — distinct from existing schedule_meld (vendor) |
| P0 | projects list | list_projects | "What projects are open at 123 Main" |
| P0 | projects get | get_project | "Tell me about project X" |
| P0 | properties list | list_properties | Location lookup — feeds vendor "where is..." flow |
| P1 | tenants get | get_tenant *(privacy gate)* | Vendor asks "who's the tenant" — return first name only, no DOB/SSN |
| P1 | estimates create | create_estimate | Vendor calls in an estimate over the phone |
| P1 | estimates link | link_estimate | "Attach this estimate to meld X" |
| P1 | estimates list | list_estimates | Manager checking outstanding |
| P1 | work-orders update-notes ⚠️ | update_meld_notes | Carlos calls in completion notes — REQUIRES pipx reinstall first |

= 11 P0/P1 candidates → wraps land at 28; pare to 22-25 by dropping receipts + estimates update from initial cut.

### Low voice-value (skip Phase 3, revisit post-5/25)

| pm command | Why skip |
|---|---|
| work-orders upload-file | No file in a voice call |
| work-orders clone | Manager workflow, rare in voice |
| projects add-melds | Manager workflow |
| projects create-meld-in | Manager workflow |
| projects create / edit / detach-meld | Manager workflow, rare in voice |
| tenants list | Privacy risk on broad listing; tenants get with gate is enough |
| estimates get / update | Manager-side detail review |
| receipts list / get / upload / link | Vendor sends receipts via Telnyx SMS/email, not voice |

### Blocked on Codie work-entries CLI expansion (Mon-Tue)

| pm command | Proposed voice tool | Status |
|---|---|---|
| work-orders work-entries create | log_work_entry | BLOCKED — CLI not yet shipped |
| work-orders work-entries update | edit_work_entry | BLOCKED — CLI not yet shipped |
| work-orders work-entries delete | remove_work_entry | BLOCKED — CLI not yet shipped |

These 3 are Phase 3 stretch — fold in when Codie ships Mon-Tue per runbook coord plan.

---

## Source/Binary Skew (Phase 0 blocker to clear)

PR #4 (`13c3902 feat(cli): pm projects create/edit/detach-meld + work-orders update-notes`) is merged to main but the installed pipx binary at `/Users/davidhunter/.local/bin/pm` does not have those commands.

**Verification:**
```
$ pm work-orders update-notes --help
Error: No such command 'update-notes'.

$ pm projects create --help
Error: No such command 'create'.

$ grep "update-notes\|projects.command" cli_anything/propertymeld/cli.py
  # both present in source
```

**Fix:** `pipx reinstall cli-anything-pm` (or `pipx install --editable /Users/davidhunter/projects/cli-anything-pm` for dev mode). Run before Phase 3 PR opens so wraps can subprocess the new commands.

**Risk if skipped:** Phase 3 routes will return ok:false (`pm: No such command`) under live smoke.

---

## Recommended Phase 3 Wrap List (Final Pick = 8 new tools → 25 total)

```
17 existing
 + inspect_meld           (work-orders inspect)
 + merge_melds            (work-orders merge)
 + schedule_tech_meld     (work-orders schedule)
 + list_projects          (projects list)
 + get_project            (projects get)
 + list_properties        (properties list)
 + get_tenant             (tenants get) [first-name-only + privacy redact in wrapper]
 + update_meld_notes      (work-orders update-notes) [post pipx reinstall]
= 25 total
```

Stretch (+3 if Codie ships Mon-Tue):
```
 + log_work_entry         (work-orders work-entries create)
 + edit_work_entry        (work-orders work-entries update)
 + remove_work_entry      (work-orders work-entries delete)
= 28 total (over target — drop 3 P1 from primary list or accept overage)
```

---

## Acceptance Criteria (carry forward to Phase 3 dispatch to Codie)

For each new route:
- Fastify POST `/voice/tools/<name>` with consistent `getArg` signature
- Subprocess pm CLI via `runPm` (NOT direct HTTP)
- Always return `{ ok, data?, error? }` shape — never throw
- Required-arg validation returns `ok:false` with explicit field name
- Contract test in `test/voice-tools.test.ts` for: happy path, missing-arg, bad-arg (ok:false graceful)
- Privacy: tenants get wrapper redacts last name + email + DOB + any owner names before returning

---

## Next (Phase 0 step 5-6)

5. Inventory David day-mode actions queued — N/A this build per runbook (autonomous, no David asks until Sunday brief or genuine blocker)
6. Send Codie coord ping re Mon-Tue work-entries CLI command shape — happening next in heartbeat

Phase 1 (Telnyx API audit) + Phase 2 (persona writer) spin up as parallel sub-agents after this delta + Codie ping land.

---

## Links

- [[voice-coordinator-build-runbook-2026-05-18]] — parent runbook
- voice-tools.ts: `/Users/davidhunter/projects/blue-voice-gateway/src/voice-tools.ts`
- cli source: `/Users/davidhunter/projects/cli-anything-pm/cli_anything/propertymeld/cli.py`
- pipx skew: requires `pipx reinstall cli-anything-pm` before Phase 3

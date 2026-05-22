# pm work-entries CRUD — Architect Doc (2026-05-18)

**Source backlog:** `pm-cli-gap-backlog-2026-05-18.md` P1 #1
**Owner:** Collie (architect) → Codie (executor)
**Repo:** `cli-anything-pm` (`cli_anything.propertymeld`)
**Status:** plan-only, no code written

---

## 1. Codebase summary

`cli_anything/propertymeld/cli.py` is a Click-based CLI rooted at a single `cli()` group with sub-groups (`work-orders`, `properties`, `tenants`, `vendors`, `projects`, `estimates`, `receipts`, plus top-level `assign-tech`, `assign-vendor`, `probe`, `api-keys`).

**Established patterns** (from cli.py):

- Decorator style: `@work_orders.command("name")`, args via `@click.argument`, options via `@click.option`.
- Every write command takes `--meld-id` or positional `meld_id` and passes through `_normalize_meld_id()` (resolves short codes like `TKG5XYM` to integer PK).
- Every command ends with `output_json(result)`; `--json` is a default-true flag (cosmetic; output is JSON regardless).
- Read commands route to `api_backend` (Nexus API); write/browser-session commands route to `http_backend` (cookie-auth, manager-side).
- Backend functions return a `{"ok": True, ...}` envelope with the raw PM response under `"result"`.
- Manager-side write rule (memory `feedback_pm_uploads_manager_only`): create/edit work-entries flows through the manager endpoint. Vendor-side variants are out of scope here.

**Existing work-entries surface (cli.py:85-92):**
```python
@work_orders.command("work-entries")
@click.argument("meld_id")
def get_work_entries(meld_id, as_json):
    """List per-visit work-entries (checkin/checkout/hours/agent/notes) for a meld."""
    results = http_backend.list_work_entries(meld_id)
    output_json(results)
```

This is a **flat command** on the `work-orders` group, not a sub-sub-group. We must decide between (a) keeping it flat and adding sibling commands `work-entries-create / work-entries-update / work-entries-delete`, or (b) refactoring `work-entries` into a sub-sub-group with `list / create / update / delete` (mirrors the `estimates` and `projects` groups). **Recommendation: option (b).** Naming consistency across the CLI matters more than backwards compatibility on an internal verb that no agent has hard-coded into scripts yet (Blue confirms list is read-only and rarely scripted). One breaking change buys a clean surface.

---

## 2. Endpoint shape verification

**All three endpoints are already implemented and HAR-verified in `http_backend.py`.** This task is CLI-surface only — no new backend functions required.

| Op     | Backend fn                              | HTTP                                                | Verified                |
|--------|-----------------------------------------|-----------------------------------------------------|-------------------------|
| CREATE | `create_work_entry(meld_id, *, agent, description, long_description, checkin, checkout, hours)` | `POST /api/melds/{meld_id}/work-entries/` (nested)  | 2026-05-16 025132Z, 201 |
| UPDATE | `update_work_entry(entry_id, *, description, long_description, checkin, checkout, hours, agent)` | `PATCH /api/melds/work-entries/{entry_id}/` (top)   | 2026-05-16 025132Z      |
| DELETE | `delete_work_entry(entry_id)`            | `DELETE /api/melds/work-entries/{entry_id}/` (top)  | 2026-05-16 030217Z, 204 |

**Path-shape gotcha confirmed and handled:** the backend correctly implements nested CREATE / top-level EDIT-DELETE (locked memory `feedback_pm_nested_create_top_level_edit`).

**CREATE body fields** (from `http_backend.py:756-767`):
- `agent` (int, required) — persona_id of the maintenance person
- `description` (string, required)
- `long_description` (string, default `""`)
- `meld` (int, auto-injected by backend from path arg)
- `checkin`, `checkout` (ISO 8601, optional)
- `hours` (float, optional; PM may compute from checkin/checkout)

**UPDATE body shape:** partial PATCH — only fields the caller passes are sent, plus `id` echoed. Backend doc-string notes PM also accepts full echo; switch to GET-then-overlay if a future smoke surfaces 400 on partial (same fallback the `update_project` flow already uses).

---

## 3. CLI signature spec

All three commands live under `work_orders.group("work-entries")` after the existing `list` is moved into the new group.

### 3.1 `pm work-orders work-entries list MELD_ID` (rename only)
Move existing flat command into the new sub-group. Behaviour unchanged.

```
@work_entries_group.command("list")
@click.argument("meld_id")
@click.option("--json", "as_json", is_flag=True, default=True)
```

### 3.2 `pm work-orders work-entries create`

```
pm work-orders work-entries create \
    --meld-id 12345 \
    --agent-id 57544 \
    --description "Replaced kitchen P-trap" \
    [--long-description "..."] \
    [--checkin  2026-05-18T09:00:00-04:00] \
    [--checkout 2026-05-18T10:30:00-04:00] \
    [--hours 1.5]
```

Click signature:
```python
@work_entries_group.command("create")
@click.option("--meld-id", required=True)
@click.option("--agent-id", "agent", required=True, type=int,
              help="Persona ID of the agent who performed the work")
@click.option("--description", required=True)
@click.option("--long-description", "long_description", default="")
@click.option("--checkin", default=None, help="ISO 8601 start time")
@click.option("--checkout", default=None, help="ISO 8601 end time")
@click.option("--hours", default=None, type=float,
              help="Hours worked. PM auto-computes from checkin/checkout if omitted.")
@click.option("--json", "as_json", is_flag=True, default=True)
```

### 3.3 `pm work-orders work-entries update ENTRY_ID`

```
pm work-orders work-entries update 998877 \
    [--description "..."] \
    [--long-description "..."] \
    [--checkin  ISO] \
    [--checkout ISO] \
    [--hours N] \
    [--agent-id N]
```

Click signature — all fields optional; backend treats `None` as "do not patch".

```python
@work_entries_group.command("update")
@click.argument("entry_id", type=int)
@click.option("--description", default=None)
@click.option("--long-description", "long_description", default=None)
@click.option("--checkin", default=None)
@click.option("--checkout", default=None)
@click.option("--hours", default=None, type=float)
@click.option("--agent-id", "agent", default=None, type=int)
@click.option("--json", "as_json", is_flag=True, default=True)
```

Validation: if all six update fields are `None`, fail early with exit_code 2 and a `{"ok": false, "error": "no fields to update"}` JSON envelope. (Avoids burning a CSRF round-trip + getting a confusing 400 from PM.)

### 3.4 `pm work-orders work-entries delete ENTRY_ID`

```
pm work-orders work-entries delete 998877 [--force]
```

```python
@work_entries_group.command("delete")
@click.argument("entry_id", type=int)
@click.option("--force", is_flag=True, default=False,
              help="Skip the interactive confirm prompt.")
@click.option("--json", "as_json", is_flag=True, default=True)
def delete_work_entry_cmd(entry_id, force, as_json):
    if not force:
        click.confirm(f"Delete work-entry {entry_id}? This is irreversible.", abort=True)
    result = http_backend.delete_work_entry(entry_id)
    output_json(result)
```

`--force` matters because automations (vendor-text-to-meld pipeline) won't have a TTY. Same pattern as common CLI norms (e.g. `rm -f`).

---

## 4. Sub-agent dispatch plan

Two sub-agents — scope is small enough that smoke can fold into the test agent's brief.

### Sub-agent A — CLI surface (Codie)
**Owns (write):** `cli_anything/propertymeld/cli.py`

**Spec:**
1. Delete the existing `@work_orders.command("work-entries")` flat command (lines 85-92).
2. Add `@work_orders.group("work-entries")` returning `work_entries_group`.
3. Re-implement `list` as `@work_entries_group.command("list")` — identical body.
4. Implement `create`, `update`, `delete` per §3.2-3.4. All three call existing `http_backend` functions; no backend changes.
5. Backend module is **untouched** — `create_work_entry`, `update_work_entry`, `delete_work_entry` already exist and are HAR-verified.

**Out of scope:** README, version bump (those go in Codie's normal ship-tail).

### Sub-agent B — tests + smoke (Codie, after A merges)
**Owns (write):** `tests/test_cli_work_entries.py` (new file), `scripts/smoke_work_entries.sh` (new file).

**Spec:**

*Unit/contract tests* — mirror the `TestWorkOrdersCLI` pattern in `tests/test_cli.py`:
- `test_create_invokes_backend_with_correct_kwargs` — patch `http_backend.create_work_entry`, assert it's called with `(meld_id="12345", agent=57544, description="...", long_description="", checkin=None, checkout=None, hours=None)`.
- `test_create_passes_optional_fields_when_provided` — full flag set.
- `test_create_missing_required_description_errors` — Click exit_code 2.
- `test_update_no_fields_returns_error_envelope` — CLI guard from §3.3.
- `test_update_partial_patch_sends_only_provided_fields` — assert backend kwargs.
- `test_delete_prompts_without_force` — CliRunner `input="n\n"` aborts.
- `test_delete_with_force_skips_prompt` — confirms backend called.
- `test_list_still_works_after_group_refactor` — regression guard for the breaking rename.

*Integration smoke* — `scripts/smoke_work_entries.sh`:
1. Create a work-entry on Blue's fixture meld (TKG5XYM, locked memory). Capture `entry_id`.
2. List entries; assert created entry present.
3. Update entry — change `description`. List again; assert change applied.
4. Delete entry `--force`. List again; assert gone.
5. Emit each step's JSON envelope to `smoke-results-work-entries-YYYYMMDD.json` per smoke evidence bar (`feedback_smoke_evidence_bar`).

Smoke runs **manually by Blue or Codie post-merge**, not in CI (CI has no PM creds).

---

## 5. Open questions

**Q1 — POST body field names.** ANSWERED via backend source: `agent`, `description`, `long_description`, `meld`, optional `checkin/checkout/hours`. Memory updated: PM treats `agent` as persona_id (int), NOT a nested object. No further verification needed.

**Q2 — Does PM auto-fill `agent` from auth session?** NO — `create_work_entry` requires `agent` as a positional kwarg. The cookie auth identifies the *uploader/operator* but PM models a work-entry's `agent` as a separate field (the person who did the work, who may not be the logged-in manager). CLI must require `--agent-id`. Future polish: a `pm staff list` lookup helper so Blue doesn't have to memorize persona IDs.

**Q3 — Required vs optional fields.** Click required: `--meld-id`, `--agent-id`, `--description`. Optional with sane defaults: everything else. This matches the backend's keyword-only signature and matches the captured HAR (which sent all four required fields and omitted hours, letting PM compute).

**Q4 — pipx reinstall coordination.** Same pattern as Phase 3 voice CLI gap-closers — Codie's deploy chain runs `pipx reinstall cli-anything-pm` after the merge. Blue's fleet picks up the new commands on next session boot (no agent restart required since they shell out to `pm`). Codie should bump `__version__` and announce in #ascendops-eng on merge.

**Q5 (new) — Group refactor breaks `pm work-orders work-entries 12345`.** The current command takes `meld_id` as positional. After refactor it becomes `pm work-orders work-entries list 12345`. Three agent scripts may grep for `work-entries` in shell history — Codie should grep cortextos/orgs for `work-orders work-entries` before merge and notify any owner.

---

## 6. Risks + mitigations

**R1 — Partial PATCH 400.** Backend assumes PM accepts partial-body PATCH. The doc-string itself flags this as untested at scale. Mitigation: if smoke (sub-agent B step 3) returns 400, switch `update_work_entry` to GET-then-overlay (same pattern as `update_project`). Add a fallback fixup task to the dispatch brief so Codie doesn't bounce back to Collie for a one-line change.

**R2 — `--agent-id` UX cliff.** Operators won't memorize persona IDs. First-time use will fail with "agent: 'Carlos' is not a valid integer". Mitigation: doc-string lists the 3-4 common agent IDs Blue uses, plus a future `pm staff list` follow-up filed separately. Acceptable for v1 since the immediate consumer is the vendor-text-to-meld pipeline (Blue knows the IDs).

**R3 — Delete with no confirm in CI/cron.** A scripted caller forgetting `--force` will hang on `click.confirm`. Mitigation: confirm prompt detects `not sys.stdin.isatty()` and auto-aborts with a clear error rather than blocking. (One extra line in §3.4 — folded into Codie's spec.)

**R4 — Breaking rename of `work-entries` from command to group.** Existing read calls `pm work-orders work-entries TKG5XYM` will fail with a Click "no such command" after this ships. Mitigation: grep agent shell histories + memory files before merge; if any caller exists, add a deprecated-compat shim that prints a warning and runs `list`. If grep is clean, ship straight-cut.

**R5 — Smoke evidence bar.** Per `feedback_smoke_evidence_bar` (locked fleet-wide 5/13): the smoke script must cite status code + response body for each operation, or explicitly mark "error-path only, never fired API call". Captured in sub-agent B spec — Codie's smoke script template must include `printf '%s %s\n' "$STATUS" "$BODY"` per step.

---

## Final-pass checklist for Codie

- [ ] Refactor `work-entries` flat command → sub-group with `list / create / update / delete`.
- [ ] No backend module changes — three functions already exist.
- [ ] `--force` flag on delete; auto-abort on no-TTY without `--force`.
- [ ] CLI guard: `update` with zero fields returns error envelope, exit 2.
- [ ] New test file mirroring `TestWorkOrdersCLI` patterns.
- [ ] Smoke script against TKG5XYM, JSON envelopes per step.
- [ ] Version bump + pipx reinstall in deploy chain.
- [ ] Grep cortextos/orgs for `work-orders work-entries` callers before merge.

---

**Path:** `/Users/davidhunter/cortextos/orgs/ascendops/docs/cli-work-entries-crud-architect-2026-05-18.md`

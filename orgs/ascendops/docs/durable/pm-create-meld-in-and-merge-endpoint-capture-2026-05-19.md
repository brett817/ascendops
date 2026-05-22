# PM /list-create-meld + /merge Endpoint Capture — 2026-05-19

**Source:** David HAR-capture session 2026-05-20T01:14:45Z via `scripts/pm-capture-meld-network-playwright.py` against live PM web UI.

**Raw capture:** `/Users/davidhunter/Desktop/pm-capture-20260520T011445Z.json` (57 matching of 497 intercepted, embed HAR at `.har` sibling).

**Triggered by:** P0 escalation on gap-bucket item #10 (CLI merge broken across all state combinations) + P1 #2 (create-meld-in 500). David's verbatim "huge problem we cannot merge melds in any way, shape, or form" earlier today.

**Outcome:** Both bugs diagnosed. Web UI ships clean POST 200/201 on both endpoints with structurally different payloads than our CLI sends.

---

## Finding 1 — Merge: endpoint URL semantic flipped + body fields wrong

### Web UI behavior (CAPTURED)

```
POST https://app.propertymeld.com/3287/m/3287/api/melds/{DESTINATION_id}/merge/
Body:
  {
    "destination_id": <DESTINATION_id>,
    "source_ids": [<source_id_1>, <source_id_2>, ...]
  }
Response: 200 { "message": "Melds merged successfully" }
```

### Our CLI (broken)

```python
# src/cli_anything/propertymeld/http_backend.py:merge_meld
def merge_meld(meld_id, into_meld_id):
    # POSTS to /api/melds/{meld_id}/merge/ with {"meld": into_meld_id}
    # i.e. URL meld_id = SOURCE; body.meld = DESTINATION
```

### Three concrete divergences

| | Web UI | Our CLI |
|---|---|---|
| URL meld id semantic | destination | source |
| Body field name(s) | `destination_id` + `source_ids` | `meld` |
| Multi-source per call | yes (`source_ids` is array) | no (one source per call) |

### Why we never noticed sooner

- CLI merge was added with the wrong semantic from day one.
- Read-only smoke matrix didn't cover writes (caught today by Dane's smoke-matrix-extension thinking).
- Past "successful" merges were almost certainly hand-driven via web UI or noisy CI runs we didn't follow through — there was never a regression test against a live merge.
- 3 reproductions today (both-Carlos, both-PENDING_ASSIGNMENT, mixed-PENDING+manager-assigned) all returned HTTP 400 "Destination Meld not found" because PM was looking up the URL meld id as the *destination* and finding it was the wrong-shape object for that role.

### Fix scope

Rewrite `merge_meld` to match captured web shape:
- URL: `melds/{destination_id}/merge/`
- Body: `{ destination_id: int, source_ids: [int, ...] }`
- CLI arg shape: accept multi-source via repeated `--source` flags or comma-list; require `--destination`.
- Update friendly-error wrapper to drop the stale PENDING_ASSIGNMENT-specific 400 detection (the 400 was a symptom of the wrong body shape, not the destination state).

---

## Finding 2 — create-meld-in: nested object field-shape hydration

### Web UI behavior (CAPTURED)

```
POST https://app.propertymeld.com/3287/m/3287/api/projects/{project_id}/list-create-meld/
Response: 201 (full meld object)
```

Top-level body keys match what our CLI sends:

```
['brief_description', 'description', 'due_date', 'has_pets', 'maintenance',
 'notify_owner', 'notify_owners_string', 'notify_tenants', 'notify_tenants_string',
 'permission_to_enter', 'pets', 'priority', 'project', 'tags',
 'tenant_presence_required', 'tenants', 'unit', 'work_category',
 'work_location', 'work_type']
```

### The hydration gap

Web UI's `maintenance[0]` is a FULL ManagementAgent object with 25 fields:

```
['agent_preferences', 'composite_id', 'contact', 'create_by', 'created',
 'default_invoice_filter', 'default_meld_filter', 'denormalized_property_groups',
 'department', 'first_name', 'flagged_melds', 'id', 'is_active', 'last_name',
 'management', 'new_notification_settings', 'profile_color', 'property_groups',
 'selected_property_groups', 'selected_show_properties_without_property_groups',
 'show_tour', 'title', 'type', 'update_by', 'updated', 'user']
```

Our CLI's `auto-hydrate` strips most of these. The 500 error fires because PM server-side validation expects at least some of these fields populated to non-null values.

Same shape gap for `unit` (21 fields incl. `apartment`, `current_tenants`, `display_address`, `prop`, `supplemental_data`, etc.) and `tenants[0]` (17 fields incl. `contact`, `default_language`, `notification_settings`, `prompt_for_mobile`, etc.).

### Fix scope (Phase 2 of this work)

- For `maintenance`: GET `/api/agents/{id}/` (or equivalent) returns the full agent object; pass through unchanged.
- For `unit`: GET `/api/units/{id}/` returns the full unit object including nested `display_address`, `prop`, `current_tenants`, etc.; pass through unchanged.
- For `tenants`: GET `/api/tenants/{id}/` returns the full tenant object; pass through unchanged.
- Update `create_meld_in_project` to call these GETs internally before assembling the POST payload.
- Add a `--maintenance-full-json` / `--unit-full-json` / `--tenants-full-json` flag for callers who already have hydrated objects (avoids the extra GETs in scripted contexts).

### Validation

Replay the captured request body with auth substituted — confirms 201. Construct an equivalent payload from our hydration path — must produce a payload structurally equivalent (field-by-field comparable) to the captured one.

---

## URL prefix observation (minor)

Web UI hits paths under `/3287/m/3287/api/...` (multitenant-prefixed). Our CLI uses `/api/...` directly via the existing base URL. Both reach the same route on PM's side — the multitenant prefix is a UI convenience that the API also accepts unprefixed. No action needed but flag for future capture diffs.

---

## Bucket items closed by this capture

- **#10 [P0] CLI merge broken across all meld-state combinations** — diagnosis locked, fix mechanical (this doc)
- **#2 [P1] pm-dev projects create-meld-in HTTP 500** — diagnosis locked (field-shape hydration), fix is Phase 2 of this work

## Bucket items NOT closed by this capture

- **#22 Playwright silent-fail** — separate diagnostic path (headed-vs-headless test). Scenario 3 of the HAR session was deferred per David's bandwidth.
- All other P1/P2/P3 items.

---

## Next steps

1. PR A (P0, ship first): rewrite `merge_meld` to captured shape. Single-file patch + new tests against captured fixture. ETA ~30 min.
2. PR B (P1, ships after merge PR clears review): rewrite `create_meld_in_project` hydration to fetch full objects before POST. Single-file patch + tests. ETA ~45 min from start.
3. Once both merged + deployed: rerun gap-bucket cleanup pass, mark items #10 and #2 as FIXED with merge commit oids.

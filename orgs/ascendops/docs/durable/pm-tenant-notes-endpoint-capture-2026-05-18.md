# PM Tenant Notes Endpoint — Playwright HAR Capture

**Status:** VERIFIED (200 OK, end-to-end revert confirmed)
**Date:** 2026-05-18
**Author:** collie
**Capture method:** Autonomous Playwright HAR (cookie-injection, headless)
**Probe tenant:** 4043079 (Angelica Acevedo — notes reverted to empty after capture)
**Closes:** P3 / P4 backlog item — `pm tenants edit-notes <tenant_id> --notes <text>` CLI hookup

---

## Endpoint summary

| | |
|---|---|
| URL | `https://app.propertymeld.com/{MULTITENANT}/m/{MULTITENANT}/api/tenants/{tenant_id}/` |
| Path (as passed to `_http_patch`) | `tenants/{tenant_id}/` |
| Method (web UI canonical) | **PUT** (200) |
| Method (verified alternative) | **PATCH** (200) — same shape, also works |
| Field | **`notes`** (NOT `maintenance_notes`) |
| Content-Type | `application/json` |
| Success status | `200` |
| Response body | full updated tenant object (same shape as `GET /api/tenants/{id}/`) |

---

## Request shape

The web UI sends the **entire tenant object** in the body — the endpoint is NOT a thin-patch endpoint. A `{"notes": "..."}`-only PATCH returns 400 because validators run on `first_name`/`last_name` even when not changed.

Required pattern: `GET /api/tenants/{id}/` → mutate `.notes` → `PATCH` (or `PUT`) full body back.

### Headers (filtered to load-bearing)

```
Cookie: sessionid=...; ajs_group_id=3287; ... (full PM cookie jar)
Content-Type: application/json
Accept: application/json, text/plain, */*
X-CSRFToken: <csrf token from /melds/ HTML>
X-Requested-With: XMLHttpRequest          (added by our existing helpers — not strictly required by capture, web UI omitted it)
Origin: https://app.propertymeld.com
Referer: https://app.propertymeld.com/{MULTITENANT}/m/{MULTITENANT}/tenants/{id}/
```

Notes:
- No `x-multitenant-id` header. Multi-tenancy is encoded in the URL path (`/3287/m/3287/...`).
- The CSRF token must be present for PUT/PATCH (already handled by `_get_csrf_token()` in `http_backend.py`).

### Request body (PUT, full payload — captured)

```jsonc
{
  "id": 4043079,
  "user": { "id": 1934544, "email": "...", "first_name": "", "last_name": "", "last_active_at": "...", "last_active_channel": "DIGITAL", "last_login": "..." },
  "contact": { "id": 5033775, "home_phone": "", "cell_phone": "(706) 913-7178", "business_phone": "", "fax": "", "created": "...", "create_by": null, "updated": "...", "update_by": {"org_type":"t","persona_id":4043079}, "home_phone_ext": "", "cell_phone_ext": "", "business_phone_ext": "", "primary_email": "...", "secondary_email": "", "tertiary_email": "" },
  "invited": true,
  "last_invite": { "created": "...", "email": "...", "id": 13468201 },
  "created": "...",
  "create_by": null,
  "updated": "...",
  "update_by": { "org_type": "t", "persona_id": 4043079 },
  "is_active": true,
  "first_name": "Angelica",
  "middle_name": "",
  "last_name": "Acevedo",
  "notes": "<the new notes string>",                 // ← THE ONLY MUTATED FIELD
  "prompt_for_mobile": false,
  "default_language": "",
  "address": null,
  "management": 3287,
  "leases": [ { "unit_id": 1754357, "lease_start_date": "...", "lease_end_date": "...", "move_in_date": "...", "move_out_date": null } ],
  "links": [ { "resource_id": 991773346, "deleted": null, "active": true, "name": "...", "integration": {...} } ]
}
```

In practice, the safe pattern is to feed back whatever `GET` returns, mutating only `notes`.

### Response shape

`200 OK` with the updated tenant object — same shape as request, with `updated` and `update_by` bumped to reflect this write. `notes` reflects the value we sent.

---

## Notable observations

1. **Field name is `notes`, NOT `maintenance_notes`.** Distinct from unit-level (`maintenance_notes` on `/api/units/{id}/`) and meld-level (`maintenance_notes` on `/api/v2/melds/{id}/notes/`). Fleet rule `feedback_pm_two_note_fields` is preserved — this is yet another note location.

2. **The endpoint is `/api/`, NOT `/api/v2/`.** Unlike meld-notes, which lives on `/api/v2/melds/{id}/notes/`. The tenant write goes through the same `/api/tenants/{id}/` URL that `get_tenant()` already hits.

3. **Single notes field per tenant.** No internal-vs-tenant-visible split; no "Maintenance notes" vs "Internal notes" distinction. The Resident detail page's Notes panel has exactly ONE textarea (verified via DOM inventory).
   - Selector used to find it (in case anyone reruns this): `textarea[name='notes']` after clicking `[data-testid='resident-details-notes-tab']` then `[data-testid='notes-tab-edit-link']`.

4. **Full-body echo required.** Thin `{"notes": "..."}` PATCH returns 400 with `first_name`/`last_name` validator errors. Validators run on the full payload; the absence of those fields triggers them.

5. **PUT and PATCH both work** with the full body. Web UI uses PUT; our existing helper `_http_patch()` also produces 200. Either is fine.

6. **No special auth differences.** Same cookie jar + CSRF token already used by `update_unit_notes` works here.

---

## Code-side hookup hints

The cleanest implementation mirrors `update_unit_notes` (line 1202–1229 of `cli_anything/propertymeld/http_backend.py`) but does a fetch-mutate-write sequence since the endpoint demands full body:

```python
@with_recapture_retry
def update_tenant_notes(tenant_id, notes: str) -> dict:
    """Update the notes field on a tenant.

    PUT /api/tenants/{tenant_id}/ with the full tenant body, mutating only
    `notes` — verified shape from pm-tenant-notes-endpoint-capture-2026-05-18.

    NOTE: thin {"notes": "..."} PATCH returns 400 (validators run on full
    payload). Must GET → mutate → PATCH/PUT.
    """
    tenant_id_int = int(tenant_id)
    creds = _load_creds()
    cookie_hdr = _cookie_header(creds)
    csrf_token = _get_csrf_token(cookie_hdr)
    # 1. GET full tenant
    current = _http_get(f"tenants/{tenant_id_int}/", cookie_hdr)
    # 2. Mutate notes only
    current["notes"] = notes
    # 3. PUT (or PATCH — both work) full body
    result = _http_patch(f"tenants/{tenant_id_int}/", current, cookie_hdr, csrf_token)
    return {
        "ok": True,
        "tenant_id": tenant_id_int,
        "notes": result.get("notes", notes),
        "result": result,
    }
```

**Why PATCH over PUT in the helper:** the existing `_http_patch` already exists and is well-tested; PUT would require adding `_http_put`. Both methods produce 200 with the same body shape, so reusing PATCH is the smaller diff.

**CLI subcommand placement** (`cli_anything/propertymeld/cli.py`): add under the `tenants` group, mirroring `units edit-notes` if that exists, otherwise pattern after `tenants get`. Signature: `pm tenants edit-notes <tenant_id> --notes <text>` (or read from stdin / file for long notes).

---

## Verification trail

1. **HAR capture file:** `/tmp/pm-tenant-notes.har`
2. **Parsed capture JSON:** `/tmp/pm-tenant-notes-capture.json` (1 PM-API write captured: `PUT /3287/m/3287/api/tenants/4043079/ -> 200`)
3. **Capture script:** `/tmp/pm-tenant-notes-har-capture.py` (autonomous, uses saved cookies, no human in loop)
4. **Thin-PATCH negative test:** `/tmp/pm-tenant-notes-thin-patch.py` (`PATCH {"notes":""} -> 400`)
5. **Full-body PATCH positive test + revert:** `/tmp/pm-tenant-notes-revert.py` (`PATCH full -> 200`, `GET` confirms `notes=''`)
6. **Post-capture state:** tenant 4043079 `notes` reverted to empty string; no residual probe text. Verified via `pm tenants get 4043079`.

---

## Status

**VERIFIED.** Endpoint, method, payload shape, headers, success status, and response shape all captured live with status 200 and round-trip-reverted. Next step (writing the CLI helper) is **unblocked** — implementation pattern above is copy-paste ready into `http_backend.py`.

# Phase 6A — Caller-Scope Integration Plan

**For:** Main Collie (post-dispatch integration)
**Date:** 2026-05-18
**Author:** Sub-agent A
**Module:** `src/caller-scope.ts` (built, type-checks clean, no tests yet — Sub-agent C owns tests)

## What this module gives you

Three exports in `./caller-scope.js`:

```ts
extractCallerPhone(request: FastifyRequest)
  : Promise<{ phone: string | null; resolved: boolean; reason?: string }>

validateCallerForMeld(callerPhone: string | null, meldData: unknown)
  : { allowed: boolean; reason?: string }

logScopeCheck(fastify: FastifyInstance, event: {
  call_control_id?: string;
  caller_phone: string | null;
  meld_id: string;
  allowed: boolean;
  reason?: string;
}): void
```

Plus a `__resetCallerCacheForTests()` escape hatch for vitest (do not call in production paths).

**Behaviour locked by David 2026-05-18:**
- Fail-OPEN when caller phone is null (unresolvable header, no TELNYX_API_KEY, Telnyx 404, fetch timeout, JSON parse fail).
- Fail-OPEN when meld has no vendor/tenant/coordinator phones to compare against.
- Reject only when caller phone resolves AND meld phones resolve AND no match.
- Phone match is last-7-digit (strips `+`, `-`, spaces, parens). Handles `+1` prefix variability.
- 10-min in-memory TTL cache, keyed by `x-telnyx-call-control-id`. One Telnyx API call per call.

**Every check — pass or fail-open — must be `logScopeCheck`'d.** That is the audit trail David asked for.

---

## Routes that NEED the scope check

These routes either return specific meld details or perform a write against a specific meld. Wire the guard around the `runPm` call.

| Route | Trigger payload arg | Meld id source |
|---|---|---|
| `lookup_meld` | `meld_id` | arg |
| `recent_melds_for_property` | `address` | each result row's `id` (see note below) |
| `get_meld_files` | `meld_id` | arg |
| `get_meld_comments` | `meld_id` | arg |
| `get_meld_work_entries` | `meld_id` | arg |
| `schedule_meld` | `meld_id` | arg |
| `send_message_on_meld` | `meld_id` | arg |
| `assign_vendor` | `meld_id` | arg |
| `assign_tech` | `meld_id` | arg |
| `cancel_meld` | `meld_id` | arg |
| `complete_meld` | `meld_id` | arg |
| `update_meld_notes` *(post-Codie)* | `meld_id` | arg |
| `merge_melds` *(post-Codie)* | `source_meld_id` + `destination_meld_id` | validate BOTH against caller; reject if either fails |

### Routes that DO NOT need the scope check

- `list_vendors` — no specific meld disclosure.
- `list_melds_by_status` — list view, no caller-specific data exposure (matches David's call on `search_melds` exclusion in the architect plan).
- `get_vendor_status` — vendor lookup, not meld-bound.
- `send_sms` — operator tool (David triggers it explicitly).
- `text_david` — operator tool (always allowed to David).
- `search_melds` — current impl is a generic list; treat as out-of-scope per architect plan Q2 default (a). If David picks option (b) later, swap to per-meld filter — not in this dispatch.

---

## Code pattern (single-meld routes)

For routes where the meld id is already in the args (most cases), do the lookup, validate, then return:

```ts
import { extractCallerPhone, validateCallerForMeld, logScopeCheck } from './caller-scope.js';

fastify.post('/voice/tools/lookup_meld', async (request, reply) => {
  const meldId = getArg<string>(request.body, 'meld_id');
  if (!meldId) return reply.code(200).send({ ok: false, error: 'meld_id is required' });
  const id = String(meldId).trim().replace(/^TX/i, '');
  fastify.log.info({ tool: 'lookup_meld', meldId: id }, 'voice tool invoked');

  const result = await runPm(['work-orders', 'get', id, '--json']);
  if (!result.ok) return reply.code(200).send(result);

  // ---- Caller-scope guard ----
  const callerInfo = await extractCallerPhone(request);
  const verdict = validateCallerForMeld(callerInfo.phone, result.data);
  const ccid = request.headers['x-telnyx-call-control-id'] as string | undefined;
  logScopeCheck(fastify, {
    call_control_id: ccid,
    caller_phone: callerInfo.phone,
    meld_id: id,
    allowed: verdict.allowed,
    reason: verdict.reason ?? callerInfo.reason,
  });
  if (!verdict.allowed) {
    return reply.code(200).send({
      ok: false,
      error: "This call doesn't appear to be associated with that meld.",
    });
  }
  // ---- end guard ----

  return reply.code(200).send(result);
});
```

### Write tools (schedule_meld, assign_vendor, etc.)

Write tools must validate BEFORE the write, not after. Pattern:

```ts
fastify.post('/voice/tools/schedule_meld', async (request, reply) => {
  const meldId = getArg<string>(request.body, 'meld_id');
  const startsAt = getArg<string>(request.body, 'starts_at');
  if (!meldId || !startsAt) {
    return reply.code(200).send({ ok: false, error: 'meld_id and starts_at required' });
  }
  const id = String(meldId).trim().replace(/^TX/i, '');

  // Lightweight read to authorise.
  const lookup = await runPm(['work-orders', 'get', id, '--json']);
  if (!lookup.ok) return reply.code(200).send(lookup);

  const callerInfo = await extractCallerPhone(request);
  const verdict = validateCallerForMeld(callerInfo.phone, lookup.data);
  const ccid = request.headers['x-telnyx-call-control-id'] as string | undefined;
  logScopeCheck(fastify, {
    call_control_id: ccid,
    caller_phone: callerInfo.phone,
    meld_id: id,
    allowed: verdict.allowed,
    reason: verdict.reason ?? callerInfo.reason,
  });
  if (!verdict.allowed) {
    return reply.code(200).send({
      ok: false,
      error: "This call doesn't appear to be associated with that meld.",
    });
  }

  // Proceed with the write.
  const result = await runPm(['work-orders', 'schedule', id, '--starts-at', startsAt, '--json']);
  return reply.code(200).send(result);
});
```

The extra `runPm` is cheap (one snapcli get) — and the 10-min cache means subsequent tools in the same call skip the Telnyx fetch.

### Order-of-operations note for `lookup_meld`

Chicken-and-egg: `lookup_meld` IS the call that fetches the meld. Solution above already handles it — runPm first, then validate against `result.data`, then either return the data or the rejection.

### `recent_melds_for_property` (list result)

This route returns up to N melds matching an address. Two reasonable strategies — pick one:

1. **Filter the list:** apply `validateCallerForMeld` per row; only return rows where `allowed === true`. Log one `scope_check` per row, with `meld_id` set to that row's id.
2. **All-or-nothing:** validate against the FIRST row's meld data; if rejected, return empty. Cheaper logging but loses partial matches.

**Recommendation: option 1.** Privacy posture stronger and the per-row cost is in-memory.

### `merge_melds` (post-Codie)

Two meld ids. Lookup both, validate caller against both, reject if either fails. Log two `scope_check` events (one per meld).

---

## Files to touch

- `src/voice-tools.ts` — add the import + guard block to each of the 11 (or 13 post-Codie) routes listed above.
- **No other src file.** `caller-scope.ts` has no upstream dependencies on voice-tools.

---

## What this plan does NOT cover

- Tests — Sub-agent C scaffolds vitest + `caller-scope.test.ts`.
- Photo handoff — Sub-agent B.
- Telnyx assistant tool definitions — handled in the main Collie deploy step (Phase 6 architect plan §4.3).
- `search_melds` filter-mode-(b) — flagged in architect plan Q2, deferred until David picks.
- `update_meld_notes` / `merge_melds` route bodies — those tools don't exist yet (Codie pending). Add the guard at the same time as the route body.

---

## Quick smoke after integration

1. `npm run build` — must compile clean.
2. `curl -X POST http://localhost:3000/voice/tools/lookup_meld -H 'Content-Type: application/json' -d '{"meld_id":"TX12345"}'` — should succeed (no `x-telnyx-call-control-id` header → fail-open, look for `scope_check` log entry with `reason: "fail-open: caller phone unresolved"`).
3. Real Telnyx call hitting `lookup_meld` with a meld whose vendor phone matches the caller → `allowed: true` in log, no `reason`.
4. Real Telnyx call hitting `lookup_meld` with someone else's meld → `allowed: false`, `error: "This call doesn't appear..."` in response.

/Users/davidhunter/cortextos/orgs/ascendops/docs/phase-6a-integration-plan.md

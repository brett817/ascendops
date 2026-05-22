# Phase 5 Sub-agent B — Integration Plan

**Date:** 2026-05-18
**Author:** Sub-agent B (collie)
**Scope:** Telnyx transcript pull + `GET /transcripts/:call_control_id` endpoint.
**Sibling docs:** `phase-5a-integration-plan.md` (Neon store), `phase-5c-integration-plan.md` (TBD — finalize-call).

---

## Files shipped

- `/Users/davidhunter/projects/blue-voice-gateway/src/transcript-fetch.ts` — `pullTranscript(ccid)` → Telnyx GET ×2 → normalize → upsert via Sub-agent A's `upsertTranscript`. 10-min in-memory cache keyed on `call_control_id`. 5s `AbortSignal.timeout` per Telnyx call. Same Bearer-auth pattern as `caller-scope.ts`.
- `/Users/davidhunter/projects/blue-voice-gateway/src/routes-transcripts.ts` — `registerTranscriptRoutes(fastify)` exporting `GET /transcripts/:call_control_id`. Cache-first (Neon); `?force=1` bypasses cache and always re-pulls. All errors returned as `{ok:false, error}` at HTTP 200 (payload-wrapped error pattern matching `voice-tools.ts`).
- `/Users/davidhunter/projects/blue-voice-gateway/test/phase-5/b-fetch.test.ts` — 13 vitest tests (8 `pullTranscript`, 5 GET endpoint). Mocks `transcripts-store` and `globalThis.fetch`; no live Telnyx, no live Neon.

Build verdict: `npm run build` clean. Test verdict: `npm test` → 48 passed (48) across all 4 test files; B contributes 13. No regressions to caller-scope / photo-handoff / a-store suites.

---

## What Collie wires into `src/index.ts`

Single line, added after the existing voice-tool route registrations (and after Sub-agent A's `await runMigrations()` boot step, since migrations must succeed before any route that touches Neon comes online):

```ts
import { registerTranscriptRoutes } from './routes-transcripts.js';
// ...
await registerTranscriptRoutes(fastify);
```

No additional env vars beyond what Sub-agent A already requires (`DATABASE_URL`, plus the existing `TELNYX_API_KEY` used by the conversations + messages GETs).

---

## Public surface exported by B

`src/transcript-fetch.ts`:
- `pullTranscript(call_control_id: string): Promise<FetchResult>` — main entry point. Returns `{ok:true, data:PulledTranscript}` or `{ok:false, error:string}`. Never throws.
- `PulledTranscript` type alias to Sub-agent A's `TranscriptUpsertInput` (the pre-DB record shape — DB-managed `created_at`/`updated_at` are stamped on upsert).
- `FetchResult` discriminated union.
- `__resetTranscriptCacheForTests()` — test-only escape hatch, mirrors the one in `caller-scope.ts`.

`src/routes-transcripts.ts`:
- `registerTranscriptRoutes(fastify: FastifyInstance): Promise<void>` — single export.

---

## How Sub-agent C consumes B

In `src/routes-finalize-call.ts`:

```ts
import { pullTranscript } from './transcript-fetch.js';
// ...
const pulled = await pullTranscript(ccid);
if (!pulled.ok) {
  fastify.log.warn({ ccid, error: pulled.error }, 'transcript pull failed in /finalize-call');
  return; // exit chain — nothing to summarize
}
const transcript = pulled.data;
// transcript.transcript_messages → feed to summarizeTranscript()
// transcript.meld_id            → if non-null, route the summary to PM
```

Important: `pullTranscript` already writes to Neon via `upsertTranscript`. C should NOT also call `upsertTranscript` for the same row immediately afterward — it's a no-op COALESCE, but adds DB churn. C's *summary* update goes through `updateTranscriptSummary(ccid, summary, pm_patch_status, pm_upload_status)` (Sub-agent A surface), which is the right path.

If C wants to short-circuit Telnyx (e.g., transcript already in Neon from an earlier B GET), it can call `getTranscriptByCallControlId` first and fall back to `pullTranscript` on miss — exactly what `routes-transcripts.ts` already does, so C can reuse that pattern.

---

## Endpoint contract (for downstream tooling / Dane / curl smoke)

```
GET /transcripts/:call_control_id
GET /transcripts/:call_control_id?force=1
```

**Response shape** (always HTTP 200):

```jsonc
// Cache hit (Neon):
{ "ok": true, "data": { ... TranscriptRecord ... }, "source": "neon" }

// Miss → fresh Telnyx pull:
{ "ok": true, "data": { ... TranscriptUpsertInput ... }, "source": "telnyx" }

// force=1:
{ "ok": true, "data": { ... }, "source": "telnyx-forced" }

// Telnyx fail or no conversation:
{ "ok": false, "error": "no conversation for call_control_id ccid-xyz" }
{ "ok": false, "error": "telnyx fetch failed: aborted: timeout" }
```

`source` field is informational — useful for smoke testing to confirm cache behavior. Consumers should only branch on `ok`.

---

## Caching model

- **B's in-memory cache** (`transcript-fetch.ts`): 10-min TTL, keyed on `call_control_id`. Mirrors `caller-scope.ts`. Survives only within the Node process — bounces on Railway restart. Purpose: defend the Telnyx API from a burst of GETs during the same call window (e.g., `/finalize-call` runs while a manual debug `curl /transcripts/:ccid` also fires).
- **Neon as durable cache** (Sub-agent A): the persistent record. Read via `getTranscriptByCallControlId`, written on every successful `pullTranscript`.
- **GET route logic**: Neon first (durable) → on miss or `?force=1`, `pullTranscript` (which fills both Neon + the in-memory cache).

Cache-bust paths: `?force=1` on the GET endpoint; new Node process (cache clears).

---

## Optional: rate-limit consideration

Telnyx publishes a per-account API rate limit (≈ 1k requests/min default, higher on paid plans). Each `pullTranscript` issues **2** fetches (conversation + messages). In production we expect:

- 1 fetch per real call via `/finalize-call` (status_callback fires once per call).
- Rare manual GET hits via `curl /transcripts/:ccid` for debugging.
- 10-min cache absorbs duplicate GETs within the same call.

Burst risk: a flood of `?force=1` GETs (e.g., from a misconfigured dashboard polling loop). Mitigation if it becomes a problem (NOT needed for v1):

1. Move the 10-min cache TTL up to 1h (most transcripts are immutable once a call ends).
2. Add a coarse rate-limit at the route layer (`@fastify/rate-limit`) capped to e.g. 30/min per IP for `?force=1` paths.
3. If still tight, add a Redis-backed cache (overkill — Neon is the durable cache and already absorbs the load).

Recommend: revisit only if Railway logs show > 50 Telnyx GETs/min sustained.

---

## Test coverage (b-fetch.test.ts)

`pullTranscript` (8 tests):
1. Happy path — conversation + messages, normalized record, upsert called.
2. No conversation found → `ok:false` with explicit error.
3. Cache hit on second call within 10 min — zero extra Telnyx fetches.
4. Telnyx timeout/network error → graceful `ok:false`.
5. `meld_id` extraction from a `lookup_meld` tool_call (stringified JSON args).
6. Recording IDs extracted from `metadata.call_recording_ids`.
7. `TELNYX_API_KEY` missing → `ok:false`, no fetch attempted.
8. `tool_call.function.arguments` accepted as object (not just stringified).

`GET /transcripts/:ccid` (5 tests, via `fastify.inject`):
1. Cache hit (Neon) → 200, `source:"neon"`, no Telnyx fetch.
2. Cache miss → triggers pull, 200, `source:"telnyx"`, upsert called.
3. Telnyx failure → 200 with `ok:false` (never 500 / never throws).
4. `?force=1` → bypasses Neon, always re-pulls; `source:"telnyx-forced"`.
5. Neon read error → falls through to Telnyx pull (resilient against DB hiccup).

---

## File-ownership compliance

Per the architect dispatch (`voice-coordinator-phase-5-architect-2026-05-18.md` §Sub-agent B):

- **Owned (modified):** `src/transcript-fetch.ts`, `src/routes-transcripts.ts`, `test/phase-5/b-fetch.test.ts`, `docs/phase-5b-integration-plan.md`. All new files; no edits to existing modules.
- **Read-only imports from A:** `upsertTranscript`, `getTranscriptByCallControlId`, `TranscriptUpsertInput` from `src/transcripts-store.ts`.
- **Did NOT touch:** `src/index.ts`, `src/neon.ts`, `src/transcripts-store.ts`, `src/summarize.ts`, `src/routes-finalize-call.ts`, `package.json`, `migrations/`, any other `src/` file.

Note on test directory: spec said `tests/phase-5/`, project convention is `test/phase-5/` (singular, matches `vitest.config.ts` `include: ['test/**/*.test.ts']` + the existing `test/caller-scope.test.ts` + `test/phase-5/a-store.test.ts` layout). Followed project convention to keep the test runner discovery working.

---

## Open follow-ups for Collie integration

- **CCID resolution from Twilio-style `CallSid`** (architect R1): not B's concern, but worth noting — `pullTranscript` accepts any string and tries `?filter[call_control_id]=...`. If Telnyx's status_callback puts a Twilio `CallSid` in the body and that doesn't match Telnyx's own `call_control_id`, the conversation lookup returns empty `data[]` and B surfaces `"no conversation for call_control_id"`. C's handler should catch this and fall back to a `from+to+recency` filter, OR Collie may discover at smoke time that the body field IS the right ccid all along.
- **Phone metadata richness**: B captures `from`, `to`, `assistant_id`, `call_leg_id` from `conversation.metadata`. If real Telnyx payloads put any of these at the top-level `conversation` object instead, the `pick()` chain will still walk fine — but if the field name differs (e.g., `caller_number` vs `from`), Collie should add a fallback at smoke time. **First real-call smoke** will surface any naming gaps.

---

/Users/davidhunter/cortextos/orgs/ascendops/docs/phase-5b-integration-plan.md

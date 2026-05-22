# Phase 5c Integration Plan — /finalize-call + Anthropic summary + PM patch

**Date:** 2026-05-18
**Author:** Sub-agent C (Collie)
**Owns:** `src/summarize.ts`, `src/routes-finalize-call.ts`, `test/phase-5/c-finalize.test.ts`, `package.json` (added `@anthropic-ai/sdk` dep)

---

## What I shipped

| File | Purpose |
|------|---------|
| `src/summarize.ts` | Anthropic SDK wrapper. `summarizeTranscript(record)` → `{ok, summary?, error?}`. Model `claude-haiku-4-5`, prompt caching on the system prompt, max_tokens 400, temperature 0.2. Never throws. |
| `src/routes-finalize-call.ts` | `registerFinalizeCallRoutes(fastify)` adds `POST /finalize-call`. Returns 200 + `{ok:true,queued:true}` immediately; chain runs under `setImmediate`. |
| `test/phase-5/c-finalize.test.ts` | 13 tests — 4 for summarize.ts, 3 for the route's immediate-reply contract, 6 for the full chain composition. |
| `package.json` | Added `"@anthropic-ai/sdk": "^0.96.0"` to dependencies. No script or other-field changes. |

---

## Collie integration step (after A + B + C all merge)

In `src/index.ts`, alongside the existing route registrations:

```ts
import { registerFinalizeCallRoutes } from './routes-finalize-call.js';
// ... inside main(), after registerVoiceToolRoutes:
await registerFinalizeCallRoutes(fastify);
```

That is the only `src/index.ts` change for Sub-agent C's work. (Sub-agents A and B add a `runMigrations()` boot call and `registerTranscriptRoutes(fastify)` respectively — see their integration plans.)

---

## Railway env vars (new this phase)

| Var | Used by | Source |
|-----|---------|--------|
| `ANTHROPIC_API_KEY` | `src/summarize.ts` | `orgs/ascendops/secrets.env` |
| `PUBLIC_BASE_URL` *(optional)* | `src/routes-finalize-call.ts` deeplink fallback | Default `https://blue-voice-gateway-production.up.railway.app` — set explicitly if the Railway public hostname differs |

`TELNYX_API_KEY` and `DATABASE_URL` are already wired by Sub-agents A and B; no new work there.

---

## Telnyx TeXML status_callback wiring

After deploy, PATCH the TeXML application to point `status_callback` at the new route:

```
curl -X PATCH https://api.telnyx.com/v2/texml_applications/2954301261882590783 \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "status_callback": "https://blue-voice-gateway-production.up.railway.app/finalize-call",
    "status_callback_method": "POST"
  }'
```

Verify:

```
curl -s https://api.telnyx.com/v2/texml_applications/2954301261882590783 \
  -H "Authorization: Bearer $TELNYX_API_KEY" | jq '.data.status_callback'
```

---

## Architect risk R1 handled — CallSid ↔ call_control_id mapping

Twilio-compatible TeXML status_callback ships `CallSid`, but Telnyx's own
conversations API keys off `call_control_id`. These may not be identical.

`routes-finalize-call.ts` handles this with a two-step resolution:

1. Treat the body's `CallSid` (or `call_control_id`) as the ccid and try
   `getTranscriptByCallControlId` first, then `pullTranscript`.
2. On both misses, call `fallbackResolveCcid(from, to, log)`:
   - `GET /v2/ai/conversations?page[size]=10`
   - Filter by `metadata.from === From` and `metadata.to === To` (last-10 digits)
   - Require `created_at` within the last 5 minutes
   - Pick the most recent match's `metadata.call_control_id`
3. If the fallback resolves a different ccid, retry the full pull.
4. If no ccid resolves, log a warning and abandon — never summarize an
   empty/wrong transcript.

Audit trail logs every step so Collie can swap the mapping rule after the
first real production fire.

---

## Smoke procedure (Collie post-deploy)

1. Pick a real `call_control_id` from one of David's recent conversations:
   ```
   curl -s "https://api.telnyx.com/v2/ai/conversations?page[size]=5" \
     -H "Authorization: Bearer $TELNYX_API_KEY" | jq '.data[].metadata.call_control_id'
   ```
2. Simulate the Telnyx status_callback POST:
   ```
   curl -X POST https://blue-voice-gateway-production.up.railway.app/finalize-call \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "CallSid=<real-ccid>&CallStatus=completed&From=+14155551212&To=+14236331021"
   ```
3. Expect immediate `{"ok":true,"queued":true}`.
4. Watch Railway logs for the chain transitions: `status_callback received` → `transcript resolved` → `summarize` → `runPm update-notes` → `transcript uploaded to PM` (or `deeplink fallback applied`).
5. Verify in PM web UI that the chosen meld has a new `maintenance_notes` entry with the 3–5 sentence summary, and a new file in the meld's attachments labeled "voice call transcript".

If the summary line is missing but the deeplink line is present, the upload-file path failed gracefully — open the deeplink to confirm the transcript is retrievable, then debug snapcli `pm work-orders upload-file` separately.

---

## What the chain looks like in production

1. Telnyx fires `POST /finalize-call` after call hangup
2. We reply 200 in <50ms (Telnyx never retries us)
3. `setImmediate` chain runs:
   - resolve ccid (with R1 fallback if needed)
   - `getTranscriptByCallControlId` (cache check) → fall through to `pullTranscript` (Sub-agent B persists to Neon as a side effect)
   - `summarizeTranscript` → Anthropic claude-haiku-4-5
   - `updateTranscriptSummary` writes the summary text to the Neon row
   - if a `meld_id` is bound: `runPm work-orders update-notes` (append summary) + `runPm work-orders upload-file` (transcript JSON, manager-side)
   - on upload-file failure: second `runPm work-orders update-notes` with a deeplink to `/transcripts/{ccid}`
   - final `updateTranscriptSummary` writes `pm_patch_status` + `pm_upload_status` for the audit trail
4. Chain logs every step at info level, every degradation at warn level

---

## Test verdict

- `npm run build` → clean
- `npm test` → **61/61 passing** (existing 25 + Sub-agent A's 12 + Sub-agent B's 11 + Sub-agent C's 13)
- Sub-agent C contributes 13 tests (target was 8 minimum):
  1. summarize happy path (asserts model, caching, prompt shape)
  2. summarize empty transcript → safe fallback (no Anthropic call)
  3. summarize Anthropic 500 → ok:false
  4. summarize empty content blocks → ok:false
  5. /finalize-call returns 200 immediately with latency < 100ms
  6. /finalize-call CallStatus=failed skips entire chain
  7. /finalize-call CallStatus=completed triggers full chain
  8. Full chain WITH meld_id — pull → summarize → update → update-notes → upload-file in order
  9. Full chain WITHOUT meld_id — no runPm, summary still persisted with `skipped` statuses
  10. Upload failure → deeplink fallback applied via second update-notes
  11. extractMeldIdFromTranscript pulls from `tool_calls_fired` (most recent wins)
  12. extractMeldIdFromTranscript strips TX prefix (Sub-agent B convention)
  13. Summary failure → PM still gets a fallback "AI summary failed" note + deeplink

All upstream modules (`transcripts-store`, `transcript-fetch`, `summarize`, `pm-cli`, `@anthropic-ai/sdk`) are mocked — tests are hermetic and pass even if A/B's underlying implementations evolve.

---

## File ownership confirmation

Per the architect dispatch rule (no two sub-agents touch the same file), Sub-agent C touched ONLY:

- ✅ `src/summarize.ts` (new)
- ✅ `src/routes-finalize-call.ts` (new)
- ✅ `test/phase-5/c-finalize.test.ts` (new) — note: under `test/` (singular), matching the existing repo convention used by Sub-agents A and B
- ✅ `package.json` (added one dep)
- ✅ `package-lock.json` (auto-updated by `npm install`)
- ✅ `docs/phase-5c-integration-plan.md` (this file)

Did NOT touch:
- ❌ `src/index.ts`, `src/neon.ts`, `src/transcripts-store.ts`, `migrations/*.sql` (Sub-agent A surface)
- ❌ `src/transcript-fetch.ts`, `src/routes-transcripts.ts` (Sub-agent B surface)
- ❌ Any other src module

Imports from A: `getTranscriptByCallControlId`, `updateTranscriptSummary`, `TranscriptRecord` type.
Imports from B: `pullTranscript`, `PulledTranscript` type.

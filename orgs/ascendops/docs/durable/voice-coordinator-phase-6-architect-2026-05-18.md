# Phase 6 Architect — Dispatch Plan

**Date:** 2026-05-18
**Author:** Collie (architect role)
**Status:** Ready to dispatch 3 parallel sub-agents

## Codebase summary

`blue-voice-gateway` is a Fastify TS app on Railway. Entry at `src/index.ts` registers three route modules with a tolerant JSON parser (treats empty bodies as `{}` so Telnyx Voice AI tool POSTs don't 400).

- **`src/voice-tools.ts`** — 17 Telnyx Voice AI custom-tool webhooks under `/voice/tools/*`. All meld-touching tools subprocess `pm` via `runPm()`. Existing tools: `lookup_meld`, `search_melds`, `get_vendor_status`, `recent_melds_for_property`, `assign_vendor`, `send_message_on_meld`, `schedule_meld`, `send_sms`, `text_david`, `get_meld_work_entries`, `get_meld_files`, `get_meld_comments`, `list_melds_by_status`, `assign_tech`, `cancel_meld`, `complete_meld`, `list_vendors`. Local `sendTelnyxSms(to, body)` helper sits inside this file — Sub-agent B should import or duplicate the same shape but live in its own module.
- **`src/sms.ts`** — `POST /sms/inbound` already wired for Telnyx SMS webhooks. Reads `data.payload.from.phone_number` and `data.payload.text`, forwards to relay. **No MMS / media handling yet.** This is the integration point for Sub-agent B's inbound photo flow.
- **`src/voice.ts`** — legacy TwiML routes (`/voice/inbound`, `/voice/transcript`). Not in Phase 6 scope.
- **`src/pm-cli.ts`** — `runPm(args)` subprocess wrapper, 8s timeout, owner-name redaction filter, JSON-only output contract.
- **`src/bus.ts`** — `forwardSms()` / `forwardVoice()` to RELAY_URL only. No PM photo-upload helpers.
- **`package.json`** — Fastify 4, telnyx SDK 6.41, ws 8. No vitest yet.

Phase 4 envelope debug confirmed: Telnyx tool POSTs include header `x-telnyx-call-control-id` but the body contains only tool arguments (no caller phone field). Caller phone must be derived server-side.

## Sub-agent dispatch plan

### Sub-agent A: caller-scope.ts (caller-ID restriction)

**Owns (creates):**
- `src/caller-scope.ts`
- `docs/phase-6a-integration-plan.md`

**Modifies:** none.
**Does NOT touch:** `voice-tools.ts` (main Collie integrates A's helper post-dispatch).

**Caller-phone extraction approach (recommended):** Call `GET /v2/ai/conversations?filter[call_control_id]=<id>` and read `data[0].metadata.from` (or whichever the AI conversation envelope exposes; fall back to `GET /v2/calls/{call_control_id}` whose `data.from` is documented stable). Cache by `call_control_id` with a 10-minute TTL in an in-process `Map`. If the header is absent (e.g. manual curl), return `null` and let the validator decide: when phone is unresolvable, **fail open with a log warning** rather than locking David out of dev curls — flagged as open question Q1.

**Implementation sketch:**
```ts
// src/caller-scope.ts
import type { FastifyRequest } from 'fastify';

const callerCache = new Map<string, { phone: string | null; expires: number }>();
const TTL_MS = 10 * 60 * 1000;

export async function extractCallerPhone(req: FastifyRequest): Promise<string | null> {
  const ccid = req.headers['x-telnyx-call-control-id'] as string | undefined;
  if (!ccid) return null;
  const hit = callerCache.get(ccid);
  if (hit && hit.expires > Date.now()) return hit.phone;
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://api.telnyx.com/v2/ai/conversations?filter[call_control_id]=${ccid}`,
      { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(3000) }
    );
    const json = (await res.json()) as { data?: Array<{ metadata?: { from?: string } }> };
    const phone = json.data?.[0]?.metadata?.from ?? null;
    callerCache.set(ccid, { phone, expires: Date.now() + TTL_MS });
    return phone;
  } catch { return null; }
}

export interface ScopeResult { ok: true } | { ok: false; error: string };

export function validateCallerForMeld(
  callerPhone: string | null,
  meldData: unknown
): ScopeResult {
  if (!callerPhone) return { ok: true }; // fail-open (Q1)
  const phones = extractMeldPhones(meldData); // vendor.phone, resident.phone, tenant.phone
  const normalized = normalize(callerPhone);
  if (phones.some(p => normalize(p) === normalized)) return { ok: true };
  return { ok: false, error: "This call doesn't appear to be associated with that meld." };
}
```

**Tools requiring validation:** `lookup_meld`, `recent_melds_for_property`, `get_meld_files`, `get_meld_comments`, `get_meld_work_entries`, `schedule_meld`, `send_message_on_meld`, `assign_vendor`, `assign_tech`, `cancel_meld`, `complete_meld`. **Excluded** (no specific-meld disclosure): `list_vendors`, `list_melds_by_status`, `get_vendor_status`, `search_melds` (current impl is a list, but flagged as Q2).

**Acceptance criteria:**
- `extractCallerPhone` returns cached value on second call for same ccid within TTL.
- `validateCallerForMeld` returns `{ok:false, error:"This call doesn't appear..."}` on mismatch.
- Returns `{ok:true}` when caller phone is null (fail-open, logged).
- No imports from `voice-tools.ts` (one-way dependency).

---

### Sub-agent B: photo-handoff.ts

**Owns (creates):**
- `src/photo-handoff.ts`
- `docs/phase-6b-integration-plan.md`

**Modifies:** none directly — but B's integration plan must specify the **single-line edits** main Collie will make to `src/voice-tools.ts` (register `photo_handoff` route) and `src/sms.ts` (branch on `payload.media` to call `handleInboundPhoto`).

**Does NOT touch:** `voice-tools.ts`, `sms.ts` (main Collie integrates).

**Inbound MMS approach:** `src/sms.ts` already has `POST /sms/inbound` but reads only `payload.from.phone_number` + `payload.text` — no media handling. Telnyx MMS payloads include `payload.media: [{url, content_type, size}]`. B's module exports `handleInboundPhoto(fromPhone, mediaUrl, contentType)` that:
1. Looks up the pending photo-handoff session by `fromPhone` (in-memory `Map<phone, {meld_id, expires}>`, 30-min TTL).
2. If no pending session: ignore (return `{handled:false}`).
3. If session: fetch the media URL (Telnyx-hosted, no auth needed), write to a temp file, invoke `pm work-orders upload-file --meld-id <id> --file <path> --json` via `runPm`.
4. Send confirmation SMS to caller: "Got it — attached to work order #<id>."
5. Clear session.

**Tool route shape (for Collie to wire):** `POST /voice/tools/photo_handoff` accepts `{ meld_id, caller_phone? }`. Resolves caller phone via `extractCallerPhone` (depends on A) or accepts the override. Stores session, fires outbound SMS via existing `sendTelnyxSms`-equivalent helper, returns `{ok:true, verification_message:"Sent — you should see a text from us. Reply with the photo when you can."}`.

**Implementation sketch:**
```ts
// src/photo-handoff.ts
import { runPm } from './pm-cli.js';
import { writeFile, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const sessions = new Map<string, { meldId: string; expires: number }>();
const SESSION_TTL_MS = 30 * 60 * 1000;

export async function initiateHandoff(
  meldId: string,
  callerPhone: string,
  sendSms: (to: string, body: string) => Promise<{ ok: boolean; error?: string }>
) {
  sessions.set(normalize(callerPhone), {
    meldId, expires: Date.now() + SESSION_TTL_MS,
  });
  const smsBody = "Reply with a photo of the issue and we'll attach it to your work order.";
  const r = await sendSms(callerPhone, smsBody);
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    verification_message: "Sent — you should see a text from us. Reply with the photo when you can.",
  };
}

export async function handleInboundPhoto(
  fromPhone: string,
  mediaUrl: string,
  _contentType: string,
  sendSms: (to: string, body: string) => Promise<{ ok: boolean; error?: string }>
) {
  const sess = sessions.get(normalize(fromPhone));
  if (!sess || sess.expires < Date.now()) return { handled: false };
  const res = await fetch(mediaUrl, { signal: AbortSignal.timeout(8000) });
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = await mkdtemp(join(tmpdir(), 'voice-handoff-'));
  const path = join(dir, 'photo.jpg');
  await writeFile(path, buf);
  const up = await runPm(['work-orders', 'upload-file', '--meld-id', sess.meldId, '--file', path, '--json']);
  if (up.ok) {
    sessions.delete(normalize(fromPhone));
    await sendSms(fromPhone, `Got it — attached to work order #${sess.meldId}.`);
  }
  return { handled: true, ok: up.ok };
}
```

**Acceptance criteria:**
- `initiateHandoff` stores session, fires SMS, returns verification.
- `handleInboundPhoto` is a no-op (returns `{handled:false}`) when no session exists.
- `handleInboundPhoto` downloads + uploads + confirms when session matches.
- Session expires after 30 min.
- No direct imports from `voice-tools.ts` or `sms.ts` (sendSms is injected).

---

### Sub-agent C: vitest scaffold + tests

**Owns (creates):**
- `test/caller-scope.test.ts`
- `test/photo-handoff.test.ts`
- `vitest.config.ts`

**Modifies:**
- `package.json` (add `vitest` + `@vitest/coverage-v8` devDeps; add `"test": "vitest run"` and `"test:watch": "vitest"` scripts).

**Does NOT touch:** any `src/*.ts` file.

**Test plan:**
- `caller-scope.test.ts`:
  - mismatch → `{ok:false, error:"This call doesn't appear..."}`
  - vendor-phone match → `{ok:true}`
  - resident-phone match → `{ok:true}`
  - null caller phone → `{ok:true}` (fail-open documented)
  - cache returns same value on second call (mock fetch, assert called once)
- `photo-handoff.test.ts`:
  - `initiateHandoff` calls injected `sendSms` with expected body, returns `verification_message`.
  - `handleInboundPhoto` returns `{handled:false}` with no session.
  - `handleInboundPhoto` invokes mock `runPm` with `work-orders upload-file --meld-id <id>`, fires confirmation SMS.
  - Session expiry: advance fake timers past 30 min → handler ignores.

**Skip if blocked:** if A's `caller-scope.ts` not committed at test time, C stubs the import surface using the signatures from A's spec section above and skips behavioral tests behind `it.skip`.

**Acceptance criteria:**
- `npm test` runs vitest, exits 0 with all tests passing.
- Mocks for `fetch` and `runPm` injected via vitest module mocks (no live network, no live `pm`).

---

## Main Collie integration plan (post-sub-agent)

After A, B, C land:

1. **`src/voice-tools.ts`** edits:
   - Import `extractCallerPhone`, `validateCallerForMeld` from `./caller-scope.js`.
   - For each of the 11 in-scope tools: after the existing arg-check, resolve caller phone, run tool, then validate against returned meld data — reject with `{ok:false, error:"This call doesn't appear..."}` if mismatch. (For write tools, validate **before** the write by doing a lightweight lookup first.)
   - Import `initiateHandoff` from `./photo-handoff.js`; add `POST /voice/tools/photo_handoff` route.
   - Extract `sendTelnyxSms` into a shared `src/telnyx-sms.ts` module so B's photo-handoff can reuse without duplication. (Tiny refactor, ~10 lines.)
2. **`src/sms.ts`** edit: import `handleInboundPhoto`; in the inbound handler, if `payload.media?.length > 0`, call `handleInboundPhoto` instead of (or in addition to) the existing text-forward path.
3. **Telnyx assistant PATCH:** add `photo_handoff` tool definition to the assistant's tools array:
   ```json
   {
     "name": "photo_handoff",
     "description": "When the caller describes a visual issue (leak, damage, stain, broken), fire this to text them a photo request. The photo will auto-attach to the work order.",
     "body_parameters": {
       "type": "object",
       "properties": {
         "meld_id": { "type": "string", "description": "Work order ID" }
       },
       "required": ["meld_id"]
     }
   }
   ```
4. Build, deploy to Railway, smoke-test with a real call.

## Open questions for Dane/David

1. **Fail-open vs fail-closed when caller phone is unresolvable.** Recommendation: fail-open (allow tool) with WARN log, so manual `curl` testing and any Telnyx envelope changes don't brick the bot. Trade-off: a missing `x-telnyx-call-control-id` header on a real call would leak data. Counter: real Telnyx calls always carry that header per Phase 4 evidence. **Need David's call.**
2. **`search_melds` scope behavior.** Current impl is a list of recent melds (not filtered to caller). Either (a) keep it list-style and exclude from scope-validation (current draft), or (b) filter results to melds whose vendor/resident phone matches caller. Option (b) is the safer privacy posture but adds a meld-by-meld phone lookup. **Recommend (b) — flag to confirm.**
3. **PM `upload-file` subcommand name.** I assumed `pm work-orders upload-file --meld-id <id> --file <path>`. The locked rule says manager-side `POST /files/` only — Sub-agent B must verify the exact snapcli subcommand exists before writing the photo-handoff. If snapcli has no upload subcommand yet, this becomes a blocker requiring snapcli work first.
4. **MMS receive on existing Telnyx number.** Need to confirm the Telnyx Messaging Profile attached to `+14236331021` has MMS enabled and the inbound webhook routes MMS payloads to `/sms/inbound` (same as SMS). If not, requires Telnyx dashboard config change before B's flow works end-to-end.

---

/Users/davidhunter/cortextos/orgs/ascendops/docs/voice-coordinator-phase-6-architect-2026-05-18.md

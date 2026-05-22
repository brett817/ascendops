# Phase 6B Integration Plan — photo-handoff

**Date:** 2026-05-18
**Author:** Sub-agent B (Collie)
**Status:** Ready for main Collie integration

This doc tells main Collie exactly what to wire after the `src/photo-handoff.ts` and `src/telnyx-sms.ts` modules land. Three integration points: voice-tools route, sms.ts inbound branch, Telnyx assistant tool definition.

---

## 0. Pre-flight: extract the duplicate sendTelnyxSms

`src/voice-tools.ts` currently contains a local `sendTelnyxSms` function at lines ~28-52. Now that `src/telnyx-sms.ts` exists with the same signature, delete the local copy and import from the shared module.

**Edit `src/voice-tools.ts`:**

1. Add to imports (line 2 area):
   ```ts
   import { sendTelnyxSms } from './telnyx-sms.js';
   ```
2. Delete the inline `async function sendTelnyxSms(...) { ... }` block (lines ~28-52).
3. Leave the two call sites in `send_sms` and `text_david` unchanged — same name, same shape.

**Verify:** `npx tsc --noEmit` clean, no other callers of the local fn.

---

## 1. Register the `photo_handoff` route in voice-tools.ts

Append at the **end** of `registerVoiceToolRoutes` (after `list_vendors`, before the closing `}`).

```ts
fastify.post('/voice/tools/photo_handoff', async (request, reply) => {
  const meldId = getArg<string>(request.body, 'meld_id');
  // caller_phone is optional in the body; if absent, derive from the call
  // via caller-scope (Sub-agent A's helper, which caches by x-telnyx-call-control-id).
  let callerPhone = getArg<string>(request.body, 'caller_phone', 'phone');
  if (!meldId) {
    return reply.code(200).send({ ok: false, error: 'meld_id is required' });
  }
  if (!callerPhone) {
    // extractCallerPhone is Sub-agent A's helper. It returns null when the
    // call_control_id header is absent (manual curl) — in that case fail
    // gracefully with a clear error rather than texting an unknown number.
    callerPhone = (await extractCallerPhone(request)) || undefined;
  }
  if (!callerPhone) {
    return reply
      .code(200)
      .send({ ok: false, error: 'caller_phone required and could not be resolved from call' });
  }
  fastify.log.info(
    { tool: 'photo_handoff', meldId, callerPhone },
    'voice tool invoked',
  );
  const result = await requestPhotoHandoff({
    meld_id: String(meldId).replace(/^TX/i, ''),
    caller_phone: callerPhone,
  });
  return reply.code(200).send(result);
});
```

**Imports to add at top of `voice-tools.ts`:**
```ts
import { requestPhotoHandoff } from './photo-handoff.js';
import { extractCallerPhone } from './caller-scope.js';  // Sub-agent A's module
```

**Note on TX-prefix:** existing tools strip a leading `TX` from `meld_id`. Mirror that for consistency — the AI may say "TX123" naturally.

---

## 2. Extend `src/sms.ts` to route MMS to photo-handoff

Current `/sms/inbound` handler reads only `payload.from.phone_number` + `payload.text` and forwards via `forwardSms`. Telnyx MMS payloads include a `media` array on the same `payload`. We branch on `media.length > 0` and route media URLs to `handleInboundPhoto`; non-media stays on the existing text-forward path so SMS chat is unaffected.

**Replace the body of `registerSmsRoutes` with:**

```ts
import { FastifyInstance } from 'fastify';
import { forwardSms } from './bus.js';
import { handleInboundPhoto } from './photo-handoff.js';

export async function registerSmsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/sms/inbound', async (request, reply) => {
    const body = request.body as any;
    const payload = body?.data?.payload;
    const fromPhone: string = payload?.from?.phone_number || '';
    const text: string = payload?.text || '';
    const media: Array<{ url?: string; content_type?: string; size?: number }> =
      Array.isArray(payload?.media) ? payload.media : [];

    fastify.log.info(
      { msg: 'SMS received', fromPhone, text, mediaCount: media.length },
      'sms inbound',
    );

    reply.code(200).send({ received: true });

    const FROM = process.env.TELNYX_FROM_NUMBER || '+14236331021';
    if (!fromPhone || fromPhone === FROM) return;

    // MMS branch: any media on the payload routes to photo-handoff. If no
    // pending session exists, handleInboundPhoto returns ok:false and we
    // fall through to the text-forward path so SMS chat with media still
    // forwards normally.
    if (media.length > 0) {
      const mediaUrls = media.map((m) => m.url).filter((u): u is string => !!u);
      setImmediate(async () => {
        try {
          const result = await handleInboundPhoto({
            from_phone: fromPhone,
            media_urls: mediaUrls,
          });
          fastify.log.info({ result }, 'photo handoff handled');
          if (result.ok) return; // attached to work order — done.
          // No pending session: continue to text-forward path below so the
          // operator still sees the MMS arrived.
        } catch (err) {
          fastify.log.error({ err }, 'photo handoff failed');
        }
      });
    }

    if (!text) return; // pure-media with no caption and no session — already logged.

    setImmediate(async () => {
      try {
        await forwardSms(fromPhone, text);
      } catch (err) {
        fastify.log.error({ err }, 'SMS forward failed');
      }
    });
  });
}
```

**Key field shape — Telnyx MMS webhook (`/sms/inbound`):**
- `data.payload.from.phone_number` — E.164 sender
- `data.payload.text` — caption (may be empty for pure-media)
- `data.payload.media` — `Array<{ url: string; content_type: string; size: number }>` — Telnyx-hosted CDN URLs, no auth required to GET
- `data.payload.direction` — `"inbound"`

The webhook URL `https://blue-voice-gateway-production.up.railway.app/sms/inbound` is already set on Messaging Profile `40019d9d-6df8-4c94-bd39-0460573b7aa7` — no Telnyx config change for the webhook routing itself.

**Open caveat — phone-level MMS provisioning:**
The Messaging Profile is MMS-capable, but phone number `+14236331021` may not have MMS enabled at the carrier level. If the smoke test in section 5 shows outbound photo-request SMS sends but the inbound MMS webhook never fires for replies with photos, that's the symptom — David needs to toggle MMS on the number in the Telnyx dashboard (Numbers → +14236331021 → Messaging → MMS enabled). Flag this as Q1 in the smoke-test report.

---

## 3. Register the `photo_handoff` tool on the Telnyx Voice AI Assistant

Add this tool definition to the assistant's `tools` array via Telnyx Voice AI Assistant PATCH (same pattern as the existing 17 tools — webhook tool with `body_parameters` JSON Schema):

```json
{
  "type": "webhook",
  "name": "photo_handoff",
  "description": "When the caller describes a visual issue (leak, damage, stain, broken fixture, hole, mold, etc.) and there is an associated work order, fire this to text the caller a photo request. The reply photo will auto-attach to the work order via MMS. Use this proactively when a photo would help the vendor diagnose — say to the caller 'I'll text you so you can send a photo' and then call this tool.",
  "webhook": {
    "url": "https://blue-voice-gateway-production.up.railway.app/voice/tools/photo_handoff",
    "method": "POST"
  },
  "body_parameters": {
    "type": "object",
    "properties": {
      "meld_id": {
        "type": "string",
        "description": "Work order ID the photo should attach to (PM meld id, e.g. 123456 or TX123456)"
      },
      "caller_phone": {
        "type": "string",
        "description": "Optional. E.164 caller phone. If omitted, derived server-side from x-telnyx-call-control-id."
      }
    },
    "required": ["meld_id"]
  }
}
```

**Telnyx PATCH command pattern** (main Collie has the assistant ID; same shape as prior tool additions):
```bash
curl -X PATCH "https://api.telnyx.com/v2/ai/assistants/$ASSISTANT_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d @photo_handoff_tool.json
```
(Where `photo_handoff_tool.json` contains the existing tools array plus the new entry — Telnyx PATCH replaces the whole `tools` field, not merge.)

---

## 4. (Optional) Observability endpoint

If main Collie wants a debug hook, append to `voice-tools.ts`:

```ts
fastify.get('/voice/debug/photo_sessions', async () => {
  return getPhotoSessionStats();
});
```
With import `import { getPhotoSessionStats } from './photo-handoff.js';`. Useful for verifying sessions are being created/cleared during smoke. Skip if it adds risk.

---

## 5. Smoke test plan (post-deploy)

After Railway deploy of the integrated build:

1. **Outbound (request) leg:**
   ```bash
   curl -X POST https://blue-voice-gateway-production.up.railway.app/voice/tools/photo_handoff \
     -H 'Content-Type: application/json' \
     -d '{"meld_id":"<real-test-meld>","caller_phone":"+16788156005"}'
   ```
   Expected: `{ok:true, data:{sms_id:"<id>", expected_window_minutes:30}}` and David's phone receives the photo-request SMS within 5s.
   Evidence bar: cite the HTTP 200 + body + screenshot/forward of the received SMS.

2. **Inbound (reply with photo) leg:**
   David replies to that SMS with a photo from his phone.
   Expected: within 10s, `pm work-orders files <meld_id>` shows the new photo attachment; David's phone receives the confirmation SMS.
   Evidence bar: cite the `pm files` output before/after, plus screenshot of confirmation SMS.

3. **No-session inbound:**
   Have David text the Telnyx number a photo without first triggering a handoff. Expected: photo-handoff returns `ok:false` (no session), text-forward path continues, photo is logged but not attached to any meld. No false attachment.

4. **Voice-AI call path (end-to-end):**
   Call `+14236331021`, describe a visual issue on a known meld, listen for the AI to say "I'll text you so you can send a photo," then confirm the SMS arrives. Reply with a photo. Confirm attachment + confirmation SMS.

If step 2 fails because the MMS webhook never fires: toggle MMS on `+14236331021` in Telnyx (Numbers → number → Messaging → MMS enabled) and retry.

---

## 6. Acceptance criteria for this integration

- [ ] `npx tsc --noEmit` clean after all edits
- [ ] `sendTelnyxSms` only defined once in the codebase (in `telnyx-sms.ts`)
- [ ] `/voice/tools/photo_handoff` returns 200 with correct shape on direct curl
- [ ] `/sms/inbound` branches on `payload.media.length > 0` without breaking existing text-forward path
- [ ] `photo_handoff` tool appears in Telnyx assistant tools list
- [ ] Smoke steps 1, 2, 3 above all pass with cited evidence
- [ ] Phone-level MMS provisioning verified (David toggle if needed)

---

## 7. Known dependencies / risks

- **Sub-agent A delivery:** the `caller_phone` fallback in the voice-tools route imports `extractCallerPhone` from `./caller-scope.js`. If A's module lands after B's, main Collie can stub a temporary `extractCallerPhone = async () => null` and require `caller_phone` in the body until A merges. Telnyx assistant prompt should be updated to pass caller_phone explicitly in that interim case.
- **snapcli upload-file:** verified by Collie as `pm work-orders upload-file MELD_ID FILE_PATH --as manager --json`. If the actual subcommand drift (e.g. positional vs. flags), update `runPm([...])` args in `photo-handoff.ts` accordingly — one-line fix.
- **Process restart drops sessions:** session Map is in-memory. A Railway redeploy mid-handoff (window: <30 min) loses pending sessions. Acceptable for MVP; if this becomes a problem, persist to disk or Redis.
- **No retry on Telnyx 5xx:** outbound SMS is single-shot. If Telnyx hiccups, the AI gets `ok:false` and can decide whether to retry verbally.

---

/Users/davidhunter/cortextos/orgs/ascendops/docs/phase-6b-integration-plan.md

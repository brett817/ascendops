# Phase 7 — Outbound Voice Infrastructure Design

**Author:** collie
**Date:** 2026-05-18
**Status:** DESIGN — awaiting build approval
**Reassigned to collie from codie:** 2026-05-18 17:06 UTC (Dane queue)
**Dependencies:** Phase 5 transcript pipeline (PR #3, parked on David env vars)
**Doctrine:** External Persona Architecture v1, knowledge.md lines 20-37

---

## TL;DR

- Use Telnyx **TeXML one-shot dial** (`POST /v2/texml/ai_calls/{texml_app_id}`) — single API call binds Alex assistant + dynamic variables at dial time. Simpler than two-step Call Control.
- Use Telnyx's **first-class Handoff tool** for persona transfers (Casey, Samantha, etc.) — GA, configured ON the assistant, no custom transfer logic on our side.
- Add **3 endpoints** to `blue-voice-gateway`: `POST /voice/outbound`, `POST /voice/call-status` (webhooks), `POST /voice/conversation-insights` (post-call).
- MVP trigger: Telegram-direct command from David (`call <number> about <context>`). Tier-2 triggers (PM webhook, scheduled callback, SMS-no-response) layer in after MVP proves.
- **TWO REAL CONSTRAINTS NEEDING DAVID:**
  1. **Concurrency cap:** Telnyx default = 2 concurrent outbound calls until Level 2 verification. Production scale needs the verification step (David action).
  2. **Billing rate verify:** Telnyx Conversational AI page lists **$0.05/min** (not the $0.08/min in my memory). Plus PSTN termination via SIP Trunking pay-as-you-go on top. Worth confirming actual rate before scale.

---

## 1. Architecture choice — TeXML one-shot

**Two outbound paths exist in Telnyx:**

| Path | Endpoint | Steps | Verdict |
|---|---|---|---|
| Call Control | `POST /v2/calls` then `POST /v2/calls/{id}/actions/ai_assistant_start` after `call.answered` | 2 API calls + webhook glue | Skip for MVP |
| TeXML one-shot | `POST /v2/texml/ai_calls/{texml_app_id}` with `AIAssistantId` in body | 1 API call | **Use this** |

Reason: TeXML binds the assistant at dial time. No separate webhook glue to start the assistant after pickup. Cleaner for MVP. We can switch to Call Control later if we need pre-pickup logic (e.g., AMD-gated start, custom audio before assistant).

**Dynamic variables** ride on the same call:

```json
POST /v2/texml/ai_calls/{texml_app_id}
{
  "From": "+14236331021",
  "To": "+1XXXXXXXXXX",
  "AIAssistantId": "<alex-assistant-id>",
  "AIAssistantDynamicVariables": {
    "tenant_name": "John Smith",
    "work_order": "WO-1234",
    "callback_reason": "scheduling vendor for HVAC"
  }
}
```

Telnyx auto-injects system vars: `{{call_control_id}}`, `{{telnyx_current_time}}`, etc. Our Alex persona prompt references via Mustache `{{tenant_name}}` etc.

**Footgun captured:** all dynamic_variables values must be **strings**. Coerce work_order numbers, dates, amounts at dispatch time or templates silently break.

---

## 2. Persona handoff — use Telnyx native, don't build our own

Telnyx ships a **Handoff tool** (GA, multi-agent handoff release). Configured ON the assistant in the Telnyx console — Alex's tool list will include "transfer to Casey", "transfer to Samantha", etc. When Alex decides to hand off, Telnyx executes the transfer; the live call continues with the new assistant.

**Two voice modes:**
- **Unified:** both assistants share the same voice (caller doesn't hear the switch). Fits "Alex transferring internally" framing.
- **Distinct:** each assistant keeps its own voice. **Use this** — matches our External Persona Architecture (Casey ≠ Alex on voice).

**Implication for our build:** ZERO transfer code on our side. Just need to:
1. Build each specialist persona as a separate Telnyx assistant (Casey assistant, Samantha assistant, etc.)
2. Add Handoff tools to Alex's tool list pointing at those assistant_ids
3. Tune Alex's instructions to know when to hand off ("if caller asks about leasing, hand off to Casey")

Specialists don't exist yet — per knowledge.md they spin up when triggered by clear signals (volume, brand differentiation). Phase 7 MVP ships Alex-only outbound; handoff infra is "ready to wire when specialists land."

---

## 3. New endpoints on blue-voice-gateway

Three additions, all `POST`:

### 3.1 `POST /voice/outbound` (initiator)
Internal-only endpoint. Called by collie/blue/dane to initiate an outbound call.
- **Body:** `{ to, dynamic_variables, assistant_id?, requested_by, reason }`
- **Default assistant_id:** Alex (env: `TELNYX_ALEX_ASSISTANT_ID`)
- **Action:** POST to Telnyx TeXML AI calls endpoint, return `{ call_control_id, status }`
- **Logging:** `voice_call_initiated` event with meta (to, requested_by, reason, call_control_id)
- **Auth:** internal — bearer token shared with cortextos bus (env: `VOICE_GATEWAY_INTERNAL_TOKEN`)

### 3.2 `POST /voice/call-status` (Telnyx callback)
Public endpoint (signed by Telnyx). Receives: `call.initiated`, `call.answered`, `call.bridged`, `call.hangup`, `call.machine.detection.ended`.
- **Action:** log event per type, persist call_status_history row to Neon (extension of Phase 5 schema)
- **Important:** AMD (Answering Machine Detection) events fire here — gives us "human answered" vs "voicemail" signal for outbound

### 3.3 `POST /voice/conversation-insights` (post-call)
Public endpoint. Receives: `call.conversation.ended`, `call.conversation_insights.generated`.
- **Action:** trigger Phase 5 finalize-call chain (transcript pull → Anthropic summary → PM PATCH + file upload) on completed outbound calls
- **Note from research:** Insights webhook URL is configured **separately in Mission Control Portal**, not on the Call Control webhook URL. Need David to confirm both URLs are set in Telnyx console.

---

## 4. Trigger layer — MVP wedge

**Tier 1 (MVP):** David sends Telegram → Collie parses → POST /voice/outbound

Smallest viable wedge per existing infra. Pieces already exist:
- Telegram fast-checker daemon (battle-tested)
- Collie command parsing pattern
- approval gating (use external-comms category)

Flow:
1. David: `"call +14235551234 about meld 8023 vendor scheduling"`
2. Collie receives via fast-checker
3. Collie parses (regex: `call (\+1\d{10}) about (.+)`)
4. Collie creates approval (category: external-comms) — Alex calling someone is external comms
5. On approval, Collie POSTs to `/voice/outbound` with dynamic_variables `{ to_label: "vendor for meld 8023", call_reason: "vendor scheduling" }`
6. Telnyx dials, Alex picks up live with context
7. Post-call, Phase 5 chain pulls transcript + posts summary to meld

**Tier 2 (post-MVP, prioritize by signal):**
- **Scheduled callback:** Alex said "we'll call you back at 3pm tomorrow" → uses existing `create-reminder` subsystem → reminder fires → injects "call this number at 3pm" prompt → agent triggers /voice/outbound
- **SMS-no-response:** tenant didn't reply to SMS within X hours → auto-call. **NEEDS NEW INFRA:** inbound SMS reply tracking does not exist today (sub-agent C confirmed: zero inbound SMS listener)
- **PM webhook-driven auto-call:** new urgent meld → auto-dial vendor. **NEEDS NEW INFRA:** no PM webhook listener exists (sub-agent C confirmed)

MVP ships Tier 1 only. Tier 2 layers in as signals emerge.

---

## 5. Real constraints needing David action

### 5.1 Concurrency cap (PRODUCTION BLOCKER if scale matters)
- Default: **2 concurrent outbound calls** per account/IP
- Level 2 verification → **10 concurrent**
- Higher caps on support request
- Overage returns SIP 403 "User channel limit exceeded D1"
- **Ask:** complete Telnyx Level 2 verification before MVP launch. Forms in Mission Control Portal.

### 5.2 Billing rate verify
- Telnyx docs page says **$0.05/min** for Conversational AI (STT + Telnyx Natural/NaturalHD TTS bundled, LLM billed separate by provider)
- My memory had $0.08/min — could be stale, could be a premium-voice SKU
- PSTN termination (SIP Trunking) is **extra** pay-as-you-go on outbound
- Premium voices (ElevenLabs) extra per character
- **Ask:** confirm current billing rate on the AscendOps Telnyx account before estimating per-call cost for Phase 7 projections

### 5.3 (Lower priority) Insights webhook URL
- `call.conversation.ended` and `call.conversation_insights.generated` events require **Insights webhook URL** in Mission Control Portal (separate from Call Control webhook)
- Without it, post-call data goes nowhere — Phase 5 finalize-call chain won't fire for outbound calls
- **Ask:** wire both Call Control webhook + Insights webhook URLs to the new gateway endpoints after build

---

## 6. Build sequence (after design approval)

| Step | Owner | Effort |
|---|---|---|
| 1. Telnyx Level 2 verification | David | 1-3 days (Telnyx-side) |
| 2. Add Alex assistant_id + texml_app_id env vars to Railway | David + collie | 15 min |
| 3. Build `POST /voice/outbound` endpoint + tests | collie (or codie if back) | 2-3 hours |
| 4. Build `POST /voice/call-status` webhook handler + persistence | collie | 2-3 hours |
| 5. Build `POST /voice/conversation-insights` wiring to Phase 5 chain | collie | 1-2 hours (mostly glue) |
| 6. Add Telegram command parser to collie | collie | 1 hour |
| 7. Approval gating wire-through | collie | 1 hour |
| 8. Smoke test on a real number (David's cell?) | collie | 30 min + iteration |
| 9. Configure Insights webhook URL in Telnyx console | David | 15 min |

**Total collie effort:** ~8-10 hours from approval to first live outbound call. Phase 5 must merge first (transcript pipeline is reused).

---

## 7. Open design questions for David

1. Which trigger first — Telegram-direct, scheduled callback, or wait until specialists land? (Recommendation: Telegram-direct first; it's the smallest wedge.)
2. Per-call approval, or pre-authorized batches (e.g., "Alex may auto-call any vendor for any active meld")? (Recommendation: per-call approval for MVP, batch authorization after the system proves trustworthy.)
3. AMD policy on voicemail — leave a message, or hang up? (Recommendation: leave a brief message: "Hi, this is Alex calling from Ascend Property Management about [reason]. Please call us back at +14236331021." Keep persona consistent.)

---

## 8. What this design does NOT cover

- Specialist personas (Casey/Samantha/Riley) — spin up when triggered by signals, not pre-built in Phase 7
- Recording compliance per-state (TN one-party consent, but other-state callers may need different handling) — out of scope, flag if it becomes a customer
- Multi-tenancy for cross-PM productization (AscendOps for other operators) — Phase 7 is single-operator AscendOps PM only

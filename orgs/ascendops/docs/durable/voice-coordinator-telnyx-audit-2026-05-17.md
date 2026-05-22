# Voice Coordinator — Phase 1: Telnyx Portal Audit

**Build:** task_1778991572765_579980 (Voice Coordinator Sprint, ship Mon 5/25)
**Author:** Collie, Phase 1 of runbook (autonomous via Telnyx API)
**Generated:** 2026-05-17 04:35 UTC
**Status:** AUDIT COMPLETE — 1 critical gap found, fix proposed

---

## Headline

- ✅ Voice AI Assistant `blue-maint-coord-test` exists with all 17 tools correctly registered
- ✅ All 17 webhook URLs point at `https://blue-voice-gateway-production.up.railway.app/voice/tools/<name>` — perfect sync with `src/voice-tools.ts`
- ❌ **CRITICAL: phone +14236331021 routes to LEGACY TwiML gather, NOT the AI Assistant.** Inbound calls bypass the entire Voice AI surface. This is the unblock for Phase 4 live smoke.
- ⚠️ Call recording DISABLED — must enable for Phase 4 evidence capture
- ⚠️ Persona instructions are v1 (2955 chars) — Phase 2 wrote v2; PATCH pending review

---

## Inventory

### Voice AI Assistant
| Field | Value |
|---|---|
| ID | `assistant-47a8c606-2e96-4730-b58c-24d626250748` |
| Name | `blue-maint-coord-test` |
| Model | `moonshotai/Kimi-K2.5` |
| Voice | `Telnyx.Ultra.49808e4c-998a-40a8-b2ea-8ac8e8ce779e` |
| Voice speed | 1.0 |
| Tools count | 17 ✅ matches `voice-tools.ts` route count |
| Instructions length | 2955 chars (v1 persona from 5/14) |
| Conversation flow | null (stateless, instructions-driven) |
| Greeting | null (assistant speaks first per instructions) |
| Recording | **DISABLED** (channels=dual, format=mp3) |
| Time limit | 1800s (30 min) |
| Noise suppression | disabled |
| Default TeXML app | `2954301261882590783` (`ai-assistant-47a8c606-...`) |

### 17 Tools (all present, all URLs correct)

```
lookup_meld                  → /voice/tools/lookup_meld
search_melds                 → /voice/tools/search_melds
get_vendor_status            → /voice/tools/get_vendor_status
recent_melds_for_property    → /voice/tools/recent_melds_for_property
get_meld_work_entries        → /voice/tools/get_meld_work_entries
get_meld_files               → /voice/tools/get_meld_files
get_meld_comments            → /voice/tools/get_meld_comments
list_melds_by_status         → /voice/tools/list_melds_by_status
list_vendors                 → /voice/tools/list_vendors
assign_vendor                → /voice/tools/assign_vendor
assign_tech                  → /voice/tools/assign_tech
send_message_on_meld         → /voice/tools/send_message_on_meld
schedule_meld                → /voice/tools/schedule_meld
cancel_meld                  → /voice/tools/cancel_meld
complete_meld                → /voice/tools/complete_meld
send_sms                     → /voice/tools/send_sms
text_david                   → /voice/tools/text_david
```

Per-tool timeout: 5000ms. Shared flag: false. All POST, JSON.

### Phone Number Routing
| Field | Value |
|---|---|
| Phone | +14236331021 |
| Status | active |
| Connection ID | **`2939005746601264332`** |
| Connection name | `dane-iq-texml` (TeXML application) |
| Connection voice_url | `https://blue-voice-gateway-production.up.railway.app/voice/inbound` ❌ legacy TwiML gather |
| Connection voice_method | post |

---

## CRITICAL FINDING — Phone Routes to Legacy Endpoint

The phone is connected to TeXML app `dane-iq-texml` whose `voice_url` is the LEGACY `/voice/inbound` TwiML gather route in blue-voice-gateway. **The Voice AI Assistant (`blue-maint-coord-test`) is never invoked on inbound calls** — it has its own dedicated TeXML app at `2954301261882590783` with URL `https://api.telnyx.com/v2/ai/assistants/assistant-47a8c606-.../texml`, but the phone does NOT point there.

This is exactly the unvalidated gap the runbook called out: "Inbound webhook URL points at `/voice/tools/*` (Telnyx AI Agent path) vs legacy `/voice/inbound` (TwiML gather)". The current state is **legacy active, AI not reachable inbound.**

### Why this matters
- Phase 4 live inbound smoke test cannot pass with this routing — the call never reaches the AI Assistant
- The 5/07 voice quality test was OUTBOUND only; inbound has never been validated against the AI Assistant
- All Voice AI prompt tuning + tool wiring is currently inert for inbound

### Fix (one API call)

```bash
TELNYX_API_KEY=$(jq -r .api_key ~/.claude/credentials/telnyx.json)
curl -sS -X PATCH "https://api.telnyx.com/v2/phone_numbers/<PHONE_ID>" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"connection_id":"2954301261882590783"}'
```

(Need to look up the phone's record ID first; not its E.164 number.)

### Risk assessment
- **Low.** No documented operational dependency on `/voice/inbound` (runbook says inbound never validated end-to-end). David's 5/7 test was outbound (separate Outbound Profile path), unaffected by this change.
- **Reversible.** Re-PATCH back to `2939005746601264332` restores legacy behavior.
- **Right blast radius.** Single phone, single config field.

### Recommended sequencing
1. Surface this finding to Dane (autonomous build but live-phone config change deserves a 30-second sanity check)
2. On Dane confirm → execute PATCH
3. Verify by re-pulling phone config + placing a test call (Phase 4 path A)
4. If anything breaks → instant rollback to legacy connection_id

---

## Secondary Findings (apply at same time)

### Enable call recording (required for Phase 4 evidence bar)

Current: `recording_settings.enabled = false`. Phase 4 acceptance criteria require transcript + recording capture. PATCH assistant:

```bash
curl -sS -X PATCH "https://api.telnyx.com/v2/ai/assistants/assistant-47a8c606-2e96-4730-b58c-24d626250748" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"telephony_settings":{"recording_settings":{"enabled":true,"channels":"dual","format":"mp3"}}}'
```

### Persona PATCH (Phase 2 v2 output ready)

Phase 2 sub-agent wrote `/Users/davidhunter/cortextos/orgs/ascendops/docs/voice-coordinator-persona-v2-2026-05-17.md`. Once reviewed, PATCH assistant `instructions` field with the v2 system prompt text.

```bash
INSTRUCTIONS=$(cat path/to/extracted-prompt.txt | jq -Rs .)
curl -sS -X PATCH "https://api.telnyx.com/v2/ai/assistants/assistant-47a8c606-..." \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"instructions\":${INSTRUCTIONS}}"
```

### Greeting field

Currently null. Consider setting an explicit greeting — e.g. "Hey, this is Blue at Ascend Property Maintenance — are you calling about a maintenance issue at your unit, or are you a vendor calling about a work order?" — to guarantee the opener branches even if the AI cold-starts oddly. v2 persona output should specify whether this lives in `greeting` or `instructions`.

---

## What's CORRECT (no action needed)

- Assistant ID + name match what runbook expected
- 17 tools, all with correct names + URLs + POST method
- Webhook URLs all hit production Railway gateway (verified domain)
- Voice settings reasonable: Telnyx Ultra voice (high-quality), 1.0 speed, similarity boost 0.5, speaker boost on
- Time limit 30 min, reasonable
- Tool definitions include required-arg validation in `parameters` schema (verified on `lookup_meld`)
- TeXML application `2954301261882590783` is already created and points to the right API URL — phone just needs to be re-bound to it

---

## Phase 1 Output Summary

| Item | Status | Action |
|---|---|---|
| Voice AI Assistant exists | ✅ | none |
| 17 tools registered correctly | ✅ | none |
| Webhook URLs correct | ✅ | none |
| Phone routes to AI Assistant | ❌ | **PATCH connection_id** (gate on Dane sanity check) |
| Call recording enabled | ❌ | PATCH `recording_settings.enabled=true` |
| Persona is v2 | ❌ | PATCH `instructions` (gate on v2 review) |
| Explicit `greeting` set | ⚠️ | Optional — decide with v2 persona review |

**Three small PATCH calls unblock Phase 4 live smoke entirely.** No code changes needed in blue-voice-gateway for inbound flow to work.

---

## Open question for Dane

The runbook says "Apply PATCH fixes for any gap (missing tool, wrong URL) directly via API." The phone re-route is a live-phone config change with low risk but real blast radius. Request: 30-second OK before I apply, or pre-authorize the three PATCHes in batch?

Heading into Phase 3 dispatch to Codie next while waiting on signal.

---

## Links

- [[voice-coordinator-build-runbook-2026-05-18]] — parent runbook
- [[voice-coordinator-phase-0-cli-delta-2026-05-17]] — Phase 0 output
- `voice-coordinator-persona-v2-2026-05-17.md` — Phase 2 sub-agent output
- Telnyx Voice AI docs: https://developers.telnyx.com/api/voice-ai-agents
- raw assistant config: `/tmp/telnyx-assistant.json`
- raw phone config: `/tmp/telnyx-phone.json`

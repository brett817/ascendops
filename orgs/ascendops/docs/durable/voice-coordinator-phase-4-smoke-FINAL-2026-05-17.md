# Phase 4 Path A Smoke FINAL — verdict (post-body_parameters PATCH)

**Status:** **PASS** — end-to-end live, gateway + Telnyx tool config + persona all green
**Date:** 2026-05-17 10:38–10:42 UTC
**Compared to:** voice-coordinator-phase-4-smoke-RETEST-2026-05-17.md (which was PARTIAL)

---

## Root cause of the PARTIAL result

The Telnyx Voice AI Assistant tool definitions used a generic `webhook.parameters` JSON-schema field — but the canonical Telnyx schema (`CallControlWebhookToolParams` from team-telnyx/openapi spec3.json) expects `body_parameters`, `path_parameters`, `query_parameters`, or `headers` as the EXPLICIT routing for function args. With only `parameters` set, Telnyx accepted the tool config silently but had no instruction on where to place the args — so it fired the webhook with **empty body** every time.

The parser fix from PR #1 made the gateway tolerant of empty bodies (good — prevents 400s), but the actual fix was Telnyx-side: re-PATCH all 17 tools' `webhook.parameters` → `webhook.body_parameters`. After that single PATCH, Telnyx started sending args in the body and end-to-end worked immediately.

---

## Evidence — envelope-debug logs side-by-side

**Before body_parameters PATCH** (10:38:08Z, prior test call):
```
body={} query={} content-length="0" content-type="application/json"
user-agent="ai_assistants"
```
Empty body. Args nowhere in the request.

**After body_parameters PATCH** (10:40:18Z, this test call):
```
body={"meld_id":"TKG5XYM"} query={} content-length="21"
user-agent="ai_assistants"
tool="lookup_meld" meldId="TKG5XYM" (runPm invoked, real pm CLI subprocess fired)
```
Args arrived. Route handler executed. Real meld data returned.

---

## Final live validation

Clean deploy (no diagnostic logging) at 10:40:51Z (deploy 23e97489). Sanity probe:

```bash
curl -X POST .../voice/tools/lookup_meld -H 'Content-Type: application/json' -d '{"meld_id":"TKG5XYM"}'
→ HTTP 200
→ {"ok":true,"data":{"id":12774440,"brief_description":"Reset toilet and punch list",
   "status":"COMPLETED","unit_address":{"full_address":"217 Sequoia Dr - Unit B, ..."},
   "assigned_technicians":[{"id":57541,"first_name":"Carlos","last_name":"Calel"}], ...}}
```

Real meld TKG5XYM (Reset toilet at 217 Sequoia Dr, Carlos completed 2026-05-14) returned in full. End-to-end works.

---

## All Phase 4 acceptance criteria — FINAL CHECK

- [x] Phone +14236331021 routes to Voice AI Assistant (PATCH'd earlier today, persisted)
- [x] AI fires persona v2 opener and branches on tenant/vendor (verified in 3 successive smokes)
- [x] AI fires correct tools (lookup_meld, text_david observed; persona discipline held graceful failure)
- [x] **Tools EXECUTE end-to-end** (NEW — post body_parameters PATCH) — real pm CLI subprocesses with real PM data return
- [x] Recording enabled + capturing both call legs
- [x] Persona never fabricates data on errors (held discipline across all 3 smokes)

---

## What's deployed RIGHT NOW (post-session)

| Surface | State | Version / ID |
|---|---|---|
| Telnyx assistant instructions | persona v2 | 20260517T043828977666 |
| Telnyx assistant tools | 17 tools using body_parameters | 20260517T103926323225 |
| Telnyx assistant recording | enabled (dual mp3) | active |
| Telnyx phone +14236331021 | routed to AI assistant (2954301261882590783) | active |
| blue-voice-gateway (Railway) | tolerant JSON parser + clean code | deploy 23e97489 |

Two pre-prod follow-ups intentionally deferred (NOT blocking 5/25):

1. **Persona v2.1 tweak**: add "I heard X-Y-Z, is that right?" meld-ID confirmation step (ASR mangles TKG5XYM → "TKG five sign" sometimes). Small text edit to instructions.
2. **Wildcard content-type parser regression test**: a one-line test would lock the parser fix in repo. Folds naturally into Codie's Phase 3 vitest scaffold.

---

## Phase 3 alignment for Codie

Phase 3 dispatch spec (`voice-coordinator-phase-3-codie-spec-2026-05-17.md`) needs ONE addendum based on today's discovery: the 8 new tool definitions Collie post-PATCHes onto the assistant MUST use `body_parameters` not `parameters`. Updated /tmp/voice-tools-new-defs.json to reflect this — and the post-merge PATCH script will naturally use the same shape we just verified working.

---

## Cleanup

- Diagnostic logging on lookup_meld route REVERTED. Deploy 23e97489 is clean.
- No new Telnyx resources created. Reused Call Control app `2939005173902607525` (dane-iq-voice).
- Conversations + recordings stay in Telnyx history (useful for retro).
- No git commits made by the diagnostic instrument — it was a working-tree-only transient.

---

`/Users/davidhunter/cortextos/orgs/ascendops/docs/voice-coordinator-phase-4-smoke-FINAL-2026-05-17.md`

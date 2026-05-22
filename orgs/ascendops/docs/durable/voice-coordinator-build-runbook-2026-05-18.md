# Voice Coordinator Build — Weekend Sprint Runbook (5/16 → 5/25)

**Author:** Collie (Saturday 5/16 evening)
**Dispatched:** Dane via build task `task_1778991572765_579980` (David directive 2026-05-16)
**Mode:** AUTONOMOUS BUILD — David waived Sunday no-work + cap conservation for this sprint
**Ship target:** Mon 5/25 morning — voice→tool→PM end-to-end validated, persona refined, demo-rehearsed
**Sunday brief target:** "voice fully validated + demo-ready" OR "one specific blocker for David" — nothing in between
**Why:** Internal AscendOps capability (Ray demo 5/25 is a checkpoint, not the forcing function)

Fresh-boot-Collie reads this once on first inbox check after hard-restart, picks up dispatch task immediately, executes Phase 0 → Phase 1 + 2 in parallel sub-agents, then onward.

All three originally-David-blocked items have AUTONOMOUS resolution paths documented below — see "Autonomous Blocker Resolutions" section. Surface to David Sunday AM ONLY if a blocker proves genuinely impossible after exhaustive attempt.

---

## Current State (verified 2026-05-16)

**What's deployed and live:**
- `blue-voice-gateway` on Railway (`blue-voice-gateway-production.up.railway.app`) — /health 200 OK
- 17 voice-tool HTTP webhooks in `src/voice-tools.ts` (parity with snapcli, commit `5e792c8`)
- All tools subprocess `pm` CLI → inherit snapcli-locked rules (vendor-first, file-checking, etc.)
- Smoke verified: bad meld_id returns graceful `ok:false` error (graceful-failure pattern compliant)
- Telnyx phone `+14236331021` assigned to 10DLC campaign (per 5/06 unblock)
- Voice AI Assistant + Outbound Profile created 5/07 (David Hunter Maint Coord persona)
- `voice-call.sh` outbound dial script shipped 5/07

**What's NOT yet validated end-to-end:**
- Live INBOUND call → Voice AI fires a tool → result spoken back. 5/7 test was outbound only.
- Telnyx portal tool definitions synced with 17 webhook count
- Inbound webhook URL points at `/voice/tools/*` (Telnyx AI Agent path) vs legacy `/voice/inbound` (TwiML gather)

**The 17 tools currently exposed** (from `src/voice-tools.ts`):
1. lookup_meld
2. search_melds
3. get_vendor_status
4. recent_melds_for_property
5. assign_vendor
6. send_message_on_meld
7. schedule_meld
8. send_sms
9. text_david
10. get_meld_work_entries
11. get_meld_files
12. get_meld_comments
13. list_melds_by_status
14. assign_tech
15. cancel_meld
16. (verify in code — count target was 17)
17. (verify in code)

---

## Architecture Recap

```
Inbound caller → Telnyx phone +14236331021 → Telnyx Voice AI Agent (their LLM)
                                                      |
                                                      | persona = Blue Voice Coordinator
                                                      | system prompt = vendor/tenant branching
                                                      |
                                                      v
                                              HTTP POST to webhook
                                                      |
                                                      v
                            blue-voice-gateway/voice/tools/* (Fastify route)
                                                      |
                                                      v
                                              runPm(['<cli>', ...args])
                                                      |
                                                      v
                                              snapcli pm binary
                                                      |
                                                      v
                                              PM Nexus / Cookie API
                                                      |
                                                      v
                                              Real PM mutation
                                                      |
                                                      v (JSON response)
                                              Telnyx speaks result to caller
```

Key insight: **Telnyx Voice AI IS the agent.** Blue agent (Claude Code) is not on the call path. Tools are HTTP webhooks. This is good — keeps Blue's Claude cap untouched during calls.

---

## Phase Plan (Monday → Friday before 5/25)

### Phase 0 — Monday AM kickoff (Collie solo, no sub-agents yet)
1. Hard-restart for clean cap budget
2. Read this runbook on first inbox check
3. Mark dispatch task in_progress
4. Audit current 17-tool list vs CLI surface — produce delta list
5. Inventory David day-mode actions queued from Monday brief (Telnyx portal access, phone for smoke test, PM Nexus state)
6. Send Codie a coord ping: "Voice tool wrapping for work-entries CLI will fold into Phase 3 stream Tuesday — please surface command shape (args + flag names) when you ship Mon-Tue so I can wrap without re-investigating"

### Phase 1 — Telnyx portal audit + inbound webhook verify (Collie autonomous via API)
**No human dependency.** Per autonomous-blocker-1 resolution above, audit runs via Telnyx API directly.

Steps:
1. Pull `TELNYX_API_KEY` from `~/.claude/credentials/telnyx.json`
2. List Voice AI Assistants, find the Blue persona assistant ID
3. Dump assistant config: instructions text, voice settings, tools count + names + webhook URLs
4. Pull phone +14236331021 config: voice_url, voice_method, voice_fallback_url, connection_id
5. Diff against `src/voice-tools.ts` route list (17 expected)
6. Apply PATCH fixes for any gap (missing tool, wrong URL) directly via API
7. Document config snapshot + gaps fixed

Output: `voice-coordinator-telnyx-audit-2026-05-XX.md` in docs/.

**Sub-agent**: Collie direct (small data, no need to spawn).

### Phase 2 — Persona refinement (Collie + 1 sub-agent in parallel with Phase 1)
**Independent of David availability** — can run while Phase 1 waits on portal.

Persona prompt deltas to ship:
- Opener branches: "Are you calling about a maintenance issue at your unit, or are you a vendor calling about a work order?"
- Tenant path: gather property address + issue → call lookup_meld or recent_melds_for_property → text_david for new issues (no auto-create yet)
- Vendor path: gather vendor name + work order # → call get_vendor_status / lookup_meld → schedule_meld / send_message_on_meld with audience=vendor
- Graceful escalation: if tool returns ok:false, persona owns it (per fleet-wide rule from 5/07 David quote): "I'm having trouble pulling that up — let me get a person on for you" → text_david
- Hard rule: NEVER read lockbox codes or any owner names aloud

Output: persona prompt diff + version bump for Telnyx Voice AI Agent config.

**Sub-agent**: persona-writer (single-shot Claude Code agent with the persona spec as input). Token-bounded.

### Phase 3 — Voice tool surface expansion 17 → 22-25 (Collie dispatches to Codie)
**Block on:** Codie's work-entries CLI Mon-Tue.

Candidates to wrap:
- `pm projects create / edit / detach-meld` (shipped 5/14)
- `pm work-orders work-entries list / create / update / delete` (Codie Mon-Tue)
- `pm work-orders update-notes` (shipped 5/14)
- `pm work-orders complete` (existing — verify wrapped)
- `pm work-orders merge` (existing — verify wrapped)
- delta TBD from CLI audit step Phase 0.4

**Dispatch shape:** Collie spec, Codie writes, Codex sub-agents for repetitive endpoints. Each new tool = 1 fastify route + 1 contract test.

**Acceptance:** voice-tools.ts grows to 22-25 routes; pytest+npm test green on blue-voice-gateway; smoke fire each new endpoint with bad input → graceful ok:false.

### Phase 4 — Live inbound end-to-end smoke (REQUIRED, blocks ship)
**Autonomous attempt first.** Per autonomous-blocker-3, try Path A (Telnyx-to-Telnyx Call Control) then Path B (programmatic dial). Surface to Sunday AM only if A + B both prove impossible.

Path A — Telnyx Call Control loop:
1. Originate call from +14236331021 to +14236331021 (or secondary Telnyx test number)
2. Outbound side speaks scripted TeXML prompts: "calling about meld TKG5XYM, can you tell me the status"
3. Inbound side hits Voice AI Agent (production config), fires tools
4. Programmatic call recording captures both sides
5. Repeat with mutation prompt: "assign Carlos to that meld"
6. Repeat with vendor branch: "this is DBH Construction calling about TX12791157"
7. Repeat with graceful-failure path: bad meld_id → confirm Voice AI says it can't find + offers escalation

If Path A is blocked (same-number rejection, no secondary number):

Path B — programmatic third-party number:
1. Provision a temporary Telnyx test number via API for the outbound side
2. Same script but originator is the temp number

If both fail:

Path C — Sunday AM surface:
- Document exact failure mode and prep David for a 15-min real call

**Output:** `voice-coordinator-live-smoke-2026-05-XX.md` in docs/ with transcript + log excerpts + verdict (PASS/FAIL with what to fix). Capture: full transcript (Telnyx call recording API), webhook log (Railway logs), PM state diff (work-orders list before/after).

### Phase 5 — Operator runbook for demo day (PM Nexus rotation visibility)
**Independent — Collie solo, ~30 min.**

Document:
- Pre-demo checklist (verify /health, verify PM Nexus auth, verify Telnyx Voice AI Assistant active)
- Mid-demo failure modes + recovery (PM Nexus 400 = key rotation, refresh via Playwright recapture; Telnyx tool drift = check portal; Railway down = call-forward to David)
- Post-demo cleanup (clear any test melds, export transcript for review)

Output: `voice-coordinator-operator-runbook.md` in docs/.

### Phase 6 — Demo rehearsal (Collie + David, full dress)
**Block on:** David available ~30 min.
Run the Ray scenario end-to-end. Tune persona based on feel. Lock final config.

---

## Sub-agent Topology (David explicit directive)

```
Collie (top — spec, coord, review gates)
  |
  ├── Sub-agent 1: Telnyx portal audit (Explore agent or direct, Phase 1)
  ├── Sub-agent 2: Persona prompt writer (single-shot Claude Code, Phase 2)
  ├── Codie (Codex executor for tool surface expansion, Phase 3)
  │     └── Codex sub-agents (per-endpoint wraps)
  └── Sub-agent 3: Operator runbook drafter (single-shot Claude Code, Phase 5)
```

Bounded scope each — no marathons. Token budget per sub-agent: 30k input / 15k output max. Clear ownership per file: persona writer owns persona.md; runbook drafter owns operator-runbook.md; Codie owns voice-tools.ts new routes. NO overlapping file writes.

---

## Codie Coordination

- Saturday: send Codie heads-up (this runbook references his Mon-Tue work-entries CLI work)
- Monday AM: ping Codie for command-shape spec (args, flags, JSON output shape) so I can wrap without re-investigating
- Tuesday: receive Codie's shipped CLI, wrap routes, ship tool expansion PR
- File ownership: Codie owns cli-anything-pm (CLI surface); Collie owns blue-voice-gateway (voice tool wraps)

---

## Risks + Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| PM Nexus key rotation mid-build | Medium (recurring per MEMORY.md) | Playwright recapture path documented; instant fix |
| Codex 401 quota spirals on sub-agent dispatches | Medium | Short focused bursts, fresh context per task; Claude fallback per [[feedback_codex_401_distinguish_codes]] |
| Telnyx Voice AI tool definitions drift if portal hand-edited | Low | Audit script Phase 1; lock to API-driven config update if possible |
| Telnyx Voice AI hallucinates meld_id mid-call | Medium | Webhook returns ok:false on missing meld; persona graceful-failure absorbs |
| Voice quality regresses from 5/07 baseline | Low | Persona delta is prompt-only, doesn't touch voice settings |
| Codie's CLI work slips past Tuesday | Medium | Phase 3 tool expansion is parallel to Phase 4 smoke test — does NOT block ship |
| Live smoke surfaces unknown PM auth state | Medium | Phase 5 operator runbook covers; ~15 min recovery |
| Context bloat on Monday Collie | High if not managed | Hard-restart at start; sub-agent everything that isn't review/coord |

---

## Autonomous Blocker Resolutions (David directive 2026-05-16 evening)

David explicitly directed: solve all three blockers autonomously. Surface to him Sunday AM ONLY if a blocker proves genuinely impossible after exhaustive autonomous attempt.

### Blocker 1: Telnyx portal audit — RESOLVED AUTONOMOUSLY VIA API

API key location: `~/.claude/credentials/telnyx.json` (verified per Blue MEMORY 2026-05-11). Telnyx supports full programmatic CRUD on Voice AI Assistants.

Audit script outline:
```bash
TELNYX_API_KEY=$(jq -r .api_key ~/.claude/credentials/telnyx.json)

# 1. List Voice AI Assistants
curl -sS https://api.telnyx.com/v2/ai/assistants \
  -H "Authorization: Bearer $TELNYX_API_KEY" | jq '.data[] | {id, name, model, tools_count: (.tools | length)}'

# 2. Get specific assistant detail (use id from step 1)
curl -sS https://api.telnyx.com/v2/ai/assistants/$ASSISTANT_ID \
  -H "Authorization: Bearer $TELNYX_API_KEY" | jq '{name, instructions, voice_settings, tools: [.tools[] | {name, type, api: (.api_specs // .webhook_url)}]}'

# 3. Phone number routing (verify +14236331021 webhook config)
curl -sS "https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=%2B14236331021" \
  -H "Authorization: Bearer $TELNYX_API_KEY" | jq '.data[] | {phone_number, connection_id, voice_url, voice_method, voice_fallback_url}'

# 4. If phone routes to Voice AI Agent: assistant_id linkage
# 5. Diff against actual 17 webhook routes in src/voice-tools.ts
```

Output: `voice-coordinator-telnyx-audit-2026-05-XX.md` with current config + gap list. If gaps found, PATCH via same API or surface as Sunday AM blocker IF API is too restrictive.

### Blocker 2: PM Nexus auth refresh — RESOLVED AUTONOMOUSLY VIA EXISTING WIRING

`http_backend.py` already implements `_attempt_recapture()` via subprocess to `pm-recapture-session-playwright.py`. The `@with_recapture_retry` decorator on public API calls triggers ONE recapture attempt on 401 then retries. This means: any voice tool call that hits a stale-cookie state self-heals.

Pre-flight check before voice smoke: invoke any cheap snapcli read (e.g. `pm work-orders list --limit 1 --json`). If it succeeds, auth is current. If it 401s, recapture runs auto; verify it shipped a fresh cookie; re-run. If recapture itself fails, that's the surfaceable blocker (likely PM creds rotation needed externally).

If a full Nexus key rotation is needed (deeper than cookie), David's MEMORY.md PM Nexus rotation entry covers it: external action to PM support. THAT is the only path that bumps to Sunday AM blocker.

### Blocker 3: Live inbound smoke — TWO AUTONOMOUS PATHS, BEST EFFORT

Path A — Telnyx-to-Telnyx Call Control loop:
- Use Telnyx Call Control API to originate an outbound call from our Telnyx number TO our same Telnyx number (or to a different Telnyx test number if we have one)
- Outbound side speaks scripted text via TeXML `<Say>` blocks
- Inbound side hits Voice AI Agent (the same one configured for production)
- Voice AI fires tools, returns audio response
- Capture both sides via Telnyx call recording (programmatic enable via API)

```bash
# Originate the test call
curl -sS https://api.telnyx.com/v2/calls \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_id": "<our_connection_id>",
    "to": "+14236331021",
    "from": "+14236331021",
    "audio_url": "<TeXML url with scripted prompts>",
    "record": true
  }'
```

Caveat: Telnyx may reject same-number-to-self origination. Fallback to a secondary Telnyx number if we have one in the account.

Path B — Local cell number programmatically:
- If Path A fails, use David's cell or a test phone the agent can dial via Telnyx; speech-to-text the response side via Telnyx recording API; analyze transcript

Path C (last resort, requires human):
- Surface to Sunday AM: "Live inbound needs you to make a real call from your phone"

Execute paths in order A → B → C. Document each attempt + outcome.

---

## Demo-day Operator Actions Queue (kept for reference, NOT blocking)

These are smaller items David can review at his leisure — none block Monday checkpoint:

1. Approval to ship persona prompt changes to live Voice AI Agent (Phase 2 output) — defer to Sunday brief if persona deltas needed
2. Decision on Voice AI auto-create melds for new resident issues vs always text_david (current plan: text_david only — safer for demo)
3. Demo rehearsal (~30 min) — Phase 6, full dress with David in operator seat

---

## Smoke Evidence Bar (locked fleet-wide 5/13)

Phase 4 produces the canonical smoke artifact for this build:
- Cite live HTTP status codes on each tool webhook call
- Cite Telnyx transcript excerpts (caller voice + Voice AI response)
- Cite PM state diff (before/after meld snapshots)
- If anything fails: explicit "tool X returned ok:false because Y, persona handled gracefully by Z"

NO inference. NO "looked good."

---

## Open Questions (surface Mon AM in coord ping to Dane)

1. Should the persona auto-create melds for new resident issues, or always text_david for human creation? (Current plan: text_david only — safer for demo)
2. Vendor-side inbound: same number with branching, or separate vendor line? (Current plan: same number, branching opener)
3. After 5/25 — does this voice coordinator stay live for production resident calls, or revert to demo-only? (Affects how aggressively we tune the persona)
4. Is Max actually wired as the intake-handoff target, or is that future? (David mentioned in dispatch)

---

## Links

- [[project_pm_endpoint_ship_runbook_2026_05_16]] — pattern this runbook follows
- [[feedback_smoke_evidence_bar]] — Phase 4 evidence bar
- [[feedback_codex_401_distinguish_codes]] — Codex risk mitigation
- [[project_hermes_specialist_doer_strategy]] — Codex-coder may help on Phase 3 if spawned by then
- `feature commit 5e792c8` — 17-tool voice-tools.ts shipped 5/14

---

**End of runbook. Fresh-boot-Monday-Collie: read once, mark dispatch in_progress, execute Phase 0.**

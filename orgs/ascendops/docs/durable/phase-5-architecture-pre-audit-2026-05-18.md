# Phase 5 Architecture Pre-Audit

**Author:** collie (pre-audit only — full deep dive deferred to fresh-Collie tomorrow)
**Date:** 2026-05-18
**Dispatcher:** David direct via Dane
**Scope:** Frame the verdict shape tonight; surface drill-in targets for tomorrow's full audit. Did NOT do the deep PR #3/#4 read.
**Status:** PRE-AUDIT — verdict pending full deep dive

---

## The actual question

David's pushback isn't "is Phase 5 plumbed correctly" — it's **does Phase 5 add net-new signal over what Alex's 18 live tools already capture during the call?** If yes → swap auth, keep. If no → kill it.

Equivalent framing: **what would a manager miss tomorrow morning if Phase 5 never ran on the calls that came in tonight?**

---

## First-principles answer

### What Alex's 18 tools already capture LIVE during the call

(From the Phase 7 baseline scan earlier this session.)

- **Identification:** lookup_meld, search_melds → matched meld surfaced
- **Context read:** get_vendor_status, recent_melds_for_property, get_meld_work_entries, get_meld_files, get_meld_comments, list_melds_by_status, list_vendors → all relevant prior state pulled into the call
- **Action — meld lifecycle:** assign_vendor, assign_tech, schedule_meld, cancel_meld, complete_meld → state transitions happen mid-call
- **Action — written record:** send_message_on_meld → notes / instructions written directly to the meld during the call
- **Action — comms:** send_sms (to caller), text_david (escalation), photo_handoff (out-of-band media intake)

**Net:** Every meld state transition + every formal note + every dispatch + every escalation is ALREADY persisted in PM via the live tools. The meld is, at end of call, already in the right state with the right notes.

### What Phase 5 adds (post-call Anthropic summary → PATCH meld notes + file upload)

If Alex's tools captured everything, Phase 5's summary is a **redundant secondary description** of what's already in the meld. The Anthropic pass is just rewriting the same information in narrative form.

**Default lean (without deep dive):** **Phase 5 is mostly redundant. Verdict (c) — narrow scope.**

The cases where it's NOT redundant are real but narrow (see drill-in #1-3 below). For those cases only, a slim summary may add value — but at $0.05/summary + dependency on Anthropic API + extra plumbing, the marginal value bar is high.

---

## Three drill-in targets for tomorrow's full audit

Each of these is a specific gap I can construct from first principles but would need real call data to validate. Tomorrow's full audit should sample 5-10 real Alex calls + the corresponding meld state, and check each.

### Drill-in 1 — Multi-issue calls

**Hypothesis:** A caller reports a primary issue (broken HVAC) but mentions in passing "and the kitchen faucet drips a little." Alex's tools fire on the primary issue → meld for HVAC. The faucet mention has no tool path — gets lost. A post-call summary would capture it as a note for human triage.

**Test tomorrow:** sample recent Alex transcripts, count calls where caller mentioned >1 distinct issue, count how many secondary issues made it into PM via any tool. If secondary-issue capture rate is high (Alex prompted explicitly for each one), Phase 5 is redundant. If low (Alex single-issue-focused), Phase 5 catches the gap.

### Drill-in 2 — Caller commitments / verbal context

**Hypothesis:** Caller says "I'll be home Tuesday after 3pm" or "my husband will be there to let the tech in" or "we're going out of town next week." None of Alex's 18 tools have a "caller availability" or "context note" field. The schedule_meld tool captures a TIME but not a CONDITION or CONSTRAINT.

**Test tomorrow:** look for calls where caller mentioned availability/constraint. Did Alex use send_message_on_meld with that text? If yes, redundant. If no (the verbal context evaporated), Phase 5 fills a real gap.

### Drill-in 3 — Sentiment / urgency escalation that didn't trigger text_david

**Hypothesis:** Caller is frustrated, scared, or vulnerable (elderly + no heat in winter, e.g.) but not at a threshold that fires text_david. Tools capture the maintenance fact but not the human-state signal. A post-call summary surfaces "caller was distressed — recommend manager call-back."

**Test tomorrow:** check recent calls where text_david did NOT fire — was there hidden sentiment Alex didn't flag? If common, summary adds real signal. If rare (text_david tuned well), Phase 5 is redundant.

---

## Recommendation shape (pending tomorrow's drill-in)

| Outcome | Trigger | Action |
|---|---|---|
| **(a) Close PRs #3 + #4** | Drill-ins 1-3 all prove redundant on real call sample | Kill Phase 5 + group MMS, close PRs, document Phase 5 was speculative scope |
| **(b) Merge as-built** | All 3 drill-ins prove genuine signal | Swap auth (see below), merge |
| **(c) Narrow scope** | 1-2 drill-ins prove signal, others redundant | Strip Phase 5 to just summary field + the proven-valuable case (e.g., commitment capture only). Drop the others. Swap auth. Merge slim. |

**Default lean without deep dive: (c).** The summary as a free-text audit trail is the most defensible piece. The other PATCH/file-upload plumbing is overkill if the tools already wrote to the meld.

---

## Auth swap path (if outcome b or c)

David's complaint is the ANTHROPIC_API_KEY dependency. The Anthropic Claude Code Max subscription supports OAuth bearer auth via `CLAUDE_CODE_OAUTH_TOKEN` (already present per TOOLS.md). Direct HTTPS to `api.anthropic.com/v1/messages`, Bearer header, no SDK. No API key, no separate Anthropic billing — rides the Max sub.

Concrete change vs current PR #3:
- Remove `@anthropic-ai/sdk` dependency
- Replace with raw `fetch()` call to `https://api.anthropic.com/v1/messages` with `Authorization: Bearer ${process.env.CLAUDE_CODE_OAUTH_TOKEN}`
- Surface failure gracefully if token expired (rotate via existing `cortextos bus refresh-oauth-token`)

This is ~30-50 LOC change. Tomorrow's full audit should include this swap diff IF outcome (b) or (c) wins.

---

## What this pre-audit does NOT cover (tomorrow's deep dive)

- Actual line-by-line read of PR #3 (4 commits incl. D-light voice schema + Codex P1+P2 fixes) and PR #4 (group MMS)
- Real Alex call sample (5-10 recent calls + meld state diff)
- The 3 drill-in validations
- Concrete auth-swap diff if outcome (b) or (c)
- Cost projection (LLM pass × call volume) if outcome (b) or (c) — currently estimated ~$0.05/summary × ~N calls/day

---

## TL;DR for David

**Without deep dive, my first-principles read is Phase 5 is mostly redundant.** Alex's 18 tools already write every meld state change + every formal note + every dispatch during the call. The post-call Anthropic summary is rewriting what's already there.

**Three narrow cases might justify a SLIM Phase 5** (just the summary field, not the full pipeline): multi-issue calls where secondary issues get lost, caller commitments that no tool field captures, and sentiment/urgency below the text_david threshold.

**Fresh-Collie tomorrow morning** validates those three cases against real Alex transcripts + meld state. If any of them prove genuine signal → outcome (c) narrow + swap auth to OAuth Bearer (no API key, rides Max sub). If none → outcome (a) kill it.

**Either way, the ANTHROPIC_API_KEY dependency is unnecessary.** OAuth bearer via Max sub works for any LLM pass we keep.

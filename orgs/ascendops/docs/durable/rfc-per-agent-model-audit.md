# RFC: Per-Agent Model Audit — current models vs build-phase rule

**Author:** Collie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review
**Item:** Thursday plate #10 (of 13)
**Companion:** Multi-model platform RFC (#3) generalizes the "vendor + model" choice; this RFC audits the *current* per-agent picks against the standing build-phase rule.

---

## 1. Problem

Per-agent model choice has four levers:

1. **Cost.** Opus ≫ Sonnet ≫ Haiku per Mtok input/output. A wrong-tier model on a high-volume agent spikes the weekly cap unnecessarily.
2. **Latency.** Haiku is fastest, Sonnet middle, Opus slowest. Latency-sensitive interactive paths (Blue's Telegram chat with David) want the fastest tier the role can tolerate.
3. **Capability ceiling.** Opus catches patterns Haiku/Sonnet miss. Per `feedback_build_phase_opus_rule.md`: "Collie caught the cli-anything-propertymeld vs snapcli duplication on her own — Haiku/Sonnet would have missed that and shipped into the wrong package."
4. **Rate-limit interaction.** All Anthropic models share a weekly token cap. Opus burns it ~5× faster than Haiku. Fleet-wide Opus = fleet-wide cap pressure. (Apr 27 emergency: fleet briefly switched to Haiku 4.5 at 8:32 AM ET — observation 15106 — then returned to Opus per build-phase rule once cap pressure eased.)

The standing rule (`feedback_build_phase_opus_rule.md`):
> Hold Opus on every agent during build phase. Downshift to Sonnet/Haiku only when an agent meets execute-phase criteria, and only as a measured test. If weekly cap forces it, downshift the **least-judgment-critical** agents first.

This RFC audits each agent against that rule and proposes the per-agent action (or non-action).

## 2. Build-Phase vs Execute-Phase Criteria

An agent is in **execute-phase** when:

- Workflows are fully baked (no major skill additions in last 4+ weeks).
- Edge cases are rare (≤1 surprise/week).
- Predictable patterns dominate (≥80% of work follows pre-defined skill triggers).
- Self-correction events are rare (Opus catching its own / others' errors no longer load-bearing).

An agent is in **build-phase** when any of the above fails. New agents start build-phase by definition. The transition is gradual — re-audit per-agent every 4 weeks.

**Failure mode of mis-classification:** downshifting too early loses the architectural-pattern-detection that drove tonight's RFC #6 namespace-collision discovery (Opus caught it; Sonnet on a similar repo audit historically did not).

## 3. Per-Agent Table

Verified live from each `config.json` (2026-04-29):

| Agent | Current model | Role | Phase | Recommendation | Rationale |
|---|---|---|---|---|---|
| Dane | claude-opus-4-7 | Orchestrator (fleet oversight, queue dispatch, approval relay) | Build | **KEEP Opus** | Cross-agent synthesis is the highest-judgment work in the fleet. Tonight's 13-item plate dispatch + David-relay routing requires Opus reasoning. |
| Aussie | claude-opus-4-7 | Analyst / RFC drafting / research | Build | **KEEP Opus** | RFC quality + audit detection (e.g. tonight's Codex sandbox failure surfacing) needs Opus. Skill-optimizer audit work fundamentally judgment-critical. |
| Blue | claude-opus-4-7 | Property maintenance specialist (PM triage, vendor dispatch, resident comms) | Build (transitional) | **KEEP Opus**, re-audit in 4 weeks | Most mature workflow set in the fleet — closest to execute-phase. But threat-history filter, escalation calibration (e.g. Northweather case), and tenant-theatrics distinction still require Opus reasoning. Re-audit for a measured Sonnet downshift trial after RFC #7 skills land + 3-week soak. |
| Collie | claude-opus-4-7 | Framework + fleet-maintenance specialist (RFC drafts, code reviews, cross-module audits) | Build | **KEEP Opus** | Tonight's snapcli namespace audit (RFC #6) is the canonical example — Sonnet historically missed equivalent duplication. Also the plan-Codex-write workflow asymmetrically benefits from Opus on the planning + review halves. |
| Relay | claude-opus-4-7 | Deprecated (per RFC #4 §5) | Build (frozen) | **STOP** the agent first; model question moot once stopped | If Relay isn't doing work, it shouldn't be running, much less burning Opus tokens. Either retire fully or define a real role. |
| Gateway | (no config.json — empty dir) | n/a | n/a | **AUDIT** the directory. If it's a placeholder for an unconfigured agent, leave alone; if it's old scaffolding, delete. |

**Net recommendation:** keep Opus on Dane / Aussie / Blue / Collie (4-of-4 active agents). Stop Relay. Audit Gateway.

## 4. Rate-Limit Pressure Analysis

Apr 27 precedent (observation 15106): fleet hit 80% weekly cap by 8:32 AM ET, emergency-switched to Haiku 4.5 to conserve, returned to Opus once usage dropped. The pattern repeats whenever ≥2 agents have a heavy workday simultaneously.

**Current trajectory** (rough — flag as estimate):

- Each Opus-on-build-phase agent burns ~50-150k tok/active-day weekly (varies by activity).
- Fleet of 4 active = ~200-600k tok/day if all four hit a heavy day.
- Anthropic Max weekly cap (Pro tier) is fixed; observed historic cap-hit at ~80% on a 7-day rolling window during heavy weeks.
- New agents added (per David vision: leasing, make-ready, etc.) compound the pressure linearly.

**Mitigation order if cap forces a downshift** (least-judgment-critical first per the rule):

1. **Relay** — already deprecated; downshift moot, just stop.
2. **Specialist execute-mode tasks first** — e.g. Aussie's *implementation* of a previously-RFC-approved feature (executing a defined plan) can run on Sonnet; her *RFC-drafting* and *audit* work stays on Opus.
3. **Blue's bulk triage paths** — `pm-morning-scan` cron-fired skill is more pattern-matching than synthesis. Could downshift this single skill's invocation to Sonnet while keeping Blue on Opus for interactive work. This is **task-level** routing, deferred to a separate RFC.
4. **Collie's reactive heartbeat work** — heartbeat is procedural; could downshift those individual fires.
5. **Aussie + Collie fully** — last specialists to drop.
6. **Dane** — never downshift the orchestrator while specialists are still on Opus (fleet coherence requires top-tier orchestrator).

**Trigger threshold:** at 80% weekly cap, start step 1-2; at 85% start step 3-4; at 90% step 5; emergency Haiku-fallback at 95%+ matches Apr 27 precedent.

## 5. Multi-Model Interaction with RFC #3

RFC #3 (multi-model platform) makes the question "Anthropic Opus vs Anthropic Haiku" obsolete — once OpenAI / Gemini / Grok adapters land, the per-agent choice becomes a 3-D selection (vendor × model × tier).

The build-phase rule generalizes cleanly: **"hold the highest-capability model that any vendor offers, regardless of vendor identity, until execute-phase criteria are met."** Today that's Opus 4.7. If GPT-5.5 ships with reasoning-mode at a price/perf better than Opus, the build-phase model becomes "GPT-5.5-thinking-high" (or whatever).

The rule's *spirit* is "no early downshift to save tokens during learning" — which holds across vendors. The rule's *letter* (Opus-specifically) updates with each new top-tier release.

## 6. Model Upgrade Triggers

When Anthropic ships claude-sonnet-4-7 / claude-opus-4-8 / similar:

1. **Read the model card.** Capability deltas vs current Opus on: tool use, extended thinking, prompt cache hit-rate, context size, output size.
2. **Pricing check.** Mtok-in, Mtok-out, cache rates. If new model is ≥equivalent capability AND cheaper, fast-track.
3. **Audit one agent first.** Pick the lowest-blast-radius (Collie or Aussie). Run for 1 week. Compare RFC quality, pattern-detection, decision-correctness against last week's same-agent baseline.
4. **If passes, fleet-wide rollout in role-criticality reverse order**: Relay (if still active) → specialists → Dane.
5. **Document the decision in `orgs/ascendops/docs/model-upgrade-log.md`** with the comparison data.

For minor tier shuffles (e.g. Sonnet 4.6 → 4.7): often no audit needed, just update `model` field in `config.json` and watch for a week.

For major shifts (e.g. Opus 4 → Opus 5 architectural bump): full audit per agent, with side-by-side test cases.

## 7. Open Questions for David

1. **Blue execute-phase trial timing** — RFC #7 skills land Thursday + 3-week soak gets us to ~May 22. Schedule a Sonnet-downshift-trial then, or wait longer? The `pm-meld-triage` skill is mature; the new 5 are not yet.
2. **Relay disposition** — fully retire (delete agent, drop config) or keep as a stopped placeholder? My read: fully retire if no role is coming back. Free up the slot.
3. **Gateway directory** — orphan or future agent placeholder? I see no `config.json`. Audit + delete or document.
4. **Task-level model routing** — within Blue, route `pm-morning-scan` to Sonnet while keeping interactive work on Opus. Is this worth building, or premature optimization until cap pressure forces it?
5. **Build-phase rule update for multi-vendor era (RFC #3)** — generalize to "highest-tier any vendor" or stay Opus-specific until further notice? Generalization is cleaner; staying Opus-specific is conservative.

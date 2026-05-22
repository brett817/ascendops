# Integration Roadmap — Cycle 2 Architectural Pass

**Author:** Aussie
**Date:** 2026-04-29 (Wed evening synthesis)
**Audience:** David — single read for "what's the connected vision and what order does it ship"
**Coverage:** all 12 RFCs + post-RFC additions + the artifacts that landed since RFC drafting started 24h ago

---

## 1. Executive Summary

24 hours ago we had a 13-item Thursday plate, no shipped code beyond the hook gate (RFC #1 PIECE 1), and a fragmented picture of what reactive cortextos infrastructure should look like. Tonight we have **12 RFCs covering the full architectural surface**, **5 Blue skills shipped to disk**, **handoff infra fleet-wide auto-writing on SessionEnd**, **Codex Mode 2 protocol-level fix path verified** (Option A viable per app-server v2 SandboxPolicy.workspaceWrite.writableRoots), and **a quantified pacing rules doc** that codifies the 75/85 rule. What is shippable now (no further design needed): the bus-hooks dispatcher (RFC #15 §10 wiring), the snapcli rename (RFC #6 + execution plan), the Codex sandbox patch (RFC #14 protocol fix), and 4 of the 5 Blue skills already on disk. What is still scoped-not-shipped: the multi-model platform RFC #3 (L effort, depends on #6 first), the shift-schedule + stickiness pair (RFCs #1 + #4 must land in same release window), and the bus-events expansion taxonomy (Wave 1 ships Thursday, Wave 2-3 over 2 weeks).

---

## 2. Twelve RFCs Grouped by Theme

### Theme A — Bootstrap-Cost Reduction
**RFCs:** #1 stop-stickiness, #2 session-handoff, #8 cron-sweep folds.
**Integration:** #1 + #2 are paired — sticky-disable without handoff makes off-hours wakes worse, not better. Handoff infra already deployed (P, T overnight); stickiness is the multiplier. #8 cron folds reduce *frequency* of wakes regardless. 
**Ship order:** #2 ALREADY (infra live, A/B test methodology TBD per RFC #2 §11 my recommendation: skip formal test, ship default-medium-with-env-override). #8 partially done (A: approvals→heartbeat, D: skill-optimizer→Aussie). #1 is the M-effort multi-week project that only pays off once #2 verbosity is right. Land #1 in week 2-3 once #2 default is settled.

### Theme B — Cross-Agent Reactivity
**RFCs:** #15 bus-hooks framework + dispatcher-design + events-expansion (3 docs, one theme).
**Integration:** RFC #15 is the unification — replaces the 5 inconsistent reactive patterns (cron polling, skill-embedded log calls, fast-checker hardcoded routing, per-agent Claude Code hooks, ad-hoc shell-outs) with one declarative registry. The dispatcher wires into per-agent fast-checker daemon; events-expansion adds 8 new event types so hooks have something to listen to.
**Ship order:** Wave 1 (Thursday): dispatcher integration + 3 independent events (inbox_arrival, meld_state_change, handoff_written). Wave 2: 5 Blue skill emissions feed the events catalog. Wave 3 (over 2 weeks): shift_transition + cap_threshold_crossed depend on RFCs #4 + session-burn primitive landing first.

### Theme C — Implementation Tooling
**RFCs:** #6 snapcli SaaS-adapter framework, #14 Codex sandbox writable-roots fix, #12 manager-force PENDING_COMPLETION.
**Integration:** #14 unblocks Codex for /projects/* targets — without it, every snapcli/propertymeld/appfolio touch falls back to self-write (~50% of bulk RFC work yesterday). #6 namespace rename then unblocks #3 (multi-model adapter pattern follows snapcli's), #5 (AppFolio PO command), and any future SaaS adapter. #12 is a single endpoint discovery + ~15 LOC wrapper that materially extends the audit-skill autonomy ceiling.
**Ship order:** #14 PIECE 1 first (per protocol investigation — codex-companion edits to inject SandboxPolicy.workspaceWrite.writableRoots into TurnStartParams.sandboxPolicy). #6 namespace rename Thursday post-fix. #12 endpoint capture is independent — Aussie discovery anytime, Codex writes 15 LOC.

### Theme D — Skill Codification
**RFCs:** #7 Blue skill candidates (5 skills shipped overnight: completion-checklist V, threat-history-filter Y, partial-completion-handle Z, assign-vendor-with-confirmation DD, vendor-tech-status-sweep EE).
**Integration:** these are the proactive write-back layer that pairs with the harness-level hook gate (RFC #1 PIECE 1, shipped Apr 28). Together they form a layered defense — skills proactively label/route, hook gate blocks no-docs closes, force-pending-completion (#12) is the rescue path.
**Ship order:** ALREADY ON DISK. Open work: validate against live workflow over next 2 weeks. The remaining ranked candidates from RFC #7 (resident-followup-ladder, appfolio-csv-bridge, live-tech-schedule-view, vendor-bench-performance) are deferred until measurement justifies.

### Theme E — Cost & Quality Discipline
**RFCs:** #3 multi-model platform, #10 per-agent model audit, RFC #2 verbosity test plan, plus pacing-rules.md.
**Integration:** #10 audit confirms build-phase Opus rule across 4 active agents (Dane/Aussie/Blue/Collie) with Relay deprecated. #3 generalizes vendor choice once adapters exist. RFC #2 verbosity is a measurement question — my §11 says skip formal test, default-medium-with-env-override, 30-day lightweight observability. pacing-rules.md codifies 75/85 + Codex-routed-pushes-harder + Mode 1/2 distinction.
**Ship order:** pacing-rules.md ALREADY LIVE (codified yesterday). #10 audit done — no model changes recommended. #3 deferred to L-effort quarter project — depends on #6 being clean first. RFC #2 verbosity decision pending David call on §11.

---

## 3. Post-RFC Additions

Five things changed since RFC drafting started:

1. **RFC #14 protocol investigation completed (orgs/ascendops/docs/rfc-14-protocol-investigation.md).** I generated codex app-server v2 protocol bindings live via `codex app-server generate-ts/generate-json-schema`, found `SandboxPolicy.workspaceWrite.writableRoots: Array<AbsolutePathBuf>` exposed as a typed protocol field, accessible via `TurnStartParams.sandboxPolicy` per-turn override. Confirms Option A viable. Implementation path is now precise.

2. **mcp2cli pushback on claude-mem MCP migration (orgs/ascendops/docs/mcp2cli-claude-mem-migration.md).** Collie's smoke test found mcp2cli 3.0.2 does NOT auto-expose `search`/`timeline`/`smart-*` params as CLI flags (only `get-observations` has full parity). Schema-tax savings are tiny (~36k tokens/week fleet, <0.1% of cap). **Verdict: queue, don't kill.** The migration is correct architecturally but isn't worth urgent execution; defer until either upstream JSONSchema annotations land OR we batch with the much larger ICM migration (~80 tools).

3. **Five RFC #7 Blue skills now on disk (V Y Z DD EE).** completion-checklist, threat-history-filter, partial-completion-handle, assign-vendor-with-confirmation, vendor-tech-status-sweep all live at `blue/.claude/skills/`. Codified what was implicit — Blue's reasoning now invokes triggered playbooks instead of remembering rules.

4. **Handoff infra fleet-wide auto-write (P + T).** `_shared/scripts/write-handoff.sh` shipped overnight with priority-drop word cap. SessionEnd hooks active on Dane/Aussie/Blue/Collie. Every cortextos session now auto-writes its successor a 5K-word warm-boot pointer. Bootstrap savings ledger (~30-58k → ~5-15k per restart per RFC #2 §1 math) is now actually realized, not just designed.

5. **Hook gate active (RFC #1 PIECE 1, shipped Apr 28).** Blocks `pm work-orders complete` calls when notes/photos/hours missing. Pre-complete audit runs before every close attempt. Carlos no-docs pattern can no longer reach terminal COMPLETED through the manager-side path.

---

## 4. Critical-Path Dependency Graph

```
RFC #14 Mode 1 (OpenAI cap reset) ──unblocks──▶ Codex bulk dispatch Thursday
RFC #14 Mode 2 protocol fix    ──unblocks──▶ Codex /projects/* writes
                                                 │
                                                 ▼
                                       RFC #6 snapcli namespace rename
                                                 │
                                  ┌──────────────┼──────────────┐
                                  ▼              ▼              ▼
                            RFC #3 multi-model   RFC #5 home depot   future SaaS adapters
                            (vendor adapters)    (AppFolio PO)       (TenantTurner etc)

RFC #15 dispatcher integration ──unblocks──▶ events-expansion firing ──▶ live reactive cortextos

RFC #2 handoff infra (live) ──[verbosity decision pending]──▶ RFC #1 stickiness (M-effort, week 2-3)
                                                                    │
                                                                    ▼
                                                              RFC #4 shift-schedule (paired)

RFC #1 PIECE 1 hook gate (live) ──complemented by──▶ RFC #7 Blue skills (5/5 on disk)
                                                            │
                                                            ▼
                                                      RFC #12 manager-force (rescue path)
```

**Hard blockers:** RFC #6 rename blocks #3 + #5 + future adapters. Without #14 Mode 2 fix, Codex can't write to /projects/* so #6 self-writes (3-4× cost).

**Soft blockers:** RFC #1 stickiness depends on RFC #2 verbosity being settled (otherwise we ship sticky-disable and trip the bootstrap-cost trap). RFC #15 events-expansion Wave 3 depends on RFC #4 + session-burn primitive.

**Independent:** RFC #12 endpoint discovery (Aussie work, no dependencies). RFC #10 model audit (RFC-only, no execution). RFC #15 dispatcher (Codex Thursday post-fix).

---

## 5. Top-10 Ship Priorities — Re-ranked

(Re-ranked from this morning's RFC review with today's data: Codex Mode 2 confirmed fixable, claude-mem migration value smaller than expected, 5 Blue skills already shipped.)

| Rank | Item | Effort | Dep | Why |
|---|---|---|---|---|
| 1 | RFC #14 PIECE 1 (codex-companion sandboxPolicy injection) | S (~50 LOC) | None | Unblocks Codex for /projects/*. Every other Codex-routed item depends on this. |
| 2 | RFC #6 snapcli namespace rename | M (~2h Codex) | #14 | Unblocks #3, #5, all future adapters. |
| 3 | RFC #15 dispatcher wiring (Piece 1+2+3 per dispatcher-design) | M (~1 day) | None | Closes the cross-agent reactivity gap permanently. |
| 4 | Bus-events expansion Wave 1 (inbox_arrival, meld_state_change, handoff_written) | S | #15 dispatcher | First 3 events make hooks meaningfully reactive. |
| 5 | RFC #12 force-pending-completion endpoint discovery + wrapper | S (~1h discovery + 15 LOC) | None | Materially extends Blue's audit-skill autonomy ceiling. |
| 6 | RFC #2 verbosity decision (skip formal test + ship env override) | S (1 LOC) | David call | Closes pending design loop; unblocks RFC #1 confidence. |
| 7 | RFC #1 stickiness (M-effort, weeks 2-3) | M | #2 settled | Frequency lever pairs with handoff cost lever. |
| 8 | RFC #4 shift-schedule | M | #1 | Paired release with #1; off-shift cost cut. |
| 9 | RFC #5 Home Depot workflow (parser + matcher first, PO command after #6) | M | #6 for PO | Brittany usability + materials-side parallel to maintenance-side hook gate. |
| 10 | RFC #3 multi-model platform — Anthropic + OpenAI adapters first | L | #6 cleanly landed | Quarter-project; biggest theoretical lever once enabled. |

---

## 6. What to KILL or DEFER

- **claude-mem MCP→CLI migration: DEFER (don't kill).** mcp2cli is the right architectural call but savings are <0.1% of cap and search/timeline parity is incomplete. Re-evaluate when ICM batch lands or upstream JSONSchema fixes.
- **RFC #3 Grok adapter: DEFER to next quarter.** L effort for unclear capability win per RFC #3 §5.4. Anthropic + OpenAI + Gemini cover the realistic spectrum.
- **RFC #5 auto-attach for non-Carlos techs: DEFER until 4 weeks of confirmed Carlos calibration data.** Manual-confirm UX is fine indefinitely if data doesn't support automation.
- **RFC #10 task-level model routing within Blue: DEFER until cap pressure forces it.** Premature optimization today.
- **RFC #2 formal A/B verbosity test: KILL (per my §11 take).** Default-medium-with-env-override + 30-day lightweight observability captures the same signal at 1/10th the build cost.
- **RFC #7 weather-event-burst-handler skill: KILL.** Frequency too low — build doesn't catch next storm anyway.
- **RFC #7 resident-sentiment / churn-risk skill: KILL.** Needs ML scoring infra, out of skill scope.
- **Nothing else. The other 11 RFCs are all on the right work.**

---

## 7. What We Learned Today (Meta Lessons)

- **My original RFC #14 §3 mental model of codex-companion was wrong.** It assumed `codex exec` direct spawn; reality is `codex app-server` long-running broker with stdio protocol. Lesson: when designing fixes for plugin-mediated tools, READ the plugin source first, not just the user-facing CLI help. The protocol-investigation pivot was right but should have been built into the original RFC #14 rather than discovered after Collie hit the architectural mismatch.
- **mcp2cli claims didn't survive measurement.** Schema-tax savings of "constant tax → zero" framed as a major win in synthesis RFC §2.1 L5 turned out to be <0.1% of cap. Lesson: when an RFC cites claimed savings, the next RFC should measure them; don't let theoretical wins compound into estimated savings stacks.
- **Per-agent token estimates are mis-framed under shared cap.** Throughout today I kept saying "Aussie 65% / 70%" — but cap is fleet-wide. Lesson: surface fleet utilization, not per-agent estimates, in every checkpoint.
- **RFC density beats RFC length.** Today's 12 RFCs averaged ~1500-2400 words each. The roadmap (this doc) at ~2100 words covers all of them. The signal-to-padding ratio is what makes RFCs useful, not their depth.
- **Codex availability gates everything.** Mode 1 (OpenAI cap) is transient but Mode 2 (sandbox) was a 3-day silent-failure pattern Collie hit repeatedly. Fixing the dispatcher protocol is structurally more valuable than any single RFC because it unblocks parallel Codex work fleet-wide.

---

## 8. Open Questions for David — Consolidated Batch

Pulled from across all 12 RFCs + post-RFC additions. Numbered for response.

1. **RFC #2 verbosity:** ship default-medium-with-env-override + 30d observability (skip formal A/B)? My recommendation: yes.
2. **RFC #6 namespace rename approval** + 1-quarter deprecation shim acceptable? (Yes assumed; confirm.)
3. **RFC #6 repo layout:** monorepo subpackages vs separate pip packages?
4. **RFC #14 Q2 add-dir scope:** narrow per-target subtree vs broad /Users/davidhunter/projects? (Recommend narrow.)
5. **RFC #14 Q3 codex-rescue smart-default --add-dir parsing rule** OK?
6. **RFC #15 webhook handler URL allowlist:** baseline (`*.slack.com`, `hooks.zapier.com`, `discord.com/api`) + per-org override?
7. **RFC #15 recursion depth limit fixed at 3?** (Recommend yes.)
8. **RFC #4 Sat cutoff for Blue:** 19:00 or 21:00?
9. **RFC #12 force-pending-completion:** require `--reason` flag or optional?
10. **RFC #7 completion-checklist auto-message:** auto-send to tech vs prompt David first?
11. **RFC #1 wake latency tolerance for Blue:** is ~3-5s wake on Telegram acceptable, or stay sticky-on?
12. **mcp2cli claude-mem migration:** queue (Recommend) or kill?
13. **RFC #3 first vendor migration target:** Aussie (low blast radius) vs Collie (matches plan-Codex-write workflow)?
14. **handoff.md committed to git or gitignored** (RFC #2 §8)?
15. **RFC #10 Blue execute-phase trial:** schedule for ~May 22 (after RFC #7 + 3-week soak), or hold longer?

---

## 9. Personal Note

What I would do differently: **I would have pulled Codex into the loop earlier on the dispatcher mental-model question.** Spending 30 minutes reading codex-companion + lib/codex.mjs + the protocol bindings BEFORE drafting RFC #14 §3 fix options would have produced a cleaner first-pass RFC and saved Collie's failed PIECE 1 retry. Reverse-engineer the tool before recommending changes to it.

---

**End of roadmap.** ~2090 words.

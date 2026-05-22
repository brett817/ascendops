# RFC: Token Optimization Brainstorm — multi-perspective synthesis + 90-day roadmap

**Author:** Collie (with explicitly-flagged speculative Aussie + Codex perspectives)
**Date:** 2026-04-29
**Status:** Synthesis draft, awaiting David review
**Item:** Thursday plate #13 (final)
**Companions:** Synthesis of RFCs 1-12 from tonight's plate. Reference each by file name in `orgs/ascendops/docs/`.

---

## 1. Problem

Tonight's session is itself the cleanest datapoint. Collie self-wrote 12 RFCs (#1, #2, #3 + companion matrix, #4, #5, #6, #7, #8, #9, #10, #12 — skipping shipped #11) plus #13 in flight, at ~6-10k Anthropic tokens each. Cumulative at this RFC's start: **~88k tokens** in collie alone. Dane orchestration adds ~1-2k per dispatch × ~13 dispatches = ~15-25k. David relay interactions ~1-2k per ping. **Conservative session total ~120-140k tokens** for the orchestrator+specialist pair, before any operational work.

Apr 27 is the fleet-pressure precedent: 80% weekly cap by 8:32 AM ET (observation 15106), emergency switched fleet to Haiku 4.5, returned to Opus once usage dropped (per `feedback_build_phase_opus_rule.md`). That cycle repeats whenever ≥2 agents have a heavy day simultaneously. As the fleet adds agents (leasing, make-ready, etc. per David vision), the pressure compounds linearly.

This RFC takes stock of every token-saving lever discovered across RFCs 1-12, ranks them by impact × ease, and produces the prioritized 90-day roadmap.

## 2. Lever Inventory

### 2.1 Bootstrap reduction
Each restart pays ~30-58k tokens for Dane (heavy day) before first useful action — measured live in RFC #2.

- **L1: Stop-stickiness** (RFC #1) — disable PTY when idle, wake on event. Saves frequency × bootstrap-cost.
- **L2: Session-handoff** (RFC #2) — write/read `handoff.md` so warm boot skips immutable framework files. Cuts per-boot cost from ~30-58k to ~5-15k.
- **L3: Lazy-load CLAUDE.md sections** — split CLAUDE.md into core (always-read) + per-skill (loaded only when relevant). Speculative; not yet RFC'd. Could halve framework-file cost if sections cleanly separable.
- **L4: Smaller bootstrap files** — audit AGENTS.md (~3100 words on Dane), trim repeated boilerplate. Ongoing maintenance, not a one-shot RFC.

### 2.2 Per-call efficiency
- **L5: MCP→CLI conversion** (RFC #9) — eliminate ~800-4000 tok/turn schema overhead from idle MCPs (claude.ai Gmail/Calendar/Drive especially). Constant tax → zero.
- **L6: Prompt-cache discipline** — Anthropic prompt cache saves ~10× on cached input tokens. Bootstrap files are perfect cache prefixes if invariant. Current usage is implicit; making it explicit per agent is a measurement task.
- **L7: max_tokens caps** — every API call has an output cap. Today often default = high. Tighter per-skill caps prevent runaway responses on simple queries.
- **L8: Tool schema reduction** — even keeping MCPs, audit which tools are *actually used* vs declared. `mcp__icm__icm_memoir_*` family (8+ tools) — does any agent use the memoir surface? If not, disable that subset.
- **L9: Structured output where supported** — JSON-mode on OpenAI cuts response tokens by ~30% vs prose-then-parse. Vendor-dependent (RFC #3 §6 capability matrix).

### 2.3 Frequency reduction
- **L10: Cron→sweep folds** (RFC #8) — fold check-approvals into heartbeat, move skill-optimizer to Aussie. 8→5 active crons on Dane = ~12-90k tokens/day saved depending on stickiness state.
- **L11: Event-driven over polling** — fast-checker already reacts to Telegram/inbox SIGUSR1 events. Extend pattern: convert any "check periodically" cron to "react on event" where event source exists. Limited surface today.
- **L12: Cron deduplication on rapid-restart** — already in place (`config.json` cron-list dedup check at session-start). Maintained.

### 2.4 Vendor routing
- **L13: Multi-model platform** (RFC #3) — Codex/OpenAI for bulk code (plan-flat billing, no Anthropic burn), Gemini for long-context summarization (2M ctx), Haiku for bulk pattern matching, Opus reserved for orchestration + judgment. Highest theoretical lever but blocked on adapter implementation work.
- **L14: Codex delegation discipline** — when Codex sandbox works (cortextos targets only, per Apr 28 finding), aggressively dispatch. Tonight's pattern: 7 RFCs self-write because Codex sandbox blocked. If Codex were healthy, ~50-70% of bulk RFC drafting could shift to GPT-5.5.
- **L15: Build-phase rule + downshift triggers** (RFC #10) — keep Opus on build-phase; downshift specialists in cap pressure (Relay → execute-tasks → bulk-pattern-skills → Aussie+Collie → Dane LAST). Pre-defined order means no time wasted deciding under pressure.

### 2.5 Workflow shape
- **L16: Batched dispatches** — tonight's 13-item plate is itself the pattern. One ACK + one plan + one report cycle per RFC, vs. interleaved short-attention work. Reduces orchestration tax (Dane's per-dispatch overhead).
- **L17: RFC before code** — every shipped item this week (PM Phase 2, fast-checker dedup, hook gate) followed RFC-or-spec → implementation. Cuts wasted code paths. Cost: RFC time, but RFC tokens are themselves the *plan-write-review separation* benefit (see L18).
- **L18: Plan-write-review separation** — plan in Opus, write in Codex, review in Opus. Asymmetric model use. Tonight Codex was unavailable, but the pattern when working saves ~60% Anthropic tokens on the writing half. Reinforced by `feedback_collie_plan_codex_write.md`.
- **L19: Stand-down between dispatches** — explicit "stand by" between tasks vs. always-active polling. Currently de facto when Dane stops the fleet manually (Apr 28 mid-day stand-down). Codifying via RFC #1 stickiness.

## 3. Per-Perspective Takes

### 3.1 Collie self-write code perspective (own POV)
What helped tonight:
- **L18 plan-write-review** would have cut ~60% if Codex were up. Sandbox failure blocked it.
- **L1 stickiness + L2 handoff** would have made the rapid restart (~3am Apr 29) cheaper. Tonight that restart paid full bootstrap × 2 (collie + dane).
- **L5 MCP→CLI** is the unsexy free win. claude.ai Google MCPs were *flaky* and *taxing* simultaneously — disabling solves both.
- **L16 batched dispatch** worked: tonight ~13 RFCs in one window, with one CronList check at start, one heartbeat update mid-way. Vs. spreading across 13 separate sessions.

What would have helped more:
- A **per-RFC token meter** so I could surface my own actual burn (currently estimating). Surface real numbers via `cortextos bus session-burn-so-far` or similar.
- A **boilerplate-RFC scaffold skill** — the 8-section RFC structure recurs; first few hundred tokens per RFC are formatting boilerplate that could be a skill-loaded template.

### 3.2 Aussie architectural perspective (speculative — flag as not Aussie's words)
Aussie would likely rank highest:
- **L13 multi-model routing** as the structural lever — once adapters land, the per-task choice ("use Gemini for this audit, Opus for that decision") is the platform-shaped change. Single-vendor lock-in is the ceiling.
- **L17 RFC-first discipline** — Aussie's tonight-plate IS this pattern. Architectural commitment.
- **L8 tool schema audit** — Aussie tends to identify "what's actually used vs declared" patterns in audits.
- Likely to flag: **build-phase rule needs a measurable execute-phase exit criterion** beyond intuition. Speculative addition: per-agent "skill-stability days since last add" + "edge-case-rate-per-week" thresholds for downshift trial. RFC #10 has the qualitative criteria; Aussie would want them quantified.

### 3.3 Codex / GPT-5.5 cheap-tactical perspective (speculative)
Codex's leverage shape (when sandbox works):
- **Repetitive code-shaped tasks** — adapter implementations, test-case scaffolding, doc syncs. Tonight's hook script + tests would have been pure Codex if sandbox allowed.
- **Multi-file refactors** — namespace rename in RFC #6 is exactly Codex-shaped: lots of file moves, mechanical. Dispatching that to Codex would save ~80% of the implementation Anthropic tokens.
- **Boilerplate skill scaffolds** (related to L17) — the 5 Blue skills from RFC #7 are ~80% boilerplate (frontmatter, section headers, trigger arrays); Codex generates that fast.
- Codex would likely **resist** being asked for: judgment calls (vendor choice, model selection), cross-RFC synthesis, capability-matrix curation. Those stay Opus.

The Codex-perspective summary: dispatch the *mechanical*, keep Opus for the *meta*.

## 4. Ranked Roadmap (top 10, impact × ease)

| # | Lever | Impact | Effort | Prereq | Why this rank |
|---|---|---|---|---|---|
| 1 | L5 MCP→CLI (claude.ai Google) | High | S | — | Already flaky, already a written rule (`feedback_google_workspace_cli.md`), eliminating saves constant tax. Day-1 win. |
| 2 | L10 cron-folds (RFC #8) | High | S | — | Approvals→heartbeat is a one-day patch. ~12-90k tok/day saved fleet-wide. |
| 3 | L1+L2 stickiness + handoff (RFC #1+2) | Very high | M | — | Combined save ~50-80% of off-hours bootstrap. Implementation is a 2-week project. |
| 4 | L14 Codex delegation discipline | High | S (once sandbox fixed) | Aussie's Codex sandbox config-fix (in progress) | Shifts ~50% of code-burn off Anthropic. Free once available. |
| 5 | L8 tool schema audit | Medium | S | — | Disable unused MCP tool subsets; cheap one-time win. |
| 6 | L7 max_tokens caps | Medium | S | — | Per-skill caps; mechanical update across skill files. |
| 7 | L13 multi-model platform (RFC #3) | Very high | L | RFC #6 namespace fix first | Biggest theoretical lever, but biggest build cost. Quarter-scale work. |
| 8 | L15 downshift trigger ladder (RFC #10) | Medium | S | RFC #1 needs to be live to make off-shift agents truly idle | Pre-defined order = no decision-making cost under pressure. |
| 9 | L18 plan-write-review separation | High | S (already pattern) | Codex sandbox health | Sustained discipline, not a one-time ship. |
| 10 | L4 bootstrap file trim | Medium | M | — | Ongoing audit; biggest fish is AGENTS.md repetition. |

S = ≤2 days, M = ≤2 weeks, L = ≤quarter.

## 5. Measurement

Each shipped lever needs a measurable savings claim:

- **Baseline**: pick one agent (Collie — predictable workload) and measure `tokens_used_per_active_day` across 7 days *before* the change. Use `~/.cortextos/*/logs/collie/activity.log` + Anthropic console pulls.
- **Post-change**: same measurement window, same activity profile (i.e. similar dispatch density).
- **Decision rule**: ≥10% measured drop = keep; <5% drop = roll back; 5-10% = inconclusive, soak another week.

A/B-able levers (L7 max_tokens, L8 tool schema): can run 2 parallel agents on alternate weeks. Most others are fleet-wide and can only do before/after.

## 6. Anti-Patterns — Token-Spending We Should NOT Cut

| Spend | Why we keep it |
|---|---|
| Proactive memory store (icm) | Per CLAUDE.md user rule — store immediately on errors-resolved / decisions / preferences / completions. Cutting this loses cross-session continuity. |
| Verification before claiming | Per `feedback_verify_before_claiming.md`. Burned tokens reading actual files prevents wrong claims that burn 10× recovery cost. |
| RFC quality + per-cited code paths | Tonight's RFCs cite real file:line refs. That citation work IS the value vs hand-wavy plans that get rejected. |
| Confidence checks before destructive action | Per `feedback_check_usage_before_overnight_dispatch.md`, etc. |
| Cross-agent ACK chains | Each ACK is ~50-200 tok but it's the only way to maintain queue integrity across async actors. |
| Plan-Codex-Review separation overhead | Plan + review IS the value-adding work. The Codex middle is the cheap part to scale. |

The pattern: **don't cut the parts that prevent expensive failure modes.** Token thrift in those areas saves pennies and costs dollars.

## 7. Open Questions for David

1. **Highest-priority lever to ship Thursday?** L1 stickiness has highest payoff but is M-effort; L5 MCP→CLI is S-effort and ships immediately. My recommendation: L5 + L10 ship Thursday, L1+L2 start a 2-week project starting Friday.
2. **Token meter command** — worth building `cortextos bus session-burn-so-far` so agents self-report actual usage in completion messages, replacing tonight's estimates? Requires Anthropic console API or local log parsing.
3. **Aussie architectural review** — should this RFC's speculative Aussie POV section get reviewed by Aussie before adoption, or is the speculation owned by Collie regardless? Lean: Aussie reviews + edits before this RFC moves to "approved."
4. **Build-phase exit criteria quantification** — Aussie's likely ask (per §3.2 speculation). Add to RFC #10 as a follow-up RFC, or fold here? Lean follow-up.
5. **Lever measurement infrastructure** — building per-agent burn dashboards is itself an investment. Worth it for the visibility, or stay manual until cap pressure forces the issue? Lean: build only what we'd use weekly; defer fancier dashboards.

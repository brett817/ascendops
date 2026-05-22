# Anthropic June 15 Billing Split: Max vs API Pool — Ratification

**Decision**: stay on Max 20x subscription. **Locked by David 2026-05-18 evening.**

This doc ratifies that decision against the math, surfaces the narrow edge cases where Agent SDK API pool could theoretically win, and lists the cap-strain signals that would force a reconsideration.

---

## What changes June 15

Anthropic moves from one unified subscription pool to two parallel pools per paid plan ([the-decoder.com](https://the-decoder.com/claude-subscriptions-get-separate-budgets-for-programmatic-use-billed-at-full-api-prices/), [thenewstack.io](https://thenewstack.io/anthropic-agent-sdk-credits/)):

- **Pool 1 — Interactive**: subscription continues as today for hand-use (Claude.ai chat, IDE plugin, direct Claude Code chat).
- **Pool 2 — Agent SDK / Programmatic**: separate monthly credit pool. Burns at full API rates per token. Unused credit does NOT roll over.

What gets billed from Pool 2: Claude Agent SDK, `claude -p` (non-interactive Claude Code), Claude Code GitHub Actions, third-party apps built on the SDK.

**Critical for AscendOps**: every cortextOS agent is a long-running Claude Code session driven by daemon-fired crons. Those cycles count as programmatic-pool burn after June 15.

## Plan budgets

| Plan | Monthly cost | Programmatic credit (Pool 2) |
|------|--------------|------------------------------|
| Pro | $20 | $20 |
| Max 5x | $100 | $100 |
| Max 20x | $200 | $200 |

API-rate burn-down inside Pool 2 ([Anthropic API pricing](https://www.finout.io/blog/anthropic-api-pricing)):

| Model | Input $/MTok | Output $/MTok | Cached input $/MTok |
|-------|-------------:|--------------:|--------------------:|
| Opus 4.7 | 5.00 | 25.00 | 0.50 |
| Sonnet 4.6 | 3.00 | 15.00 | 0.30 |
| Haiku 4.5 | 1.00 | 5.00 | 0.10 |

## Math against AscendOps fleet (current)

**Empirical anchor**: David's actual readout 2026-05-18: 5h-window 11%, weekly 3% of Max 20x unified limits ([incident memory](../../docs/ — captured by cap-watchdog PR #37)).

**Assumption flagged**: we're on **Max 20x at $200/mo** — confirm if I'm wrong. Math below scales linearly down to Max 5x ($100 credit) and Pro ($20 credit).

**Per Max 20x rough capacity** ([claude.com/pricing/max](https://claude.com/pricing/max)): ~220k tokens per 5h window, ~24-40 hours of Opus per week or ~240-480 hours of Sonnet per week, two weekly limits (all-models + Sonnet-only).

**Fleet burn estimate at current load** (anchored to yesterday's 3% weekly readout):
- 3% × ~7.4M tokens/week (rough Max 20x weekly equivalent) ≈ 220k tokens/week
- Mix is Opus-heavy (Aussie + most agents default to Opus 4.7), reasoning-heavy → assume 30% output / 70% input
- Per-week $ at API rates: (154k × $5/M input) + (66k × $25/M output) ≈ $0.77 + $1.65 = **~$2.42/week ≈ ~$10/month**
- 4x safety multiplier for cron-burst weeks and subagent dispatches: **~$40/month**

**Conclusion**: current programmatic burn fits inside Max 20x's $200 Pool 2 credit by ~5×. There is comfortable headroom for fleet growth before Pool 2 becomes the bottleneck.

## Edge cases where API-pool-only could theoretically win

Per Dane re-scope, document them for the record. None apply to AscendOps today.

1. **Sustained high-volume operator** (>$200/mo programmatic burn AND no interactive use). API-pool-only would simply not pay the $200 subscription fee and pay per token. Saves the $200 if you'd never touch interactive Claude.
   - **Doesn't apply**: David uses Claude.ai + Claude Code interactively daily. Interactive pool has real value.

2. **Batch-API-heavy workloads** ([Batch API](https://www.finout.io/blog/anthropic-api-pricing) gives 50% off). If most fleet work could be async-batched (>24h tolerance for results), API-pool path gets 50% discount on those calls — programmatic credit at full API rates does not.
   - **Doesn't apply today**: AscendOps cycles are short-feedback (heartbeats, dispatches, intake routing), not batchable.

3. **Caching-savable enormous prompts** ([prompt caching](https://www.finout.io/blog/anthropic-api-pricing) gives 90% off cached input). If prompts are >100k tokens with high repeat-prefix rate, API + caching can beat subscription throughput limits.
   - **Partially relevant**: SKILL.md prompts repeat across heartbeat fires. But the token volumes are small enough that subscription limits aren't the constraint.

4. **Predictable per-token budgeting required** (e.g. customer pass-through pricing).
   - **Doesn't apply**: AscendOps is self-hosted ops automation, no customer billing.

**Net**: every edge case requires conditions that don't hold for AscendOps today. **Max stays right.**

## Cap-strain signals that would force reconsideration

These are the actual triggers to watch. Cap-watchdog PR #37 surfaces 1-3 directly; 4-5 are human-judgment signals.

1. **Pool 2 monthly burn approaches $200**. At current ~$40/mo estimate this is ~5x away. Surface via cap-watchdog `cap_drift_alert` when programmatic readout crosses 75% / 85% (existing usage cap rule).
2. **Pool 1 (interactive) feels constrained during David's hand-use**. Subjective, but if David's Claude Code sessions are getting throttled while fleet has plenty of programmatic credit, the split is misaligned.
3. **Sustained interactive vs programmatic ratio inverts**. Pool 2 burn >> Pool 1 burn for 4+ consecutive weeks suggests Max subscription is over-paying for unused interactive headroom.
4. **Cost per shipped feature > business value**. Need a higher-level metric (PR throughput per $? meld-resolution per $?) — not in scope to define here, but flagging as the qualitative trigger.
5. **Anthropic changes the pricing again** (third-party tool access policy or Pool 2 credit ratio). Watchlist already covers this — would re-trigger this analysis.

## Follow-ups

- **Verify plan tier** with David (assumed Max 20x; confirm before quoting numbers externally).
- **Refine fleet-burn estimate** with cap-watchdog real readout once headers-capture wrapper lands (PR #37 follow-up #1). Replaces the 3% empirical anchor + 4x safety multiplier with measured per-week data.
- **Re-run this analysis** if cap-watchdog ever surfaces drift suggesting our heuristic 4x multiplier was wrong by >50% in either direction.

## References

- [Anthropic billing overhaul interpretation (Apiyi)](https://help.apiyi.com/en/anthropic-claude-subscription-agent-sdk-billing-split-june-2026-en.html)
- [Anthropic splits billing again (The New Stack)](https://thenewstack.io/anthropic-agent-sdk-credits/)
- [Subscriptions get separate budgets billed at API prices (the-decoder)](https://the-decoder.com/claude-subscriptions-get-separate-budgets-for-programmatic-use-billed-at-full-api-prices/)
- [What every Claude Code & Agent SDK user must do (Codersera)](https://codersera.com/blog/anthropic-june-2026-billing-change-claude-code/)
- [Claude Max plan page](https://claude.com/pricing/max)
- [Anthropic API pricing 2026 guide (Finout)](https://www.finout.io/blog/anthropic-api-pricing)

---
*Aussie, 2026-05-19. Watchlist cycle anchor: 2026-05-18 — first surfaced June 15 split. Re-scope from fork-in-road to ratification: 2026-05-18 evening.*

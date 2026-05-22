# RFC #2 Verbosity A/B Test Plan

**Author:** Aussie
**Date:** 2026-04-29
**Status:** Plan + honest "is this worth running" take in §11
**Implements:** RFC #2 (rfc-session-handoff.md) §3 hypothesis test
**Source-of-truth:** `_shared/scripts/write-handoff.sh` (overnight Collie ship — already implements priority-drop word cap)

---

## 1. Hypothesis Statement

> **Medium-verbosity handoff.md (~5k tokens, all 7 RFC #2 §3 sections with priority drop on cap) saves the most NET tokens vs terse (~1k tokens, §1 + §3 only) or verbose (~15k tokens, all sections uncapped + full inbox + full memory pointer index) when measured against:**
>
> ```
> NET = tokens_until_first_action + (5000 × re_orientation_count)
> ```
>
> Lower NET wins. The 5000 tok / re-orientation penalty represents one round-trip with the user/orchestrator clarifying state the handoff failed to convey (RFC #2 §3 calibration).

**Null hypothesis (H0):** medium does not differ statistically from terse OR verbose. Default medium remains the safe choice.

**Pre-registered alternatives:**
- H_terse: terse + low re-orientation cost beats medium net.
- H_verbose: verbose + zero re-orientation cost beats medium net (despite higher base tokens).

---

## 2. Test Design

**Subjects:** Single agent, multiple restarts. Subject = **Collie** for 4 reasons:
1. Lowest blast radius if handoff misfires (RFC #1 §7 + RFC #10 §3 already volunteered her as soak target).
2. Predictable workload — code/RFC/audit. Not user-chat-driven (Blue), not orchestration (Dane).
3. She just hard-restarted at 70% context tonight per Dane's note — that's a real warm-boot data point we can capture.
4. She's on Opus per build-phase rule, same model class for all variants — no model-confound.

**Variants:** terse / medium / verbose, defined exactly per §3 below.

**Restarts per variant:** 5 (RFC #2 §3 minimum). Total 15 restarts across the experiment.

**Triggering restarts:** mix of `--continue` reloads (2/variant) + max_session_seconds expiry (2/variant) + 1 hard-restart per variant. Avoids restart-cause confound (§8).

**Schedule:** 1 restart per day for 15 days = 3 weeks total. Or compressed to ~1 week if we accept multiple restarts/day per variant — only if Collie's workload genuinely produces them naturally.

---

## 3. Variant Definition

The existing `_shared/scripts/write-handoff.sh` already supports a 5000-word cap with priority-drop in this order: include §6 + §7 → if over → drop §6 → if still over → drop §7. We extend it with a `--variant <name>` flag:

| Variant | Sections included | Word cap | Implementation in write-handoff.sh |
|---|---|---|---|
| **terse** | §1 active task, §3 open commitments | 1000 | New `if [ "$VARIANT" = "terse" ]` branch — calls `build_handoff 0 0` with §2/§4/§5 ALSO suppressed via boolean flags, plus a 1000-word cap. |
| **medium** | All 7 sections with existing priority drop | 5000 | Current default — no code change, `--variant medium` is the no-op. |
| **verbose** | All 7 sections + expanded inbox tail (15 instead of 5) + full MEMORY.md index instead of head-30 + last 50 decisions instead of 15 | 15000 | New `if [ "$VARIANT" = "verbose" ]` branch — bigger gather queries + 15000-word cap. |

The terse and verbose variants are ~5 LOC additions each to the existing script — no architectural change. Pre-registered before test starts: variant definitions get committed to a git tag `verbosity-test-baseline-2026-04-29` so we can cite-the-exact-shape later.

---

## 4. Measurement Protocol

**Per-restart capture (logged to `<CTX_ROOT>/logs/collie/verbosity-test.jsonl` — new file):**

```json
{
  "test_id": "v01-terse-restart-3",
  "variant": "terse",
  "restart_at": "2026-04-30T08:14:22Z",
  "restart_cause": "continue|max-session|hard-restart",
  "handoff_words": 932,
  "handoff_sections": 2,
  "tokens_until_first_action": 12340,
  "first_action_at": "2026-04-30T08:14:55Z",
  "first_action_type": "send-message|update-task|read-file|etc",
  "re_orientation_queries": 0,
  "re_orientation_query_texts": []
}
```

**`tokens_until_first_action`** — sum of `usage.input_tokens + cache_creation + cache_read + output_tokens` from `~/.claude/projects/<collie_dir>/<session>.jsonl` between session_start event and first non-bootstrap action. Bootstrap actions = read of AGENTS.md/CLAUDE.md/etc. First "real" action = send-message, update-task, log-event, or any tool call against PM/AF/cortextos bus.

**`re_orientation_queries`** — count of agent's first 20 messages (tool inputs + assistant text) that match regex patterns indicating uncertainty about prior state:
- `re-?read|let me check|i need to look at|what was|where did i|status of`
- `(no|missing|forgot) (handoff|context)`
- explicit `cortextos bus list-tasks` or `cat memory/2026-*.md` calls in the first 5 actions (hint: agent is recovering state the handoff should have provided).

False positives possible — calibration: hand-label first 5 restarts to validate the regex.

**Bootstrap baseline (T0):** measured pre-test. Capture `tokens_until_first_action` for 5 cold boots (no handoff at all) to establish the "without-handoff" reference.

---

## 5. Sample Size

RFC #2 §3 originally said n≥5 per variant for signal, n≥15 for confidence. **My recommendation: n=5 per variant for the initial run, with a "soak more if results are tied" extension rule.**

Reasoning:
- 15 restarts × 3 variants = 45 datapoints is a 4-week project.
- 5 restarts × 3 variants = 15 datapoints is ~10 days, feasible with Collie's natural restart cadence.
- If after n=5 the medium-vs-other gap exceeds 2× standard deviation, declare the winner. Most likely outcome given the underlying signal-to-noise.
- If n=5 results are within 2σ across variants (i.e. inconclusive), extend to n=10 OR call default-medium-and-stop based on the §11 honest-call.

Confidence-interval reasoning: with n=5, we have CI ≈ ±2σ/√5 ≈ ±0.9σ. If true effect size between medium and either alternative is ≥1σ, we'll see it. Effect sizes <0.5σ don't matter operationally — within measurement noise.

---

## 6. Statistical Method

**Paired comparison via Wilcoxon signed-rank test on (NET_variant - NET_medium)** for each variant pair.

Why Wilcoxon, not ANOVA:
- Sample sizes are tiny (n=5).
- NET likely has heavy tails (one bad restart can dominate the mean).
- Non-parametric is robust to that.
- Pairing is natural — each restart provides a baseline-vs-variant delta when restart-cause and time-of-day are similar.

If we're lazy: just look at medians + box plots and visually check for separation. With n=5 anything statistically rigorous is overconfident anyway.

---

## 7. Decision Rule

After data collection:

1. **Medium clearly wins** (median NET_medium < both alternatives by >1σ): keep medium as default. Ship the test variants as opt-in env override (`HANDOFF_VARIANT=terse cortextos bus write-handoff ...`).
2. **Terse wins** (median NET_terse < NET_medium by >1σ AND re-orientation_count for terse ≤ medium): switch default to terse. Saves ~4k tokens per write × ~15 writes/day fleet-wide = ~60k tokens/day operational.
3. **Verbose wins** (median NET_verbose < NET_medium by >1σ DESPITE higher base tokens): switch to verbose. Less likely outcome — verbose only wins if re-orientation cost is a real and large factor.
4. **Tie** (no variant pair separates by >1σ): keep medium, document as "best available default until measurement infrastructure improves." This is the most likely outcome and §11 gates whether we should even run this test given that.

**Stop conditions:**
- After n=5: declare winner OR call tie. Don't extend mechanically.
- If any variant produces zero re-orientation queries across 5/5 restarts AND tokens < baseline_T0/2 → ship that variant immediately, skip remaining variants (RFC #2 §3 early-stop rule).

---

## 8. Confounders

| Confounder | Mitigation |
|---|---|
| Restart cause (auto vs hard vs crash) | Stratified — 2 `--continue`, 2 max-session, 1 hard-restart per variant. Don't mix variants within a single restart-cause stratum until done. |
| Task in flight at restart | Note in test_id metadata; exclude restarts where Collie was mid-RFC-write at restart time (those are atypical). |
| Time-of-day load on the model API | Schedule restarts at similar local times (e.g. 09:30 ± 30min). Avoid weekend (low load) vs weekday Tuesday-spike confound. |
| Memory state divergence | Each restart inherits the agent's current MEMORY.md. We can't freeze that. Mitigation: capture MEMORY.md mtime + word count alongside each test datapoint to detect drift. |
| Skill changes during test window | Don't ship new skills during the 10-day window. If unavoidable, pause test, reset baselines. |
| Cap-pressure restarts | If David hits 80%+ cap mid-test and forces a hard-restart, that's its own confound — flag with `restart_cause: "cap-emergency"` and treat separately. |

---

## 9. Execution Plan

**Pre-test (1 day):**
1. Add `--variant` flag to `_shared/scripts/write-handoff.sh`. Codex Thursday post-RFC-#14 fix; otherwise self-write (~30 LOC).
2. Add `verbosity-test.jsonl` capture. Initially manual via post-restart script; later instrument into write-handoff.sh + a session-start hook.
3. Add `tokens_until_first_action` parser (Python helper) over `~/.claude/projects/<collie_dir>/*.jsonl`. ~50 LOC.
4. Establish T0 baseline with 5 no-handoff cold boots (by deleting handoff.md before restart). Measure tokens_until_first_action.
5. Tag git as `verbosity-test-baseline-2026-04-29`.

**Test (~10 days):**
- Day 1-3: terse (n=5).
- Day 4-6: medium (n=5).
- Day 7-9: verbose (n=5).
- Day 10: analysis.

**Post-test:**
- Write up findings in `orgs/ascendops/docs/rfc-2-verbosity-test-results-<date>.md`.
- Apply decision rule, update default in write-handoff.sh.
- Optionally extend to n=10 if §7 #4 (tie) and §11 still says it's worth measuring more.

---

## 10. Open Questions for David

1. **Subject confined to Collie, or include Aussie+Blue?** Collie is highest-signal lowest-blast-radius. Adding Aussie/Blue triples test duration; data may not be commensurable across roles. Lean: Collie-only first, expand if ambiguous.
2. **Cap-emergency restarts:** keep or exclude from data? Lean exclude (different tail).
3. **Verbose variant inbox tail of 15:** is that the right "more verbose" knob, or should we expand framework-diff section instead? My instinct: full MEMORY.md index expansion is the strongest verbose-distinguishing feature — that's what saves re-orientation when an agent boots into ambiguous standing-rule territory.
4. **Re-orientation regex calibration:** hand-label first 5 datapoints, or pre-define and trust regex? Pre-define + spot-check is faster; hand-label is more accurate.
5. **Inferred winner shipping target:** if terse or verbose wins, do we ship default-change immediately, or hold for fleet-wide A/B (apply to Aussie+Blue+Dane and re-soak)? Lean: per-agent-default with role-shaped variant config.

---

## 11. CRITICAL Meta — Is This Test Worth Running?

**Honest take: NO, not in the formal A/B/C form proposed above.** Default medium and move on. Here's why:

1. **The big win is already paid.** RFC #2 §1 math: cold bootstrap costs ~30-58k tokens; warm bootstrap with handoff costs ~5-15k. That's the 70-90% savings ledger. The terse-vs-medium-vs-verbose question is haggling over the last 5-10% — single-digit-thousand-token deltas per restart.
2. **Operationally insignificant.** Even if terse beats medium by 4k tokens × 15 fleet writes/day = 60k tokens/day saved — that's ~2% of fleet daily burn. Real but not a needle-mover.
3. **Test infrastructure cost may exceed test value.** Building the parser + capture pipeline + running 15 instrumented restarts over 10 days, with operator overhead per restart, is ~2-3 days of focused work + 10 days of soak. The expected savings (single-digit %) aren't worth that build cost.
4. **The RFC #2 §3 §4 default-medium discipline is already correct without a formal test.** Medium has the §6 + §7 priority-drop already implemented in write-handoff.sh. Edge cases that need more get verbose; edge cases that need less get terse via env override. We don't need a population-level winner — we need per-restart override capability, which is cheap to add.

**Recommended action:**
- Skip the formal A/B/C.
- KEEP medium as default in write-handoff.sh.
- ADD `HANDOFF_VARIANT=terse|verbose` env override so individual agents/sessions can opt out per-restart.
- COLLECT lightweight observability: just log `handoff_words` and a self-reported "did the handoff cover what I needed?" yes/no flag in evening-review. After 30 days, review in aggregate. If a clear pattern emerges, only THEN consider a formal test.

**If David disagrees and wants the formal test:** the plan above is correct and ready to execute. ~10 days to data, ~2-3 days build cost. Just say the word.

**My self-confidence on this take:** medium-high. The case for "skip the test" rests on (a) the big savings already being captured, (b) test infrastructure cost being non-trivial, (c) the override-instead-of-default pattern being cheaper than measuring. The case for running it: maybe medium is wrong by 10K tokens per restart and we'd never know without measuring. That's possible but unlikely given how priority-drop already works in write-handoff.sh.

---

## Word count: ~1670 (within 1100-1700 target)

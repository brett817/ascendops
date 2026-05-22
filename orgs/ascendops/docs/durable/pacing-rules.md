# Pacing Rules

> Operational rules for AscendOps agents about how fast to consume the weekly Anthropic usage cap, when to start vs. stop tasks, and when to choose self-write vs. dispatch-to-Codex.

**Owner:** Collie (technical), Dane (orchestration enforcement)
**Last updated:** 2026-04-29
**Audience:** Every cortextOS agent in the AscendOps fleet — Dane, Aussie, Collie, Blue, and any future deployments.

---

## 1. Usage thresholds (the 75 / 85 rule)

David, 2026-04-28 (relayed via Dane):

> Start a new task only if usage is under 75%. Stop when usage hits 85%. Finish the task already in flight — do not abandon mid-work.

This replaces the older "stop at 80%" rule. The asymmetric thresholds give a 10-point buffer for in-flight work versus a stricter gate on picking up *new* work.

| Usage % | New task allowed? | In-flight task? |
| --- | --- | --- |
| < 75% | Yes — start freely | Continue normally |
| 75 – 84% | No — finish in-flight only | Continue, but do not pick up the next thing |
| ≥ 85% | No | Land the in-flight unit (commit / send / write the file), then stop. Do not abandon. |

Apply Wednesday 2026-04-29 onward, all agents, every session.

## 2. Use-it-or-lose-it (the weekly cap)

David, 2026-04-29 morning:

> The weekly cap doesn't roll over. If valuable work is queued, push toward 95–100%.

Anthropic's weekly token budget resets every Sunday; unused capacity is forfeited. Therefore:

- **Do not artificially conserve** at 70 – 85% if real work is queued and David has not throttled.
- **Combined with the 75 / 85 rule:** the cap is *new task gate at 75%, not a budget target.* If you are at 78% and a task in flight will consume another 6%, finish it. If you are at 90% with queued work and David has signaled use-it-or-lose-it, keep going through 95–100%.
- **End-of-week behavior:** by Saturday evening, agents should expect the cap to be partly drained. Do not panic at high consumption — drain is the goal when work is queued.
- **Conservation is appropriate when:** queue is empty, no high-value work is staged, or Dane has explicitly throttled.

## 3. Overnight dispatch rule

From MEMORY.md (`feedback_check_usage_before_overnight_dispatch.md`):

- **> 40% remaining** → dispatch the overnight task now.
- **< 30% remaining** → queue for the next window (do not start).
- 30–40% → judgment call; lean toward dispatch if the task is small or has tight value, queue if it's large.

## 4. Plan → Codex → Review (preferred) vs. self-write (fallback)

The default workflow for any non-trivial code change:

1. **Plan in Collie** — analyze, identify files, define scope, write a spec. No code yet.
2. **Codex writes** — hand the spec to `codex:codex-rescue`. File writes happen outside the Collie context window, saving tokens.
3. **Collie reviews** — check correctness, silent failures, edge cases.
4. **File PR** — only after review passes.

### When self-write is required

Codex's sandbox has writable-root limits. Self-write applies when:

- **Target path is outside Codex's writable roots.** Currently Codex can write to `/Users/davidhunter/cortextos/*` but **not** to `/Users/davidhunter/projects/*` (snapcli, cli-anything-*, propertymeld). Confirmed during the 2026-04-28 batch — every snapcli edit had to be self-write. (RFC #14 is in flight to fix this via per-target `--add-dir` propagation.)
- **The thing you are fixing is Codex itself.** RFC #14's three pieces edit `~/.claude/plugins/marketplaces/openai-codex/`. You cannot dispatch to Codex to patch its own runtime. Self-write only.
- **Codex is throttled or down for several minutes.** Retry up to 3× with ~60s between attempts; if all 3 fail, self-write the current task. After a fallback, still try Codex on the *next* task — do not assume it stays unavailable.

### When self-write is *also* legitimate (not a fallback)

- **Pure prose / spec / RFC documents.** Writing is the actual deliverable. Codex adds round-trip cost without value. (This document is an example.)
- **Surgical one-line edits** where the spec is shorter than the diff.
- **Memory and config files** the agent owns directly (e.g. `MEMORY.md`, daily memory).

### Drift signal

If Collie writes >2 substantial code files in a single session without a Codex attempt, that is drift — pause and ask whether the workflow is still healthy or whether Codex is silently failing.

## 5. Word-cap overshoots: density, not padding

Spec word caps (e.g. "700–1200w") are guidance, not contracts. Tables, code blocks, command examples, and structured checklists naturally consume more words per unit of meaning than prose. Common overshoot scenarios:

- A 1200-word table-heavy spec is fine if every row carries information.
- A 1500-word RFC with three illustrative diffs is fine.
- A 1500-word prose-only doc with no tables is *padding* — trim it.

The test: if you removed any section, would a downstream agent (or David) lose information they need? If no, cut. If yes, keep — even past the cap.

## 6. Heartbeat and restart pacing

From MEMORY.md (`feedback_two_missed_heartbeats_hard_restart.md`):

- Heartbeat cron fires every 2h.
- One missed cycle (≤ 4h stale) → soft monitor.
- Two missed cycles (≥ 8h stale) → hard restart immediately. Watchdog-alive is not enough — the session is wedged.
- After a hard restart, the post-restart agent must reload `WORKING ON` entries from the daily memory file *before* picking up new work. This is how deferred batches survive restarts.

## 7. Sunday no-work rule

From MEMORY.md (`feedback_sunday_no_work.md` + `feedback_verify_day_of_week.md`):

- No vendor dispatch or non-emergency escalations on Sundays.
- True emergencies only: safety, flood, fire, no-heat in freezing weather.
- **Always run `date +"%A"` before applying the rule.** David caught a Monday-mislabeled-as-Sunday on 2026-04-27 — agents misread the calendar without verifying.

## 8. Quick reference card

| Situation | Action |
| --- | --- |
| Usage < 75%, queued work | Start the task |
| Usage 75 – 84%, in-flight task | Continue, do not pick up next |
| Usage ≥ 85%, in-flight task | Land the unit, stop |
| Usage ≥ 85%, no in-flight | Stop |
| Late-week, queue empty | Conserve — let cap drain naturally |
| Late-week, queue full + David said use-it-or-lose-it | Push through 95–100% |
| Code task, target inside `cortextos/*`, Codex up | Plan → Codex → Review |
| Code task, target inside `projects/*` (until RFC #14 ships) | Self-write |
| Patching Codex itself | Self-write |
| Pure prose deliverable | Self-write |
| Codex 3× retry failure | Self-write this task; retry next |
| Spec overshoots word cap with tables/checklists | Keep it — density is fine |
| Heartbeat 8h+ stale | Hard restart immediately |
| Today is Sunday | Emergencies only; verify with `date +"%A"` first |

## 9. Self-check primitive — `cortextos bus session-burn-so-far`

The agent-side measurement primitive for the 75/85 rule (§1). Inspects the session's transcript and prints structured token usage so an agent can self-check before starting a new task.

```bash
cortextos bus session-burn-so-far --format table
cortextos bus session-burn-so-far --format json
```

JSON keys: `session_start_ts`, `total_input_tokens`, `total_output_tokens`, `total_tokens`, `message_count`, `time_elapsed_min`, `tokens_per_min`, `estimate`. The token counts are estimates (~4 chars/token); precision is good enough for the 75/85 thresholds, not for billing.

**Status:** F primitive built + verified live 2026-04-29. Output shape verified end-to-end (table + json). Available for fleet-wide self-check.

## 10. Change log

- **2026-04-29** — Initial codification (Collie). Captures the 75/85 rule, use-it-or-lose-it weekly cap, plan-Codex-review default + self-write fallback, word-cap density principle.
- **2026-04-29 (VV batch)** — F primitive `cortextos bus session-burn-so-far` shipped: npm run build green, command output verified (table + JSON shape with all 8 expected keys). New §9 documents the primitive.

# RFC: Session-Handoff Pattern — warm-boot continuity for cortextos agents

**Author:** Collie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review
**Item:** Thursday plate #2 (of 13)
**Companion:** [rfc-stop-stickiness.md](./rfc-session-handoff.md) (item #1) — this RFC reduces *per-wake* bootstrap cost; that one reduces *frequency*.

---

## 1. Problem

Every cortextos agent restart — auto on `max_session_seconds` (~71h), `--continue` reload, or hard restart — re-reads the full bootstrap suite before it can do anything useful. For Dane (orchestrator) the suite measured tonight is:

| File | Words | Approx tokens |
|---|---|---|
| `AGENTS.md` | 3100 | ~4100 |
| `knowledge.md` (org) | 1525 | ~2000 |
| `CLAUDE.md` | 1359 | ~1800 |
| `TOOLS.md` | 1058 | ~1400 |
| `HEARTBEAT.md` | 782 | ~1050 |
| `MEMORY.md` (index) | 575 | ~770 |
| `SOUL.md` | 522 | ~700 |
| `GUARDRAILS.md` | 489 | ~650 |
| `USER.md`, `IDENTITY.md`, `SYSTEM.md`, `GOALS.md` | ~520 | ~700 |
| **Subtotal: framework files** | **~9930** | **~13.2k** |
| Today's memory file (active day) | varies, often 5-15k words | ~7-20k |
| `MEMORY.md`-pointer files referenced (~30 of 60+) | varies | ~5-15k |
| Skill discovery + relevant skill READs | varies | ~5-10k |
| **Total bootstrap on a heavy day** | | **~30-58k tokens** |

That entire bootstrap is paid every restart — even a 5-second `--continue` to reload a config. **The agent does not retain knowledge of what was in flight at the moment of restart.** Tonight's symptom: Dane lost ephemeral test crons, then had to grep today's memory file to relocate the Aussie 13-item queue.

Most of those tokens are wasted because *nothing changed since the last restart* — IDENTITY/SOUL/GUARDRAILS/USER are immutable; CLAUDE.md/AGENTS.md/TOOLS.md change weekly at best; only MEMORY.md and the daily memory file have meaningful churn.

## 2. Proposal

Add a single `handoff.md` per agent at `orgs/<org>/agents/<agent>/handoff.md`, written at session-end and read first on session-start.

**Contents (medium-verbosity default — see §3):**

1. **Active task pointer:** what was the agent mid-flight on at session-end. (e.g. "Item 2 of Aussie 13-item queue. Awaiting Dane review of rfc-stop-stickiness.md.")
2. **Last 3-5 messages of inbox state:** message IDs + senders + 1-line topic. So agent doesn't re-read the full `inbox/` JSONL.
3. **Open commitments:** outbound msgs you sent that are awaiting reply, with msg-IDs and ETA expectations.
4. **Recent decisions, last 24h:** 5-10 bullets. (e.g. "Stand down rule: 75% start / 85% stop." "Codex sandbox blocked /projects/* — self-write fallback.")
5. **What changed in the framework files since last handoff:** if `CLAUDE.md`/`AGENTS.md`/`TOOLS.md` mtime > last-handoff-write-time, list a 1-line diff per file. If unchanged, mark them "stable since YYYY-MM-DD" so the boot can skip them.
6. **Skills loaded in flight:** which skills the agent had context of (heartbeat, evening-review, etc.) so they don't need re-discovery.
7. **Memory pointers in active use:** which `MEMORY.md` entries were referenced this session, so the agent can cherry-pick rather than walking the full index.

**Where it lives:** `orgs/ascendops/agents/<agent>/handoff.md` — same directory as IDENTITY.md/SOUL.md, parallel to `memory/`. Gitignored alongside other agent-local state.

**Lifecycle:** evening-review SKILL.md (Phase 5 area, after the goals.json update) writes the handoff as its last step. Hard restarts and crash restarts bypass evening-review, so a session-end *always-write* hook (PreCompact or SessionEnd) writes a "best-effort" version that may be staler.

**Read order on warm boot:** if `handoff.md` exists AND was written within the last 7 days AND its `framework_stable_since` line indicates IDENTITY/SOUL/CLAUDE.md/AGENTS.md/TOOLS.md unchanged → read handoff + diff, skip immutable files. Cold boot (no handoff, or stale > 7d) → full bootstrap as today.

## 3. Verbosity Hypothesis Test

We do not know whether terse, medium, or verbose handoff actually saves tokens *and* preserves correct in-flight resumption. **Default = medium until measured** (§4). Methodology:

**Success metric:** `(bootstrap_tokens_with_handoff + correctness_penalty) < bootstrap_tokens_baseline`, where `correctness_penalty = X tokens for every in-flight task the agent fails to resume cleanly` (proxied by "had to ask the user/orchestrator a question that handoff should have answered"). X = 5000 (representative re-orientation roundtrip cost).

**Baseline:** measured on Dane over the next 5 cold boots — record `tokens_used_until_first_action` from the harness telemetry already in `~/.cortextos/*/logs/*/activity.log`. Average to get baseline_T0.

**A/B variants:**
- **Terse** (~1k tokens): only §1 (active task pointer) + §3 (open commitments).
- **Medium** (~5k tokens): §1-§7, capped at 5k via truncation if needed.
- **Verbose** (~15k tokens): §1-§7 with full inbox replay, full memory-pointer expansion, full last-day decisions.

**Run protocol:** for each variant, soak for 5 restarts on a single agent (Collie — specialist with predictable workload). Measure `tokens_used_until_first_action` and count `re-orientation queries` (manual flag in evening-review). Need n≥5 per variant for any signal at all; n≥15 for confidence.

**Decision rule:** pick the variant minimizing `T_actual + 5000 * re_orientation_count`, ties broken toward terse (cheaper if comparable).

**Stop condition:** if any variant produces zero re-orientation queries across all 5 restarts AND uses <baseline_T0 / 2 tokens, ship it without the full A/B.

## 4. Default = Medium until measured

Reasoning for medium prior:
- Terse loses too much: §2 (inbox state) + §6 (skills loaded) + §7 (memory pointers) are exactly the things tonight's symptom showed missing — Dane had to re-grep memory for the queue.
- Verbose risks paying *most* of the bootstrap cost it's supposed to save.
- Medium with 5k cap matches the "1 page of context" intuition: dense, scannable, written for the agent's future self.

If measurement shifts us toward terse or verbose later, that's a config change, not a re-architecture.

## 5. Lifecycle Hooks

**Write-time:** new `write-handoff` step appended to evening-review SKILL.md after Phase 5 `goals.json` update (referenced at line 35 of [evening-review/SKILL.md](../agents/dane/.claude/skills/evening-review/SKILL.md)). Pseudocode:

```bash
cortextos bus write-handoff \
  --active-task "$(cat goals.json | jq -r .focus)" \
  --inbox-tail 5 \
  --decisions-since 24h \
  --memory-pointers-used "$(grep -h '\[' today-memory.md | head -10)"
```

The bus command serializes to `handoff.md` atomically (per `src/utils/atomic.ts`).

**Always-write fallback:** add `cortextos bus write-handoff --best-effort` to the SessionEnd hook in `.claude/settings.json`. Best-effort = no goals.json read, no full memory walk; just inbox-tail + last-3-decisions from today's memory file. Must complete in <5 seconds to not block shutdown.

**Read-time:** modify session-start instructions in agent's `CLAUDE.md` — add "Step 0: read `handoff.md` first; if framework_stable_since matches today, skip steps 1-5 of normal bootstrap." This is a 4-line edit per agent's CLAUDE.md.

## 6. Per-Agent Schema

Orchestrator (Dane) handoff is meaningfully different from specialist (Blue/Aussie/Collie) — orchestrator carries fleet-wide queue state and cross-agent dispatch context, specialist carries narrow in-flight work.

**Shared fields:** `version`, `written_at`, `framework_stable_since`, `last_inbox_tail` (5 entries), `recent_decisions` (≤10 bullets).

**Orchestrator-only fields:** `active_queue` (e.g. "Aussie 13-item Thu plate, item 3 next"), `dispatched_to` (per-agent: msg-ID + ETA + last-known status), `pacing_state` (current usage tier, cap rules in effect tonight).

**Specialist-only fields:** `dispatched_by` (who I'm working for, msg-ID), `current_step` (e.g. "Codex retry 2/3"), `blockers` (e.g. "awaiting Aussie spec confirmation").

Schema lives at `orgs/ascendops/docs/handoff-schema.md`, validated by `cortextos bus write-handoff` at write time (reject malformed; do not write a corrupt handoff that would poison next boot).

## 7. Failure Modes

| Failure | Detection | Mitigation |
|---|---|---|
| Handoff stale (>7d, e.g. agent disabled for a week) | `written_at` check at boot | Fall back to full bootstrap; warn in log |
| Handoff missing | file absent | Cold-boot path, no error |
| Handoff contradicts MEMORY.md (e.g. "active task: X" but MEMORY.md says X is closed) | mtime + cross-ref on first action | Trust MEMORY.md; flag handoff as poisoned, regenerate next session-end |
| Handoff contradicts in-flight task state (e.g. handoff says "awaiting Dane review" but Dane has already replied in inbox) | inbox check on boot supersedes handoff | Always read inbox after handoff; treat handoff as a hint, inbox as truth |
| Atomic-write torn during crash | invalid JSON parse | Fall back to cold boot |
| Two writers race (evening-review + SessionEnd hook) | mtime check before write | Last-writer-wins is fine; handoff is a hint, not source of truth |

The discipline: **handoff.md is a hint to skip work, never a source of truth.** Every boot still validates against inbox + goals.json + MEMORY.md.

## 8. Open Questions for David

1. **Where does handoff live in git?** Gitignored (per `orgs/` rule today) or committed for cross-machine portability? Argues both ways — gitignored matches existing per-agent state convention; committed lets a fresh laptop pick up where the old one left off.
   - **ANSWERED [D3]: GITIGNORED — David 2026-04-29** (Dane recommendation, agree all batch). Matches existing orgs/ tree pattern. Cross-machine resume not a strong use case (single-Mac dev environment). Easier to flip on later than to scrub committed handoff data from history. Start strict. See `decisions-log.md` D3.
2. **Is the orchestrator `dispatched_to` field a dashboard win?** If yes, surface it in `cortextos status` so David can see fleet queue without asking.
3. **Should `cortextos bus write-handoff` be part of every agent's evening-review, or only Dane's?** Specialists' value is lower per write but cumulative across the fleet.
4. **A/B-test sample size:** is 5 restarts/variant enough to commit, or should we soak 15? Faster decision vs more confidence.
5. **What gets dropped in the medium 5k cap?** Drop §6 (skills loaded — re-discoverable cheap) before §2 (inbox tail — high resume value)? Define a strict priority order.

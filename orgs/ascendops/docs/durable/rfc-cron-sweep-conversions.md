# RFC: Cron → Sweep Conversions — fewer routine fires, same coverage

**Author:** Collie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review
**Item:** Thursday plate #8 (of 13)
**Companions:** Stop-stickiness (#1) makes each cron fire potentially expensive (PTY boot if disabled); session-handoff (#2) cuts the per-boot cost; this RFC cuts the *number* of fires that incur either cost.

---

## 1. Problem — current cron count and per-fire cost

Dane's `config.json` declares 8 crons (verified verbatim 2026-04-29):

| # | Name | Cadence | Skill |
|---|---|---|---|
| 1 | heartbeat | 8h recurring | heartbeat/SKILL.md |
| 2 | check-approvals | 8h recurring | approvals/SKILL.md |
| 3 | morning-review | daily 07:30 | morning-review/SKILL.md |
| 4 | evening-review | daily 19:03 | evening-review/SKILL.md |
| 5 | weekly-review | Sun 07:57 | weekly-review/SKILL.md |
| 6 | monthly-tool-maintenance | 1st @ 03:00 | (inline brew + plugin update) |
| 7 | skill-optimizer-overnight | daily 03:00 | skill-optimizer/SKILL.md |
| 8 | token-efficiency-audit | once (no interval) | (inline) |

Per-fire token cost depends on stickiness state:

| Stickiness state | Cost per cron fire | Reason |
|---|---|---|
| Sticky-on (today's default) | ~3-5k tokens | Already-warm PTY, just inject + Claude reads + executes skill |
| Sticky-disabled, no handoff (RFC #1 alone) | ~30-58k tokens | Cold boot: re-read AGENTS/CLAUDE/MEMORY/etc. before firing skill |
| Sticky-disabled + handoff (RFC #1 + #2) | ~5-15k tokens | Warm boot: read handoff.md + skip stable framework files |

Routine-fire math today: ~6 fires/day on Dane (heartbeat 3× per 24h + approvals 3× + morning + evening + skill-optimizer = 9, minus weekly/monthly avg ~0.3) = ~9 sticky-on fires × ~4k = ~36k tokens/day on routine cron alone, before any user-driven work.

The same 9 fires post-sticky-disabled (without handoff) would cost ~324k tokens/day. Even with handoff, ~90k tokens/day. Cron count *itself* is the lever.

## 2. Sweep vs Cron Pattern

| Pattern | When |
|---|---|
| **Cron** | True time-sensitive deadline. Morning brief at 7:30 sharp because David reads it before kids board the bus. Sunday 7:57 weekly review tied to David's week-start. |
| **Sweep** | Periodic check-if-anything-changed. Approvals "is there anything pending?", skill-optimizer "have any skills drifted?", agent-stale watchdog. These can ride along on a fire that already happens. |

**Rule of thumb:** if the work has no fixed deadline AND can wait for the next already-scheduled fire, it should be a sweep, not a cron. If the work has a deadline (David's morning brief, Sunday week-review), keep it as a cron.

## 3. Audit Table

| # | Cron | Verdict | Rationale |
|---|---|---|---|
| 1 | heartbeat (8h) | KEEP, **expand into sweep host** | Heartbeat is the obvious carrier for fold-ins. 8h cadence covers most "is anything pending?" questions. |
| 2 | check-approvals (8h) | **FOLD into heartbeat** | Approvals check is itself a sweep. Folding into heartbeat saves 3 fires/day. |
| 3 | morning-review (07:30) | KEEP | True deadline — David reads before kids board the bus. |
| 4 | evening-review (19:03) | KEEP | Tied to David's day-end window. |
| 5 | weekly-review (Sun 07:57) | KEEP | True weekly deadline. Low-frequency, cheap. |
| 6 | monthly-tool-maintenance (1st @ 03:00) | KEEP | Off-shift to avoid impact. Once/month is negligible. |
| 7 | skill-optimizer-overnight (daily 03:00) | **MOVE to Aussie morning window** | Off-shift on Dane today. Aussie owns audits/research; her ~09:30 wake is a natural host. Cuts a Dane fire, doesn't add one for Aussie (she's awake anyway). |
| 8 | token-efficiency-audit (once, undated) | KEEP or **DELETE if completed** | One-shot from Apr 26 user request. If done, remove the entry from config.json. If not, schedule a date. |

**Net change:** 8 → 5 active recurring crons on Dane. Plus a one-shot if still pending. 4 routine-fires/day instead of 9.

## 4. Per-Conversion Proposals

### 4.1 FOLD: `check-approvals` → `heartbeat`

**Today:** approvals SKILL.md runs every 8h via its own cron, posts pending-approvals digest if any are open.

**Proposed:** heartbeat SKILL.md adds a step:

```markdown
## Approvals sweep
Run `cortextos bus list-approvals --pending --format text`. If output is non-empty, summarize each (id, age, what's blocking) at the bottom of the heartbeat brief. Skip if empty (silent pass-through).
```

Heartbeat also fires every 8h. Coverage identical, cost halved. Remove cron #2 from `config.json`.

**Expected savings:** 3 fires × 4k tokens/fire = ~12k tokens/day (sticky-on); ~30-90k/day (sticky-disabled). Per year: ~4M-30M tokens.

### 4.2 MOVE: `skill-optimizer-overnight` → Aussie morning window

**Today:** Dane fires at 03:00 daily. Off-shift if Dane goes sticky-disabled (RFC #1) — would force a wake just to run an audit.

**Proposed:** Add the cron to Aussie's `config.json` at her shift-start window (~09:30, recurring weekday). Aussie has a natural research/audit role. The skill-optimizer SKILL.md is portable — it doesn't depend on orchestrator-specific state.

**Coverage:** identical (one daily run). **Cost:** zero net new fires for Aussie (she's already awake on weekdays at that time).

**Edge case:** weekend skill drift coverage drops because Aussie is weekday-only (per shift-RFC #4 recommended defaults). Acceptable — skill drift over 2 days is negligible.

### 4.3 KEEP-CONDITIONAL: `token-efficiency-audit`

**Today:** type=`once`, no `interval`, no `fire_at` shown. Likely sat in config.json since Apr 26 and never fired.

**Proposed:** check if the audit was completed by other means (likely yes, given tonight's RFC #1-7 work covers exactly this ground). If yes, **DELETE from config.json**. If no, schedule explicit `fire_at` via CronCreate (one-shot).

## 5. Heartbeat-as-Sweep Design

Post-fold, heartbeat covers:

1. **Self status update** — `cortextos bus update-heartbeat online` (existing).
2. **Daily memory entry** — `WORKING ON` / `IDLE` line (existing).
3. **Approvals sweep** (folded from #2) — pending-approvals digest if any.
4. **Agent-stale watchdog** — already exists in heartbeat; check if any specialist has missed 2+ heartbeats and surface for hard-restart.
5. **Inbox check** — `cortextos bus check-inbox`, process any unread (existing).
6. **Cron deduplication check** — verify each `config.json` cron is still in `CronList` (existing pattern).

Total heartbeat skill grows from ~5 to ~6 sections. Token cost per heartbeat fire grows from ~3-5k to ~4-6k — net positive vs running approvals separately at ~3-5k.

## 6. Cross-Agent Moves

`skill-optimizer-overnight` moves to Aussie. This works only if either:
- Aussie is sticky-on at 09:30 (her shift start), OR
- Aussie's wake-on-cron path works under sticky-disabled (RFC #1 §3 "Cron fire" wake trigger).

Both are true under the proposed RFC #1 defaults (Aussie weekday business hours sticky-on; even if disabled, cron fire wakes her). Safe move.

**Other potential cross-agent moves (not done in this RFC, flagged for future):**
- `pm-morning-scan` from Blue could fold into Blue's natural morning brief — no separate cron needed.
- `framework-upstream-auto-update` from Collie to … Collie's morning sweep — same agent, fold not move.

This RFC scopes only the Dane → Aussie skill-optimizer move because it's the highest-leverage cross-agent change today.

## 7. Migration Plan

**Incremental, one cron per 24h:**

1. **Day 1**: Land approvals-sweep step in `heartbeat/SKILL.md` (additive, doesn't break anything). Verify heartbeat output now includes approvals summary.
2. **Day 2**: Remove `check-approvals` entry from `dane/config.json`. Hard-restart Dane. Verify CronList no longer contains it; verify next heartbeat fires the approvals sweep correctly.
3. **Day 3**: Add `skill-optimizer-overnight` to `aussie/config.json` (with a slight time shift, e.g. 09:33, to avoid clashing with her morning wake).
4. **Day 4**: Remove `skill-optimizer-overnight` from `dane/config.json`. Hard-restart Dane.
5. **Day 5**: Audit `token-efficiency-audit`. If complete, delete; if open, schedule explicitly.
6. **Day 7+**: Soak. Watch heartbeat output for any approvals-sweep miss; watch Aussie morning brief for skill-optimizer output. Roll back individual conversions if anything breaks.

Big-bang alternative: do all 3 changes in one PR. Faster but harder to attribute regressions. Incremental wins.

Rollback per conversion: re-add the cron entry to `config.json`, hard-restart. Nothing lost.

## 8. Open Questions for David

1. **Heartbeat 8h vs 4h** — Blue currently does 4h heartbeat-summary-to-Dane (per `feedback_dane_heartbeat_summary.md`). Should Dane's heartbeat match that 4h cadence (more fires but fresher approvals sweep), or stay at 8h (cheaper, slightly stale)? Lean 8h.
2. **`skill-optimizer-overnight` weekend gap** — acceptable to skip Sat/Sun audit, or move it to Collie (weekday-only same as Aussie, but less audit-y) or back to Dane on weekends only? Cleanest: Aussie weekdays + Sun morning Dane fallback if weekend drift becomes a problem.
3. **`token-efficiency-audit` status** — was this completed by tonight's 7-RFC batch? If yes, delete the cron entry. Confirm before I delete.
4. **Heartbeat-as-sweep limit** — how many fold-ins before heartbeat becomes a kitchen sink? Suggest cap at 4-5 sweep responsibilities; beyond that, split into a "morning-sweep" + "evening-sweep" pair.
5. **Cross-agent cron move pattern** — should we standardize moving "audit-y" crons to specialists by class (audits → Aussie, code reviews → Collie, etc.) and document that allocation in `orgs/ascendops/docs/cron-ownership.md`? This RFC is one move; the pattern repeats.

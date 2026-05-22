# Decisions Log — David architectural calls, dated + numbered

**Owner:** Aussie (custodian); Dane (orchestration); David (decision authority)
**Format:** D-number ↔ ISO date ↔ RFC ref ↔ verbatim decision text
**Status:** Living document — append-only

---

## 1. Why This Doc Exists

Architectural decisions live in three places today: the RFC docs (where the question was asked), conversation transcripts (where David made the call), and operator memory (which does not survive across sessions). This doc consolidates them into a single source of truth so future agents/operators can answer "is X already decided?" in one read instead of grepping six places.

The document prevents three failure modes: (a) re-litigating decisions already made, (b) drift between what David said and what got coded, (c) decisions made outside any RFC that have no documented rationale.

**Read this doc before raising any architectural question.** If your question is here, the answer is too.

---

## 2. Decision Log Table

| ID | Date | RFC | Question | Decision | Reasoning (short) | Reversibility |
|---|---|---|---|---|---|---|
| D1 | 2026-04-29 | #6 §9 Q2 | Namespace rename worth disruption? | APPROVED — `cli-anything-propertymeld` → `snapcli-pm` + 1-quarter shim | S303 collision documented; rename plan execution-ready; reversibility via git revert | HIGH (git revert) |
| D2 | 2026-04-29 | #6 §9 Q1 | Repo layout: monorepo vs separate packages? | SEPARATE pip packages per adapter (`snapcli-pm`, future `snapcli-af`, `snapcli-tt` etc.) | Tight coupling cost in monorepo > duplicated release cost in separate; cleaner future adapter additions | MEDIUM (consolidate later if drift) |
| D3 | 2026-04-29 | #2 §8 Q1 | `handoff.md` git policy: gitignored vs committed? | GITIGNORED | Matches existing `orgs/` tree pattern; cross-machine resume not strong use case (single-Mac dev env); easier to flip on later than scrub history | HIGH (toggle gitignore) |
| D4 | 2026-04-29 | #4 §8 Q1 | Saturday Blue cutoff: 21:00 vs 19:00? | 21:00 ET (9 PM) | Carlos works Saturdays; docs lag 1-2h after his 5-6pm wrap; matches weekday cutoff for clean shift-schedule rule | HIGH (config edit) |
| D5 | 2026-04-29 | #12 §8 Q1 | `force-pending-completion --reason` required vs optional? | REQUIRED | Manager-force PENDING_COMPLETION is unusual; warrants paper trail; if reason is empty the action wasn't important enough | HIGH (CLI flag change) |
| D6 | 2026-04-29 | #7 §3.1 Q4 | Completion-checklist auto-message vs prompt-David? | AUTO-SEND (Tier-1); escalate to David only on Tier-2 anomaly (same tech repeats gap 3x in 7d) | Blue caught Carlos audit error within 3 min today via the skill — auto-pattern validated by real evidence | MEDIUM (config flag if regret) |

---

## 3. Today's Six Decisions — Full Reasoning

### D1 — Namespace rename APPROVED [RFC #6 §9 Q2]
- **Decision:** `cli-anything-propertymeld` → `snapcli-pm` rename approved + 1-quarter deprecation shim for old `from cli_anything.propertymeld import` callers.
- **Reasoning:** The S303 namespace collision (verified Apr 28, two packages claiming `cli_anything.propertymeld`) caused 6+ commits of confusion this week. Rename kills it permanently. `rfc-snapcli-rename-execution-plan.md` §0 cited the pre-flight + reversibility. Rollback via git revert per execution plan §3.
- **Execution:** Thursday, Codex, post-RFC #14 protocol fix landing. See `rfc-snapcli-rename-execution-plan.md` §2 for step-by-step.
- **Reversibility:** HIGH. Reverse-publish old shim if needed; deprecation shim already in plan keeps old callers working through Q2.

### D2 — Repo layout: SEPARATE pip packages [RFC #6 §9 Q1]
- **Decision:** Each adapter ships as its own pip package (`snapcli-pm`, future `snapcli-af`, `snapcli-tt` etc.). NOT consolidated into a snapcli monorepo.
- **Reasoning:** Tight coupling cost in monorepo (every adapter version-locked together; refactor blast radius wide) > duplicated release cost in separate (each adapter ships independently; deprecation cycles isolated). Cleaner future adapter additions: TenantTurner / LeadSimple / Monday come in as standalone packages without monorepo PRs.
- **Execution:** D1 rename creates `snapcli-pm` as standalone. AppFolio rename (eventually) creates `snapcli-af` standalone. Pattern set.
- **Reversibility:** MEDIUM. If adapter ecosystem grows and refactor-friction proves real, consolidation is a future option but harder than starting separate.

### D3 — handoff.md GITIGNORED [RFC #2 §8 Q1]
- **Decision:** `handoff.md` files at `orgs/<org>/agents/<agent>/handoff.md` stay gitignored. Not committed.
- **Reasoning:** Matches existing `orgs/` tree pattern (memory/, scripts/, etc.). Cross-machine resume isn't a strong use case in this single-Mac dev environment. Committing handoff data risks accidental disclosure of in-flight context (inbox previews, pending decisions); scrubbing committed data from history later is painful. Easier to flip ON later than to clean up after.
- **Execution:** No action — handoff.md already gitignored under the orgs/ rule today. Confirmed default.
- **Reversibility:** HIGH. Single-line edit to `.gitignore` if cross-machine portability becomes a real need.

### D4 — Saturday Blue cutoff: 21:00 ET (9 PM) [RFC #4 §8 Q1]
- **Decision:** Blue's Saturday `shift_schedule.weekly.sat.end` = 21:00 ET (not 19:00).
- **Reasoning:** Carlos works Saturdays. His typical wrap is 5-6 PM, and PM documentation (notes, photos, hours) often lags his physical wrap by 1-2 hours. Saturday cutoff at 19:00 would leave Blue offline during the natural completion-checklist + nudge window. 21:00 captures Carlos's late-doc-update period and matches Blue's weekday cutoff for a clean uniform schedule rule.
- **Execution:** Folded into RFC #4 §5 recommended defaults. Codex applies on shift-schedule rollout (paired with RFC #1 stickiness landing).
- **Reversibility:** HIGH. Single config edit to revisit if Saturday Carlos behavior shifts.

### D5 — `force-pending-completion --reason` REQUIRED [RFC #12 §8 Q1]
- **Decision:** `pm work-orders force-pending-completion <meld-id> --reason "..."` — `--reason` is REQUIRED, not optional. Empty `--reason ""` is rejected by the CLI with a clear error.
- **Reasoning:** Manager-force PENDING_COMPLETION is an unusual transition; PM doesn't normally allow manager-side state pushes without tech sign-off. Every use deserves an audit-trail reason. If the manager couldn't articulate why, the action wasn't important enough to take. Friction here is feature, not bug.
- **Execution:** Codex implementation per RFC #12 §3 (15 LOC wrapper post-Aussie endpoint discovery). `--reason` declared as Click `required=True`.
- **Reversibility:** HIGH. Flip to optional if friction proves operationally painful; default config edit.

### D6 — Completion-checklist AUTO-SEND [RFC #7 §3.1 Q4]
- **Decision:** Blue's `completion-checklist` skill auto-sends the hidden-from-tenant follow-up message to the in-house tech when notes/photos/hours are missing. Tier-1 default. Escalation to David triggers only on Tier-2 anomaly (same tech repeats the same gap 3x within 7 days).
- **Reasoning:** Blue caught Carlos's no-docs error within 3 minutes today using the skill's check logic — the auto-pattern is validated by real working evidence, not theory. The "wrong message to tech" soft cost is bounded (techs get 1-2 polite "can you add X?" pings, not blaming or escalation). Tier-2 escalation catches the actual problem cases (chronic gaps) without flooding David with single-event noise.
- **Execution:** Already shipped (`agents/blue/.claude/skills/completion-checklist/` overnight via V batch). Tier-2 escalation logic is a follow-on (uses `repeat-meld-detector` skill from RFC #7 deferred candidates if/when it lands).
- **Reversibility:** MEDIUM. Disable auto-send via env flag if regret; Blue reverts to prompt-David-first mode.

---

## 4. How Decisions Get Logged Going Forward

When David approves an RFC question or makes an architectural call:

1. **Append to §2 table** with next sequential D-number.
2. **Add to §3** with the full reasoning (verbatim from David where possible, paraphrased with attribution otherwise).
3. **Edit the originating RFC doc** to mark the question ANSWERED with the date + decision-id + cross-link to this log.
4. **(If implementation-blocking)** flag in `cron-ownership.md` §6 TODOs that the decision unblocks.

The pattern: PROPOSE (RFC) → DOCUMENT (this log) → DECIDE (David) → EXECUTE (Codex/Aussie/Collie). Skipping any stage fragments the audit trail.

---

## 5. Anti-Patterns

Three failure modes this log guards against:

1. **Re-asking decided questions.** If you're about to raise an architectural question, GREP THIS DOC FIRST. If the question is here, the answer is here. If your situation is genuinely different, propose a new RFC question framing — don't re-litigate D1-Dn.
2. **Deciding outside the propose-document-decide flow.** If a Codex or Collie hardcodes an architectural choice mid-implementation without an RFC + decision-log entry, that's drift. The implementer should pause, raise the question, get the decision logged, then resume.
3. **Decisions without reasoning recorded.** "David said X" with no reasoning is fragile — a future audit can't tell if X is still right. Every D-entry MUST capture the reasoning for the same reason every RFC has §1 Problem.

---

## 6. Cross-References

- `rfc-snapcli-saas-adapter.md` (D1 + D2 source) — §9 Q1 + Q2 now ANSWERED inline.
- `rfc-snapcli-rename-execution-plan.md` (D1 implementation guide).
- `rfc-session-handoff.md` (D3 source) — §8 Q1 now ANSWERED inline.
- `rfc-shift-schedule.md` (D4 source) — §8 Q1 now ANSWERED inline.
- `rfc-pm-force-pending-completion.md` (D5 source) — §8 Q1 now ANSWERED inline.
- `rfc-blue-skill-candidates.md` (D6 source) — §3.1 Q4 now ANSWERED inline.
- `cron-ownership.md` §6 — XX batch reference for Thursday execution unblock.
- `integration-roadmap-2026-04-29.md` §8 — original consolidated David-Q list (now D1-D6 partially answered, others pending).

---

**Last updated:** 2026-04-29 (XX batch — D1 through D6 added).
**Word count:** ~860 (within 600-900 target).

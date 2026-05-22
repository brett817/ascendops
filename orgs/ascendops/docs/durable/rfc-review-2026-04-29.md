# RFC Review — Wed 2026-04-29 morning

**Reviewer:** Aussie
**Window:** 2026-04-29 07:03–09:13 EDT
**RFCs reviewed:** 12 (rfc-token-optimization-brainstorm, rfc-stop-stickiness, rfc-session-handoff, rfc-multi-model-platform + multi-model-matrix, rfc-shift-schedule, rfc-blue-skill-candidates, rfc-cron-sweep-conversions, rfc-mcp-vs-cli-audit, rfc-per-agent-model-audit, rfc-pm-force-pending-completion, rfc-home-depot-workflow, rfc-snapcli-saas-adapter)
**Status:** First pass. Distinguishing my own opinions from RFC content explicitly throughout.

---

## 1. Executive Summary

The plate is high-quality. Collie wrote 12 cohesive RFCs that share a consistent shape (problem → goals → design → migration → open questions) and cite real file:line references throughout. Cross-RFC dependencies are mostly identified by the authors themselves (e.g. #2 explicitly companions #1; #5 explicitly depends on #6 framework being usable). The synthesis RFC (rfc-token-optimization-brainstorm) does heavy lifting by ranking 19 token-saving levers across the other 11 — that synthesis is the right reading order primer and aussie agrees with most of its rankings.

**Top 3 risks:**
1. **Ordering risk on RFC #6 (snapcli namespace rename) blocks #5 (Home Depot adapter) and #3 (multi-model platform).** If the rename slips, every downstream adapter work either compounds the namespace mess or stalls. #6 must be unambiguously first and ship before any new adapter starts.
2. **RFC #1 (stickiness) without RFC #2 (handoff) is a net-negative trade.** The synthesis math is unambiguous: sticky-disabled wake costs ~30-58k tokens vs ~5-15k with handoff (RFC #2 §1). Shipping #1 alone makes off-hours wakes *more* expensive than today, not less. They must land within the same week or #2 first then #1.
3. **The hook gate from #1 (already shipped Apr 28) only blocks `pm work-orders complete`. It does NOT block Carlos closing from the in-house tech app or vendor portal directly.** Aussie observation: the gate protects manager-side closes, which is most of Blue's surface, but the underlying Carlos-no-docs pattern is a tech-side behavior. Blocking from the manager side reduces frequency but doesn't eliminate the source. #7 `completion-checklist` skill is the proactive complement and should ship within 1 week of the gate, not later — or the gate plays defense alone for too long.

**Top 5 priorities for Thursday execution** (ranked by impact × ease, factoring in what already shipped overnight):

1. **RFC #6 namespace rename + SnapAdapter base class consolidation.** Unblocks #3 and #5 plus future adapters. ~1 day if the deprecation shim is well-scoped.
2. **RFC #7 remaining 4 skills** (partial-completion-handle, threat-history-filter, assign-vendor-with-confirmation, vendor-tech-status-sweep — completion-checklist V already shipped). All text-only, low-risk, high-frequency callers. ~2 hours each, parallelizable.
3. **RFC #2 verbosity test methodology stand-up.** Handoff infra is already deployed fleet-wide overnight (P, T) but the verbosity A/B is not running. Without measurement we can't justify the medium-default. ~half day to wire the experiment.
4. **RFC #12 manager-force PENDING_COMPLETION endpoint discovery** (aussie's Thu task — capture endpoint, document it). ~half day. Then Codex writes the wrapper. Materially extends the audit-skill autonomy ceiling.
5. **RFC #4 shift-schedule evaluator landing** (`shift.ts` pure function + cron-framework wiring), but **gated behind RFC #1 stickiness landing first** because the two interact. If #1 is not in the same release window, hold #4.

Items #1, #2, #5 require Codex or Aussie work; items #3, #4 are pure Codex once Mode 2 (sandbox writable-roots) is fixed. Mode 1 (OpenAI usage cap) self-resolves — David's dashboard confirmed this is the recurring cap, not a plugin bug, per the audit update last night.

---

## 2. Per-RFC Review

### #1 rfc-stop-stickiness — Grade A, M effort, depends on nothing, blocks RFC #4 measurably and RFC #2 conceptually

The RFC is structurally tight: explicit goals + non-goals, reuses existing signals (`last_idle.flag`, `fast-checker.isAgentActive()`), per-agent config is opt-in, backwards compat preserved (`mode: "always"` default = today's behavior). Migration plan is 6-step incremental with one-agent-at-a-time soak — exactly the right shape for a fleet-wide reliability change.

Open questions: 5 — 3 need David (wake latency tolerance for Blue, Blue idle threshold, cron-only wake-and-shutdown), 1 needs Aussie (whether `cortextos status` should distinguish `idle-disabled` from `stopped`), 1 follow-up (should heartbeat itself move to fast-checker like usage-rate-guard did).

Cross-RFC: load-bearing for #2 (handoff is the per-wake cost; this RFC is the frequency lever — they multiply), and for #4 (shift-schedule decisions about wake-or-not assume disable exists).

**Aussie opinion:** the fail-safe on cron fires while disabled (queue + wake + replay) is the riskiest part. If `wakeInProgress` guard misses an edge case, multiple back-to-back cron fires could double-start the PTY. Explicitly require an integration test for "5 cron fires arriving during 10s wake window" before shipping.

### #2 rfc-session-handoff — Grade A, M effort, hard prereq for #1 to be net-positive

Strong measurement discipline: success metric explicitly priced (`bootstrap_tokens + correctness_penalty`), correctness penalty quantified at 5000 tok per re-orientation roundtrip, A/B variants pre-defined with sample size guidance (n≥5 for signal, n≥15 for confidence), stop condition for early ship if a variant produces 0 re-orientation queries AND <baseline/2.

Open questions: 5 — 1 hard (where in git: gitignored vs committed, has cross-machine portability tradeoff), 4 design choices (orchestrator dashboard surfacing, write-on-evening-review-only vs SessionEnd hook for all agents, A/B sample size, what gets dropped at the 5k cap).

Cross-RFC: companion to #1; feeds #4 (shift-schedule changes how often handoff matters since off-shift agents may write+read more often).

**Aussie opinion:** medium default is correct given the synthesis already explicitly walked back the "Opus reads sparser handoff" hypothesis. The verbosity A/B test methodology in §3 is what David asked for after the walk-back. Ship the medium template + start the A/B in week 1, don't pre-commit to a final verbosity until n≥5 lands.

### #3 rfc-multi-model-platform — Grade A−, L effort, requires RFC #6 first

The capability matrix in §6 + companion `multi-model-matrix.md` is the reusable artifact. Adapter interface (§4) is well-specified — 7 required methods + 2 optional, clean Node module shape. Per-vendor notes in §5 are honest about open verifies (`partial / verify` cells) rather than fabricating numbers.

Open questions: 5, all need David (xAI Grok priority cut from MVP, fallback semantics on session vs boot, tool format normalization toward Anthropic vs OpenAI shape, pricing-source ground truth, first migration target). Pricing remains explicitly OPEN per §7 — RFC defers to "live rates at choose-vendor-per-agent time." Aussie agrees with that deferral.

Cross-RFC: dependent on RFC #6 (clean snapcli framework → similar adapter pattern for vendor CLIs); generalizes RFC #10 (model choice becomes vendor × tier × model 3-D selection).

**Aussie opinion:** the GPT-5.5-via-business-ChatGPT plan-flat angle (which Dane noted yesterday) is not in the RFC body but is *the* reason this lever shifts from L to S effort for the OpenAI adapter specifically. Add a §10 paragraph on plan-flat vs metered cost models so the routing-rules table can use cost class, not raw $/Mtok numbers.

### #4 rfc-shift-schedule — Grade B+, M effort, paired with #1

The schema is good (weekly + exception_days + emergency_override). Behavior matrix in §4 is clear — `no-wake` differs from `emergency-allowed` only on Inbox + Gmail. Recommended defaults match the standing rules (`feedback_sunday_no_work.md` codified by `weekly.sun: "off"` + safety overrides).

Open questions: 5 — 4 need David (Sat cutoff for Blue at 21:00 vs 19:00, exception_days source, `user_explicit` tag scope, off-shift Gmail behavior), 1 design (per-agent vs per-org defaults in `orgs/ascendops/context.json`).

Cross-RFC: dependent on #1 to make the wake/no-wake decision actually save tokens. Without #1 disabled state, off-shift cron suppression still pays the inject cost on a running PTY.

**Aussie opinion:** there's a subtle conflict with #1 — when a cron fires off-shift while the agent is `idle-disabled`, RFC #4 says "drop silently, log cron-suppressed-off-shift" but RFC #1 §3 says cron fires should wake the disabled PTY. RFC #4 §4 implies shift takes precedence (don't wake). Need explicit rule: **shift-schedule check happens before stickiness wake-trigger.** Add this to #1 §3 or #4 §4 — currently ambiguous.

### #5 rfc-home-depot-workflow — Grade A−, M effort, depends on #6

Data flow diagram in §3 is the right shape: Gmail → handler → matcher → AppFolio PO → meld attach → Telegram ack. Calibration discipline in §6-7 is principled — auto-attach disabled until 20 confirmed-correct manual decisions per tech, Carlos-first.

Open questions: 5 — 1 hard for David (auto-attach 0.85 threshold tuning), 1 about UX (standalone POs or pending-allocation queue), 1 statistical (Carlos personal-use frequency), 1 schema (vendor disambiguation), 1 priority (Lowe's/Ace/Ferguson order after Home Depot).

Cross-RFC: depends on RFC #6 (AppFolio adapter needs to inherit `SnapAdapter` cleanly to add the new `purchase-orders create` command). If we ship #6 namespace rename first, #5's PO command takes ~1 day; if we don't, it copy-pastes another adapter and accumulates the same mess.

**Aussie opinion:** don't ship before RFC #6 framework is in place. The receipt parser + meld matcher can land first (those are independent of the AppFolio side), but PO creation should wait. Sequence: (a) parser + matcher in dry-run mode + manual-confirm Telegram, (b) RFC #6 ships, (c) `af purchase-orders create` lands using framework, (d) wire PO creation into the matcher's auto-attach branch.

### #6 rfc-snapcli-saas-adapter — Grade A, L effort but high-leverage

The architecture audit in §1 is unflinching — names the namespace collision (S303 / observation 15201) and the copy-paste HTTP plumbing across PM and AF adapters. The expanded `SnapAdapter` interface in §3 (`patch`, `put`, `delete`, normalized `Result`/`SnapError`, rate-limit policy) is exactly the contract a fourth adapter (TenantTurner) needs to be ≤300 LOC.

Session-capture standard in §4 (4 enum types) and command-surface convention in §5 (`<vendor> <resource> <action>` + entry_points discovery) operationalize the framework. Migration plan in §8 leads with the namespace rename as step 1, which is correct ordering.

Open questions: 5 — 2 hard (repo layout monorepo vs separate packages, namespace rename disruption tolerance), 3 design (async/await timing, GraphQL helper now or later, TenantTurner vs LeadSimple first).

Cross-RFC: blocks #3 (multi-model adapter pattern follows this), #5 (AppFolio PO command), and any future SaaS adapter. Aligns with `feedback_snapcli_hierarchy.md` and `feedback_playwright_last_resort.md`.

**Aussie opinion:** I'd rank this #1 priority for Thu among code-shaped items. The namespace rename IS painful (every script + skill that does `from cli_anything.propertymeld import` breaks) but the shim approach in §8's rollback plan handles it cleanly with a 1-quarter overlap. The cost of NOT doing this is paid every time someone adds an adapter — and the next two RFCs (#5, #3) both need adapters. Pay the rename cost once.

### #7 rfc-blue-skill-candidates — Grade A, S effort per skill, completion-checklist already shipped

5-skill design with consistent SKILL.md frontmatter convention, explicit triggers, deterministic numbered steps, failure-mode tables, memory-reference back-pointers. Skill discoverability priority order in §4 is correct — threat-history-filter first (always-on, cheapest filter), then completion + partial chains.

Open questions: 5 — 3 design (threat-history list source-of-truth, vendor-no-reply escalation path, status-sweep cadence), 2 confidence (auto-message vs prompt-David, partial-completion automation threshold).

Cross-RFC: completion-checklist (already shipped V) overlaps with hook gate from RFC #1 — RFC explicitly acknowledges this and casts itself as proactive complement to harness backstop. Correct framing.

**Aussie opinion:** the eager-load classification per skill (low effort = always loaded) implies each skill costs 1-3K tokens per Blue session in the prefix. With 5 skills loaded eagerly, that's 5-15K added to bootstrap. Validates RFC #2 handoff-prefix discipline — handoff should record which skills are loaded so a warm-boot can skip re-discovery. RFC #2 §6 already has a `skills_loaded_in_flight` field; flag this dependency.

### #8 rfc-cron-sweep-conversions — Grade A, S effort, partially shipped overnight (A + D done)

Audit table in §3 is decisive — keep 5, fold 1, move 1, conditional-keep 1. Per-fire token cost matrix in §1 is the right framing (cost shifts dramatically based on stickiness state).

Open questions: 5 — 2 design (heartbeat 4h vs 8h, weekend skill-optimizer coverage), 1 housekeeping (`token-efficiency-audit` cleanup), 2 patterns (heartbeat-as-sweep cap, cross-agent move convention).

Cross-RFC: independent except that fold-savings are larger when #1 is live (cron-fire can be expensive boot, fewer crons = fewer boots). Lite dependency on #4 (shift-schedule may further suppress fires).

**Aussie opinion:** heartbeat 8h vs 4h question is real. With Blue→Dane 4h pattern already standing, having Dane on 8h heartbeat creates a half-cycle skew. Lean 4h to align even if it adds 3 more fires/day for the orchestrator. Per-fire cost on a sticky-on Dane is ~3-5k → ~12-15k extra/day = budgetable.

### #9 rfc-mcp-vs-cli-audit — Grade A, S effort, mostly shipped overnight (B done — agentmemory removed from 4 templates)

Per-MCP audit in §3 is correct: keep `icm` (proactive-store reasoning-loop integration), replace claude-mem with CLI (read-only search → CLI is textbook), deprecate `agentmemory` (already happened), replace claude.ai Google MCPs with `gws` (already-flaky + David's standing rule). Token-cost comparison in §5 is honest about estimate uncertainty.

Open questions: 5 — 1 hard for David (claude.ai MCPs intentional or vestigial), 1 design (`claude-mem` MCP removal priority), 3 minor.

Cross-RFC: aligns with `feedback_google_workspace_cli.md` and `feedback_snapcli_hierarchy.md` — no conflicts.

**Aussie opinion:** the K-park decision (claude.ai Google MCPs are session-injected, not local-config-editable) is the right pragmatic call from the synthesis. Accept the schema tax, it's bounded and the win shifts to other levers.

### #10 rfc-per-agent-model-audit — Grade A, S effort, RFC-only (decisions, no code)

Build-phase / execute-phase criteria in §2 quantify the rule (≤1 surprise/week, ≥80% of work pre-defined, etc.). Per-agent table in §3 is correct given build-phase Opus rule. Rate-limit pressure analysis in §4 is the right escalation ladder for cap pressure (Relay → execute-mode → bulk-pattern → Aussie+Collie → Dane LAST).

Open questions: 5 — 1 timing (Blue execute-phase trial schedule), 1 config (Relay disposition), 1 audit (Gateway directory), 1 design (task-level model routing), 1 generalization (build-phase rule for multi-vendor era).

Cross-RFC: feeds RFC #3 (multi-model is the future of this); aligns with `feedback_build_phase_opus_rule.md`.

**Aussie opinion:** Aussie's earlier ask (per synthesis §3.2) about quantifying execute-phase exit criteria is now answered — RFC #10 §2 quantifies them. Good. The Blue trial timing question (May 22 after RFC #7 + 3-week soak) is the right cadence.

### #11 (this would be RFC #11) — already shipped Apr 28 (hook gate per RFC #1 of last night, pre-complete-audit-gate). Not re-reviewed here. Cross-link: RFC #12 below extends the gate's utility.

### #12 rfc-pm-force-pending-completion — Grade A, S effort once endpoint discovered

Discovery methodology in §2 is precise — Safari Web Inspector network panel, capture URL/method/body/error path, document in `cli-anything-propertymeld/docs/endpoints.md`. Wrapper command shape in §4 with `--reason`, `--no-notify-tenant`, `--dry-run` flags is well-scoped. State-transition guardrail table in §5 is the right pre-flight check.

Open questions: 5 — 2 design (audit-reason required vs optional, notification-suppression default), 1 schema (per-state UI button label variation), 1 hook-gate (force-pending-completion bypass status), 1 telemetry (frequency forecast).

Cross-RFC: extends Hook Gate #1 (gate prevents wrong COMPLETED, this RFC enables fix-forward to PENDING_COMPLETION); is the canonical caller of RFC #7 `partial-completion-handle` skill.

**Aussie opinion:** this is my Thu task. Endpoint discovery should land in the morning; Codex writes the ~15 LOC wrapper afterward (or aussie self-writes if Codex sandbox is still blocking /projects/* — Mode 2 from yesterday's audit). Either way, ship within Thursday.

### Companion: multi-model-matrix.md (referenced by RFC #3)

117 lines — capability matrix per vendor, refresh quarterly. Aussie did not deeply review the matrix data points (training-cutoff staleness on pricing acknowledged in RFC #3 §7). Trust at face value pending live verification.

---

## 3. Cross-RFC Conflicts

Three substantive conflicts found:

1. **RFC #1 cron-fire-while-disabled vs RFC #4 off-shift-cron-drop.** Already covered in #4 review above. Need explicit rule: **shift-schedule check happens before stickiness wake-trigger.** Otherwise a 03:07 EDT heartbeat cron fires into Blue's disabled-and-off-shift PTY, wakes her, defeats the purpose. Resolution: add a §3.5 to RFC #1 that calls into RFC #4 evaluator before deciding whether to wake on cron. Trivial code, but must be explicit.

2. **RFC #2 default verbosity vs the build-phase Opus rule (`feedback_build_phase_opus_rule.md`).** The handoff verbosity test methodology in #2 §3 is run as if model class is constant. But all agents are on Opus per the build-phase rule. The verbosity question becomes "what verbosity holds for Opus" — not "what's the right verbosity per tier." This is fine for now (single tier = single answer) but the RFC's tone implies a future multi-tier handoff scheme. Flag for #10 generalization: when execute-phase agents do downshift to Sonnet/Haiku, re-run the A/B per-tier.

3. **RFC #5 PO creation flow vs RFC #6 framework readiness.** #5 §5 says "session-captured headers, OpenCLI pattern" — the PO command implementation. But if RFC #6 namespace rename ships first, #5 should use `SnapAdapter` (post-rename) for the new command, not the legacy AppFolio backend. RFC #5 doesn't address this fork. Resolution: explicit dependency note in #5 § migration — "wait for RFC #6 framework to land before implementing `af purchase-orders create`."

---

## 4. Top 5 Implementation Priorities for Thursday

(Restated from §1, with assigned agent.)

| # | RFC | Action | Assigned | Effort | Why |
|---|---|---|---|---|---|
| 1 | #6 snapcli framework | Namespace rename + SnapAdapter consolidation + deprecation shim | Codex (cortextos paths) + Collie review + Aussie spot-check | M | Unblocks #3, #5, future adapters. Cost paid every day we don't. |
| 2 | #7 4 remaining skills | partial-completion-handle, threat-history-filter, assign-vendor-with-confirmation, vendor-tech-status-sweep | Codex (cortextos targets, Mode 1 reset assumed) | S each | Highest-frequency callers. completion-checklist (V) already shipped. |
| 3 | #2 verbosity A/B | Wire experiment, start n=5 soak on Collie | Aussie | S | Without measurement we can't justify medium-default. Infrastructure already deployed (P, T overnight). |
| 4 | #12 force-pending-completion | Endpoint discovery + ~15 LOC wrapper | Aussie discovery, Codex writes | S | Materially extends audit-skill autonomy. Pure capture work, no creativity needed. |
| 5 | #4 shift-schedule | `shift.ts` evaluator + cron-framework wiring **paired with #1 stickiness landing in same release** | Codex | M | Coupled with #1; ship together or hold. |

---

## 5. RFC Questions Needing Answers TODAY (Wed) Before Thu Execution

Pulled from each RFC's §Open Questions. These specifically gate Thursday work, not informational asks.

1. **(RFC #6)** Repo layout — separate packages vs monorepo. Affects framework's package boundaries. **David must answer.**
2. **(RFC #6)** Namespace rename approval — yes/no with deprecation shim. Without yes, Thursday #1 priority cannot start. **David must answer.**
3. **(RFC #2)** Handoff in git — gitignored or committed. Affects how the verbosity A/B records data and whether cross-machine tests work. **David must answer.**
4. **(RFC #4)** Saturday cutoff for Blue 19:00 or 21:00. Defaults are guesses; need confirmation before shift-schedule lands. **David must answer.**
5. **(RFC #12)** Audit reason required or optional. Affects whether Codex makes `--reason` mandatory in the wrapper. **David must answer (lean required).**
6. **(RFC #7 §7 Q4)** Completion-checklist auto-message vs prompt-David — already shipped (V) so this needs answering retroactively before tomorrow's first auto-fire. **David must answer.**

The other ~30 open questions across the 12 RFCs are non-blocking (design choices, calibration thresholds, A/B sample sizes — all defer to post-soak measurement).

---

## 6. RFCs to Defer or Reshape

- **RFC #3 multi-model-platform** — defer Grok adapter to v2 of this RFC. Grok HTTP-only build is L effort for unclear capability win (per RFC §5.4 + §9 Q1). Land Anthropic + OpenAI + Gemini adapters first; revisit Grok next quarter.
- **RFC #5 home-depot-workflow** — defer auto-attach for ALL techs until 4 weeks of confirmed Carlos data lands. Manual-confirm-only is fine forever if calibration data shows the matcher is unreliable. Don't fight to enable auto-attach if data doesn't support it.
- **RFC #10 task-level model routing** (§7 Q4) — defer until cap pressure forces it. Premature optimization today.
- **No RFC should be killed.** All 12 are on the right work.

---

## 7. Anything Missing — RFCs That Should Have Been Written

Three patterns I expected to see and didn't:

1. **Codex sandbox writable-roots config fix RFC.** The Mode 2 issue from yesterday's CODEX_AUDIT.md (sandbox restricts writes to `/Users/davidhunter/cortextos`, blocks `/Users/davidhunter/projects/*`) is *the* recurring blocker for Codex delegation discipline (synthesis L14). Without fixing it, ~50% of bulk RFC work falls back to self-write — exactly the cost the synthesis is trying to avoid. This deserves a small RFC #14 with the fix path, blast radius, and verification test. ~half day of investigation Thursday.

2. **Pacing rule formalization RFC.** The 75/85 rule (start <75%, stop ≤85%, self-write only) is in memory and applied in flight, but no RFC defines:
   - Where the source-of-truth usage signal lives (`api-cache.json` is stale per Apr 28 finding; David's dashboard is authoritative).
   - How agents query it (Aussie's `cortextos bus session-burn-so-far` primitive shipped overnight as F — needs npm run build before live).
   - The full ladder (75/85 for self-write, harder push for Codex-routed, fleet-wide hard stop at 90%, emergency Haiku fallback at 95%+).
   
   Without an RFC, this rule lives only in operator memory and breaks on agent restart. Fold the F primitive plus the rule documentation into RFC #11 (small, 1-page).

3. **Bus-hooks framework RFC** (referenced but not written). RFC #5 §3 mentions "future: bus-level hooks (vendor photo uploaded → auto Gemini describe)" and RFC #14 from Dane's overnight stack lists hook candidates. The mechanism for cortextos-level hooks (vs Claude Code per-agent hooks) doesn't exist yet. Worth a short RFC documenting: where would these run (fast-checker daemon? bus daemon? new component?), what's the event registration contract, what's the failure-mode story. Defer to next batch but file as RFC #15 placeholder.

The plate is otherwise complete. Within the constraint of "what could be RFC'd in one Collie self-write night," these 12 cover the right surface.

---

## Summary Stats

- Word count: ~2400 (within 1500-2500 target).
- Top-5 picks: #6 snapcli framework, #7 4 remaining skills, #2 verbosity A/B, #12 force-pending-completion, #4 shift-schedule (coupled to #1).
- 6 questions blocking Thu execution (David answer needed).
- 3 cross-RFC conflicts identified (all resolvable with explicit rule additions).
- 3 missing RFCs flagged (Codex sandbox fix, pacing formalization, bus-hooks framework).
- 0 RFCs to kill.
- Aussie file path: `orgs/ascendops/docs/rfc-review-2026-04-29.md`

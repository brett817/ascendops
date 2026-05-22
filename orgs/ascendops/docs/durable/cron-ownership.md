# Cron Ownership — fleet-wide cron registry + decision tree

**Status:** Living document. Refresh whenever a cron is added/moved/retired.
**Last updated:** 2026-04-29
**Origin:** RFC #8 §8 Q5 ("standardize moving 'audit-y' crons to specialists by class and document the allocation")
**Companion RFCs:** [#4 shift-schedule](./rfc-shift-schedule.md), [#8 cron→sweep](./rfc-cron-sweep-conversions.md)

---

## 1. Why this doc exists

Without ownership clarity, cron folds (RFC #8) become accidental conflicts: two agents start firing the same skill, or a moved cron disappears entirely because nobody knew who picked it up. RFC #8 §8 Q5 explicitly asked for this doc as the standardization surface. Cron data here is **verbatim from each agent's `config.json`** — not invented.

## 2. Fleet Cron Table

| Agent | Cron Name | Schedule | Type | Skill / Action | RFC |
|---|---|---|---|---|---|
| dane | heartbeat | 8h | recurring | heartbeat/SKILL.md (now also runs approvals sweep) | #8 fold |
| dane | morning-review | 30 7 * * * | recurring | morning-review/SKILL.md | — |
| dane | evening-review | 3 19 * * * | recurring | evening-review/SKILL.md | — |
| dane | weekly-review | 57 7 * * 0 | recurring | weekly-review/SKILL.md | — |
| dane | monthly-tool-maintenance | 0 3 1 * * | recurring | brew upgrade + claude plugin update | — |
| dane | token-efficiency-audit | once | once | inline (Apr 26 ask; likely subsumed by tonight's RFCs) | — |
| dane | test-wed-* / test-thu-* | once (×6) | once | session-test wake/disable/report cycle | — |
| aussie | heartbeat | 2h | recurring | heartbeat/SKILL.md | — |
| aussie | nightly-metrics | 24h | recurring | nightly-metrics/SKILL.md | — |
| aussie | auto-commit | 24h | recurring | local-version-control/SKILL.md | — |
| aussie | check-upstream | 24h | recurring | upstream-sync/SKILL.md | — |
| aussie | catalog-browse | 7d | recurring | catalog-browse/SKILL.md | — |
| aussie | theta-wave | 0 21 * * * | recurring | theta-wave/SKILL.md | — |
| aussie | cron-audit | 7d | recurring | cron-audit/SKILL.md | — |
| aussie | anthropic-watchlist | 0 9 * * 1 | recurring | anthropic-watchlist/SKILL.md | — |
| aussie | usage-rate-guard | 15m | **disabled** | (moved to fast-checker daemon, PR #74) | — |
| aussie | token-comparison-daily | 37 20 * * * | recurring | token-comparison-daily/SKILL.md | — |
| aussie | skill-optimizer | 33 9 * * 1-5 | recurring | skill-optimizer/SKILL.md | **#8 MOVE from Dane** |
| blue | heartbeat | 2h | recurring | heartbeat/SKILL.md | — |
| blue | meld-poll / -day / -night | varies | **disabled** (×3) | meld-ops/SKILL.md hash-poll modes | — |
| blue | morning-report | 30 6 * * * | recurring | pm-morning-scan/SKILL.md | — |
| blue | vendor-followup | 3 9 * * * | recurring | vendor-followup/SKILL.md | — |
| collie | heartbeat | 2h | recurring | heartbeat/SKILL.md | — |
| collie | railway-health-check | 6h | recurring | railway-health/SKILL.md | — |
| collie | daily-framework-upstream-auto-update | daily@06:23 | recurring | framework-upstream-auto-update/SKILL.md | — |
| collie | daily-dane-iq-build-check | daily@08:03 | recurring | dane-iq-build-check/SKILL.md | — |
| collie | nightly-code-review | daily@00:01 | recurring | local-ultrareview/SKILL.md | — |
| collie | monthly-tool-upgrade | monthly@03:00 | recurring | brew upgrade rtk icm | — |
| relay | heartbeat | 4h | recurring | heartbeat/SKILL.md | RETIRED — agent enabled:false (RFC #10 Item N) |

## 3. Per-Agent Breakdown + Ownership Rationale

### dane (orchestrator)
6 recurring + ~7 one-shots. **Rationale:** orchestrator carries fleet-wide rhythms (heartbeat with folded approvals sweep, morning/evening/weekly review tied to David's day, monthly tool maintenance). Test-wed/-thu one-shots are session-test wake/disable cycles for tonight's pacing experiment — ephemeral, will retire once test concludes. `token-efficiency-audit` is an Apr 26 one-shot likely subsumed by tonight's 13-RFC + ship-item batch — review whether to delete.

### aussie (analyst)
9 recurring + 1 disabled (usage-rate-guard, daemon-fold). **Rationale:** Aussie is the audit/research/measurement agent. Crons cluster around analytics (nightly-metrics, token-comparison-daily), framework hygiene (auto-commit, check-upstream, catalog-browse, cron-audit), Anthropic ecosystem watching (anthropic-watchlist), and skill quality (skill-optimizer — moved here from Dane tonight per RFC #8). theta-wave is daily research-cycle initiator. Most crons are 24h or longer; 2h heartbeat is the single high-frequency item.

### blue (specialist, maintenance)
3 active + 3 disabled. **Rationale:** Blue's crons are tightly maintenance-shaped: morning-report at 06:30 (David reads at 07:30), vendor-followup at 09:03 (after morning brief). The 3 disabled meld-poll variants are remnants of an older hash-poll architecture; can be deleted in a future cleanup pass. Blue's actual workload is event-driven (Telegram inbound, PM Gmail watch) — crons are minimal supplementary scaffolding.

### collie (specialist, fleet maintenance)
6 recurring. **Rationale:** Collie owns fleet-maintenance crons that are infrastructure-shaped: railway-health, framework-upstream-auto-update, dane-iq-build-check, nightly-code-review, monthly-tool-upgrade. Collie's domain is keeping the platform healthy while specialists do their domain work.

### relay (RETIRED)
1 recurring (heartbeat). Agent has `enabled: false` per RFC #10 Item N. Cron is dormant — present in config but never fires because the agent isn't started. Safe to delete the cron entry alongside any future full retirement of the relay agent directory.

## 4. Fold History (chronological)

| Date | Action | Cron | From → To | Driver |
|---|---|---|---|---|
| 2026-04-14 | DAEMON-FOLD | usage-rate-guard | Aussie cron → fast-checker daemon | PR #74 |
| 2026-04-29 | FOLD | check-approvals | Dane cron → Dane heartbeat skill (Step 5) | RFC #8 §4.1 |
| 2026-04-29 | MOVE | skill-optimizer-overnight | Dane (daily 03:00) → Aussie (33 9 * * 1-5 weekday) | RFC #8 §4.2 |
| 2026-04-29 | COMPLETE | skill-optimizer move | symlink + default-target enhancement | RFC #8 D move completed: ln -s ../../../dane/.claude/skills/skill-optimizer at aussie/.claude/skills/. Source-of-truth in dane/. SKILL.md updated with `Default Audit Target` section (parses activity log for most-fired skill of last 24h, fallback to env override). Validated end-to-end via 2026-04-29 audit run on heartbeat skill — analysis.md + diff.patch at dane/.claude/skills/skill-optimizer/runs/2026-04-29-heartbeat-aussie/. |

Future moves append here. Pattern: timestamp + action + cron name + from/to + driver-link.

## 5. New-Cron Decision Tree

When adding a new cron, walk this tree:

1. **Is the work time-sensitive (David reads at X, deadline at Y)?**
   - YES → cron with explicit time. Continue to step 2.
   - NO (just "every N hours, check Z") → consider folding into an existing periodic skill instead (heartbeat is the obvious carrier — see RFC #8 §4.1 approvals fold).

2. **Is the work fleet-wide rhythm (David-facing, cross-agent summary)?**
   - YES → owner = **dane** (morning-review, evening-review, weekly-review pattern).
   - NO → continue to step 3.

3. **Is the work analytics / measurement / quality / framework-hygiene?**
   - YES → owner = **aussie** (audits, metrics, upstream sync, catalog browse).
   - NO → continue to step 4.

4. **Is the work platform / infrastructure (Railway, framework updates, code review, brew/tool upgrades)?**
   - YES → owner = **collie** (fleet-maintenance crons).
   - NO → continue to step 5.

5. **Is the work property-management domain (PM melds, vendor coordination, Gmail-driven triage)?**
   - YES → owner = **blue**.
   - NO → unclear; surface to Dane for a routing decision rather than guess.

6. **Cadence vs shift-schedule (RFC #4):** verify the cron's fire time falls inside the owning agent's `shift_schedule` (when implemented). Off-shift fires should fold into the owner's first in-shift cycle, not wake the agent at 03:00 if their shift ends at 21:00.

7. **Off-minute discipline:** pick a non-:00 / non-:30 minute (e.g. 33, 07, 23) per `CronCreate` guidance — avoids fleet-wide synchronized fires.

## 6. TODOs / Followups

- [x] **Collie SessionEnd handoff hook** — shipped 2026-04-29 (Item X). All 4 active agents (Dane, Aussie, Blue, Collie) now have the shared `_shared/scripts/write-handoff.sh` wired as SessionEnd hook entry [1].
- [x] **RR — claude.ai Gmail/Calendar/Drive MCP retirement** — CLOSED BY SS, 2026-04-29 evening. RR action attempted batch retirement of the trio per RFC #9 §3.4 verdict; blocked because `claude mcp remove` cannot operate on harness-injected MCPs (no local config). David called the architectural reversal: retain trio as documented fallback for vendor-diversity / failure-uncorrelation. Aussie integration-roadmap §4 dependency-hardening flag had independently surfaced the same concern. Final classification: Stage 3-RETAINED-AS-FALLBACK (new RFC #16 §4.1 category). See `canonical-and-fallback-registry.md` + `rfc-16-mcp-prototype-to-cli-production.md` §3.5 + §4.1 + `mcp-stage-classification-2026-04-29.md` §3.
- [x] **XX — 6 RFC blocking questions answered** — 2026-04-29 evening. David approved all 6 of Dane's recommendations (D1-D6 in `decisions-log.md`): namespace rename + 1Q shim, separate pip packages, gitignored handoff.md, 9pm Sat Blue cutoff, required `--reason` on force-pending-completion, auto-send completion-checklist messages with Tier-2 David-escalation. Thursday Aussie/Codex execution unblocked across RFC #6, RFC #2, RFC #4, RFC #12, RFC #7. See `decisions-log.md` for full reasoning + reversibility per decision.
- [ ] **Cleanup blue's 3 disabled meld-poll crons** — they're inert config noise from the older hash-poll architecture.
- [ ] **Delete Dane's 6 test-wed/-thu one-shots** once tonight's pacing experiment concludes.
- [ ] **Token-efficiency-audit one-shot** — confirm with David that tonight's RFCs subsumed this Apr 26 ask, then delete.
- [ ] **Mirror Blue skills `threat-history-filter` + `vendor-tech-status-sweep` to noogalabs/ascendops-agent-pack** — both shipped 2026-04-29 (DD + EE). Local Collie session does not have the agent-pack repo cloned. Whoever has the clone (or fresh `gh repo clone noogalabs/ascendops-agent-pack`) should copy the SKILL.md files from `agents/blue/.claude/skills/{threat-history-filter,vendor-tech-status-sweep}/` and PR them to the agent pack. Per `feedback_agent_pack_standing_rule.md`.
- [ ] **RFC #14 PIECE 1 — codex app-server `--add-dir` propagation** — held 2026-04-29 pending David + Aussie verification of the real protocol field name. The current codex plugin uses `codex app-server` (long-running broker), not per-task `codex exec`, so the surgical edit Aussie originally specced does not apply. PIECE 2 (codex-rescue smart-default + log) and PIECE 3 (Mode 1 vs Mode 2 telemetry at turn-completion) shipped today as overrides under `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/`. When PIECE 1 lands, the inferred `--add-dir` paths in codex-rescue.md should plumb into whatever protocol field/exec spawn PIECE 1 ends up using.

## 7. Cross-References

- [RFC #8 — cron→sweep conversions](./rfc-cron-sweep-conversions.md) — fold + move taxonomy + savings analysis.
- [RFC #4 — shift-schedule](./rfc-shift-schedule.md) — when in-shift vs off-shift gates apply to cron firing.
- `dane/.claude/skills/heartbeat/SKILL.md` — now also carries the approvals sweep (§5 Step 5, folded RFC #8 §4.1).

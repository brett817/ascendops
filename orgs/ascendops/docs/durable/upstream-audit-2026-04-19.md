# Upstream PR Audit — 2026-04-19
**Auditor:** Collie | **Source:** `git log --oneline HEAD | head -120`
**Purpose:** Categorize local commits for upstream candidacy

Legend:
- **A** — Upstreamable as-is
- **B** — Upstreamable with cleanup (org-specific refs or local features need scoping)
- **C** — AscendOps-specific / keep local
- **D** — Already filed/merged upstream

---

## Summary by Category

| Category | Count | Description |
|----------|-------|-------------|
| A — Upstreamable as-is | 1 | graphify-out .gitignore untrack |
| B — Upstreamable with cleanup | 5 | gmail_watch feature set + ctx_restart |
| C — Keep local | 6 | Local inits, daily auto-commits, AscendOps-specific templates |
| D — Already upstream | ~108 | Merged PRs, upstream syncs, community templates |

---

## Category B — Priority Upstream PRs

These 5 commits represent two feature clusters that exist only locally.

### Cluster 1: gmail_watch (3 commits)
- `56541f4` — feat(daemon): Gmail watch core implementation in fast-checker
- `77a27dc` — fix(daemon): Gmail watch timestamp persistence + message-ID dedup
- `55661ab` — test(daemon): fast-checker tests for Gmail watch

**What it needs:** `gmail_watch` config type not in upstream types/index.ts. Would add `processed_label_id` and `interval_ms` to `AgentConfig.gmail_watch`. Clean PR — 4-6 files, tests included.
**Status:** Local-only. Not filed.

### Cluster 2: ctx_restart graceful exit (2 commits)
- `982f783` — feat(daemon): proactive context-threshold graceful restart (Signal 3)
- `95f9020` — fix(fast-checker): ctx-restart conditional logic + /exit instruction fix

**What it needs:** Diff against current upstream context watchdog to isolate the delta. The /exit instruction and conditional re-ordering are clean changes. The Signal 3 mechanism may overlap with upstream's own watchdog.
**Status:** Local-only. Not filed.

### Category A (1 commit)
- `f671212` — chore: untrack graphify-out (auto-generated). Trivial .gitignore addition. No review risk.

---

## Full Commit Table

| Hash | Description | Cat | Notes |
|------|-------------|-----|-------|
| 7eb667a | fix(daemon): stagger gap nudges + guard duplicate cron verification (#183) | D | Upstream PR #183 |
| 95f9020 | fix(fast-checker): gmail label dedup + ctx-restart graceful exit | B | Local features — not in upstream |
| 4488d51 | Merge fix/cron-gap-skip-disabled | D | Upstream |
| cf35f9a | fix(daemon): skip type=disabled cron entries | D | Upstream |
| 0c1b809 | Merge fix/output-buffer-log-rotation | D | Upstream |
| 1a4e0c4 | fix(pty): rotate stdout.log at 50 MB | D | Upstream |
| d5cecba | fix(security): bump next + hono (#146) | D | Upstream PR #146 |
| ae1191d | fix(dashboard): reverse-proxy login failures (#144) | D | Upstream PR #144 |
| 0f8117a | fix(cli): goals generate-md mixed-case (#142) | D | Upstream PR #142 |
| 06d0a6c | fix(bus): manage-cycle list filter (#143) | D | Upstream PR #143 |
| 485708a | feat(community): security agent template | D | Community |
| 95c3149 | chore(daily): auto-commit Apr 18 | C | Local daily auto-commit |
| 76b44d5 | Merge PR #164 fix/org-casing | D | Upstream |
| aa4e14c | Merge PR #163 feat/bus-auto-emit | D | Upstream |
| 95531bb | Merge PR #162 fix/graceful-missing-bot-token | D | Upstream |
| d9e2a64 | fix(org): normalize org casing | D | Upstream |
| ac37671 | init | C | Local init |
| 86bc202 | feat(bus): auto-emit activity events | D | Upstream PR #163 |
| 138b492 | init | C | Local init |
| 67d7543 | fix(cli): graceful exit when BOT_TOKEN not configured | D | Upstream |
| 6bf93d6 | Merge PR #114 cron-dedup | D | Upstream |
| 5228004 | Merge PR #131 telegram-conflict-org | D | Upstream |
| 1653dc7 | Merge PR #148 hardcoded-name | D | Upstream |
| 3145c4e | feat(community): local-ultrareview skill | D | Community |
| 6124662 | feat(skills): post-merge npm-audit gate (#147) | D | Upstream |
| 6ecf62e | fix(security): bump next/hono (dup) | D | Upstream |
| ba7f871 | feat(telegram): message_reaction routing (#141) | D | Upstream |
| 93773b2 | fix(daemon): missing cron-state cold-start (#120) | D | Upstream |
| 3a1cfc4 | feat(scripts): setup-hooks.sh + pre-push gate (#121) | D | Upstream |
| ffddd94 | fix(daemon): prevent dead-session resurrection | D | Upstream |
| 0488919 | fix(pr140): ADMIN_USERNAME hardcode | D | Upstream |
| e2265e1 | Merge graceful-missing-bot-token | D | Upstream |
| 747deae | fix(daemon): timeout + maxBuffer to fast-checker | D | Upstream |
| 1051fb9 | fix(cli): graceful exit BOT_TOKEN | D | Upstream |
| 1b53cf5 | Merge upstream/main | D | Sync |
| 90129df | feat(telegram): conversation history in context | D | Upstream |
| 865da1f | fix(dashboard): org filter on page load (#139) | D | Upstream |
| 60a3e07 | fix(hooks): remove hook-extract-facts (#135) | D | Upstream |
| 2ebf66b | feat: agentcard-purchase skill | D | Community |
| 3c34f3d | fix(cli): CLAUDE_CODE_DISABLE_1M_CONTEXT in .env template (#137) | D | Upstream |
| fb8972a | fix(hooks): PreCompact timeouts (#134) | D | Upstream |
| 982f783 | feat(daemon): proactive context-threshold graceful restart | B | Local — not in upstream |
| 82353c1 | fix(org): readdirSync exact-case on macOS | D | Upstream |
| 7f7bc03 | fix(tests): telegram conflict + org case | D | Upstream |
| b72b437 | fix(pr99): M2C1 stuck detector template | D | Upstream |
| baaf46c | fix(pr102): rate-limit-management to community | D | Upstream |
| 10818e7 | fix(pr98): M2C1 plan/act gate template | D | Upstream |
| f6e83d5 | fix(pr97): delegation-matrix to community | D | Upstream |
| e7ef039 | fix(pr96): opencli to community | D | Upstream |
| 847797e | fix(pr95): officecli to community | D | Upstream |
| c0ee728 | fix(pr93): obsidian-log to community | D | Upstream |
| 047c218 | fix(pr92): framework-upstream-auto-update to community | D | Upstream |
| 35b3b6c | feat(scripts): setup-hooks.sh | D | Upstream |
| e612e85 | fix(daemon): cron-state cold-start | D | Upstream |
| adf1896 | fix(hooks): quiet hours + dedup (#109) | D | Upstream |
| 8924501 | fix(env): relax CTX_ORG validation (#117) | D | Upstream |
| ecf8bd8 | feat(task): atomic claim + dependency DAG (#116) | D | Upstream |
| c3a1569 | fix(catalog+dashboard+cli): multi-fix (#115) | D | Upstream |
| 8df124f | fix(daemon): mark-read hint flag | D | Upstream |
| 0bb2eae | Merge feat/per-org-branding logo | D | Upstream |
| 982ff14 | feat: brand initials for sidebar | D | Upstream |
| 387a0f7 | Merge feat/per-org-branding | D | Upstream |
| f671212 | chore: untrack graphify-out | A | File upstream as 1-liner |
| 72022a3 | feat: per-org dashboard branding | D | Upstream |
| 77a27dc | fix(daemon): Gmail watch timestamp + message-ID dedup | B | Local gmail_watch feature |
| 4598045 | fix(daemon): restore scheduleGapDetection | D | Upstream |
| a247b16 | merge: upstream/main 11 commits | D | Sync |
| 19add71 | fix(daemon): adapt fast-checker to check-usage-api | D | Upstream |
| f92f352 | fix(daemon): prevent duplicate crons on restart | D | Upstream |
| a4d552d | feat(templates): propertymeld skill | C | AscendOps-specific |
| 0b4ecec | feat(templates): monday.com skill | C | AscendOps-specific |
| fedbeba | fix(daemon): duplicate crons (dup) | D | Upstream |
| f7a8b0a | fix(daemon): Telegram photo paths (BUG-049) (#108) | D | Upstream |
| 59d186d | fix(bus): auto-notify assignee on create-task (#91) | D | Upstream |
| 7e42f87 | docs(templates): replace Playwright MCP with agent-browser (#64) | D | Upstream |
| c073d56 | fix(task): cross-org lookup update/complete (#61) | D | Upstream |
| 51aa083 | fix(kb): warn-and-skip missing KB config (#60) | D | Upstream |
| 5356b91 | fix(telegram): retry on parse-entity errors (#59) | D | Upstream |
| 02960af | fix(ci): install dashboard deps in test job (#111) | D | Upstream |
| a3002be | feat(dashboard): deliverable outputs + preview (#52) | D | Upstream |
| e9f3a50 | feat(dashboard): Comms Hub (#47) | D | Upstream |
| 2a3ed44 | merge: upstream/main 6 commits | D | Sync |
| f511318 | feat(daemon): cron fire timestamps + gap-detection (#68) | D | Upstream |
| 8d03781 | fix(daemon): replace exec with execFile in watchdog (#55) | D | Upstream |
| 47b5cc9 | daily: dashboard design + graphify report | C | Local daily |
| 37719a5 | feat(approvals): Telegram inline-button approvals (#63) | D | Upstream |
| d0c2ead | fix(daemon): classify PM2 shutdown as planned stop (#57) | D | Upstream |
| a925feb | fix(pty): redact JWT tokens from OutputBuffer (#56) | D | Upstream |
| 115df7b | feat(templates): opencli skill | D | Community |
| f10d00f | feat(templates): officecli skill | D | Community |
| dc5080b | feat(templates): graphify skill | D | Community |
| d78112b | feat(templates): obsidian-log skill | D | Community |
| 3019317 | fix(telegram): fetch timeout in poller (#86) | D | Upstream |
| 01a6da8 | test(slack): Slack watch tests + bot message filter | D | Upstream |
| c748f05 | feat(types): Slack TeamMember + trust hierarchy | D | Upstream |
| 4627383 | feat(slack): send-slack command + fast-checker polling | D | Upstream |
| 9fb882f | Merge feat/m2c1-stuck-detector | D | Upstream |
| b794965 | feat(templates): M2C1 stuck detector | D | Upstream |
| 5427917 | feat(templates): M2C1 Plan/Act gate | D | Upstream |
| 55661ab | test(daemon): fast-checker tests for gmail_watch | B | Ship with gmail_watch PR |
| 197df59 | feat(templates): delegation-matrix three Codex modes | D | Upstream |
| 27c108b | feat(templates): Codex optional in delegation-matrix | D | Upstream |
| bb41121 | feat(templates): add delegation-matrix skill | D | Upstream |
| 0021875 | Merge revert/fast-checker-heartbeat | D | Upstream |
| a0c4b43 | Revert fast-checker shell heartbeat | D | Upstream |
| 9b9791f | Merge feat/fast-checker-heartbeat | D | Upstream |
| 91d2813 | feat(daemon): shell-efficient heartbeat | D | Upstream |
| 48b4890 | Merge feat/fast-checker-gmail-watch | B | gmail_watch merge commit |
| 56541f4 | feat(daemon): Gmail watch in fast-checker | B | Core gmail_watch — not in upstream |
| a52f7ab | Merge feat/fast-checker-usage-guard | D | Upstream |
| 795d7fd | feat(daemon): usage rate-limit guard in fast-checker | D | Upstream |
| b442d22 | Merge feat/framework-upstream-auto-update-skill | D | Upstream |
| 98ddf51 | feat(skills): framework-upstream-auto-update skill | D | Upstream |
| e0012ba | Merge feat/rate-limit-protocol | D | Upstream |
| 3199ea2 | feat(skills): rate limit management protocol | D | Upstream |
| 6b20146 | feat(daemon): context-exhaustion + frozen-stdout watchdog | D | Upstream |

---

## Recommended Filing Order

1. **Now:** `f671212` — graphify-out .gitignore. 1 file, trivial, no risk.
2. **Next sprint:** gmail_watch cluster (`56541f4` + `77a27dc` + `55661ab`) as one isolated PR. Branch off grandamenium/main, 4-6 files, tests included.
3. **After gmail_watch lands:** ctx_restart cluster (`982f783` + `95f9020`). Diff against upstream watchdog first to confirm delta is clean.

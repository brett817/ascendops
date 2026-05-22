# Fork ↔ Upstream Equivalence Mappings (FALLBACK ONLY)

> **STATUS: fallback record, NOT the default alignment path.** Locked 2026-05-21 by David.
>
> **Default alignment path is git-history-based:** when a fork commit is functionally equivalent to an upstream commit, do `git revert <fork-sha> && git cherry-pick <upstream-sha>` and ship the alignment as a small PR. This bakes the alignment into git history, which is bulletproof. Future fork-syncs auto-detect the upstream SHA is already applied.
>
> **This file exists for the rare case** where the revert path is unsafe — e.g. the fork commit has downstream dependencies (subsequent commits that build on it) that would also need to be reverted-and-re-cherry-picked. In those cases, document the equivalence here and accept the divergence.

Tracks noogalabs/ascendops commits that are functionally equivalent to grandamenium/cortextos upstream commits, even when the local SHA differs from the upstream SHA. Goal: future fork-syncs can identify "already applied" changes by mapping rather than patch-id-only matching when revert-and-cherry-pick alignment was not feasible.

**Maintainer notes:** Only add entries here when the default git-history alignment is impractical. If a fork commit can be cleanly reverted + re-cherry-picked from upstream, prefer that path over a doc entry.

## Format

| Fork SHA | Upstream SHA | Relationship | Documented | Topic |
|----------|--------------|--------------|------------|-------|
| `<fork>` | `<upstream>` | cherry-pick-trailer / parallel-impl / patch-id-equivalent / ... | `YYYY-MM-DD` | one-line description |

---

## Mappings

| Fork SHA | Upstream SHA | Relationship | Documented | Topic |
|----------|--------------|--------------|------------|-------|
| ~~`88cf32a`~~ → `7bd2b53` | `8a82502` | aligned via revert+cherry-pick (PR #42) | 2026-05-21 | fix(daemon): thread --model through spawn-worker to AgentPTY (closes upstream #283) — RESOLVED via default git-history alignment path, no longer a "mapping" |
| `e326d40` | `009191b` | cherry-pick (trailer-documented at fork commit) | 2026-05-21 | fix(bus): ping requesting agent's bot on createApproval (closes 50h+ silent-stall) — trailer makes mapping discoverable by future syncs; chose not to revert+re-cherry-pick because the trailer already aligns it |
| `f0ac3f3` | `e282d9f` | parallel-impl, fallback path (revert unsafe) | 2026-05-21 | fix(hooks): bus fan-out reachable when Telegram creds absent (closes #317) — diff byte-identical, but fork commit `562edd8` ('cherry-pick hooks crash notify') subsequently touched `src/hooks/hook-crash-alert.ts` on top of f0ac3f3's hoist. A revert would conflict with 562edd8's interleaved changes, requiring a coordinated re-roll of BOTH commits. Cost exceeds the empty-cherry-pick / mapping-file alternative. **WHY-NOT-REVERT:** downstream-dependent commit 562edd8 makes the revert unsafe per fallback rule. |

---

## Discovery procedure

When a new equivalence is found during a fork-sync batch:

1. Verify via `git diff <fork_sha> <upstream_sha>` that the patch bodies are functionally equivalent (use `git patch-id` for exact byte-level matching; for parallel-impl cases, eyeball the diff for semantic equivalence).
2. Add a row to the Mappings table above with the new pair.
3. If the equivalence is a literal cherry-pick + the trailer is present at the fork commit, mark `cherry-pick-trailer`. Future syncs auto-detect this case via the trailer.
4. If the equivalence is parallel-implementation (no trailer, but same change shipped independently), mark `parallel-impl, patch-bodies byte-identical` (or note any subtle differences). This is the case that NEEDS documentation here because future syncs can't auto-detect it.

## Why this exists

Fleet rule locked 2026-05-21 by David: default to ALIGN with upstream when upstream has equivalent changes; divergence requires named justification. The straightforward alignment path is to cherry-pick the upstream version. When the fork already has a functionally-identical commit, history-rewriting (revert + cherry-pick) is net-zero churn — this file is the alignment record instead.

## Related rules

- `feedback_upstream_vs_fork_patch_decision.md` (ICM 01KS5PSPSFBNHF7RARKV1K5G26): when to fix in fork vs upstream
- `feedback_classify_first_pattern.md` (ICM 01KS5P90MQ0ZF87XJRRPJY8J33): pre-cherry-pick classification protocol

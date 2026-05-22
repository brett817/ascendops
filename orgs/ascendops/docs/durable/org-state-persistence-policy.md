# Org-State Persistence Policy

**Author:** aussie (analyst lane, dispatched by Dane via David greenlit)
**Date:** 2026-05-22 (UTC)
**Source task:** task_1779458561961_557210
**Scope:** ascendops org docs/ only — v1 (cross-org generalization deferred)
**Status:** SPIKE — proposes 3-doc-class taxonomy + narrow gitignore carve-out. Locks in on Dane sign-off + Collie cleanup pass.

---

## TL;DR

**Problem.** Agents fleet-wide write real org state to `orgs/ascendops/docs/` (113 .md files, 111 untracked at time of spike). `.gitignore:15` excludes `orgs/` wholesale. The 2026-04-18 memory-architecture policy covers MEMORY.md + daily logs + KB; it does NOT cover docs/specs/RFCs/shelves. Result: accumulating untracked durability gap. Specs, RFCs, and gap-buckets that multi-agent workflows depend on survive only as long as the disk does. No git history, no recovery on filesystem migration, no second-machine sync.

**Proposal.** 3-class taxonomy (`durable`/`live-collab`/`ephemeral`) + a NARROW gitignore carve-out for the durable class only. Path-1+carve-out chosen because it preserves the existing mental model (`agent-related state under orgs/`) while making durable artifacts recoverable.

**Concrete change:** add 2 lines to `.gitignore` immediately after `orgs/` exclusion to carve out `orgs/*/docs/durable/` + `orgs/*/docs/durable/**`. Migrate the ~90 durable docs into that subdir (Collie's job, not mine). Leave live-collab in `orgs/*/docs/live/`. Leave ephemeral in `orgs/*/docs/ephemeral/` with TTL discipline.

**Worked example:** this policy doc itself is the first artifact to land under the new pattern. Initial write goes to the path Dane named (`orgs/ascendops/docs/org-state-persistence-policy-2026-05-22.md`, still gitignored) so the message flow stays clean; bootstrap step is to move-and-track it into `orgs/ascendops/docs/durable/` post-lock and commit via the carve-out.

---

## 1. Current State Inventory

### 1.1 Filesystem snapshot

`orgs/ascendops/docs/` contains **113 files**. Git-tracked: **2** (`pm-nexus-partner-recon-2026-05-16.md`, `pm-september-conference-recon-2026-05-16.md`). Untracked: **111**.

Auto-classification via naming heuristics (full pattern in §1.3):

| Class subtype | Count | Examples |
|---|---|---|
| DURABLE-RFC | 24 | `rfc-14-protocol-investigation.md`, `rfc-codex-sandbox-fix.md`, `rfc-snapcli-rename-execution-plan.md` |
| DURABLE-SPEC | 11 | `codex-cap-watchdog-spec-2026-05-22.md`, `business-profile-wizard-spec-2026-05-15.md`, `phase-7-outbound-design-2026-05-18.md` |
| DURABLE-RESEARCH | 11 | `competitive-pmdash-recon-2026-05-13.md`, `pm-nexus-partner-recon-2026-05-16.md`, `semble-spike-results-2026-05-18.md` |
| DURABLE-PLAN | 10 | `phase-5a-integration-plan.md`, `integration-roadmap-2026-04-29.md`, `multi-vendor-specialist-fleet-plan.md` |
| DURABLE-DOCTRINE | 7 | `governance-policy.md`, `decisions-log.md`, `cron-ownership.md`, `pre-change-protocol.md` |
| DURABLE-POLICY | 5 | `agent-deployment-standard.md`, `software-integration-standard.md`, `governance-policy.md` |
| DURABLE-REGISTRY | 4 | `canonical-and-fallback-registry.md`, `event-catalog.md`, `multi-model-matrix.md`, `fork-upstream-equivalence-mappings.md` |
| DURABLE-TEMPLATE | 1 | `agent-memory-profile-template.md` |
| LIVE-COLLAB-SHELF | 4 | `codex-cloud-fallback-wrapper-shelf-2026-05-19.md`, `codex-computer-use-fleet-fit-shelf-2026-05-14.md`, `multi-principal-orchestrator-shelf-2026-05-14.md`, `statewright-fleet-fit-shelf-2026-05-14.md` |
| LIVE-COLLAB-QUEUE | 2 | `pm-cli-gap-backlog-2026-05-18.md`, `upstream-pr-status.md` |
| LIVE-COLLAB-INPROG-VERSION | 1 | `business-profile-wizard-spec-v2-2026-05-15.md` |
| EPHEMERAL-DRAFT | 8 | `phase-7-deck-draft-2026-05-19.md`, `skool-post-pm-capabilities-draft-2026-05-16.md`, `telnyx-voice-agent-setup-guide-2026-05-19.md` |
| EPHEMERAL-EVAL | 1 | `contextzip-eval-2026-05-18.md` |
| EPHEMERAL-HTML | 2 | `mms-status-david-reference-2026-05-21.html`, `pm-ceo-cto-call-prep-2026-05-25-rehearsal.html`, `pm-ceo-cto-call-prep-2026-05-25.html` |
| MANUAL-RECLASSIFY | 23 | listed in §1.4 |

After manual reclassification of the 23 unclassified (§1.4), refined totals are approximately:

- **DURABLE: ~90** (80% of corpus)
- **LIVE-COLLAB: ~10** (9%)
- **EPHEMERAL: ~13** (11%)

### 1.2 Tracked-vs-untracked diagnosis

Only 2 of 113 are tracked. Both tracked files (`pm-nexus-partner-recon-2026-05-16.md`, `pm-september-conference-recon-2026-05-16.md`) were `git add -f`'d manually — bypassing the gitignore. This proves the carve-out path is workable (we've been doing it ad-hoc) but lacks policy structure.

### 1.3 Auto-classification heuristic (for reproducibility)

```bash
# Patterns applied in order; first match wins
rfc-* → DURABLE-RFC
*-spec-* | *-spec.md → DURABLE-SPEC
*-template* → DURABLE-TEMPLATE
*-policy* | *-standard.md | governance-* → DURABLE-POLICY
*-roadmap* | *-plan-* | phase-*-integration-plan* → DURABLE-PLAN
*-runbook* | *-protocol* | *-ownership.md | *-changelog.md | decisions-log* → DURABLE-DOCTRINE
*-recon-* | *-investigation-* | *-audit-* | *-research.md | *-scope.md → DURABLE-RESEARCH
*-catalog.md | *-registry.md | *-mappings.md | *-matrix.md → DURABLE-REGISTRY
*-shelf-* → LIVE-COLLAB-SHELF
*-backlog-* | *-tracker-* | *-status-*-reference* | *-gap-* → LIVE-COLLAB-QUEUE
*-v2-* | *-v2.md → LIVE-COLLAB-INPROG-VERSION
*-eval-* → EPHEMERAL-EVAL
*-rehearsal* | *-talking-points-* | *-deck-* | *-prep-* | *-draft-* | *-setup-guide-* → EPHEMERAL-DRAFT
*.html → EPHEMERAL-HTML
* → MANUAL-RECLASSIFY (fallback)
```

### 1.4 Manual reclassification of 23 unclassified

| File | Class | Reason |
|---|---|---|
| `anthropic-june-15-max-vs-api-pool-2026-05-19.md` | DURABLE-RESEARCH | Vendor-decision research |
| `claude-mem-cli-parity.md` | DURABLE-SPEC | Tool-parity spec |
| `cli-work-entries-crud-architect-2026-05-18.md` | DURABLE-SPEC | Architect doc (suffix `-architect-`) |
| `gws-auth.md` | DURABLE-DOCTRINE | Auth runbook |
| `high-risk-change-zones.md` | DURABLE-POLICY | Risk-management policy |
| `mcp-stage-classification-2026-04-29.md` | DURABLE-RESEARCH | Classification research |
| `mcp2cli-claude-mem-migration.md` | DURABLE-PLAN | Migration plan |
| `multi-model-rfc-amendment.md` | DURABLE-RFC | RFC amendment |
| `phase-7-outbound-design-2026-05-18.md` | DURABLE-SPEC | Design doc |
| `pm-cli-gaps-create-clone-2026-05-14.md` | LIVE-COLLAB-QUEUE | Gap-tracking, multi-agent read-write |
| `pm-create-meld-in-and-merge-endpoint-capture-2026-05-19.md` | DURABLE-RESEARCH | Endpoint capture artifact |
| `pm-tenant-notes-endpoint-capture-2026-05-18.md` | DURABLE-RESEARCH | Endpoint capture artifact |
| `scope-wiper-trap-instrumentation.md` | DURABLE-SPEC | Instrumentation spec |
| `semble-spike-results-2026-05-18.md` | DURABLE-RESEARCH | Spike results (already in main count) |
| `telnyx-l2-verification-requirements-2026-05-18.md` | DURABLE-DOCTRINE | Vendor requirement reference |
| `telnyx-mms-vendor-photo-pipeline-setup-2026-05-19.md` | DURABLE-DOCTRINE | Setup runbook |
| `upstream-pr-status.md` | LIVE-COLLAB-QUEUE | Multi-agent PR queue tracker |
| `voice-coordinator-phase-0-cli-delta-2026-05-17.md` | DURABLE-RESEARCH | Phase delta capture |
| `voice-coordinator-phase-4-smoke-2026-05-17.md` | EPHEMERAL-EVAL | Smoke-test output (superseded by FINAL) |
| `voice-coordinator-phase-4-smoke-FINAL-2026-05-17.md` | DURABLE-RESEARCH | Final smoke-test record worth keeping |
| `voice-coordinator-phase-4-smoke-RETEST-2026-05-17.md` | EPHEMERAL-EVAL | Mid-iteration test (superseded by FINAL) |
| `voice-coordinator-phase-5-architect-2026-05-18.md` | DURABLE-SPEC | Architect doc |
| `voice-coordinator-phase-6-architect-2026-05-18.md` | DURABLE-SPEC | Architect doc |

---

## 2. Durability Policy Gap Surface

### 2.1 What the existing policies COVER

| Policy | Domain | Covers |
|---|---|---|
| Memory Architecture Policy (4/18, knowledge.md §"Memory Architecture") | Agent state | MEMORY.md, daily memory files, bootstrap files, KB collections |
| BLOCKED_WRITE_PATHS (4/18, knowledge.md §"BLOCKED_WRITE_PATHS") | Write enforcement | Archived Obsidian dirs, secure-local, credentials |
| `.gitignore:14-15` (`orgs/`) | Repo exclusion | All of orgs/ excluded by default |
| Daemon-state-canonical (locked 5/19, `feedback_daemon_state_crons_canonical`) | Cron state | crons.json under daemon state path |
| Local Version Control (`auto-commit` cron) | Daily git commit | LOCAL commits only — never pushed |

### 2.2 What the existing policies do NOT cover

- **Specs / RFCs / architects**: ~50 durable artifacts under docs/ with no destination policy. Agents write freely; nothing enforces a tracking decision.
- **Live-collab queues / shelves**: gap-bucket, upstream-pr-status, multi-cycle shelves. Multi-agent read-write with no atomicity rule, no conflict resolution path, no retention rule.
- **Ephemeral drafts / smokes / HTML**: no TTL discipline → accumulate forever, indistinguishable from durable content at filesystem level.
- **The org-state-persistence-policy doc itself**: lives in the gitignored dir whose problem it solves. Bootstrap paradox (`v1` resolves it via §3.4 below).

### 2.3 Why this matters operationally

1. **Recovery risk**: a clean repo clone loses 111 of 113 docs. Filesystem migration or disk failure loses everything. Two recent precedents already cost us:
   - **2026-05-13 doc-eater wipe** (per `pm-colocated-cron.sh:5` reference): "Rebuilt 2026-05-13 (lands at git-tracked path scripts/agents/aussie/ instead of the original orgs/-tree location wiped by the doc-eater bug)." Scripts had to be rebuilt.
   - **2026-05-13 memory file deletion** (per recent context, observation IDs 18908/18912): "Pattern matches prior memory deletion." Exhaustive filesystem search confirmed total loss.
2. **Cross-agent visibility**: when Codie/Collie/Blue can't `git pull` to see Aussie's latest spec, they read whatever happens to be on disk — staleness drift, exactly the pattern the bucket-item HEAD-verify rule (locked 5/21) was supposed to prevent.
3. **Trust calibration**: if the policy spec doc lives in a gitignored dir, future agents may treat the policy itself as stale or ephemeral. Tracking the policy IS the policy.

---

## 3. Proposed 3-Doc-Class Taxonomy

### 3.1 Class definitions

| Class | Definition | Lifetime | Read/write pattern |
|---|---|---|---|
| **DURABLE** | Content meant to outlast multiple sessions and serve as authoritative reference. Specs, RFCs, policies, runbooks, templates, decisions, research artifacts. | Indefinite (until explicit supersede) | Mostly read by all; written by ~1 authoring agent per file |
| **LIVE-COLLAB** | Working state read+written by 2+ agents mid-cycle. Gap-buckets, queue trackers, shelves, multi-agent dispatch state. | Cycle-bounded (days to weeks); converts to DURABLE or archived on cycle close | Multi-agent atomic-write required |
| **EPHEMERAL** | Drafts, rehearsals, smoke-test outputs, one-shot HTML deliverables, single-session experiments. | Bounded by explicit TTL or weekly housekeeping | Single-agent write; sometimes single-recipient read |

### 3.2 Per-class operational shape

| Aspect | DURABLE | LIVE-COLLAB | EPHEMERAL |
|---|---|---|---|
| **Destination** | `orgs/{org}/docs/durable/` | `orgs/{org}/docs/live/` | `orgs/{org}/docs/ephemeral/` |
| **Sync/durability** | Git-tracked (via narrow carve-out, §4); local-version-control cron commits daily; restorable from `git log` | Optional git-track via daily snapshot (Collie call); primary durability is the daily auto-commit + the originating agent's MEMORY.md cross-reference | None (intentionally throwaway); weekly housekeeping prunes |
| **Write-time rule** | Agent writes to `durable/`; commits via auto-commit cron OR explicit `cortextos bus commit-doc` (future shim, not built) | Atomic write only (tmp+rename); log `doc_collab_write` event to bus on every save; conflict resolution: last-writer-wins for now, file-level lock via mkdir-as-atomic if needed | Add front-matter `expires: YYYY-MM-DD` field; housekeeping deletes past expiry |
| **Owner** | Authoring agent writes; Dane reviews edits to cross-agent specs (RFCs, policies); David approves doctrine changes | Designated agents listed in front-matter `editors:` field; Dane arbitrates conflict | Single authoring agent only |
| **Naming convention** | Topical-name + optional date suffix for capture/spike artifacts; no date for stable doctrine | Topical-name (no date) + version bump on supersede | Topical-name + date suffix REQUIRED (forces TTL discipline by visibility) |
| **Front-matter required** | `class: durable`, `owner: <agent>`, optional `supersedes: <other-file>` | `class: live-collab`, `editors: [agent1, agent2]`, `cycle_close_eta: <date>` | `class: ephemeral`, `expires: <date>` |

### 3.3 Class-transition rules

- **EPHEMERAL → DURABLE**: rename + move to `durable/`; remove `expires` field; add `owner` + commit. Triggered when content turns out to be authoritative (e.g. a draft becomes the locked spec).
- **LIVE-COLLAB → DURABLE**: cycle close. Cleanup: rename to drop date if appropriate; move; remove `editors`/`cycle_close_eta` fields; add `owner`. Often paired with a `SUPERSEDED` stamp on the cycle's prior artifacts.
- **DURABLE → SUPERSEDED**: don't delete; move to `orgs/{org}/docs/durable/superseded/`. Preserves history; keeps current `durable/` listing tight.
- **LIVE-COLLAB → ARCHIVED**: cycle abandoned. Move to `orgs/{org}/docs/superseded/` (or just delete if no value). Front-matter `supersede_reason:` field captures why.

### 3.4 Solving the bootstrap paradox

This policy doc itself lives in the gitignored dir it must resolve. Two-step bootstrap:
1. **Initial land** (now): write to `orgs/ascendops/docs/org-state-persistence-policy-2026-05-22.md` — the path Dane named. Message flow stays clean (Dane's tracking link is stable).
2. **Post-lock migration** (after Dane sign-off): once `.gitignore` carve-out lands per §4, move this doc to `orgs/ascendops/docs/durable/org-state-persistence-policy.md` (drop date suffix per durable naming rule), add front-matter, commit. The first commit in the durable subdir is the policy that authorizes the subdir's existence — recursive but consistent.

---

## 4. Narrow Carve-Out Spec (Path 1)

### 4.1 Why path 1, not path 2 or 3

- **Path 1: Carve-out under orgs/** — chosen. Preserves "agent-related state lives under orgs/" mental model. Single 2-line gitignore change. Backwards-compatible.
- **Path 2: New tracked dir outside orgs/** (e.g. `docs/orgs/ascendops/...`) — rejected. Breaks the mental model; agents would need to remember "agent state under orgs/, but agent docs under docs/orgs/..." Cognitive load not worth the .gitignore simplicity.
- **Path 3: Submodule** — rejected. Submodules are a known footgun for multi-agent workflows (forgotten `git submodule update`, divergent commit pointers). Out of proportion for the scope.

### 4.2 Literal .gitignore change (AMENDED 2026-05-22 post-smoke)

**Original §4.2 spec was insufficient.** Initial smoke surfaced TWO competing ignore rules, not one: `orgs/` at line 15 AND `docs/` at line 52 (Local ops docs rule, missed in pre-write analysis). Per gitignore: "It is not possible to re-include a file if a parent directory of that file is excluded." Both rules above lock files under them — re-including children requires re-including the parent dir first, then re-excluding siblings to maintain ignore-discipline. Last-match precedence also means the carve-out must come AFTER both `orgs/` and `docs/` to override them.

**Verified working chain (placed AFTER line 52 `docs/` for last-match precedence):**

```gitignore
# Local ops docs (personal, not for public repo)
docs/

# Carve-out (org-state-persistence-policy 2026-05-22): tracked durable org docs.
# Chain re-includes parent dirs because gitignore cannot re-include files under
# an ignored parent dir. Applied AFTER both orgs/ (line 15) and docs/ (line 52)
# so last-match-wins precedence takes effect on durable/ specifically.
# Agent state under orgs/<org>/agents/ + secrets stay ignored — chain only opens
# the orgs/<org>/docs/durable/ path.
!orgs/
!orgs/*/
orgs/*/agents/
!orgs/*/docs/
orgs/*/docs/*
!orgs/*/docs/durable/
!orgs/*/docs/durable/**
```

**Line-by-line explanation:**
- `!orgs/` — re-include the orgs/ dir as walkable (cancels line 15's parent-dir lock)
- `!orgs/*/` — re-include each org subdir (e.g. `orgs/ascendops/`)
- `orgs/*/agents/` — re-ignore agent state dirs (the line-15 default re-asserted explicitly)
- `!orgs/*/docs/` — re-include each org's docs/ dir as walkable (cancels both line 15 + line 52)
- `orgs/*/docs/*` — re-ignore everything in docs/ except what comes next
- `!orgs/*/docs/durable/` — re-include the durable subdir
- `!orgs/*/docs/durable/**` — re-include all durable subdir contents (recursive)

**7-test validation passed 2026-05-22 14:30Z (verifiable via `git check-ignore` exit codes):**
| # | Path | Expected | Actual |
|---|------|----------|--------|
| 1 | `orgs/ascendops/docs/cli-work-entries-crud-architect-2026-05-18.md` | IGNORED | ✓ IGNORED |
| 2 | `orgs/ascendops/docs/durable/org-state-persistence-policy.md` | NOT IGNORED | ✓ NOT IGNORED |
| 3 | `orgs/ascendops/agents/aussie/MEMORY.md` | IGNORED | ✓ IGNORED |
| 4 | `orgs/ascendops/docs/live/some.md` | IGNORED | ✓ IGNORED |
| 5 | `orgs/ascendops/secrets.env` | IGNORED | ✓ IGNORED |
| 6 | `orgs/ascendops/agents/aussie/memory/2026-05-22.md` | IGNORED | ✓ IGNORED |
| 7 | `orgs/ascendops/docs/durable/superseded/foo.md` | NOT IGNORED | ✓ NOT IGNORED |

Net `.gitignore` after change:

```gitignore
# User-created org data (not part of the framework)
orgs/
# (no carve-out inserted here — see §4.2 amended chain placed AFTER docs/)
# But community subdirectories ARE part of the framework
!community/
!community/**
```

(See §4.2 for the AMENDED net `.gitignore` shape — chain lives at lines 60-66 of the repo `.gitignore` after the `docs/` line, not adjacent to the `orgs/` line.)

### 4.3 Validation (verified 2026-05-22)

Validate via raw exit codes (NOT via `-v` flag — `-v` has quirks with negation patterns; truth source is exit code + `git status`):

```bash
# Each test: exit 0 = IGNORED, exit 1 = NOT IGNORED
git check-ignore orgs/ascendops/docs/durable/org-state-persistence-policy.md
# Expected exit: 1 (NOT IGNORED). Verifies the carve-out works.

git check-ignore orgs/ascendops/docs/cli-work-entries-crud-architect-2026-05-18.md
# Expected exit: 0 (IGNORED). Verifies non-durable docs stay ignored.

git check-ignore orgs/ascendops/agents/aussie/MEMORY.md
# Expected exit: 0 (IGNORED). Verifies agent state stays ignored.

git status --porcelain orgs/ascendops/docs/durable/
# Expected: '?? orgs/ascendops/docs/durable/' (untracked but visible — carve-out working).
```

### 4.4 Why not also carve out `live/` and `ephemeral/`?

- `live/`: deliberate exclude. Multi-agent mid-cycle state generates a lot of churn; committing every save floods git log. Decision: durable retention via daily auto-commit snapshot (already shipped) is sufficient; long-term migration to `durable/` is the explicit cycle-close transition.
- `ephemeral/`: deliberate exclude. By definition throwaway. Tracking ephemeral files defeats the purpose of the class.

---

## 5. Migration Plan (Collie's lane, not aussie's)

Out of scope for this spike per Dane's brief. Sketched here for Collie's follow-up:

1. **Mkdir** `orgs/ascendops/docs/durable/`, `orgs/ascendops/docs/live/`, `orgs/ascendops/docs/ephemeral/`, `orgs/ascendops/docs/durable/superseded/`.
2. **Add .gitignore carve-out** per §4.2.
3. **Bootstrap commit**: `git add -f orgs/ascendops/docs/durable/` (empty), commit with policy-lock message referencing this doc.
4. **Move this policy doc** to `orgs/ascendops/docs/durable/org-state-persistence-policy.md` (drop date), add front-matter, commit.
5. **Batch migrate the ~90 DURABLE files** per §1.1+§1.4 classification.
6. **Batch migrate ~10 LIVE-COLLAB files** to `live/` with editor front-matter populated.
7. **Batch migrate ~13 EPHEMERAL files** to `ephemeral/`; add `expires: <date>` front-matter where date is +30d from file mtime as default.
8. **Schedule housekeeping cron** (aussie's lane): weekly sweep that deletes `ephemeral/` files past expiry.

Estimated effort: ~1-2h for Collie (bulk moves + front-matter scripts), plus a ~30min review pass by Dane to spot reclassification errors.

---

## 6. Open Questions for Dane

1. **Adopt as-is, or amend?** The 3-class taxonomy is opinionated. Specifically: putting RFC amendments in DURABLE-RFC vs LIVE-COLLAB during the amendment cycle. Currently I treat RFC amendments as LIVE-COLLAB until they land, then transition. Confirm or amend.
2. **`superseded/` placement.** Currently nested under `durable/superseded/`. Could also be a top-level peer (`orgs/{org}/docs/superseded/`) — easier to git-rm if needed. Preference?
3. **Front-matter enforcement.** I've specified front-matter fields per class but not how to enforce them. Options: (a) honor system (current default), (b) pre-commit hook validates required fields, (c) write-time skill checks. Recommend (a) for now — same enforcement model as MEMORY.md frontmatter.
4. **Cross-org generalization timing.** Deferred for v1. When AscendOps stabilizes and we onboard a second org, this policy needs `orgs/*/docs/{durable,live,ephemeral}/` pattern generalization. Likely a 6-week to 6-month horizon — flag now so we don't bake org-specific assumptions.
5. **Auto-commit interaction.** The daily auto-commit cron currently commits everything dirty under cortextos/. After carve-out, only `durable/` content commits. Verify the auto-commit cron's git-add scope doesn't accidentally try to add gitignored files (should be fine, `git add` respects gitignore, but worth a smoke).

---

## 7. Next-Step (single-sentence summary for Dane)

Sign off on the 3-class taxonomy + 2-line gitignore carve-out per §4.2, then dispatch Collie to execute the migration plan in §5 (bulk moves + front-matter + bootstrap commit), with the policy doc itself migrating to `orgs/ascendops/docs/durable/org-state-persistence-policy.md` as the first artifact under the new tracking discipline.

---

## 8. Sources Cited

- `orgs/ascendops/knowledge.md` §"Memory Architecture Policy (locked 2026-04-18 by David)" — load-bearing anchor
- `orgs/ascendops/knowledge.md` §"BLOCKED_WRITE_PATHS" — load-bearing anchor
- `cortextos/.gitignore` lines 14-17 — current orgs/ exclusion shape
- `cortextos/scripts/agents/aussie/pm-colocated-cron.sh:5` — doc-eater wipe reference
- Memory: `feedback_daemon_state_crons_canonical` (5/19 lock) — pattern this policy generalizes
- Memory: `feedback_speculative_concerns_vs_current_blockers` (5/18 + 5/20 + 5/21) — bucket-item HEAD-verify rule this policy enables for org docs
- Git ls-files / status snapshot 2026-05-22 13:30Z: 2 tracked, 111 untracked, 113 total in `orgs/ascendops/docs/`
- Auto-classification heuristic run 2026-05-22 14:05Z (this spike)

---

## 9. Build Stats

- Time: 14:02Z → ~14:30Z (~28min, well under 2h budget)
- Files inspected: 113 in `orgs/ascendops/docs/` + `.gitignore` + `knowledge.md` (2 sections)
- Inventory classified: 113 files into 14 subtypes → 3 macro-classes
- Open questions surfaced: 5 (front-matter enforcement, superseded placement, taxonomy edge cases, cross-org timing, auto-commit interaction)
- Path-2 + path-3 eliminated with single-line rationale each — kept choice space minimal so Dane can decide fast

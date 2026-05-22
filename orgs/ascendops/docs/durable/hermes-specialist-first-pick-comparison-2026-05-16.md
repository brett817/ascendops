# Hermes Specialist — First Pick Comparison

**Author:** Collie
**Date:** 2026-05-16
**Status:** Decision-prep for David. Both options share Hermes runtime (`runtime: "hermes"` in config.json); they differ only in backend (`~/.hermes/config.yaml` provider) and role shape.
**Decision frame:** Which doer-shaped specialist solves more friction in the next 2 weeks given current queue + cap shape?

---

## Side-by-side

| | **codex-coder** | **scout** |
|---|---|---|
| **Role** | Bulk-implementation doer | Long-context recon doer |
| **Backend** | Codex (GPT-5.5 via ChatGPT subscription) | Gemini Pro/Max (1M context window) |
| **Called by** | collie / codie when cap pressure hits during code writes | aussie / blue when a deep-read job (HAR, PDF, lease, ticket history) exceeds planner context |
| **First use case** | Ship the 4 PM endpoint follow-ups deferred from PR #5 (`vendor_upload_file` 3-step S3 presign, `edit_meld`, `create_meld_at_unit`, `swap_vendor`) | Parse the 4 PM capture HAR files end-to-end (currently sampled by jq queries only) — surface every mutating endpoint not in the bundle |
| **Cost shape** | Free via existing ChatGPT subscription | Upgrade Gemini to Pro/Max ($X/mo — David's call) |
| **Setup steps** | 1. `pip install hermes-agent`<br>2. `~/.hermes/config.yaml` with `provider: openai-codex`<br>3. `cortextos add-agent codex-coder` with `runtime: "hermes"` in config.json<br>4. Standard onboarding flow<br>5. Verify Codex OAuth via Hermes adapter | 1. `pip install hermes-agent`<br>2. `~/.hermes/config.yaml` with `provider: google-gemini-cli`<br>3. `cortextos add-agent scout` with `runtime: "hermes"` in config.json<br>4. Standard onboarding<br>5. Upgrade Gemini plan + verify OAuth |
| **Estimated time to first useful dispatch** | ~45-60 min (no plan upgrade needed) | ~60-90 min (plus David's Gemini upgrade purchase) |
| **Demand signal — immediate** | HIGH. 4 deferred PM endpoints + Codex sandbox `--writable-root` workflow already burned 5 min on PR #5 prep | MEDIUM. Used HAR captures heavily last 48h (PM endpoint ship), but jq queries got us through |
| **Demand signal — recurring** | HIGH. Every PR follow-up Codie spawns is a potential offload target | MEDIUM-HIGH. PM ticket-history audits, lease deep-reads, multi-doc synthesis recur but not weekly |
| **Risk — runtime** | Codex 401 subscription-quota error pattern is known (`feedback_codex_401_distinguish_codes`). Cap exhaustion stalls the doer same as it stalls Codie today | Gemini free tier hit on heartbeat KB re-ingest before (`kb_ingest_quota_hit` 4/9). Pro/Max raises the ceiling; verify quota math before commit |
| **Risk — spec discipline** | Vague Claude planner specs → Codex doer thrash → cost savings vanish. Locked as open SOP gap in `project_hermes_specialist_doer_strategy` | Same gap applies; less acute because Gemini's long-context absorbs ambiguity better than Codex |
| **Risk — duplicates Codie?** | Codie is also a Codex-fronted agent — but Codie is Claude-runtime + Codex-tool-call, not Hermes-runtime persistent. codex-coder offloads work to a DIFFERENT cap pool (ChatGPT sub vs Anthropic sub). Net new capacity, not duplicate | No duplicate concern. Scout opens a workflow class we don't have today |

---

## Decision input

**If David picks codex-coder first:**
- Immediate cap relief for collie + codie when they hit cap mid-write
- Unblocks the 4 deferred PM endpoint follow-ups in same window
- No financial commitment (free via ChatGPT sub)
- Validates the Hermes-runtime persistence path against the runtime we have most pressure on first
- Defers scout to second specialist; HAR / PDF analysis stays on aussie/blue's shoulders meanwhile

**If David picks scout first:**
- Opens new analytical workflow class (multi-doc synthesis at scale)
- Requires Gemini plan upgrade decision (small monthly cost)
- Validates the Hermes-runtime path with the LESS load-bearing of the two providers (good first test = lower blast radius)
- codex-coder waits; collie/codie cap pressure absorbed by hard-restarts as today
- Pairs naturally with PR #5 live-smoke + the PM endpoint discovery work already in flight

---

## Pre-spawn checklist (either pick)

Before either specialist gets spawned, two items must close:

1. **Hermes doer-spec SOP** — open gap from `project_hermes_specialist_doer_strategy`. Need a "how to spec a Hermes doer task" pattern so planners (collie/codie/aussie/blue) write specs the doer can execute without thrash. Without this SOP, both specialists risk burning their cap pools on ambiguity. Estimated effort: 1-2h of writing, Collie can draft.

2. **Verify hermes-agent installs cleanly** — `pip install hermes-agent` on this host hasn't been smoke-tested. The HermesPTY code path exists in cortextos but `which hermes` returns nothing today (per `hermes-fleet-integration-spec.md` §6 Q2). One-time setup; fail-fast before committing to either pick.

---

## Open follow-ups (do not block decision)

- Native computer use in Hermes (pending upstream) — evaluate vs our Playwright/Peekaboo stack when it ships
- Hermes kanban board (pending upstream) — evaluate vs cortextos task system when it ships
- Second specialist spawn — should follow within 1-2 weeks of first to avoid the spec-discipline SOP rotting

---

## Recommendation

Picking strictly on **immediate demand signal + cap relief**, codex-coder closes more friction in the next 2 weeks. Picking on **lowest-blast-radius first test**, scout is safer because Gemini failures don't stall code shipping.

Both are right answers. David's call.

---

**Related memory pins:**
- `project_hermes_specialist_doer_strategy` (David lock 2026-05-16 ~04:30 UTC)
- `feedback_codex_401_distinguish_codes`
- `feedback_codex_writable_root`
- `protect_dialed_in_agents`
- `ascendops_self_hosted_forever`
- `ascendops_copilot_mode_default`

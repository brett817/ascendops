# Hotfix-Tier Double-Gate Policy

**Status:** LOCKED 2026-05-24 by David via Dane (post-Aussie surface).
**Origin:** Empirical case from 3 consecutive contract-at-dispatch-adjacent PRs this week where Codex caught load-bearing P1/P2 in the 5-min grace window. Single-gate would have shipped silent-failure-class bugs.
**Related:** [Contract-at-dispatch v2](subagent-prompt-structure-2026-05-24.md), [Programmatic-MCP design](programmatic-mcp-and-subagent-research-dir-design-2026-05-24.md).

---

## Rule

Every pull request gets one of two merge-gate tiers based on the PR class. The tier dictates how many 5-min Codex-grace windows the merge cycle observes.

### Tier 1 — Standard (single-gate)

Default for ordinary feature, fix, refactor, doc-tier, and cleanup-batch PRs.

Gate sequence:
1. Open PR.
2. Wait 5 min for Codex bot to fire (PR-open grace).
3. Peer LGTM filed after grace closes (with supersede rule if any late Codex finding lands).
4. Merge immediately after LGTM.

### Tier 2 — Hotfix (double-gate)

Default for any PR that is **load-bearing on a rule, protocol, or convention** that other PRs in the fleet will consume. The PR's correctness affects more than the PR itself.

Gate sequence:
1. Open PR.
2. Wait 5 min for Codex bot to fire (PR-open grace).
3. Peer LGTM filed after grace closes.
4. **Wait 5 more min for Codex bot to re-fire on post-LGTM commits or late-landing findings** (post-LGTM grace).
5. Merge immediately after the second grace window closes, in the same conversation turn the gate clears (deterministic-clock rule).

If Codex finds a real P1/P2 in either grace window, the cycle restarts after the fix commit lands — both gates re-open for the new HEAD.

### Tier triggers (Tier 2 applies when ANY of the following)

A PR is Tier 2 if:
- It modifies a canonical durable spec at `orgs/<org>/docs/durable/`
- It adds/modifies a reference standard cited by multiple agents (e.g. dispatch templates, skill SKILL.md surfaces, `.gitignore` carve-outs that other surfaces depend on)
- It ships protocol-conformant code (JSON-RPC clients, transport adapters, signature verifiers)
- It introduces a convention directory or path that other PRs will write to (e.g. `orgs/<org>/research-artifacts/`)
- It is itself a hotfix to live-on-main bugs (the original sense of "hotfix")

Receiver-side enforcement (per [contract-at-dispatch v2](subagent-prompt-structure-2026-05-24.md)): if a PR appears to fit a Tier 2 trigger but is being shipped as Tier 1, peer reviewers push back and request the second gate before approving.

### Why two gates

Codex bot re-fires variably — sometimes within the first 5 min after PR open, sometimes after a force-push, sometimes after late-arrival latency on the GitHub side. The first gate covers Codex's initial fire on the PR diff. The second gate covers the post-LGTM window where Codex can re-fire on the same HEAD (a real failure mode observed on PR #55 — Codex fired 1 min before merge, missed by 60 seconds).

For Tier 1 PRs the cost of a missed late-fire is low (small surface, contained blast radius). For Tier 2 PRs the cost is high — the bug ships into a rule everyone else consumes.

---

## Empirical case

Three consecutive PRs this week validated the double-gate empirically. Each was contract-at-dispatch-adjacent and rule-load-bearing. Each had Codex catch a real P1/P2 in a grace window that single-gate would have missed.

### PR #55 — Contract-at-dispatch canonical rollout (2026-05-23)

- **Problem class:** canonical reference missing from public repo.
- **Codex catch:** the 8 receiver surfaces all referenced `orgs/ascendops/docs/durable/subagent-prompt-structure-2026-05-24.md`, but the spec itself was untracked — never `git add`-ed despite the `.gitignore` carve-out permitting it.
- **Without the catch:** every receiver following the new rule would have hit file-not-found on the cited path. Silent-failure on day 1 of the rule's life.
- **Fix shape:** add the spec file to the same PR as a follow-up commit. 60 seconds of work; caught by the 5-min Codex grace.

### PR #57 — Contract-at-dispatch v2 + research-artifact dir (2026-05-24)

- **Problem class A:** spec-internal inconsistency.
- **Codex catch A:** canonical spec contract text said `RESEARCH_ARTIFACT_PATH=<absolute_path>.md` but the worked example and convention path used repo-relative. Dispatchers and receivers would have disagreed on path shape.
- **Problem class B:** multi-org `.gitignore` policy gap.
- **Codex catch B:** the new carve-out un-ignored `orgs/<org>/research-artifacts/` and its inner `.gitignore` but did NOT re-block contents at the top level. A fork org that didn't copy the inner guard first would have leaked contents by default — contradicting the "block all by default" decision.
- **Without the catches:** path-shape disagreement across the fleet + per-org data leakage on framework forks.
- **Fix shape:** pick repo-relative as canonical + sed across 8 receiver surfaces; add a middle re-block line to `.gitignore`. ~10 lines total; caught by the 5-min Codex grace.

### PR #58 — Programmatic-tools library (2026-05-24)

- **Problem class A:** protocol-conformance gap.
- **Codex catch A:** `_send_http` omitted `MCP-Protocol-Version` header on every POST after the initialize handshake. Strict Streamable HTTP MCP servers (per MCP spec) reject without this header → HTTP 400 → HTTP transport unusable.
- **Problem class B:** resource-leak silent-failure.
- **Codex catch B:** `connect()` spawned the stdio subprocess BEFORE calling `_handshake()`. If handshake raised, no cleanup fired. With-statement callers see `__enter__` raise → Python SKIPS `__exit__` → orphan subprocess. Accumulates over cron-shape retry loops.
- **Without the catches:** HTTP transport broken against any compliant remote server + accumulating zombie subprocesses on every transient handshake failure.
- **Fix shape:** add one header line; wrap `_handshake()` in try/except inside `connect()`. ~14 lines total; caught by the 5-min Codex grace.

### Pattern across the 3

| PR | Surface class | Codex finding class | Single-gate ship cost |
|---|---|---|---|
| #55 | canonical spec rollout | reference-resolution gap | broken receivers day 1 |
| #57 | rule extension + convention dir | spec-internal-inconsistency + multi-org policy gap | path disagreement + per-org leak |
| #58 | rule-consuming library | protocol-conformance + resource-leak | broken HTTP transport + zombie process accumulation |

Three different problem classes. Same shape: rule-load-bearing surface, Codex caught in grace window, single-gate would have shipped silent-failure-class behavior. Double-gate caught all three.

---

## Cap considerations

The hotfix-tier double-gate adds ~10 min of busy-wait time to the merge cycle. For doc-tier PRs at ~60-line scope this would be expensive; for rule-load-bearing PRs the marginal cost is small relative to the cost of shipping a silent-failure.

**Wait pattern:** when applying double-gate, use an `until <check>; do sleep 15; done` busy-wait loop OR a background bash sleep that notifies on completion. Either honors the "deterministic-clock-pre-schedule" rule (fire merge in the same turn as gate clears, no hand-off). DO NOT end-turn and rely on the next inbound message to wake the merge — that's the idle-gap failure pattern from earlier today.

---

## Out of scope

- This policy does NOT change peer-LGTM timing for Tier 1 PRs. Single-gate stays single.
- This policy does NOT add a third gate. Two grace windows is sufficient based on empirical data.
- This policy does NOT mandate hotfix-tier on every PR. Default stays Tier 1; promotion to Tier 2 is by the trigger list above OR by reviewer pushback per receiver-side enforcement.

---

## Cross-references

- Contract-at-dispatch v2: [subagent-prompt-structure-2026-05-24.md](subagent-prompt-structure-2026-05-24.md)
- Design doc: [programmatic-mcp-and-subagent-research-dir-design-2026-05-24.md](programmatic-mcp-and-subagent-research-dir-design-2026-05-24.md)
- PR #55: https://github.com/noogalabs/ascendops/pull/55 (canonical rollout + meta-failure catch)
- PR #57: https://github.com/noogalabs/ascendops/pull/57 (v2 sub-bullet + 2 P2 catches)
- PR #58: https://github.com/noogalabs/ascendops/pull/58 (library + P1/P2 catches)
- Deterministic-clock-pre-schedule banked lesson from 2026-05-24 cascade.

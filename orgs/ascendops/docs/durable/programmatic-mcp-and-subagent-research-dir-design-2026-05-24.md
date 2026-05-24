# Design: Programmatic MCP Tool Calling + Subagent External Research Directory

**Status:** Plan mode (no code, no PR). Awaiting David greenlight via Dane.
**Author:** collie
**Date:** 2026-05-24
**Source dispatch:** Dane plan-mode dispatch 15:16 UTC with David's expanded principle "anytime we can bypass the LLM and call a tool directly, do that — MCP via JSON-RPC OR CLI via shell from a script, both count."
**Related:** [Subagent prompt structure (contract-at-dispatch)](subagent-prompt-structure-2026-05-24.md) — merged PR #55 today. This design proposes the **v2 extension** for Item 2.

---

## Why this design

Two related token-economy problems surfaced from the AscendOps fleet over the past week:

1. **MCP-via-LLM tax.** Every MCP tool call routed through the LLM-as-router burns input + output tokens for orchestration that adds zero value when the call shape is mechanical (e.g. an `icm memory_store` batch, a `semble search` loop, a `claude-mem ingest` cron). The LLM is reading the tool description, planning the call, formatting JSON, then parsing the response — all to forward bytes a script could pipe directly.

2. **Subagent context pollution.** When a subagent finishes research and reports back via the Agent tool, the framework returns a summary string — only. All the raw facts the subagent found (URLs, code snippets, line numbers, exact quotes) collapse into prose. If the main agent later needs a specific fact, it has to re-spawn or re-fetch. Today's MMS hotfix integration cycle exemplified this: each subagent returned a 1-2K summary, but the main agent needed line-level integration detail that wasn't in the summary.

Both problems share a root cause: **information moving through the LLM that doesn't need to.** Item 1 fixes MCP transport. Item 2 fixes intra-agent artifact handoff. Same shape, different layer.

---

## Item 1: Programmatic MCP Tool Calling

### Current state inventory

MCP servers across the AscendOps fleet, grouped by call-shape:

| Server | Transport | Configured at | Primary callers | Batch-friendly? |
|---|---|---|---|---|
| `semble` | stdio (`uvx`) | per-agent (5 agents) | research / code-search | YES |
| `agent-architects` | http | dane only | lesson fetch | YES |
| `agentmemory` | stdio | relay | parked | YES |
| `icm` | stdio (deferred-tool slot) | runtime-loaded | every heartbeat cycle | YES (high freq) |
| `claude-mem` | stdio (deferred) | runtime-loaded | cron ingestion + recall | YES |
| `graphify` | stdio (deferred) | runtime-loaded | code-nav queries | YES |
| `gws-*` | CLI (`gog` binary) | every agent | Gmail, Calendar, Drive, etc. | YES — already CLI-direct via `gog` |
| `playwright` | stdio | user-global | browser automation | NO (session-based) |
| `computer-use` | stdio | user-global | UI automation | NO (real-time) |
| `notion` | stdio | user-global | doc editing | MIXED |

### High-value direct-call candidates (worth bypassing LLM)

Ranked by estimated token-cost-per-month-of-LLM-routing for the AscendOps fleet:

1. **`icm` memory_store + memory_recall** — heartbeat-cycle calls × 6 agents × 6 cycles/day × ~30 days = ~3,240 calls/month, each currently ~300-500 tokens of LLM overhead = ~1.3M tokens/month routable to script.
2. **`claude-mem` ingestion + search** — cron-driven, similar volume to icm, similar shape.
3. **`semble` search** — bursty (during code-review sessions), but each session can fire 5-10 calls; same LLM-routing overhead.
4. **`agent-architects` get_lesson + search** — lower volume but high payload (lessons are 3-15K), so format-overhead matters. Used today during this dispatch.
5. **`graphify` query** — deferred tool, currently unused but slated for code-nav workflows.

Total estimated reclaim: **2-5M tokens/month** at current fleet activity. Worth the build.

### Interactive-only (LLM-routed stays correct)

- `playwright`, `computer-use`, `notion` — real-time / session-based / authoring. Direct-call doesn't fit.
- `semble find_related` when called interactively during a review session — judgment-driven, LLM-routed is the right shape. Direct-call only applies to scripted batch use.

### CLI-direct extension (David's expanded principle)

Some "MCP-shaped" capabilities already exist as CLI binaries. The direct-call library should support both transport modes:

| Domain | MCP shape | CLI-direct alternative | Recommendation |
|---|---|---|---|
| Google Workspace | (no MCP today) | `gog` binary | CLI-direct, already done — promote in docs |
| GitHub | `mcp__github-*` | `gh` binary | CLI-direct preferred — already fleet-standard |
| Property Meld | (no MCP) | `pm` / snap-cli | CLI-direct, already done |
| Bus operations | (no MCP) | `cortextos bus *` | CLI-direct, already done |
| Code search | `semble` MCP | `rg` / `grep` | Hybrid — semble for semantic, ripgrep for literal |

The library design should be **transport-agnostic from the caller's perspective**: `call_tool(name, args)` works whether the tool is an MCP JSON-RPC server or a CLI binary.

### Proposed library shape

A single small Python module + a Claude Code skill that wraps both transports:

```
shared-skills/programmatic-tools/
├── SKILL.md          # When/why/how to use direct-call
├── lib/
│   ├── mcp_client.py # JSON-RPC over stdio + http (mirrors reference repo)
│   ├── cli_runner.py # Shell-out with structured input/output
│   └── tools.py      # Unified call_tool(name, args, transport='auto')
└── examples/
    ├── batch_icm_store.py     # 100x icm__icm_memory_store from a list
    ├── cron_claude_mem_ingest.py # Replaces the LLM-routed ingestion cron
    └── chain_semble_search.py # Programmatic search → filter → store
```

`call_tool()` resolves transport in this order:
1. Explicit `transport=` arg
2. `~/.claude/mcp.json` lookup (stdio MCP)
3. `~/.cortextos/<instance>/state/<agent>/.mcp.json` (per-agent MCP)
4. `which <name>` (CLI binary on PATH)
5. Error with concrete next step (don't fail silently)

### Skill pattern

`programmatic-tools` skill description (load-trigger): "You have a batch operation or cron task that calls an MCP tool or CLI in a loop. You want to bypass the LLM for that call to save tokens. The script writes/reads JSON directly to the tool process."

Agents discover the skill via `cortextos bus list-skills`. Pattern at the call site:

```python
from programmatic_tools.lib import call_tool

# Batch icm_memory_store
for entry in entries:
    call_tool('mcp__icm__icm_memory_store',
              {'topic': entry.topic, 'content': entry.body, 'importance': entry.level})
```

vs. the current LLM-routed shape where each call burns ~300-500 tokens of agent-context.

### Scope estimate

- mcp_client.py: ~150 LOC (Python, follows the reference repo's pattern; need stdio + http support)
- cli_runner.py: ~80 LOC (subprocess wrapper, JSON-in JSON-out)
- tools.py unified API: ~50 LOC
- SKILL.md: ~80 lines
- 3 worked examples: ~30 LOC each
- Tests against icm + semble (live, not mocked): ~100 LOC

Total ~500-600 LOC + docs. Single PR, ETA 90-120 min if implemented.

---

## Item 2: Subagent External Research Directory

### Current state (no fleet convention)

How subagent artifacts currently move from subagent → main agent:

| Pattern | Used by | Pros | Cons |
|---|---|---|---|
| Inline summary (Agent tool default) | All sub-agent dispatches today | Simple, no setup | Loses raw facts; main agent re-fetches |
| Write to `docs/durable/` (ad-hoc) | Aussie weekly review subagents | Persists facts | No standard path, no contract |
| Write to bus message (`send-message`) | Cross-agent peer dispatches | Survives session | Bus is for coordination not research storage |
| Inline + paste-into-conversation | Most code-review subagents | Visible to user | Pollutes main agent context |

**Today's MMS hotfix cycle hit this exact gap.** Two sub-agents returned 1-2K summaries each; I integrated them, but had to re-read source files to confirm line numbers neither subagent surfaced. The subagents knew the facts. The handoff lost them.

### AA lesson 6.3 — verbatim core (per Dane's source paste)

> "when your subagent passes that information back to the subagent through the agent tool, it's only gonna pass a summary. So to solve this problem, you're gonna wanna prompt Claude Code to deploy subagents to actually store their research in external documents in the project that you're working in. So all the facts they find, all the documentation they pull, you can prompt them to store that in an external research directory in your project so that your main agent can go back to that research directory and pick and choose the facts that it needs while it's working. So that way, you don't pollute your main agent's context window with all that information, but you still have access to the exact facts that those subagents found in their research."

Pattern is well-known in the Skool community. Related family: **BEADS**, **Get Shit Done (GSD)**, **RALF loop**.

### Proposed: contract-at-dispatch v2 — RESEARCH_ARTIFACT_PATH field

Extend the 4-part dispatch structure (`subagent-prompt-structure-2026-05-24.md`) with a new required field for any non-trivial subagent dispatch:

```
Research artifact contract:
- Write your raw facts (URLs, code excerpts, line numbers, exact quotes) to
  RESEARCH_ARTIFACT_PATH=<absolute_path>.md before returning your summary.
- Return only the high-level summary inline. Main agent reads the artifact
  on demand when it needs specifics.
- File format: structured markdown with `## Sources`, `## Key findings`,
  `## Raw excerpts` sections. Main agent greps headers when seeking specifics.
```

This becomes a **5th part** of the contract-at-dispatch pattern OR a sub-bullet under Part 4 (future contracts). My read: sub-bullet under Part 4, since it IS a future-contract obligation on the subagent's output shape.

### Directory convention

```
orgs/<org>/research-artifacts/<dispatch-id>/<lane-id>.md
```

Where `<dispatch-id>` is the task ID or PR number that triggered the dispatch, and `<lane-id>` is which sub-agent produced the artifact (e.g. `lane-a-parser`, `lane-b-tests`).

`.gitignore` decision: NOT committed by default (these are per-session research notes, not durable specs). Carve-out only if a specific artifact deserves promotion to `docs/durable/`.

### Before/after — hypothetical multi-subagent build

**Before (today's pattern):**
- Dispatch sub-agent A to research PM endpoint shapes
- Subagent A returns: "PM list returns flat phone field, get returns nested contact.cell_phone. Suggested predicate change at http_backend.py:1247."
- Main agent integrates. Needs the exact response keys for the test fixture, doesn't have them. Re-fetches via `pm tenants list --json`. Re-spends time.

**After (with RESEARCH_ARTIFACT_PATH):**
- Dispatch with `RESEARCH_ARTIFACT_PATH=orgs/ascendops/research-artifacts/c2-pm-tenants/lane-a.md`
- Subagent A writes: full curl response, complete key list (channel/email/.../phone/status), line numbers, related code sites
- Subagent A returns inline: "Wrote analysis to <path>. Headline: flat top-level phone, fix predicate at http_backend.py:1247."
- Main agent integrates using the summary. When test fixture needs exact keys, greps the artifact file for `## Raw excerpts` section.

Net: main agent context stays small + raw facts stay accessible.

### Related framework comparisons

- **BEADS** (Brief, Examine, Analyze, Decide, Synthesize): structured workflow per subagent — RESEARCH_ARTIFACT_PATH is the artifact tier that BEADS' "Examine" + "Analyze" feed into.
- **Get Shit Done (GSD)**: emphasizes shipping over perfecting research artifacts — RESEARCH_ARTIFACT_PATH is GSD-compatible only if writing the artifact is fast enough to not slow the ship cycle.
- **RALF loop** (Research, Analyze, Loop, Finalize): explicit research stage where artifacts live separate from synthesis — direct ancestor of this pattern.

Our contract-at-dispatch design lives in conversation with all three. The pattern lifts from RALF most directly; GSD's ship-speed concern motivates the "write artifact ALONGSIDE the inline summary, not BEFORE it" sequencing.

### Scope estimate

- Update durable spec at `subagent-prompt-structure-2026-05-24.md` (add Part 4 sub-bullet for RESEARCH_ARTIFACT_PATH): ~30 lines
- Update worked example to demonstrate artifact contract: ~10 lines
- Update 8 dispatch surfaces from PR #55 with the new sub-bullet reference: ~5 lines per surface × 8 = ~40 lines
- Update fleet MEMORY.md entries banked yesterday: ~5 lines × 3 = ~15 lines
- Add `orgs/ascendops/research-artifacts/.gitignore` (block by default): 1 line
- Optional: skill or convention doc on the artifact format: ~60 lines

Total ~150 LOC. Single PR following the contract-at-dispatch v2 shape itself (eat-own-dog-food again). ETA 30-45 min implementation if greenlit.

---

## Open questions for David / Dane

### Item 1 (Programmatic MCP)

1. **Skill placement** — `shared-skills/programmatic-tools/` (org-shared) vs. `community/skills/programmatic-tools/` (canonical-fleet-wide via PR)? My recommendation: `community/skills/` since the pattern is generally useful, not org-specific.
2. **mcp_client.py source** — adopt the reference repo (`grandamenium/programmatic-mcp-skill`) verbatim as a dependency / submodule / vendor-copy? Or write our own thin wrapper? My recommendation: vendor-copy + adapt — gives us control over the API surface without taking an external dep.
3. **CLI-direct first or MCP first?** — building both simultaneously vs. shipping MCP-direct first then layering CLI. My recommendation: ship MCP-direct first (clearer reference + higher token-reclaim value), CLI extension follows. Both APIs unified via `call_tool()`.

### Item 2 (Research artifact directory)

4. **Sub-bullet vs. 5th part** — slot under Part 4 (future contracts) or promote to Part 5 (research artifact contract)? My recommendation: sub-bullet under Part 4 since it IS a future-contract obligation on the subagent's output shape. Avoids inflating the canonical 4-part structure.
5. **`.gitignore` carve-out for research-artifacts/** — block all by default (my recommendation), block all except promoted-to-durable (separate decision per artifact), or allow all? Cleaner default = block all.
6. **Backfill** — apply RESEARCH_ARTIFACT_PATH retroactively to in-flight dispatches (the next 1-2 cleanup-batch items), or only forward from the v2 lock? My recommendation: forward-only — backfilling mid-cycle would thrash.

### Both items

7. **Sequencing** — ship Item 2 first (smaller PR, immediate value, eat-own-dog-food on the contract-at-dispatch pattern that JUST merged) OR Item 1 first (bigger token-reclaim, but larger scope)? My recommendation: Item 2 first.

---

## Cross-references

- Item 1 reference repo: https://github.com/grandamenium/programmatic-mcp-skill
- Item 2 source lesson: https://www.skool.com/agent-architects/classroom/b70aa39f?md=3ba9d7f02b2343baa9b619fc2a72f765 (Source ID `3ba9d7f02b2343baa9b619fc2a72f765`)
- Contract-at-dispatch durable spec: [subagent-prompt-structure-2026-05-24.md](subagent-prompt-structure-2026-05-24.md)
- PR #55 (canonical pattern rollout): https://github.com/noogalabs/ascendops/pull/55
- PR #56 (3-spec landing): https://github.com/noogalabs/ascendops/pull/56
- David's expanded principle (2026-05-24): "anytime we can bypass the LLM and call a tool directly, do that — MCP via JSON-RPC OR CLI via shell from a script, both count."

---

## Validation loop (plan-mode artifact only)

Before declaring this design ready for Dane review:
- [x] All references in Cross-references section resolve (programmatic-mcp-skill repo: verified gh api; AA lesson 6.3: verified via Dane's verbatim source paste)
- [x] MCP fleet inventory done from live `.mcp.json` files (not from memory)
- [x] Token-cost-per-month estimate cited (not fabricated) — uses fleet activity data Aussie surfaced in weekly-prep
- [x] Concrete before/after example for Item 2 grounds in today's MMS hotfix cycle
- [x] Open questions list per item, each with my recommendation + rationale
- [x] Plan mode: NO code written, NO config changed, NO PR opened

Doc lives at `orgs/ascendops/docs/durable/programmatic-mcp-and-subagent-research-dir-design-2026-05-24.md` per dispatch spec. Path is in the durable-carve-out so commits to PR are gated only by Dane greenlight, not gitignore.

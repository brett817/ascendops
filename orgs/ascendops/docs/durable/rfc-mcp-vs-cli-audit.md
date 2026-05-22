# RFC: MCP-vs-CLI Audit — keep, replace, deprecate

**Author:** Collie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review
**Item:** Thursday plate #9 (of 13)
**Companions:** Aligns with `feedback_snapcli_hierarchy.md` ("CLI first, API second, manual last") and `feedback_google_workspace_cli.md` ("use gws CLI, not Gmail MCP").

---

## 1. Problem

cortextOS agents have two parallel surfaces for the same capabilities:

- **MCP servers**: long-lived stateful processes, tool calls go through a JSON-RPC bridge. Each tool result lands in the model context window directly.
- **CLI tools**: stdout-and-exit-code processes, called via Bash. Output is text — agent decides what to keep.

These surfaces overlap meaningfully today. Same fleet has the `gws` CLI for Gmail/Drive/Calendar **and** the Claude.ai Gmail/Calendar/Drive MCPs. Same fleet has the `pm` CLI for PropertyMeld **and** has historically had Playwright MCPs for the same write paths.

**Why this matters:**

| Dimension | MCP | CLI |
|---|---|---|
| Token cost per call | Tool schema in context every turn (~200-2000 tok) + result inlined verbatim. Inflates context permanently. | Schema is zero-cost (Claude knows Bash). Result is text, agent re-summarizes if kept. |
| Statefulness | Native — server holds session, auth refresh, cached state | Per-invocation — agent re-loads session/creds each call (cheap with proper credential files) |
| Debuggability | Opaque — JSON-RPC over stdio, hard to introspect mid-call | Transparent — `bash -x`, log the exact command, replay it |
| Retry / backoff | Defined inside the MCP server, agent can't override | Agent controls retry, can use `until ... do sleep` patterns |
| Cross-agent reuse | Per-agent process; another agent can't share | Trivial — every agent's Bash hits the same binary |
| Ship/upgrade cadence | Deploy server, restart agent | Update PATH binary, no restart |
| Prompt cache compatibility | Tool-call results embedded in turn — usually NOT cacheable across turns | Bash output is text — fully cacheable in agent's prompt-cache prefix |

David's standing rule (`feedback_snapcli_hierarchy.md`): **CLI first, fall back only when CLI is genuinely missing or broken.** This RFC formalizes that into a per-MCP audit.

## 2. Inventory

Sources checked:
- User-level `~/.claude/settings.json` → `mcpServers`: `officecli` (1 server).
- Project templates `templates/{orchestrator,analyst,agent}/.mcp.json`: `agentmemory` (one per template).
- Plugin-provided MCPs (from `enabledPlugins` in user settings + this session's deferred-tool list): `icm`, `claude-mem`, `claude_ai_Gmail`, `claude_ai_Google_Calendar`, `claude_ai_Google_Drive`, `codex` (plugin, not strictly an MCP — provides skills + helper).

**Active MCPs across the fleet:**

| MCP | Source | Capability summary |
|---|---|---|
| `icm` | plugin | Persistent cross-session memory: store/recall/forget/health/embed/wake-up |
| `claude-mem` | plugin (`thedotmack`) | Project timeline + observation search: smart_search, smart_outline, get_observations, timeline |
| `agentmemory` | template `.mcp.json` (3 templates) | Token-budgeted agent memory (different from icm — older?) |
| `claude_ai_Gmail` | claude.ai integration | Authenticate Gmail account |
| `claude_ai_Google_Calendar` | claude.ai integration | Authenticate Calendar account |
| `claude_ai_Google_Drive` | claude.ai integration | Authenticate Drive account |
| `officecli` | user `~/.claude/settings.json` | Local Office docs CLI bridge |

## 3. Per-MCP Audit

### 3.1 `icm` — KEEP-MCP
**Capability:** persistent memory across sessions; key-value with TTL/decay; topic + keyword + similarity search.
**CLI equivalent:** `icm` binary exists (used in cron at `monthly-tool-maintenance` for upgrade), provides equivalent operations. **However**, icm is a primary trigger source for proactive memory storage on every session — having it in MCP form lets the model self-direct stores during reasoning, not just as one-shot CLI invocations.
**Recommendation:** **KEEP-MCP**. Statefulness need (per-call session continuity) + reasoning-loop integration justify MCP. CLI stays as a manual sweep tool.
**Justification:** the proactive-store pattern (described in user's CLAUDE.md) is structurally MCP-shaped — it's a per-turn decision, not a discrete script.

### 3.2 `claude-mem` — REPLACE-WITH-MCP2CLI-WRAPPER (path verified, soak prep complete 2026-04-29)
**Capability:** project timeline + observation database. Read-only search surface (`search`, `smart_search`, `smart_outline`, `smart_unfold`, `get_observations`, `timeline`, `____IMPORTANT`).
**Native CLI equivalent:** the `claude-mem` binary at `.../12.0.1/scripts/claude-mem` (v10.3.1) only exposes daemon lifecycle (`start/stop/restart/status`), the `mcp` server-launcher, lifecycle hooks, `generate`/`clean` (CLAUDE.md regen), `statusline`, and `cursor` subcommands — **zero query/search/recall coverage** (verified by the LL parity audit, `docs/claude-mem-cli-parity.md`).
**Updated path — Python `mcp2cli` wrapper (David approved 2026-04-29):** `mcp2cli` auto-generates CLI subcommands from any MCP stdio server, giving us a third option that needs no upstream contribution. Bake recipe and per-agent migration steps are in `docs/mcp2cli-claude-mem-migration.md`. Soak prep complete: install + bake verified; smoke-test on 3 representative ops (`get-observations`, `search`, `timeline`) — `get-observations` has full parity, `search` and `timeline` are callable but mcp2cli 3.0.2 does not auto-expose their query params as CLI flags (description-only schema annotations). See migration doc §5 for the gap detail.
**Recommendation:** **REPLACE-WITH-MCP2CLI-WRAPPER**. Soak the wrapper for 1 week on a canary agent (lean Aussie), then roll fleet-wide. Search/timeline gap is acceptable as a temporary regression — agents that only need `get-observations` migrate immediately; agents that need search/timeline keep the MCP loaded until the JSONSchema-to-CLI-flag gap is resolved upstream.
**Justification:** read-only search is the textbook CLI use case. Pure throughput, no statefulness needed. Schema-tax savings are small in absolute terms (~36k tokens/week fleet-wide) but the architectural principle (decentralized protocol overhead) is correct.
**Migration friction:** the plugin auto-installs the MCP via `enabledPlugins`. Per-agent disable is best-handled via the agent's `.mcp.json` override rather than touching the global `enabledPlugins`. Cookbook in migration doc §3-§4.

### 3.3 `agentmemory` — DEPRECATE
**Capability:** token-budgeted agent memory with `core` tool subset.
**CLI equivalent:** none — but its functional overlap with `icm` makes it redundant.
**Recommendation:** **DEPRECATE**. Templates ship `agentmemory` in their `.mcp.json` from before icm was the standard. New agents should not get it; existing template references should be removed.
**Justification:** two memory MCPs is one too many. icm is the chosen solution (per `CLAUDE.md` user instructions).

### 3.4 `claude_ai_Gmail` / `_Google_Calendar` / `_Google_Drive` — REPLACE-WITH-CLI
**Capability:** OAuth authenticate + minimal Gmail/Calendar/Drive operations. The session-start hook noted this morning that all 3 MCP servers had **disconnected** — they're flaky.
**CLI equivalent:** **`gws` CLI** (Google Workspace CLI, our standard per `feedback_google_workspace_cli.md`). Fully covers the same surface area: `gws gmail users messages list/get/modify`, `gws calendar events list/insert`, `gws drive files list/get/create`. Also has higher-level recipe skills documented.
**Recommendation:** **REPLACE-WITH-CLI**. They're already the wrong tool — David's standing rule says use `gws`. The MCPs being plugged in is friction, not capability.
**Justification:** explicit user feedback + already-flaky MCP behavior + better CLI in place. Easy win.

### 3.5 `officecli` — KEEP-MCP (low priority for review)
**Capability:** Local-Office-docs bridge. Custom binary, single-machine.
**CLI equivalent:** the same binary runs as a CLI (`officecli mcp` is just one mode).
**Recommendation:** **KEEP-MCP** for now — low usage, no documented friction. If usage grows, re-evaluate.
**Justification:** not blocking anything. Park it.

### 3.6 `codex` — KEEP (not strictly MCP, but in scope)
**Capability:** plugin that wraps the OpenAI codex CLI. Used heavily this week (PM Phase 2 partial dispatch, fast-checker dedup, today's RFC dispatches).
**CLI equivalent:** the codex binary itself.
**Recommendation:** **KEEP** as plugin/skill (not MCP-bridged); the wrapper is providing scoping + sandbox-aware dispatch, not duplicating the CLI surface.
**Justification:** the wrapper IS the value, not the underlying CLI access.

## 4. CLI Gap List

For "REPLACE-WITH-CLI" recommendations, are CLIs missing capabilities the MCP currently provides? Audit:

| MCP | CLI gap | Effort |
|---|---|---|
| `claude-mem` → `claude-mem` CLI | Possibly missing direct `get_observations` by ID (CLI may only support search) | **S** — add subcommand if missing |
| `claude_ai_Gmail` → `gws gmail` | Authentication flow handoff. The MCP has Claude.ai-OAuth-button UX; `gws` has its own auth dance. | **S** — document the `gws` auth flow in onboarding |
| `claude_ai_Calendar` → `gws calendar` | Same as Gmail: auth UX gap, capability gap = none | **S** — same |
| `claude_ai_Drive` → `gws drive` | Same auth gap. Capability complete in CLI. | **S** — same |
| `agentmemory` → (none — deprecate) | n/a | **n/a** |

No mediums or larges. Replacement work is small + mostly documentation.

## 5. Token Cost Comparison

Estimates (call this RFC's own measurement TBD; numbers below are reasoned from observed patterns, flagged as estimate):

| Surface | Per-call schema cost (sticky) | Per-call result cost (typical) | Notes |
|---|---|---|---|
| MCP tool call | ~200-2000 tok per tool definition (lives in every turn's tools array) | result inlined verbatim, ~200-5000 tok | Permanent context inflation |
| `gws gmail messages list` via Bash | 0 tok schema (Bash known) | stdout, ~500-3000 tok, agent can `\| head` to trim | Zero schema, trimable result |
| `pm work-orders get` via Bash | 0 tok schema | stdout, ~1-3k tok | Same |
| `icm_memory_recall` via MCP | ~200 tok schema | ~500-2000 tok per result | Statefulness gain offsets schema cost |
| `icm` CLI recall | 0 tok schema | ~500-2000 tok | Loses the reasoning-loop integration |

For 4 active claude.ai MCPs idle in a session: ~800-4000 tok carried in every single turn's tools array. Multiply by ~50 turns/day on Dane = ~40k-200k tok/day of pure schema overhead, regardless of actual MCP use. Replacing those with CLIs eliminates that constant tax.

## 6. Migration

**Order (cheap-first, lowest-risk-first):**

1. **Remove `agentmemory` from template `.mcp.json` files** (orchestrator/analyst/agent + property-management variant). Existing agents already running with it stay until their next hard-restart. (1 file × 4 templates, half-day.)
2. **Disable `claude_ai_Gmail` / `_Calendar` / `_Drive`** from claude.ai integration. They're already flaky-disconnecting; agents will fall through to `gws` CLI (which works). Verify no skill or recipe still references the MCP names. (Half-day audit + flip switch.)
3. **Document the `gws` auth flow** in `orgs/ascendops/docs/onboarding-google-workspace.md` so new agents know how to do the OAuth dance once. (Half-day.)
4. **Add any missing `claude-mem` CLI subcommands** identified in §4 audit. Soak 1 week. (Days, depending on gap.)
5. **Plan `claude-mem` MCP removal**: only after CLI parity verified. Lower priority than #1-3.
6. **Park `officecli` and `icm` MCPs.** Re-audit at next quarterly review.

Per step rollback: re-add the entry to `.mcp.json` or `enabledPlugins`, restart the agent. Trivial.

## 7. Open Questions for David

1. **Claude.ai Google MCPs — are they intentionally enabled?** They've been flaky-disconnecting (observed this session); my read is they're vestigial. Confirm OK to disable.
2. **`agentmemory` template removal** — am I right that icm is the canonical replacement? Or is `agentmemory` doing something icm isn't? My read is they're redundant.
3. **`claude-mem` MCP vs CLI priority** — high-value to remove (large schema overhead) but takes coordinating with the plugin's enable/disable surface. Worth it, or wait until plugin upstream supports per-agent disable?
4. **`icm` keep-as-MCP justification** — the proactive-store reasoning-loop integration is the argument. Is that worth the schema cost? (Estimate ~200 tok/turn.)
5. **OAuth auth-flow ownership** — should the `gws` auth doc live at `orgs/ascendops/docs/` (operational) or at the `gws` CLI's own README (upstream)? Argues split — onboarding doc points to upstream, with our tweaks layered on top.

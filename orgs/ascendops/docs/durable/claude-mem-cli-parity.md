# claude-mem CLI vs MCP Parity Audit

**Author:** Collie
**Date:** 2026-04-29
**Trigger:** RFC #9 §3 verdict was REPLACE-WITH-CLI for `claude-mem`, but flagged the priority as ambiguous because schema overhead is high yet coordination cost of removal is also non-trivial. This doc closes the parity question before any removal work starts.
**Scope:** local installation `~/.claude/plugins/cache/thedotmack/claude-mem/12.0.1/` — claude-mem CLI v10.3.1, MCP server `mcp-search` (registered in plugin `.mcp.json`).

---

## 1. claude-mem MCP tool surface

Surfaced by the `mcp-search` stdio MCP server (`scripts/mcp-server.cjs`). Tool list captured from this session's deferred-tools manifest:

| Tool | Purpose |
|---|---|
| `____IMPORTANT` | Meta-tool that returns operating instructions / reminders for the agent (not a data tool — surfaces guidance like "store before responding"). |
| `search` | Plain text search across observations. |
| `smart_search` | Higher-quality semantic search; ranks across the observation corpus. |
| `smart_outline` | Returns a structural outline (e.g. classes/functions) for a given file path. |
| `smart_unfold` | Expands a specific observation or symbol from the outline into its full content. |
| `get_observations` | Fetches one or more observations by ID. |
| `timeline` | Returns a time-ordered list of observations across a date range or project. |

Plus 6 plugin-shipped slash commands (skills): `claude-mem:do`, `make-plan`, `mem-search`, `smart-explore`, `timeline-report`, `version-bump`. These are skills, not MCP tools, but they consume the same backing store via the MCP — removing the MCP without CLI parity also breaks every one of these.

## 2. claude-mem CLI command surface

`claude-mem --help` reports v10.3.1, with these top-level commands:

| Command | Purpose |
|---|---|
| `start` / `stop` / `restart` / `status` | Worker daemon lifecycle. |
| `mcp` | Start the MCP search server (i.e. CLI launches the MCP — the CLI is the *parent* of the MCP, not a peer). |
| `hook <event>` | Run a lifecycle hook. Events: `context`, `session-init`, `observation`, `summarize`, `session-complete`, `user-message`. |
| `generate [--dry-run]` | Regenerate `CLAUDE.md` files for folders that have observations. |
| `clean [--dry-run]` | Remove auto-generated content from `CLAUDE.md` files. |
| `statusline [cwd]` | Output observation counts for the Claude Code status line. |
| `cursor <install\|uninstall\|status\|setup>` | Manage Cursor IDE integration. |

## 3. Side-by-side parity table

| MCP tool | CLI equivalent | Status |
|---|---|---|
| `search` | (none) | **Gap** |
| `smart_search` | (none) | **Gap** |
| `smart_outline` | (none) | **Gap** |
| `smart_unfold` | (none) | **Gap** |
| `get_observations` | (none) | **Gap** |
| `timeline` | (none) | **Gap** |
| `____IMPORTANT` | (none) | **Gap (low value — meta reminder; can be inlined into CLAUDE.md)** |

Every read-side MCP tool has zero CLI parity. The CLI is *write-side / lifecycle-side only*: it starts the daemon, runs hooks that ingest observations, regenerates `CLAUDE.md`, and integrates with Cursor. The CLI has no subcommand for searching, timelining, or fetching observations from inside an agent session.

## 4. Gaps blocking REPLACE-WITH-CLI

To remove the MCP and replace with CLI, the following subcommands would need to be added to claude-mem:

| Needed CLI subcommand | Replaces MCP tool | Effort estimate |
|---|---|---|
| `claude-mem search <query> [--project] [--limit]` | `search` | low — wraps existing search index |
| `claude-mem smart-search <query> [--project] [--limit]` | `smart_search` | low (same backend, different ranker already in plugin) |
| `claude-mem outline <file_path>` | `smart_outline` | low — tree-sitter already vendored in plugin (`node_modules/tree-sitter-*`) |
| `claude-mem unfold <observation_id>` | `smart_unfold` + `get_observations` | low — single fetch by id |
| `claude-mem timeline [--from <date>] [--to <date>] [--project]` | `timeline` | low |
| `claude-mem observations get <id1,id2,...>` | `get_observations` (batched) | low |

Each subcommand is 1–2 days of plugin work upstream (the indexing + ranking infrastructure already exists; only a CLI surface is missing). Total: ~5–10 days of upstream contribution, OR a local fork that adds a thin shell wrapper around the existing JS modules.

## 5. Schema-tax cost of keeping the MCP

Per-agent-boot overhead while the MCP stays active:

- 7 deferred tool entries (names only when deferred): ~150 tokens.
- Skills surfaced for `claude-mem:*` slash commands: ~6 × 50 chars = ~150 tokens in the skill list.
- No MCP-instructions block (the plugin does not register one — verified against this session's `MCP Server Instructions` section, which only contains `icm`).
- Full schemas pulled only when a tool is actually called (deferred-tool model) — so on a typical session that doesn't query memory, the runtime cost is ~300 tokens.
- Across the 4 active AscendOps agents at ~30 boots/week each, the headline cost is roughly **35–50k tokens/week** of pre-call schema overhead. Trivial against the weekly cap.

The "large schema overhead" framing in RFC #9 §3 likely conflated *full schema fetch* (tens of kilobytes) with *deferred listing* (~hundreds of tokens). The deferred model is the one in production.

## 6. Recommendation: **WAIT-FOR-CLI-BUILD**

Removing the MCP today would break six skills (`claude-mem:do`, `make-plan`, `mem-search`, `smart-explore`, `timeline-report`, `version-bump`) and remove every read-side memory operation. The schema-tax savings (~50k tokens/week) do not justify that loss until the CLI parity is built.

Hold REPLACE-WITH-CLI until the 6 read-side subcommands above ship in claude-mem CLI. At that point, removal is safe and the savings are real.

If upstream is unresponsive: a thin local fork of the plugin can add the CLI subcommands by exposing the existing JS modules through a `commander.js`-style entry — same code path the MCP already calls, just behind a CLI invocation.

## 7. CLI subcommands to add (effort recap)

See §4 table. Net: 6 new subcommands, all leveraging existing backends. Estimated 5–10 days for an upstream PR; ~2 days for a thin local-fork wrapper.

## 8. Open questions for David

1. **Upstream PR vs local fork**: do you want Collie/Aussie to file an upstream PR adding the 6 read-side subcommands, or fork locally and run the parity tax until upstream catches up?
2. **Skill compatibility on swap**: post-CLI-build, the 6 plugin skills (`do`, `make-plan`, etc.) currently call MCP tools internally. Do they need patching to call the CLI, or is upstream expected to rewire them in the same release?
3. **`____IMPORTANT` meta-tool**: contents are reminders to "store before responding". Want this inlined into CLAUDE.md as standing instructions, or accept losing the meta-reminder when the MCP goes?
4. **Removal sequencing with `icm`**: ICM has its own MCP (~80 tools surfaced, far heavier schema tax). Does the CLI-parity question apply there too, or is ICM exempt? RFC #9 only audited claude-mem.

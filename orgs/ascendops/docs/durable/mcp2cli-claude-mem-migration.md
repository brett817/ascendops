# mcp2cli → claude-mem Migration Plan

**Author:** Collie
**Date:** 2026-04-29
**Status:** Soak prep complete; per-agent migration pending David greenlight.
**Trigger:** RFC #9 §3.2 verdict was REPLACE-WITH-CLI but the LL parity audit (`docs/claude-mem-cli-parity.md`) found zero query subcommands in the native claude-mem CLI. Python `mcp2cli` wraps any MCP stdio server as on-demand CLI subcommands and gives us a third path: replace the MCP from each agent's bootstrap WITHOUT waiting for upstream to add CLI parity.

## §1 Why we are doing this

- RFC #9 verdict on `claude-mem` was REPLACE-WITH-CLI, blocked by the LL audit finding (CLI has only daemon + lifecycle + hook commands, no `search` / `timeline` / `get_observations`).
- David approved Python `mcp2cli` (2026-04-29) as the replacement path. mcp2cli auto-generates CLI subcommands from any MCP server's tool list, so we get the same capability without an upstream PR.
- Net: agents stop loading 7 deferred-tool entries on every boot and instead invoke `claude-mem-mcp <subcommand>` on demand.

## §2 Current state

- **Plugin location:** `/Users/davidhunter/.claude/plugins/cache/thedotmack/claude-mem/12.0.1/` (plugin name `claude-mem-plugin@12.0.1`, the actual MCP-search server is v10.3.1).
- **MCP registration** (per `.mcp.json` in the plugin tree):
  ```json
  { "mcpServers": { "mcp-search": { "type": "stdio",
    "command": "${CLAUDE_PLUGIN_ROOT}/scripts/mcp-server.cjs" } } }
  ```
- **Tools surfaced today** (~7 deferred entries per agent boot): `____IMPORTANT`, `search`, `timeline`, `get-observations`, `smart-search`, `smart-unfold`, `smart-outline`.
- **Affected agents:** Dane, Aussie, Blue, Collie — all 4 currently have the plugin loaded via `enabledPlugins` in user settings (it is not per-agent enabled in `.mcp.json` files).

## §3 mcp2cli setup (cookbook — already executed locally, this is the recipe)

```bash
# 1. Install mcp2cli
uv tool install mcp2cli
which mcp2cli && mcp2cli --version    # → mcp2cli 3.0.2

# 2. Bake the claude-mem profile under a non-colliding name
#    (the alias `claude-mem` is taken by the worker-service.cjs daemon CLI;
#    we use `claude-mem-mcp` to avoid both the alias and the binary at
#    `~/.claude/plugins/cache/thedotmack/claude-mem/12.0.1/scripts/claude-mem`.)
CMD="node /Users/davidhunter/.claude/plugins/cache/thedotmack/claude-mem/12.0.1/scripts/mcp-server.cjs"
mcp2cli bake create claude-mem-mcp --mcp-stdio "$CMD"
mcp2cli bake install claude-mem-mcp        # installs ~/.local/bin/claude-mem-mcp wrapper

# 3. Verify
claude-mem-mcp --list                       # prints all 7 MCP tools as subcommands
mcp2cli bake list                           # confirms the profile exists
```

## §4 Per-agent migration steps (DO NOT EXECUTE YET — pending David greenlight)

For each of Dane / Aussie / Blue / Collie:

1. Confirm the plugin's MCP is currently auto-loaded via `enabledPlugins` (check `~/.claude/settings.json`).
2. Decide the disable surface:
   - **Option A (per-agent .mcp.json override):** add `"mcp-search": null` (or equivalent disable directive) to each agent's `.mcp.json`. Lowest blast radius; reversible per-agent.
   - **Option B (user-settings level):** remove `claude-mem` from `enabledPlugins` globally. Higher blast radius; affects every Claude Code session on the machine.
   - Lean A.
3. Update each agent's `CLAUDE.md` and `TOOLS.md`: replace any guidance that mentions `mcp__plugin_claude-mem__*` tools with `claude-mem-mcp <subcommand>` invocation patterns.
4. Stop+restart each agent: `cortextos stop <agent> && cortextos start <agent>`.
5. Verify via `cortextos status` and a quick smoke (e.g. ask the agent to run `claude-mem-mcp get-observations --ids '[<known-id>]'`).
6. Soak for 1 week; revert via §7 if any agent reports loss-of-function.

## §5 Smoke-test results (3 representative ops, run 2026-04-29 morning)

| Op | Invocation | Result |
|---|---|---|
| `get-observations` | `claude-mem-mcp get-observations --ids '[15173]'` | ✅ FULL parity. Returns the same JSON structure as the MCP tool — id, title, narrative, facts, files_modified, etc. |
| `search` | `claude-mem-mcp search` (and variants `--query`, positional) | ⚠️ Tool callable but `mcp2cli` 3.0.2 does NOT auto-expose the `query`, `limit`, `project`, `dateStart`, etc. params as CLI flags. CLI errors with `Worker API error (400): Either query or filters required`. The MCP-side schema lists those params in the human description, but apparently not as structured JSONSchema fields that mcp2cli can parse. |
| `timeline` | `claude-mem-mcp timeline` | ⚠️ Same issue as `search` — errors with `Must provide either "anchor" or "query" parameter`. Param surface is documented in --verbose listing but no CLI flags are generated. |

**Net:** of 7 tools, **`get-observations` has full parity today**. The 6 others (`search`, `timeline`, `smart-search`, `smart-unfold`, `smart-outline`, `____IMPORTANT`) are all callable but cannot accept input params via CLI flags. They are reachable through `mcp2cli` but currently unusable for query-driven operations.

This is an `mcp2cli`-side limitation, not a claude-mem MCP limitation: the upstream MCP tools likely need stricter JSONSchema annotations on their `inputSchema` for `mcp2cli` to auto-generate CLI flags. Either (a) file an upstream issue against `thedotmack/claude-mem` to add JSONSchema field declarations, or (b) file an issue against `mcp2cli` to handle description-only params.

## §6 Schema-tax savings (measured)

- **Today:** 7 deferred tool entries per agent boot. From the LL audit (`docs/claude-mem-cli-parity.md` §5), this is ~300 tokens/boot in the deferred-tool listing block.
- **Post-migration:** 0 tool schemas at boot (CLI invoked on demand; no MCP server registered for the agent).
- **Per-week fleet impact:** ~300 tokens × 4 agents × ~30 boots/week ≈ **36k tokens/week saved**. Trivial absolute cost (well under 0.1% of the weekly cap), but the architectural principle is right.
- The bigger win is removing 7 entries from every agent's `available-tools` list — reduces tool-search surface and noise.

## §7 Rollback (exact steps if migration regresses)

1. Re-enable the MCP — undo whichever disable surface was used in §4 step 2 (re-add the plugin to `enabledPlugins` or remove the per-agent override).
2. Stop+restart the affected agent(s).
3. Verify the deferred-tools list contains the `mcp__plugin_claude-mem__*` entries again.
4. mcp2cli bake stays installed (no harm — it's an opt-in CLI). To uninstall: `mcp2cli bake remove claude-mem-mcp && rm ~/.local/bin/claude-mem-mcp && uv tool uninstall mcp2cli`.

Total rollback time: ~5 minutes per agent.

## §8 Open questions for David

1. **Disable surface (§4 step 2):** prefer Option A (per-agent .mcp.json override) or Option B (remove from `enabledPlugins`)? Lean A.
2. **Search/timeline gap in §5:** acceptable to ship the migration with only `get-observations` working, or block on fixing the JSONSchema-to-CLI-flag gap first? Workaround: agents that need search/timeline can keep the MCP loaded; agents that only need observation lookup migrate now.
3. **Which agent goes first as canary?** Lean Aussie (lowest live-traffic, easiest to revert without operational impact).
4. **Upstream issues:** want PRs filed against `thedotmack/claude-mem` (JSONSchema annotations) and/or `mcp2cli` (description-only param handling), or stay local-only until soak proves the pattern is worth it?
5. **Same approach for `icm`?** ICM's MCP surface is much larger (~80 tools) — `mcp2cli` would let us flip ICM the same way and the savings would be significantly larger. Worth a separate batch?

# Semble Spike Results — 2026-05-18

**Spike owner:** Collie
**Duration:** ~50 min (under 90-min cap)
**Source brief:** `/Users/davidhunter/cortextos/docs/minish-semble-model2vec-shelf-2026-05-18.md`
**Verdict:** **ROLL-OUT (Collie trial)** — fleet rollout deferred to post-trial review

---

## Phase 1 — Install (5 min)

Tooling on box (Collie's user account):
- python3 3.14.3 (Homebrew)
- uv 0.11.6
- node 25.9.0

Install command (user-level, no sudo):
```bash
uv tool install "semble[mcp]"
```
- Wall time: **5 sec**
- Result: `semble v0.1.8` on PATH at `/Users/davidhunter/.local/bin/semble`
- Subcommands: `search`, `find-related`, `init`, `savings`
- MCP mode invoked via `uvx --from "semble[mcp]" semble` (no daemon to start; MCP client spawns it on demand)

Dependencies pulled (highlights): pydantic, tree-sitter + tree-sitter-language-pack, tokenizers, vicinity, safetensors, sse-starlette. All CPU-only — no torch, no GPU, no Postgres, no Ollama. Self-contained per Minish positioning.

No HF_TOKEN required (one warning logged on first run, harmless). No `OPENAI_API_KEY`. No cloud calls observed.

---

## Phase 2 — Index two repos

Repos under test:

| Repo | Path | Disk | Code files (.ts/.js/.py/.tsx, excl. node_modules) |
|---|---|---|---|
| cortextos | `/Users/davidhunter/cortextos` | 3.3 GB | 13,831 |
| cli-anything-pm | `/Users/davidhunter/projects/cli-anything-pm` | 3.5 MB | 26 |

Semble does NOT persist indexes to disk between CLI invocations. `~/.semble/` contains only `savings.jsonl` (617 B usage log). Each CLI invocation re-indexes from scratch into memory. In MCP mode, the server keeps the index hot for the session and watches the local path for changes.

**Cold-index timings** (CLI mode — first query against a fresh process):
- cli-anything-pm (3.5 MB, 26 files): **18.9 sec** wall time on first search
- cortextos (3.3 GB, ~13.8k code files): **29.7 sec** wall time on first search

Shelf claim ("indexes in ~250 ms") refers to the BM25/embedding pass on already-discovered files — the wall time we see includes tree-sitter parsing, embedding model load, and file enumeration. cortextos finishing in <30 s on 13.8k files is still very respectable; not 250 ms but fine for an MCP-session-warm pattern.

---

## Phase 3 — A/B benchmark

Three real questions Collie would actually ask. For Semble: full stdout captured. For grep+read: representative `grep -rln` + cumulative size of top-3 matched files (what Collie would Read to answer the question today).

| # | Question | Tool | Latency | Lines returned | Chars returned | Reduction (chars) |
|---|---|---|---:|---:|---:|---:|
| 1 | "FastChecker Gmail watch loop implementation" | Semble (warm) | 3,192 ms | 169 | 4,949 | — |
|   |   | grep + read top-3 files | 7 ms (grep) + read | 3,175 | 116,619 | **23.6x** |
| 2 | "http_backend work-entries CRUD" (cli-anything-pm) | Semble (warm) | 453 ms | 185 | 6,227 | — |
|   |   | grep + read top-2 files | 7 ms (grep) + read | 2,859 | 112,573 | **18.1x** |
| 3 | "FastChecker emits inbox message Collie heartbeat picks up" | Semble (warm) | 3,245 ms | 131 | 5,192 | — |
|   |   | grep + read top-3 files | 8 ms (grep) + read | 1,261 | 40,831 | **7.9x** |

**Median reduction: 18.1x chars (~94% fewer chars, lines up with shelf claim of "~98% fewer tokens").**

Semble's own self-reported savings tracker after 6 queries: `~202.5k tokens saved (96%)`.

### Quality assessment

- **Q1 (broad semantic):** Top hit was `src/daemon/fast-checker.ts:35-46` — the FastChecker class doc-comment that literally says "polls Telegram and inbox." Hits #2/3 were `agent-manager.ts` (gmail_watch wiring) and `dashboard/src/lib/watcher.ts`. Hit-rate: 3/5 directly on-target. Quality: **strong**.
- **Q2 (file-specific intent):** Top hit was `cli_anything/propertymeld/http_backend.py:953-983` — the PATCH-work-entries function with the asymmetry-rule doc-comment. Subsequent hits were the matching CLI commands and api_backend. Hit-rate: 5/5 on the right file. Quality: **excellent**.
- **Q3 (multi-hop):** Top hit was the FastChecker class. Hit #2 was the `templates/agent/AGENTS.md` session-start checklist (inbox + heartbeat in the same bullet block). Hit #3 was `src/bus/message.ts` checkInbox export. All three legs of the multi-hop path surfaced in the top 3. grep+read would have required reading 3 files totalling 1,261 lines to assemble the same answer. Quality: **strong** (slight surprise — the AGENTS.md doc hit was the bridge between FastChecker and the heartbeat skill).

No junk hits observed. Even the lowest-scoring hits in each query were topically relevant; ranking degraded gracefully.

### Caveats on the methodology

- Char-count is a proxy for token-cost; the real reduction in Anthropic tokens will be similar order of magnitude. Shelf's "98%" claim is consistent with our 94% observed.
- The grep+read baseline assumed Collie would read 2–3 full files. In practice Collie often reads only relevant chunks via `Read` line-windows, which would narrow the gap somewhat. Even so, 7.9x (worst case) on Q3 is meaningfully cheaper than the current pattern.
- Cold-index cost (~30 s on cortextos) is paid once per MCP session, not per query. In CLI fallback it's paid every invocation — argues for using MCP, not Bash, as the primary surface.

---

## Phase 4 — MCP wired (Collie only)

Created `/Users/davidhunter/cortextos/orgs/ascendops/agents/collie/.mcp.json`:

```json
{
  "mcpServers": {
    "semble": {
      "command": "uvx",
      "args": ["--from", "semble[mcp]", "semble"]
    }
  }
}
```

This is the per-project (per-agent-working-dir) MCP config and is **scoped to Collie only**. Codie/Aussie/Dane/Blue/Relay are unaffected. Verified the pattern matches the existing precedent at `/Users/davidhunter/cortextos/orgs/ascendops/agents/relay/.mcp.json` which scopes the `agentmemory` MCP server to Relay only.

Activation: takes effect on Collie's next session start (or restart). MCP tools exposed will be `search` and `find_related`.

No edits to `~/.claude/mcp.json` (which is global and would have leaked Semble to every Claude Code surface on the box).

---

## Verdict: ROLL-OUT (Collie trial)

**One paragraph reasoning:** Semble cleared the >3x token-reduction bar on all three benchmark questions (7.9x worst, 23.6x best, 18.1x median), with quality holding up on the hardest multi-hop case. Install was 5 seconds, no toolchain surprises, no cloud dependency, no GPU, MIT license, fully self-hosted — checks every box for the AscendOps-self-hosted-forever lock. Wired into Collie's `.mcp.json` only; no fleet-wide change. Trial Collie for one heartbeat cycle (~24 h), confirm no regressions, then propose Phase-2 rollout to Codie + Aussie + Dane.

### Rollout instructions (post-trial, NOT executed yet)

If after 24 h on Collie there are no regressions, the same one-line `.mcp.json` block can be dropped into each of:
- `/Users/davidhunter/cortextos/orgs/ascendops/agents/codie/.mcp.json`
- `/Users/davidhunter/cortextos/orgs/ascendops/agents/aussie/.mcp.json`
- `/Users/davidhunter/cortextos/orgs/ascendops/agents/dane/.mcp.json`

Optional: append a "Code Search — prefer Semble over grep" snippet to each agent's `CLAUDE.md` so the agent reaches for Semble first on broad semantic questions and falls back to grep only for exact-literal matches. Wording lives in the Semble README under the "AGENTS.md snippet" section.

DO NOT install Semble globally via `~/.claude/mcp.json` — keep it project-scoped so Blue, Relay, and ad-hoc Claude Code sessions stay clean.

### What to re-check on the next pass
- MCP session warmup behavior — does the index actually stay hot across multiple queries in a single session, or does each `mcp__semble__search` tool call re-index? Worth measuring after 24 h of real Collie traffic.
- Whether Semble's `find_related` adds value over `search` alone on Collie's actual workload — currently untested.
- Whether to also wire Bash/CLI access for sub-agents (Codex CLI sub-agents can't call MCP and would need the `semble` binary on PATH plus the AGENTS.md snippet).

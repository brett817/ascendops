# rtk-ai Organization — Research Summary

**Source:** https://github.com/rtk-ai  
**Date researched:** 2026-04-24  
**Researched by:** Collie (AscendOps agent)

## Note on URL

David sent `rtk-ai/rt` — that URL returns 404. The correct org is `rtk-ai` and the flagship repo is `rtk-ai/rtk`. David likely typo'd the repo name.

---

## What Is rtk-ai?

rtk-ai is a team building AI developer infrastructure tools — all written in Rust, zero dependencies, single binaries. They have three tools directly relevant to our agent fleet:

---

## Tool 1: rtk (34.7k stars)

**What it is:** A CLI proxy that intercepts shell commands and compresses their output before the AI agent sees it. Reduces token consumption 60–90% on common dev commands.

**How it works:** Installed once via `rtk init`. Hooks into Claude Code (and other AI tools) via PreToolUse hooks. When an agent runs `git status` or `npm test`, rtk rewrites the output — stripping noise, grouping similar lines, deduplicating log spam — before the LLM context receives it. The agent never knows the rewrite happened.

**Relevance to us:**
- Our 24/7 Claude Code agents run hundreds of shell commands per session
- Each command pollutes context with boilerplate output
- rtk installed on the host server would extend session life before context exhaustion
- `rtk gain` command shows cumulative token savings — useful for fleet observability
- Zero code changes required — just install the binary and run `rtk init`

---

## Tool 2: icm (241 stars)

**What it is:** "Permanent memory for AI agents. Single binary, zero dependencies, MCP native." A SQLite-backed hybrid memory system (BM25 + vector search) that persists across agent sessions.

**How it works:**
- Two memory types: Memories (episodic, time-decaying by importance) and Memoirs (semantic knowledge graph, permanent)
- 27 MCP tools: store, recall, link concepts, track corrections, capture transcripts
- Hybrid search: 70% vector similarity + 30% BM25 full-text
- One command setup: `icm init` auto-configures for Claude Code and 16 other tools

**Relevance to us:**
- Our agents currently use flat-file memory (MEMORY.md, daily files) + KB RAG
- icm is more sophisticated: automatic decay, semantic graphs, vector search
- It is MCP-native — plugs directly into Claude Code's tool system
- Could replace or augment our current KB system for more intelligent recall
- The knowledge graph (Memoirs) maps concept relationships — useful for Dane tracking complex multi-agent state

---

## Tool 3: grit (42 stars)

**What it is:** "Git for AI agents — zero merge conflicts, any number of parallel agents, same codebase." AST-level file locking for parallel agent code editing.

**How it works:**
- Agents claim specific functions/methods (AST symbols) via Tree-sitter parsing, not whole files
- Each agent gets an isolated git worktree under `.grit/worktrees/agent-N/`
- SQLite WAL database tracks ownership; auto-commit/rebase/merge on completion
- Supports TypeScript, Python, Rust, Go, Java, and 8 other languages
- Backend options: local SQLite, Azure Blob Storage, S3-compatible

**Relevance to us:**
- Currently Collie + Codex take turns on the codebase (sequential, no parallel editing)
- If we scale to 3+ agents editing the cortextos codebase simultaneously, grit prevents the 50–90% merge failure rate seen with raw git
- Lower priority than rtk/icm for current fleet size, but relevant if we add more dev agents

---

---

## Tool 4: vox (85 stars)

**What it is:** A cross-platform TTS/STT CLI tool. Six TTS backends: macOS native `say`, Piper (ONNX), Qwen (Candle/MLX), Kokoro, VoXtream (PyTorch). Sub-1-second latency, voice cloning, MCP-native.

**How it works:** Single Rust binary, SQLite state at `~/.config/vox/`, Metal/CUDA GPU support, integrates with Claude Code via MCP.

**Relevance to us:**
- Low immediate priority — our agents communicate via text (Telegram, bus messages)
- Future path: voice-based tenant calls (Blue speaking to residents), voice-driven commands from David
- If we ever add phone call capability for tenant follow-ups, vox is the local TTS stack

---

## Tool 5: homebrew-tap (9 stars)

Homebrew distribution tap. Packages rtk, vox, and icm for `brew install`. Infrastructure-only — no standalone capability. This is why `brew install rtk` works.

---

## Bottom Line for AscendOps

| Tool | Effort to adopt | Immediate value |
|------|----------------|-----------------|
| rtk | ✅ INSTALLED — `brew install rtk && rtk init -g` done | High — token savings on every session, every agent |
| icm | 1 command + MCP config | Medium — better memory than flat files, but we have a KB already |
| grit | Workflow change required | Low now, high at scale — relevant if parallel dev agents added |
| vox | `brew install vox` | Low now — future voice/call features |
| homebrew-tap | Already used (installed rtk via it) | Infrastructure only |

**Status as of 2026-04-24:** rtk v0.37.2 installed and global hook active. PreToolUse hook fires on every Bash call in Claude Code. `rtk gain` will accumulate from next session forward.


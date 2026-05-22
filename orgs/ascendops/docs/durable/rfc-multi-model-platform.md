# RFC: Multi-Model Agent Platform — vendor adapters for Claude / GPT-5.5 / Gemini / Grok

**Author:** Collie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review
**Item:** Thursday plate #3 (of 13)
**Companion:** Implementation deferred — Aussie + Codex on Thu earliest.

---

## 1. Problem

Every cortextos agent today launches the Anthropic `claude` CLI:
- `src/pty/agent-pty.ts:145` calls `getBinaryName()` which currently hardcodes `"claude"`.
- `src/pty/agent-pty.ts:144` builds `claudeArgs` via `buildClaudeArgs()`, which appends `--model <id>` from `resolveModel(this.config)` (line 214).
- The `--model` value is one of Claude's IDs (`claude-opus-4-7`, `claude-haiku-4-5-20251001`, etc.).

Single-vendor lock-in costs us in three ways:

1. **Ceiling on cost optimization.** Anthropic's volume pricing is fixed; we have no leverage to play vendors against one another or pick cheaper models for cheap tasks.
2. **Capability gaps we can't reach.** Gemini 2.5 Pro reports a 2M-token context window vs. Claude's 200k — would let Dane bootstrap from a single mega-context instead of paying RAG cost on memory pointers (RFC #2). GPT-5.5 has structured-output mode and stronger function-calling-by-default. Grok integrates xAI's tools natively. Each vendor wins on something.
3. **Risk concentration.** A single Anthropic outage or quota cap freezes the entire fleet. Tonight we already absorbed a 2-failed-Codex-dispatch + 80%-cap workflow — both of which would have been routed to Claude anyway under single vendor.

cortextOS already proves multi-vendor works: the `codex-companion` runtime at `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs` spawns the OpenAI `codex` CLI from inside a Claude session via the rescue subagent. The infrastructure to shell out to other vendor CLIs exists; it just isn't wired into the agent-process spawn path.

## 2. Goals / Non-Goals

**Goals**
- Per-agent vendor + model choice in `config.json`, with the existing `model_tiers` resolver (`src/utils/model-tiers.js`) generalized to multi-vendor.
- Explicit adapter interface every vendor implements; common surface area = chat, tool use, streaming.
- Migration path that moves one agent at a time without touching the rest of the fleet.
- Capability + cost matrix maintained alongside the adapters as a living doc.

**Non-Goals**
- **Routing layer that auto-picks model per task.** That's a separate RFC and depends on having all four adapters working first.
- **Fine-grained model fallback within a turn.** Adapter swap happens at agent boot, not mid-conversation.
- **Replacing the `claude` CLI for prompt cache management.** Where Anthropic's cache is best-in-class for our workload, adapters expose a "no-cache" mode for vendors that don't support it.
- **Unified streaming format.** Adapters normalize to one internal event stream; raw vendor wire formats stay opaque.

## 3. Per-Agent Model Config

Extend `config.json`:

```json
{
  "vendor": "anthropic" | "openai" | "google" | "xai",
  "model_id": "claude-opus-4-7",
  "api_key_env": "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "GEMINI_API_KEY" | "XAI_API_KEY",
  "fallback_chain": ["anthropic:claude-opus-4-7", "openai:gpt-5.5", "google:gemini-2.5-pro"],
  "thinking_budget": 5000000,
  "max_session_tokens": 8000000,
  "vendor_options": {
    "anthropic": { "prompt_cache": true, "extended_thinking": true },
    "openai": { "structured_output": false },
    "google": { "context_size": "2m" },
    "xai": { }
  }
}
```

Backwards compat: a config missing `vendor` defaults to `anthropic`, exactly today's behavior. `thinking` is the existing field renamed/promoted; no current agent needs migration.

`api_key_env` controls *which* env var the adapter reads — this lets agents share the same `secrets.env` (already loaded at `agent-pty.ts:82`) but pin different vendors. Agents can rotate vendor without rotating creds — only flip `vendor` + `model_id`.

`fallback_chain` is read by the spawn path: if primary vendor returns vendor-specific quota/rate-limit error during the boot health-check, the spawner walks the chain and uses the next.

## 4. Adapter Interface

Every adapter ships a Node module at `src/pty/adapters/<vendor>.ts` exporting:

```typescript
interface VendorAdapter {
  name: 'anthropic' | 'openai' | 'google' | 'xai';
  binary: string;                         // CLI binary name (claude / codex / gemini / grok)
  resolveModel(config: AgentConfig): string;
  buildArgs(mode: 'fresh' | 'continue', prompt: string, env: Record<string, string>): string[];
  capabilities: VendorCapabilities;       // see §6
  validateAuth(env: Record<string, string>): Promise<{ ok: boolean; reason?: string }>;
  // Optional, only for vendors that support it:
  promptCache?: { write(key: string, content: string): void; read(key: string): string | null };
  extendedThinking?: { build(budget: number): string[] };
}
```

`AgentPTY.spawn()` (`agent-pty.ts:53`) becomes:

```typescript
const adapter = loadAdapter(this.config.vendor || 'anthropic');
const cmd = adapter.binary;
const args = adapter.buildArgs(mode, prompt, ptyEnv);
this.pty = this.spawnFn!(cmd, args, { /* ...same env... */ });
```

Authentication: each adapter validates its required env var (`api_key_env`) at boot. Failing validation triggers the `fallback_chain` walk before crashing.

## 5. Per-Vendor Adapter Notes

### 5.1 Anthropic (current default, baseline)
Keep current behavior verbatim. Adapter wraps existing `getBinaryName()` + `buildClaudeArgs()` (`agent-pty.ts:196, 205`). Capability flags: prompt cache ✓, extended thinking ✓, vision ✓, tool use ✓, streaming ✓. Reference implementation — others are measured against this.

### 5.2 OpenAI (GPT-5.5)
Already partially built. The codex-companion runtime at `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs` (1007 LOC) shells out to the `codex` CLI; the `codex` binary itself accepts `--model`, `--effort`, `--write`, `--resume-last`, etc. The `codex-cli-runtime` SKILL documents the contract.

For agent-mode (not subagent rescue) we need: persistent multi-turn session (codex CLI supports `--resume-last`), tool use that maps cleanly from Claude's tool format, and equivalent of `--dangerously-skip-permissions` (codex's `--write` is the closest but not identical — codex sandboxes by default).

Capability gaps vs. Anthropic baseline:
- **No prompt cache** (or different semantics — must verify against current OpenAI docs at write time).
- **Tool format differs** — adapter rewrites Anthropic-tool JSON ↔ OpenAI function-call JSON.
- **Effort levels** (`none|minimal|low|medium|high|xhigh`) replace Anthropic's `thinking_budget` integer; adapter maps budget → effort tier.

Existing infra leverage: agent-pty.ts already loads `OPENAI_KEY` from `orgs/<org>/secrets.env` (line 82 comment cites it). codex-companion's `getCodexAvailability()` is a ready-made `validateAuth()`.

### 5.3 Google Gemini
Capability: 2M context, native function calling, native vision, no native prompt cache (as of training cutoff Jan 2026 — verify at impl time). CLI: `gemini` (Vertex AI Go binary) or `gcloud ai models invoke` — both available on macOS.

Adapter must:
- Map Anthropic tool schema to Gemini's `function_declarations` shape.
- Synthesize prompt-cache equivalent via Gemini's cached-content API (separate REST call before inference); cost-effective only at >32k cached tokens.
- Stream via `streamGenerateContent`.

Win cases: Dane bootstrap (full ~30-58k bootstrap fits as cached prefix); long-context research where memory pointers expand to >100k tokens.

### 5.4 xAI Grok
Capability gap analysis: Grok-3 (Jan 2026 release) has chat + tool use + streaming; tool ecosystem narrower than OpenAI/Anthropic. CLI options unclear at training time — may require building a thin adapter directly against the xAI HTTP API rather than wrapping a binary.

Adapter strategy: HTTP-only, no spawned binary. `binary` field is `null`; adapter implements its own PTY-like loop using HTTP + SSE streaming. Higher integration cost than vendors with mature CLIs; deprioritize until Anthropic + OpenAI + Gemini are landed.

## 6. Capability Matrix

| Feature | Anthropic | OpenAI | Gemini | Grok |
|---|---|---|---|---|
| Prompt cache (native) | ✓ | partial / verify | ✗ (synth via cached-content) | ✗ |
| Extended thinking / reasoning | ✓ (budget int) | ✓ (effort tier) | ✓ ("thinking" mode) | ? |
| Tool use | ✓ | ✓ | ✓ | ✓ (narrower) |
| Streaming | ✓ | ✓ | ✓ | ✓ |
| Vision | ✓ | ✓ | ✓ | partial |
| Audio in/out | partial | ✓ | ✓ | ✗ |
| Max context | 200k | ~400k (5.5) | 2M | 128k |
| Max output | 8k | ~16k | 8k | 8k |
| CLI exists today | ✓ (claude) | ✓ (codex) | ✓ (gemini) | ✗ |

`?` and `partial` cells = open question, verify at impl.

## 7. Cost at Typical Dane Workload

Dane workload measured tonight: ~30k bootstrap + ~50k/day operational = ~80k input + ~10k output per active day. Multiplied across the ~12 active fleet days/month = ~1M input + 120k output / month per orchestrator-class agent.

**Pricing data is OPEN** — Jan 2026 published rates are training-cutoff-stale and have likely shifted. Adapter ships with a `cost_per_mtok_in` / `cost_per_mtok_out` field per vendor + model, source-cited and reviewed quarterly. Decision matrix runs against live rates at choose-vendor-per-agent time, not baked into this RFC.

What I can say without inventing numbers: Anthropic-Opus is the *most expensive* of the four for input tokens (Jan 2026 published rate). Gemini-Pro is typically cheapest. GPT-5.5 sits in the middle. Grok pricing is per-month tier rather than per-token at xAI today.

## 8. Migration

1. Land adapter interface + Anthropic adapter as a refactor — zero behavior change. (1-2 days)
2. Land OpenAI adapter, leveraging codex-companion. Test on one specialist agent (Aussie). (2-3 days)
3. Land Gemini adapter. Test on Dane bootstrap with full memory expanded into the 2M context window. (3-5 days)
4. Land Grok adapter (HTTP-only, lower priority). (3-5 days)
5. Capability matrix + cost-per-vendor doc lives at `orgs/ascendops/docs/multi-model-matrix.md`, refreshed quarterly.

Per-agent migration: flip `vendor` in their `config.json`, `cortextos hard-restart`. Watch for 2 days. Revert by flipping back. No data migration; conversations are vendor-specific anyway and a hard restart starts fresh.

## 9. Open Questions for David

1. **xAI Grok priority** — adapter takes the most work for unclear capability win. Cut it from MVP and revisit only if pricing or capability moves?
2. **`fallback_chain` semantics** — auto-fallback on quota errors during a session, or only at boot?
3. **Tool-format normalization** — does cortextOS standardize on Anthropic's tool JSON (current internal format) or move to OpenAI's function-call format (more vendors compatible)?
4. **Pricing-source ground truth** — should we ship a `cortextos pricing refresh` command that pulls from each vendor's published API or doc page weekly?
5. **First migration target** — which agent moves first? Recommend Collie (low-stakes specialist, easy to soak/revert) over Blue (chat-facing, user-visible failure cost).

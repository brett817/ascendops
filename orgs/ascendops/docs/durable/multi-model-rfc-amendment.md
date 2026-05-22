# Multi-Model RFC Amendment — sub-only MVP

**Date:** 2026-04-29 (Wed PM)
**Author:** Aussie (Dane dispatch, David greenlit)
**Source RFC:** [rfc-multi-model-platform.md](rfc-multi-model-platform.md) (Collie, 2026-04-29)
**Implementation:** Aussie + Codex pair, Thu day-shift.

David's constraint, verbatim: "I dont wanna over engineer it. I just wanna make sure it works." Subscription-only auth, no API keys, 3 adapters MVP (Anthropic / OpenAI / Gemini), drop the rest.

## Source-RFC corrections (discovered at implementation time)

- **§5.2 "codex CLI supports `--resume-last`" is wrong.** Current Codex CLI exposes session resume as a subcommand: `codex resume --last [PROMPT]`, not a flag on the base `codex` invocation. The OpenAI adapter prepends `["resume", "--last"]` for continue mode (see `src/pty/adapters/openai.ts`).
- **§5.2 mentions `--yolo` for Codex bypass.** Works on base `codex`, but `--yolo` is **not documented on `codex resume`**. We ship canonical `--dangerously-bypass-approvals-and-sandbox` for both fresh and continue, since it is documented and accepted on both code paths.
- **`vi.mock('node-pty')` does not reliably intercept the CJS `require()` inside `AgentPTY.spawn()`.** Three mock patterns failed during integration-test scaffolding (closure-captured `vi.fn()`, `vi.hoisted` returning a wrapped arrow, `vi.hoisted` returning the bare `vi.fn`). The pattern that works: skip the lazy `require` entirely by injecting the spawn mock directly onto the private field before calling `spawn()` — `(pty as unknown as { spawnFn: unknown }).spawnFn = mocks.spawn`. Clean, test-local, no production-code change needed. See `tests/integration/pty/vendor-flip.test.ts` `spawnAndCapture()` for the canonical shape; reuse it for any future CJS-require-mocking integration test.

## §3 — Config schema fixes

- **Rename `api_key_env` → `auth_home_env`.** Holds the env var that points the CLI at its sub credential dir (Claude `~/.claude`, Codex `~/.codex`, Gemini `~/.gemini`). Unset = CLI uses default `$HOME`. Default adapter behavior is native sub auth — never inject API keys. CAO providers confirm all three work this way out of the box.
- **Drop `fallback_chain`.** No auto-fallback at MVP. Auth fail → hard-restart on the same vendor. Auto-fallback is its own RFC.
- **Drop `vendor_options.xai` and `vendor_options.openai.structured_output`.** Keep only fields an adapter consumes.
- `vendor` defaults to `anthropic` if missing — keep RFC's backwards-compat clause.

## Drops from RFC body

Grok §5.4 (no CLI, HTTP-only). OpenRouter. `cortextos doctor`. Per-vendor rate limiting (CLIs surface their own quota errors; hard-restart on detection). @mention routing. HTTP-per-agent transport. node-pty + CLI binary only.

## CAO patterns to ADOPT

1. **Bypass-prompt flags per vendor.** Anthropic: `--dangerously-skip-permissions`. Codex: `--dangerously-bypass-approvals-and-sandbox --no-alt-screen --disable shell_snapshot` — last two are critical, they prevent SIGTTIN/TTY conflicts under our PTY. Note: CAO codex.py uses `--yolo` shorthand, but `--yolo` is **not documented on the `codex resume` subcommand** in current Codex CLI; canonical `--dangerously-bypass-approvals-and-sandbox` is parallel across both fresh and continue invocations and is what we ship. Gemini: `--yolo --sandbox false`.
2. **Unset `CLAUDE_*` env vars on non-Claude child spawn.** cortextOS spawns from a Claude Code session whose env carries `CLAUDE_CODE_SKIP_*_AUTH`; leaking these into Codex/Gemini corrupts their auth. Hook into `agent-pty.ts` env-build path.
3. **Bracketed-paste Enter count, per adapter.** Claude/Gemini need double-Enter; Codex needs single. Default 2, Codex override 1.
4. **Gemini extraction retries.** Ink renderer's notification spinners can obscure response text 10–15s. Borrow `extraction_retries: 2` for Gemini if/when status detection bites.
5. **`--model <id>` is universal.** All three accept it. Keep existing `resolveModel()`, generalize the model-ID namespace per vendor.

## CAO patterns to SKIP

1. tmux-based screen-scrape status detection — cortextOS uses heartbeat files; different domain.
2. `TerminalStatus` enum (IDLE/PROCESSING/COMPLETED) — not needed.
3. Per-vendor tool-allowlist translation — cortextOS already authorizes tools at its own boundary.
4. `_apply_skill_prompt` system-prompt injection — our skills live on disk under `.claude/skills/`.
5. Gemini Policy Engine deny rules — CLI `--yolo` + cortextOS hooks are enough.
6. CAO's MCP config injection — `templates/agent/.mcp.json` already covers it.

## §4 — Trimmed adapter interface (as shipped, 6 fields)

`resolveModel` was consolidated into `buildArgs` during the Anthropic refactor — adapters read `ctx.config.model` directly inside their own `buildArgs`, no separate method needed. Dropping it brings the interface to 6 fields:

```typescript
interface AdapterContext {
  config: AgentConfig;
  env: CtxEnv;
}

interface VendorAdapter {
  name: 'anthropic' | 'openai' | 'google';
  binary: string;                    // 'claude' | 'codex' | 'gemini'
  buildArgs(mode: 'fresh' | 'continue', prompt: string, ctx: AdapterContext): string[];
  envFilter(env: Record<string,string>): Record<string,string>;  // strip CLAUDE_* for non-claude
  pasteEnterCount: 1 | 2;            // 2 default, 1 for codex
  extractionRetries: number;         // 0 default, 2 for gemini
}
```

Drop `validateAuth`, `promptCache`, `extendedThinking`, `resolveModel` from MVP — add when an agent actually needs them. Source of truth: `src/pty/adapters/base.ts`.

## Migration order

1. Anthropic — pure refactor, zero behavior change.
2. OpenAI — soak on Aussie (low-stakes, easy revert).
3. Gemini — soak on Dane bootstrap to capture 2M-context win.

Per-agent flip = `vendor` + `model_id` in `config.json`, hard-restart, watch 2 days, revert by flipping back. RFC §9 #3 (tool-format normalization), #4 (pricing command), #5 (first target) punted to post-MVP.

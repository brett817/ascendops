# Multi-Model Migration Runbook

**Audience:** orchestrator (Dane) dispatching a vendor flip, the migrating agent itself running the restart, Aussie monitoring soak telemetry.
**Scope:** flip a single agent from Anthropic to OpenAI (codex) or Google (gemini) in production. One agent at a time.
**Reference:** [rfc-multi-model-platform.md](rfc-multi-model-platform.md) (Collie, source RFC) and [multi-model-rfc-amendment.md](multi-model-rfc-amendment.md) (Aussie, sub-only delta + implementation corrections). Adapter source of truth: `src/pty/adapters/`.

---

## 1. Pre-flight checklist

Run all of these before touching `config.json`. If any item fails, stop and resolve before flipping.

- **Vendor binary on PATH.** OpenAI: `which codex` returns a path. Google: `which gemini` returns a path. Hermes runtime is unaffected — vendor flip only applies when `runtime` is `claude-code` (default).
- **Native auth set up.** OpenAI: `codex login` completed; auth dir at `~/.codex` (or wherever `CODEX_HOME` points). Google: `gemini` opens without an auth prompt; auth dir at `~/.gemini`. **No API keys.** Sub auth only per the amendment doc §3.
- **CODEX_HOME set (if rotating seats).** If David has wired the 2-seat rotation (`~/.codex-seats/seat-{a,b}`), confirm `CODEX_HOME` is exported in the migrating agent's `.env` or org `secrets.env`. Adapter just honors whatever is set.
- **Current agent healthy.** `cortextos bus read-all-heartbeats --format json` — last heartbeat for the migrating agent must be < 1 cycle stale. Don't migrate a degraded agent.
- **No active in-progress tasks.** `cortextos bus list-tasks --agent <name> --status in_progress`. Either complete them on the current vendor first or document that the in-flight context will be lost (vendor sessions are not portable — see §5).
- **Memory + handoff fresh.** Today's `memory/YYYY-MM-DD.md` and the rolling handoff are written. Vendor flip is effectively a hard restart; durable memory is the only continuity.
- **Soak window scheduled.** 2 days minimum per RFC §8. Don't start a flip on a Friday afternoon or before a freeze.

---

## 2. Flip — config.json edit

Single file edit at `orgs/<org>/agents/<agent>/config.json`:

```jsonc
{
  // existing fields unchanged
  "vendor": "openai",          // or "google"; default "anthropic" if omitted
  "model": "gpt-5.5"           // or "gemini-2.5-pro"; vendor-specific model ID
}
```

`vendor` accepts `"anthropic" | "openai" | "google"` per `src/types/index.ts:AgentConfig`. Any other value crashes at next spawn with `Unknown vendor: '<x>'. Supported MVP vendors: 'anthropic', 'openai', 'google'.` (validated at `loadAdapter` call inside `AgentPTY.spawn()`).

Boot validation that runs automatically:
- `loadAdapter(config.vendor)` resolves the adapter or throws.
- `adapter.envFilter(ptyEnv)` strips `CLAUDE_*` env vars on non-Anthropic spawns (see amendment §"CAO patterns to ADOPT" #2).
- `adapter.buildArgs(mode, prompt, ctx)` produces the per-vendor CLI invocation. Specifically: codex gets the bypass triple (`--dangerously-bypass-approvals-and-sandbox --no-alt-screen --disable shell_snapshot`); gemini gets `--yolo --sandbox false`.
- `--model <id>` is forwarded to whatever the adapter sets.

What does NOT get validated automatically: that the binary is installed, that auth works, or that the model ID exists for the vendor. Pre-flight is your only safety net there.

---

## 3. Hard restart

```bash
cortextos hard-restart <agent>
```

Hard restart, not soft — soft preserves the Claude-Code conversation history that doesn't translate across vendors anyway. Watch:

- **PTY spawn line** in `~/.cortextos/<instance>/logs/<agent>/stdout.log`. The first line should be the new binary (`codex` or `gemini`), not `claude`. If you still see `claude`, the config edit did not land.
- **Adapter resolution.** No explicit log line yet, but a `Unknown vendor` throw in stderr means `loadAdapter` rejected your value — check spelling.
- **First bus heartbeat.** Within 1 cycle of restart (typically < 4 minutes), `cortextos bus read-all-heartbeats` should show the agent fresh. Stale > 2x cycle interval = abort and roll back per §5.
- **First Telegram online ping.** If the agent has Telegram wired (`CHAT_ID` in `.env`), it should ping within ~30 s of bus heartbeat.

If any of those three checks fail, treat as a failed migration and roll back immediately.

---

## 4. Soak

**Window:** 2 days minimum per RFC §8. Don't shorten unless the agent is genuinely low-stakes.

**Telemetry to watch** (Aussie owns this):

- **Token burn vs prior-vendor baseline.** Pull the last 7 days of the agent's `~/.claude/projects/<agent>/*.jsonl` per-turn usage breakdowns and diff against the prior-vendor baseline in `token-comparison.md`. >25% delta in either direction → flag.
- **Hook gate fires + outcomes.** `hook_fire` telemetry shipped today gives clean per-fire counts; group by `success / block / escalate`. Look for outcome-distribution shifts that correlate with the flip.
- **Completed-task throughput.** `cortextos bus list-tasks --agent <name> --status completed` — daily count over the soak window. Should match or exceed prior-vendor baseline.
- **Error rate.** `~/.cortextos/<instance>/orgs/<org>/analytics/events/<agent>/YYYY-MM-DD.jsonl` filtered to `category == "error"`. Any ERROR severity increase is a soak-fail signal.

**Pass:** all four metrics within ±25% of baseline for 2 consecutive days, zero unrecovered errors. Below the band → roll back, file Codex-pair task.

---

## 5. Roll back

```bash
# Edit config.json: revert "vendor" to its prior value (or remove the field entirely)
cortextos hard-restart <agent>
```

What recovers cleanly:
- Heartbeats, task queue, daily memory file, MEMORY.md, handoff doc — all framework-level, vendor-independent.
- Crons (re-registered on session start from `config.json`).
- Telegram bot wiring, MCP servers, agent .env.

What does NOT recover:
- **Mid-conversation context from the failed-vendor session.** Vendor sessions are session-local; nothing carries from the codex/gemini conversation back to claude. Treat the soak window's running threads as throwaway.
- **In-flight tasks at the moment of revert.** Mark them blocked or re-dispatch fresh.

If the reason for rollback is unclear, capture stdout/stderr logs into `reports/migration-failure-<agent>-<date>.md` before the next attempt.

---

## 6. Common gotchas (captured 2026-04-29 ship night)

All of these are documented in [multi-model-rfc-amendment.md](multi-model-rfc-amendment.md) "Source-RFC corrections" section. Surfaced here so you don't re-discover them at 3 AM:

1. **Codex `resume` is a subcommand, not a flag.** Continue mode produces `codex resume --last [other flags] [PROMPT]`, not `codex --resume-last`. Adapter handles this; doc only matters if you debug a raw spawn.
2. **`--yolo` is not documented on `codex resume`.** Adapter ships canonical `--dangerously-bypass-approvals-and-sandbox` for both fresh and continue.
3. **Gemini has NO CLI-level session resume.** `mode='continue'` falls back to fresh args; conversation history does not survive restart. Plan accordingly for Gemini agents — durable memory is more critical for them.
4. **`CLAUDE_*` env vars must be stripped on non-Claude spawns.** Specifically `CLAUDE_CODE_SKIP_*_AUTH` corrupts Codex/Gemini auth detection. Wired into `AgentPTY.spawn()` via `adapter.envFilter()`; verified in `tests/integration/pty/vendor-flip.test.ts`.
5. **`vi.mock('node-pty')` doesn't intercept the CJS `require()` in `AgentPTY.spawn()`.** For any future integration test that needs the spawn mock, copy `spawnAndCapture()` from `tests/integration/pty/vendor-flip.test.ts` — direct `spawnFn` field injection is the pattern that works.
6. **Local binary verification before first live spawn.** The Gemini adapter shipped without a local `gemini --help` round-trip (binary was not installed at adapter-write time); flags came from CAO's authoritative impl. Verify against `gemini --help` on the migrating host before starting the soak.

---

## 7. Ownership

- **Orchestrator (Dane).** Dispatches the flip task via `cortextos bus send-message <agent> normal '<task>'`. Owns the go/hold call. Monitors fleet health every 4 h heartbeat for the duration of the soak.
- **Migrating agent.** Edits its own `config.json`, runs `cortextos hard-restart`, sends online ping after restart, and runs the standard heartbeat skill on the new vendor.
- **Aussie.** Owns the §4 soak telemetry. Daily token-burn comparison delivered to Dane; any threshold breach pages back to Dane for go/hold-rollback decision.
- **David.** Final approver on first migration target per RFC §9 #5. Subsequent flips Dane-dispatched once the runbook holds — the doc is the contract.

Any §3 or §5 failure not in §6 → file fresh Codex-pair task before re-attempting.

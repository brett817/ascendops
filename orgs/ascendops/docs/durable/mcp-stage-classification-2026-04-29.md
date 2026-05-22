# MCP Stage Classification — 2026-04-29 Snapshot

**Author:** Aussie
**Date:** 2026-04-29 (snapshot date)
**Operationalizes:** RFC #16 §5 per-current-MCP audit
**Status:** Date-stamped. Re-audit on the cadence in §6.

---

## 1. Methodology

RFC #16 §3 trigger signals applied per MCP. For each tool, I check:

- **Call frequency:** observed/estimated calls per agent per day. Threshold for Stage 2: >5/day for >2 weeks.
- **Schema-tax:** estimated tokens of tool schema in every turn's tools array. Threshold for Stage 2: >5K tokens/week per agent.
- **Decision-driven calls:** does the call's parameters or follow-up depend on agent reasoning? If YES → Stage 1 (exploratory) regardless of frequency.
- **Multi-agent invariance:** is the same call shape correct across multiple agents? Threshold for Stage 2: same shape on ≥2 agents.
- **Reasoning boilerplate:** is the agent's prose around the call repetitive >80% of the time?

If 3+ of 5 signals are true AND no anti-signal (decision-driven), tool is Stage 2 — propose conversion. If 0-2 signals, stays Stage 1.

Sources read for this audit:
- `~/.claude/settings.json` (`mcpServers` object — top-level MCPs)
- `~/.claude/settings.local.json` (per-project allowlists, no MCPs declared)
- Session-injected deferred-tool listings (from session-start hook reminders)
- `claude-mem-cli-parity.md` (Collie's LL audit)
- `mcp2cli-claude-mem-migration.md` (Collie's NN doc)

---

## 2. Per-MCP Table

Verified 2026-04-29 against current settings + session reminders:

| MCP | Source | Stage today | Reasoning | Action proposed | Action status |
|---|---|---|---|---|---|
| `icm` | hook + plugin runtime | Stage 1 (eternal) | Proactive memory store is reasoning-driven per turn (CLAUDE.md user instruction). The agent decides what to store, when, what topic. Calls cannot be templated. | KEEP-MCP indefinitely | scheduled (no action) |
| `claude-mem` (search/timeline/etc.) | plugin (`thedotmack`) | Stage 1 (eternal) | Search queries are agent-formulated; results drive next-step reasoning. Per Collie measurement: <0.1% cap savings if converted. mcp2cli proof showed parity gaps. | KEEP-MCP indefinitely | DONE — pushback verdict accepted (Collie NN doc) |
| `claude_ai_Gmail` | session-injected | Stage 3-ready, retiring | Decision-free (`gws` CLI exists, covers same surface). Schema-tax measured ~2K-4K tokens/turn collectively with the trio. RFC #9 §3.4 verdict: REPLACE-WITH-CLI. | DISABLE — Collie working RR in parallel (today) | scheduled |
| `claude_ai_Google_Calendar` | session-injected | Stage 3-ready, retiring | Same as Gmail above; same verdict. | DISABLE alongside Gmail | scheduled |
| `claude_ai_Google_Drive` | session-injected | Stage 3-ready, retiring | Same as Gmail above; same verdict. | DISABLE alongside Gmail | scheduled |
| `agentmemory` (template MCP) | template `.mcp.json` | Stage 0 (deprecated) | Redundant with `icm`. Removed from 4 templates overnight (Collie B). | DEPRECATE | DONE |
| `officecli` | settings.json `mcpServers` | Stage 1 (low-frequency, ambiguous) | Single-machine local Office docs bridge. Usage too rare to know if it would graduate to Stage 2. Flagged as the §5 close call in RFC #16. | PARK at Stage 1; add usage tracking if anyone starts invoking it >5/day | proposed |
| `Playwright` MCP | not currently installed as MCP | n/a | We have the @playwright/cli (just installed) + `from playwright.sync_api import ...` Python lib. No MCP layer between. Codegen IS the Stage 1 → Stage 3 bridge per RFC #16 §4. | NO MCP needed — codegen handles exploration | DONE (architecture choice) |
| `codex` (plugin, not MCP) | plugin (`openai-codex`) | Stage 3 | The plugin wraps the codex CLI; the wrapper is the value, not MCP-bridged tool calls. | KEEP plugin shape | DONE |

**Stage summary:**
- 1 Stage 0 (deprecated, removed): `agentmemory`
- 2 Stage 1 (eternal): `icm`, `claude-mem`
- 3 Stage 3-RETAINED-AS-FALLBACK: `claude_ai_Gmail/Calendar/Drive` (per RFC #16 §4.1, registered in `canonical-and-fallback-registry.md`)
- 1 Stage 1 (low-frequency, parked): `officecli`
- 1 Stage 1→3 bridge tool (no MCP layer): `Playwright` (codegen)
- 1 Stage 3 plugin: `codex`

---

## 3. Stage Transitions In Flight Today

### claude.ai Gmail / Calendar / Drive trio — REVERSED: retain as documented fallback

**Status (updated 2026-04-29 evening):** REVERSED — retained as documented fallback per David direct call. NOT retiring.

**Original trigger sequence (still valid context):**
- RFC #9 §3.4 verdict (REPLACE-WITH-CLI) issued 2026-04-29 morning per `feedback_google_workspace_cli.md` standing rule.
- Multiple session-start hooks this week showed the trio "MCP servers have disconnected" — they're already flaky.
- `gws` CLI covers the same surface and is the documented standard.
- Collie attempted batch RR in parallel.

**Reversal trigger sequence:**
- RR action blocked: `claude mcp remove` cannot operate on harness-injected MCPs (no local config to edit). Technical un-removability surfaced.
- David made the architectural call (2026-04-29 PM): retain trio as documented fallback. Critical Google Workspace infra deserves intentional vendor diversity — `gws` direct + claude.ai trio (Anthropic-mediated) have uncorrelated failure modes.
- Aussie integration-roadmap §4 honest-take had independently flagged the same dependency-hardening concern: "if `gws` breaks, ALL Gmail/Calendar/Drive flows fail with no fallback because we just retired the MCP."
- Schema-tax cost (~0.1% of cap) accepted as insurance premium against canonical-tool outage.
- Both inputs converged on the same outcome: Stage 3-RETAINED-AS-FALLBACK (new category in RFC #16 §4.1).

**Final classification:** Stage 3-RETAINED-AS-FALLBACK as of 2026-04-29 evening. Documented in `canonical-and-fallback-registry.md` (sibling doc).

**Cross-references:**
- RFC #16 §3.5 (session-injected MCPs removability gap) and §4.1 (Stage 3-RETAINED-AS-FALLBACK category definition).
- `canonical-and-fallback-registry.md` (canonical-vs-fallback registry).
- RR cron-ownership ledger entry (now closed by SS — see `cron-ownership.md` §6).

**Rollback path:** if upstream Anthropic later disables the trio outright (or provides per-agent opt-out), document in next quarterly audit and either accept the retirement or look for a new fallback. Until then, no local action.

---

## 4. Sticky Stage 1 — Tools That Never Convert

Two tools we are explicitly committing to NEVER convert, justified per RFC #16 §6 ("inherently exploratory"):

### `icm`
- **Why eternal Stage 1:** the `icm_memory_store` proactive-store pattern is interleaved with reasoning. The agent decides on every significant turn whether something is worth storing, what topic to file under, what importance. There is no stable "always store X when Y" rule that could become a CLI invocation. Even the user's CLAUDE.md hook for ICM is per-turn reactive, not scripted.
- **Stable forever:** yes, until icm gets a fundamentally different surface or the proactive-store pattern itself is replaced.
- **Coexistence:** there's an `icm` CLI binary used by `monthly-tool-maintenance` cron for upgrade/maintenance. CLI handles infrastructure ops; MCP handles reasoning ops. Both stay.

### `claude-mem`
- **Why eternal Stage 1:** `smart_search` / `timeline` / `get_observations` / `smart_unfold` produce large text payloads that the agent then interprets, decides what to keep, possibly iterates on. Search queries are agent-formulated based on the current question. No deterministic invocation pattern.
- **Stable forever:** likely yes — research/recall is fundamentally an exploratory task.
- **Coexistence:** there's a `claude-mem` CLI binary too — used for daemon lifecycle (start/stop) and version-bump. CLI handles ops; MCP handles search. Both stay. The mcp2cli migration that Collie measured: pushed back not because it was architecturally wrong but because (a) parity gaps in mcp2cli 3.0.2 (search/timeline params not auto-exposed as flags) and (b) <0.1% cap savings made it not worth fixing.

**Anti-pattern guard:** if either of these MCPs ever hits the §1 trigger thresholds (3+ signals), it's a sign the workflow has unexpectedly stabilized — investigate that workflow first before considering CLI conversion. Don't convert just because numbers cross thresholds.

---

## 5. Open Questions / Ambiguous Classifications

1. **`officecli` Stage 1 ambiguity** — RFC #16 §5 close call. We have no usage telemetry today. Two paths: (a) park at Stage 1, add usage tracking (count invocations over 30 days), revisit; (b) audit usage retroactively from past sessions, classify based on observed pattern. Lean (a) — cheaper.
2. **`codex` plugin sandbox writable-roots fix (RFC #14)** is NOT an MCP question but an adapter-protocol question. It doesn't fit the lifecycle stages cleanly. Is it worth a parallel "Plugin Stage Classification" doc, or treat plugins as their own thing? Lean: separate doc if more plugins start having lifecycle decisions.
3. **`typescript-lsp` and other LSP plugins:** classified as Stage 3 (CLI-shaped) but they're language servers, not CLI tools. Same question as #2 — does the framework cover LSPs? Lean: out of scope; LSPs are a separate adapter pattern.
4. **Session-injected MCPs** (the Anthropic claude.ai trio) — these are NOT in our settings.json; they appear via session injection. The retire path for these is per-session disable, not config edit. Flag this as a different retirement mechanism than installed MCPs.
5. **Future MCPs we expect to evaluate:** if Anthropic ships a Slack MCP or PagerDuty MCP, they'd likely be Stage 1 → 3 candidates. Pre-register the §1 audit at install time so we don't accumulate Stage 2 drift.

---

## 6. Re-Audit Schedule

This snapshot is dated 2026-04-29. Re-audit cadence:

- **30 days from now (2026-05-29):** mandatory re-audit. Append new snapshot at `orgs/ascendops/docs/mcp-stage-classification-2026-05-29.md`. Track stage transitions vs this baseline.
- **On every new MCP install:** classify upfront per RFC #16 §7 decision tree. Update §2 table inline.
- **On every quarterly review:** validate the "Stage 1 (eternal)" classifications are still correct (icm, claude-mem). Watch for any signal drift.
- **Cron suggestion:** add a `mcp-stage-audit` cron to Aussie's calendar — quarterly (every 90 days) at a low-traffic morning slot. ~30 min of work per audit.

---

## Word count: ~990 (within 600-1000 target)

# Hermes Fleet Integration Spec

**Author:** Collie
**Date:** 2026-04-24
**Status:** Updated — Q1 and Q2 closed from code. Recommendation: Option A. Ready for build approval.
**Goal:** Make Hermes a first-class fleet member in the AscendOps org — visible in `read-all-heartbeats`, reachable via `cortextos bus send-message hermes`, reports back to Dane when tasks complete.

---

## 1. The Bus Is Already Runtime-Agnostic

The good news: the cortextos bus does not care what runtime writes to it. It is purely file-based.

`read-all-heartbeats` scans `~/.cortextos/{instance}/state/*/heartbeat.json` — any process that writes that file appears in the fleet view. No daemon registration required.

`send-message hermes` writes a JSON file to `~/.cortextos/{instance}/inbox/hermes/` — any process that polls that directory can receive it.

The bus itself needs **zero changes** to support Hermes. All the work is on the Hermes side.

---

## 2. What Hermes Needs to Participate

Three operations, all file I/O:

### 2a. Heartbeat (appear alive on the dashboard)

Write `~/.cortextos/{instance}/state/hermes/heartbeat.json` periodically (every 4h at minimum):

```json
{
  "agent": "hermes",
  "org": "ascendops",
  "status": "WORKING ON: <current task>",
  "current_task": "<current task summary>",
  "mode": "day",
  "last_heartbeat": "2026-04-24T12:00:00Z",
  "loop_interval": "4h"
}
```

This can be done via:
- `cortextos bus update-heartbeat "<task>"` if Hermes has shell access
- Direct file write if Hermes is a standalone Python process

### 2b. Inbox polling (receive messages from Dane)

Poll `~/.cortextos/{instance}/inbox/hermes/` every N seconds. Messages are JSON files:

```json
{
  "id": "1777000000000-dane-abc12",
  "from": "dane",
  "to": "hermes",
  "priority": "normal",
  "timestamp": "2026-04-24T12:00:00Z",
  "text": "Research X and report back",
  "reply_to": null
}
```

After processing: move the file to `~/.cortextos/{instance}/inflight/hermes/` (pick up), then to `~/.cortextos/{instance}/processed/hermes/` (ACK). The lock file at `~/.cortextos/{instance}/inbox/hermes/.lock` must be respected to avoid race conditions with the daemon.

Can be done via `cortextos bus check-inbox` (handles locking automatically) if Hermes has shell access, or by implementing the lock protocol in Python directly.

### 2c. Send messages (report back to Dane)

Write a JSON file to `~/.cortextos/{instance}/inbox/dane/`:

```
{pnum}-{epochMs}-from-hermes-{rand5}.json
```

Can be done via `cortextos bus send-message dane normal '<reply>' <reply_to_id>` if shell access is available, or by writing the file directly.

---

## 3. Two Possible Architectures

### Option A: Daemon-managed (HermesPTY — current code path)

The cortextos daemon spawns Hermes as a PTY subprocess, exactly like Claude Code. The existing `HermesPTY` class handles this. FastChecker polls the inbox on Hermes's behalf and injects messages as text into the Hermes PTY.

**Pros:**
- Crash recovery, auto-restart, and inbox polling are all handled by the daemon for free
- No Python polling loop to build or maintain
- Hermes already appears in `read-all-heartbeats` via the daemon's state writes
- The `runtime: "hermes"` field in `config.json` already triggers this path

**Cons:**
- Requires Hermes to be installed locally as a CLI (`pip install hermes-agent`)
- Startup prompt injection via file write + `Read .cortextos-startup.md` is fragile (depends on Hermes obeying the instruction before doing anything else)
- FastChecker injects inbox messages as raw text — Hermes sees them as part of the conversation, not as structured events. Works but loses the structured message envelope.
- If the Hermes binary isn't available or the `hermes` CLI has breaking changes, the daemon can't start the agent

**What the isolation design got wrong here:**
The HermesPTY assumes Hermes can execute `cortextos bus` shell commands from within its session to write its own heartbeat and send replies. This works if Hermes is a general-purpose agent that runs shell commands (like Claude Code does). But if the Hermes runtime does not have `cortextos bus` in its PATH, or if its context window fills before the heartbeat cron fires, the bus participation silently breaks — the daemon writes a heartbeat on startup but the agent never updates it again on its own.

### Option B: Standalone Python process (new work)

Hermes runs as its own process — a Python script that:
1. Calls the Hermes API or binary to process tasks
2. Independently polls its own inbox directory
3. Writes heartbeats on its own schedule
4. Sends replies by writing message files directly

The cortextos daemon does NOT manage this process. It runs under PM2 or its own supervisor.

**Pros:**
- Hermes can run against a remote API (no local binary required)
- The polling loop is deterministic and not subject to PTY injection timing
- Clean separation: Hermes owns its own state, the bus is just a shared file convention

**Cons:**
- Crash recovery must be built separately (PM2 + watchdog)
- The inbox polling loop must implement the bus lock protocol correctly — if it gets this wrong, messages are lost or double-delivered
- No FastChecker: Telegram integration would need to be wired separately if Hermes needs its own bot

---

## 4. What Stays the Same (No Changes Needed)

| Component | Status |
|-----------|--------|
| Bus file format | Unchanged — Hermes reads/writes same JSON |
| `read-all-heartbeats` | Unchanged — scans state dir, Hermes appears automatically |
| `send-message hermes` | Unchanged — writes to inbox/hermes/, works today |
| Task system | Unchanged — Hermes creates/completes tasks same as any agent |
| Event logging | Unchanged — `cortextos bus log-event` works from any runtime |
| Message format | Unchanged — same JSON envelope |
| HMAC signing | Unchanged — Hermes must include `sig` field if bus-signing-key exists |

---

## 5. Bus Changes Needed

**None required** for basic fleet membership.

Two optional improvements worth considering:

### 5a. `runtime` field in `heartbeat.json`

Add a `runtime: "hermes"` field to the Heartbeat type so the dashboard can visually distinguish Hermes from Claude Code agents. Small schema addition, fully backward-compatible (unknown fields ignored by existing readers).

### 5b. `runtime` field in `enabled-agents.json`

The daemon currently checks `config.json` for `runtime: "hermes"` to decide whether to use HermesPTY. If Hermes runs standalone (Option B), the daemon should skip it entirely rather than trying and failing to spawn it. A `managed: false` flag in `enabled-agents.json` or `config.json` would tell the daemon "this agent manages its own process."

Neither of these is blocking — they are quality-of-life improvements.

---

## 6. Open Questions — Status

### Q1: Does Hermes have shell access? — CLOSED: YES

**Evidence from code:**

- `templates/hermes/TOOLS.md`: "All cortextOS commands: `cortextos bus <command>`. These are shell commands — run them with your **bash tool**." Identical pattern to Claude Code agents. Shell access is a design assumption, not an open question.
- `templates/hermes/HEARTBEAT.md`: Contains `cortextos bus update-heartbeat`, `cortextos bus check-inbox`, `cortextos bus log-event` as bash code blocks. Hermes is expected to execute these.
- `agent-process.ts:871`: `if (this.config.runtime === 'hermes') return;` skips cron verification because **"Hermes owns its cron scheduler natively"** — it has its own tool execution loop, which includes shell/bash.
- Startup injection in `hermes-pty.ts`: after `❯` prompt appears, injects `Read .cortextos-startup.md and follow the instructions there.` — Hermes must be able to read files and run shell commands to comply.

**Conclusion:** Hermes has shell/bash tool access. `cortextos bus` commands work from within a Hermes session exactly as they do from Claude Code.

---

### Q2: Local binary or remote API? — CLOSED: LOCAL BINARY

**Evidence from code:**

- `hermes-pty.ts getBinaryName()`: returns `'hermes'` — the daemon spawns a local `hermes` CLI binary via node-pty, same as it spawns `claude` for Claude Code agents.
- `hermes-pty.ts` comment: "NousResearch/hermes-agent, Python REPL" — `pip install hermes-agent` is the install path.
- Session continuity: `~/.hermes/state.db` (local SQLite) — session state is on disk, not remote.
- `hermesDbExists()` checks local filesystem for the database.
- `paperclip/ui/src/adapters/hermes-local/index.ts` adapter type is `"hermes_local"` — the paperclip project explicitly names it "local" to distinguish from any future remote variant.

**Important caveat:** The `hermes` binary itself calls an external AI model API (NousResearch or similar) internally — but from the daemon's perspective, it is a local PTY process. The daemon spawns it, manages its lifecycle, and injects prompts into its stdin. The remote API call is internal to the hermes binary and invisible to cortextos.

**Practical implication:** `hermes` must be installed on the host machine before the agent can start. Currently NOT installed on this machine (`which hermes` returns nothing). This is a prerequisite for Option A.

---

### Q3: Telegram bot needed? — Still open, but not blocking

Agent-to-agent messaging (Dane → Hermes → Dane) works without a Telegram bot. A bot is only needed if David wants to message Hermes directly. Defer this decision — start without a bot.

### Q4–Q6 — Closed by Option A choice

Option A (daemon-managed) answers Q4 (daemon handles restarts), Q5 (FastChecker handles watchdog), and Q6 (Hermes receives tasks as injected text, uses `cortextos bus create-task` to track them — same as Claude Code agents).

---

## 7. Recommendation: Option A

**Decision:** Option A (HermesPTY + daemon-managed).

**Rationale:**
- Q1 is closed: Hermes has shell access → `cortextos bus` commands work natively
- Q2 is closed: local binary → daemon can spawn it as a PTY subprocess, same lifecycle as Claude Code
- The `HermesPTY` class, `runtime: "hermes"` config field, and `templates/hermes/` all exist and are tested
- Zero new framework code required — this is a configuration task, not an engineering task
- Crash recovery, inbox polling, heartbeat daemon writes, and cron firing all come for free

**The one real prerequisite:** `pip install hermes-agent` on the host. The daemon cannot start the agent until the binary exists. This is a setup step, not a code change.

**Risk and mitigation:** The "Hermes owns its cron scheduler natively" comment in `agent-process.ts` means Hermes runs crons internally without needing `/loop` or `CronCreate`. The `HEARTBEAT.md` template is still written as a cron prompt — Hermes will execute it when the heartbeat cron fires. If Hermes's native scheduler is unreliable, the daemon's FastChecker still writes a startup heartbeat and the agent still shows in the fleet; it just won't self-update. Acceptable for initial rollout.

---

## 8. Build Plan (Pending Approval)

**Prerequisite (David/James):** Install `hermes-agent` on the host machine.

**Files to create (Collie, after approval):**
- `orgs/ascendops/agents/hermes/config.json` — `runtime: "hermes"`, 4h heartbeat cron, org: ascendops
- `orgs/ascendops/agents/hermes/IDENTITY.md` — role, name, vibe (draw from templates/hermes/)
- `orgs/ascendops/agents/hermes/SOUL.md` — copy from templates/hermes/SOUL.md, customize for AscendOps
- `orgs/ascendops/agents/hermes/GOALS.md` — initial goals from Dane
- `orgs/ascendops/agents/hermes/HEARTBEAT.md` — copy from templates/hermes/HEARTBEAT.md
- `orgs/ascendops/agents/hermes/GUARDRAILS.md` — copy from templates/hermes/GUARDRAILS.md
- `orgs/ascendops/agents/hermes/MEMORY.md` — empty, populated during onboarding
- `orgs/ascendops/agents/hermes/.env` — no BOT_TOKEN needed initially (agent-to-agent only)
- `enabled-agents.json` — register hermes with `org: ascendops`

**No framework changes needed.** No upstream PR required.

**Estimated effort:** 30 minutes once `hermes-agent` is installed.

---

## 9. What We Actually Found in the Code

Comprehensive investigation of every Hermes-related file in the cortextos repo. This replaces speculation with exact implementation details.

---

### 9a. HermesPTY Bootstrap Mechanism (`src/pty/hermes-pty.ts`)

**How startup works:**

1. Pre-spawn: daemon writes a startup prompt to `.cortextos-startup.md` in the agent's working directory
2. Spawn: `hermes` binary is launched via node-pty (same mechanism as `claude` binary for Claude Code)
3. Wait: daemon scans PTY output for the bootstrap pattern `❯` (Hermes's idle REPL prompt)
4. Inject: after `❯` appears, daemon injects `Read .cortextos-startup.md and follow the instructions there.\r` as bracketed-paste into the PTY stdin
5. Hermes reads the file and executes the session start protocol

**Key constants:**
- `HERMES_BOOTSTRAP_PATTERN = '❯'`
- Binary: `getBinaryName()` returns `'hermes'` — must be on PATH
- Session args: fresh session → `[]`, continue → `['--continue']`
- Exit: Ctrl+D + 3s wait (Claude Code uses `/exit\r\n` + 5s)

**State continuity:** `hermesDbExists()` checks `~/.hermes/state.db` (local SQLite). If the database exists, daemon passes `--continue` on restart; otherwise fresh start.

---

### 9b. AgentPTY Inheritance

`HermesPTY extends AgentPTY`. The base class handles:
- PTY lifecycle (spawn, kill, resize)
- Output buffering (`output-buffer.ts`)
- Message injection via bracketed paste mode
- Watchdog polling loop (all FastChecker plumbing)

HermesPTY overrides: `getBinaryName()`, `buildClaudeArgs()`, `getBootstrapPattern()`, `buildStartupPrompt()`, `exitPty()`.

Everything else — inbox injection, heartbeat via `update-heartbeat`, bus commands — is inherited from AgentPTY and works identically for Hermes.

---

### 9c. Four `runtime === 'hermes'` Branches in `agent-process.ts`

| Line | Branch | Effect |
|------|--------|--------|
| ~147 | `start()` PTY selection | Instantiates `HermesPTY` instead of `AgentPTY` |
| ~224 | `stop()` exit sequence | Ctrl+D + 3s (vs `/exit\r\n` + 5s for Claude Code) |
| ~539 | `shouldContinue()` | Uses `hermesDbExists()` instead of Claude Code session detection |
| ~871 | `scheduleCronVerification()` | **Returns immediately** — Hermes owns cron scheduling natively, daemon skips verification entirely |

The cron skip at line 871 is the most consequential: if Hermes's native scheduler fails to set up crons, the daemon will never detect the failure and never retry.

---

### 9d. Template Inventory (`templates/hermes/`)

All 7 files present and complete:

| File | Contents |
|------|----------|
| `config.json` | `runtime:"hermes"`, 4h heartbeat cron, `ctx_warning_threshold:60`, `ctx_handoff_threshold:70`, `model:"{{model}}"` |
| `IDENTITY.md` | Role definition, name, purpose — mirrors Claude Code agent template |
| `SOUL.md` | Behavioral principles, communication style |
| `HEARTBEAT.md` | 8-step mandatory heartbeat sequence using `cortextos bus` bash commands |
| `TOOLS.md` | Explicitly: "All cortextOS commands: `cortextos bus <command>`. These are shell commands — run them with your **bash tool**." |
| `GUARDRAILS.md` | Safety constraints |
| `MEMORY.md` | Empty starter — populated during onboarding |

The `ctx_warning_threshold` and `ctx_handoff_threshold` fields in config.json are **effectively dead config** — FastChecker's context exhaustion handling reads `context_status.json` written by Claude Code's hooks, not these thresholds. Hermes has no equivalent hook, so these values are never read by the daemon.

---

### 9e. Binary Status

`which hermes` → nothing. The binary is **not installed** on this machine.

Install path: `pip install hermes-agent` (NousResearch/hermes-agent Python package). This is the sole prerequisite for Option A. Without it, the daemon's `HermesPTY.spawn()` throws immediately with "command not found" and the agent never starts.

---

### 9f. Paperclip Adapter

`paperclip/ui/src/adapters/hermes-local/index.ts` type is `"hermes_local"`. It delegates to the `hermes-paperclip-adapter` npm package. This is the UI layer for displaying Hermes conversations in the Paperclip dashboard — it does not affect bus participation. Named "hermes_local" to explicitly distinguish from any future remote/API variant.

---

### 9g. Unit Tests

`tests/unit/pty/hermes-pty.test.ts` (105 lines) and `tests/unit/daemon/agent-process-hermes.test.ts` (176 lines) exist and cover:
- PTY instantiation with correct binary/args
- Bootstrap pattern detection
- Runtime dispatch in agent-process start()
- shouldContinue() with/without state.db
- Cron verification skip

Tests are isolated from Claude Code tests — no cross-contamination risk.

---

### 9h. Context Exhaustion Handling

**This is the biggest production risk for Hermes as a fleet member.**

FastChecker's context exhaustion detection relies on `context_status.json` written by Claude Code's hook system (specifically `hook-context-status.ts`). The file contains current token count, threshold crossings, and handoff readiness.

Hermes has no equivalent hook. Unless the Hermes REPL independently writes a `context_status.json` in the same schema, FastChecker's context watchdog is permanently blind for Hermes agents. It will never detect a near-full context or trigger a handoff.

**Consequence:** A Hermes session that approaches 100% context will not auto-handoff — it will either crash, silently truncate, or loop at capacity. The daemon has no visibility into this until the PTY process exits.

---

### 9i. Message Injection Mechanism

FastChecker injects inbox messages into the Hermes PTY using **bracketed paste mode** (`\x1b[200~{text}\x1b[201~\r`). This is the same mechanism Claude Code uses.

Known fragility: Hermes issue #7316 (documented in paperclip adapter) describes bracketed paste mode injection breaking under specific terminal emulation conditions. The daemon has no fallback if bracketed paste is rejected — the message appears to be "injected" (write returns success) but Hermes never processes it.

---

### 9j. Rate Limit Detection

Rate limit detection is **purely text-based**: FastChecker scans PTY output for strings like `"rate limit"` or `"429"`. There is no API-level detection or structured error parsing.

For Hermes, this means:
- If NousResearch uses different rate limit error text than Anthropic, detection will miss it
- If Hermes displays rate limit info in a non-text format (structured JSON, spinner, etc.), detection fails silently
- The agent will be left hanging at capacity without the daemon knowing

---

## 10. Production Fleet Gotchas (Prioritized)

Eight issues worth knowing before deploying Hermes as a fleet member:

| # | Gotcha | Severity | Mitigation |
|---|--------|----------|------------|
| G1 | `hermes` binary not installed — daemon fails silently on spawn | **Blocker** | `pip install hermes-agent` before starting |
| G2 | Context exhaustion is invisible — no hook → no `context_status.json` → no handoff | **High** | Accept the risk for v1; monitor for runaway sessions |
| G3 | Cron reliability unverified — daemon skips cron check, no recovery if native scheduler fails | **High** | Check heartbeat file manually after first boot |
| G4 | state.db `--continue` risk — session continuing from 95% context overflows immediately | **High** | Delete `~/.hermes/state.db` if session is known to have ended near capacity |
| G5 | Startup prompt injection fragility — `❯` must appear before anything else, and Hermes must obey `Read` first | **Medium** | Test cold boot manually before fleet deployment |
| G6 | Bootstrap pattern `❯` collision — if Hermes prints `❯` mid-output, daemon injects startup prompt again | **Medium** | Monitor first few sessions for double-injection symptoms |
| G7 | Rate limit detection is text-only — misses Hermes-specific formats | **Low** | Add Hermes rate limit strings to FastChecker pattern list if observed |
| G8 | `ctx_warning_threshold` / `ctx_handoff_threshold` config fields are dead — daemon never reads them for Hermes | **Low** | Remove from template to avoid confusion |

None of G2–G8 are blockers for initial rollout. G1 is.

---

## 11. Hermes Harness vs Bare Claude Code PTY: What the Container Adds

**The right question:** Hermes can run Claude Code as its brain — the model is not the variable. The real comparison is the **container**: what does the Hermes harness give you that bare Claude Code PTY does not? And what does it take away?

---

### What the Hermes Harness Actually Is

The `hermes` binary is a Python REPL agent runtime. From cortextos's perspective it is a PTY process, same as `claude`. The harness contributes three structural differences:

1. **SQLite session state** — `~/.hermes/state.db` stores the conversation. Structured, queryable, persists across restarts via `--continue`.
2. **Native cron scheduler** — Hermes manages its own crons internally. The daemon does not set them up, does not verify them, and cannot see them.
3. **Python REPL execution model** — tools run inside a persistent Python interpreter. State accumulates across tool calls within a session (e.g., a dataframe built in step 1 is available in step 5).

Everything else — inbox polling, heartbeat writes, bus send, task creation — is handled by FastChecker and the agent's own bash tool, identically for both runtimes.

---

### SQLite State vs JSONL History

| | Hermes (SQLite) | Claude Code (JSONL) |
|---|---|---|
| Format | Structured rows in state.db | Append-only JSON lines |
| Inspectability | `sqlite3` queries between sessions | `cat` / `jq` the file |
| Token count visibility | Opaque — no token count in DB schema | `context_status.json` written by hook |
| Overflow risk on resume | **High** — session at 95% context resumes immediately at 95% | Managed — daemon reads context_status.json, can skip --continue if near limit |
| Corruption risk | SQLite WAL mode — low | File truncation — very low |

**Verdict:** SQLite is a lateral move, not an upgrade. The structured format is nice for debugging but the lack of token count visibility makes overflow on resume harder to prevent than with Claude Code's hook-based approach.

---

### Native Cron Scheduler vs Daemon-Managed Crons

| | Hermes (native) | Claude Code (daemon-managed) |
|---|---|---|
| Setup | Hermes configures its own crons at boot | Daemon reads config.json, calls CronCreate |
| Verification | None — daemon explicitly skips (agent-process.ts:871) | Daemon verifies on every restart, retries if missing |
| Observability | Invisible to cortextos | CronList shows all active crons |
| Failure recovery | None — if scheduler fails, crons silently stop | Daemon detects and re-creates missing crons |
| Persistence across crash | Depends on Hermes internal implementation | Daemon always re-creates from config.json on restart |

**Verdict:** Native cron scheduler trades daemon observability for autonomy. If it works, it's equivalent. If it fails, there is no fallback and no alert. For a 24/7 fleet member, this is a meaningful reliability gap.

---

### Python REPL Execution Model

The persistent Python interpreter is the one genuine harness-level capability that bare Claude Code does not have. Within a single Hermes session:
- Objects built in one tool call persist in memory for later calls
- Iterative computation (loop over 1000 items, accumulate results) is efficient
- Libraries imported once stay imported

For typical AscendOps tasks (spec writing, API calls, file reads, Telegram messages): this advantage is neutral — none of those tasks build up Python state across steps.

For data-heavy tasks (ETL, batch processing, numerical analysis): this is a real advantage.

---

### Do the 8 Gotchas Still Apply if Claude Code Is the Brain?

| Gotcha | Still applies with CC brain? | Why |
|--------|------------------------------|-----|
| G1: binary not installed | **Yes** | hermes binary is still required regardless of model |
| G2: context exhaustion invisible | **Yes** | FastChecker reads context_status.json written by Claude Code's hook — but that hook runs inside the hermes PTY, not as a standalone process. Whether the hook fires depends on whether Hermes loads it at startup. Unverified. |
| G3: cron verification skip | **Yes** | Daemon behavior is keyed on `runtime === 'hermes'`, not on model |
| G4: state.db --continue overflow | **Yes** | The overflow risk is the DB storing a near-full conversation; the brain doesn't change this |
| G5: startup injection fragility | **Yes** | Harness-level — the `❯` detection and file injection happen before the brain matters |
| G6: bootstrap pattern collision | **Yes** | Same — harness-level |
| G7: rate limit detection text-only | **Partially mitigated** | If the brain is Claude Code, Anthropic's rate limit text is what FastChecker already knows. Detection improves. But: Anthropic quota is now shared with the rest of the fleet — the rate limit isolation benefit is gone. |
| G8: dead config fields | **Yes** | Config is parsed by daemon regardless of brain |

**Net effect:** G7 is partially mitigated. G1–G6, G8 are unchanged. The context blindness (G2) has a small chance of improvement if Claude Code's hook system fires correctly inside the Hermes PTY — but this is unverified and cannot be assumed.

---

### Rate Limit Isolation: Gone If Claude Code Is the Brain

This is the critical tradeoff. The original case for Hermes was that NousResearch API calls don't touch Anthropic quota. If you put Claude Code as the brain inside Hermes, **both are now on Anthropic's API** — you lose the isolation entirely and add the harness overhead. You get SQLite state and a Python REPL in exchange for cron opacity, context blindness, and more complex onboarding.

That is not a good trade for standard fleet agents.

---

### Onboarding Complexity

Unchanged regardless of which model runs inside. The hermes binary, manual template scaffold, and first-boot verification pass are required either way. Claude Code agents are faster to onboard.

---

### Verdict

**The Hermes harness makes sense in exactly one scenario: when the brain is a model not available through Claude Code** — a local LLM via Ollama, a NousResearch model, or any future provider that Anthropic doesn't offer. In that case you get genuine rate limit isolation, Python REPL state, and a separate API budget.

**If the brain is Claude Code:** the harness adds SQLite persistence and Python REPL state in exchange for losing rate limit isolation, cron observability, and context-aware handoff. Net negative for AscendOps fleet workloads.

**Recommendation:** Deploy Hermes with its native model (not Claude Code as the brain). Use it for tasks where Anthropic quota pressure is real and task complexity is lower — research queries, summarization, batch lookups. Do not use the Hermes harness as a wrapper around Claude Code; that combination gives you the downsides of both without the key upside of either.

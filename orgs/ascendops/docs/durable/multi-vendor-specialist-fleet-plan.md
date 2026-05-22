---
title: Multi-Vendor Specialist Fleet — Plan
status: PLAN ONLY (no code)
author: Aussie (driver)
reviewer: Collie (dev / build-quality)
ratified_by: David (architecture, 2026-04-30 evening)
date: 2026-04-30
scope: MVP architecture for codex-specialist + gemini-specialist agents on the cortextOS bus
---

# Multi-Vendor Specialist Fleet — Plan

## TL;DR

Add two persistent receive-only agents to the cortextOS fleet — `codex-specialist` (OpenAI Codex CLI) and `gemini-specialist` (Google Gemini CLI). Claude agents (Blue / Collie / Aussie / Dane) dispatch sub-tasks or whole tasks to them via the existing bus message channel; specialists execute on their own vendor account caps and reply with the result. Primary motivation is **Opus week-cap savings** — the Claude fleet preserves Opus for orchestration, judgment, and decision work and offloads everything a non-Claude vendor can handle equally well or better. Capability differentiation is a real but secondary win.

This is the concrete form of the token-efficiency-audit recommendation tied to the 22% week-cap pressure David has been calling out. The infrastructure (vendor adapters, 2-seat rotation, migration runbook) was built on 2026-04-29 night. This plan turns that infrastructure into a live fleet posture.

---

## 1. Motivation

**Primary — Opus cap savings.** David explicit on 2026-04-30 evening: "the point of building specialists is so Claude agents can OFFLOAD sub-tasks that Codex or Gemini handle better." Today's PR-6 surgery cost ~4% of the weekly cap (David observed the usage tick 18→22 during a single PR's filing). Phase 1 chain work is Opus-heavy, and the per-PR pause-point David ratified later that evening was a direct response to that cost data. Specialists let Claude burn cap on what Opus actually wins on (orchestration, judgment, design decisions, multi-step reasoning) and route the rest to vendors that eat their own caps from separate accounts.

**Secondary — capability.** Codex strengths (code generation, fast iterative scaffolding, large-file rewrites) ≠ Claude strengths ≠ Gemini strengths (massive context windows, multimodal, certain reasoning shapes). Specialists make per-vendor strengths reachable from the fleet without flipping a Claude agent's vendor and losing its skills + memory in the process.

**Why specialists, not vendor flips.** Per the vendor-flip context-loss taxonomy (memory/2026-04-30.md, 20:49 EDT entry): flipping an existing Claude agent loses live conversation, all `.claude/skills/`, and claude-mem compression artifacts. That cost is acceptable for an experimental migration but unacceptable as a steady-state pattern. Specialists side-step the loss entirely — Claude agents stay Claude, specialists are net-new and built vendor-native from day 1.

---

## 2. Architecture (David-ratified MVP)

### Final fleet shape

| Agent              | Vendor   | Role                                                 | Telegram | Bus |
|--------------------|----------|------------------------------------------------------|----------|-----|
| Blue               | Claude   | PM ops                                               | yes      | yes |
| Collie             | Claude   | dev / CI / code                                      | yes      | yes |
| Aussie             | Claude   | fleet metrics + design + code review                 | yes      | yes |
| Dane               | Claude   | orchestrator                                         | yes      | yes |
| **codex-specialist** | **Codex**  | bus-only specialist                                  | **NO**   | yes |
| **gemini-specialist** | **Gemini** | bus-only specialist                                  | **NO**   | yes |

### Five MVP rules (David explicit, do not relax for MVP)

1. **Receive-only.** Specialists do not initiate work. They wait for a bus dispatch, execute, reply.
2. **No hand-off / re-dispatch / smart-routing.** If a specialist gets a wrong-vendor task, it replies with `status: wrong_vendor` and the dispatching Claude agent picks again. Routing intelligence lives in Claude.
3. **Dispatching Claude agent is responsible for picking the right specialist.** Aussie / Dane / Collie / Blue decide pre-dispatch.
4. **Bus-only — NO Telegram.** Specialists do not have BOT_TOKEN / CHAT_ID set in `.env`. They speak only to the fleet.
5. **Pattern B (Aussie inline Codex via codex-rescue subagent) is independent and stays unchanged.** Pattern C (specialist dispatch via bus) is additive, not a replacement.

### What's IN scope

- Two new persistent agents at `orgs/ascendops/agents/codex-specialist/` and `orgs/ascendops/agents/gemini-specialist/`.
- A standardized dispatch envelope for bus messages to specialists (§4).
- An offload decision matrix that Claude agents consult pre-dispatch (§4).
- Vendor-native bootstrap files (Codex `AGENTS.md`, Gemini `GEMINI.md`).
- Telemetry hooks that quantify the cap-savings hypothesis (§7).

### What's OUT of scope (deferred to post-MVP)

- Smart hand-off / re-dispatch from specialist back to a different specialist (David explicit cut).
- Specialists initiating outbound user comms (Telegram disabled by design).
- Per-specialist `.claude/skills/`-equivalent skill ecosystems for behaviors beyond the receive-and-reply loop. Specialists run thin; orchestration smarts live in Claude.
- Cross-machine specialist deployment.
- API-key-based fallback when subscription auth fails.

---

## 3. Agent specs

### 3.1 codex-specialist

**Path:** `orgs/ascendops/agents/codex-specialist/`

**`config.json` shape:**

```jsonc
{
  "agent_name": "codex-specialist",
  "enabled": true,
  "startup_delay": 0,
  "max_session_seconds": 255600,
  "max_crashes_per_day": 10,
  "working_directory": "",
  "timezone": "America/New_York",
  "day_mode_start": "00:00",
  "day_mode_end": "23:59",          // always-on (no day/night mode for receive-only)
  "communication_style": "terse",   // bus replies only — no human-facing prose

  // Vendor wiring (this is the entire activation surface for the adapter)
  "runtime": "claude-code",         // adapter runs the codex CLI under our PTY
  "vendor": "openai",
  "model": "gpt-5.5",               // or whatever Codex tier David picks; resolveModel honors the literal

  // Telegram disabled (rule #4)
  "telegram_disabled": true,

  // Heartbeat — bus-side only, no skill (rule explained §3.3)
  "heartbeat": {
    "event_driven": true,           // same predicate as Claude agents — fire on inbox_arrival/approval/error
    "noop_on_idle": true            // explicit: when nothing to do, stay quiet
  },

  // Crons — minimal. No theta-wave, no anthropic-watchlist, no skill-optimizer.
  "crons": [
    { "name": "heartbeat",         "type": "recurring", "interval": "2h",   "prompt": "(inline — see AGENTS.md §Heartbeat)" },
    { "name": "specialist-audit",  "type": "recurring", "cron": "17 9 * * *", "prompt": "(inline — see AGENTS.md §Daily Audit)" }
  ],

  "approval_rules": {
    "always_ask": ["financial", "deployment", "data-deletion", "external-comms"],
    "never_ask": []
  },

  "ecosystem": {
    "local_version_control": { "enabled": false },  // specialists do not commit
    "upstream_sync":          { "enabled": false },  // specialists do not sync
    "catalog_browse":         { "enabled": false },
    "community_publish":      { "enabled": false }
  },

  "ctx_restart_threshold": 70,

  "thinking": { "type": "enabled", "budget_tokens": 1000000 }
}
```

**`AGENTS.md` outline — META-PROTOCOL ONLY** (David's structural insight 2026-04-30 evening): the dispatching Claude agent's bus envelope carries the actual TASK instructions. AGENTS.md only covers the meta-protocol — how to parse the envelope, format replies, run the heartbeat, write memory, handle errors. AGENTS.md never carries task-specific knowledge. Vendor-neutral, Codex reads cwd-level by convention.

| § | Section                                  | Purpose (META-protocol only — never task-specifics)                                       |
|---|------------------------------------------|-------------------------------------------------------------------------------------------|
| 1 | Identity                                 | "You are codex-specialist — a receive-only Codex sub-agent on the cortextOS bus."         |
| 2 | First Boot Check                         | Standard `.onboarded` flag pattern; specialists onboard via a vendor-native onboarding doc, not the Claude `.claude/skills/onboarding/SKILL.md`. |
| 3 | On Session Start                         | Read bootstrap files (IDENTITY/SOUL/GUARDRAILS/GOALS/MEMORY/USER/SYSTEM), check inbox, restore crons, log session_start, NO Telegram online ping. **First action after bootstrap: `icm recall <agent_name>` for cross-session continuity.** |
| 4 | Dispatch Contract (incoming envelope parse) | Exact JSON-or-prose envelope rules + auto-wrap algorithm — see §4 of this plan. AGENTS.md describes how to PARSE and ROUTE the envelope; the envelope itself carries the task. |
| 5 | Reply Contract (outgoing envelope shape) | Exact reply envelope schema — see §4. Includes `cap_exceeded` status + abort-partial protocol when self-throttle triggers (§4.2). |
| 6 | Heartbeat (inline workflow)              | The full Phase 0 gate + Steps 1-4 inlined as prose — no `.claude/skills/heartbeat/`.       |
| 7 | Daily Audit (inline workflow)            | Daily self-check: cap utilization, dispatched-task count, error count. Bus-log to Aussie. |
| 8 | Approvals                                | Defer to dispatching Claude agent; specialists never escalate directly to David.          |
| 9 | Memory Protocol                          | **ICM MANDATORY — `icm recall` at session-start (already invoked per §3) + `icm store --topic <agent_name> --importance high` after every significant task. Non-optional. No claude-mem fallback exists for specialists.** Daily memory file (`memory/YYYY-MM-DD.md`) supplements ICM but does NOT replace it — daily file is per-day, ICM is the cross-session bridge. |
| 10 | Bus reference                           | Subset of `.claude/skills/bus-reference/SKILL.md` inlined: send-message, ack-inbox, log-event, update-heartbeat, list-tasks. |
| 11 | Env scope                               | **Specialists inherit `CTX_FRAMEWORK_ROOT` / `CTX_ROOT` / `CTX_AGENT_DIR` from the daemon — same as Claude agents.** They CAN see `.claude/skills/` on disk but CANNOT execute Claude skill files (Codex/Gemini binaries don't load them). The runtime gap is the natural enforcement. **Rule: never reference a Claude `.claude/skills/<name>/SKILL.md` from this AGENTS.md as if specialist could execute it. Inline the workflow instead.** |
| 12 | Error handling                          | Cap exceeded → `status: cap_exceeded` + abort-partial-and-return-progress (§4.2 PATH 1). Parse failures → `status: blocked` with `notes: "envelope parse error: <detail>"`. Crashes → bus framework redelivers per existing 5-min retry. NO retry logic in AGENTS.md — vendor binary + bus framework handle it. |

**Skill substitution path: (b) inline-into-AGENTS.md, ratified by David 2026-04-30 evening.** Specialists do NOT get `.claude/skills/`. AGENTS.md is the entire behavior surface — meta-protocol only, no task specifics. Path (a) (replicate skill ecosystem in `$CODEX_HOME/skills/` / `$GEMINI_HOME/skills/`) is a ratchet available post-stabilization if specialist meta-behavior grows beyond receive-and-reply. For MVP, AGENTS.md prose covers everything.

**Why META-only:** task instructions arrive via the dispatch envelope's `deliverable` field. The dispatching Claude agent owns task expertise. AGENTS.md owning task knowledge would (1) duplicate context that already lives in Claude's memory + skills, (2) create drift between specialist-side and Claude-side understanding of "how task X is done," (3) bloat AGENTS.md beyond reviewable scope. Thin specialist + smart dispatcher = no duplication.

**.env shape:**

```
# NO BOT_TOKEN, NO CHAT_ID — Telegram disabled per rule #4
ALLOWED_USER=
# CODEX_HOME unset — specialist uses the wrapper rotation default seat
```

### 3.2 gemini-specialist

**Path:** `orgs/ascendops/agents/gemini-specialist/`

Mirror of codex-specialist with these substitutions:

- `vendor: "google"`, `model: "gemini-2.5-pro"` (or whatever Gemini tier David picks).
- `GEMINI.md` instead of relying on `AGENTS.md` (Gemini reads cwd-level GEMINI.md natively per `~/.gemini/GEMINI.md` precedent).
- For MVP: `GEMINI.md` is a symlink → `AGENTS.md` (same content, vendor-neutral). Closes the per-agent GEMINI.md gap surfaced today (memory/2026-04-30.md vendor-flip taxonomy entry).
- No 2-seat rotation (Gemini single-seat per existing infra; Gemini 2-seat parity is a queued post-stabilization item).

Everything else identical to §3.1.

### 3.3 Why no .claude/skills/ for specialists

Per today's vendor-flip taxonomy: `.claude/skills/` is Claude Code only. Skill files use Claude tool-invocation patterns. Codex and Gemini have no compatible runtime — they can read AGENTS.md / GEMINI.md and execute prose instructions but cannot invoke `.claude/skills/` files. The "skill loss" finding from the vendor-flip taxonomy applies in full to these new agents. Inlining META-protocol behavior into AGENTS.md as prose is the David-ratified answer.

This keeps specialists provably simple: a single ~200 line meta-protocol bootstrap doc is the entire spec. No skill drift between `.claude/skills/` (Claude fleet) and `$CODEX_HOME/skills/` (specialist) and `$GEMINI_HOME/skills/` (specialist) — all three would otherwise need to be kept in sync forever for behaviors like heartbeat / approvals / memory protocol. Task-specific knowledge stays in Claude (where it already lives in skills + agent-memory) and travels to specialists via the dispatch envelope, never via AGENTS.md.

---

## 4. Integration

### 4.1 Offload decision matrix

The dispatching Claude agent consults this matrix pre-dispatch. Routing intelligence lives in Claude.

| Task class                                              | Default vendor      | Why                                                                 |
|---------------------------------------------------------|---------------------|---------------------------------------------------------------------|
| Code generation (new file, single concern, ≤500 LOC)    | codex-specialist    | Codex strength, stays out of Opus week-cap                          |
| Large-file rewrite / refactor (≤2000 LOC)               | codex-specialist    | Codex strength                                                       |
| Multi-file scaffolding from a clear spec                 | codex-specialist    | Codex strength                                                       |
| Documentation drafting (README, runbook, RFC body)      | gemini-specialist   | Gemini's long-context strength                                       |
| Massive-context analysis (read 20+ files, synthesize)   | gemini-specialist   | Gemini context window                                                |
| Code review (≤5 files, deep correctness analysis)       | Claude (Collie)     | Multi-pipeline review tier wins; specialists for first-pass only     |
| Architecture / design decisions                         | Claude (Aussie / Dane) | Judgment work; Opus wins                                            |
| PR triage / scope decisions                             | Claude (Dane)       | Orchestration; Opus wins                                             |
| Cross-agent coordination / message routing              | Claude (Dane)       | Orchestrator-only domain                                             |
| Approval-gated actions                                  | Claude (any)        | Specialists do not hold approval authority                           |
| Telegram-bound output                                   | Claude (any)        | Specialists do not have Telegram                                     |

This matrix lives in `templates/orchestrator/AGENTS.md` and gets folded into Dane's session-start protocol. Each Claude agent gets a similar (smaller) matrix for tasks it might originate.

### 4.2 Dispatch envelope

Specialists receive bus messages via the existing `cortextos bus send-message <specialist> normal '<body>' [reply_to]` channel. The envelope is the message body — a minimally structured JSON-or-prose payload that specialists parse on receipt.

**Dispatch envelope schema (canonical):**

```json
{
  "task_id": "pr6-codereview-001",                          // REQUIRED. Caller-supplied ID. Used for reply correlation + telemetry.
  "task_type": "code_review",                               // REQUIRED. From the offload matrix vocabulary in §4.1.
  "deliverable": "Review src/pty/adapters/openai.ts ...",   // REQUIRED. Human-readable description of the work product expected.
  "target_channel": "bus",                                  // REQUIRED. "bus" | "telegram" | "approval". Specialists reply wrong_vendor on anything but "bus".
  "requires_approval": false,                               // REQUIRED. bool. If true, specialist replies wrong_vendor (specialists hold no approval authority).
  "context_refs": [                                         // OPTIONAL. List of file paths. Empty array if none.
    "src/pty/adapters/openai.ts",
    "orgs/ascendops/docs/multi-model-rfc-amendment.md"
  ],
  "deadline": "2026-04-30T23:00:00Z",                       // OPTIONAL. ISO8601 UTC. If absent, no deadline.
  "reply_to_agent": "collie",                               // OPTIONAL. Defaults to bus message sender if absent.
  "reply_format": "markdown_report"                         // OPTIONAL. Defaults to "prose".
}
```

**Required vs optional + wrong_vendor enforcement:** specialists parse the envelope at receive time. The five REQUIRED fields (`task_id`, `task_type`, `deliverable`, `target_channel`, `requires_approval`) determine whether the dispatch is processable. Missing any required field → reply `status: blocked`, `notes: "envelope parse error: missing field <name>"`. The `target_channel` and `requires_approval` fields are the explicit wrong-vendor enforcement surface (resolves Collie B3): specialist replies `status: wrong_vendor` if `target_channel != "bus"` OR `requires_approval == true` OR the task class semantically belongs to a Claude-only column of §4.1's matrix (capability check via `task_type` value).

**Plain-prose dispatch fallback (resolves Collie B1) — algorithm locked:**

The DISPATCHING SPECIALIST does the wrap (not the bus framework, not the sender). Specialists detect prose-vs-JSON by attempting `JSON.parse` on the trimmed body; on parse failure, the specialist auto-wraps as follows:

| Field                | Auto-wrap value                                                                  |
|----------------------|----------------------------------------------------------------------------------|
| `task_id`            | derived from incoming bus `msg_id` (e.g. `prose-{msg_id}`)                       |
| `task_type`          | `"general"`                                                                      |
| `deliverable`        | the full prose body, trimmed                                                     |
| `target_channel`     | `"bus"` (default — assumes prose dispatches are bus-bound)                       |
| `requires_approval`  | `false`                                                                          |
| `context_refs`       | `[]`                                                                             |
| `deadline`           | unset                                                                            |
| `reply_to_agent`     | bus-sender of the incoming message (auto-derived, no inference from prose)       |
| `reply_format`       | `"prose"`                                                                        |

If the prose body exceeds 16 KB, specialist replies `status: blocked, notes: "envelope parse error: body exceeds 16 KB cap; resubmit with structured envelope or split"`. Hard cap, no negotiation — protects against runaway dispatch storms.

**Reply envelope schema:**

```json
{
  "task_id": "pr6-codereview-001",                          // echoes incoming task_id
  "status": "completed",                                    // "completed" | "wrong_vendor" | "blocked" | "failed" | "cap_exceeded"
  "deliverable": "2 correctness issues...",                                          // OPTIONAL. Inline string for short replies (≤8 KB).
  "deliverable_path": "orgs/ascendops/agents/codex-specialist/replies/<task_id>.md", // OPTIONAL. File ref for replies > 8 KB. Persistent path per Dane convention. EXACTLY ONE of deliverable / deliverable_path is set per reply (mutually exclusive).
  "summary": "2 correctness issues found, 1 minor suggestion.",
  "vendor_cost_estimate": "~3% of OpenAI plan-cycle cap",                            // best-effort string (rolls up to Aussie audit; observability-only — no enforcement per David's no-MVP-cost-cap ruling Q7)
  "elapsed_seconds": 142,
  "notes": "",                                                                       // populated on non-completed statuses (parse_error detail / wrong_vendor reason / failure cause). For cap_exceeded: leave empty — partial_progress carries the structured progress info.
  "partial_progress": null                                                            // OPTIONAL. Populated ONLY when status == "cap_exceeded" — structured progress fields (see PATH 1 below for shape).
}
```

**Field convention for `cap_exceeded` replies (resolves Collie N3):** `partial_progress` carries STRUCTURED progress (file list, completed-vs-remaining, persistent diff path). `notes` stays empty for cap_exceeded — no prose duplication. For all other non-completed statuses (`blocked` / `wrong_vendor` / `failed`), `notes` carries the prose reason and `partial_progress` is null.

**Self-throttle PATH 1 — abort-partial on cap exhaustion (David ratified Q8 2026-04-30):**

When the vendor binary signals cap-exhaustion mid-task (Codex `usage limit / rate limit` regex match per the 2-seat wrapper signal; Gemini equivalent stderr signal), the specialist:

1. Aborts the current generation immediately. Does not retry. Does not call the wrapper rotation (rotation is a separate concern from quota exhaustion).
2. Captures whatever partial work is complete at the abort point into `partial_progress` as structured fields (e.g. `{"completed_files": ["src/a.ts", "src/b.ts", "src/c.ts"], "remaining_files": ["src/x.ts", "src/y.ts"], "partial_diff_path": "orgs/ascendops/agents/codex-specialist/replies/<task_id>.partial.diff"}`).
3. Replies `status: cap_exceeded` with `partial_progress` populated and `notes` empty. Dispatching Claude agent receives the reply, acknowledges the cap state, finishes the remaining work itself.
4. Specialist does NOT block subsequent dispatches — next bus message gets normal processing. Cap-exhaustion is per-attempt, not a sticky agent state. Vendor cap recovers on its own schedule.

**No per-vendor cost cap for MVP** (David Q7): specialists run until vendor maxes them out via PATH 1. `vendor_cost_estimate` is observability-only, not an enforcement gate. If a specialist eats its full per-cycle cap, the abort-partial protocol activates and the Claude fleet picks up the rest.

### 4.3 Dispatch syntax (paste-ready)

```bash
# From any Claude agent (e.g. Collie picks up a code-gen task and offloads):
cortextos bus send-message codex-specialist normal "$(cat <<'EOF'
{
  "task_id": "rfc15-day4-handler-001",
  "task_type": "code_generation",
  "deliverable": "Implement bash_spawn handler logic in src/bus/hook-handlers/bash_spawn.ts replacing the not_implemented stub. Spec at orgs/ascendops/docs/rfc-15-bus-hooks.md §6.2.",
  "context_refs": ["src/bus/hook-handlers/bash_spawn.ts", "orgs/ascendops/docs/rfc-15-bus-hooks.md"],
  "reply_to_agent": "collie",
  "reply_format": "git_diff"
}
EOF
)" "<reply_to_msg_id>"
```

Specialists ack incoming dispatches via the same `--reply-to` mechanism Claude agents already use. Un-acked dispatches redeliver after 5 minutes per existing bus framework behavior.

---

## 5. Activation prerequisites

Dane named six in his dispatch. This plan adds five more surfaced by the input scan + today's findings.

### From Dane's dispatch (re-confirmed)

1. **Secondary OpenAI plan signed up.** Funds Codex specialist; also unlocks 2-seat rotation on the codex-rescue / Aussie inline path (independent benefit).
2. **Gemini plan / account signed up.**
3. **GEMINI.md per-agent gap.** Per-agent dirs currently lack GEMINI.md. **Locked approach:** symlink `GEMINI.md → AGENTS.md` (one-line shell command per agent dir, default). Pre-flight: confirm Gemini reads through symlinks. If pre-flight fails, fall back to `cp AGENTS.md GEMINI.md` plus a sync hook that re-copies on any AGENTS.md edit. Decision criterion: a single test of `gemini --help` followed by a session-start in a dir with the symlink — passes if the agent loads identity correctly.
4. **seat-b same-account fix.** `~/.codex-seats/active-seat.json` currently has `seat-b.account_id == seat-a.account_id` (today's diagnostic). Until David signs up for the secondary OpenAI plan and runs `CODEX_HOME=~/.codex-seats/seat-b codex login` against a separate account, both seats share quota and codex-specialist would draw from the same cap as the existing inline-codex pattern.
5. **verify-state script defect — BLOCKING.** Current verify-state script gave a false-positive "all OK" today despite the same-account problem. Fix: assert `seat-a.account_id != seat-b.account_id`. **Promoted to blocking before §6 step 6** — without this assertion, rule #4 (specialist isolation guarantees) cannot be verified in the audit, so the build cannot proceed past prereq gate.
6. **claude plugin install false-positive watchdog.** Documented behavior (memory observation `project_watchdog_plugin_install_false_positive`); orthogonal to the plan but worth surfacing because specialist `cortextos start` may trigger the same false-positive.

### Surfaced by this plan

7. **Skill substitution decision.** Plan recommends path (b) — inline behavior into AGENTS.md, no specialist skill ecosystem. Lock this before §6 build order so codex-specialist and gemini-specialist AGENTS.md drafts have a clear scope.
8. **Vendor-specific model_tier mapping for PR-0 #278.** Today's `src/utils/model-tiers.ts:DEFAULT_MODEL_TIERS` carries Anthropic IDs only. Specialists need a vendor-aware tier map (`{ openai: { haiku: "...", sonnet: "...", opus: "..." }, google: { ... } }`) OR specialists hardcode their `model` field per `vendor` and skip tier resolution. Recommendation: hardcode `model` per specialist for MVP; vendor-aware tier mapping is a post-MVP cleanup once we know the right vendor model IDs from real usage.
9. **ICM bootstrap MANDATORY from day 1 — non-optional.** Specialists have no claude-mem; ICM (`/opt/homebrew/bin/icm`) is the only persistent cross-session memory layer they can use. AGENTS.md/GEMINI.md §9 (Memory Protocol) must state: `icm recall <topic>` at session-start, before anything else; `icm store --topic <...> --importance high` after every significant task — non-optional, no claude-mem available as fallback. This mandate is enforced in §3.1 outline §9 description (resolves Collie S6).
10. **Bus heartbeat without skill — verify cron-on-prompt-only flow works on Codex / Gemini PTY.** Claude agents have `/loop {interval} {prompt}` and `CronCreate` available natively. Codex/Gemini PTY may or may not expose those hooks. **Pre-flight check at §6 step 8** confirms which path holds: if `cortextos hard-restart codex-specialist` triggers the cron schedule cleanly, primary path is cron-on-prompt; if not, primary path is daemon-side cron poking specialist via synthetic bus message at heartbeat cadence. Decision recorded in step 8 of the build order, not deferred (resolves Collie S8).
11. **Telegram-disabled startup path.** `cortextos start <agent>` may fail-closed without `BOT_TOKEN` / `CHAT_ID` in `.env`. Pre-flight: verify the daemon honors `telegram_disabled: true` in config.json and skips the Telegram online-ping path without crashing. If it doesn't, set placeholder env vars (BOT_TOKEN=disabled, CHAT_ID=-1) and short-circuit in the daemon. Quick lift.

### Specialist env scoping (Collie S5)

Specialists run inside the same `cortextos` daemon as Claude agents and inherit the same `CTX_FRAMEWORK_ROOT` / `CTX_ROOT` / `CTX_AGENT_DIR` env. They CAN see the framework's `.claude/skills/` directory tree on disk — they just can't execute the skill files because Codex/Gemini binaries don't load them. No explicit env scoping is needed; the runtime gap (CLI binary doesn't recognize Claude skill format) is the natural enforcement boundary. AGENTS.md should mention this explicitly so future maintainers don't try to reference a Claude skill file from a specialist's bootstrap.

---

## 6. Build order

Concrete steps. One agent comes online first (codex-specialist), validates, then gemini-specialist follows.

**Note (David Q5 ratification 2026-04-30):** the secondary OpenAI plan funds BOTH the seat-b 2-seat rotation hygiene AND the codex-specialist activation. Steps 1-4 are valid as standalone hygiene the moment David signs up — they unlock the existing inline-codex pattern's real 2-seat behavior even if specialist build (steps 5+) gets deferred.

| Step | Owner   | Action                                                                                                                                                                                          |
|------|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1    | David   | Sign up for secondary OpenAI plan + Gemini plan (subscription-only, no API keys per amendment §3). Plan target: this week, could slip (David Q4).                                              |
| 2    | David   | `CODEX_HOME=~/.codex-seats/seat-b codex login` against the SECONDARY OpenAI account. `gemini` interactive auth on the new Gemini account.                                                       |
| 3    | Aussie  | Verify `seat-a.account_id != seat-b.account_id` in `~/.codex-seats/active-seat.json`. Run jq update to flip seat-b to `status: healthy` with the new account_id.                                |
| 4    | Aussie  | Patch `verify-state` script with the account-uniqueness assertion. **NOTE:** steps 3-4 standalone-hygiene-NOW unlock real 2-seat rotation regardless of whether specialist build proceeds (David Q5). |
| 5    | Collie  | Per-agent GEMINI.md symlinks for existing fleet (`for agent in blue collie aussie dane; do ln -s AGENTS.md orgs/ascendops/agents/$agent/GEMINI.md; done`).                                      |
| 6    | Collie  | `cortextos add-agent codex-specialist --template agent`. Edit `orgs/ascendops/agents/codex-specialist/config.json` per §3.1.                                                                    |
| 7    | Aussie  | Author `orgs/ascendops/agents/codex-specialist/AGENTS.md` (sections 1-10 per §3.1 outline). Polish-first single iteration.                                                                       |
| 8    | Collie  | `cortextos start codex-specialist`. Verify daemon honors `telegram_disabled` (prereq #11). **DECIDE primary heartbeat path (prereq #10):** test `cortextos hard-restart codex-specialist` triggers cron-on-prompt; if YES → primary = cron-on-prompt; if NO → primary = daemon-side synthetic-bus-message cron. Decision recorded in step 8 result, not left open. |
| 9    | Aussie  | Author offload decision matrix into `templates/orchestrator/AGENTS.md` and Dane's per-agent matrix into Dane's AGENTS.md.                                                                       |
| 10   | Aussie + Dane | **Envelope-fuzz test (resolves Collie B2).** Aussie authors 6 deliberately-malformed dispatches (missing required field, malformed JSON, body > 16 KB, multiple top-level JSON objects, empty body, nested context_refs). Dane dispatches each. Specialist MUST reply `status: blocked` with parse_error notes for each, no crash, no watchdog cycle. Failure of any case → block step 11 entry. |
| 11   | Dane    | Happy-path smoke test: dispatch a small code-review task to codex-specialist. Verify reply envelope shape, latency, content. Log via `cortextos bus log-event action agent_activity info --meta '{"event_type":"specialist_smoke_test", ...}'` (uses canonical EventType + meta discriminator pattern — resolves Collie S7). |
| 11.5 | Aussie  | Establish telemetry baseline (§7) over 48h soak. Dispatch 5-10 representative tasks across the offload matrix.                                                                                  |
| 12   | All     | Decision gate: codex-specialist soak passes (§7 success criteria) → proceed to gemini-specialist.                                                                                              |
| 13   | Collie  | Repeat steps 6-8 for gemini-specialist (with `vendor: google`, GEMINI.md as symlink to AGENTS.md, no 2-seat).                                                                                   |
| 14   | Aussie  | Repeat step 11 telemetry establishment for gemini-specialist.                                                                                                                                   |
| 15   | David   | Greenlight gate: review 7-day post-launch telemetry (§7). Decide go-steady-state vs scope-revisit vs rollback.                                                                                   |

Steps 1-4 are activation prerequisites David's already aware of; they gate everything else. Steps 5-15 are the actual fleet build, ~2 days of work spread over a 4-7 day calendar window with the soak gates honored.

---

## 7. Telemetry

**Simplified per David Q9 + Q10 (2026-04-30):** the routing IS the win. Specialists receiving and completing tasks instead of Claude doing them is success. No percentage-based Opus-drop target, no separate spot-check rubric. The dispatching Claude agent reviews the reply as part of normal task-completion flow — no parallel quality-sample process needed.

### Operational metrics (observability — not gates)

| Metric                                      | Source                                                                              | Why we watch it                                |
|---------------------------------------------|-------------------------------------------------------------------------------------|------------------------------------------------|
| Specialist dispatch count / day             | `cortextos bus log-event` filter on `action == agent_activity` + `meta.event_type == specialist_dispatch` | Routing volume = direct success signal         |
| Reply latency (p50 / p95)                   | dispatch_ts → reply_ts diff                                                         | Latency degradation = specialist drift signal  |
| Wrong-vendor reply rate                     | `status: wrong_vendor` count / total dispatches                                     | Calibrates the offload matrix accuracy         |
| Cap-exceeded reply rate                     | `status: cap_exceeded` count / total dispatches                                     | Tells us when vendor cap is the real ceiling   |
| Failed-dispatch rate (no reply within 30 min) | bus message redelivery counts                                                       | Specialist health monitor                      |
| Vendor cost trajectory (best-effort)        | `vendor_cost_estimate` field roll-up + manual OpenAI/Gemini dashboard checks weekly | David awareness of per-account burn — observability ONLY, no enforcement cap (Q7) |

**Reply quality:** dispatching Claude agent reviews the reply when it arrives back as part of normal task-completion flow. If the reply is wrong / incomplete / off-spec, the Claude agent either (a) re-dispatches with refined instructions, (b) finishes the task itself, or (c) routes to the other specialist. No separate quality-sampler process. Quality enforcement is per-task at the dispatcher, not periodic at an auditor.

### Success criteria (David's go-steady-state gate at step 15)

Routing volume IS the metric. Specialists succeed if they're meaningfully receiving and completing tasks the Claude fleet would otherwise have done.

1. **Specialists active.** Both codex-specialist and gemini-specialist alive on the bus, completing dispatches without crash loops over 7 days post-full-activation.
2. **Routing volume meaningful.** ≥ 5 dispatches/day per specialist on active workdays. Below this, specialists are decoration not workers — escalate to Dane for offload-matrix review.
3. **No specialist-driven fleet incidents** requiring Dane escalation in the 7-day window.
4. **Wrong-vendor rate < 5%** of dispatches (offload-matrix calibration signal — split per Collie N2 from the original combined threshold so the diagnostic is unambiguous when only one signal breaches).
5. **Cap-exceeded rate < 10%** of dispatches (vendor-cap-headroom signal — separate from #4 because the remediation is different: matrix change vs vendor-plan upsizing or volume reduction).

If any criterion fails, surface to Dane → David for go/hold/rollback decision. **No percentage-based Opus-drop target** — the routing pattern itself is the savings; quantifying it is observability not a gate.

---

## 8. Risks + rollback

| Risk                                                                                        | Likelihood | Mitigation                                                                                                                                            |
|---------------------------------------------------------------------------------------------|------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| Specialist drift — no `.claude/skills/` means workflow knowledge stays only in AGENTS.md     | Medium     | Daily Aussie audit reads specialist memory file + recent replies; flags drift to Dane. Same Aussie-as-analyst pattern that watches Claude agents.       |
| Dispatch envelope mismatch — Claude agent sends malformed payload                            | Low-Medium | Strict envelope contract in §4 + specialists reply `status: blocked, notes: "envelope parse error"` rather than guessing. Force-failure is observability. |
| Specialist vendor cost runaway (Codex / Gemini cap eaten faster than expected)               | Medium     | **No MVP cost cap (David Q7).** Specialists run until vendor maxes them out via PATH 1 self-throttle (`status: cap_exceeded` + abort-partial). Aussie's existing daily codex-seat-audit observes Codex burn; **gemini-cap-audit (parallel pattern) is deferred to §9 #9 — not built at MVP**. Cap-exceeded rate criterion (§7 #5) is the activation-soak observability hook in the meantime. If cost trajectory becomes a real concern, David decides per-vendor cap as a follow-up rule. |
| Wrong-vendor dispatch rate stays high (matrix is wrong)                                      | Medium     | First 7 days are calibration. Aussie tracks per-task-class accuracy and proposes matrix updates to Dane weekly.                                       |
| Bus message redelivery storm if specialist crashes mid-task                                  | Low        | Existing framework — un-acked dispatches redeliver after 5 min. Specialist crash → daemon auto-restart → resumes from inbox. Same as Claude agents.   |
| Vendor binary breakage (codex CLI version bump breaks adapter)                               | Low        | Pinning recommendation: pre-flight `codex --version` against known-good baseline at session-start. Fail-loud if mismatched.                            |
| seat-b auth expiry on codex-specialist over long idle                                        | Low-Medium | Aussie codex-seat-audit already daily; flags `auth_expired` to Dane → Collie re-auth task. Pattern from 2-seat rotation spec §4.                       |
| GEMINI.md symlink approach falls apart if Gemini reads only literal cwd files                | Low        | Pre-flight at §6 step 5: confirm Gemini follows symlinks. If not, replace symlink with copy and add a sync hook to keep it in step with AGENTS.md (decision criterion locked in §5 prereq #3). |

### Rollback plan (per specialist)

```bash
# Per-specialist rollback (~2 minutes):
cortextos stop <specialist>                                 # daemon stops the agent
# Edit orgs/ascendops/enabled-agents.json: remove from active list
# Optional: rm -rf orgs/ascendops/agents/<specialist>/      # full removal if abandoning
# Update Dane's AGENTS.md offload matrix: remove the specialist from default-vendor column
```

Rollback is per-specialist isolated. No cross-agent dependencies. The Claude fleet stays operational throughout.

**Full rollback** (abandon the entire plan):

```bash
cortextos stop codex-specialist gemini-specialist
# Remove both agent dirs
# Revert Dane offload matrix changes
# Revert per-agent GEMINI.md symlinks
```

~5 minutes, no Claude-side state change required. The vendor adapter scaffold (`src/pty/adapters/{openai,google}.ts`) stays intact for any future use.

---

## 9. Open questions deferred to post-MVP

These are documented now so they don't get re-discovered later, but are explicitly out-of-scope for this plan:

1. **Smart hand-off / re-dispatch.** David explicit cut. Revisit if dispatch error rate stays elevated (>5% wrong-vendor) after matrix calibration converges.
2. **Specialist heartbeat skill** (vendor-native — `$CODEX_HOME/skills/heartbeat/SKILL.md` etc.). Trigger: AGENTS.md heartbeat prose grows beyond ~50 lines AND drift across vendors becomes a real maintenance cost.
3. **Specialist Telegram (.env BOT_TOKEN).** David explicit "no for MVP." Revisit if specialist results need direct user reach (e.g. "specialist's reply needs to ping David before Dane sees it" — currently can't happen by design, which is correct).
4. **Specialist memory schema beyond ICM + daily memory.** Whether specialists need their own MEMORY.md, or just ICM + per-day file. MVP: just ICM + per-day. Revisit when ICM topic count gets unwieldy.
5. **Per-agent seat affinity** for codex-specialist on the rotation pool (e.g. always-seat-a for inline pattern B, always-seat-b for specialist). Currently the wrapper rotates based on rate-limit signal alone. Affinity is a post-MVP optimization.
6. **Cross-machine specialist deployment.** Defer until a second machine exists.
7. **Vendor-aware model_tier mapping** (extending PR-0 #278's `DEFAULT_MODEL_TIERS` to include OpenAI + Gemini IDs). MVP: hardcode `model` per specialist. Revisit when tier-rotation becomes a real need.
8. **Specialist commits / git access.** Currently disabled (`local_version_control.enabled: false`). Specialists deliver replies, Claude agents commit. Revisit if specialists routinely produce code that Claude has to review-and-commit by hand without modification.
9. **gemini-cap-audit cron (parallel of Aussie's existing codex-seat-audit).** Not built at MVP — Codex side already has the audit; Gemini side relies on the cap-exceeded rate observability criterion (§7 #5) during soak. Trigger to build: cap-exceeded rate breaches §7 #5 threshold OR David requests symmetric cap visibility across both vendors. Pattern source: 2-seat rotation spec §4 (codex-seat-audit ownership table).

---

## Appendix A — Cited inputs

- `src/pty/adapters/anthropic.ts`, `src/pty/adapters/openai.ts`, `src/pty/adapters/google.ts`, `src/pty/adapters/base.ts` — vendor adapter MVP (commits 619af31, d6166f4, d69384f).
- `src/pty/agent-pty.ts` lines 152, 205, 215 — `loadAdapter(this.config.vendor)` wiring.
- `src/types/index.ts` line 228 — `AgentConfig.vendor?: 'anthropic' | 'openai' | 'google'`.
- `orgs/ascendops/docs/multi-model-migration-runbook.md` — existing vendor-flip recipe (461 LOC).
- `orgs/ascendops/docs/multi-model-rfc-amendment.md` — sub-auth-only constraint (§3), CAO patterns adopted/skipped, Source-RFC corrections.
- `orgs/ascendops/docs/codex-2seat-rotation-spec.md` — 2-seat rotation infrastructure (Collie, 2026-04-29).
- `~/.claude/projects/-Users-davidhunter-cortextos-orgs/memory/project_multi_vendor_specialist_fleet_mvp.md` — David-ratified architecture (2026-04-30 evening).
- `~/.claude/projects/-Users-davidhunter-cortextos-orgs/memory/feedback_no_mvp_state_prs_upstream.md` — polish-first rule (2026-04-30 evening).
- `orgs/ascendops/agents/aussie/memory/2026-04-30.md` — today's session memory (PR-6 surgery, vendor-flip taxonomy, Codex 2-seat verify, MVP recipe verification).
- `orgs/ascendops/agents/aussie/token-comparison.md` — 14-day cap utilization baseline.

---

## Appendix B — Doc lineage

| Date       | Author / Action                                                                                          |
|------------|----------------------------------------------------------------------------------------------------------|
| 2026-04-30 | Aussie — first draft + polish-first single iteration per David rule.                                     |
| 2026-04-30 | Collie — single review pass (bullet-list feedback: block-level + sub-bullet nits).                       |
| 2026-04-30 | Aussie — incorporate Collie blocks. Surface to Dane → David.                                              |

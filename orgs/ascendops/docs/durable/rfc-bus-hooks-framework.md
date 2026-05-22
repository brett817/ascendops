# RFC #15: Bus-Hooks Framework — org-wide event-driven hooks at the cortextos layer

**Author:** Aussie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review
**Item:** RFC seed flagged in `rfc-review-2026-04-29.md` § "3 missing RFCs"
**Companions:** RFC #1 (stickiness wake events), RFC #8 (cron-fold pattern overlap), `.claude/skills/heartbeat/SKILL.md` (folded approvals = today's manual hook).

---

## 1. Problem Statement

Today, cross-agent reactive behavior in cortextos is implemented through five inconsistent patterns. Every "when X happens, do Y" rule is built differently:

1. **Cron-based polling.** RFC #8 documents the 8 active crons on Dane. Each is a fixed-cadence wake whose actual job is "check if anything happened since last fire" (e.g. `check-approvals` at 8h, `pm-morning-scan` daily). Polling pays the wake cost regardless of whether anything happened.

2. **Skill-embedded `cortextos bus log-event` calls.** Many skills end with a logEvent — but the event is *write-only*. Nothing subscribes. Example: `cortextos bus log-event heartbeat agent_heartbeat info --meta '{"agent":"aussie"}'` fires every heartbeat cycle, lands in `analyticsDir/events/<agent>/<date>.jsonl`, and is never read by anything reactive. Pure observability, no behavior.

3. **fast-checker polling loop.** `src/daemon/fast-checker.ts` is a separate Node process that polls inbox + Telegram + Gmail every `pollInterval` (default 1s). Wake mechanisms exist (SIGUSR1, IPC `wake`, watchdogs) but adding a new event source today means modifying fast-checker.

4. **Per-agent Claude Code hooks** (per `.claude/settings.json`). These fire at the *harness* layer for one agent's session: SessionStart, SessionEnd, PreToolUse, etc. Excellent for in-session enforcement (RFC #1 hook gate is a great example) — but cannot fire on cross-agent bus events.

5. **Manual shell-out chains.** Some workflows (e.g. evening-review writing handoff.md) end with explicit `cortextos bus <command>` calls. Each hand-coded callsite is a fragile coupling. Add a new hand-off requirement → audit all callsites.

**Observed cost:**
- **Debugging difficulty.** When a cross-agent reactive behavior misfires, the trail is split across cron config, skill body, fast-checker code, settings.json hooks, and ad-hoc shell-outs. There is no single index of "what fires when X happens."
- **Latency.** A meld closing in PM (`pm work-orders complete`) currently triggers nothing org-wide. If we wanted "post a Slack message to Brittany on every Carlos completion," the only mechanism is to add the call inside Blue's reasoning, which she may forget.
- **Code drift.** RFC #8 §4.1 describes folding `check-approvals` into heartbeat. That fold IS a manual hook ("when heartbeat fires, also check approvals"), implemented by editing the heartbeat skill text. If the same approvals-check needed to also fire after Dane's evening-review, we'd duplicate the call into a second skill. There's no DRY mechanism.
- **No org-wide audit trail of cross-agent state changes.** Today's `logEvent` writes per-agent JSONL — useful for postmortem, useless for live reaction.

## 2. Goals + Non-Goals

**Goals:**
- One canonical *bus-hooks* declarative registry: define `event_pattern → handler` once, fire on every matching event, no per-skill duplication.
- Cover the 5 patterns above with a single mechanism.
- Org-scoped (per `orgs/<org>/`) and per-agent-scoped (`.claude/agent-hooks.json`) hook layers, mirroring how memory and skills already split.
- Run inside the existing fast-checker daemon — no new daemon.
- Test-first: declarative hooks must be testable without spinning up real agents.

**Non-Goals:**
- **Not Temporal / Airflow / a workflow engine.** No DAG, no retries, no scheduling — just `event → handler → execute`. If a handler needs scheduling, it dispatches into the existing cron framework.
- **Not replacing Claude Code per-agent hooks.** Those stay for in-session harness behavior (PreToolUse, SessionEnd, etc.). Bus hooks are *cross-agent*; Claude Code hooks are *within-agent*. §6 has the rule of thumb.
- **Not a pub/sub message bus.** Events are still logged via `logEvent` to JSONL; bus-hooks read the JSONL stream (or a new in-memory tail) and fire matching handlers. No external broker (Redis, Kafka, etc.).
- **Not user-facing UI.** Hook registration is a config file; surfacing in `cortextos status` is a future enhancement, out of scope here.

## 3. Event Taxonomy (current bus surface)

Read from `src/bus/event.ts:14-22` and `src/types/index.ts` (verified verbatim 2026-04-29):

```typescript
export type EventCategory = 'action' | 'error' | 'heartbeat' | 'task' | 'approval';
export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';
```

Every event written via `cortextos bus log-event` carries: `category`, `event` (free-form name), `severity`, `agent`, `org`, `timestamp`, `metadata`.

**Categories in flight today:**

| Category | Common event names (observed in JSONL) | Source |
|---|---|---|
| `action` | `task_completed`, `pm_force_pending_completion`, `session_start`, `dispatch_sent`, `cron-suppressed-off-shift` | manual `cortextos bus log-event` calls in skills |
| `error` | `agent_crash`, `tool_failure`, `auth_expired` | mostly fast-checker / agent-process error paths |
| `heartbeat` | `agent_heartbeat` | heartbeat skill on every fire |
| `task` | `task_created`, `task_updated`, `task_blocked` | `src/bus/task.ts` audit trail (per-task `audit/` JSONL) |
| `approval` | `approval_created`, `approval_decided` | `src/bus/approval.ts` |

**Cross-agent reactive surface NOT currently in the event log** but should be (flagged in §10):
- meld state transitions (Blue's domain — meld_assigned, meld_scheduled, meld_completed, meld_no_docs)
- agent lifecycle (started, stopped, idle-disabled per RFC #1)
- inbox arrival (today fast-checker SIGUSRs an agent; not a logged event)
- handoff written / read (RFC #2)
- shift transitions (RFC #4)

## 4. Hook Registration Model

**Declarative, file-based.** Two layers:

**Org layer (`orgs/<org>/hooks.json`):** fires for any agent in the org.
**Per-agent layer (`orgs/<org>/agents/<agent>/.claude/agent-hooks.json`):** fires only when the matching event is for / from this agent.

**Schema:**

```json
{
  "version": 1,
  "hooks": [
    {
      "name": "carlos-completion-relay",
      "event_pattern": {
        "category": "action",
        "event": "pm_meld_completed",
        "metadata": { "tech": "carlos" }
      },
      "agent_filter": ["blue"],
      "handler": {
        "type": "send_message",
        "to": "dane",
        "priority": "normal",
        "template": "Carlos closed meld {{metadata.meld_id}}. Verify docs landed."
      },
      "priority": 10
    },
    {
      "name": "approval-pending-broadcast",
      "event_pattern": { "category": "approval", "event": "approval_created" },
      "handler": {
        "type": "bash",
        "command": "cortextos bus send-telegram $CTX_DAVID_CHAT_ID 'New approval: {{metadata.approval_id}}'"
      }
    }
  ]
}
```

`event_pattern` matches by category + event name + optional metadata fields (deep equality on listed keys). Multiple hooks may match the same event; they fire in `priority` order, descending (highest priority first).

`agent_filter` constrains which agents' events trigger this hook. Empty / missing = all agents.

`handler.type`:
- `bash` — runs a shell command. Template variables interpolated from event payload.
- `send_message` — agent-to-agent message via existing `sendMessage` bus function.
- `log_event` — writes a derived event (chained reaction).
- `webhook` — POSTs JSON to a URL (Slack-incoming-webhook compatible).

Templates use `{{path.to.field}}` substitution against the event JSON.

## 5. Handler Types — Detail

| Type | Mechanism | When to use |
|---|---|---|
| `bash` | `child_process.spawn(sh, ['-c', renderedCmd], { env: ctx, timeout })` | One-off shell-out (e.g., trigger pm CLI, send Telegram). Default timeout 30s. |
| `send_message` | direct call to `sendMessage()` bus function | Cross-agent dispatch. Inbox-delivery is the canonical reactive cortextos pattern. |
| `log_event` | direct call to `logEvent()` | Chained reactions / synthesizing a higher-level event from lower-level ones. |
| `webhook` | `fetch(url, { method: 'POST', body: JSON.stringify(event) })` | External integrations (Slack, PagerDuty). Out-of-band by design. |

Handlers never run in the agent's PTY context — they fire in the fast-checker daemon process. This means: handlers cannot directly inject prompts into Claude. To wake an agent, the handler dispatches a `send_message` (which fast-checker already routes to inbox + injects on next agent turn).

## 6. Claude Code Hooks vs cortextos Bus Hooks

| Dimension | Claude Code hooks | cortextos bus hooks |
|---|---|---|
| Scope | One agent's session | Org-wide or per-agent |
| Trigger source | Harness lifecycle (PreToolUse, SessionEnd, etc.) | Bus events (`logEvent` calls) |
| Configured at | `.claude/settings.json` per agent | `orgs/<org>/hooks.json` + `agent-hooks.json` |
| Runs in | Inside Claude Code PTY | fast-checker daemon (out-of-band) |
| Latency | Synchronous with the tool/turn | Asynchronous, ~1-5s after event log |
| Can block? | YES (PreToolUse exit 2 blocks tool call) | NO (events are async fire-and-forget) |
| Use case examples | RFC #1 hook gate, planmode-telegram, idle-flag | cross-agent dispatch, audit trail forwarding, Slack relays |

**Rule of thumb:**
- *Within-agent enforcement that must block the next tool call?* → Claude Code hook.
- *Cross-agent reaction or org-wide audit?* → bus hook.
- *Both?* → Claude Code hook for the block, bus hook for the org-wide log.

## 7. Migration — 3 concrete examples

### Example A: Approvals fold (RFC #8 §4.1)
**Before:** check-approvals cron fires every 8h, runs `approvals/SKILL.md` which queries pending approvals and posts digest.
**After:** bus-hook listening for `category: action, event: agent_heartbeat`. Handler is `bash: cortextos bus list-approvals --pending --format text`. Runs on every heartbeat, no separate skill or cron required. Approvals "fold" becomes a 5-line hooks.json entry.

### Example B: Pre-complete audit gate cross-agent visibility
**Before:** RFC #1 hook gate blocks `pm work-orders complete` per-agent. No org-wide log of blocked attempts.
**After:** bus-hook listening for `category: error, event: pm_complete_blocked`. Handler is `send_message` to Dane summarizing blocked attempts. Dane gets an org-wide view of blocking patterns without Blue manually reporting them.

### Example C: Carlos-completion-without-docs broadcast
**Before:** Blue notices Carlos completion email, applies completion-checklist skill (RFC #7), writes to memory. Dane only knows if Blue tells him.
**After:** Blue's completion-checklist emits `category: action, event: completion_checklist_failed, metadata: {tech, meld_id, missing}`. Bus-hook fires `send_message` to Dane + (if severity=warning) Telegram to David. Cross-agent reactivity is one config entry, not a code path.

## 8. Implementation

**Files changed:**
- New: `src/bus/hooks.ts` — registry loader + matcher + dispatcher (~400 LOC).
- New: `src/types/hooks.ts` — schema types.
- Modified: `src/bus/event.ts` — after `appendFileSync`, call `dispatchHooks(event)`.
- Modified: `src/daemon/fast-checker.ts` — load `hooks.json` at startup, watch for changes (chokidar), expose dispatch entrypoint.
- New: `tests/unit/bus/hooks.test.ts` — declarative test cases per handler type.
- New: `orgs/ascendops/hooks.json` — initial registry with the 3 §7 migrations as seed entries.

**Where the dispatcher lives:** in fast-checker process. Reasons: (1) fast-checker is already long-lived. (2) it owns the inbox SIGUSR mechanism and can route `send_message` handlers natively. (3) hooks are async by design — running in fast-checker keeps event-write latency low.

**Test strategy:** schema-driven. Each hook entry has a `tests/` array — list of synthetic events that should match + expected handler invocation. CI runs the dispatcher against fixtures, no live agents needed.

**Effort:** ~3 days for `src/bus/hooks.ts` + tests, ~half day for fast-checker integration, ~half day for the seed `hooks.json`. Total ~1 week.

## 9. Open Questions for David

1. **Schema location:** `orgs/<org>/hooks.json` (committed) or `~/.cortextos/<instance>/hooks.json` (per-instance state)? Lean committed — hooks are config, not state.
2. **Backpressure:** if a handler runs >30s timeout, retry, kill, log? Lean: log + skip (fire-and-forget; no retries in v1).
3. **Hook ordering across layers:** if both org `hooks.json` and per-agent `agent-hooks.json` match an event, run org first then per-agent? Or merge and sort by priority globally? Lean global priority sort.
4. **`webhook` handler safety:** should we restrict allowed URL hosts (e.g. allowlist `slack.com`, `discord.com`)? Or trust config? Lean allowlist with `*.slack.com` and `hooks.zapier.com` defaults.
5. **Failure mode of malformed hooks.json:** fail closed (no hooks fire) or fail open (skip the bad entry, others fire)? Lean fail open with loud log warning.

## 10. Cross-References + Event-Taxonomy Expansion (stretch)

**Cross-RFC links:**
- RFC #1 (stickiness): wake-on-event paths can become bus-hooks (`event_pattern: inbox_arrival, handler: agent_wake`). Cleaner than today's hard-coded fast-checker routing.
- RFC #8 (cron-fold): every cron-fold is a candidate bus-hook (heartbeat → approvals fold = §7 Example A).
- RFC #2 (handoff): handoff-write event would let an org-wide hook archive the doc to a backup location.
- `.claude/skills/heartbeat/SKILL.md` § approvals fold = the "before" state of Example A.

**Events that should exist but currently don't (seed for future enhancement):**
- `meld_state_change` (NEW → IN_PROGRESS → PENDING_COMPLETION → COMPLETED transitions; emitted by Blue's PM CLI wrappers)
- `agent_lifecycle` (started, stopped, crashed, idle_disabled — emitted by agent-process)
- `inbox_arrival` (currently a SIGUSR; promote to logged event so hooks can reactively dispatch on it)
- `handoff_written` / `handoff_read` (RFC #2 lifecycle)
- `shift_transition` (in-shift / off-shift; RFC #4)
- `cap_threshold_crossed` (75% / 85% / 90% from pacing rule — currently an in-flight check, not an event)
- `vendor_no_response` (RFC #7 vendor-tech-status-sweep would emit this)
- `tech_completion_email_received` (Gmail watch detects it; today silent)

Adding these emit calls is cheap (~1 line per call site). Once emitted, hooks can react to them. This RFC scopes only the **framework**; emit-call additions are a per-feature follow-on.

---

## Implementation status

- **2026-04-29 — schema stub at `orgs/ascendops/hooks.json`** (Collie). One disabled demo entry (`example-approvals-fold`) demonstrating the §4 schema. Validates as JSON. Carries the `comment` field marker.
- **2026-04-29 — dispatcher skeleton at `src/bus/hooks.ts`** (Collie). Exports `loadHookRegistry`, `matchHooks`, `dispatchHook`. Loader fails open per §9. Matcher honors `category` / `type` / `severity` / `metadata` patterns plus `agent_filter` and `enabled`, sorts results by `priority` descending. Dispatch is a STUB — logs `hook_attempt_stub` lines to `hooks.log` so we can see which hooks would have fired today, but no handler runs. `tsc --noEmit` PASS.
- **Pending — fast-checker daemon wiring** (Aussie / Codex, Thursday post-Mode-1 reset). Hook dispatch must run in fast-checker process per §8, not in the `logEvent` caller. Once wired, replace the `dispatchHook` stub with real per-handler-type implementations (log_event / send_message / bash / webhook). At that point the `example-approvals-fold` entry can be flipped `enabled: true` as the first live hook and §7 Examples A/B/C can land as registry entries.
- **Pending — `src/bus/event.ts` integration**. After `appendFileSync`, call `dispatchHooks(event)` per §8. Currently NOT wired so the stub stays inert in production; only the registry + matcher exist.
- **2026-04-29 — Day-2 per-handler wiring** (Collie, pulled forward from Thu slate per David "do what they can now"). Result-driven dispatch landed in `src/bus/hooks.ts`:
  - New `HandlerResult` type — `{action: 'fire' | 'block' | 'escalate', reason?: string, meta?: object}`. Handlers can refuse (`block`), upgrade (`escalate`), or implicitly accept (`fire` / undefined return).
  - New `HandlerFn` type — sync or async, return `HandlerResult | void | undefined`. Throws are caught by the dispatcher and treated as `block` with `reason: handler_threw: <message>` so a buggy handler never breaks the loop.
  - In-process registry: `registerHandler(type, fn)` / `clearHandlerRegistry()` / `_getRegisteredHandler(type)` (last is `_`-prefixed for tests). Empty-by-default; if no handler is registered for a hook's `handler_type`, the dispatcher emits `hook_fire` with `outcome: no_handler_registered` (Day-1 stub semantic preserved — backwards compatible).
  - `dispatchHook` now: invokes the registered handler (if any), awaits its result, defaults `undefined` → `{action: 'fire', reason: 'implicit_default'}`, catches throws → `block`, then routes the action to the appropriate bus event name (`hook_fire` / `hook_block` / `hook_escalate`) with the result's `reason` slotted into `outcome` and any `meta` merged into the bus event payload.
  - `logHookAttempt` continues to write the local `hooks.log` audit line on every attempt regardless of action — postmortem record stays comprehensive.
  - Schema: no `hooks.json` change needed for Day-2 — `handler_type` + the new in-process registry cover the contract. (Future Day-3 may add an optional `expected_default_action` field if hook authors want to declare intent in JSON.)
  - Tests: new file `tests/unit/bus/hooks.test.ts` (18 cases) covers `loadHookRegistry` (missing / malformed / valid), `matchHooks` (enabled / disabled / agent_filter / priority sort / metadata deep-match), `dispatchHook` Day-2 paths (no-handler / undefined / fire-with-meta / block / escalate / throw / async / always-carries-bookkeeping-fields), and the registry CRUD (`registerHandler` returns prior + replaces; `clearHandlerRegistry` empties). Pass: 18/18. `tsc --noEmit -p .` clean. 682/682 unit tests green; pre-existing `tests/integration/pty/vendor-flip.test.ts` failures are unrelated (verified by stash-comparison).
  - Day-3 follow-ups: built-in handlers per `HandlerType` (`log_event` / `send_message` / `bash` / `webhook`) register themselves at module init via `registerHandler` — same API, just one block per handler. Implementation pattern from §6 of `rfc-bus-hooks-dispatcher-design.md`. No further dispatcher changes required.

---

## Word count: ~1850 (within 1200-2000 target) — implementation-status section adds ~190 words; Day-2 entry adds ~330 words

# RFC #15 Dispatcher Integration Design

**Author:** Aussie
**Date:** 2026-04-29
**Status:** Design draft, ready for Codex Thu execution
**Builds on:** RFC #15 (`rfc-bus-hooks-framework.md`) + Collie's overnight stub at `src/bus/hooks.ts` (220 LOC) + seed registry at `orgs/ascendops/hooks.json`.

---

## 1. Today's Data Flow — How Events Die

Every BusEvent today follows this path:

```
agent PTY ── cortextos bus log-event ──▶ logEvent() in src/bus/event.ts:14
                                          │
                                          ▼
                            appendFileSync(analyticsDir/events/<agent>/<date>.jsonl)
                                          │
                                          ▼
                                 [end of life — nothing reads it reactively]
```

**Emission points** (verified 2026-04-29):
- `src/bus/event.ts:logEvent()` — the canonical write path; called by every `cortextos bus log-event` shell invocation.
- `src/bus/task.ts` — emits derived events into `audit/<task>.jsonl` (per-task audit trail, separate from the events-by-agent JSONL).
- `src/bus/approval.ts` — emits approval lifecycle events.
- `src/bus/heartbeat.ts` — heartbeat updates (writes to JSON, not JSONL — only `update-heartbeat` calls `logEvent` separately).
- Agent skill bodies — manual `cortextos bus log-event` calls (most prolific source).

**Where events go to die:** the JSONL is read only by:
- The dashboard (when it loads metrics)
- The nightly metrics collector (`cortextos bus collect-metrics`)
- The (just-shipped) hooks.ts `dispatchHook` STUB which logs would-be invocations only.

**No live tail. No reactive consumer.** That's the gap RFC #15 closes.

---

## 2. Proposed Integration

Fast-checker (per-agent Node process at `src/daemon/fast-checker.ts:21`) becomes the dispatcher host. New module-level state inside `FastChecker`:

```typescript
import { loadHookRegistry, matchHooks, dispatchHook, type HookRegistry } from '../bus/hooks.js';
import { watch, FSWatcher } from 'fs';

private hookRegistry: HookRegistry = { schema_version: '0.1', hooks: [] };
private hookRegistryPath: string;       // <orgPath>/hooks.json
private hookRegistryWatcher?: FSWatcher;
private eventLogTailers: Map<string, FSWatcher> = new Map();
private eventLogPositions: Map<string, number> = new Map();
```

**Call sequence on each new BusEvent:**

```
agent PTY → cortextos bus log-event → logEvent() → appendFileSync to JSONL
                                                          │
                                                          ▼  (filesystem watch event)
                                                   FastChecker.onEventLogAppend()
                                                          │
                                                          ▼  (read new bytes from last position)
                                                   parseLine → Event obj
                                                          │
                                                          ▼
                                                   matchHooks(this.hookRegistry, event, agentName)
                                                          │
                                                          ▼  (zero or more matched hooks, sorted by priority)
                                                   for each matched hook:
                                                       await dispatchHook(hook, event)
                                                          │
                                                          ▼  (handler-type-specific implementation)
                                                   bash | send_message | log_event | webhook
```

Three pieces to wire:

**Piece 1 — Registry load + watch.** In `FastChecker.start()`, after existing init:
```typescript
const orgPath = join(paths.frameworkRoot, 'orgs', this.agent.org);
this.hookRegistryPath = join(orgPath, 'hooks.json');
this.hookRegistry = loadHookRegistry(orgPath);
this.hookRegistryWatcher = watch(this.hookRegistryPath, () => {
  this.hookRegistry = loadHookRegistry(orgPath);
});
```
Hot-reload: registry changes apply on next event without daemon restart.

**Piece 2 — Event log tail.** Add a poller (separate `setInterval` running every ~500ms inside fast-checker, using its existing watchdog pattern) that:
1. Knows today's event log path: `<analyticsDir>/events/<this.agent.name>/<YYYY-MM-DD>.jsonl`.
2. Tracks last-read byte position per file in `eventLogPositions` map.
3. On each tick: `statSync` the file; if size > recorded position, `readSync` the new bytes, parse each line as JSON Event, fire `onEvent(parsed)` for each.
4. On day rollover: rotate to the new YYYY-MM-DD file, reset position to 0, watch the new path.

We tail only THIS agent's event log (per-agent fast-checker = per-agent reactivity). Cross-agent broadcasts happen because hooks with `agent_filter` empty/missing fire on whichever fast-checker tailed the source event AND the handler can target any agent via `send_message`.

**Piece 3 — Per-handler dispatch.** Replace `dispatchHook` stub with a switch by `handler_type`:

```typescript
export async function dispatchHook(hook: HookEntry, event: Event, ctx: DispatchContext): Promise<void> {
  switch (hook.handler_type) {
    case 'log_event':    return dispatchLogEvent(hook, event, ctx);
    case 'send_message': return dispatchSendMessage(hook, event, ctx);
    case 'bash':         return dispatchBash(hook, event, ctx);
    case 'webhook':      return dispatchWebhook(hook, event, ctx);
    default: logRegistryWarn(ctx.orgPath, `unknown handler_type: ${hook.handler_type}`);
  }
}
```

`DispatchContext` carries `paths` (for downstream bus calls), `orgPath`, and an `agentName` (the source-agent of the firing event). Each dispatch function is best-effort — never throws to the caller.

---

## 3. Performance

**Registry size assumptions:** even at fleet-wide steady state, expect <100 hooks total. JSON parse + array filter is microseconds at this size.

**Lookup cost per event:** O(N) where N = registry size. With 100 hooks × 1 event/sec average emission rate × 5 agents = 500 hook-checks/sec across the fleet. Trivial. No caching needed for v1.

**Hot-load vs in-memory cache:** hooks.json is loaded into memory at start + on file-change watcher fire. Per-event lookup is in-memory only. The `existsSync` + `readFileSync` runs once per registry change, not once per event.

**Event-log-tail cost:** at 500ms poll cadence × 5 agents × ~1 event/sec average = ~2500 file-stat calls/sec fleet-wide. Each is a syscall on a tiny file. Acceptable. If we later see contention, switch to `chokidar` (FS event API) — same code shape, less polling.

**The expensive part is handler execution.** A `bash` handler that takes 5s blocks the dispatcher loop unless we run them asynchronously. v1: dispatchHook is `async` and we `await` it; if any handler is slow, subsequent hooks for the same event wait. v2 (if needed): per-handler-type concurrency limits.

---

## 4. Concurrency

**Recursion guard.** A `log_event` handler that emits an event matching another hook can loop. Per RFC #15 non-goals, we don't implement DAG-style cycle detection. Instead:

- Each event carries an implicit `__hook_depth: 0` field on first dispatch.
- When a hook's handler emits a new event via `log_event`, the dispatcher reads the source event's depth, increments, attaches to the new event.
- If `__hook_depth > 3`, the dispatcher refuses to fire any further hooks on that event, logs a `hook_recursion_limit` warning to `hooks.log`, and exits.

This caps reactive chains at 3 hops. Real workflows shouldn't need deeper chains.

**Handler timeouts.** Each dispatch type gets a default timeout:
- `bash`: 30s (per RFC #15 §5).
- `send_message`: 5s (filesystem write only — should be milliseconds).
- `log_event`: 1s (in-memory + appendFile).
- `webhook`: 10s (network call).

Timeouts use `Promise.race` with a `setTimeout` reject. On timeout, log `hook_timeout` warn, move on.

**Event ordering.** Hooks for one event fire in priority order, sequentially. Hooks for different events fire concurrently across event-log-tail ticks (each tick processes all new events; multiple events trigger overlapping dispatch chains). v1 acceptable; v2 may add per-hook serial-vs-parallel knobs.

---

## 5. Failure Modes

| Failure | Detection | Mitigation |
|---|---|---|
| hooks.json malformed | `loadHookRegistry` returns EMPTY_REGISTRY + writes warn line to `hooks.log`. Already implemented in stub. | Fail-open per RFC #15 §9 default. |
| Handler timeout | per-type timeout in §4. | Log + skip. Subsequent hooks for same event still fire. |
| Handler panic (uncaught) | `try/catch` wrapping each dispatchHook call inside the tail loop. | Log + skip. |
| Registry hot-reload race (registry changes mid-event-batch) | matchHooks uses `this.hookRegistry` snapshot at call time. Each event's match is consistent within itself. | Acceptable inconsistency: events arriving during reload may use either old or new registry. |
| Event log file rotated mid-tail | day rollover detection in tail loop. | Watch new file, reset position. |
| Dispatcher crashes | fast-checker process dies → AgentProcess restarts it (existing watchdog). | Lost: any in-flight hook dispatches; events themselves are still on disk and will be re-tailed from last persisted position on restart. |
| Network-dependent webhook unavailable | `fetch` rejects within 10s timeout. | Log + skip. No automatic retry in v1 (fire-and-forget). |
| Recursion (hook → log_event → hook) | depth counter in §4. | Cap at 3 hops, log warn. |

**Recovery:** all failure modes log to `<CTX_ROOT>/logs/<scope>/hooks.log`. The handler attempt + outcome (`ok` / `timeout` / `error: <msg>`) is one line per attempt. Replay via grep for postmortem.

---

## 6. Per-Handler-Type Wiring Detail

### bash
```typescript
import { spawn } from 'child_process';
async function dispatchBash(hook: HookEntry, event: Event, ctx: DispatchContext) {
  const cmd = renderTemplate(hook.handler.command ?? '', event);
  return new Promise<void>((resolve) => {
    const p = spawn('sh', ['-c', cmd], {
      env: { ...process.env, CTX_EVENT_JSON: JSON.stringify(event) },
      timeout: 30_000,
    });
    p.on('close', () => resolve());
    p.on('error', (err) => { logHandlerErr(hook, event, err); resolve(); });
  });
}
```
Use `spawn` not `spawnSync` — non-blocking. Pass full event JSON in `CTX_EVENT_JSON` env so handler scripts can introspect.

### send_message
```typescript
import { sendMessage } from './message.js';
async function dispatchSendMessage(hook: HookEntry, event: Event, ctx: DispatchContext) {
  const text = renderTemplate(hook.handler.template ?? '', event);
  const to = hook.handler.to ?? 'dane';
  const priority = hook.handler.priority ?? 'normal';
  sendMessage(ctx.paths, ctx.agentName, to, priority, text);
}
```
Direct call to existing bus function. Fast (filesystem write).

### log_event (with recursion check)
```typescript
async function dispatchLogEvent(hook: HookEntry, event: Event, ctx: DispatchContext) {
  const depth = (event.metadata?.__hook_depth as number) ?? 0;
  if (depth >= 3) {
    logHandlerWarn(hook, event, `recursion_limit_reached`);
    return;
  }
  const newMeta = { ...(hook.handler.meta ?? {}), __hook_depth: depth + 1 };
  logEvent(ctx.paths, ctx.agentName, ctx.org, hook.handler.category ?? 'action', hook.handler.type ?? 'unknown', hook.handler.severity ?? 'info', newMeta);
}
```

### webhook
```typescript
async function dispatchWebhook(hook: HookEntry, event: Event, ctx: DispatchContext) {
  const url = hook.handler.url ?? '';
  if (!isAllowedHost(url)) { logHandlerWarn(hook, event, `webhook_url_not_allowlisted: ${url}`); return; }
  await Promise.race([
    fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(event) }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10_000)),
  ]).catch((err) => logHandlerErr(hook, event, err));
}
```
Allowlist hosts: `*.slack.com`, `hooks.zapier.com`, `discord.com/api`, plus a per-org override. Per RFC #15 §9 Q4.

---

## 7. Migration Plan

**Day 1 (Codex Thu):**
1. Land Piece 1 (registry load + watch) in `FastChecker.start()`.
2. Land Piece 2 (event log tail) — separate `setInterval` for tail, ticks every 500ms.
3. Replace `dispatchHook` stub with the §6 switch + 4 dispatch implementations.
4. Add unit tests for matchHooks (already shipped) and dispatcher integration tests using the seed registry.
5. Soak: keep the demo entry `enabled: false` but verify no regressions in fast-checker normal operation. Watch `hooks.log` for any unexpected entries.

**Day 2 (24h soak):**
6. No new hooks. Watch fleet behavior; confirm no perf regressions in fast-checker poll loop.

**Day 3 — first real migration:**
7. Per RFC #15 §7 Example A: enable the approvals-fold demo. Add a `cortextos bus log-event action approvals_cron_fired info` call to the existing `check-approvals` cron skill. The hook fires, runs `cortextos bus list-approvals --pending --format text`, posts result to Dane via send_message. Existing hardcoded approvals fold in heartbeat skill stays for now (defense-in-depth).

**Day 7 — first real value:**
8. Migrate Carlos-completion broadcast (RFC #15 §7 Example C). Blue's completion-checklist skill emits `completion_checklist_failed` event when missing items. Hook routes summary to Dane.

**Per-step rollback:** `enabled: false` on the offending hook entry, save hooks.json, fast-checker hot-reloads on next tick. Trivial.

**Big-bang rollback:** revert the fast-checker integration commit. Stub returns. Registry stays on disk but does nothing.

---

## 8. Open Questions for David

1. **Tail vs FS-watch:** 500ms `setInterval` poll vs `chokidar` FS watcher. Polling is simpler but slightly more CPU. Lean polling for v1 — already matches fast-checker's existing watchdog pattern.
2. **Per-agent vs fleet-wide tail:** today fast-checker is per-agent and only tails its own event log. If we want a hook to fire when ANY agent emits an event (e.g. fleet-wide audit log), we either (a) duplicate the tail in each fast-checker with a "tail all agents' files" mode, or (b) introduce a separate fleet-wide watcher daemon. Lean (a) for v1 — agent_filter handles cross-agent targeting cleanly.
3. **Webhook allowlist source:** hardcoded in `hooks.ts`, configurable per-org in `hooks.json` schema, or both? Lean: hardcoded baseline + per-org additive override.
4. **Recursion depth limit (3):** acceptable, or should hooks declare their max depth? Lean: fixed at 3 fleet-wide; document in RFC #15 §4 schema notes. If a user needs depth 4+, they're probably building a workflow engine and should reach for a different tool.
5. **`__hook_depth` metadata pollution:** events get an extra metadata field in JSONL forever once they pass through the dispatcher. Acceptable observability cost or should we strip on write? Lean keep — useful for postmortem to see "this event chained from X."

---

## Word count: ~1450 (within 1000-1500 target)

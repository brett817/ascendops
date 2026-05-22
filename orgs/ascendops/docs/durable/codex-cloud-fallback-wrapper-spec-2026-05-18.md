# Codex Cloud Fallback Wrapper — Spec

**Author:** collie (architect; spec only — no code)
**Date:** 2026-05-18
**For:** codie (implementation, ~1h estimate)
**Reviewer:** collie (workflow inversion in reverse — collie planned, codie writes, collie reviews)
**Source dispatch:** Dane C3 from evening review 2026-05-18
**Status:** SPEC READY FOR PICKUP

---

## TL;DR

`Agent` calls with `subagent_type: codex:codex-rescue` sometimes return immediately with a Codex Cloud `task-id` that turns out to be invalid (404 on subsequent `codex cloud status <id>` poll). When this happens, the calling agent currently has to manually detect the failure, log it, and pivot to inline write. This wrapper makes that pivot automatic: on Codex Cloud failure modes, the wrapper logs the event and runs the original task spec inline without re-prompting the calling agent.

---

## Failure pattern observed 2026-05-18

While shipping P1 #2 (cli-anything-pm PR #10), collie dispatched a `codex:codex-rescue` subagent with a complete implementation spec for the auto-hydrate fix.

**What happened:**
1. Sub-agent returned in ~50s with: `Codex Task started in the background as task-mpbqewxp-56xgrq. Check /codex:status task-mpbqewxp-56xgrq for progress.`
2. Sub-agent reported completed status to the harness — done.
3. Collie polled the task: `codex cloud status task-mpbqewxp-56xgrq` → `404 Not Found; "detail":"Invalid task ID"`
4. No actual work happened — the cloud task never existed, but the sub-agent dispatch and the local-execution-side both believed it was running.
5. Collie pivoted inline, wrote the fix manually, shipped PR #10 in ~25 min.

**Cost:**
- ~50s of sub-agent dispatch tokens for nothing
- ~30s of polling tokens
- Mental switching cost (operator confusion: "is it running or not?")

**Root cause hypothesis (unconfirmed):** ChatGPT Cloud Codex API may have intermittent task-creation failures that return a synthetic task-id without persisting the task. Could be quota-adjacent, rate-limit-adjacent, or a deploy-window artifact. Not investigated tonight — out of scope for this spec.

---

## Wrapper design

### Goal

When an agent dispatches a Codex Cloud task, the harness should transparently fall back to inline execution if the cloud task is unreachable, **without re-prompting the calling agent and without losing the original spec**.

### Interface

A wrapper around the Codex Cloud dispatch entrypoint that the `Agent` tool uses when `subagent_type: codex:codex-rescue`. Pseudo-shape (Codie may refactor naming):

```
dispatchCodexCloudWithFallback(spec, options):
  taskId = codexCloud.submitTask(spec)
  if taskId is missing:
    return runInline(spec, reason='no_task_id')

  loop up to maxPollAttempts times:
    status = codexCloud.status(taskId)
    if status code == 404:
      logEvent('codex_cloud_invalid_task_id', {task_id, spec_hash})
      return runInline(spec, reason='invalid_task_id', original_task_id) if fallbackInline else error
    if status state == 'completed':
      return status result
    if status state == 'failed':
      logEvent('codex_cloud_task_failed', {task_id, state})
      return runInline(spec, reason='task_failed') if fallbackInline else status
    sleep POLL_INTERVAL_MS

  # poll loop exhausted
  logEvent('codex_cloud_poll_timeout', {task_id, attempts})
  return runInline(spec, reason='poll_timeout') if fallbackInline else error
```

### Spec preservation

`CodexCloudSpec` must include the full original prompt + file targets + branch/commit info so inline fallback knows what was asked. This is already present in the dispatch payload — no new schema work.

### Inline runner

`runInline(spec)` is the existing local Codex CLI path: `codex exec` with the same prompt. Same auth, same model. The difference is the work happens in the calling agent's PTY context (not Cloud).

Effect on calling agent: from their perspective, `Agent(subagent_type: codex:codex-rescue, prompt: ...)` either returns the cloud result OR the inline result. They don't have to know which path ran — only the `meta.executed_path: 'cloud' | 'inline_fallback'` field tells them.

---

## Failure modes to test

1. **Cloud returns 404 on status poll** (the observed 2026-05-18 failure)
2. **Cloud returns timeout/network error on initial dispatch** (no task-id at all)
3. **Cloud returns task-id but never transitions out of `queued`** (poll-timeout case)
4. **Cloud returns `failed` state on first poll** (task created but immediately failed)
5. **Cloud returns valid completed result** (happy path — no fallback, just pass through)
6. **Inline runner itself fails** (fallback-of-fallback — surface the original error + the inline error to the calling agent, do not silently swallow)
7. **Spec missing required fields for inline** (fail-fast with a clear error rather than guessing — should be caught at dispatch validation, not at fallback time)

Test approach: mock the Cloud dispatch + status calls to return each failure shape, assert the wrapper either passes through or falls back per the matrix. Use the existing test pattern in `tests/unit/...` — Codie picks the right test file.

---

## Telemetry hooks

Three new event types added to the existing `cortextos bus log-event` schema:

| Category | Event | Severity | Meta |
|---|---|---|---|
| `action` | `codex_cloud_invalid_task_id` | warn | `{task_id, spec_hash, fallback_executed: bool}` |
| `action` | `codex_cloud_task_failed` | error | `{task_id, state, fallback_executed: bool}` |
| `action` | `codex_cloud_poll_timeout` | warn | `{task_id, attempts, fallback_executed: bool}` |

Plus one happy-path heartbeat for success-rate trending:

| Category | Event | Severity | Meta |
|---|---|---|---|
| `action` | `codex_cloud_task_completed` | info | `{task_id, duration_ms, executed_path: 'cloud'}` |
| `action` | `codex_cloud_fallback_completed` | info | `{original_task_id, duration_ms, executed_path: 'inline_fallback', fallback_reason}` |

With these events, a future skill or dashboard query can compute "% of Codex Cloud dispatches that hit fallback" over a rolling window — trend visibility for whether the Cloud reliability is improving or degrading.

---

## Implementation notes for Codie

### Files likely touched

- `src/agent/dispatch.ts` (or wherever `Agent(subagent_type: codex:codex-rescue)` resolves) — add the wrapper call
- Codex CLI runtime helper — likely already in `/Users/davidhunter/.claude/plugins/marketplaces/openai-codex/plugins/codex/skills/codex-cli-runtime/SKILL.md` — read that skill first for the existing contract
- New test file `tests/unit/agent/codex-cloud-fallback.test.ts` (or wherever existing dispatch tests live)
- `src/types/index.ts` — add the new event type strings to the union if events are strongly typed

### Things to NOT do

- Do NOT change the `Agent` tool surface contract for callers — the wrapper is invisible to them
- Do NOT silently swallow Cloud errors — every failure must log an event so trend analysis works
- Do NOT add a config flag to disable fallback — default-on is correct; if Cloud is unreliable, inline is always safer than failing the calling agent's task
- Do NOT bake in `chatgpt.com` as the failure detection signal — just match on HTTP 404 + the documented `"Invalid task ID"` error body. Provider-agnostic.

### Risk to flag

The wrapper increases the calling agent's PTY context burn when fallback fires (inline = the agent's own context window pays the cost of the spec execution). Acceptable in tonight's pattern (one-off failures), but if Cloud reliability degrades to >30% fallback rate, calling agents will see their cap eaten by failed Cloud dispatches. Trend telemetry above is the early-warning signal — if `codex_cloud_fallback_completed` rate spikes, escalate to David for Cloud-side investigation.

---

## Scope boundaries

**IN scope:**
- The wrapper described above
- Failure-mode tests per the matrix
- Telemetry events
- Spec preservation through fallback

**OUT of scope (separate work if needed):**
- Investigation of WHY Codex Cloud returned an invalid task-id tonight (could be quota, deploy artifact, etc. — Anthropic/OpenAI ticket territory)
- Retry-with-exponential-backoff on Cloud dispatch (this wrapper falls back on first failure; retry policy is a separate concern)
- Caching of recent Cloud dispatch results (no current need)
- Cross-agent dedup of identical specs (no current need)

---

## Acceptance criteria

- [ ] Wrapper invoked transparently by `Agent(subagent_type: codex:codex-rescue)` calls
- [ ] All 7 failure-mode tests pass
- [ ] Telemetry events fire on each failure path
- [ ] Happy-path Cloud dispatches still work (no regression)
- [ ] Calling-agent interface unchanged
- [ ] Spec preservation verified (inline fallback receives full original prompt)
- [ ] PR opened with full diff + test counts
- [ ] Collie review pass before merge

---

## Workflow note (reverse inversion)

Standard CLAUDE.md workflow: Collie plans → Codex writes → Collie reviews. Tonight's inversion (David 2026-05-14 rule, locked in MEMORY.md): when Codie has backlog AND Collie has cap headroom AND change is small/clear, Collie writes, Codie reviews.

This spec inverts the inversion: Collie has NO cap headroom tonight (75-85% estimated, usage API rate-limited so unverifiable). Codie has cap headroom from a lighter Sunday. Spec captures the Cloud-failure context while it's fresh in Collie's memory, then hands clean spec to Codie for tomorrow morning's write. Collie reviews when fresh.

This is the right shape for ANY non-trivial build when the planner has cap pressure: don't push through, write the spec now and dispatch the write tomorrow.

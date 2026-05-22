# Codex Cap-Watchdog Spec

**Author:** aussie (research + spec)
**Date:** 2026-05-22 (UTC) / 2026-05-21 evening EDT
**Dispatcher:** Dane via overnight greenlit (David)
**Source task:** task_1779417413615_758473
**Status:** RESEARCH-ONLY SPEC — no implementation in this artifact. Companion to existing `cap-watchdog` (Claude Max).

---

## TL;DR (morning brief)

**(a) What cap-detection signal exists today:** Post-hoc classifier already lives in `codex-companion.mjs:629-637` (`logCodexDispatchFailure`). Distinguishes `cap-hit` vs `sandbox-write-failed` vs `other` via stderr regex on dispatch failures, fires `codex_dispatch_failed` event. Reactive only — fires AFTER a job fails. Two-seat rotation spec (`codex-2seat-rotation-spec.md`, 2026-04-29) designs a seat-flip on cap-hit but uses the same reactive trigger.

**(b) What does NOT exist:** Pre-emptive cap state polling (no equivalent to `cortextos bus query-cap` for Codex), latency-anomaly monitoring, proactive operator alert before cap hits, structured cap-state telemetry that mirrors Claude Max's `{five_hour_pct, weekly_pct}` shape. ChatGPT subscription metadata API access also unverified — Codex CLI has no documented cap-readout command equivalent to Anthropic's response headers.

**(c) Recommended next-step:** Implement a **regex-grep daemon** that tails Codex CLI sessions' stderr in real time (NOT post-failure-only), surfacing `cap-warning` events on partial-match patterns ("approaching limit", "75% of quota") and `cap-hit` events on full match. Phase 2: add OAuth refresh-pattern monitoring (rapid `refresh_token_reused` cycles signal seat sharing under cap pressure). Phase 3 (deferred): integrate with 2-seat rotation as the proactive trigger, replacing the current reactive trigger.

**Sticky constraint:** Codex API has no documented cap-readout endpoint at this time. All cap detection must be inferred from CLI side-channels (stderr patterns, exit codes, OAuth error codes, latency). This is fundamentally different from Claude Max's `query-cap` which reads canonical ratelimit response headers.

---

## 1. Detection Signal Inventory

### 1.1 stderr regex patterns (PROVEN — already shipped reactive)

Live in `codex-companion.mjs:633`. Current classifier:

```js
const mode =
  /Operation not permitted|sandbox.{0,20}(write|denied)/i.test(err) ? "sandbox-write-failed" :
  /usage limit|rate limit|quota|reached your .{0,40}limit|max requests/i.test(err) ? "cap-hit" :
  "other";
```

**Strength:** zero infra change to extend — same regex engine, same event surface (`codex_dispatch_failed`).

**Weakness:** post-hoc only. Triggers AFTER a failure. By the time it fires, the operator has already lost the job's output and the agent has already burned tokens on the dispatch round trip.

**Extension path:** Run the same regex against streaming stderr (tail mode) instead of only on `exitStatus !== 0`. Match on partial-warning patterns (`approaching|nearing|n% (of|remaining)`) for proactive alerts BEFORE the hard cap-hit.

### 1.2 OAuth 401 error codes (PROVEN — distinguish 2 modes)

Locked fleet-wide via memory `feedback_codex_401_distinguish_codes`. Two distinct codes, two distinct fixes:

| Code | Cause | Fix |
|------|-------|-----|
| `refresh_token_reused` | Two processes shared refresh token (race) | Interactive `codex login` |
| `token_expired` (without reuse marker) | Subscription cap | Stop agent, wait for reset |

**Source signature in stdout:**
- Mode A: `"code":"refresh_token_reused"` + message `"refresh token has already been used"`
- Mode B: lacks reuse marker, contains `token_expired` AND rate/quota wording

**Verification rule:** ALWAYS read the verbatim error code from stdout BEFORE prescribing mitigation. Mode A misdiagnosed-as-cap on 2026-05-13 cost ~30min of unnecessary "wait" posture (Dane caught it).

**Detection automation:** Wire a tail-grep on `~/.cortextos/{instance}/logs/{agent}/stdout.log` matching:
- `code":"refresh_token_reused"` → emit `codex_oauth_race` event
- `token_expired` AND `(rate_limit|quota_exceeded|usage_limit)` → emit `codex_cap_hit` event

### 1.3 Codex CLI exit codes (PARTIAL — needs cataloging)

The CLI returns non-zero on failure but doesn't currently expose distinct exit codes for cap vs auth vs sandbox. `codex-companion.mjs` infers mode from stderr text, not exit code. Per `codex-2seat-rotation-spec.md`, the wrapper script detects cap via stderr regex match + re-execs after seat flip — same constraint.

**Research gap:** Need to test live whether Codex CLI distinguishes cap-hit (e.g. exit 4) from auth (exit 1) from sandbox (exit 2). If it does, exit code is a cheaper detection signal than regex. If it doesn't, regex is canonical.

**Defer:** Live exit-code matrix testing requires actually triggering each failure mode in a controlled context. Out of scope for tonight's spec — flag for Codie or Collie to verify on next Codex incident.

### 1.4 Latency anomaly (UNPROVEN — concept only)

Mentioned in Dane's scope. Theory: cap pressure correlates with response slowdown BEFORE hard rejection (ChatGPT's gradual throttle pattern). Counter-evidence: Codex CLI has no public latency telemetry; agents would need to instrument round-trip times themselves.

**Detection automation candidate:** Wrap `codex exec` calls with a timing wrapper that logs `codex_dispatch_latency_ms` events. Drift > 2σ from baseline triggers `codex_latency_anomaly`. Baseline window: rolling 24h of same-prompt-class dispatches.

**Reservation:** This is theoretical. Without a known-baseline measurement run, can't validate the signal-to-noise ratio. Genuine cap pressure may or may not correlate with latency — could be steady → cliff, no gradual ramp.

**Defer:** Implement timing wrapper as instrumentation BEFORE deciding if latency anomaly is a useful signal. Phase 2.

### 1.5 ChatGPT subscription metadata (UNVERIFIED — needs vendor research)

Dane's scope mentions "ChatGPT API metadata if available". Two possibilities:
1. **ChatGPT API response headers** (analog of Anthropic's `anthropic-ratelimit-*` headers): unverified. Would need a live API probe to confirm presence.
2. **ChatGPT account dashboard scrape** (analog of our existing Claude Max dashboard scraper): unverified. Would need to identify a programmatic endpoint.

**Research action:** Run a single `codex exec` with `--verbose` (if such flag exists) or trace HTTP traffic with `mitmproxy` to see what metadata ChatGPT returns in response headers. Defer to Codie or Collie for live test.

**Pessimistic prior:** ChatGPT's API contract is less ratelimit-transparent than Anthropic's. The 2-seat rotation spec was written 4 weeks ago and never identified a canonical cap-readout endpoint — if there had been one, it would already be in the spec. Likely there is no clean equivalent to `cortextos bus query-cap` for Codex.

---

## 2. Action Surface

### 2.1 Detection → event log

Mirror Claude Max cap-watchdog's event shape:

```json
{
  "category": "action",
  "event": "codex_cap_watchdog_signal",
  "severity": "warning|info",
  "metadata": {
    "agent": "<name>",
    "signal_type": "stderr_pattern|oauth_race|cap_hit|latency_anomaly",
    "confidence": "high|medium|low",
    "raw_excerpt": "<200 chars>",
    "mitigation_suggested": "wait_for_reset|run_codex_login|seat_flip|defer"
  }
}
```

### 2.2 Detection → operator surface

Single message per detected agent per cycle (no re-flood):

```
cortextos bus send-message dane normal "Codex cap signal: <agent> hit <signal_type>. Confidence <X>. Raw excerpt: \"<excerpt>\". Suggested mitigation: <mitigation>."
```

If signal_type = `oauth_race`: surface to David directly (he runs `codex login`). If `cap_hit`: surface to Dane (he decides stop-agent vs seat-flip vs wait). If `latency_anomaly`: surface to aussie's own event log only (instrumentation signal, not actionable yet).

### 2.3 Mitigation matrix

| Signal | First-line mitigation | Fallback | Owner |
|--------|----------------------|----------|-------|
| `oauth_race` (refresh_token_reused) | David runs `codex login` | none | David |
| `cap_hit` (full quota) | `cortextos stop <agent>` + wait | Seat flip if 2-seat rotation shipped | Dane |
| `stderr_warning` (approaching limit) | Pre-emptive seat flip OR pause non-urgent dispatches | Notify Dane to pause backlog | Dane |
| `latency_anomaly` | Log only — research signal | n/a (Phase 2+) | aussie |

---

## 3. Data Shape Mirror

Existing Claude Max cap-watchdog reads `cortextos bus query-cap` and emits:

```json
{
  "source": "headers" | "dashboard" | "estimate",
  "five_hour_pct": N,
  "weekly_pct": M,
  "timestamp": "<ISO>",
  "agent": "<name>",
  "meta": { "confidence": "...", "note": "..." }
}
```

Codex cap-watchdog **CANNOT match this shape directly** because Codex has no quantified percentage available. Proposed Codex shape:

```json
{
  "source": "stderr_pattern" | "oauth_code" | "latency",
  "cap_state": "ok" | "approaching" | "hit" | "unknown",
  "confidence": "high" | "medium" | "low",
  "last_signal_ts": "<ISO>",
  "agent": "<name>",
  "meta": {
    "signal_type": "...",
    "raw_excerpt": "...",
    "mitigation_suggested": "..."
  }
}
```

**Dashboard compose path:** A unified "fleet cap status" view can render both shapes:
- Claude Max agents: show pct + window
- Codex agents: show cap_state + confidence

Both schemas carry `agent`, `confidence`, `source`, `timestamp` — minimum joinable surface.

---

## 4. Prototype Sketch (out of tonight's scope; outline only)

A `codex-cap-watchdog` skill mirroring `cap-watchdog` SKILL.md shape:

**Step 1:** For each Codex-using agent, tail stdout.log (last 100 lines) and check for any of:
- `code":"refresh_token_reused"`
- `token_expired` + cap keyword
- `usage limit|rate limit|quota|max requests` partial match
- `Operation not permitted|sandbox.+(write|denied)` (already covered — informational only here)

**Step 2:** For each match, emit `codex_cap_watchdog_signal` event with the appropriate signal_type + confidence.

**Step 3:** Aggregate by agent. If agent has any `cap_hit` signal in last 4h, send one Dane ping (dedupe per agent per cycle). If any `oauth_race`, send David Telegram. If any `stderr_warning`, log only.

**Step 4:** Write daily memory entry summary (mirror existing skill Step 7).

**Cadence:** Piggyback on aussie's existing 4h cap-watchdog cron. Single sweep covers both Claude Max + Codex.

**Estimated implementation:** ~2-3h for Codie/Collie once spec is approved. Bulk of work is the tail-grep + agent-enumeration; event/message wiring is plumbing.

---

## 5. Open Questions for Next Cycle

1. **Does Codex CLI expose distinct exit codes per failure mode?** Codie/Collie test on next Codex incident.
2. **Does ChatGPT API return ratelimit headers?** Trace one live dispatch — defer to whoever has Codex auth time available.
3. **Is 2-seat rotation actually shipped or still spec-only?** Verify against `~/.codex-seats/` directory existence — out of scope tonight.
4. **Should cap-warning trigger automatic dispatch pause, or always require human?** Risk: false positives pause urgent work. Recommend: require human ACK at first, automate after 1 month of clean detection data.
5. **Latency anomaly signal-to-noise viability?** Needs baseline measurement run before useful as detection signal.

---

## 6. Sources Cited

- `cap-watchdog/SKILL.md` (existing Claude Max watchdog — shape reference)
- `codex-companion.mjs:629-637` (existing reactive classifier — extension base)
- `orgs/ascendops/docs/codex-2seat-rotation-spec.md` (cap-aware seat flip design, 2026-04-29)
- `orgs/ascendops/docs/codex-cloud-fallback-wrapper-spec-2026-05-18.md` (related but different failure mode — Cloud 404, not cap)
- Memory: `feedback_codex_401_distinguish_codes.md` (Mode A vs B distinction, 2026-05-13)
- Memory: `project_codex_subscription_quota_signal.md` (refresh_token_reused vs token_expired)
- Fleet incident log: Collie 2026-05-13 codex 401 saga (msg 1778690255174-dane-zt3na "codex 401 quota signal" → corrected via msg 1778690327014-dane-8xtar "actual error code = refresh_token_reused")

---

## 7. Recommended Next-Step (single-sentence summary for Dane's morning brief)

Ship a Phase-1 tail-grep daemon that surfaces `codex_cap_watchdog_signal` events from stdout.log pattern matching (regex already proven in `codex-companion.mjs`), mirroring the Claude Max watchdog's per-agent enumeration + 4h cadence; defer latency-anomaly + ChatGPT-metadata detection to Phase 2 pending live vendor-response research.

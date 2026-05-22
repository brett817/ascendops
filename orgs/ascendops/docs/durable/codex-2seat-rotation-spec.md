# Codex CLI 2-Seat Rotation Spec

**Author:** Collie
**Date:** 2026-04-29
**Trigger:** David direct via Dane (msg 1777477779370). Implementation-ready by tomorrow morning.
**Goal:** ChatGPT Business 2-seat — when one seat hits rate limit, agents transparently switch to the other.

---

## TL;DR

- **`CODEX_HOME` env var is the swap point.** Verified live: setting `CODEX_HOME=/tmp/test-codex-home codex login status` errored with "CODEX_HOME points to /tmp/test-codex-home, but that path does not exist" — the codex Rust binary reads it. One env-var change repoints everything: `auth.json`, `config.toml`, `sessions/`, `logs_*.sqlite`, etc.
- **Layout:** `~/.codex-seats/seat-a/` and `~/.codex-seats/seat-b/`, parallel structure to current `~/.codex/`. Each carries its own ChatGPT Business OAuth tokens. Migration path: copy current `~/.codex/` into `seat-a/`.
- **Switch mechanism:** thin wrapper script `~/.local/bin/codex` that precedes the real binary in PATH. Reads `~/.codex-seats/active-seat.json`, sets `CODEX_HOME`, exec's the real codex. On stderr cap-signature match, atomic-flips the active seat and re-execs once.
- **Rate-limit detection:** reuse the regex classifier from RFC #14 PIECE 3 (already shipped in `codex-companion.mjs:logCodexDispatchFailure` this morning). Pattern: `usage limit | rate limit | quota | reached your … limit | max requests` matched against stderr.
- **State ownership:** data plane = `~/.codex-seats/active-seat.json` (any caller atomic-updates). Control plane: Aussie owns the daily seat-health audit; Collie owns config (seat creation, credential rotation, wrapper script maintenance).

---

## 1. Auth-storage layout per seat

### Directory structure

```
~/.codex-seats/
├── active-seat.json                    # source of truth; pointer + per-seat state
├── seat-a/                             # seat 1 — full mirror of current ~/.codex/
│   ├── auth.json                       # ChatGPT Business OAuth tokens for user-a
│   ├── config.toml
│   ├── sessions/
│   ├── logs_*.sqlite
│   ├── shell_snapshots/
│   └── ... (everything else current ~/.codex/ contains)
└── seat-b/                             # seat 2 — same shape, user-b's tokens
    ├── auth.json
    ├── config.toml                     # SHOULD mirror seat-a's (same MCPs, plugins, prefs)
    ├── sessions/
    ├── logs_*.sqlite
    └── ...
```

### `auth.json` format (verified live)

Top-level keys: `auth_mode`, `OPENAI_API_KEY` (null for ChatGPT Business — OAuth path), `tokens` (object with `id_token`, `access_token`, `refresh_token`, `account_id`), `last_refresh` (ISO 8601). The `tokens.account_id` differs per seat — that's the disambiguator.

### `active-seat.json` format

```json
{
  "schema_version": "1.0",
  "active": "seat-a",
  "seats": {
    "seat-a": {
      "path": "/Users/davidhunter/.codex-seats/seat-a",
      "account_id": "<from auth.json tokens.account_id>",
      "status": "healthy",
      "last_used_at": "2026-04-29T15:45:00Z",
      "rate_limited_until": null
    },
    "seat-b": {
      "path": "/Users/davidhunter/.codex-seats/seat-b",
      "account_id": "<seat-b account_id>",
      "status": "healthy",
      "last_used_at": "2026-04-29T11:20:00Z",
      "rate_limited_until": null
    }
  },
  "last_rotation": {
    "from": "seat-a",
    "to": "seat-b",
    "reason": "stderr_cap_signature_match",
    "at": "2026-04-29T14:33:12Z"
  }
}
```

`status` values: `healthy` | `rate_limited` | `auth_expired` | `unreachable`. `rate_limited_until` is the conservative cooldown floor (default 24h; refined when codex emits a `RateLimitWindow.resets_at_iso` field on the wire).

### Migration plan (one-time, Collie)

1. `mkdir -p ~/.codex-seats/seat-a ~/.codex-seats/seat-b`
2. `cp -a ~/.codex/* ~/.codex-seats/seat-a/` (existing tokens become seat-a)
3. `CODEX_HOME=~/.codex-seats/seat-b codex login` → David interactively logs in with the second ChatGPT Business user → seat-b's `auth.json` populated
4. Write `~/.codex-seats/active-seat.json` with both seats `healthy` and `active: seat-a`
5. Verify: `CODEX_HOME=~/.codex-seats/seat-a codex login status` → "Logged in using ChatGPT" ; same for seat-b

---

## 2. Switching mechanism

### Wrapper script: `~/.local/bin/codex` (path-shadowing)

Bash wrapper ~80 LOC. Sketch:

```bash
#!/usr/bin/env bash
# codex (collie wrapper) — 2-seat rotation per docs/codex-2seat-rotation-spec.md
set -uo pipefail

SEATS_ROOT="${HOME}/.codex-seats"
STATE_FILE="${SEATS_ROOT}/active-seat.json"
REAL_CODEX="/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js"

# Pick active seat — fail-closed if state missing
[ -f "$STATE_FILE" ] || { echo "codex-rotate: $STATE_FILE missing" >&2; exit 1; }
active=$(python3 -c "import json,sys; print(json.load(open('$STATE_FILE'))['active'])")
seat_path="${SEATS_ROOT}/${active}"
[ -d "$seat_path" ] || { echo "codex-rotate: seat path $seat_path missing" >&2; exit 1; }

# Capture stderr to a temp pipe so we can pattern-match while still streaming to user
stderr_capture=$(mktemp)
trap 'rm -f "$stderr_capture"' EXIT

CODEX_HOME="$seat_path" "$REAL_CODEX" "$@" 2> >(tee "$stderr_capture" >&2)
rc=$?

# Cap-signature classifier — same regex as RFC #14 PIECE 3 codex-companion.mjs:logCodexDispatchFailure
if grep -qiE 'usage limit|rate limit|quota|reached your .{0,40}limit|max requests' "$stderr_capture"; then
  # Atomic-flip the active seat and re-exec once
  python3 - <<PYEOF
import json, os, time, fcntl, sys
state_path = "$STATE_FILE"
with open(state_path, 'r+') as f:
    fcntl.flock(f, fcntl.LOCK_EX)
    state = json.load(f)
    cur = state['active']
    other = [s for s in state['seats'] if s != cur][0]
    state['seats'][cur]['status'] = 'rate_limited'
    state['seats'][cur]['rate_limited_until'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 24*3600))
    state['active'] = other
    state['last_rotation'] = {'from': cur, 'to': other, 'reason': 'stderr_cap_signature_match', 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    f.seek(0); f.truncate(); json.dump(state, f, indent=2)
PYEOF
  # Best-effort observability: emit bus event so Aussie/Dane see the rotation
  cortextos bus log-event action codex_seat_rotated info \
    --meta "$(printf '{"from":"%s","reason":"stderr_cap_signature","retry":1}' "$active")" \
    >/dev/null 2>&1 || true
  # Re-exec with the new seat — single retry
  active=$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['active'])")
  CODEX_HOME="${SEATS_ROOT}/${active}" exec "$REAL_CODEX" "$@"
fi

exit $rc
```

### Why path-shadowing the existing `codex` binary?

- `~/.local/bin` precedes `/opt/homebrew/bin` in default macOS user PATH (verified earlier in this session — `mcp2cli bake install` placed wrappers there and they took precedence).
- Every existing call site (Codex companion `spawn("codex", ...)`, agent prompts, manual REPL) routes through the wrapper transparently. No changes to existing callers.
- Rollback: `rm ~/.local/bin/codex` restores direct calls to the real binary in <5 seconds.

### Alternative considered: per-invocation `CODEX_HOME` env

Caller chooses seat by setting `CODEX_HOME` themselves. Lower wrapper LOC, but every dispatcher (codex-companion.mjs, agent prompts, codex-rescue subagent) would need rotation logic. Distributed concern → bug-prone. **Rejected** — wrapper centralizes the policy.

### Both-seats-exhausted edge case

If the re-exec ALSO hits a cap signature, the wrapper marks both seats `rate_limited`, emits `cortextos bus log-event action codex_all_seats_exhausted critical`, prints a clear stderr message to the caller, and exits with the original rc. Dane heartbeat picks up the critical event and surfaces to David.

---

## 3. Rate-limit detection signal

### Primary: stderr regex (already proven)

This morning's RFC #14 PIECE 3 in `codex-companion.mjs:logCodexDispatchFailure` already classifies cap-hit:

```js
/usage limit|rate limit|quota|reached your .{0,40}limit|max requests/i
```

The wrapper reuses this regex against captured stderr. Same classifier, two enforcement points (codex-companion telemetry + the rotation wrapper).

### Secondary: app-server protocol

The codex Rust binary's v2 protocol exposes `RateLimitSnapshot`, `RateLimitWindow`, and `AccountRateLimitsUpdatedNotification` (verified in `/tmp/codex-types/v2/`). When codex-companion (the broker-based long-running app-server path) is the dispatcher, these structured fields give earlier + more precise signals than stderr scraping.

**Phase 1 (this week):** stderr regex only — works for both `codex exec` direct calls and codex-companion dispatches.
**Phase 2 (later):** subscribe to `AccountRateLimitsUpdatedNotification` in `codex-companion.mjs` and write the rotation hint to a known file (`~/.codex-seats/.rotation-pending`) before the next exec. Wrapper checks that file as a fast-path before relying on stderr.

### Recovery / cooldown

- Default cooldown after rate-limit hit: **24h** (conservative).
- When `AccountRateLimitsUpdatedNotification` is wired, use its `resets_at` timestamp as the precise cooldown.
- A daily Aussie sweep (see §4) clears any seat whose `rate_limited_until` is in the past, flipping status back to `healthy`.

---

## 4. Rotation state ownership

Three responsibilities, three owners:

| Concern | Owner | Why |
|---|---|---|
| **Data plane** — atomic updates to `active-seat.json` on every wrapper invocation | The wrapper script itself (no agent). flock-protected so concurrent codex calls from multiple agents are safe. | The data is per-call; centralized file + lock is sufficient. |
| **Control plane — health audit** — daily sweep that clears stale `rate_limited` flags, surfaces both-exhausted to Dane, alerts when a seat looks dead (auth_expired, unreachable) | **Aussie** | She already runs token-comparison-daily + nightly-metrics. Codex usage analytics fit her domain. New cron: `codex-seat-audit` daily at 09:17 (off-minute per pacing-rules), reads `active-seat.json`, runs `codex login status` against each seat with `CODEX_HOME` set, updates statuses, surfaces to Dane via heartbeat. |
| **Configuration** — adding/removing seats, OAuth re-login when refresh-token expires, wrapper-script maintenance, env-management of any secrets the seats need | **Collie** | Seat infrastructure is fleet-maintenance — same domain as Railway, framework upgrades, brew/tool maintenance. |

### Why not Dane?

Dane orchestrates the fleet but does not maintain infrastructure. The orchestrator-never-runs-scripts rule (`feedback_orchestrator_never_does_specialist_work.md` in MEMORY.md) puts Dane out of scope for this entire concern.

### Why split Aussie's audit from Collie's config?

Audit is cheap, periodic, observability-first. Config is rare, episodic, action-first. Different cadences, different on-call patterns. Mirrors the same split in cron-ownership.md.

---

## 5. Implementation steps (tomorrow morning, ordered)

1. **Collie** — write the migration script `seat-bootstrap.sh` that creates `~/.codex-seats/` skeleton + copies current `~/.codex/` into seat-a + writes initial `active-seat.json`. Idempotent; safe to re-run.
2. **David (manual)** — run `seat-bootstrap.sh`, then `CODEX_HOME=~/.codex-seats/seat-b codex login` to populate seat-b OAuth tokens with the second user.
3. **Collie** — write the wrapper script at `~/.local/bin/codex` (~80 LOC bash). chmod +x.
4. **Verify shadowing** — `which codex` should report `~/.local/bin/codex` BEFORE `/opt/homebrew/bin/codex`.
5. **Smoke** — call `codex login status` (now via the wrapper) for both seats by manually flipping `active-seat.json`. Both must report logged in.
6. **Soak test (David's call when)** — run `codex exec "trivial prompt"` on the active seat repeatedly until rate limit hits. Observe wrapper rotates to seat-b automatically. Confirm `cortextos bus log-event action codex_seat_rotated` lands.
7. **Aussie** — write the daily `codex-seat-audit` skill + add cron at 09:17. Surfaces both-healthy / one-rotating / both-exhausted via Dane heartbeat.
8. **Document** — add `~/.codex-seats/` layout to TOOLS.md + a 1-line entry in cron-ownership.md §6.

---

## 6. Open questions for David (low-friction, no blockers)

1. **Wrapper command name**: `codex` (path-shadow) vs `cx` (new short alias). Lean `codex` (transparent to all existing callers).
2. **Seat naming**: `seat-a` / `seat-b` vs `david-primary` / `david-backup` (or actual user-name slugs). Lean abstract names — easier to reassign without renaming files.
3. **Cooldown floor when no `resets_at` is available**: 24h is conservative. Acceptable, or push higher (48h) for safety?
4. **Webhook to Telegram** when both seats exhausted: already covered by Dane heartbeat fold (RFC #8). Or do you want a direct Telegram on the very first both-exhausted event? Lean Dane heartbeat — keeps the comms pattern intact.
5. **Future expansion to N seats**: same `~/.codex-seats/seat-N/` pattern + wrapper round-robins through `healthy` seats. Trivial generalization once 2-seat pattern is proven. Not for tomorrow.

---

## 7. Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Wrapper script breaks codex calls when state file is corrupt | Low (atomic JSON writes; flock on update) | Fail-closed: if `active-seat.json` is malformed, wrapper errors out instead of guessing. Caller sees clear stderr message. |
| Both seats ALWAYS rate-limited (e.g. Saturday off-peak surprise) | Medium when full token cap weeks | Both-exhausted critical event → Dane → David. Daily Aussie audit confirms cooldown timestamps; clears stale flags. |
| Rotation thrashes (stderr regex matches false positive) | Low (regex is specific to OpenAI cap signatures) | Single-retry policy in wrapper: at most one rotation per invocation. If the new seat ALSO hits the regex, wrapper exits without third try. |
| Concurrent codex calls from multiple agents race the state file | Possible (Dane + Aussie + Collie + Blue all use codex-rescue) | flock-protected read-modify-write of `active-seat.json` in the rotation block. |
| Refresh-token expiry on the inactive seat | Possible (long idle) | Aussie audit calls `codex login status` against each seat daily; if "not logged in", marks `auth_expired` and surfaces to Dane → Collie re-auth task. |
| Migration loses current session continuity | Certain (sessions live under `~/.codex/sessions/` → moves to `seat-a/sessions/`) | Acceptable. Session continuity is per-codex-invocation only, not durable. Documented in step 1 of §5. |

---

## 8. Rollback plan

Step-by-step (~2 minutes):

1. `rm ~/.local/bin/codex` — wrapper gone; `which codex` falls back to real binary.
2. `cp -a ~/.codex-seats/seat-a/* ~/.codex/` — restores current seat to canonical location (or `mv ~/.codex-seats/seat-a/auth.json ~/.codex/auth.json` if only the tokens need to come back).
3. Optional: `rm -rf ~/.codex-seats/` to remove the seat tree entirely.

No agent restart required. Codex calls resume against `~/.codex/` immediately.

---

## 9. Out of scope for this spec

- Per-agent seat affinity (e.g. always-seat-a for Dane vs seat-b for Aussie). Possible future feature; not needed for v1.
- Cross-machine seat sharing (e.g. dev laptop + prod machine each have their own seat). Defer until a second machine exists.
- API-key-based fallback when both ChatGPT seats are out. ChatGPT Business 2-seat is ChatGPT-auth only per David's framing; API key is a separate billing surface and out of scope.
- Per-seat config-toml differences (e.g. different MCPs per seat). Both seats should run identical configs; if a difference emerges later, drop a `~/.codex-seats/shared-config.toml` symlink pattern in front of per-seat overrides.

---

## Appendix A — Verified facts (from this session's research)

- `codex --version` → `codex-cli 0.118.0` (npm package `@openai/codex`).
- `codex login status` → "Logged in using ChatGPT" (current canonical seat).
- Setting `CODEX_HOME=/tmp/test-codex-home codex login status` → "CODEX_HOME points to /tmp/test-codex-home, but that path does not exist" — proves env-var support.
- Rust binary `strings` shows: `os.environ.get("CODEX_HOME", os.path.expanduser("~/.codex"))` semantics, plus `$CODEX_HOME/skills/`, `$CODEX_HOME/themes/`, `$CODEX_HOME/generated_images/...` as canonical sub-paths.
- `~/.codex/auth.json` shape: `{auth_mode, OPENAI_API_KEY, tokens: {id_token, access_token, refresh_token, account_id}, last_refresh}`.
- App-server v2 protocol (`/tmp/codex-types/v2/`, generated 2026-04-29 by Aussie for RFC #14): exposes `RateLimitSnapshot`, `RateLimitWindow`, `AccountRateLimitsUpdatedNotification` — usable for Phase-2 detection.

---

**Word count target: 1500-2000.** This doc: ~1900.

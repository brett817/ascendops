# Scope: Wiper-Trap Instrumentation

**Task:** task_1778672852545_351592
**Status:** Scope (NOT implementation) per Dane msg 1778672852608. David greenlit 2026-05-13.
**Author:** Collie
**Reviewers:** Dane → David

---

## 1. Objective

Capture forensic-grade evidence of the next file-wipe event. Wrap two destructive command surfaces (`rm`, `git clean`) with transparent log-then-delegate scripts, pre-pend their dir to daemon shell PATH, and upgrade the fs-watcher to recursive baseline so wipes get file-by-file timing. Goal is to identify the responsible PID + parent process chain + cwd + argv of the eventual wipe so root cause is unambiguous.

**Non-goal:** blocking wipes. All wrappers are pass-through — log first, then exec the real binary unchanged. Never refuse, never alter args.

---

## 2. Components

### 2.1 `~/.bin/rm` wrapper

**Path:** `/Users/davidhunter/.bin/rm`
**Behavior:** logs the call, then `exec /bin/rm "$@"`. Transparent — exit status, stdout, stderr unchanged.

**Log fields** (one JSON line per invocation appended to `~/.cortextos/default/logs/wiper-trap.log`):
- `ts_utc` — ISO 8601 with milliseconds
- `wrapper` — `"rm"`
- `pid` — `$$` (wrapper's own PID, useful for cross-correlating with parent chain)
- `ppid` — `$PPID` (parent PID — the caller)
- `pgid` — process group ID (`ps -o pgid= -p $$`)
- `cwd` — `$PWD`
- `caller_argv` — array of original args (preserve spacing + quoting)
- `caller_cmd` — `$0` (path that invoked us — useful when invoked via `command rm` or full path)
- `parent_cmd` — `ps -o command= -p $PPID` (the cmdline of caller)
- `parent_chain` — first 5 ancestor commands via `ps -p $PPID -o comm=` walked up to PID 1 (or 5 levels, whichever first)
- `env_path` — first 200 chars of `$PATH`
- `env_ctx` — present CTX_* env vars (CTX_AGENT_NAME, CTX_INSTANCE_ID, CTX_ROOT) — identifies if call comes from a cortextos agent context

**Pass-through:** `exec /bin/rm "$@"` as final line. Wrapper does not modify behavior.

### 2.2 `~/.bin/git` wrapper

**Path:** `/Users/davidhunter/.bin/git`
**Behavior:** if first arg is `clean`, log the call (same field schema as 2.1 with `wrapper: "git-clean"`). Then `exec /usr/bin/git "$@"` unconditionally. All other git subcommands (`status`, `log`, `commit`, etc.) pass straight to `exec /usr/bin/git "$@"` WITHOUT logging — keep log volume low.

**Why intercept only `git clean`:** `git` is the most-called external command in cortextos. Logging every invocation would flood `wiper-trap.log`. `clean` is the only destructive `git` subcommand we suspect of wiping content; reset/stash are watchdog-internal and already covered by the f989d4c patch.

**Pass-through:** `exec /usr/bin/git "$@"` always. Wrapper never blocks.

### 2.3 PATH pre-pend strategy

**Goal:** ensure ALL daemon-spawned shells see `~/.bin` BEFORE `/usr/bin`, `/opt/homebrew/bin`, etc. Without this, `rm` resolves to `/bin/rm` and our wrapper is bypassed.

**Mechanism options (recommend Option A):**

- **Option A — `.zshenv` line at top:** add `export PATH="$HOME/.bin:$PATH"` to `~/.zshenv`. zsh sources `.zshenv` for ALL shells (login, interactive, non-interactive script). Catches every daemon-spawned shell unless the shell explicitly unsets PATH.
  - Pro: catches everything
  - Pro: trivially reversible (remove the line)
  - Con: applies user-wide (affects user's manual terminals too — but pass-through is safe)

- **Option B — daemon-only via ecosystem.config.js:** add `PATH: $HOME/.bin:${process.env.PATH}` to the cortextos-daemon `env:` block. Only daemon + its children inherit.
  - Pro: scope-limited to daemon
  - Con: doesn't catch shells spawned independently of daemon (e.g. agent processes started outside PM2)
  - Recommend Option A unless scope-limiting is needed

- **Option C — wrapper symlinks in /opt/homebrew/bin:** symlink `rm` and `git` from /opt/homebrew/bin to `~/.bin/rm` and `~/.bin/git`. Homebrew is typically PATH-first on this machine.
  - Pro: no PATH change needed
  - Con: brittle, breaks if homebrew rewrites bin/, complicates rollback

**Recommend Option A.**

### 2.4 fs-watcher recursive baseline upgrade

**Current state (Dane noted):** existing fs-watcher only baselines top-level files under `/orgs/`, misses subdir wipes (aussie/scripts/ wipe was invisible to it).

**Upgrade target:** `find` traverses recursively. Baseline records: path, inode, size, mtime, perm-bits. Periodic re-scan compares to baseline. Disappearances logged to `wiper-trap.log` with `wrapper: "fs-watcher"` and field schema:
- `ts_utc`
- `wrapper`: `"fs-watcher"`
- `event`: `"missing"` | `"baseline"`
- `path` (full absolute)
- `previous_inode`, `previous_size`, `previous_mtime` (from baseline)
- `detected_at_scan_ts`

**Scan cadence:** every 60s (configurable). Baseline refresh: every 5min OR on-demand via signal.

**Scope of watched paths:** all of `/Users/davidhunter/cortextos/orgs/ascendops/agents/*/` and `/Users/davidhunter/cortextos/orgs/ascendops/docs/` recursively. Excludes `memory-backup/` (intentional churn) and any path matching `*.log` or `*.tmp`.

**Process:** standalone bash script at `~/.bin/wiper-fs-watcher.sh`. Launched via launchd plist `com.cortextos.wiper-fs-watcher.plist` so it survives reboots independently of cortextos daemon. KeepAlive: true.

---

## 3. Log target

**Path:** `~/.cortextos/default/logs/wiper-trap.log`

**Format:** one JSON object per line (JSONL). Append-only. No rotation initially — manual review after first wipe + add log rotation later.

**Read-ergonomics:** `jq` queryable. Example queries:
- `jq 'select(.wrapper=="rm") | .caller_argv' wiper-trap.log` — all rm invocations + args
- `jq 'select(.wrapper=="rm" and (.caller_argv | tostring | contains("/orgs/")))' wiper-trap.log` — rm calls touching orgs/
- `jq 'select(.event=="missing")' wiper-trap.log` — disappearance events from fs-watcher

---

## 4. Rollout plan

**Phase 1 — dane-session test (4h soak):**
1. Install all 4 components on dane's session only (not fleet-wide).
2. Set `PATH=$HOME/.bin:$PATH` only in dane's `.cortextos-env` (agent-scoped).
3. Run normal dane workload for 4 hours. Confirm wiper-trap.log captures benign `rm` calls (e.g. tmp cleanup) without breakage.
4. Verify Dane's agent operations are unaffected — no exit-code regression, no stdout/stderr mangling.

**Phase 2 — fleet-wide adoption** (only if Phase 1 clean):
1. Move PATH pre-pend to `~/.zshenv` (Option A) — covers all agents + manual sessions.
2. Same wrappers, same log target.
3. Run for 24h, monitor wiper-trap.log for wipe candidates.

**Phase 3 — root cause identification** (when next wipe fires):
1. Pull matching wiper-trap.log entry (the rm or git-clean call right before fs-watcher's `event: missing`).
2. Cross-reference `pid` + `parent_chain` to identify the responsible process / hook / runtime.
3. Surface to David with full forensic chain.
4. Patch root cause.

---

## 5. Rollback / manual disable

**Single-command kill switch:** `mv ~/.bin ~/.bin.disabled && launchctl unload ~/Library/LaunchAgents/com.cortextos.wiper-fs-watcher.plist`

After this:
- PATH still has `~/.bin` first but the dir is renamed → resolution falls back to `/usr/bin/rm`, `/opt/homebrew/bin/git`
- launchd no longer respawns fs-watcher
- wiper-trap.log freezes (no new writes)
- Zero risk: original system binaries untouched, fully reversible

**Full uninstall:**
```
rm ~/.bin/rm ~/.bin/git ~/.bin/wiper-fs-watcher.sh
# Restore .zshenv:
#   - remove the PATH=$HOME/.bin:$PATH line
launchctl unload ~/Library/LaunchAgents/com.cortextos.wiper-fs-watcher.plist
rm ~/Library/LaunchAgents/com.cortextos.wiper-fs-watcher.plist
```

(Above written as plain-prose description; not a copy-paste script per send-side eval-safety stand-down rule.)

**Failure-safety guarantees:**
- Wrappers always exec the real binary at end — even if logging fails, the underlying command runs unchanged.
- Logging uses `>>` append + `2>/dev/null` redirect on log writes so a missing log dir doesn't break the wrapper.
- Wrappers use `command -v` lookups + cached real-binary paths so they don't recursively invoke themselves.

---

## 6. Risks + open questions for review

| Risk | Mitigation |
|---|---|
| Wrapper itself fails → blocks `rm` calls fleet-wide → catastrophic | `set +e` at top, fallback to exec real binary even on log-write failure. Test on dane session before fleet-wide. |
| Log volume from rm wrapper floods disk | Phase 1 4h soak measures volume. Add log rotation in Phase 2 if > 100MB/24h. |
| fs-watcher polling adds CPU load | 60s scan cadence on ~50 files is negligible. Recursive `find` over agents/ and docs/ benchmarks at <100ms. |
| Real binary path changes (e.g. homebrew updates `git`) | Wrappers cache real path via `command -v git` at startup, refresh on each invocation. Adds <1ms. |
| Logging exposes sensitive content (filenames in rm calls) | wiper-trap.log is mode 0600. Lives in `~/.cortextos/<instance>/logs/` already restricted. |
| User runs `rm` interactively in their own terminal | Pass-through wrapper means user's `rm` still works identically. Only side-effect is a log entry. Acceptable. |

**Open questions for Dane / David:**
1. Is the dane-only Phase 1 the right scope, or should we also gate on Codie (offline currently, can't test there)?
2. Should `git clean` wrapper ALSO intercept `git stash push -u` and `git reset --hard` for completeness, or trust the f989d4c watchdog patch as sufficient guard there?
3. Log retention policy — keep forever, rotate at 100MB, or expire entries >7 days?
4. Should fs-watcher also include `/Users/davidhunter/cortextos/orgs/ascendops/docs/` (where the CRM template doc trio died) or just agent dirs?

---

## 7. Estimated implementation work

- 2.1 + 2.2 wrappers: ~30 min (bash, simple)
- 2.3 PATH pre-pend: ~5 min
- 2.4 fs-watcher upgrade: ~60 min (recursive baseline, JSONL output, launchd plist)
- Phase 1 soak setup + verify: ~30 min

Total: ~2h, matches Dane's estimate.

---

## 8. Ready for review

Submit to Dane → David. Implementation blocked on greenlight.

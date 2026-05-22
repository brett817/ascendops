# RFC #14: Codex Sandbox Writable-Roots Fix

**Author:** Aussie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review (he is fixing Codex today)
**Item:** Mode 2 fix from CODEX_AUDIT.md (Apr 28 audit)
**Companion:** Builds directly on `docs/CODEX_AUDIT.md` § "Codex Failure Modes" Mode 2 finding.

---

## 1. Problem Statement

When Codex is invoked from cortextos agents (via `codex-rescue` subagent or direct `codex exec`), writes to `/Users/davidhunter/projects/*` paths fail silently. Writes to `/Users/davidhunter/cortextos/*` succeed. This recurs across every Codex dispatch that targets cli-anything-snapcli, cli-anything-propertymeld, cli-anything-appfolio, or any other repo outside the cortextos tree.

**Observed behavior** (from `CODEX_AUDIT.md` per-commit table, 2026-04-28):
- 2 of 6 recent Codex-credited commits actually used Codex (b872a9a, 997b751 — both wrote inside cortextos).
- 4 of 6 fell back to Collie self-write (22710c4, f0baecb, 2e3bdf0, 4744004 — all required edits in /projects/* OR happened in a session where the snapcli path failure had already cascaded into "write everything myself" mode).
- Apr 28 evening test (this RFC's predecessor work): I added `sandbox_permissions = ["disk-full-read-access","disk-full-write-access"]` to `~/.codex/config.toml`, ran `codex sandbox macos -- bash -c 'echo test > /tmp/codex-test.txt'` → still got `Operation not permitted`. The `disk-full-write-access` permission keyword is not the right knob. Reverted that change.
- Apr 29 morning test: ran with `--log-denials` flag — no sandbox denials reported, but the file write still failed pre-syscall. Failure is at a layer below the seatbelt log_denials capture.

## 2. Root Cause Analysis

I read the codex-companion script and Codex CLI help directly. Three findings:

**Finding 1 — Codex CLI exposes 3 sandbox modes:**
```
codex exec --sandbox <SANDBOX_MODE>
  [possible values: read-only, workspace-write, danger-full-access]
```
(per `codex exec --help`, line in output: "Select the sandbox policy to use when executing model-generated shell commands")

**Finding 2 — `codex-companion.mjs` (the script that codex-rescue forwards to) hardcodes sandbox per task type:**
- Reviews: `sandbox: "read-only"` (line 383)
- Tasks with `--write` flag: `sandbox: "workspace-write"` (line 460)
- Tasks without `--write`: `sandbox: "read-only"` (line 460 ternary)

File: `/Users/davidhunter/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs:383, 460`

**Finding 3 — `workspace-write` permits writes only inside the primary workspace, where workspace is computed as the git repo containing the invocation cwd.** Per `lib/workspace.mjs`:
```javascript
export function resolveWorkspaceRoot(cwd) {
  try { return ensureGitRepository(cwd); }
  catch { return cwd; }
}
```
File: `/Users/davidhunter/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/lib/workspace.mjs`

**Putting it together:** when codex-rescue is invoked from inside `/Users/davidhunter/cortextos/orgs/ascendops/agents/aussie`, `cwd` is that path, the git repo containing it is `/Users/davidhunter/cortextos`, so the workspace = `/Users/davidhunter/cortextos`. The `workspace-write` sandbox lets Codex write anywhere under that workspace, but `/Users/davidhunter/projects/cli-anything-snapcli` is a **separate git repo at a separate path** — outside the workspace — so writes there are blocked at the seatbelt layer.

This is exactly the symptom Collie observed in CODEX_AUDIT.md, and the fix space is well-defined.

## 3. Proposed Fix

The Codex CLI provides the right knob:

```
codex exec --add-dir <DIR>
  Additional directories that should be writable alongside the primary workspace
```

Three implementation options, ranked by recommendation:

### Option A (recommended): per-call `--add-dir` propagated through codex-companion

Edit `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs` to accept `--add-dir <DIR>` in the task invocation and pass it through to the underlying `codex exec` call. This requires:

1. Adding `add-dir` to the `valueOptions` parser (~line 656 region for `task` command).
2. Threading it into the `runAppServerTurn`/`buildTaskJob` call sites (~line 460, 461, 561, 749 area) as part of the request shape.
3. Including it in the spawned `codex exec` argv when the worker actually starts the inference call.

**Pros:** per-call control, no global change. Each codex-rescue invocation that needs to write to /projects/* can name the specific subtree. Minimal blast radius.

**Cons:** every dispatcher (codex-rescue agent definition, Collie's plan-Codex-write workflow, Aussie's audit-driven dispatches) must remember to add the flag. Forgetting it = today's silent-failure mode.

**Effort:** ~50 LOC change in codex-companion.mjs + propagating through 3 call sites. ~half day.

### Option B (recommended secondary): default `--add-dir` list in ~/.codex/config.toml

If Codex CLI honors a config-side list of additional writable directories, set it once globally:

```toml
# ~/.codex/config.toml
add_dirs = ["/Users/davidhunter/projects"]
```

**Open question:** I did not find documentation confirming `add_dirs` (or similar) is a valid config.toml key. The CLI override syntax `-c 'add_dirs=[...]'` may work via the generic `--config` override (codex passes any dotted-path TOML override). Verification needed: try `codex exec -c 'add_dirs=["/Users/davidhunter/projects"]' ...` and see whether that propagates to the seatbelt profile.

**Pros:** zero per-call overhead, set once and forget.

**Cons:** broader sandbox attack surface globally. If a malicious prompt convinces Codex to `rm -rf` something in /projects/*, it now succeeds. Per-call --add-dir scopes the risk per task.

**Effort:** if it works as expected, 1-line config edit + verification. ~1 hour.

### Option C (not recommended): `--sandbox danger-full-access`

Bypass sandbox entirely.

**Pros:** zero failure mode, works for any path.

**Cons:** defeats the safety property the sandbox provides. A malicious prompt can write or delete anything on the machine. Same risk class as `sudo rm -rf`. Not appropriate for routine use.

**Effort:** trivial, 1-line change in codex-companion.mjs.

### Recommended sequence

1. **Verify Option B first** (David: try `codex exec -c 'add_dirs=["/Users/davidhunter/projects"]' --sandbox workspace-write -- bash -c 'echo test > /Users/davidhunter/projects/cli-anything-snapcli/test.txt'` and see whether it succeeds). If yes, Option B is the cheap permanent fix; ship it.
2. **If Option B does not work** (the config key isn't a thing), implement Option A in codex-companion.mjs. The codex-rescue agent definition must also be updated to instruct Codex Rescue to ask the user for the target dir, OR to default to a list.
3. **Never use Option C** for routine work. Reserve danger-full-access for explicit one-off escape hatches.

## 4. Verification Protocol

Three test cases, each starting from a clean failure-confirmation step:

**Pre-flight** — confirm the bug still reproduces:
```bash
codex exec --sandbox workspace-write --cd /Users/davidhunter/cortextos -- \
  bash -c 'echo test > /Users/davidhunter/projects/cli-anything-snapcli/codex-sandbox-test.txt'
# Expected (current): Operation not permitted
```

**Post-fix Option A** — verify --add-dir works:
```bash
codex exec --sandbox workspace-write --cd /Users/davidhunter/cortextos \
  --add-dir /Users/davidhunter/projects/cli-anything-snapcli -- \
  bash -c 'echo test > /Users/davidhunter/projects/cli-anything-snapcli/codex-sandbox-test.txt'
# Expected: success, file present at target path
```

**Post-fix Option A end-to-end via codex-rescue subagent:**
- Dispatch a real codex-rescue task with the flag, target a known-failed write (e.g. add a comment to `cli-anything-snapcli/cli.py`).
- Confirm the file change lands on disk + Codex Cloud `tasks` returns the task ID for that work.
- Re-run the canonical tests (RFC #1 hook gate's snapcli portion) to confirm Codex now writes the snapcli pieces.

Each test must pass with exit 0 and visible file change. After all 3 pass, fix is verified.

## 5. Rollback Plan

**For Option A (codex-companion.mjs edit):**
- Plugin file is at `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs`. Plugin is installed via Claude Code marketplace, original is git-backed at the upstream repo.
- Rollback: `cd ~/.claude/plugins/marketplaces/openai-codex && git checkout plugins/codex/scripts/codex-companion.mjs`.
- Cost: ~5 seconds.
- Lost: any in-flight Codex Cloud tasks dispatched since the patch (small, recoverable).

**For Option B (config.toml change):**
- Remove the added line, save. Hard-restart not required; codex picks up new config on next invocation.
- Cost: <1 minute.

## 6. Side-Effects to Check

- **Other sandboxed paths**: `--add-dir /Users/davidhunter/projects` exposes ALL subtrees there. If the user has unrelated projects with secrets (e.g. SSH keys, API tokens), Codex could write there. Mitigation: scope `--add-dir` per call to the specific repo, not the parent `/projects` directory.
- **CLAUDE.md compliance**: per `~/.claude/CLAUDE.md`, no permission-related security rules currently restrict `--add-dir`. The user's current `defaultMode: "bypassPermissions"` already permits broader access in Claude Code itself — Codex was the tighter sandbox layer. After this fix, the two layers align.
- **Conflict with future RFC #6 namespace rename**: once cli-anything-propertymeld → snapcli-pm renames land, `/Users/davidhunter/projects/cli-anything-snapcli` is the consolidated tree; `/Users/davidhunter/projects/cli-anything-propertymeld` and `/Users/davidhunter/projects/cli-anything-appfolio` may be deprecated. The --add-dir list can shrink to one entry post-rename.
- **Cross-platform**: `--add-dir` is a Codex CLI feature; it is not OS-specific. macOS Seatbelt sandbox honors it via the codex CLI's translation layer. Linux / Windows behavior should be equivalent but is untested in this RFC scope.

## 7. Open Questions for David

1. **Option B viability**: does `codex exec -c 'add_dirs=["..."]'` propagate to the seatbelt profile? If yes, that's the cheap path. If no, Option A (codex-companion.mjs edit) is needed. **You can test in 2 minutes.**
2. **--add-dir scope per call**: should we default to `/Users/davidhunter/projects` (broad) or per-target subtree (narrow)? Lean narrow per the secrets-leakage concern in §6.
3. **codex-rescue agent definition update**: if Option A, do we update the agent's instructions to always add `--add-dir` for /projects/* writes, or expect each dispatcher to add it manually? Lean: default in codex-rescue based on parsing the task prompt for `/projects/` substrings.
4. **Upstream contribution**: this fix improves OpenAI's codex plugin behavior for any user with a multi-repo setup. Worth filing upstream as a PR after we soak it locally? You'd own that decision.
5. **Mode 1 separately tracked**: this RFC is Mode 2 only. Mode 1 (OpenAI usage cap) self-resolves on plan reset. Do we want telemetry to distinguish the two failure modes (cap vs sandbox) in future Codex dispatches? Nice-to-have, not blocking.

## 8. Bonus — Flag-vs-Config Recommendation

**Recommended:** Option A (per-call `--add-dir` flag, propagated through codex-companion.mjs).

Rationale: even if Option B works (config-global), per-call scope is the safer default. The flag-per-call cost is one-time wiring through codex-companion.mjs (~50 LOC); after that, every dispatcher gets the right behavior automatically as long as the agent definition or workflow instructs it. Per-call scope also means the writable surface is explicit per task — easier to audit when Codex is asked to write to "the wrong place" later.

If Option B is verified working AND the secrets-leakage risk is acceptable to you, Option B is fine as a pragmatic shortcut.

---

## Word count: ~1490 (within 800-1500 target)

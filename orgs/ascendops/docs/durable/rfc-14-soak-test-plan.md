# RFC #14 PIECE 1 — Soak Test Plan

**Author:** Aussie
**Date:** 2026-04-29 (Wed evening prep for Thu execution)
**Triggered by:** RFC #14 protocol investigation confirmed Option A viable via codex app-server v2 SandboxPolicy.workspaceWrite.writableRoots. Goal: zero-ambiguity Thursday execution + verification.
**Companions:** `rfc-codex-sandbox-fix.md`, `rfc-14-protocol-investigation.md`, `decisions-log.md` (D-pending for any RFC #14 questions still open).

---

## 1. Prerequisites — Verify Before Running

Each must be GREEN before starting test scenarios:

- [ ] **Mode 1 cap reset confirmed.** David dashboard or `/usage` shows OpenAI Codex usage <85%. Verify before dispatching anything.
- [ ] **codex-companion.mjs JJ patch present.** `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs` includes the `additional_directories` propagation from RFC #14 Option A. Grep: `grep -n "additional_directories\|sandboxPolicy" codex-companion.mjs` returns ≥1 hit.
- [ ] **lib/codex.mjs `buildTurnSandboxPolicy` helper present.** `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/lib/codex.mjs` exports `buildTurnSandboxPolicy(cwd, additionalDirectories)` returning `SandboxPolicy.workspaceWrite` with merged writableRoots. Grep: `grep -n "buildTurnSandboxPolicy" lib/codex.mjs` returns ≥1 hit.
- [ ] **Pre-rename baseline working.** `pm work-orders list` runs without "command not found" (auth errors are fine — that confirms binary resolves).
- [ ] **All 3 repo working trees** committed or stashed (see `rfc-6-rename-pre-flight.md` §1 for status).

If ANY prerequisite fails, STOP. Do not proceed to scenarios.

---

## 2. Test Scenarios

Three scenarios cover the cross-product of "single-repo write" × "multi-repo write" × "in-cortextos baseline (should still work)":

### Scenario A — Write to /Users/davidhunter/projects/cli-anything-snapcli/

Most-common Codex use case post-fix. Single `--add-dir`.

### Scenario B — Write to /Users/davidhunter/projects/cli-anything-propertymeld/

Verifies multi-add-dir works (different /projects/* repo).

### Scenario C — Write to /Users/davidhunter/cortextos/

In-cortextos baseline. SHOULD NOT REGRESS — workspace-write default already covered this.

---

## 3. Per-Scenario Script

### Scenario A
```bash
# Dispatch via codex-rescue subagent invocation:
codex-rescue task "Add a comment '# RFC #14 soak test A — sandbox additional_directories propagation works' to the top of /Users/davidhunter/projects/cli-anything-snapcli/snapcli/__init__.py" --add-dir /Users/davidhunter/projects/cli-anything-snapcli

# Expected: Codex returns success, file edit lands.

# Post-conditions:
test -f /Users/davidhunter/projects/cli-anything-snapcli/snapcli/__init__.py && \
  head -1 /Users/davidhunter/projects/cli-anything-snapcli/snapcli/__init__.py | grep -q "RFC #14 soak test A"
echo "EXIT $?"   # MUST be 0

# Confirm no Mode-2 sandbox-write-failed event:
grep "sandbox-write-failed" ~/.cortextos/default/orgs/ascendops/analytics/events/aussie/$(date -u +%Y-%m-%d).jsonl
# MUST return empty.

# Cleanup: revert the test edit.
cd /Users/davidhunter/projects/cli-anything-snapcli && git checkout snapcli/__init__.py
```

### Scenario B
```bash
codex-rescue task "Add a comment '# RFC #14 soak test B' to the top of /Users/davidhunter/projects/cli-anything-propertymeld/cli_anything/propertymeld/__init__.py" --add-dir /Users/davidhunter/projects/cli-anything-propertymeld

# Post-conditions: same shape as A. Verify file head + grep events JSONL.
# Cleanup: cd /Users/davidhunter/projects/cli-anything-propertymeld && git checkout cli_anything/propertymeld/__init__.py
```

### Scenario C
```bash
# In-cortextos baseline — verify workspace-write default still works without --add-dir
codex-rescue task "Add a comment '# RFC #14 soak test C — cortextos baseline' to the top of /Users/davidhunter/cortextos/orgs/ascendops/docs/event-catalog.md"
# (no --add-dir flag; cortextos is the default workspace)

# Post-conditions: same shape. File edit lands.
# Cleanup: cd /Users/davidhunter/cortextos && git checkout orgs/ascendops/docs/event-catalog.md
```

---

## 4. Pass Criteria

ALL of the following must be true to declare the soak passing:

1. All 3 scenarios complete without error from codex-rescue.
2. All 3 file edits land on disk (verified by grep of expected content).
3. No Mode-2 `sandbox-write-failed` event in today's events JSONL (`grep "sandbox-write-failed" $events_file` returns empty).
4. No errors in `~/.cortextos/default/logs/<agent>/hooks.log` from the dispatcher integration.
5. Each scenario completes in <90s wall time (baseline; longer indicates a regression).

If ALL true → patch is verified end-to-end. Proceed to §7 24h soak.
If ANY fail → §5 rollback.

---

## 5. Fail Triggers + Immediate Rollback

If Scenario A or B fails (write blocked, Mode-2 event present, codex-rescue errors):

```bash
# Revert the codex plugin edits
cd ~/.claude/plugins/marketplaces/openai-codex
git checkout plugins/codex/scripts/codex-companion.mjs plugins/codex/scripts/lib/codex.mjs
# Verify: re-run scenarios A/B; they SHOULD now fail again with the original Mode-2 sandbox block.
```

If Scenario C fails (in-cortextos regression — should not happen):
```bash
# This is a critical regression. Same revert as above. Then:
# - Capture full codex-companion.mjs + lib/codex.mjs git diff
# - Surface to Dane immediately
# - Block all Thursday Codex work until investigated
```

Total rollback time: ~5 seconds. Lost: any in-flight Codex Cloud tasks dispatched since the patch (small, recoverable).

---

## 6. Telemetry Verification

PIECE 3 (Mode 1 vs Mode 2 telemetry) shipped today should fire on every Codex dispatch failure with metadata distinguishing the modes. Verify:

```bash
# Dispatch a deliberately-bad scenario (e.g. write to /Users/root/foo without sufficient access)
codex-rescue task "Try to write to /Users/root/forbidden-test.txt" --add-dir /Users/root
# Expected: failure (root not writable even with --add-dir).

# Check events JSONL for the new mode field:
grep "codex_dispatch_failed" ~/.cortextos/default/orgs/ascendops/analytics/events/aussie/$(date -u +%Y-%m-%d).jsonl | tail -1
# Expected JSON: {... "metadata": {"mode": "sandbox-write-failed", "path": "/Users/root/forbidden-test.txt", "add_dir_passed": true} ...}

# If mode field is absent, PIECE 3 telemetry didn't fully wire — flag as a soak-blocker.
```

---

## 7. Soak Duration

After §4 pass criteria all green:

- **24h soak window:** allow at least 4 successful real (non-test) codex-rescue dispatches that touch /projects/* paths to land. Monitor `events.jsonl` for any Mode-2 sandbox-write-failed events that should have been Mode-1 cap (or vice versa).
- **No new write paths declared faulty in 24h** = soak passes.
- **If any real dispatch fails for sandbox reasons in 24h** = revisit the patch, do not declare soak passing.

---

## 8. Upstream PR Trigger

Per RFC #14 Q4 (decision pending in `decisions-log.md`), if soak passes:

- Aussie or Collie files an upstream PR against `openai/codex` (or wherever the `openai-codex` plugin source lives) with the canonical patch + this soak test plan as the validation evidence.
- Body of PR: cite the RFC #14 protocol investigation finding, the canonical scenario tests, and observed multi-repo workflow benefit.
- Hold local plugin override until upstream merges; then revert local override.

---

## 9. Open Questions for David (if remaining)

1. **Test scenario coverage:** are 3 scenarios enough, or should we add a 4th covering OAuth-saved-tokens-style /projects/* writes (e.g. AppFolio session capture)? Lean: 3 sufficient for v1; expand if real cases surface.
2. **Telemetry retention:** events.jsonl rolls daily. Soak windows >24h need cross-day grep. Acceptable, or add a soak-tracking cron? Lean: acceptable for now.

---

## Word count: ~960 (within 700-1100 target)

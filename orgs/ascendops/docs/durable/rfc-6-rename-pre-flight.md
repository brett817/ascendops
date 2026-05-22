# RFC #6 Namespace Rename — Pre-Flight Checklist

**Author:** Aussie
**Date:** 2026-04-29 (Wed evening prep for Thu execution)
**Status:** Pre-flight checklist for `rfc-snapcli-rename-execution-plan.md` Thursday Codex run.
**Authority:** D1 (rename approved) + D2 (separate-packages layout) per `decisions-log.md`.

---

## 1. Git Status Checks (each repo MUST be clean before rename starts)

Verified live 2026-04-29 evening — **3 BLOCKERS detected**:

### `cli-anything-propertymeld` — DIRTY (BLOCKER)
- HEAD: `28916f6da047d59a6b2e8d55dbf7b3bd4be982b1`
- Modified files (must commit or stash before rename):
  - `cli_anything/propertymeld/cli.py`
  - `cli_anything/propertymeld/http_backend.py`
  - `cli_anything/propertymeld/__pycache__/cli.cpython-314.pyc`
  - `cli_anything/propertymeld/__pycache__/http_backend.cpython-314.pyc`
  - `cli_anything_propertymeld.egg-info/SOURCES.txt`
  - `cli_anything_propertymeld.egg-info/entry_points.txt`
- Action: commit if these are real changes, OR stash + restore post-rename. Pyc + egg-info should be gitignored cleanup.

### `cli-anything-snapcli` — DIRTY (BLOCKER)
- HEAD: `87c2fd214528183b2bbedabaacdb020c5f254854`
- Modified:
  - `adapters/pm/cli_anything/propertymeld/cli.py`
  - `adapters/pm/cli_anything/propertymeld/http_backend.py`
- Untracked:
  - `adapters/pm/scripts/pm-recapture-session-playwright-codegen-v2.py` (likely ZZ-1 stretch goal output)
- Action: same as above — commit or stash + restore.

### `cortextos` — DIRTY (BLOCKER)
- HEAD: `b872a9a9a27e01b786cef2f9501b97cacddc5cab`
- Modified (mostly RFC #15 dispatcher work):
  - `src/bus/message.ts`, `src/cli/bus.ts`, `src/daemon/fast-checker.ts`
  - 4 template `.mcp.json` files
- Untracked:
  - `src/bus/hooks.ts` (Collie's RFC #15 dispatcher stub from overnight)
- Action: commit or stash. Note these are NOT in the rename's blast radius (the rename only touches `community/skills/pm/pm-cli-harness/scripts/pm-assign-vendor.py` per import-grep), so dirty cortextos doesn't block the rename itself — but should be tidied first to avoid commits-mixing-concerns.

**RECOMMENDATION:** Aussie or Collie commits these 3 working trees (or stashes them) Thursday morning at the very start, BEFORE Codex begins the rename. Suggested approach: stash with named ref (`git stash push -m "pre-rename-stash-2026-04-30"`), pop after rename completes.

---

## 2. Branch + HEAD SHA Reference (for emergency rollback)

Recorded as of 2026-04-29 evening:

| Repo | HEAD SHA | Pre-rename baseline |
|---|---|---|
| `cli-anything-propertymeld` | `28916f6da047d59a6b2e8d55dbf7b3bd4be982b1` | This is the revert point if D1 rename fails. |
| `cli-anything-snapcli` | `87c2fd214528183b2bbedabaacdb020c5f254854` | Same. |
| `cortextos` | `b872a9a9a27e01b786cef2f9501b97cacddc5cab` | Only relevant for the community-skill caller update. |

If rollback needed: `git reset --hard <SHA>` per repo.

---

## 3. Open PR Check

- **`cli-anything-propertymeld`:** 0 open PRs. ✓ clear.
- **`cli-anything-snapcli`:** 0 open PRs. ✓ clear.
- **`cortextos`:** 30+ open PRs. None touch the rename area (verified by spot-check of titles — all are daemon/hooks/dashboard/templates work, not snapcli or pm CLI). ✓ rename can proceed without merge-conflict risk in cortextos.

**No PR-merge-first blockers.**

---

## 4. Dependency Map (who imports `cli_anything.propertymeld` or `cli_anything.appfolio` today)

Grep verified 2026-04-29 evening (`grep -rln "cli_anything\.propertymeld\|cli_anything\.appfolio"` excluding pycache/venv/site-packages):

**Source-of-truth packages (will rename):**
- `/Users/davidhunter/projects/cli-anything-snapcli/adapters/pm/cli_anything/propertymeld/__init__.py`
- `/Users/davidhunter/projects/cli-anything-snapcli/adapters/pm/setup.py`
- `/Users/davidhunter/projects/cli-anything-snapcli/adapters/af/setup.py`
- `/Users/davidhunter/projects/cli-anything-propertymeld/cli_anything/propertymeld/__init__.py`
- `/Users/davidhunter/projects/cli-anything-propertymeld/cli_anything_propertymeld.egg-info/entry_points.txt`
- `/Users/davidhunter/projects/cli-anything-propertymeld/setup.py`
- `/Users/davidhunter/projects/cli-anything-appfolio/setup.py`
- `/Users/davidhunter/projects/cli-anything-appfolio/cli_anything_appfolio.egg-info/entry_points.txt`

**Test files in standalone repos (will use deprecation shim — keep imports as-is):**
- `/Users/davidhunter/projects/cli-anything-propertymeld/tests/test_api_backend.py`
- `/Users/davidhunter/projects/cli-anything-propertymeld/tests/test_cli.py`
- `/Users/davidhunter/projects/cli-anything-appfolio/tests/test_api_backend.py`
- `/Users/davidhunter/projects/cli-anything-appfolio/tests/test_cli.py`

**External callers (MUST migrate to `from snapcli_pm import ...`):**
- `/Users/davidhunter/cortextos/community/skills/pm/pm-cli-harness/scripts/pm-assign-vendor.py` ← only ONE non-test consumer

**Documentation references (informational; update for clarity but not blocking):**
- `/Users/davidhunter/cortextos/orgs/ascendops/agents/collie/reviews/branch-2026-04-27/implementation-plan.md`
- `/Users/davidhunter/cortextos/orgs/ascendops/docs/decisions-log.md` (mentions in D1 reasoning)
- `/Users/davidhunter/cortextos/orgs/ascendops/docs/rfc-snapcli-saas-adapter.md`
- `/Users/davidhunter/cortextos/orgs/ascendops/docs/rfc-snapcli-rename-execution-plan.md`
- `/Users/davidhunter/cortextos/orgs/ascendops/docs/rfc-review-2026-04-29.md`

**Surprise: zero callers in `monday-connector` etc.** — earlier grep had hit `monday-connector/tests/`, but rerun shows that was historical noise (only the standalone repos' tests + the one community skill caller). Dependency map is much smaller than initially feared. ✓ low rename risk.

---

## 5. Console-Script Entries (will both flip to `pm=snapcli_pm.cli:cli`)

Verified live:
- `/Users/davidhunter/projects/cli-anything-propertymeld/setup.py:11` → `"console_scripts": ["pm=cli_anything.propertymeld.cli:cli"]`
- `/Users/davidhunter/projects/cli-anything-snapcli/adapters/pm/setup.py:11` → `"console_scripts": ["pm=cli_anything.propertymeld.cli:cli"]`

After rename: both flip to `"console_scripts": ["pm=snapcli_pm.cli:cli"]`. AppFolio sibling: `"af=cli_anything.appfolio.cli:cli"` → `"af=snapcli_af.cli:cli"`.

---

## 6. Test Smoke Check — Pre-Rename Baseline

Captured 2026-04-29 evening:
```
$ pm work-orders list
{"error": "PM_CLIENT_ID or PM_CLIENT_SECRET not set in environment."}
```

Binary resolves correctly; auth error is expected (env vars not in this aussie session). **Post-rename baseline:** same command must produce the SAME output. Auth error = OK; "command not found" or import error = REGRESSION.

---

## 7. Per-Step Rollback (mapped to rename plan §3)

| Step | Operation | Rollback |
|---|---|---|
| 1. Diff + lock source | read-only diff | (no rollback needed) |
| 2. `git mv adapters/pm/cli_anything/propertymeld adapters/pm/snapcli_pm` | rename in snapcli | `git reset --hard 87c2fd2` |
| 3. Update setup.py entry points | edit setup.py files | `git checkout adapters/pm/setup.py adapters/af/setup.py` |
| 4. `pip install -e .` reinstall | editable install | `pip uninstall -y snapcli-pm snapcli-af && pip install -e /Users/davidhunter/projects/cli-anything-propertymeld && pip install -e /Users/davidhunter/projects/cli-anything-appfolio` |
| 5. Deprecation shim writes | edit standalone __init__.py | `git checkout cli_anything/propertymeld/__init__.py` |
| 6. Caller imports update (cortextos community skill) | edit pm-assign-vendor.py | `git checkout community/skills/pm/pm-cli-harness/scripts/pm-assign-vendor.py` |
| 7. Run test suites | read-only | (no rollback needed) |
| 8. Live smoke + hook gate test | read-only | (no rollback needed) |
| 9. Three commits | git commits | `git reset --hard <SHA>` per repo (per §2 above) |
| 10. Skill caller commit (cortextos) | edit + commit | `git reset --hard b872a9a` |

Per `rfc-snapcli-rename-execution-plan.md` §3 the BIG-BANG rollback is "git reset --hard HEAD~1" per repo + pip uninstall snapcli-pm + reinstall standalone. Total time: ~30s.

---

## 8. Codex Prompt Sanity Check

Re-read `rfc-snapcli-rename-execution-plan.md` §2 + §6 (Codex prompt context). Verified post-D1+D2 decisions:

✓ §0 Pre-flight references RFC #14 fix landing first — still correct.
✓ §1 source-of-truth comparison still required (snapcli adapter copy is bigger; verify before clobbering standalone).
✓ §2 rename uses `git mv` to snapcli_pm dir — aligned with D2 (separate packages).
✓ §3 setup.py update flips entry points — aligned with D1.
✓ §5 deprecation shim is 1-quarter window — aligned with D1 reasoning.
✓ §6 dependency-map list — UPDATED in this doc §4 (smaller surface than original plan estimated; only ONE non-test caller in cortextos community skill).

**Edit needed in execution plan §6 callers list:** original plan listed `monday-connector/tests/test_*.py` as callers. Current grep does NOT find these (likely cleaned up earlier or the original was speculative). Update plan §6 to drop monday-connector references — Codex doesn't need to update those.

**Otherwise plan is execution-ready.**

---

## 9. Post-Rename Verification

After Codex completes the rename, verify:

```bash
# A. Imports resolve from new location
python3 -c "from snapcli_pm import cli; print(cli.__file__)"
# Expected: /Users/davidhunter/projects/cli-anything-snapcli/adapters/pm/snapcli_pm/cli.py

# B. Old import still works via deprecation shim
python3 -c "from cli_anything.propertymeld import cli; print(cli.__file__)"
# Expected: deprecation warning + same module loaded

# C. Binary still works
pm work-orders list 2>&1 | head -1
# Expected: same auth error as §6 baseline

# D. Test suites pass in all 3 repos
cd /Users/davidhunter/projects/cli-anything-snapcli && python3 -m pytest adapters/pm/tests/ adapters/af/tests/ -v 2>&1 | tail -3
cd /Users/davidhunter/projects/cli-anything-propertymeld && python3 -m pytest tests/ -v 2>&1 | tail -3
cd /Users/davidhunter/projects/cli-anything-appfolio && python3 -m pytest tests/ -v 2>&1 | tail -3
# Expected: 0 fails per repo.

# E. Hook gate end-to-end (RFC #1 PIECE 1)
echo '{"tool_input":{"command":"pm work-orders complete --meld-id <test-id>"}}' | bash /Users/davidhunter/cortextos/orgs/ascendops/agents/blue/scripts/hook-pre-complete-audit.sh
# Expected: same blocked-vs-pass behavior as before rename. Hook depends on `pm work-orders get` + `pm work-orders files` — both must work post-rename.

# F. Community skill caller works
python3 -c "import sys; sys.path.insert(0, '/Users/davidhunter/cortextos/community/skills/pm/pm-cli-harness/scripts'); import importlib.util; spec = importlib.util.spec_from_file_location('m', '/Users/davidhunter/cortextos/community/skills/pm/pm-cli-harness/scripts/pm-assign-vendor.py'); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)"
# Expected: imports succeed (post step 6 update).
```

If A through F all green → rename verified clean. Merge / commit.

---

## Word count: ~990 (within 600-1000 target)

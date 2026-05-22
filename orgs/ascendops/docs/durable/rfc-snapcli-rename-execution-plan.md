# snapcli Namespace Rename — Thursday Execution Plan

**Author:** Aussie
**Date:** 2026-04-29
**Status:** Step-by-step plan for Codex/Collie execution Thursday
**Implements:** RFC #6 (rfc-snapcli-saas-adapter.md) §1 problem, §8 step 1
**Companions:** Builds on RFC #14 (Codex sandbox fix). Both must land before this plan can execute via Codex.

---

## 0. Pre-Flight (verify before starting)

Run these checks at the start of Thursday morning. If ANY fail, surface to Aussie/Dane before proceeding:

- [ ] **RFC #14 fix is live** — codex-companion.mjs accepts `--add-dir /Users/davidhunter/projects/cli-anything-snapcli` AND `--add-dir /Users/davidhunter/projects/cli-anything-propertymeld` AND `--add-dir /Users/davidhunter/projects/cli-anything-appfolio`. Verify: dispatch a no-op Codex task that creates a sentinel file in each repo.
- [ ] **Source-of-truth confirmed** — `python3 -c "from cli_anything.propertymeld import cli; print(cli.__file__)"` returns the path Codex will edit. Compare against both `/Users/davidhunter/projects/cli-anything-propertymeld/cli_anything/propertymeld/cli.py` and `/Users/davidhunter/projects/cli-anything-snapcli/adapters/pm/cli_anything/propertymeld/cli.py`. RFC #6 §1 says the LIVE binary imports the older standalone (cli-anything-propertymeld) — re-verify this hasn't shifted.
- [ ] **Diff between the two pm copies** — `diff -u <propertymeld>/cli.py <snapcli/adapters/pm>/cli.py`. snapcli's copy is bigger (21.7K vs 12.4K, includes Phase 2 work-orders files command shipped Apr 28). The MERGED source-of-truth must be the snapcli copy. If standalone has any features snapcli doesn't, port them in BEFORE renaming.
- [ ] **No active Blue session** — Blue must be disabled during the rename to avoid `from cli_anything.propertymeld import` calls hitting a half-renamed state.
- [ ] **Working tree clean** in both repos.

---

## 1. Scope Recap

Two adapter packages get renamed. Both today live in two locations (the recurring confusion source from Apr 28):

| Adapter | Old standalone location | Old monorepo copy | Target post-rename |
|---|---|---|---|
| PM (PropertyMeld) | `/Users/davidhunter/projects/cli-anything-propertymeld/cli_anything/propertymeld/` | `/Users/davidhunter/projects/cli-anything-snapcli/adapters/pm/cli_anything/propertymeld/` | `/Users/davidhunter/projects/cli-anything-snapcli/adapters/pm/snapcli_pm/` |
| AF (AppFolio) | `/Users/davidhunter/projects/cli-anything-appfolio/cli_anything/appfolio/` | `/Users/davidhunter/projects/cli-anything-snapcli/adapters/af/cli_anything/appfolio/` | `/Users/davidhunter/projects/cli-anything-snapcli/adapters/af/snapcli_af/` |

**Net:** 2 standalone repos retire (becomes deprecation shims for 1 quarter), 1 monorepo (`cli-anything-snapcli`) holds the canonical source under new package names (`snapcli_pm`, `snapcli_af`).

---

## 2. Execution Sequence (Thursday morning — Codex-routable per RFC #14 fix)

### Step 1 — Lock in the merged source

The snapcli monorepo copies (`adapters/pm/cli_anything/propertymeld/cli.py` 21.7K, `http_backend.py` 36.1K) are bigger than the standalones (`cli_anything-propertymeld/cli_anything/propertymeld/cli.py` 12.4K, `http_backend.py` 26.5K). Ship the snapcli versions as the source-of-truth.

```bash
# PM
diff -u /Users/davidhunter/projects/cli-anything-propertymeld/cli_anything/propertymeld/cli.py \
        /Users/davidhunter/projects/cli-anything-snapcli/adapters/pm/cli_anything/propertymeld/cli.py | head -50
# Same for http_backend.py and utils.py
# Same for AF (cli-anything-appfolio vs cli-anything-snapcli/adapters/af/...)

# If any feature exists in standalone but not snapcli, port it now (manual merge).
# Most likely: nothing to port. The big diff is Phase 2 features that ALREADY landed in snapcli.
```

**If diff shows standalone-only code:** STOP. Surface to Aussie. Do not proceed until merged.
**If diff is clean (snapcli is strict superset):** proceed to Step 2.

### Step 2 — Rename the monorepo packages

```bash
cd /Users/davidhunter/projects/cli-anything-snapcli

# PM rename
git mv adapters/pm/cli_anything/propertymeld adapters/pm/snapcli_pm
rm -rf adapters/pm/cli_anything   # drop the empty cli_anything namespace dir

# AF rename
git mv adapters/af/cli_anything/appfolio adapters/af/snapcli_af
rm -rf adapters/af/cli_anything

# Update intra-package imports
# PM internal: cli.py imports from utils, http_backend, api_backend — all relative to package
grep -rln "from cli_anything.propertymeld" adapters/pm/snapcli_pm/ | while read f; do
  sed -i '' 's/from cli_anything\.propertymeld/from snapcli_pm/g' "$f"
done
grep -rln "import cli_anything.propertymeld" adapters/pm/snapcli_pm/ | while read f; do
  sed -i '' 's/import cli_anything\.propertymeld/import snapcli_pm/g' "$f"
done

# AF internal
grep -rln "from cli_anything.appfolio" adapters/af/snapcli_af/ | while read f; do
  sed -i '' 's/from cli_anything\.appfolio/from snapcli_af/g' "$f"
done
grep -rln "import cli_anything.appfolio" adapters/af/snapcli_af/ | while read f; do
  sed -i '' 's/import cli_anything\.appfolio/import snapcli_af/g' "$f"
done

# Verify no stragglers
grep -rln "cli_anything\." adapters/ && echo "STRAGGLERS FOUND — investigate" || echo "Clean"
```

### Step 3 — Update setup.py entry points

Both adapter setup.pys at `adapters/pm/setup.py` and `adapters/af/setup.py` currently declare:

```python
entry_points={
    "console_scripts": ["pm=cli_anything.propertymeld.cli:cli"],
    "snapcli.platforms": ["pm=cli_anything.propertymeld.cli:cli"],
}
```

Replace with:

```python
entry_points={
    "console_scripts": ["pm=snapcli_pm.cli:cli"],
    "snapcli.platforms": ["pm=snapcli_pm.cli:cli"],
}
```

Same pattern for AF (`appfolio.cli:cli` → `snapcli_af.cli:cli`).

Also update the `name` field if it's `snapcli-pm` or `snapcli-af` already (it appears to be — confirmed in pre-read).

### Step 4 — Reinstall the renamed packages

```bash
# Clean first to avoid editable-install collisions
pip uninstall -y cli-anything-propertymeld cli-anything-appfolio snapcli-pm snapcli-af

# Install the new monorepo adapters in editable mode
cd /Users/davidhunter/projects/cli-anything-snapcli/adapters/pm && pip install -e .
cd /Users/davidhunter/projects/cli-anything-snapcli/adapters/af && pip install -e .
cd /Users/davidhunter/projects/cli-anything-snapcli/core && pip install -e .   # snapcli core
cd /Users/davidhunter/projects/cli-anything-snapcli && pip install -e .         # snapcli-bootstrap

# Smoke test
which pm   # should still resolve to /opt/homebrew/bin/pm
pm --help   # works
pm work-orders --help   # subcommands present
which af && af --help && af probe --help

# Critical: verify imports work from the new package
python3 -c "from snapcli_pm import cli; print(cli.__file__)"
# Should print /Users/davidhunter/projects/cli-anything-snapcli/adapters/pm/snapcli_pm/cli.py

python3 -c "from snapcli_af import cli; print(cli.__file__)"
```

### Step 5 — Ship deprecation shims in the standalone repos

The standalone repos (cli-anything-propertymeld, cli-anything-appfolio) get reduced to a single shim:

```python
# /Users/davidhunter/projects/cli-anything-propertymeld/cli_anything/propertymeld/__init__.py
"""Deprecated — re-exports from snapcli_pm. Will be removed 2026-08-01.

Existing callers (`from cli_anything.propertymeld import cli`) keep working
during the deprecation window. Migrate to `from snapcli_pm import cli`.
"""
import warnings
warnings.warn(
    "cli_anything.propertymeld is deprecated; import from snapcli_pm instead.",
    DeprecationWarning,
    stacklevel=2,
)
from snapcli_pm import *  # noqa: F401, F403
from snapcli_pm import cli, http_backend, api_backend, utils  # noqa: F401
```

Same for AppFolio: `cli_anything/appfolio/__init__.py` re-exports from `snapcli_af`.

**Delete the rest of the standalone code** — keeps repos thin during deprecation period.

```bash
cd /Users/davidhunter/projects/cli-anything-propertymeld/cli_anything/propertymeld
ls | grep -v __init__.py | xargs rm -f
ls   # only __init__.py remains
```

Same for AF.

### Step 6 — Update known caller imports

Search across the David tree for `cli_anything.propertymeld` or `cli_anything.appfolio` imports. Per Apr 29 grep, the callers are:

```
/Users/davidhunter/projects/cli-anything-propertymeld/tests/test_api_backend.py
/Users/davidhunter/projects/cli-anything-propertymeld/tests/test_cli.py
/Users/davidhunter/projects/monday-connector/tests/test_api_backend.py
/Users/davidhunter/projects/monday-connector/tests/test_cli.py
/Users/davidhunter/projects/cli-anything-appfolio/tests/test_api_backend.py
/Users/davidhunter/projects/cli-anything-appfolio/tests/test_cli.py
/Users/davidhunter/cortextos/community/skills/pm/pm-cli-harness/scripts/pm-assign-vendor.py
```

For each: edit to import from `snapcli_pm` / `snapcli_af` directly (skip the deprecation warning path).

```bash
# Bulk fix
for f in <files above>; do
  sed -i '' 's/from cli_anything\.propertymeld/from snapcli_pm/g' "$f"
  sed -i '' 's/from cli_anything\.appfolio/from snapcli_af/g' "$f"
done
```

The 2 cli-anything-propertymeld and 2 cli-anything-appfolio test files can keep their `from cli_anything.<vendor>` imports (those repos are deprecation shims and the tests verify the shim works). All others migrate.

### Step 7 — Run test suites

```bash
cd /Users/davidhunter/projects/cli-anything-snapcli
python3 -m pytest adapters/pm/tests/ adapters/af/tests/ -v 2>&1 | tail -40
# All tests must pass post-rename. If any fail, the rename is incomplete; rollback.

cd /Users/davidhunter/projects/cli-anything-propertymeld
python3 -m pytest tests/ -v 2>&1 | tail -20
# These tests verify the deprecation shim still works.

cd /Users/davidhunter/projects/cli-anything-appfolio
python3 -m pytest tests/ -v 2>&1 | tail -20
```

### Step 8 — Smoke test live binaries

```bash
pm probe                         # OAuth2 health check
pm work-orders list --limit 3 --json | head
pm work-orders files <known-meld> --json | head
af probe
af units list --limit 3 --json | head
```

Plus the pre-complete audit hook gate (RFC #1, shipped Apr 28) test:

```bash
echo '{"tool_input":{"command":"pm work-orders complete --meld-id <test-meld-id>"}}' | \
  bash /Users/davidhunter/cortextos/orgs/ascendops/agents/blue/scripts/hook-pre-complete-audit.sh
# Should still return same blocked-vs-pass behavior. Hook depends on `pm work-orders get` and `pm work-orders files` — both must work post-rename.
```

### Step 9 — Commit

Three commits across three repos. Co-author tags optional per project convention.

```bash
cd /Users/davidhunter/projects/cli-anything-snapcli
git add adapters/ && git commit -m "refactor(adapters): rename cli_anything.propertymeld → snapcli_pm, cli_anything.appfolio → snapcli_af"

cd /Users/davidhunter/projects/cli-anything-propertymeld
git add cli_anything/ && git commit -m "deprecate: redirect to snapcli_pm via shim, remove standalone code"

cd /Users/davidhunter/projects/cli-anything-appfolio
git add cli_anything/ && git commit -m "deprecate: redirect to snapcli_af via shim, remove standalone code"
```

### Step 10 — Update community skill caller

```bash
cd /Users/davidhunter/cortextos/community/skills/pm/pm-cli-harness/scripts/pm-assign-vendor.py
# Edit imports from cli_anything.propertymeld → snapcli_pm
git diff
git add -p
git commit -m "fix(skill): update pm-assign-vendor.py import to snapcli_pm post-rename"
```

---

## 3. Rollback Plan

If any of Steps 4-8 fail, full rollback in 3 commands:

```bash
cd /Users/davidhunter/projects/cli-anything-snapcli && git reset --hard HEAD~1
cd /Users/davidhunter/projects/cli-anything-propertymeld && git reset --hard HEAD~1
cd /Users/davidhunter/projects/cli-anything-appfolio && git reset --hard HEAD~1
pip uninstall -y snapcli-pm snapcli-af
cd /Users/davidhunter/projects/cli-anything-propertymeld && pip install -e .
cd /Users/davidhunter/projects/cli-anything-appfolio && pip install -e .
```

State is identical to pre-rename. Lost: any test data captured during the rename attempt.

---

## 4. Post-Rename Followups

- [ ] Update `feedback_snapcli_hierarchy.md` memory entry to reference `snapcli_pm` not `cli_anything.propertymeld`.
- [ ] Update `pm-cli-harness/SKILL.md` if it references the old package path explicitly.
- [ ] Mark the standalone repos as archived after 1 quarter of soak (target: 2026-08-01).
- [ ] File the upstream snapcli-framework expansion (RFC #6 §3 enhanced SnapAdapter base class) as a separate next-week task — this rename is the prerequisite, not the framework expansion itself.

---

## 5. Estimated Time

| Step | Time |
|---|---|
| 0. Pre-flight | 10 min |
| 1. Diff + lock source | 15 min |
| 2. Rename packages | 15 min |
| 3. Update setup.py | 5 min |
| 4. Reinstall + smoke | 15 min |
| 5. Deprecation shims | 10 min |
| 6. Update callers | 15 min |
| 7. Test suites | 20 min |
| 8. Live smoke | 10 min |
| 9. Commit | 5 min |
| 10. Skill caller update | 5 min |
| **Total** | **~2 hours** |

Doable in one Thursday morning Codex session if RFC #14 fix lands first. Otherwise self-write at 2-3x time.

---

## 6. Open Questions for Aussie+Collie+Dane Wed evening

1. **Source-of-truth confirmation:** is the snapcli adapters/pm copy (21.7K cli.py) the strict superset, or did anything land in standalone propertymeld between Apr 28 and Thursday morning? Re-run diff at execution time.
2. **Delete vs archive standalones:** delete code in standalones during shim creation, or archive in a `_pre_rename/` subdir for safety? Lean delete — git history is the archive.
3. **monday-connector tests reference cli_anything.propertymeld** — that's a third repo I didn't expect to touch. Confirm with David these tests are doing what they look like (using PM cli for assertions in unrelated code) before bulk-editing.
4. **Deprecation timeline** — RFC #6 says 1 quarter. 2026-08-01 is the target archive date. Confirm.
5. **Codex --add-dir routing for this task** — once RFC #14 fix is live, this rename touches 3 repos (snapcli, propertymeld, appfolio) plus 1 cortextos community skill. Codex dispatch needs `--add-dir` for each /projects/* repo. Codex-rescue smart-default parsing should handle this if RFC #14 Q3 inference rule lands.

---

**End of execution plan.** Ready for Codex Thursday morning post-RFC#14-fix.

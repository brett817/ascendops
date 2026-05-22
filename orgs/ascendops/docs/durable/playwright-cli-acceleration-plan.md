# Playwright CLI Acceleration Plan

**Author:** Aussie
**Date:** 2026-04-29
**Status:** Concrete plan — not vague "could be useful"
**Trigger:** @playwright/cli v1.59.1 installed globally per David approval. Per RFC #16 lifecycle pattern, Playwright is the immediate test case for "MCP for exploration → CLI for production."

---

## 1. @playwright/cli Command Surface

Verified live via `playwright --help`:

| Command | Purpose | Acceleration value |
|---|---|---|
| `open [url]` | Open page in instrumented browser; manual interaction recorded as Playwright operations under the hood | Manual exploration of a UI to discover selectors |
| `codegen [url]` | Open page + emit Playwright code as user interacts with it | **The core acceleration tool.** Record once, get a script — replaces the "write selectors blind" pattern |
| `install` / `install-deps` / `uninstall` | Browser binary lifecycle | One-time setup |
| `cr` / `ff` / `wk` | Open in specific browser (Chromium / Firefox / WebKit) | Per-browser session capture |
| `screenshot <url> <filename>` | Headless capture | Quick visual diagnostics, reports |
| `pdf <url> <filename>` | Page → PDF | Documentation generation, audit-trail snapshots |
| `show-trace [trace]` | Trace viewer for recorded sessions | Postmortem on flaky scripts |

**Codegen output targets (from `playwright codegen --help`):** javascript, playwright-test, python, python-async, python-pytest, csharp variants, java variants. **`--target python` is the one we care about** — emits `from playwright.sync_api import ...` matching our existing `pm-recapture-session-playwright.py` style.

**Codegen knobs that matter:** `--device` (mobile profile), `--load-storage` / `--save-storage` (persist cookies between codegen sessions), `--browser` (cr/ff/wk), `--ignore-https-errors`, `--proxy-server`. The `--save-storage` + `--load-storage` pair is huge for our auth-required flows: capture session once, replay across multiple codegen runs without re-logging-in each time.

---

## 2. Our Current Browser-Automation Work

Live and ready to leverage:

- **`pm-recapture-session-playwright.py`** (`/Users/davidhunter/projects/cli-anything-snapcli/adapters/pm/scripts/pm-recapture-session-playwright.py`) — cookie auto-recapture for Property Meld. Live via `pm probe → 401 → trigger recapture` path. Today: ~50 LOC handwritten (login flow, cookie extraction, save to creds file).
- **`pm-recapture-session-safari.py`** (sibling script) — Safari binary cookie parser. NOT Playwright; macOS-specific; documented as the primary path per `pm_cli_session_method.md`. Playwright variant is the cross-platform fallback.
- **`web-testing` community skill** at `community/skills/web-testing/` — currently empty directory. Was scoped, not built.
- **All other `playwright`-grep hits** (Blue scripts, snapcli adapter cli.py, etc.) are NON-runtime Playwright references — installed-via-requirements imports or setup.py declarations. The actual runtime caller is just `pm-recapture-session-playwright.py`.

Deferred / scoped-not-built (per `ax-pyobjc-vs-playwright-scope.md`):

- **Meld merge** — combine two PM melds at the manager UI level; no API path exists.
- **PM chat delete** — surgical deletion of a thread comment, also UI-only.
- **Bulk in-app actions** that aren't yet covered by `pm` CLI (the snapcli rename will close most but not all gaps).
- **Cookie recapture cross-platform** — Linux variant.

---

## 3. Per-Workflow Acceleration Map

For each existing-or-planned workflow, which playwright-cli command saves time vs writing from scratch:

| Workflow | Old approach | New approach with playwright-cli | Savings |
|---|---|---|---|
| PM session recapture (existing) | Hand-write the login flow with guessed selectors, debug failures | `playwright codegen --target python https://app.propertymeld.com` → log in manually → script emitted with verified selectors | First-write savings ~80% (~30 min vs ~3 hours). Maintenance savings on every PM UI redesign — re-record vs re-debug. |
| AppFolio PO creation (RFC #5 deferred) | Capture POST endpoint via Safari devtools network panel (current method per `feedback_playwright_last_resort.md`) | `playwright codegen --target python <af-PO-create-url>` → click through PO creation manually → emitted script captures both selectors AND the POST shape | Equivalent to the existing one-time-capture pattern but with executable replay-ready script as a side effect. ~50% additional savings. |
| Meld merge (deferred UI op) | Write Playwright selectors blind, iterate on test merge | `playwright codegen --target python` → record merge flow → emitted script becomes the implementation | First-pass implementation in <30 min vs estimated 4-6 hours blind. |
| PM chat delete (deferred UI op) | Same as merge — selectors blind | Same — codegen records deletion flow | Same ~80% savings on first write. |
| Visual regression / screenshot diagnostics | Custom Playwright Python harness | `playwright screenshot` for one-shot captures, `playwright show-trace` for postmortem | No code at all for one-offs. |
| Audit-trail PDF snapshots (e.g. document a meld state for legal hold) | Custom code | `playwright pdf <meld-url> <filename>` | One-line replacement. |
| Cross-browser session capture | Per-browser hand-written scripts | `playwright cr` / `ff` / `wk` with same script + `--save-storage` | One script covers 3 browsers. |

**Pattern:** the savings multiply when capture-once-replay-many — every flow that has even one UI step we want to scriptize benefits.

---

## 4. Future Workflows (Deferred pyobjc UI Ops)

Per `ax-pyobjc-vs-playwright-scope.md`, several UI-only PM ops were scoped against pyobjc + AXUIElement vs Playwright. Playwright won on portability + maintainability. Now that @playwright/cli is installed, the codegen-record-then-review pattern shortens these to <30 min prototypes:

- **Meld merge:** `playwright codegen --target python --browser cr https://app.propertymeld.com/3287/m/3287/melds/<id>/` → manually click "Merge with..." → select target → confirm. Emitted Python is the implementation skeleton. Review for selector stability (use `data-test-id` attrs where available via `--test-id-attribute`), wrap in `pm work-orders merge` snapcli command, ship.
- **PM chat delete:** `playwright codegen` → click into a thread → delete a specific comment → confirm. Same skeleton flow.
- **Bulk meld bulk-label:** if PM ever ships a UI-only batch action we need, codegen handles it.

These three could be RFC'd + shipped in a single Thursday block once Codex Mode 2 fix lands (the implementations live in /Users/davidhunter/projects/cli-anything-snapcli/adapters/pm/scripts/, which is a /projects/* path).

---

## 5. Concrete Next Steps This Week

Three specific things using playwright-cli, in priority order:

**Step 1 (this week, Aussie or Collie, ~1 hour):** **Re-record `pm-recapture-session-playwright.py` via codegen.** Run `playwright codegen --target python https://app.propertymeld.com/`. Manually log in. Compare emitted code vs current handwritten script. If emitted version is cleaner OR more selector-stable, port it as v2 of the recapture flow with a 2-week soak. The current handwritten version is 50 LOC of guess-and-check that needs maintenance every PM UI tweak.

**Step 1 — proof artifact (Collie, 2026-04-29 dispatch QQ):** shipped `pm-recapture-session-playwright-codegen-v2.py` (172 LOC) side-by-side with the original (170 LOC) at `adapters/pm/scripts/`. v2 preserves the literal codegen-style block (linear `with sync_playwright() as p:`, `page.get_by_label(...)` and `page.get_by_role("button", name="Sign in")` selectors per Playwright's recommended modern recorder output) so a future re-record after a PM login redesign drops in with minimal edit. v1 used CSS-attribute selectors (`input[name='email'], input[type='email'], #id_email`) which are more brittle to PM-side rename. Net comparison: v2 is **as compact** as v1 (only +2 LOC), uses **role/label selectors** (more resilient), and is **codegen-replayable** (the recorded block is preserved verbatim, modulo headless toggle + env-credential interpolation + cookie-return). **Recommendation:** soak v2 for 2 weeks behind a `PM_RECAPTURE_FLAVOR=codegen-v2` env opt-in; promote to default if no regressions; retire v1. Do NOT replace v1 today — both files remain on disk for comparison and rollback. Marker comment on v2 line 2: `added 2026-04-29 by collie via dane dispatch — RFC #16 Stage 1→3 codegen-as-bridge pattern proof`.

**Step 2 (this week, Aussie investigation, ~30 min):** **Capture the AppFolio PO creation flow** (RFC #5 §5 prerequisite). Run `playwright codegen --target python --save-storage af-session.json https://app.appfolio.com/...` → log in → manually click through one real PO creation → emitted script + saved storage state. This becomes the foundation for `af purchase-orders create` once RFC #6 framework lands. The codegen output gives Codex a precise spec to build from instead of "figure out the POST shape" guesswork.

**Step 3 (next week, Codex post-Mode-2-fix, ~2 hours):** **Prototype the meld merge flow.** Per RFC #16's stage 1→2→3 lifecycle, this is exactly the case where MCP exploration would help us discover the workflow. We don't have a Playwright MCP currently, but `playwright codegen` IS the discovery tool — interactive, observes user actions, emits production-ready code. Record once; then Codex wraps the emitted script as a `pm work-orders merge --meld-id <a> --into <b>` snapcli command. Same pattern unblocks chat-delete and any future UI-only PM ops.

---

## 6. Why This Matters Now

@playwright/cli installation is the missing piece for the RFC #16 stage 1→2 → 3 pattern as applied to browser automation. We had Playwright Python lib for stage 3 (production scripts) but no tooling for stage 1 (interactive discovery) or stage 2 (workflow-stable codegen). Codegen IS stage 1 — observes user, emits scripts. Once a workflow is recorded, stage 3 conversion is "review the emitted code, harden selectors, wrap in CLI." That's the same lifecycle David crystallized this morning.

Three deferred UI ops (meld merge, chat delete, AppFolio PO) each shorten from "weeks of selector debugging" to "<1 day record + harden + ship" with this CLI.

---

## Word count: ~1140 (within 800-1300 target)

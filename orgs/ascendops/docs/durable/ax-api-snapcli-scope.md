# macOS Accessibility API — snapcli Enhancement Layer Scope

**Requested by:** Dane  
**Date:** 2026-04-25  
**Scope:** Enhancement layer only — snapcli stays primary

---

## 1. Tools Researched

### macOS-MCP (CursorTouch/MacOS-MCP)

**What it is:** MCP server that exposes macOS Accessibility API to Claude. "Control any macOS app from Claude Code."

**Install:** `uvx macos-mcp` (Python 3.11+, macOS 12+, Accessibility + Screen Recording permissions)

**Primitives exposed:**
- Click by coordinates or accessibility ID
- Type text into fields
- Scroll
- Keyboard shortcuts (Cmd+Tab, Cmd+C, etc.)
- Desktop snapshot with element coordinates
- App launch and window management
- Shell command execution from within the tool

**App compatibility:** Any app that exposes the macOS Accessibility API — includes Chrome (and web apps running inside it), native apps, Electron apps

**Maturity:** 22 stars, v0.2.3, MIT, active — early stage

**Known limitations:**
- Some input fields don't receive keystrokes properly
- Complex UIs are slow (AX tree traversal)
- Cannot interact with system auth dialogs
- Requires manual permission grant in System Settings

---

### macos-ui-automation-mcp (mb-dev/macos-ui-automation-mcp)

**What it is:** "Playwright for Mac" — MCP server for native macOS UI automation via AX API

**Install:** Clone + `uv sync`, grant permissions, configure in Claude Code

**Primitives exposed:**
- JSONPath element discovery (find buttons/fields by role and label)
- Click by accessibility ID or coordinates
- Text input to fields
- App overview (list all windows + elements)
- Permission verification

**App compatibility:** Native macOS apps; web apps in Chrome via AX tree

**Maturity:** 31 stars, early stage — less active than macOS-MCP

**Known limitations:** Search performance varies by UI depth; some apps restrict AX access

---

### Silk

Not found. No GitHub project with this name in the macOS MCP/accessibility space. Likely a misremembered name — the two tools above are the current field.

---

## 2. Current snapcli Gap Map

| Operation | Current path | Works when? |
|-----------|-------------|-------------|
| List/get work orders | snapcli (cookies) | Cookies valid |
| Post PM message | snapcli (cookies) | Cookies valid |
| Assign in-house tech | snapcli (cookies) | Cookies valid |
| Assign external vendor | snapcli http_backend (cookies) | Cookies valid |
| Read maintenance notes | Nexus API (OAuth2) | Always — OAuth2, not cookies |
| Write maintenance notes | Nexus API (OAuth2) | Always |
| Properties/vendors list | Nexus API (OAuth2) | Always |
| **Meld merging** | **Browser UI only** | **Manual only** |
| **Chat message delete/edit** | **Browser UI only** | **Manual only** |
| **Cookie recapture** | **Manual Playwright** | **Human required** |

**Session expiry risk:** When PM_CREDS_PATH cookies expire, ALL snapcli operations return 401/403. Detection: `pm probe --json`. Current recovery: manual Playwright session capture (human-triggered). This is the most operationally impactful gap.

**Nexus API is session-independent** (OAuth2 client credentials) — unaffected by cookie expiry. But Nexus is read-heavy; write ops (assign, message) still go through snapcli.

---

## 3. Integration Plan

### Where AX API slots in

AX API is not a replacement for snapcli — it's a fallback layer for two specific failure modes:

**Trigger A: Cookie expiry (most important)**
- `pm probe --json` returns 401/403
- AX fallback: launch Chrome → navigate to PM login URL → type credentials → submit → extract new session cookies from browser → write to PM_CREDS_PATH → retry snapcli command
- After recapture: snapcli resumes normally, AX goes back to sleep

**Trigger B: UI-only operations (less important)**
- meld merging request arrives
- AX path: navigate to PM → open meld → click Merge → select target meld → confirm
- chat delete/edit: same pattern

### What does NOT change
- snapcli remains primary for all cookie-based operations
- Nexus API remains primary for OAuth2 reads/writes
- AX is never called when snapcli is working

### Header recapture workflow (detailed)
```
1. pm probe → 401
2. Load credentials from ~/.claude/credentials/property-meld.json
3. Launch Chrome (or bring to front if open)
4. AX: navigate to https://app.propertymeld.com
5. AX: find email field (role=AXTextField, label~="Email") → type PM_WEB_EMAIL
6. AX: find password field → type PM_WEB_PASSWORD
7. AX: find login button → click
8. Wait for redirect (AX: poll URL until != login page)
9. Extract cookies via AppleScript/CDP or AX cookie read
10. Write to PM_CREDS_PATH
11. Retry original snapcli command
12. Log: cortextos bus log-event action pm_session_refreshed info
```

**Cookie extraction note:** Step 9 is the hard part. AX API cannot directly read browser cookies — it reads UI elements. Cookie extraction from a logged-in Chrome session requires either Chrome DevTools Protocol (CDP) over localhost OR reading from Chrome's SQLite cookie store. CDP is the cleaner path.

---

## 4. Effort Estimate

| Phase | Scope | Effort |
|-------|-------|--------|
| Phase 0: Install + test macOS-MCP | Install, permission grant, smoke test with PM | 1 hour |
| Phase 1: Automated cookie recapture | probe-failure detection + AX login + CDP cookie extraction + retry | 2–3 days |
| Phase 2: UI-only ops (merge, chat delete) | Map UI sequences + build AX commands per operation | 2–3 days |
| **Total** | | **5–7 days** |

The effort estimate is dominated by cookie extraction (Phase 1 step 9). CDP-based extraction is well-documented but involves localhost debugging port management, which adds complexity.

**Alternative:** If cookie extraction via CDP proves brittle, fallback is AppleScript (simpler, already native) but only works if cookies can be surfaced via browser extension or developer console — still ~1 day of exploration.

---

## 5. Recommendation

**Short answer: Phase 1 is worth doing. Phase 2 is not urgent.**

### Phase 1 — Cookie recapture (DO)

This closes the real operational gap. Currently when cookies expire, Blue is blind until a human manually refreshes them. In a 24/7 agent context, that's a potential multi-hour outage for all snapcli write operations. Automated recapture eliminates that dependency.

**However:** before building a full AX integration, consider the simpler path first. We already have Playwright working for one-time header capture. A `pm probe` → Playwright headless recapture trigger is a 2–4 hour build, not 2–3 days, and uses proven tooling we already control. AX API adds a new MCP dependency (early-stage, 22–31 stars) that could break on a macOS update.

**Recommended order:**
1. Build Playwright-based auto-recapture first (2–4 hours). Wire `pm probe` failure into a recapture skill that runs the existing Playwright capture script non-interactively.
2. If Playwright auto-recapture works reliably for 2–3 weeks, stop here — problem solved without the AX dependency.
3. Only adopt macOS-MCP if Playwright headless is blocked (bot detection, 2FA timing, etc.).

### Phase 2 — UI-only ops (DEFER)

Meld merging and chat deletion are genuinely rare operations (occurs a few times per month at most). The effort (2–3 days) doesn't justify the dependency risk at current operation frequency. Defer until one of:
- Operation frequency increases (melds are being merged regularly)
- macOS-MCP or macos-ui-automation-mcp reaches v1.0 or ~500 stars
- A specific incident demonstrates the gap costs David meaningful time

### AX tool choice (if adopted)

macOS-MCP over macos-ui-automation-mcp. Both are early-stage, but macOS-MCP has a broader primitive set (scroll, keyboard shortcuts, snapshots) and is more actively maintained.

---

## Bottom Line

| Decision | Recommendation |
|----------|---------------|
| Adopt macOS-MCP/Silk now? | No — too early-stage for 24/7 agent |
| Fix cookie recapture? | YES — but use Playwright auto-trigger first (2–4h vs 2–3d) |
| Build UI-only ops? | Defer — low frequency, high effort |
| Revisit AX adoption? | When macOS-MCP hits v1.0 or a specific gap becomes acute |

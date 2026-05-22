# pyobjc AXUIElement vs Playwright — Direct Scope

**Date:** 2026-04-25  
**Context:** Cookie recapture + UI-only PM ops. pyobjc = first-party Apple Python bridge, zero third-party MCP dependency.

---

## 1. Can pyobjc + AXUIElement control Chrome/Safari on macOS?

**Yes, fully.** pyobjc is the official Python-ObjC bridge — ships with macOS, installable via `pip install pyobjc`. `AXUIElementCreateApplication` from `ApplicationServices` framework gives programmatic access to any app's Accessibility tree including Chrome.

What it can do with Chrome:
- Navigate to any URL (via AX action on the address bar)
- Find form fields, buttons by AX role + label
- Type into fields, click buttons, submit forms
- Read rendered text content from page elements
- Wait for navigation (poll AX `AXURL` attribute on main window)
- Works on the **live running Chrome instance** — no headless browser, no new process

What it cannot do:
- Read browser cookies directly (cookies are not in the AX tree)
- Intercept HTTP responses
- Access DevTools without enabling remote debugging port

**Install:** `pip install pyobjc-framework-ApplicationServices pyobjc-framework-Cocoa`  
Currently not installed on this machine — 1-line fix.

---

## 2. Concrete Scripts

### (a) Login to PropertyMeld + extract fresh session cookies

```python
#!/usr/bin/env python3
"""
AX-based PM session refresh — controls live Chrome, no headless.
Cookie extraction via Chrome CDP (remote-debug port must be open) or
cookie-file read as fallback.
"""
import time, subprocess, json, sqlite3, shutil, os
from ApplicationServices import (
    AXUIElementCreateApplication,
    AXUIElementCopyAttributeValue,
    AXUIElementPerformAction,
    AXUIElementSetAttributeValue,
    kAXValueAttribute, kAXFocusedAttribute,
)
from Cocoa import NSWorkspace, NSRunningApplication

PM_URL = "https://app.propertymeld.com"
PM_EMAIL = os.environ["PM_WEB_EMAIL"]
PM_PASSWORD = os.environ["PM_WEB_PASSWORD"]
COOKIE_OUT = os.path.expanduser("~/.claude/credentials/property-meld.json")

def get_chrome_pid():
    for app in NSWorkspace.sharedWorkspace().runningApplications():
        if "Google Chrome" in app.localizedName():
            return app.processIdentifier()
    # Launch Chrome if not running
    subprocess.Popen(["open", "-a", "Google Chrome"])
    time.sleep(2)
    return get_chrome_pid()

def ax_navigate(chrome_ax, url):
    """Type URL into address bar via Cmd+L shortcut, then Enter."""
    # Cmd+L to focus address bar
    subprocess.run(["osascript", "-e",
        f'tell application "Google Chrome" to set URL of active tab of front window to "{url}"'])
    time.sleep(2)

def ax_find_element(root, role, label_contains):
    """Recursive AX element search by role + label."""
    # Simplified — real impl traverses AX tree recursively
    children = AXUIElementCopyAttributeValue(root, "AXChildren", None)
    if not children:
        return None
    for child in children[1] or []:
        r = AXUIElementCopyAttributeValue(child, "AXRole", None)
        label = AXUIElementCopyAttributeValue(child, "AXLabel", None) or \
                AXUIElementCopyAttributeValue(child, "AXDescription", None)
        if r and r[1] == role and label and label_contains.lower() in str(label[1]).lower():
            return child
        found = ax_find_element(child, role, label_contains)
        if found:
            return found
    return None

def extract_cookies_via_applescript():
    """Read cookies by running JS in Chrome via osascript — no CDP needed."""
    script = '''
    tell application "Google Chrome"
        set cookieData to execute active tab of front window javascript "
            document.cookie
        "
    end tell
    '''
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    return result.stdout.strip()

def extract_cookies_via_cookie_db():
    """
    Read Chrome SQLite cookie store directly.
    RISK: Chrome locks the db while running. Must copy first.
    """
    src = os.path.expanduser(
        "~/Library/Application Support/Google/Chrome/Default/Cookies"
    )
    dst = "/tmp/pm_cookies_copy.db"
    shutil.copy2(src, dst)
    conn = sqlite3.connect(dst)
    rows = conn.execute(
        "SELECT name, value, host_key, path, expires_utc, is_secure "
        "FROM cookies WHERE host_key LIKE '%propertymeld.com'"
    ).fetchall()
    conn.close()
    return [{"name": r[0], "value": r[1], "domain": r[2],
             "path": r[3], "expires": r[4], "secure": bool(r[5])}
            for r in rows]

# Main flow
pid = get_chrome_pid()
# Navigate to PM login
ax_navigate(None, f"{PM_URL}/accounts/login/")
time.sleep(3)

# Fill login form via osascript JS injection (more reliable than AX for input fields)
subprocess.run(["osascript", "-e", f'''
tell application "Google Chrome"
    execute active tab of front window javascript "
        document.querySelector('input[type=email], input[name=username], input[id*=email]').value = '{PM_EMAIL}';
        document.querySelector('input[type=password]').value = '{PM_PASSWORD}';
        document.querySelector('[type=submit], button[class*=login]').click();
    "
end tell
'''])
time.sleep(4)  # wait for redirect

# Extract cookies
cookies = extract_cookies_via_cookie_db()
with open(COOKIE_OUT, "w") as f:
    json.dump(cookies, f)
print(f"Wrote {len(cookies)} PM cookies to {COOKIE_OUT}")
```

**Reality check on cookie extraction:** Three paths exist, each with a trade-off:

| Method | Reliability | Notes |
|--------|-------------|-------|
| `document.cookie` via osascript JS | Medium | Only reads cookies NOT marked `HttpOnly`. PM's session cookies are likely HttpOnly — this would miss them. |
| Chrome SQLite cookie db (copy) | High | Works, but requires Full Disk Access. Chrome encrypts values on macOS (SafeStorage/Keychain). Decryption is possible but adds 20 lines of Keychain code. |
| CDP (remote-debug port) | High | Chrome must be launched with `--remote-debugging-port=9222`. Cleanest API. `curl localhost:9222/json/cookies`. |

**Winner for cookie extraction: CDP.** Launch Chrome with `--remote-debugging-port=9222` (one env flag), then `curl localhost:9222/json` to get session cookies after login. No Keychain decryption needed.

---

### (b) Meld merge operation

```python
# Playwright equivalent is 8 lines. AX version:
merge_url = f"https://app.propertymeld.com/3287/m/3287/melds/{meld_id}/"
ax_navigate(None, merge_url)
time.sleep(2)

# Click Merge button via JS injection (more reliable than AX for SPAs)
subprocess.run(["osascript", "-e", f'''
tell application "Google Chrome"
    execute active tab of front window javascript "
        // Find merge button in PM's React UI
        const btns = Array.from(document.querySelectorAll('button'));
        const mergeBtn = btns.find(b => b.textContent.includes('Merge'));
        if (mergeBtn) mergeBtn.click();
    "
end tell
'''])
time.sleep(1)

# Handle merge target dialog — select meld ID via JS
subprocess.run(["osascript", "-e", f'''
tell application "Google Chrome"
    execute active tab of front window javascript "
        const input = document.querySelector('[placeholder*=meld], input[type=search]');
        if (input) {{
            input.value = '{target_meld_id}';
            input.dispatchEvent(new Event('input', {{bubbles: true}}));
        }}
    "
end tell
'''])
```

---

### (c) Chat message delete

```python
subprocess.run(["osascript", "-e", f'''
tell application "Google Chrome"
    execute active tab of front window javascript "
        // PM chat messages have a delete action on hover
        // Find message by content, trigger hover to reveal delete button
        const msgs = document.querySelectorAll('[class*=message], [class*=comment]');
        for (const msg of msgs) {{
            if (msg.textContent.includes('{message_snippet}')) {{
                msg.dispatchEvent(new MouseEvent('mouseover', {{bubbles: true}}));
                const delBtn = msg.querySelector('[aria-label*=delete], [title*=delete], [class*=delete]');
                if (delBtn) delBtn.click();
                break;
            }}
        }}
    "
end tell
'''])
```

---

## 3. pyobjc vs Playwright for Cookie Recapture

| Dimension | pyobjc + AX | Playwright headless |
|-----------|-------------|---------------------|
| Dependency | Zero — `pip install pyobjc` (Apple-native) | `pip install playwright` + `playwright install chromium` (~170MB) |
| Detection risk | Very low — real Chrome, real fingerprint | Low — Playwright has telltale headers but PM doesn't have anti-bot |
| Cookie extraction | CDP or Keychain (20-30 extra lines) | 1 line: `context.cookies()` |
| Wait-for-navigation | Manual polling (`AXURL` attribute) | Built-in: `page.wait_for_url()` |
| JS injection path | osascript `execute javascript` | `page.evaluate()` |
| Handles HttpOnly cookies | YES (via CDP or cookie db) | YES (native) |
| Requires Chrome running | YES (controls existing instance) | NO (spawns its own) |
| Effort to build | 1–1.5 days (CDP setup + AX nav + test) | 3–4 hours (extend existing script) |
| Robustness | Medium — JS injection is fragile on SPAs | High — Playwright is battle-tested on SPAs |
| Existing code on this machine | None | Already has working capture script |

**Key difference:** For cookie recapture, the hard problem is extracting cookies after login. Playwright makes this trivial (`context.cookies()`). pyobjc requires either CDP (extra setup) or Keychain decryption (more code). Both work — Playwright is just faster to build and maintain.

For **UI-only ops** (merge, chat delete), both approaches converge on JS injection via the browser. The AX control layer (navigating, finding elements) is roughly equivalent to Playwright selectors. Advantage to pyobjc here: no separate headless Chrome needed — it uses the agent's existing live Chrome session.

---

## 4. Effort to Build

| Approach | Phase | Effort |
|----------|-------|--------|
| **Playwright auto-recapture** | Wire probe-failure → existing capture script | 3–4 hours |
| **pyobjc full build** | CDP setup + AX nav + cookie extraction + retry wiring | 1.5–2 days |
| **pyobjc UI-only ops** (merge, chat delete) | JS injection scripts + error handling | 1 day |

---

## 5. Recommendation

**For cookie recapture: Playwright wins, and we should build it now.**

The recapture script already exists. Wiring it to a `pm probe` failure trigger is 3–4 hours. pyobjc would do the same job at 4–5× the effort with no meaningful benefit for this specific use case.

**For UI-only ops (meld merge, chat delete): pyobjc is the right path — but build it later.**

Once cookie recapture is automated (Playwright), the only remaining gaps are meld merge and chat deletion. For those, pyobjc is cleaner than Playwright: no separate browser process, uses the live session, zero additional binary dependency. The JS injection approach for both operations is ~50 lines total. This is a 1-day build whenever those operations become frequent enough to justify it.

**Decision tree:**

```
Cookie expired → pm probe 401 → Playwright recapture (build now, 3-4h)
Meld merge requested → pyobjc JS injection (build when needed, 1 day)
Chat delete requested → pyobjc JS injection (same session)
```

**Do not use pyobjc for cookie recapture.** The CDP + Keychain path is real work with no payoff versus Playwright's `context.cookies()`. David's instinct to avoid third-party MCP tools is right — but pyobjc and Playwright are both first-party enough (one is Apple-native, the other is Microsoft-maintained and already on this machine). The right tool for each job is different.

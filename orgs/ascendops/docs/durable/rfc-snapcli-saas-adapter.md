# RFC: snapcli SaaS-Adapter Framework — extensibility for any vendor without a real API

**Author:** Collie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review
**Item:** Thursday plate #6 (of 13)
**Companions:** PM CLI hook gate (#1, shipped) is the canonical adapter consumer; AppFolio (#5 Home Depot RFC) is the next adapter target.

---

## 1. Problem — current snapcli architecture audit

The snapcli repo at `/Users/davidhunter/projects/cli-anything-snapcli` already has a partially-formed adapter framework. What's there:

```
cli-anything-snapcli/
├── snapcli/
│   ├── adapter.py            # SnapAdapter base class (HTTP get/post + cookie session loader)
│   └── capture/
│       └── safari.py         # Safari binary cookie parser (used by PM)
├── core/
│   └── cli_anything/snapcli/
│       └── cli.py            # discovery via entry_points(group="snapcli.platforms")
└── adapters/
    ├── pm/  (cli_anything/propertymeld/cli.py + http_backend.py)
    └── af/  (cli_anything/appfolio/cli.py + api_backend.py)
```

**`SnapAdapter` (snapcli/adapter.py)** already has: `load_session()` (cookie file → header dict), `get(path, params)`, `post(path, payload)`. So the framework is half-done, it just doesn't know it.

**`cli.py` (core/cli_anything/snapcli/cli.py)** auto-loads via Python `importlib.metadata.entry_points(group="snapcli.platforms")`. Each adapter's setup.py would declare an entry point and the unified `snapcli` binary picks it up. That's a clean plugin pattern.

**Problem 1 — the namespace collision (S303 / observation 15201).** Two packages own `cli_anything.propertymeld.*`:
- `cli-anything-propertymeld` (older standalone, what the live `pm` binary actually imports — verified Apr 28 via `python3 -c "from cli_anything.propertymeld import cli; print(cli.__file__)"`)
- `cli-anything-snapcli` (monorepo's `adapters/pm/cli_anything/propertymeld/`)

Both register the `cli_anything` namespace package, Python imports the first one resolved on `sys.path`. Yesterday this caused 6+ commits worth of confusion because Phase 2 PM features shipped to snapcli but the `pm` binary kept using the older standalone — making the new code invisible at runtime.

**Problem 2 — adapters use the namespace, not the framework.** The PM adapter (`adapters/pm/cli_anything/propertymeld/http_backend.py`) does NOT subclass `SnapAdapter`. It re-implements `_load_creds()`, `_cookie_header()`, `_get_csrf_token()`, `_http_get()`, `_http_post()`, `_http_patch()`, `_http_put()` in 200+ LOC. Same for AppFolio's `api_backend.py`. Each adapter is a copy-paste of HTTP plumbing. Adding TenantTurner today would mean a third copy.

**Problem 3 — no rate-limit / retry / structured-error contract.** Every adapter's HTTP helper handles 4xx/5xx slightly differently. Some `sys.exit(1)`, some return `{"error": ...}`, some raise. Hook callers (like #1 hook gate) must special-case each.

**Problem 4 — session capture is per-adapter ad-hoc.** PM uses Safari binary cookies. AppFolio uses session-captured headers (per `project_appfolio_no_api.md`). TenantTurner could be OAuth-saved-tokens. Every new adapter today reinvents capture; there's no contract.

## 2. Goals / Non-Goals

**Goals**
- One canonical `SnapAdapter` base class that *every* adapter inherits, with HTTP, session, retry, rate-limit, and error normalization.
- Resolve the `cli_anything` namespace collision permanently (one repo, one source).
- Plugin-discovery pattern formalized via `entry_points(group="snapcli.platforms")`, documented end-to-end.
- A new adapter (TenantTurner-class) takes ~1 day, not ~1 month — measured by line-count delta vs baseline PM adapter.
- Session-capture method declared per adapter, with at least 4 supported types.

**Non-Goals**
- **Not building a new vendor adapter in this RFC.** TenantTurner / LeadSimple / Monday are reference targets, not ship targets here.
- **Not changing the per-adapter command surface conventions.** PM's `pm work-orders <action>` shape stays.
- **Not unifying authentication.** Each vendor has its own auth flow; the framework supports them, doesn't replace them.
- **Not introducing async/await everywhere.** The current `urllib` synchronous pattern is fine for CLI scale; rewriting to `httpx` is a separate RFC.

## 3. Adapter Interface

Every adapter ships a Python package that:

1. Exposes a `cli` Click group via the `snapcli.platforms` entry point.
2. Provides one or more `SnapAdapter` subclasses (the backend) used by the Click commands.

The expanded `SnapAdapter` contract:

```python
class SnapAdapter:
    name: str                       # "pm", "af", "tt", etc. (matches entry-point name)
    base_url: str                   # vendor base URL
    creds_path: str                 # ~/.claude/credentials/<name>.json
    user_agent: str
    session_capture: SessionCapture  # see §4
    rate_limit: RateLimitPolicy      # default = exponential backoff, max 3 retries
    csrf_strategy: CsrfStrategy      # none | meta-tag | header | per-request

    def load_session(self) -> dict[str, str]: ...      # already exists
    def get(self, path, params=None, *, headers=None) -> Result: ...
    def post(self, path, payload, *, headers=None) -> Result: ...
    def patch(self, path, payload, *, headers=None) -> Result: ...   # add (currently PM-only)
    def put(self, path, payload, *, headers=None) -> Result: ...     # add
    def delete(self, path, *, headers=None) -> Result: ...           # add

    def normalize_error(self, status: int, body: bytes) -> SnapError: ...
    def is_rate_limited(self, status: int, body: bytes) -> bool: ...
    def authenticate(self) -> bool: ...   # explicit health check
```

`Result` is a small struct: `{ ok: bool, data: dict | list | None, error: SnapError | None }` — replaces today's mix of `sys.exit(1)` / raise / dict-with-error.

`SnapError` carries `category` (auth / rate-limit / not-found / server-error / network), `retryable: bool`, raw response. Hook callers (e.g. the pre-complete audit gate) get a single shape to handle, not 4.

## 4. Session-Capture Standard

Each adapter declares its capture mechanism via a `SessionCapture` enum:

| Type | Used by | How |
|---|---|---|
| `safari_binary_cookies` | PM | Parse `~/Library/Containers/com.apple.Safari/.../Cookies.binarycookies`. Code already at `snapcli/capture/safari.py`. |
| `header_dump` | AppFolio | Manual one-time browser-devtools capture saved to JSON. |
| `oauth_saved_tokens` | (future TenantTurner) | OAuth flow producing access+refresh, saved to JSON, refreshed on 401. |
| `localstorage_snapshot` | (future Monday-class onboarding tools) | Browser localStorage scrape for SPAs that put auth in JS state. |

The base class `SnapAdapter` ships a corresponding `Capturer` class per type:

```python
class SafariBinaryCookieCapturer:
    def capture(self, domain: str, output_path: str) -> bool: ...

class OAuthSavedTokenCapturer:
    def capture(self, oauth_config: OAuthConfig, output_path: str) -> bool: ...
    def refresh(self, refresh_token: str) -> dict: ...
```

Adapters declare which capturer they use; `snapcli capture <name>` invokes it. Today PM has its own capture script (`adapters/pm/scripts/pm-recapture-session-safari.py`); under the framework that becomes the default `snapcli pm capture` command.

## 5. Command-Surface Convention

All adapters use the shape `<vendor> <resource> <action>` (e.g. `snapcli pm work-orders complete`). Subcommands are nested Click groups; new commands are added by decorating functions in the adapter's `cli.py`:

```python
# adapters/tt/snapcli_tt/cli.py
@click.group()
def tt():
    """TenantTurner adapter."""

@tt.group()
def applications():
    """Tenant applications."""

@applications.command("list")
def list_applications():
    backend = TenantTurnerAdapter()
    output_json(backend.get("/api/applications/"))
```

The adapter's `setup.py`:

```python
entry_points={
    "snapcli.platforms": [
        "tt = snapcli_tt.cli:tt",
    ],
}
```

`pip install snapcli-tt` then `snapcli tt applications list` — zero changes to snapcli itself. Tested today: PM and AF both work this way (per `core/cli_anything/snapcli/cli.py` discovery loop).

## 6. Adapter Registry + Versioning

`snapcli list-adapters` outputs installed adapters with their versions and capture status:

```
snapcli list-adapters
  pm    (snapcli-pm 0.4.2)        session: valid (captured 2026-04-29)
  af    (snapcli-af 0.2.0)        session: stale (captured 2026-03-15) — re-run snapcli af capture
  tt    (snapcli-tt 0.1.0)        session: missing — run snapcli tt capture
```

**Multi-version coexistence:** `snapcli pm-v2 work-orders ...` is reserved for the day Property Meld ships an official API. Each adapter is its own pip package; multiple `pm-*` entry points coexist if installed.

**Compatibility guarantee:** snapcli core promises to keep the `SnapAdapter` interface stable across minor versions. Major version bumps may change the interface; adapters declare `min_snapcli_version` in their setup.py.

## 7. Per-Target Sketches

### TenantTurner
- Lead capture / showing scheduling / online application platform.
- Auth: OAuth (developer key + refresh token). Capture type: `oauth_saved_tokens`.
- Rate limit: per-app throttle (likely 60/min) — adapter sets `RateLimitPolicy.requests_per_min = 60`.
- Output format: REST JSON, no fancy normalization needed.

### LeadSimple
- Onboarding workflow tool, similar to TenantTurner space.
- Auth: API key in header. Capture type: `header_dump` (one-time generate-key, paste).
- Output: REST JSON.

### Monday-class onboarding tools
- Generic SaaS tools that have public/private API but uneven coverage.
- Auth: typically OAuth. Capture: `oauth_saved_tokens`.
- May require GraphQL — framework adds an optional `graphql(query, vars)` helper without forcing it on REST adapters.

For each, the per-adapter delta is: ~1 file `<name>_adapter.py` (subclass `SnapAdapter`, set base_url + capture type, override `is_rate_limited` if needed) + ~1 file `cli.py` (Click commands using the adapter). Target: ≤300 LOC total per adapter for a basic 5-resource surface.

## 8. Migration

1. **Resolve namespace collision (must come first):** rename `cli-anything-propertymeld` (live) to `snapcli-pm`, change package directory from `cli_anything/propertymeld/` to `snapcli_pm/`. Update `pm` console-script entry point. Once: nuke `cli-anything-snapcli/adapters/pm/cli_anything/propertymeld/` (the duplicate copy that confused us yesterday). Ship as one big bump from snapcli-pm 0.3 → 1.0.
2. **Same for AppFolio:** `cli-anything-appfolio` → `snapcli-af`, package `snapcli_af/`.
3. **Land expanded `SnapAdapter`:** add `patch/put/delete`, `Result`/`SnapError`, `RateLimitPolicy`, `CsrfStrategy`. PM adapter's `_http_get/post/patch` helpers delete; backend methods inherit from `SnapAdapter`.
4. **Move PM session-capture into `snapcli pm capture`** — replaces the current ad-hoc `adapters/pm/scripts/pm-recapture-session-*.py` scripts.
5. **Document the framework in `cli-anything-snapcli/docs/adapter-howto.md`** with the TenantTurner sketch as the worked example. Include "minimum viable adapter" checklist.
6. **First new adapter (TenantTurner) is the proof.** If it lands in ≤1 day, framework wins. If it takes longer, framework needs more work before declaring success.

Rollback for the namespace rename: re-publish the old `cli-anything-propertymeld` shim that just re-imports `snapcli_pm`. Keeps existing `from cli_anything.propertymeld import ...` calls working for one quarter.

## 9. Open Questions for David

1. **Repo layout** — keep adapters as separate pip packages (`snapcli-pm`, `snapcli-af`, `snapcli-tt`) for independent versioning, or consolidate into the snapcli monorepo with subpackages? Independent = better release cadence; monorepo = easier framework-wide refactors.
   - **ANSWERED [D2]: SEPARATE pip packages per adapter — David 2026-04-29** (Dane recommendation, agree all batch). Each adapter its own repo with independent versioning + deprecation cycle. Reasoning: tight coupling cost in monorepo > duplicated release cost in separate; cleaner future adapter additions. See `decisions-log.md` D2.
2. **Namespace rename** — is renaming `cli-anything-propertymeld` → `snapcli-pm` worth the disruption? Pros: kills the collision permanently. Cons: every script/agent calling `from cli_anything.propertymeld...` breaks; need a deprecation period.
   - **ANSWERED [D1]: APPROVED — David 2026-04-29** (Dane recommendation, agree all batch). cli-anything-propertymeld → snapcli-pm + 1-quarter shim for old callers. Reasoning: S303 collision documented overnight; rename plan §0 cited; reversibility via git revert. Execute Thursday Codex per `rfc-snapcli-rename-execution-plan.md`. See `decisions-log.md` D1.
3. **Async/await migration** — defer (this RFC keeps urllib sync) or batch with the framework rewrite? Argues defer.
4. **GraphQL helper** — add `graphql()` to base `SnapAdapter` now, or wait for the first adapter that genuinely needs it (Monday)? Lean wait.
5. **TenantTurner first or LeadSimple first?** Proof-of-framework target. Recommend TenantTurner — David already uses it; LeadSimple may not be in flight.

# `gws` CLI Authentication — onboarding + reference

**Audience:** Dane, Collie, Aussie, Blue (any agent that needs Gmail / Calendar / Drive / Docs access)
**Source:** ad-hoc; supersedes claude.ai Gmail/Calendar/Drive MCPs per RFC #9 (orgs/ascendops/docs/rfc-mcp-vs-cli-audit.md)
**Last updated:** 2026-04-29

---

## 1. Why `gws` (not the claude.ai MCPs)

Per `feedback_google_workspace_cli.md` (David explicit, multiple corrections): use `gws` CLI for any email/calendar/drive operation, never `gog`, never the Gmail MCP. RFC #9 §3.4 verdict on the claude.ai Gmail/Calendar/Drive MCPs: **REPLACE-WITH-CLI** — they're flaky-disconnecting AND they tax every turn with ~800-4000 tokens of tool schema overhead, regardless of actual use. `gws` is zero-schema (Bash CLI) and outputs trimmable text.

The CLI is `googleworkspace/cli` (`gws` binary). **Not officially supported by Google** — community-maintained — but it's the canonical surface in this fleet.

## 2. First-Time Auth Setup

The auth dance happens once per machine; agents inherit the credentials via `~/.config/gws/`. If `gws auth status` returns `encrypted_credentials_exists: true`, you're done — skip to §6.

```bash
# (a) Check current state
gws auth status

# (b) If not authenticated: log in (opens a browser tab to Google's consent screen)
gws auth login                        # default scopes (Gmail/Calendar/Drive/Docs/Sheets read+write)
gws auth login --readonly             # read-only across all services
gws auth login --full                 # all scopes incl. pubsub + cloud-platform (may trigger restricted_client warning for unverified apps)
gws auth login --scopes "https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar"  # custom subset
gws auth login -s drive,gmail,sheets  # limit the scope picker to these services only

# (c) If you don't have a client_secret.json yet, create one via gcloud first
gws auth setup --project <YOUR_GCP_PROJECT_ID>   # requires gcloud CLI on PATH
```

`gws auth login` opens the system default browser. Follow the Google consent flow with `david@noogalabs.com`. The browser will redirect back to `localhost:<random>` and the CLI captures the OAuth code automatically.

## 3. Token Storage + Refresh Behavior

Files in `~/.config/gws/`:

| File | Purpose |
|---|---|
| `client_secret.json` | OAuth client config (created by `gws auth setup` or copied from GCP Console) |
| `credentials.enc` | Encrypted refresh token + access token |
| `.encryption_key` | Key used to encrypt the credentials blob |
| `token_cache.json` | In-memory access-token cache (auto-managed) |
| `cache/` | Per-API response cache (transparent) |

**Refresh:** the CLI auto-refreshes the access token using the stored refresh token. No manual intervention. If the refresh token is revoked (account-wide logout, app removed from Google account, password change), the next call returns `auth_required` and you must `gws auth login` again.

**Cross-machine portability:** copying `~/.config/gws/` to another machine works as long as the `client_secret.json` is valid for that account. The encryption key is per-machine but the entire `.config/gws/` dir together is portable. **Do NOT commit any of these files to git.**

**Override via env vars** (highest priority — useful for ephemeral CI / agent contexts):

```bash
GOOGLE_WORKSPACE_CLI_TOKEN=<access_token>             # pre-obtained OAuth2 token, skips refresh
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/path/to/cred   # alternate credentials path
GOOGLE_WORKSPACE_CLI_CLIENT_ID=<id>                   # for fresh login
GOOGLE_WORKSPACE_CLI_CLIENT_SECRET=<secret>           # for fresh login
GOOGLE_WORKSPACE_CLI_CONFIG_DIR=/path/to/dir          # override default ~/.config/gws/
```

## 4. Multi-Account / Per-Org Selection

Each `~/.config/gws/` dir holds **one account**. To switch accounts on the same machine:

- Set `GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gws-orgB` then run `gws auth login` for org B.
- Wrap commands: `GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gws-orgB gws gmail users messages list ...`.
- Today the fleet uses one account (`david@noogalabs.com`), so this is a forward-compat note — not currently in use.

## 5. Common Errors + Fixes

| Symptom | Cause | Fix |
|---|---|---|
| `auth_required` | refresh token revoked | `gws auth login` |
| `insufficient permissions` / `403` on a specific endpoint | scope missing | `gws auth login --scopes "<comma-list>"` to add the needed scope |
| `restricted_client` warning during `--full` consent | OAuth app not verified for this scope set | acknowledge the consent screen warning OR use narrower `--scopes` |
| `client_secret.json missing` | first-time on a new machine | `gws auth setup --project <gcp_project>` (requires gcloud) OR copy `client_secret.json` from another configured machine |
| `account mismatch` | multiple Google accounts in the browser | log out of other accounts first, or use an Incognito window for the OAuth dance |
| Token cache stale after manual creds edit | `~/.config/gws/token_cache.json` out of sync | `rm ~/.config/gws/token_cache.json` (safe — auto-recreated) |
| `command not found: gws` | binary not on PATH | install via `brew install googleworkspace/cli/gws` (or whatever path is in `which gws`); verify with `which gws` |

## 6. Quick-Reference Cheatsheet (top 10 commands actually used in this fleet)

Existing per-skill SKILL.md files in `agents/dane/.claude/skills/gws-*/` cover detailed patterns. These are the high-frequency commands:

```bash
# ───── Gmail ────────────────────────────────────────────────────────
gws gmail users messages list --params '{"userId":"me","q":"is:unread"}'           # list unread
gws gmail users messages get  --params '{"userId":"me","id":"<ID>","format":"full"}' --format json
gws gmail users messages modify --params '{"userId":"me","id":"<ID>"}' \
  --json '{"removeLabelIds":["UNREAD"]}'                                            # mark read
gws gmail users messages send --json '{"raw":"<base64-MIME>"}'                      # send (David approval first)

# ───── Calendar ─────────────────────────────────────────────────────
gws calendar events list --params '{"calendarId":"primary","timeMin":"2026-04-29T00:00:00Z"}'
gws calendar events insert --json '{...event body...}'                              # create event

# ───── Drive ────────────────────────────────────────────────────────
gws drive files list --params '{"pageSize":10,"q":"name contains '\''invoice'\''"}'
gws drive files get  --params '{"fileId":"<ID>"}'
gws drive files create --json '{"name":"foo.pdf","parents":["<folderId>"]}' --upload /tmp/foo.pdf

# ───── Schema introspection (when you forget params) ────────────────
gws schema gmail.users.messages.list                                                # raw API schema
```

For the per-service skill files, see:

| Skill | Path |
|---|---|
| Gmail triage | `agents/dane/.claude/skills/gws-gmail-triage/SKILL.md` |
| Gmail watch (NDJSON stream) | `agents/dane/.claude/skills/gws-gmail-watch/SKILL.md` |
| Drive upload | `agents/dane/.claude/skills/gws-drive-upload/SKILL.md` |
| Calendar agenda | `agents/dane/.claude/skills/gws-calendar-agenda/SKILL.md` |
| Workflow (cross-service) | `agents/dane/.claude/skills/gws-workflow/SKILL.md` |
| Shared auth/format helpers | `agents/dane/.claude/skills/gws-shared/SKILL.md` |

When a skill file disagrees with this doc on auth setup, this doc wins (skills are usage-pattern specific; auth is shared).

---

**Verification:** `gws auth status` should return `encryption_valid: true` and a non-empty `client_id` if you're set up correctly. Tested working in this fleet 2026-04-29.

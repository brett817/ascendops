# Environment Files Map

This repo uses a few different environment-style files. They do different jobs.
Most people only need the first three rows below.

| File | What it controls | Required or optional | Usually set by |
|---|---|---|---|
| `.env` | Local framework instance ID for this checkout | Required once per checkout | `cortextos init` |
| `dashboard/.env.local` | Dashboard login, NextAuth, and local dashboard settings | Required if you use the dashboard | `/onboarding` |
| `orgs/<org>/secrets.env` | Org-wide shared keys such as `GEMINI_API_KEY` | Required for Knowledge Base features | `/onboarding` Phase 6 |
| `orgs/<org>/activity-channel.env` | Dedicated activity-log bot and chat for fleet-wide logging | Optional | manual setup using `templates/org/activity-channel.env.example` |
| `orgs/<org>/agents/<agent>/.env` | Per-agent Telegram bot and agent-specific overrides | Required for Telegram-controlled agents | `/onboarding` or `cortextos add-agent` |
| `~/.cortextos/<instance>/dashboard.env` | Local backup copy of dashboard credentials | Internal runtime file | dashboard setup flow |

Example files in the repo:

- `dashboard/.env.example`
- `templates/agent/.env.example`
- `templates/agent-codex/.env.example`
- `templates/property-management/agent/.env.example`
- `templates/org/secrets.env.example`
- `templates/org/activity-channel.env.example`

Rules:

- Do not commit populated `.env`, `.env.local`, or `secrets.env` files.
- Treat `orgs/<org>/secrets.env` as shared org configuration, not as a place to store per-agent Telegram bot tokens.
- If you are unsure where a key belongs, start with the agent-specific `.env` for one-agent-only behavior and `orgs/<org>/secrets.env` for keys multiple agents share.

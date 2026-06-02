<div align="center">

# AscendOps

**Persistent 24/7 Claude Code agents you control from Telegram.**

[Quick Start](#-quick-start) · [Architecture](#%EF%B8%8F-architecture) · [Templates](#-templates) · [Roadmap](#%EF%B8%8F-roadmap)

[![tests](https://img.shields.io/badge/tests-917%20passing-success)](.) [![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE) [![Node](https://img.shields.io/badge/node-20%2B-43853d)](https://nodejs.org) [![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-d97757)](https://docs.anthropic.com/en/docs/claude-code)

</div>

> **Who this is for:** Property management operators (single-owner, small team, or growing portfolio) who want AI agents handling work-order triage, vendor dispatch, leasing pipeline, and resident comms — running on your Mac mini or Linux box, controlled from Telegram. Skool community install path takes ~30 minutes.
>
> **Self-hosted by design:** AscendOps runs on your Mac mini, Linux VPS, or Windows machine. Your data, credentials, and Slack tokens never touch our infrastructure — there is no managed SaaS tier and never will be.

---

## What it is

AscendOps runs Claude Code as a fleet of persistent agents — 24/7, multi-agent, controlled from Telegram. Each agent has its own role (orchestrator, analyst, specialist), shared state via a file bus, and survives crashes + 71-hour Claude session boundaries automatically.

Think: *Claude Code, but as your team — not a tool you open.*

```
Telegram chat

You:    Morning. What did you ship overnight?
Boss:   Overnight recap: completed 4 tasks, ran 2 theta-wave
        experiments, drafted 3 content scripts. One item needs
        your approval — email the beta waitlist.

You:     approve
Boss:    Sent. Email delivered to 47 recipients. Task closed.

You:     Add a cron to check my inbox every morning at 8am.
Boss:    Done. "morning-inbox" cron set — runs daily at 08:00.
         Saved to crons.json — survives restarts automatically.
```

---

## Why AscendOps

You already use Claude Code as a developer. AscendOps is what happens when you turn it into infrastructure: agents that run while you sleep, coordinate with each other, and surface decisions to you on your schedule, not theirs.

Built for:
- **Operators** running real businesses who need agents, not chatbots.
- **Builders** experimenting with multi-agent patterns at scale.
- **Property managers** specifically — AscendOps ships with PropertyMeld + AppFolio adapters out of the box.

Not built for:
- Single-prompt automations — use the Claude API directly.
- Cloud-only deployments — AscendOps is self-hosted by design. Runs on your Mac mini, Linux VPS, or Windows machine. There is no managed SaaS tier.

---

## Features

- 🤖 **Persistent agents** — Claude Code runs 24/7 in PTY sessions, auto-restarting on crash or after 71-hour context rotation.
- 🔀 **Multi-agent orchestration** — orchestrator, analyst, and specialist agents coordinate via a shared file bus. Tasks, blockers, and approvals flow automatically.
- 📱 **Telegram + iOS control** — send commands, approve actions, get reports from anywhere.
- 🌐 **Multi-runtime** — run agents on `claude-code` (default), OpenAI's `codex-app-server`, or Hermes. All runtimes share the same bus, crons, dashboard, and Telegram integration; pick per-agent.
- 🪝 **Hook framework** — fire-block-escalate event pipeline for custom routing and telemetry.
- 🌙 **Autoresearch (theta wave)** — agents run autonomous experiments overnight and surface findings for your morning review.
- 📊 **Web dashboard** — Next.js UI for tasks, approvals, experiments, and fleet health.

---

## 🏗️ Architecture

```mermaid
flowchart TB
    Operator[PM Operator]
    Telegram[Telegram]
    Daemon[AscendOps Daemon]
    MD[Maintenance Director]
    LC[Leasing Coordinator]
    PM[Property Meld]
    Vendors[Vendors]
    Residents[Residents]

    Operator <--> Telegram
    Telegram <--> Daemon
    Daemon --> MD
    Daemon --> LC
    MD --> PM
    LC --> PM
    PM --> Vendors
    PM --> Residents
```

Every agent is its own PTY-spawned Claude / Codex / Gemini process. The daemon handles spawn, restart, and heartbeat health. Inter-agent communication runs over a file-based bus — no network, no broker. Hooks fire on bus events for custom routing and observability.

---

## 🚀 Quick Start

> `git clone` → `npm install` → `npm run build` → init org → add 2 persona agents → start daemon → message your agents on Telegram. ~30 min total if accounts are ready.

**Prereqs:** Node.js 20+, Claude Code CLI authenticated, Telegram bot token from @BotFather.

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/noogalabs/ascendops-install/main/install.mjs | node

# Open in Claude Code + run guided onboarding
claude ~/ascendops
> /onboarding
```

`/onboarding` handles dependency checks, org setup, bot creation, PM2 config, and dashboard launch. Your Orchestrator comes online in Telegram and finishes its own setup there.

### Skool members — start here

If you joined via the Skool community and want the two reference personas (Maintenance Director + Leasing Coordinator) running in 30 minutes, follow [SKOOL-INSTALL.md](./SKOOL-INSTALL.md) instead of the install script above. It's a linear happy-path guide with all credentials pre-listed.

More setup details in [CONTRIBUTING.md](./CONTRIBUTING.md) and the environment variable reference in [README.envs.md](./README.envs.md).

---

## 👥 Templates

| Template | Best for |
|---|---|
| `orchestrator` | Your "boss" agent. Coordinates the fleet, runs morning + evening reviews, gates approvals. |
| `analyst` | System health, metrics, theta-wave autoresearch. |
| `agent` | General-purpose worker. Base for specialist agents. |
| `agent-codex` | Codex-runtime worker, scaffolds with `runtime: codex-app-server` and `model: gpt-5-codex` (see `templates/agent-codex/`) |
| `agent-maintenance-director` | PM persona — work-order triage, vendor dispatch coordination, resident comms, follow-up tracking. Shipped with the Skool release. |
| `agent-leasing-coordinator` | PM persona — prospect intake, showings, applications, lease docs, move-in coordination. Shipped with the Skool release. |
| `property-management/agent` | Pre-configured for PropertyMeld + maintenance ops. |

Add a codex agent the same way you add a claude agent:

```bash
cortextos add-agent reindexer --template agent-codex --org myorg
# or, equivalently, with the runtime flag on the default template:
cortextos add-agent reindexer --runtime codex-app-server --org myorg
```

Codex agents share the same bus, crons, and dashboard surfaces as claude agents — they only differ in which model handles each turn.

### The `runtime` field

Every agent's `config.json` carries an explicit `runtime` field that the daemon dispatches on. Valid values:

| Runtime | Adapter | Default model | Skills location |
|---|---|---|---|
| `claude-code` | `ClaudePTY` (default) | claude-sonnet-4-6 | `.claude/skills/<skill>/SKILL.md` |
| `codex-app-server` | `CodexAppServerPTY` | `gpt-5-codex` | `plugins/cortextos-agent-skills/skills/<skill>/SKILL.md` (linked into `~/.codex/skills/<agent>__<skill>`) |
| `hermes` | `HermesPTY` (experimental) | model per `config.json` | hermes-specific |

Pass `--runtime <kind>` on `add-agent` to set it at scaffold time, or edit the field in `config.json` and restart the agent. The default is `claude-code`. Today only `--template agent` (and the alias `--template agent-codex`) supports `--runtime codex-app-server` — pairing the codex runtime with `--template orchestrator`/`analyst`/`m2c1-worker`/`hermes` errors with a clean message until codex variants of those templates ship.

---

## CLI

```bash
cortextos install            # set up state directories
cortextos init <org>         # create an organization
cortextos add-agent <name>   # add an agent (--template, --org, --runtime)
cortextos enable <name>      # enable agent in daemon
cortextos ecosystem          # generate PM2 config
cortextos status             # fleet health
cortextos doctor             # check prerequisites
cortextos list-agents        # list agents
cortextos dashboard          # start web dashboard (--port 3000)
```

Run `cortextos --help` for the full CLI surface.

---

## Security

Every external action (email, deploy, delete, financial) requires explicit human approval. The guardrails system is self-improving: agents log near-misses and extend `GUARDRAILS.md` each session. Report vulnerabilities by opening a private security advisory on this repo.

---

## 🗺️ Roadmap

**Just shipped:**
- Maintenance Director + Leasing Coordinator persona templates
- Property Meld integration (read + write via Nexus API)
- Skool community install path (this README + SKOOL-INSTALL.md)
- Telnyx SMS layer with credential abstraction (no hardcoded numbers; pulls from your local creds file)
- Slack integration + human-team-member roster (route work to teammates by Slack handle alongside agent personas)
- Tirith post-install security layer pointer

**In flight (next ~30 days):**
- Business profile wizard — guided onboarding to wire your company, vendors, properties, comms style into a fresh install
- Owner Comms persona template
- Vendor Manager persona template
- Dashboard polish for operators

**Longer horizon:**
- Additional PM software bindings beyond Property Meld (AppFolio, Buildium, Rentvine, Rent Manager — order driven by community demand)
- Telnyx Voice AI agent for inbound vendor + tenant calls

---

## 🤝 Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup + code style. Framework-level patches go upstream to [grandamenium/cortextos](https://github.com/grandamenium/cortextos); AscendOps-specific patterns stay in this fork.

---

## 📜 License

MIT — see [LICENSE](./LICENSE).

---

<div align="center">

Built on [cortextos](https://github.com/grandamenium/cortextos) by James (grandamenium). AscendOps adds property management integrations, agent templates, and operational tooling.

</div>

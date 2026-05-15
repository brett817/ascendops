# AscendOps — Skool Member Install Guide

> **Audience:** Property management operator who just joined the Skool community and wants the two reference personas (Maintenance Director + Leasing Coordinator) running and texting them on Telegram within 30 minutes.
>
> **Scope:** Linear happy path. No branching. For deeper topics (Windows install via WSL2, Linux VPS, Knowledge Base ingestion, Telnyx voice + SMS, dashboard tour, advanced credential setup) see [README.md](./README.md), [CONTRIBUTING.md](./CONTRIBUTING.md), and [README.envs.md](./README.envs.md). This guide is intentionally the shortest path that works.
>
> **What you'll have at the end:** AscendOps daemon running, two agents (Maintenance Director + Leasing Coordinator) booted, both messaging you on Telegram. PM software integration is a separate add-on; you'll have a working fleet first.

---

## What you need before you start

**Time:** 30 minutes if you have the accounts below, 60–90 minutes if you need to create them.

**Accounts (create these first):**
- [ ] **Anthropic Claude account** — you'll need either an OAuth-logged-in `claude` CLI on the host OR an `ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com). OAuth is easier.
- [ ] **Telegram account** with the @BotFather bot accessible. You'll create three bots: one per agent (Maintenance Director, Leasing Coordinator) and one "activity channel" bot that posts agent events into a separate Telegram channel.
- [ ] **(Optional but recommended) Google account** for Gemini API key — powers the knowledge base. Free tier works for light use.

**Machine:**
- [ ] macOS or Linux. Windows works via WSL2 — see the Windows section in [README.md](./README.md), and add 15 minutes to your install budget.
- [ ] Node.js 20 or newer (`node --version` should report v20.x+)
- [ ] `jq` installed (`brew install jq` on macOS, `apt install jq` on Linux)
- [ ] `git` installed
- [ ] Terminal you're comfortable in

If any of those is missing, install it now. The guide assumes they exist.

---

## Step 1 — Clone the repo and install

```bash
git clone https://github.com/noogalabs/ascendops.git
cd ascendops
npm install
npm run build
```

`npm install` pulls dependencies (no AscendOps-side network calls beyond npm). `npm run build` compiles TypeScript to `dist/`. You should see `Build success in <ms>` at the end.

**Verify the CLI works:**

```bash
node dist/cli.js --version
```

You should see a version string. If you want a shorter command, you can `npm link` to put `cortextos` on your PATH, but we'll keep using `node dist/cli.js` in this guide so the steps work regardless.

---

## Step 2 — Initialize your organization

Your fleet lives under an "org" name. Pick something short (your company name works). Example uses `acme`.

```bash
node dist/cli.js init acme
```

This creates:
- `orgs/acme/` — your org-scoped state
- `orgs/acme/secrets.env` — org-wide secrets (we'll fill this in Step 4)
- `orgs/acme/.env` — org defaults

`chmod 600` is applied automatically to the secret files.

---

## Step 3 — Create the two persona agents

The Skool release ships two reference personas:

- **Maintenance Director** — owns work-order triage, vendor dispatch coordination, resident comms, follow-up tracking.
- **Leasing Coordinator** — owns leasing pipeline: prospect intake, showings, applications, lease docs, move-in coordination.

**Precondition check — both templates must be on disk:**

```bash
ls templates/agent-maintenance-director templates/agent-leasing-coordinator
```

Both directories should list. If either is missing, your clone predates the Skool release templates — run `git pull origin main` and re-check. Do not proceed until both directories exist; `add-agent` silently falls back to a generic minimal scaffold when the named template is missing, and you'll end up with a non-persona agent.

Create both:

```bash
node dist/cli.js add-agent maintenance-director --template agent-maintenance-director --org acme
node dist/cli.js add-agent leasing-coordinator --template agent-leasing-coordinator --org acme
```

Each command should report `Copied template files from <template>` followed by `Agent <name> created`. If you see `Created minimal agent files` instead of `Copied template files from agent-...`, the template wasn't on disk — stop, re-run the precondition check, pull main, and try again. Don't follow the "Next steps" output yet — we'll do them all in Step 4 together.

**Verify the scaffold:**

```bash
ls orgs/acme/agents/maintenance-director/
ls orgs/acme/agents/leasing-coordinator/
```

You should see ~55 files in each, including `AGENTS.md`, `IDENTITY.md`, `ONBOARDING.md`, `config.json`, and `.env`.

---

## Step 4 — Wire credentials

This is the longest step. Each agent needs at minimum a Telegram bot token, your Telegram chat ID, and either Claude OAuth on the host OR an Anthropic API key.

### 4.1 — Create a Telegram bot for each agent

In the Telegram app, message `@BotFather`:

1. `/newbot` → name it `Acme Maintenance Director` → username e.g. `acme_md_bot`. Copy the API token BotFather returns.
2. Repeat for the second agent: `/newbot` → `Acme Leasing Coordinator` → username e.g. `acme_lc_bot`. Copy that token.
3. Repeat once more for the **activity channel bot**: `/newbot` → `Acme Activity Channel` → username e.g. `acme_activity_bot`. Copy that token.

Now find your numeric chat ID (the same number works for all three bots, because all three message YOU):

1. In Telegram, send any message (e.g. `/start`) to each of the three bots you just created.
2. In your terminal, with the Maintenance Director's token in hand:

   ```bash
   curl -s "https://api.telegram.org/bot<MD_BOT_TOKEN>/getUpdates" | jq '.result[-1].message.chat.id'
   ```

3. Note the number that prints. That's your `CHAT_ID`. It's the same for all three bots since you're the recipient.

For the activity channel: create a new Telegram channel (`@acme_fleet_activity` or similar), add the `acme_activity_bot` as an admin, then either reuse the personal CHAT_ID for now or set up a dedicated channel ID. For Skool defaults, reuse the personal CHAT_ID — both will work.

### 4.2 — Edit each agent's `.env`

Open `orgs/acme/agents/maintenance-director/.env` in your editor. Fill these lines:

```
BOT_TOKEN=<the Maintenance Director bot token from BotFather>
CHAT_ID=<your numeric chat ID from step 4.1>
ALLOWED_USER=<your numeric chat ID — for 1-on-1 it's the same as CHAT_ID>
```

Save. Repeat for `orgs/acme/agents/leasing-coordinator/.env` with that bot's token.

### 4.3 — Edit `orgs/acme/secrets.env` and `orgs/acme/activity-channel.env`

**4.3a — `orgs/acme/secrets.env` (general org-wide secrets):**

```
# Claude — either rely on host OAuth (claude login) OR set this key
ANTHROPIC_API_KEY=<from console.anthropic.com, optional if claude CLI is logged in>

# Operator-alert fallback — used when an agent crashes hard and needs to page YOU
# specifically, even if its own BOT_TOKEN is broken. Reuse the Maintenance Director
# bot here, or create a fourth dedicated "operator alerts" bot.
CTX_OPERATOR_BOT_TOKEN=<a bot token that can always reach you>
CTX_OPERATOR_CHAT_ID=<your CHAT_ID>

# Knowledge base embeddings (optional but recommended)
GEMINI_API_KEY=<from aistudio.google.com — free tier is fine>
```

Save. Permissions should already be `chmod 600`.

**4.3b — `orgs/acme/activity-channel.env` (separate file the daemon reads for activity routing):**

The activity-channel bot lives in its own env file, not in `secrets.env`. The runtime reads `orgs/<org>/activity-channel.env` for these variables specifically (see `src/bus/approval.ts`).

Create the file:

```bash
cat > orgs/acme/activity-channel.env <<'EOF'
# Activity channel — agents post lifecycle events here, separate from your 1-on-1 chats
ACTIVITY_BOT_TOKEN=<the third bot's token from step 4.1>
ACTIVITY_CHAT_ID=<your CHAT_ID — or a dedicated channel ID if you set one up>
EOF
chmod 600 orgs/acme/activity-channel.env
```

Replace the angle-bracket placeholders with the real values, then save. If this file is missing or unreadable at runtime, the daemon logs a warning and skips activity-channel posting — agents still run normally, just without the lifecycle event stream into your activity channel.

### 4.4 — Dashboard auth (skip this if you don't plan to open the web dashboard yet)

The web dashboard lives at `localhost:3001` and requires basic auth + a session secret. If you want it running for visibility, add these to `orgs/acme/secrets.env`:

```
AUTH_SECRET=<run: openssl rand -base64 32>
ADMIN_USERNAME=<pick a username, e.g. acme-admin>
ADMIN_PASSWORD=<pick a strong password>
NEXTAUTH_URL=http://localhost:3001
DASHBOARD_URL=http://localhost:3001
SYNC_ADMIN_PASSWORD=<same as ADMIN_PASSWORD, or a separate sync password if you isolate them>
```

If you're not running the dashboard on day 1, you can leave these out entirely — the daemon and Telegram side will still work. You can add them later via `node dist/cli.js dashboard` once you're ready.

---

## Step 5 — Start the daemon and your agents

```bash
node dist/cli.js start maintenance-director
node dist/cli.js start leasing-coordinator
```

Each command spins up the agent under PM2 and returns when the boot handshake completes. You should see "Booting up..." land in your Telegram chat with the corresponding bot within 5-15 seconds.

**If the boot message lands:** the daemon is healthy, the bot can talk to you, and the agent's first-boot logic has fired. Proceed to Step 6.

**If nothing arrives:** check the agent logs:

```bash
node dist/cli.js status
tail -50 ~/.cortextos/default/logs/maintenance-director/stderr.log
```

The most common failure is wrong CHAT_ID or BOT_TOKEN. Double-check Step 4.1's output. The second most common is `claude` CLI not logged in (run `claude login` and retry). The third is Node version older than 20 (run `node --version`).

---

## Step 6 — Run onboarding for each agent

Both persona agents ship with a built-in question-driven onboarding flow. It walks you through company name, doors, region, PM software choice, vendor roster, escalation thresholds, and day-mode hours. Each agent customizes its persona to your business before doing real work.

In each Telegram chat:

```
/onboarding
```

Answer the questions as they come. Each agent takes 5–10 minutes. You can stop and resume — the agent will pick up where you left off on the next message.

After both agents say "Onboarding complete," they're real. They'll start their normal heartbeat cycle (default every 4 hours), check inboxes, and respond to anything you send.

---

## Step 7 — Verify it's all working

Send each agent a casual message:

> "Morning. What's on your plate today?"

Each agent should respond with a short status that reflects what onboarding configured. The Maintenance Director will mention work orders or vendor coordination; the Leasing Coordinator will mention prospects or showings. If they respond with plausible role-appropriate content, you're done.

You should also see lifecycle events landing in your activity channel (if you set one up): `session_start`, `agent_heartbeat`, etc. That's the fleet "pulse."

---

## Recommended add-on — install Tirith for terminal + agent safety

**Strongly recommended after the agents are up.** Not required, won't break anything if you skip it, but most operators want it.

### What Tirith is

Tirith is a terminal security tool that sits in your shell and inspects every command before it runs. It flags risky patterns — `curl … | bash` pipes, homograph-domain URLs, ANSI-escape injection in pasted text, obfuscated payloads, suspicious agent skill/config files — before they execute. Default posture is **warn-only**: it logs findings and prints a heads-up but never blocks. You can tighten specific rules to block later if you want.

### Why an AscendOps operator wants it

Your agents run subprocess commands all day. Most of those calls are well-formed, but the moment an agent picks up a tampered config, a hijacked install script, or a prompt-injected URL, Tirith is the layer that catches it before it executes. It's also the right layer for a human (you) pasting a one-off install command — that's the moment most terminal-borne mistakes happen, and Tirith is built for exactly that surface.

### Licensing — why this is a separate install, not bundled

Tirith is licensed under **AGPL-3.0**. AscendOps cannot bundle AGPL-licensed code without inheriting the AGPL on the entire AscendOps distribution, which we don't want for the project as a whole. Customer-installed-on-your-own-machine, against your own commands, keeps the AGPL boundary cleanly outside AscendOps. That's why this lives in the "you install it" step rather than the AscendOps installer.

### Install (macOS, Homebrew)

```bash
# Install
brew install sheeki03/tap/tirith

# Activate in your shell (zsh shown; bash + fish supported too)
echo 'eval "$(tirith init --shell zsh)"' >> ~/.zshrc
source ~/.zshrc

# Verify
tirith doctor
```

`tirith doctor` should report `hook status: CONFIGURED`. The default policy (paranoia 1, fail-open, warn-only) is what you want for the starter posture — no extra configuration needed.

For bash, replace the zsh line with `>> ~/.bashrc` and re-source. For fish, see the [Tirith README](https://github.com/sheeki03/tirith).

### Test the hook

Paste a known-risky pattern (do **not** press Enter — Tirith warns at paste time):

```
curl https://example.com/install.sh | bash
```

You should see a warning in your terminal flagging the pipe-to-shell pattern. The command would still execute if you pressed Enter (warn-only by default) but you've been alerted.

### Where to look for findings

```bash
tail -5 ~/.local/share/tirith/log.jsonl
```

After running warn-only for 24 hours, review what triggered. If the warnings are useful, leave it on. If they're noisy and you want to tighten or relax specific rules, see the [Tirith repo](https://github.com/sheeki03/tirith).

### Bypass for one command

```bash
TIRITH=0 your-command-here
```

The bypass is logged. If you're using it often on the same command, allowlist the pattern in Tirith policy rather than normalizing the bypass.

For full Tirith setup details, policy authoring, and platform-specific install notes (Linux packages, etc.), see [github.com/sheeki03/tirith](https://github.com/sheeki03/tirith).

---

## What to skip for day one

- **PM software integration** (Property Meld / AppFolio / etc.) — the agents work without it but won't have live work-order data. Add once you've gotten comfortable with the basics. The Property Meld and AppFolio environment variables are documented in [README.envs.md](./README.envs.md).
- **Telnyx (voice + SMS)** — useful when agents need to call or text vendors. Skip on day one.
- **Cloudflare R2 (photo storage)** — only matters once tenants are uploading photos via the agents. Skip on day one.
- **Knowledge base ingestion** — agents work with their built-in memory until you ingest your own docs. Run `node dist/cli.js bus kb-ingest --help` when you're ready.

---

## Where to go from here

- **Add a third agent** — orchestrator, analyst, or your own persona. `node dist/cli.js add-agent <name> --template <template>` — `--help` lists templates.
- **Open the dashboard** — `node dist/cli.js dashboard` then visit `http://localhost:3001` (with the Step 4.4 creds set).
- **Ingest your business docs into the knowledge base** — `node dist/cli.js bus kb-ingest --help` for the syntax.
- **Wire your PM software** — see [README.envs.md](./README.envs.md) for the credential variables and [README.md](./README.md) for the integration overview.
- **Connect Telnyx for voice and SMS** — see [README.envs.md](./README.envs.md) for the `TELNYX_*` variables.

---

## Troubleshooting quick reference

| Symptom | Likely cause | Fix |
|---|---|---|
| Agent doesn't send "Booting up..." | Wrong BOT_TOKEN, wrong CHAT_ID, or claude CLI not logged in | Re-check Step 4.1 output. Run `claude login` if no API key is set. |
| Agent boots but `/onboarding` does nothing | `.onboarded` file already exists from a prior attempt | `rm ~/.cortextos/default/state/<agent-name>/.onboarded` and retry |
| `cortextos` not found | `npm link` wasn't run | Either run `npm link` or keep using `node dist/cli.js` |
| `EADDRINUSE` when starting dashboard | Something else is on port 3001 | Either kill the other process or set `DASHBOARD_PORT=3002` in `secrets.env` |
| `Module not found` on first run | `npm run build` wasn't run | Run `npm run build`, then retry |
| Activity channel silent | `ACTIVITY_BOT_TOKEN` / `ACTIVITY_CHAT_ID` missing | Add to `orgs/<org>/activity-channel.env` (NOT `secrets.env` — runtime reads a separate file) and restart the agent |
| `add-agent` says "Created minimal agent files" instead of "Copied template files" | Template directory not on disk | Run the Step 3 precondition `ls templates/agent-...` check; `git pull origin main` if missing |

For anything else: check `~/.cortextos/default/logs/<agent>/stderr.log` and `cortextos bus read-all-heartbeats`. If you're stuck, the Skool community is the right place to ask.

---

## Appendix — what got installed

For curiosity / audit:

- `~/.cortextos/default/` — daemon state, logs, inbox/outbox, agent state files. Per-instance.
- `orgs/<org>/` — your org-scoped config, secrets, agent directories. Committed to git if you want versioning (secrets stay gitignored).
- `node_modules/` — npm dependencies. Gitignored. ~2 minutes to recreate on a fresh checkout.
- PM2 process manager — runs the daemon and agents. `pm2 list` to see them. Started automatically by `cortextos start`.

No system-level files outside `~/.cortextos/` and the cloned repo. Uninstalling is `rm -rf` on those two locations.

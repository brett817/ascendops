# AscendOps — Skool Member Install Guide

> **Audience:** Property management operator who just joined the Skool community and wants the two reference personas (Maintenance Director + Leasing Coordinator) running and texting them on Telegram within 30 minutes.
>
> **What you'll have at the end:** AscendOps daemon running, two agents (Maintenance Director + Leasing Coordinator) booted, both messaging you on Telegram. PM software integration is a separate add-on; you'll have a working fleet first.
>
> **Two paths to the same end state.** The "Easy way" below uses our one-line installer and the guided onboarding flow — recommended for most operators. The "Advanced — for developers" section at the bottom walks every step manually (useful if you want to read the source as you go, customize the install path, or contribute back to AscendOps via your own GitHub fork).

---

## Easy way (recommended)

**Time:** 30 minutes if you have the accounts below, 60–90 minutes if you need to create them.

### Step 1 — Prerequisites

You need:
- [ ] **macOS or Linux** (Windows via WSL2 — see [README.md](./README.md) Windows section; adds ~15 minutes)
- [ ] **Node.js 20 or newer** (`node --version` should report v20.x+)
- [ ] **Claude Code installed and authed** — install with `npm install -g @anthropic-ai/claude-code`, then `claude login` once. This is the runtime that powers every agent.
- [ ] **A Telegram account** (we'll create the bot tokens during onboarding)
- [ ] **(Recommended) GitHub account + `gh` CLI authed** — when the installer detects an authed `gh`, it creates your own fork of AscendOps on GitHub so you can pull updates from us AND push your improvements back. Install gh with `brew install gh` on macOS, then `gh auth login`. Without it, the install still works but you'll be on a plain clone (no contribute-back path until you set up a fork manually later).

If any of those is missing, install it now before running the one-liner.

### Step 2 — Run the installer

```bash
curl -fsSL https://raw.githubusercontent.com/noogalabs/ascendops/main/install.mjs | node
```

The installer:
- Detects whether `gh` CLI is authed. If yes, creates your fork at `github.com/<your-username>/ascendops` (or reuses an existing fork), then clones from there with `upstream` pointing back at `noogalabs/ascendops`. If `gh` is not authed, falls back to a plain clone with `upstream` pointing at `noogalabs/ascendops`.
- Installs into `~/ascendops/` (override with `ASCENDOPS_DIR=/some/other/path` if you want it elsewhere).
- Runs `npm install` + `npm run build` to compile.
- Links the `cortextos` CLI into your PATH.

When the installer finishes, you should see a "✓ Done — next step:" message with the Claude Code command to run.

### Step 3 — Open in Claude Code and run onboarding

```bash
claude ~/ascendops
```

Then in the Claude Code prompt, type:

```
/onboarding
```

The guided onboarding flow walks you through:
- Choosing an org name (your business name works)
- Creating the two persona agents (Maintenance Director + Leasing Coordinator)
- Telegram bot provisioning for each agent (the @BotFather flow, with `chat_id` capture automated)
- `.env` wiring including the activity-channel bot + operator-alert fallback creds
- Dashboard auth setup (if you want the web dashboard on day one — skippable)
- Starting the daemon and verifying the bots come online

You'll see "Booting up..." land on Telegram for each agent within seconds of the onboarding wrapping up. From there, both personas continue their own first-boot onboarding via Telegram — they'll ask you about your company, vendors, properties, and comms style.

### Step 4 — (Recommended) Install Tirith for terminal + agent safety

Tirith is a terminal security layer that inspects every command before it runs and flags risky patterns. AscendOps doesn't bundle it (AGPL-3.0 license) — install in one step:

```bash
brew install sheeki03/tap/tirith
echo 'eval "$(tirith init --shell zsh)"' >> ~/.zshrc
source ~/.zshrc
```

For bash/fish and the full Tirith reference, see [github.com/sheeki03/tirith](https://github.com/sheeki03/tirith). Default mode is warn-only (logs findings, never blocks).

### How updates and improvements flow

What this looks like depends on which install path you took. Quick check first:

```bash
cd ~/ascendops
git remote -v
```

**If you see both an `origin` (your fork) and an `upstream` (noogalabs/ascendops):** the installer detected an authed `gh` CLI and forked for you. You're set up for two-way flow:

- **We ship to `noogalabs/ascendops` main.** You pull via `git pull upstream main` in `~/ascendops/`. The installer's auto-update path also does this when re-run.
- **You build or tweak something locally.** Branch off, commit, push to your fork:
  ```bash
  git checkout -b feat/my-improvement
  # edits...
  git push origin feat/my-improvement
  gh pr create --repo noogalabs/ascendops --base main
  ```
- **We review and merge** if it fits. Every other operator picks it up the next time they `git pull upstream main`.

**If you only see an `upstream` (no `origin`):** the installer fell back to plain clone — `gh` wasn't authed at install time. You're in pull-only mode right now:

- **Pulling updates works the same:** `git pull upstream main` from `~/ascendops/`.
- **To enable contributing back later:** run `gh auth login` (if you haven't yet), then from the install dir:
  ```bash
  cd ~/ascendops
  gh repo fork noogalabs/ascendops --remote
  ```
  `gh repo fork --remote` creates the fork on your GitHub account and adds it as a git remote. The existing `upstream` stays pointed at noogalabs/ascendops, your new fork takes the `origin` slot, and from there you can `git push origin <branch>` + `gh pr create` per the fork-path commands above.

The persona templates, PM integrations, and skill scaffolding were built by operators with real businesses solving real problems. AscendOps gets better as you do.

---

## Troubleshooting (easy way)

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl` install fails with HTTP error | Network or rate limit | Wait a minute, retry. If it persists, clone manually: `git clone https://github.com/noogalabs/ascendops.git ~/ascendops` then `node ~/ascendops/install.mjs` |
| Installer reports "gh CLI installed but not authed" | You haven't run `gh auth login` | Either run `gh auth login` and re-run the installer, or accept the plain-clone fallback (you can fork later) |
| `claude ~/ascendops` says "claude: command not found" | Claude Code CLI not installed | Run `npm install -g @anthropic-ai/claude-code`, then `claude login` |
| `/onboarding` does nothing in Claude Code | You're not at the project root | `cd ~/ascendops` then re-launch Claude Code with `claude .` |
| Agents start but never message Telegram | Bot token or chat_id wrong | Re-check `.env` files under `~/ascendops/orgs/<org>/agents/<agent>/.env` and confirm with `cortextos status` |

For anything else: check `~/.cortextos/default/logs/<agent>/stderr.log` and `cortextos bus read-all-heartbeats`. The Skool community is the right place to ask.

---

---

# Advanced — for developers (manual install)

> Read this section if you want to read AscendOps source as you install, customize the install path, contribute back via PR without going through the installer, or troubleshoot a failed easy-way install step-by-step. The end state is identical to the easy way.

## What you need before you start

**Time:** 30 minutes if you have the accounts below, 60–90 minutes if you need to create them.

**Accounts (create these first):**
- [ ] **GitHub account** (free tier is fine) — install creates your own fork of AscendOps so you can pull updates from us AND push improvements back. See "How updates and improvements flow" further down.
- [ ] **Anthropic Claude account** — you'll need either an OAuth-logged-in `claude` CLI on the host OR an `ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com). OAuth is easier.
- [ ] **Telegram account** with the @BotFather bot accessible. You'll create three bots: one per agent (Maintenance Director, Leasing Coordinator) and one "activity channel" bot that posts agent events into a separate Telegram channel.
- [ ] **(Optional but recommended) Google account** for Gemini API key — powers the knowledge base. Free tier works for light use.

**Machine:**
- [ ] macOS or Linux. Windows works via WSL2 — see the Windows section in [README.md](./README.md), and add 15 minutes to your install budget.
- [ ] Node.js 20 or newer (`node --version` should report v20.x+)
- [ ] `jq` installed (`brew install jq` on macOS, `apt install jq` on Linux)
- [ ] `git` installed
- [ ] `gh` CLI (GitHub's command-line tool) installed — `brew install gh` on macOS. Linux/Windows install steps at [cli.github.com](https://cli.github.com).
- [ ] `gh auth login` completed — runs a quick browser-based OAuth (about 2 min). Required so the fork-clone step in Step 1 can create your fork without prompting for a password.
- [ ] Terminal you're comfortable in

If any of those is missing, install it now. The guide assumes they exist.

---

## Step 1 — Fork and clone the repo

```bash
gh repo fork noogalabs/ascendops --clone --remote
cd ascendops
npm install
npm run build
```

What each piece does in plain talk:
- `gh repo fork noogalabs/ascendops` creates `github.com/<your-username>/ascendops` on your GitHub account — your own copy of the repo that you control.
- `--clone` immediately clones that fork to your local machine into an `ascendops/` directory.
- `--remote` sets up two git remotes for you: `origin` points at your fork, and `upstream` points back at `noogalabs/ascendops`. That's how you pull our updates and push your own improvements (see "How updates and improvements flow" at the end of this guide).
- `npm install` pulls dependencies (no AscendOps-side network calls beyond npm). `npm run build` compiles TypeScript to `dist/`. You should see `Build success in <ms>` at the end.

**Verify the CLI works:**

```bash
node dist/cli.js --version
```

You should see a version string. If you want a shorter command, you can `npm link` to put `cortextos` on your PATH, but we'll keep using `node dist/cli.js` in this guide so the steps work regardless.

**Verify the fork remote was set up:**

```bash
git remote -v
```

You should see two remotes — `origin` pointing at `github.com/<your-username>/ascendops.git` and `upstream` pointing at `github.com/noogalabs/ascendops.git`. If `upstream` is missing, run `git remote add upstream https://github.com/noogalabs/ascendops.git` to add it manually.

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

Both directories should list. If either is missing, your fork is behind the upstream `noogalabs/ascendops` main — run `git pull upstream main` and re-check. (Under the fork-default install, `origin` points at your personal fork and `upstream` points at the AscendOps repo, so pulling from `origin` would only refresh from your own copy and wouldn't fetch newly-added templates.) Do not proceed until both directories exist; `add-agent` silently falls back to a generic minimal scaffold when the named template is missing, and you'll end up with a non-persona agent.

Create both:

```bash
node dist/cli.js add-agent maintenance-director --template agent-maintenance-director --org acme
node dist/cli.js add-agent leasing-coordinator --template agent-leasing-coordinator --org acme
```

Each command should report `Copied template files from <template>` followed by `Agent <name> created`. If you see `Created minimal agent files` instead of `Copied template files from agent-...`, the template wasn't on disk — stop, re-run the precondition check, pull main, and try again.

**Verify the scaffold:**

```bash
ls orgs/acme/agents/maintenance-director/
ls orgs/acme/agents/leasing-coordinator/
```

You should see ~55 files in each, including `AGENTS.md`, `IDENTITY.md`, `ONBOARDING.md`, `config.json`, and `.env`.

---

## Step 4 — Wire credentials

Each agent needs at minimum a Telegram bot token, your Telegram chat ID, and either Claude OAuth on the host OR an Anthropic API key.

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

### 4.2 — Edit each agent's `.env`

Open `orgs/acme/agents/maintenance-director/.env` and set:

```
BOT_TOKEN=<the Maintenance Director bot token from BotFather>
CHAT_ID=<your numeric chat ID from step 4.1>
ALLOWED_USER=<your numeric chat ID — for 1-on-1 it's the same as CHAT_ID>
```

Repeat for `orgs/acme/agents/leasing-coordinator/.env` with that bot's token.

### 4.3 — Edit `orgs/acme/secrets.env` and `orgs/acme/activity-channel.env`

**4.3a — `orgs/acme/secrets.env`:**

```
ANTHROPIC_API_KEY=<from console.anthropic.com, optional if claude CLI is logged in>
CTX_OPERATOR_BOT_TOKEN=<a bot token that can always reach you>
CTX_OPERATOR_CHAT_ID=<your CHAT_ID>
GEMINI_API_KEY=<from aistudio.google.com — free tier is fine>
```

**4.3b — `orgs/acme/activity-channel.env`:**

```bash
cat > orgs/acme/activity-channel.env <<'EOF'
ACTIVITY_BOT_TOKEN=<the third bot's token from step 4.1>
ACTIVITY_CHAT_ID=<your CHAT_ID — or a dedicated channel ID if you set one up>
EOF
chmod 600 orgs/acme/activity-channel.env
```

(See `src/bus/approval.ts` for the runtime read path. Activity-channel vars live in their own file, NOT in `secrets.env`.)

### 4.4 — Dashboard auth (skip if not running the dashboard on day one)

Add to `orgs/acme/secrets.env`:

```
AUTH_SECRET=<run: openssl rand -base64 32>
ADMIN_USERNAME=<pick a username>
ADMIN_PASSWORD=<pick a strong password>
NEXTAUTH_URL=http://localhost:3001
DASHBOARD_URL=http://localhost:3001
SYNC_ADMIN_PASSWORD=<same as ADMIN_PASSWORD, or a separate sync password>
```

---

## Step 5 — Start the daemon and your agents

```bash
node dist/cli.js start maintenance-director
node dist/cli.js start leasing-coordinator
```

Each command spins up the agent under PM2. "Booting up..." should land in your Telegram chat with each bot within 5–15 seconds. If it doesn't, check `node dist/cli.js status` and `tail -50 ~/.cortextos/default/logs/maintenance-director/stderr.log`.

---

## Step 6 — Run onboarding for each agent

Both persona agents ship with a built-in question-driven onboarding. In each Telegram chat:

```
/onboarding
```

Answer the questions. Each agent takes 5–10 minutes. After both say "Onboarding complete," they're real.

---

## Step 7 — Verify it's all working

Send each agent:

> "Morning. What's on your plate today?"

Each should respond with a short status reflecting what onboarding configured. The Maintenance Director will mention work orders or vendor coordination; the Leasing Coordinator will mention prospects or showings. Lifecycle events should also be landing in your activity channel.

---

## Recommended add-on — install Tirith for terminal + agent safety

Same Tirith install as the easy way:

```bash
brew install sheeki03/tap/tirith
echo 'eval "$(tirith init --shell zsh)"' >> ~/.zshrc
source ~/.zshrc
tirith doctor   # should report "hook status: CONFIGURED"
```

AGPL-3.0 licensed, so we can't bundle it. Default mode is warn-only. See [github.com/sheeki03/tirith](https://github.com/sheeki03/tirith) for the full reference (Linux install, policy authoring, etc.).

---

## What to skip for day one

- **PM software integration** (Property Meld / AppFolio / etc.) — agents work without it. See [README.envs.md](./README.envs.md) for the credential variables.
- **Telnyx (voice + SMS)** — useful for vendor/tenant outbound. Skip day one.
- **Cloudflare R2 (photo storage)** — only matters once tenants upload photos. Skip day one.
- **Knowledge base ingestion** — agents work with built-in memory until you ingest your own docs.

---

## How updates and improvements flow (manual install)

AscendOps is collaborative by design, and the fork setup from Step 1 enables a two-way loop:

- **We ship to `noogalabs/ascendops` main.** You pull our updates:
  ```bash
  git pull upstream main
  npm install && npm run build   # only if package.json or src/ changed
  ```
- **You build or tweak something locally.** Branch off, commit, push to your fork:
  ```bash
  git checkout -b feat/my-improvement
  # ... your changes ...
  git push origin feat/my-improvement
  ```
- **You send your work back to us:**
  ```bash
  gh pr create --repo noogalabs/ascendops --base main --head <your-username>:feat/my-improvement
  ```
- **We review and merge** if it fits. Every other operator picks it up the next time they `git pull upstream main`.

---

## Troubleshooting (manual install)

| Symptom | Likely cause | Fix |
|---|---|---|
| Agent doesn't send "Booting up..." | Wrong BOT_TOKEN, wrong CHAT_ID, or claude CLI not logged in | Re-check Step 4.1 output. Run `claude login` if no API key is set. |
| Agent boots but `/onboarding` does nothing | `.onboarded` file already exists from a prior attempt | `rm ~/.cortextos/default/state/<agent-name>/.onboarded` and retry |
| `cortextos` not found | `npm link` wasn't run | Either run `npm link` or keep using `node dist/cli.js` |
| `EADDRINUSE` when starting dashboard | Something else is on port 3001 | Either kill the other process or set `DASHBOARD_PORT=3002` in `secrets.env` |
| `Module not found` on first run | `npm run build` wasn't run | Run `npm run build`, then retry |
| Activity channel silent | `ACTIVITY_BOT_TOKEN` / `ACTIVITY_CHAT_ID` missing | Add to `orgs/<org>/activity-channel.env` (NOT `secrets.env` — runtime reads a separate file) and restart the agent |
| `add-agent` says "Created minimal agent files" instead of "Copied template files" | Template directory not on disk (your fork is behind upstream) | Run the Step 3 precondition `ls templates/agent-...` check; `git pull upstream main` (NOT `origin` — that's your own fork under the fork-default install) to fetch new templates from the AscendOps upstream |
| `gh repo fork` fails with auth error | `gh auth login` not completed | Run `gh auth login` (browser flow, ~2 min), then re-run the fork command |
| `git pull upstream main` fails with "couldn't find remote" | `--remote` flag was missed on the original fork-clone | `git remote add upstream https://github.com/noogalabs/ascendops.git` to add it now |

For anything else: check `~/.cortextos/default/logs/<agent>/stderr.log` and `cortextos bus read-all-heartbeats`.

---

## Appendix — what got installed

- `~/.cortextos/default/` — daemon state, logs, inbox/outbox, agent state files. Per-instance.
- `~/ascendops/orgs/<org>/` — your org-scoped config, secrets, agent directories. Committed to git if you want versioning (secrets stay gitignored).
- `node_modules/` — npm dependencies. Gitignored. ~2 minutes to recreate on a fresh checkout.
- PM2 process manager — runs the daemon and agents. `pm2 list` to see them.

No system-level files outside `~/.cortextos/` and the cloned repo. Uninstalling is `rm -rf` on those two locations.

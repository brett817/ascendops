# Business Profile Wizard — 1-page spec

**Status:** Draft for David review. No code yet.
**Author:** collie (per Dane WIZARD-SPEC dispatch 2026-05-15)
**Date:** 2026-05-15
**Target:** `noogalabs/ascendops`

---

## 1. Scope

### What the wizard does

Walks a freshly installed AscendOps operator through configuring their company-specific context so the Maintenance Director + Leasing Coordinator personas boot with real data instead of generic. Runs **after** `cortextos setup` (the existing install + org-create wizard at `src/cli/setup.ts:200`) and **after** `add-agent` has scaffolded the two persona agents.

Wizard collects: company identity, vendor roster, property list, communication tone, owner contacts, resident roster, day-mode hours, Slack workspace + team-member roster, escalation thresholds. Writes a single structured config file the persona agents read on every session start.

### What the wizard does NOT do

- Does NOT install software, create the org, create the Telegram bots, or scaffold the agent directories — that's `cortextos setup` + `add-agent` and the wizard assumes those are already done.
- Does NOT enforce TrustLevel-based agent permission gating. The TrustLevel type ships (`src/types/index.ts:848`) but enforcement is currently convention/prompt-driven (see Section 6 open question). The wizard COLLECTS trust_level on each team member; whether the runtime ENFORCES it is a separate decision.
- Does NOT validate vendor licenses, COI dates, or property addresses against third-party systems. It captures what the operator enters verbatim; downstream agents do their own verification.
- Does NOT push anything to PM software (Property Meld, AppFolio, etc.). The wizard is local-only; PM integration happens through the existing `cli-anything-pm` adapter.
- Does NOT support multi-tenant or multi-org configuration. One wizard run = one business profile for the active org.

---

## 2. User flow

Screens are sequential. Customer can `Ctrl+C` to bail; partial state is written atomically per screen so resume-after-exit lands on the next un-answered prompt (mirrors `setup.ts` resume semantics).

1. **Welcome + preconditions check** — confirm org exists, both persona agents are scaffolded, daemon is reachable. If any precondition fails, point at the right doc and exit.
2. **Company identity** — legal name, DBA, primary city + state, ~door-count, primary PM software (radio: Property Meld / AppFolio / Buildium / Rentvine / Rent Manager / Other / None).
3. **Owner contacts** — for each owner: name, phone, email, preferred-contact-channel (Telegram / SMS / email / call), trust_level (owner / manager / member). Multi-entry loop with "add another? [Y/n]" until done.
4. **Property roster** — for each property: address, unit count, owner (pick from step 3), tenant-presence-required default (Y/N). Multi-entry loop with bulk-import option (paste CSV).
5. **Vendor roster** — for each vendor: name, trades (multi-select from a fixed list: Plumbing / HVAC / Electrical / Appliance / General / Landscaping / Other), contact phone, COI on file (Y/N), preferred-contact-channel. Multi-entry loop.
6. **Resident map (optional, skippable)** — bulk-import path: paste a CSV of unit_ref, tenant_name, primary_phone, lease_end_date. Skip if the operator wants the agents to learn this through the PM software adapter instead.
7. **Day-mode hours + escalation thresholds** — start time, end time, timezone (autodetect from OS, confirm), after-hours emergency definition (free-text). Sets the bounds Blue + LC honor for their dispatch + comms windows.
8. **Communication tone** — multi-select prompts (warm-professional / direct / casual / formal / industry-specific). Optional sample voice paragraph the operator pastes; persona agents use it as style anchor.
9. **Slack workspace + team-member roster** — REQUIRED step. See Section 6.
10. **Tirith reminder** — text block pointing at the existing `SKOOL-INSTALL.md` Tirith section. Wizard does NOT install Tirith (AGPL boundary); just reminds the operator the post-install layer exists.
11. **Review + write** — show a summary of everything captured, confirm, write to `orgs/<org>/business-profile.json` (see Section 4). Print "Next: restart your persona agents to pick up the new profile."

---

## 3. Fields collected

Grouped to match the screens above. Names are draft; final names land in the JSON schema once David approves.

**Company** — `legal_name`, `dba`, `primary_city`, `primary_state`, `door_count`, `pm_software` enum.

**Owners** — list of `{name, phone, email, preferred_channel, trust_level}` records.

**Properties** — list of `{address, unit_count, owner_ref, tenant_presence_required_default}`. `owner_ref` points by index into owners list.

**Vendors** — list of `{name, trades[], phone, coi_on_file, preferred_channel}`. `trades` is an enum array.

**Residents (optional)** — list of `{unit_ref, tenant_name, primary_phone, lease_end_date}`. May arrive empty if operator skips the step.

**Hours + escalation** — `day_mode_start`, `day_mode_end`, `timezone`, `emergency_definition_freetext`.

**Comms tone** — `style_tags[]` (multi-select enum), `voice_sample_freetext` (optional).

**Slack + team** — `slack_workspace_name`, `slack_bot_token`, `slack_default_channel_name`, `slack_default_channel_id`, `team_members[]` (each: `{name, slack_handle, role_freetext, trust_level, assigned_to_agent?}`).

---

## 4. File outputs

Single JSON file: `orgs/<org>/business-profile.json`. Atomic write via the existing `atomicWriteSync` helper. `chmod 600`.

Schema sketch:

```json
{
  "version": 1,
  "completed_at": "2026-05-15T17:00:00Z",
  "company": { ... },
  "owners": [ ... ],
  "properties": [ ... ],
  "vendors": [ ... ],
  "residents": [ ... ],
  "hours": { ... },
  "comms_tone": { ... },
  "slack": { "workspace_name": "...", "default_channel": { ... }, "team_members": [ ... ] }
}
```

**Secrets split.** The Slack bot token is the only secret in the wizard's data set. It gets written to `orgs/<org>/secrets.env` as `SLACK_BOT_TOKEN=...` (NOT to `business-profile.json`). The profile JSON stores `slack_workspace_name` + `slack_default_channel_*` only; the actual token never lands in the profile file. This matches the existing secrets-vs-config split (Telegram tokens in `.env`, Telnyx creds in `~/.claude/credentials/`).

Existing `business-profile.json` from a prior wizard run → wizard offers "resume from saved state" on launch so operators can re-run to update one section instead of redoing everything.

---

## 5. Dependencies on existing setup.ts

`src/cli/setup.ts:200` is the install + org-create wizard. The business profile wizard is **separate** — exposed as a new top-level subcommand:

```bash
node dist/cli.js configure --org <org-name>
```

Reasons for separate command rather than extending `setup.ts`:

1. `setup.ts` runs once, before any agents exist. The business profile depends on agents being scaffolded so it can reference them in the team_members section.
2. Operators will re-run `configure` to update profile data (vendor moves, owner changes, new property). Re-running `setup.ts` would re-prompt for install + bot creation.
3. Cleaner separation: `setup.ts` = framework wiring, `configure` = business context.

Code reuse from `setup.ts`: lift the `ask`, `askRequired`, `askDefault`, `askYN` helpers into `src/cli/_prompt-helpers.ts` so both wizards share the same readline UX. Pure refactor, no behavior change in setup.ts.

---

## 6. Slack setup walkthrough (required step)

This is the longest section of the wizard. Steps the operator through end-to-end Slack provisioning even if they've never created a Slack app.

### 6a. Confirm or create a Slack workspace

Prompt: "Do you already have a Slack workspace for your business? (Y/n)"
- **Y** → "Paste your workspace URL or name." Capture into `slack_workspace_name`.
- **n** → Print: "Open https://slack.com/get-started in your browser. Create a free workspace. Come back when done." `Press Enter when ready.` Then ask for the workspace name.

### 6b. Create the Slack app

Print the full set of steps inline (no external doc link required to complete the wizard):

1. Go to `https://api.slack.com/apps` (operator opens in browser)
2. Click "Create New App" → "From scratch"
3. App name: "AscendOps Bot" (or anything memorable)
4. Pick your workspace
5. Once created, go to "OAuth & Permissions" in the sidebar
6. Under "Scopes → Bot Token Scopes," add: `chat:write`, `channels:read`, `groups:read`, `users:read`, `im:write`
7. Click "Install to Workspace" at the top of the same page → approve
8. Copy the "Bot User OAuth Token" — starts with `xoxb-`

`Press Enter when ready.`

### 6c. Paste the bot token

Prompt: "Paste your Bot User OAuth Token (xoxb-...): "

After paste, validate via a single `auth.test` API call. If 200 OK + `ok:true`, capture into memory and write to `orgs/<org>/secrets.env` as `SLACK_BOT_TOKEN=<token>` at write-time (Section 4). If invalid, print the error verbatim and re-prompt.

**Explicit privacy statement printed before the paste prompt:**
"Your Slack bot token stays on this machine. It's written to `orgs/<org>/secrets.env` with `chmod 600`. AscendOps has no managed infrastructure — there's no server we send it to. It only leaves your machine when your agents call the Slack API directly from this machine."

### 6d. Pick the default routing channel

After token validation, call `conversations.list` to fetch channels the bot can see. Display as numbered list. Operator picks one. Capture both `name` and `id`. This is the "where AscendOps posts agent-routed messages by default" channel.

If the bot can't see any channels, print: "Your bot was created but hasn't been invited to any channels yet. Open Slack → pick a channel → type `/invite @AscendOps Bot` → come back here and press Enter." Retry the listing.

### 6e. Build the team-member roster

Loop:
- "Add a team member? (Y/n)"
- If Y: name, Slack handle (e.g. `@brittany`), role (free-text — e.g. "Property accountant"), trust_level (owner / manager / member), assigned_to_agent (pick from existing persona agents or "none — general routing").

Example explicitly mentioned in the wizard intro text: "Brittany is your property accountant — she handles owner financial questions and only talks to Blue, the bookkeeping agent. Add her as a team member with role='Property Accountant', trust_level='manager', assigned_to_agent='blue'."

### Open question — permission gate enforcement (pending David)

The TrustLevel type ships in `src/types/index.ts:848` (`'owner' | 'manager' | 'member'`) and the wizard collects it correctly on each team member. **But the runtime gate that enforces "Brittany-only-talks-to-Blue, no-cross-agent-pinging" is currently convention/prompt-driven — there is no code-level enforcement of trust_level rules anywhere outside the type declaration.**

David is deciding direction:
1. Honest-roadmap: ship the wizard with trust_level collected but flag the gate as "convention only" in the wizard's output text + roadmap.
2. v1.1 blocker: build the trust_level access gate (runtime check that intercepts cross-agent or cross-trust-level pings) before the wizard ships. Spec for that gate is a separate doc.
3. Ship-as-is + document: same as (1) but with explicit operator-facing doc explaining "trust_level is collected for future enforcement but currently inert."

Wizard implementation waits on his pick. Best-case (option 1 or 3): collect cleanly, document the inert state in the wizard's review screen. Worst-case (option 2): wizard ships after the gate ships.

---

## 7. Tirith reminder

Penultimate screen, after the Slack roster + before review. Single text block:

```
─── Recommended next step: install Tirith ───

Tirith is a terminal security layer that watches every shell command
your agents (and you) run and flags risky patterns before they execute.
AscendOps does not bundle it (AGPL-3.0 license), but install is a single
brew command and the default mode is warn-only (no blocking).

See SKOOL-INSTALL.md → "Recommended add-on — install Tirith" for the
full walkthrough.
```

Wizard prints this once; does not block. Operator presses Enter to proceed to review.

---

## 8. Estimated build effort

**Best-case (David picks option 1 or 3 from Section 6):**

- Lift prompt helpers from setup.ts → `_prompt-helpers.ts`: 1–2 hrs
- Wizard skeleton + screens 1–4 (company / owners / properties / vendors): 4–6 hrs
- Screens 5–8 (residents / hours / tone / review-and-write): 3–4 hrs
- Slack walkthrough (Section 6, the longest): 4–5 hrs (token validation + channel listing + roster loop + error paths)
- Atomic JSON write + chmod 600 + resume-from-saved logic: 2 hrs
- Tests (mock readline, mock fetch for Slack API): 3–4 hrs
- Docs (CLI help text, README pointer): 1 hr

**Total: ~18–24 hrs (~2.5–3 working days).** One agent (Codie) can ship.

**Worst-case (David picks option 2 — gate first):**

Add 8–12 hrs for the trust_level enforcement gate (separate spec needed). Wizard build then proceeds on top of the gated runtime. **Total ~26–36 hrs (~3.5–4.5 working days).**

---

## 9. Out of scope (deliberate)

- Multi-language UI (English only for v1).
- Web-based wizard UI. CLI-only, matches existing `setup.ts` style.
- Automated import from existing CRM / spreadsheet / Notion. Operator pastes CSV for the bulk-import paths; everything else is interactive.
- Encryption at rest of `business-profile.json` beyond `chmod 600`. AscendOps's existing posture: local file with restrictive permissions; if the operator wants more, they bring their own disk encryption.
- A way for the persona agents to write back to the profile (e.g., "the maintenance agent learned a new vendor"). Read-only from the agent side for v1.

---

## 10. Loop-back

After David's review:
- If approved as-is: Dane routes to Codie for the build. Estimated ship: 2.5–3 working days from start.
- If permission-gate-first (option 2): write a second spec for the trust_level enforcement gate, then chain the wizard after that ships.
- If scope-trim wanted: Dane and David annotate this doc, I update, re-circulate.

Open questions to resolve before build:
- Section 6 trust_level enforcement direction (David's call)
- Final JSON schema field names (low-risk; can lock during implementation)
- Whether the Telegram persona-agent BOT_TOKENs already wired in `setup.ts` should also flow into `business-profile.json` for cross-referencing, or stay only in `.env` (low-risk; default no)

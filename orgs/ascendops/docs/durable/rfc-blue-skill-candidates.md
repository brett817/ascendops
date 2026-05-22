# RFC: 5 New Blue Skill Candidates — formalizing memory rules into invocable skills

**Author:** Collie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review
**Item:** Thursday plate #7 (of 13, final in tonight's batch)
**Companion:** Hook gate (#1, shipped) is harness-level; these are skill-level — they trigger Blue's reasoning *before* she calls the gated tool.

---

## 1. Problem — patterns living in memory rules instead of skills

Blue's reasoning today reads `MEMORY.md` at boot and gets pointers to ~60 memory files. Five of those files describe specific operational patterns Blue must apply *every time the trigger condition appears*, not as background knowledge. They are:

| Memory file | Pattern frequency | What "memory only" costs us today |
|---|---|---|
| `project_partial_completion_sop.md` | Every Carlos / Casey / Silvano partial-work close (~3-5/wk) | Blue sometimes leaves the original meld open instead of completing → cloning → assigning vendor → merging. MAINTENANCE_COULD_NOT_COMPLETE entries linger on the dashboard. |
| `feedback_completion_checklist.md` | Every in-house tech completion email (~5-10/wk) | Blue sometimes reports "(None)" notes from the email snippet without fetching `maintenance_notes` from the meld record. False-clean signal. |
| `project_3910_university_threat_history.md` | Every escalation from 3910 University Dr (~1-2/mo, but high-leverage) | Blue could over-react to legally-aggressive tenant language and propose a vendor swap when reasonable attempt + safety guidance is correct. |
| `feedback_vendor_scheduling_order.md` | Every vendor-scheduled meld (~10+/wk) | Blue occasionally messages the resident before vendor confirmation, then has to walk it back when the vendor reschedules. |
| `project_brittany_nashville_pest.md` (intersects #3 logic) | Out of scope here, but relevant to vendor-tech-status-sweep | — |

**Why memory-only fails:** memory entries are *background knowledge*. The agent applies them when she "remembers to." Skills are *triggered playbooks* — when the trigger pattern appears, the skill is loaded and executed deterministically. The transition from memory-rule to skill-playbook is what turns "Blue knows the rule" into "Blue cannot skip the rule."

The 5 skills below codify the 5 patterns above into Blue's `.claude/skills/` directory using the existing frontmatter convention (verified against `pm-meld-triage/SKILL.md`).

## 2. Skill Design Conventions

Each skill ships at `orgs/ascendops/agents/blue/.claude/skills/<name>/SKILL.md` with:

```markdown
---
name: <kebab-name>
effort: low | medium | high
description: "<one-sentence purpose>"
triggers: ["<exact trigger phrases>", "..."]
---

# <Title>

## Trigger
When does this skill load? List exact patterns.

## Inputs
What does the skill need to run? (meld_id, tech_name, etc.)

## Steps
Numbered, deterministic. Each step cites the snapcli/bus command to run.

## Outputs
What does Blue write back to PM / Dane / David?

## Failure Modes
Table: condition → response.

## Memory References
Pointers to source-of-truth memory files.
```

`effort` controls whether Blue should load this on every meld read (low) or only when triggered (high). All 5 candidates here are `low` — they're either always-applicable filters or the canonical action for a clear trigger pattern.

## 3. Per-Skill Specs

### 3.1 `partial-completion-handle`

**Trigger:** in-house tech completion email mentioning "still need", "follow up", "vendor for", "could not complete", "wasn't able to", or any meld in `MAINTENANCE_COULD_NOT_COMPLETE` status.

**Inputs:** `meld_id`, `tech_name`, `partial_summary` (parsed from the email or pulled from `maintenance_notes`).

**Steps:**
1. `pm work-orders comments <meld_id> --json` — read latest thread to confirm partial status and capture what was done.
2. `pm work-orders complete --meld-id <meld_id> --notes "Carlos completed: <X>. Remaining: <Y>. New meld created for remaining work."` — close the original (will fire the pre-complete audit hook gate from #1; ensure notes are real, not placeholder).
3. `pm work-orders clone <meld_id> --json` — capture new meld id from output.
4. Decide assignment for the new meld:
   - In-house specialist remaining? → `pm assign-tech --work-order-id <new_id> --tech <name>`
   - External vendor? → `pm assign-vendor --work-order-id <new_id> --vendor <name>` (top-level cmd shipped Apr 28)
5. `pm work-orders merge --meld-id <new_id> --into <original_id>` — link history.
6. Send Telegram to David with the new meld ID + assignment summary.

**Outputs:** new meld id, assignment confirmation, Telegram brief.

**Failure Modes:** clone fails → fall back to creating new meld via Nexus; assign fails → escalate to David with the unmerged orphan meld ID.

**Memory References:** `project_partial_completion_sop.md` (canonical SOP).

---

### 3.2 `vendor-tech-status-sweep`

**Trigger:** explicit user/Dane phrases — "status sweep", "active vendors", "where do techs stand", or every Mon/Wed/Fri at the morning brief.

**Inputs:** none — pulls live state.

**Steps:**
1. `pm work-orders list --status pending --json` — pending-completion melds.
2. `pm work-orders list --status open --json` — open in-flight.
3. Group by `assigned.id` (in-house vs vendor): per tech / per vendor list of meld ids + age.
4. For each in-house tech: count `started > 24h && no completion` → "stuck-in-progress" flag.
5. For each vendor: count `assigned > 48h && no work-entries` → "vendor-unresponsive" flag.
6. Brittany Nashville filter (per `project_brittany_nashville_pest.md`): silently exclude Nashville pest melds from David escalation, route to Brittany channel.
7. Output: structured Telegram message to David — "X open, Y stuck, Z vendor-unresponsive."

**Outputs:** sweep brief to David; optional Telegram to Brittany for Nashville items.

**Failure Modes:** list 401 → re-capture session per `pm-session-recapture` skill (existing); rate-limit → backoff 60s + retry once.

**Memory References:** `project_brittany_nashville_pest.md`, `feedback_blue_dane_comms_pattern.md`.

---

### 3.3 `assign-vendor-with-confirmation`

**Trigger:** any vendor assignment intent ("assign vendor", "schedule vendor", "send out X for meld Y", "dispatch vendor"). Loaded eagerly because the rule is unconditional while 10DLC SMS isn't live.

**Inputs:** `meld_id`, `vendor_name`, `proposed_window` (optional).

**Steps:**
1. `pm assign-vendor --work-order-id <meld_id> --vendor <name> --json` — assign in PM (new top-level cmd, lookup-by-name).
2. Send vendor message via PM internal note: `pm work-orders send-message --meld-id <meld_id> --text "Hi <vendor>, can you come <proposed_window or 'today/tomorrow morning'> for <work>? Reply with confirmed time." --hidden-from-tenant`.
3. Wait for vendor reply (poll `pm work-orders comments <meld_id>` periodically, or detect inbound on next cron cycle).
4. **DO NOT MESSAGE THE RESIDENT YET.** This is the rule's sharp edge.
5. Once vendor confirms a window: `pm work-orders schedule-vendor --meld-id <meld_id> --vendor-id <id> --dtstart <iso> --hours <n> --json`.
6. THEN message resident with the confirmed window: `pm work-orders send-message --meld-id <meld_id> --text "Hi <resident>, <vendor> confirmed they'll arrive <window>. Please make sure access is available." --hidden-from-vendor`.

**Outputs:** vendor-assigned + scheduled + resident-notified, in that order.

**Failure Modes:** vendor doesn't reply within 24h → `vendor-unresponsive` escalation (separate skill or inline); proposed window declined by vendor → loop back to step 2 with new window.

**Memory References:** `feedback_vendor_scheduling_order.md` (the rule), `feedback_telnyx_a2p_status` (when 10DLC ships, this skill is revisited because direct SMS becomes available).

---

### 3.4 `threat-history-filter`

**Trigger:** any meld read or message ingest where the unit address matches a threat-history entry. Loaded eagerly so Blue has the filter active before reading inbound messages.

**Inputs:** `unit_address`, `inbound_message_text` (when present).

**Steps:**
1. Compare unit address against the threat-history list (initially: 3910 University Dr / Shane Northweather; expandable as new entries are added).
2. If match: parse the inbound message for legal/escalation language (cite "TN essential-services law", "24 hour", "fire marshal", "repair and deduct", etc.).
3. **Decision tree:**
   - Genuine first-time emergency (real safety hazard, no prior threat-history pattern) → normal escalation.
   - Threat-history-pattern message (legal language + the unit is on the list) → reasonable-attempt response (turn off main, breaker check, reasonable safety guidance) + maintain assigned vendor channel. **Do NOT propose vendor swap on theatrics alone.**
4. Log decision to memory file `daily-decisions.md` with reasoning so calibration can be reviewed later.
5. If David override is needed (unit ambiguity, new threat-history candidate), surface to David with the matching memory reference for context.

**Outputs:** classification (`emergency` / `theatrical-escalation`) + recommended response.

**Failure Modes:** address fuzzy-match miss (e.g. "3910 University" vs "3910 University Dr Apt 2") → require fuzzy match within unit, not exact string.

**Memory References:** `project_3910_university_threat_history.md` (canonical case).

**Canonical test case:** the 2026-04-28 TYD5XVP electrical meld — Shane Northweather sent statutory citations + 24h ultimatum + fire-marshal threat + "2 babies" framing. Correct decision: maintain Rogers Electric vendor + safety guidance, not vendor swap.

---

### 3.5 `completion-checklist`

**Trigger:** any in-house tech completion email arriving in `david@noogalabs.com` (Carlos/Casey/Silvano sender pattern).

**Inputs:** `meld_id` from the email.

**Steps:**
1. **DO NOT trust the email snippet** — the "(None)" notes shown in the email refers to PM's `completion_notes` field, which is almost always empty and is not the tech's work notes.
2. `pm work-orders get <meld_id> --json` — fetch the meld record. Read `maintenance_notes` specifically.
3. `pm work-orders files <meld_id> --json` — fetch attached files (the new subcommand shipped Apr 28). Filter by photo extensions (.jpeg/.jpg/.png/.heic/.gif).
4. Check three things:
   - `maintenance_notes` non-empty and not "(None)"
   - At least 1 photo
   - `started` field set + `work_entries` non-empty (sum hours > 0)
5. If any missing: send a hidden-from-tenant message via `pm work-orders send-message --meld-id <id> --text "Hi <tech>, can you add <missing items>? Need them for documentation." --hidden-from-tenant --hidden-from-vendor`.
6. If all present: silent — Blue continues normal flow.

**Outputs:** verification log entry; optional message to tech if items missing.

**Failure Modes:** files endpoint 401 → re-capture session; tech doesn't reply within 24h → flag for Dane heartbeat report. The hook gate from #1 is the harness-level backstop if Blue herself misses this.

**Memory References:** `feedback_completion_checklist.md` (David's explicit ask), `feedback_pm_check_completed_projects.md` (also check completed-status melds, not just active).

## 4. Skill Discoverability (priority order)

When Blue reads a meld, skills are evaluated in this order — first match wins:

```
1. threat-history-filter      (always; cheapest, filters before any other reasoning)
2. completion-checklist       (if email is in-house tech completion)
3. partial-completion-handle  (if completion notes mention partial work)
4. assign-vendor-with-confirmation (if intent = assign or schedule a vendor)
5. vendor-tech-status-sweep   (if cron-fired or explicit user request)
```

Skills 1+5 are non-overlapping with 2+3+4. Skills 2 and 3 can chain (completion-checklist may flag partial → partial-completion-handle takes over).

## 5. Testing Methodology

| Skill | Canonical test scenario | Pass criteria |
|---|---|---|
| `partial-completion-handle` | Recent Carlos partial close (find from MEMORY.md / today-memory) | Original meld closed with notes, new meld created + assigned, merge succeeded, Telegram brief posted |
| `vendor-tech-status-sweep` | Run on a Wed morning, expect 3-5 stuck/unresponsive flags | Output matches manual count from `pm work-orders list --status pending` cross-checked |
| `assign-vendor-with-confirmation` | Synthetic: meld 12636944 (Rogers Electric, already-assigned) replays the assign + schedule flow | Vendor messaged BEFORE resident; resident message blocked until vendor confirm received |
| `threat-history-filter` | Meld TYD5XVP, replay Shane Northweather's escalation | Decision = `theatrical-escalation`, response = reasonable-attempt + safety guidance, vendor unchanged |
| `completion-checklist` | Last Carlos completion email; expect notes/photos/hours all present after the recent batch | Verification log = pass; no message to tech |

Each skill includes a `tests/` subdirectory with the canonical scenario as a fixture (mocked PM responses) so the skill can be tested without live API calls.

## 6. Migration

**Order Thursday rollout:**

1. `completion-checklist` — overlaps with the hook gate from #1. Ship first; the gate is the harness-level backstop, the skill is the proactive write-back. Soak 3 days, watch for misfires.
2. `partial-completion-handle` — second highest impact (Carlos partial pattern). Soak 1 week.
3. `assign-vendor-with-confirmation` — eager-load, applies on every vendor assignment. Soak 1 week.
4. `threat-history-filter` — eager-load, single-entry list to start. Soak indefinite (low frequency events; calibration takes time).
5. `vendor-tech-status-sweep` — Mon/Wed/Fri morning cron. Defer until others stable so the sweep output is coherent.

Rollback: delete skill directory, restart Blue. No data migration.

## 7. Open Questions for David

1. **Threat-history list source-of-truth** — JSON file in `orgs/ascendops/data/threat-history.json`, gitignored or committed? Suggest committed (cross-machine portability, audit trail) — sensitive but not confidential.
2. **`assign-vendor-with-confirmation` 24h vendor-no-reply escalation** — direct to David, or queue for next morning brief? Real workflow has no answer today.
3. **Status sweep cadence** — Mon/Wed/Fri morning or daily? Daily is cheaper post-stickiness-RFC, less data to scan.
4. **Completion-checklist auto-message vs prompt-David** — auto-send the hidden-from-tenant follow-up, or first surface to David for confirmation? Auto reduces lag, but a wrong message to a tech is a soft cost.
   - **ANSWERED [D6]: AUTO-SEND — David 2026-04-29** (Dane recommendation, agree all batch). Blue caught Carlos audit error within 3 minutes today using the skill — auto-pattern validated by real evidence. Escalate to David only on Tier-2 anomaly (tech repeats same gap 3x in 7d). See `decisions-log.md` D6.
5. **`partial-completion-handle` confidence threshold** — automate the full 4-step sequence, or stop at "create new meld" and surface for assignment confirmation? Confidence builds with first 5-10 successful runs.

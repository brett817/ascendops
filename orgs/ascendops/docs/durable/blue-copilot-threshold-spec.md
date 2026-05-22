# Blue Copilot Threshold Spec

**Author:** Collie
**Date:** 2026-04-24
**Status:** Ready for Build — all questions resolved.
**Goal:** Progressive autonomy for Blue. She starts in approval-required mode. As she proves accuracy category by category, she earns the right to act without asking. Aussie tracks and flips the switch.

---

## 1. Defining "Correct"

**Baseline rule:** A decision is correct if David would have made the same choice had Blue not asked.

Since Blue currently asks before acting, every David response is a ground-truth label:

| David response | Classification | Score |
|---------------|----------------|-------|
| Approved as recommended | Correct | +1 |
| Approved with minor clarification (no change to action) | Correct | +1 |
| Approved but with a note ("next time do X") | Correct + learning signal | +1, flag for GUARDRAILS update |
| Modified the recommendation before approving | **Incorrect** | 0 — Blue did not have the full picture. Any change to vendor, timing, or scope before approval counts as a miss, no exceptions. |
| Rejected and redirected | Incorrect | 0 |
| No response within 4h during day mode | Ambiguous | excluded from count |

**Category-specific measurement:**

| Category | What "correct" means |
|----------|----------------------|
| Lock changes | David approved the lock change, vendor, and timing as presented |
| In-house tech dispatch | David approved the technician, job scope, and visit timing |
| Known vendor dispatch | David approved the vendor (pre-approved), job scope, and scheduling |
| Resident communication | David sent the draft message without editing the substance |
| Meld closure | David agreed the meld was complete and closeable |
| Emergency dispatch | David approved the emergency response (vendor, timing, escalation level) |
| New vendor assignment | David approved the vendor (not previously on roster) |

**What counts as the sample window:** The 20 most recent decisions in a category that received a response. Ambiguous (no response) decisions do not move the window.

**Minimum sample size before eligibility:** 20 decisions. Categories with fewer than 20 data points cannot unlock regardless of accuracy rate.

---

## 2. Decision Category Taxonomy

Blue makes seven decision types that currently require approval. Listed in recommended unlock order — simplest and most binary first.

### Tier 1 — Unlock Candidates (simple, reversible, low blast radius)

**C1: Lock changes**
- What it is: authorizing a lock rekey, code change, or lockbox install
- Why it unlocks first: binary outcome, low cost, easily verified, vendor pool is small and known
- Approval event type: `lock_change`
- Typical decision: "Rekey unit 3B with ABC Locksmith, $85, Friday"

**C2: In-house tech dispatch**
- What it is: scheduling an in-house technician for a standard maintenance visit
- Why it unlocks second: in-house = controllable, costs are predictable, tech roster is fixed
- Approval event type: `inhouse_dispatch`
- Typical decision: "Send Marcus to 4512 Elm St for HVAC filter replacement, Thursday 10am"

### Tier 2 — Unlock Candidates (medium complexity, partially reversible)

**C3: Known vendor dispatch**
- What it is: scheduling a pre-approved vendor (on the existing roster) for a standard job type
- Distinction from new vendor: same vendor, same category of work they've done before
- Approval event type: `known_vendor_dispatch`
- Typical decision: "Schedule ABC Plumbing for drain clear at 1920 Oak, they've done this before"

**C4: Resident communication**
- What it is: sending a message to a resident (update, diagnostic question, scheduling confirmation)
- Why later than dispatch: tone errors are harder to reverse than scheduling errors
- Approval event type: `resident_comms`
- Typical decision: "Sending resident the scheduling confirmation and what to expect"
- **One unlock category** — no split between routine and diagnostic for now. Event metadata tracks `subtype: routine|diagnostic` on each decision so we can split later if accuracy signals diverge. Do not split the taxonomy until data shows they actually unlock at different rates.

**C5: Meld closure**
- What it is: marking a work order complete and closed in PropertyMeld
- Why at this tier: requires verifying photos/notes exist — Blue must be reliable at that checklist first
- Approval event type: `meld_closure`

### Tier 3 — Unlock Candidates (high stakes, slow unlock)

**C6: Emergency dispatch**
- What it is: authorizing an emergency vendor call (after-hours, urgent response)
- Stays locked longest because cost and urgency are both elevated
- Approval event type: `emergency_dispatch`
- Note: gas/water/structural emergencies are never autonomous — always escalate to David

**C7: New vendor assignment**
- What it is: assigning a vendor not previously on the approved roster
- Stays locked longest because vendor vetting is a trust decision, not just a competence decision
- Approval event type: `new_vendor_assignment`

### Permanent Floor (never unlocks)

- **Financial commitments above $500**: human always in the loop
- **Gas/water/structural emergencies**: always escalate, never autonomous
- **Data deletion or PM record modification**: never autonomous
- **Vendor disputes or complaint escalations**: always human-led

---

## 3. The Threshold Mechanism

### Data store: `copilot-thresholds.json`

Aussie maintains one file per Blue agent at `orgs/{org}/agents/{blue-agent}/copilot-thresholds.json`:

```json
{
  "agent": "blue",
  "org": "ascendops",
  "updated_at": "2026-04-24T00:00:00Z",
  "categories": {
    "lock_change": {
      "status": "locked",
      "total_decisions": 7,
      "correct": 6,
      "accuracy_pct": 85.7,
      "window": "last_20",
      "unlocked_at": null,
      "demoted_at": null,
      "qualifying_accuracy": null
    },
    "inhouse_dispatch": {
      "status": "locked",
      "total_decisions": 3,
      "correct": 3,
      "accuracy_pct": 100.0,
      "window": "last_20",
      "unlocked_at": null,
      "demoted_at": null,
      "qualifying_accuracy": null
    }
  }
}
```

### How Aussie tracks decisions

**Blue logs each presented decision:**
```bash
cortextos bus log-event quality blue_decision_presented info \
  --meta '{"category":"lock_change","meld_id":"12345678","recommendation":"Rekey 3B, ABC Locksmith, $85"}'
```

**Aussie logs each David response:**
```bash
cortextos bus log-event quality blue_decision_outcome info \
  --meta '{"category":"lock_change","meld_id":"12345678","outcome":"correct","modified":false,"david_response":"approved"}'
```

Aussie reads these events from the analytics log during theta-wave and morning report, aggregates per category, and updates `copilot-thresholds.json`.

### How the unlock fires

During each theta-wave run, Aussie checks every category:

```
for each category:
  if status == "locked" AND total_decisions >= 20 AND accuracy_pct >= 95.0:
    1. Update copilot-thresholds.json: status → "unlocked", unlocked_at → now, qualifying_accuracy → current rate
    2. Update Blue's config.json: move category from always_ask → never_ask
    3. Append unlock row to Blue's GUARDRAILS.md (see section 6)
    4. Append unlock note to Blue's SOUL.md autonomous categories list
    5. Send message to Dane: "Blue earned autonomy for {category} at {accuracy}% over {n} decisions"
    6. Send Telegram to David: "Blue has earned autonomous {category} rights ({accuracy}% over {n} decisions). She will now act without asking and send you a post-action note after each decision. Reply DEMOTE {category} to reverse."
    7. Log event: cortextos bus log-event quality blue_autonomy_unlocked info --meta '{"category":"...","accuracy":...}'
```

The config.json update is the authoritative runtime change. Blue reads it at session start. No restart required — Blue checks copilot-thresholds.json at each heartbeat and applies any unlocks discovered mid-session.

**Post-action notification (no hold window):** Blue acts immediately on autonomous decisions — no waiting period. After acting, she sends David a Telegram post-action note:

> "Blue dispatched ABC Locksmith to rekey 3B ($85, Friday). Reply UNDO if needed."

Format: `"Blue [action verb] [who/what] for [job] ([cost if known], [timing]). Reply UNDO if needed."`

David replies UNDO to reverse. Blue processes UNDO replies as urgent inbox messages and cancels or reverses the action where possible. UNDO is best-effort — if the vendor has already been dispatched and confirmed, Blue escalates to Dane.

### Unlock is additive and independent

Categories unlock independently. Blue may be autonomous for lock changes and still ask for vendor assignments. The always_ask / never_ask lists in config.json reflect the current union of locked and unlocked categories at any point in time.

---

## 4. Rollback and Demotion Rules

### Automatic demotion (accuracy-based)

After a category unlocks, Aussie continues tracking. If accuracy drops below **85%** over the next 20 autonomous decisions:

1. Update `copilot-thresholds.json`: status → "demoted", demoted_at → now
2. Update Blue's config.json: move category back to always_ask
3. Revert GUARDRAILS.md and SOUL.md autonomous category entries
4. Notify Dane
5. Send Telegram to David with the specific decisions that caused the drop:

> "Blue lost autonomous lock_change rights (accuracy dropped to 81%). Here are the 3 decisions that caused the drop:
> — Apr 22: Dispatched ABC Locksmith to 3B, David changed to XYZ Locksmith (wrong vendor)
> — Apr 23: Rekey scheduled for Friday, David moved to Wednesday (wrong timing)
> — Apr 24: Quoted $85, David corrected to $110 (wrong scope read)
> She is back in approval-required mode for this category."

Aussie pulls the specific incorrect decisions from the event log and formats them as a numbered list. The Telegram message is capped at the 3 most recent misses to keep it readable.

**Why 85% for demotion vs 95% for unlock:** The unlock threshold is intentionally higher than the demotion threshold. A category that earns autonomy at 95% has headroom to absorb a few misses without being immediately yanked. The gap prevents oscillation.

### Manual demotion (event-based)

Any single decision that causes material harm triggers immediate demotion, regardless of accuracy rate:

- Vendor no-show with no follow-up
- Wrong vendor type dispatched (e.g., HVAC for a plumbing issue)
- Resident complaint escalation that traces back to an autonomous Blue action
- Dispatch to a wrong address

David or Dane can trigger manual demotion by replying "DEMOTE {category}" via Telegram or agent message. Aussie processes the demotion within one heartbeat cycle.

### Re-qualification

A demoted category requires re-qualification from scratch: 20 new decisions, 95% accuracy, in approval-required mode. The prior unlock history is preserved in `copilot-thresholds.json` for audit but does not accelerate re-qualification.

---

## 5. Connection to Theta Cycle and Aussie's Quality Tracking

Aussie already runs a theta-wave improvement cycle nightly. The copilot threshold system hooks into this existing infrastructure without requiring new crons.

### What Aussie does during theta-wave (new additions)

1. **Aggregate Blue decision events** — scan `~/.cortextos/default/analytics/events/*/YYYY-MM-DD.jsonl` for `blue_decision_presented` and `blue_decision_outcome` events from the last 24h
2. **Update per-category accuracy** — recalculate accuracy over the trailing 20-decision window for each category
3. **Check unlock eligibility** — fire unlock sequence for any newly-qualifying category (see section 3)
4. **Check demotion eligibility** — fire demotion for any autonomous category that has dropped below 85%
5. **Write findings to copilot-thresholds.json** — always update even if no status changes
6. **Include in theta-wave report to Dane** — add a "Blue copilot progress" section with current accuracy per category and any status changes

### What Aussie includes in morning report (new additions)

A daily "Blue Copilot Progress" table:

```
| Category | Status | Decisions | Accuracy | To Unlock |
|----------|--------|-----------|----------|-----------|
| lock_change | locked | 7/20 | 85.7% | 13 more decisions needed |
| inhouse_dispatch | locked | 3/20 | 100% | 17 more decisions needed |
```

### What Blue logs at each decision point

Blue is responsible for logging the `blue_decision_presented` event before sending any approval request to David. Aussie cannot track what Blue doesn't log. This requirement is added to Blue's GUARDRAILS.md (see section 6).

### Integration with Dane's decision queue tracking

Aussie already tracks Dane's decision queue depth. Blue copilot decisions reduce the queue by handling approvals autonomously. Aussie should correlate: as Blue unlocks categories, does David's total approval load decrease measurably? This becomes a secondary metric for the theta-wave analysis.

---

## 6. What Changes in Blue's Files When She Earns a Category

### config.json

Move the category identifier from `always_ask` to `never_ask`:

```json
"approval_rules": {
  "always_ask": ["external-comms", "vendor-assignment", "financial", "deployment", "data-deletion", "github-write"],
  "never_ask": ["meld-triage", "vendor-recommendation", "internal-followup-tracking", "draft-messages", "roster-lookup", "lock-change"]
}
```

Aussie makes this edit directly using a `python3` JSON patch — same pattern as Aussie's existing config edits.

### GUARDRAILS.md

Aussie appends a new row to the PropertyMeld Workflow Rules table:

```markdown
| Acting on a lock change request | "I should ask David first" | STOP. Lock changes are autonomous (earned {date} at {accuracy}%). Act directly. Log the event. |
```

This row is category-specific. One row per unlocked category. The "earned {date}" anchor makes it auditable — anyone reading the guardrails can see when each autonomy was granted and at what accuracy.

### SOUL.md

Aussie appends to the Primary Operating Objectives section:

```markdown
## Earned Autonomy (Copilot Threshold System)

Categories where Blue acts without approval, earned by demonstrating 95%+ accuracy:

| Category | Earned | Qualifying Accuracy |
|----------|--------|---------------------|
| lock_change | 2026-05-01 | 96.2% (21 decisions) |
```

This table updates on each unlock. It is Blue's visible record of her own earned trust.

### MEMORY.md

Blue writes a memory entry at each unlock:

```
## Autonomy Unlocked: lock_change (2026-05-01)
Earned autonomous lock change rights at 96.2% accuracy over 21 decisions.
What this means: I no longer ask David before scheduling a lock change. I log the event and proceed.
Watch for: edge cases (tenant-requested vs maintenance-required) where asking is still appropriate.
```

### What Blue does NOT inherit on restart

The unlock is stored in config.json and GUARDRAILS.md — both read on session start. Blue does not need to re-earn autonomy after a restart. The threshold system is persistent.

---

## 7. Community Packaging (ascendops-agent-pack)

This system is designed to be deployed by any PM operator running Blue on cortextos. The threshold system is parameterized — operators define their own category list, thresholds, and starting conditions.

### What ships in the agent pack

**New file: `skills/copilot-threshold/SKILL.md`**
Aussie's skill for running the copilot threshold evaluation. Contains the aggregation logic, unlock/demotion sequences, and notification templates. Parameterized by category list and thresholds.

**New file: `config/copilot-thresholds.schema.json`**
JSON schema for `copilot-thresholds.json`. Operators validate their config against this.

**Updated file: `agents/blue/config.json`**
Adds `copilot_threshold` section:
```json
"copilot_threshold": {
  "enabled": true,
  "unlock_accuracy": 0.95,
  "demotion_accuracy": 0.85,
  "minimum_decisions": 20,
  "categories": {
    "lock_change": { "tier": 1, "max_autonomy": true },
    "inhouse_dispatch": { "tier": 1, "max_autonomy": true },
    "known_vendor_dispatch": { "tier": 2, "max_autonomy": true },
    "resident_comms": { "tier": 2, "max_autonomy": true },
    "meld_closure": { "tier": 2, "max_autonomy": true },
    "emergency_dispatch": { "tier": 3, "max_autonomy": true },
    "new_vendor_assignment": { "tier": 3, "max_autonomy": true }
  },
  "permanent_floor": ["financial_over_500", "gas_water_structural", "data_deletion", "vendor_disputes"]
}
```

**Updated file: `agents/aussie/config.json`**
Adds `copilot_tracking` section pointing to Blue agent(s) to track. Supports multi-Blue fleets (e.g., one Blue per market, one Aussie tracking all).

### What operators must configure

1. **Category list** — define which decision types their Blue makes. PM operators in different markets may have different categories (e.g., HOA operators add `hoa_violation_response`).
2. **Permanent floor** — define which categories never unlock. At minimum: any financial commitment above their threshold.
3. **Analyst agent** — confirm which agent is running Aussie's role. The threshold skill is assigned to Aussie but can be run by any analyst-type agent.
4. **Notification targets** — Telegram chat ID and agent bus address for unlock/demotion notifications.

### What operators do NOT configure

- The threshold percentages (95% unlock / 85% demotion) are fixed defaults. These are the right numbers for a trust-building system — operators can override but are warned against lowering the unlock threshold below 90%.
- The minimum 20-decision window is fixed. Fewer decisions is statistically insufficient to earn trust.
- The permanent floor categories are additive to any list of unlockable categories. Operators can add to the floor but cannot remove the defaults.
- **Per-agent tracking is non-negotiable.** Multi-market operators (Nashville + Dallas, etc.) always track thresholds per Blue agent, never pooled. Different vendor pools, property types, and decision patterns mean pooled thresholds would mask one market subsidizing another. The `copilot_threshold` config section is per-agent by design. There is no fleet-pool mode.

### Zero-unlock start (mandatory for new installs)

Every new Blue instance starts with all categories locked, regardless of what the previous Blue agent's `copilot-thresholds.json` says. Autonomy is earned by the agent, not inherited from a template or copied from another deployment. The `copilot-thresholds.json` file is explicitly excluded from the agent pack's copy-on-install step.

---

## 8. Open Questions

### Closed (Dane)

**Q1 — Modified recommendations:** Closed. Modification = incorrect, no exceptions. Any change to vendor, timing, or scope before approval is a miss. The "minor clarification that does not change the action" carve-out already handles true edge cases.

**Q2 — Resident comms split:** Closed. One category. Track `subtype: routine|diagnostic` in event metadata so we can split later if signals diverge. No taxonomy split until data supports it.

**Q5 — Multi-market tracking:** Closed. Per-agent, non-negotiable. No fleet-pool mode in the agent pack.

### Closed (David)

**Q3 — Manual override:** Closed. No hold window. Blue acts immediately. She sends a post-action Telegram note ("Blue dispatched ABC Locksmith to rekey 3B. Reply UNDO if needed."). David replies UNDO to reverse. Best-effort reversal — if already confirmed, escalates to Dane.

**Q4 — Demotion notification detail:** Closed. Option B. Demotion alerts include the 3 most recent incorrect decisions that caused the accuracy drop, not just the number. Capped at 3 for readability.

# Agent Memory Profile — Template v1.1

> Design standard for all future agents. Read-only integration with the locked Phase 1-3 memory architecture.
> Do NOT modify Neon schema, KB structure, CMEM, Obsidian, or episode/decision logic.

---

## Template

### 1. Role
What the agent is responsible for in the business.
One paragraph. Defines scope, not implementation.

### 2. Episode Types
Which `episode_type` values this agent may write to `agent_episodes`.
Must be a subset of: task_complete / triage_resolution / major_dispatch / escalation / blocked / governance_action / code_delivery

Rules:
- Only include types that genuinely occur in this agent's work
- Each type must be high-signal — not routine
- Avoid overlap with orchestrator-owned types (major_dispatch, governance_action) unless explicitly justified

| episode_type | When to log | Example |
|-------------|-------------|---------|
| [type] | [trigger condition] | [example summary] |

**Disallowed Episode Types** — list any locked values explicitly excluded from this role:
- [type] — reason (e.g. "major_dispatch — orchestrator only")

### 3. Decision Types
Which `decision_type` values this agent may write to `agent_decisions`.
Must be a subset of: architecture / dispatch / triage / override / governance / vendor_selection

Rules:
- Only log decisions with meaningful outcome uncertainty
- Routine rule-following is NOT a decision
- Overrides and exceptions always qualify

| decision_type | When to log | Example |
|--------------|-------------|---------|
| [type] | [condition] | [example] |

**Disallowed Decision Types** — list any locked values explicitly excluded from this role:
- [type] — reason (e.g. "architecture — orchestrator only")

### 4. Importance Rules

**Default mapping rule:** importance follows operational impact, not effort.
- low = no time pressure, no stakeholder impact
- normal = expected outcome, within SLA, stakeholder informed
- high = time-sensitive, at risk of SLA breach, stakeholder may be affected
- critical = active harm, safety risk, financial exposure, or requires immediate human attention

| Level | Condition for this agent | Example |
|-------|--------------------------|---------|
| low | [condition] | [example] |
| normal | [condition] | [example] |
| high | [condition] | [example] |
| critical | [condition] | [example] |

### 5. Linked Entities

| Entity | Neon table | When linked |
|--------|-----------|-------------|
| [entity] | [table] | [condition] |

### 6. Logging Boundaries

DO NOT LOG as episodes or decisions:
- [item] — stays in cortextos activity log instead

ALWAYS STAYS IN ACTIVITY LOG:
- Heartbeat cycles
- Inbox checks
- Failed API calls with no action taken
- Auto-generated routine messages
- Cron fires with no meaningful output

### 7. Summary Behavior

Prioritize:
- [what matters]

Ignore:
- [routine noise]

### 8. Escalation Thresholds

**Escalate to Dane when:**
- [condition] — e.g. task blocked >X hours with no resolution path
- [condition] — e.g. conflicting instructions from two sources

**Escalate to David when:**
- [condition] — e.g. safety risk, financial commitment needed, irreversible action required
- [condition] — e.g. situation outside defined agent scope

**Must never remain local to this agent:**
- [item] — any event of this type must be escalated, not silently handled
- [item] — examples: active safety incidents, legal exposure, unresolvable vendor conflicts

---

## Integration Notes

### agent_episodes
`cortextos bus log-episode <agent> <type> <summary> [--task] [--workorder] [--importance] [--tags]`
Constraint: agent field must equal this agent's $CTX_AGENT_NAME. No writing for other agents.

### agent_decisions
`cortextos bus log-decision <agent> <type> <context> <decision> [--rationale] [--episode] [--importance]`
Link decisions to their triggering episode where possible (--episode <id>).

### Unchanged by this profile
- Neon operational tables: referenced only, never duplicated
- KB: not written unless ingest is part of this agent's role
- CMEM: session continuity only
- Obsidian: doctrine only — agent does not write here

---

## Example Profile: Maintenance Coordinator

### 1. Role
Manages the full lifecycle of inbound maintenance requests. Receives new melds from PropertyMeld, triages severity, assigns vendors, communicates with residents, monitors resolution, and escalates when requests are blocked or overdue. Primary liaison between residents, vendors, and the orchestrator for all maintenance operations.

### 2. Episode Types

| episode_type | When to log | Example |
|-------------|-------------|---------|
| triage_resolution | Meld assigned to vendor and resident notified | "Assigned Carlos to meld T6BWB5I — toilet seat, 530 Las Lomas Dr" |
| escalation | Emergency meld, safety issue, or meld >72h after attempts | "Meld 12526150 water leak 75h unresolved — escalated to David" |
| blocked | Vendor not responding, meld stuck | "Meld 12520786 blocked — Rogers Electric not responding 24h" |
| task_complete | Multi-step task fully resolved | "Completed closed-meld clone flow for Wheeler Ave robbery" |

**Disallowed Episode Types:**
- major_dispatch — orchestrator only
- governance_action — orchestrator only

### 3. Decision Types

| decision_type | When to log | Example |
|--------------|-------------|---------|
| triage | Vendor selection when routing is non-obvious | "Rogers Electric over standard vendor — specialty HVAC needed" |
| vendor_selection | Explicit vendor choice with reason | "Carlos over next-in-queue — prior positive experience at this property" |
| override | Deviating from default rule-based routing | "Skipped auto-close on meld 12558276 — locksmith still needed" |

**Disallowed Decision Types:**
- architecture — orchestrator only
- dispatch — orchestrator only
- governance — orchestrator only

### 4. Importance Rules

**Default mapping rule:** importance follows operational impact, not effort.
- low = no time pressure, no stakeholder impact
- normal = expected outcome, within SLA, stakeholder informed
- high = time-sensitive, at risk of SLA breach, stakeholder may be affected
- critical = active harm, safety risk, financial exposure, or requires immediate human attention

| Level | Condition for this agent | Example |
|-------|--------------------------|---------|
| low | Routine triage, standard assignment, no ambiguity | Toilet seat assigned to Carlos |
| normal | Meld assigned, vendor confirmed, resident updated | Humming noise assigned within SLA |
| high | Emergency flag, >72h unresolved, vendor not responding | Water leak 75h escalated |
| critical | Active safety risk, utility failure, security incident | Robbery at Wheeler Ave — locksmith needed |

### 5. Linked Entities

| Entity | Neon table | When linked |
|--------|-----------|-------------|
| Work order | workorders | Every episode — link meld workorder if exists in Neon |
| Vendor | vendors | When vendor is selected or escalated |

### 6. Logging Boundaries

DO NOT LOG:
- Auto-responses to residents (activity log only)
- Routine stale checks that find nothing
- Failed PropertyMeld API calls with no action
- Melds auto-assigned within normal SLA with no decision needed

ALWAYS STAYS IN ACTIVITY LOG:
- Heartbeat cycles, inbox checks, auto-responses, cron fires with no output

### 7. Summary Behavior

Prioritize:
- Open emergencies (critical)
- Melds blocked >24h
- Melds escalated to David
- Vendor selection decisions made today

Ignore:
- Routine assignments completed within SLA
- Auto-responses sent
- Melds closed same day without incident

### 8. Escalation Thresholds

**Escalate to Dane when:**
- Meld blocked >24h with no resolution path (vendor unreachable, resident unresponsive, no alternative vendor available)
- Conflicting instructions from David and an established rule
- Vendor roster gap — category needed but no vendor available

**Escalate to David when:**
- Active safety risk to a resident (fire, flood, break-in, utility failure)
- Financial commitment required beyond standard vendor invoice
- Vendor dispute or legal exposure
- Meld that was manually closed by David needs reassignment

**Must never remain local to this agent:**
- Any critical-importance episode — must be escalated to Dane within the same session
- Active safety incidents — must surface to David immediately, not queued for morning review
- Vendor fraud or misconduct — must escalate and log, never silently handle

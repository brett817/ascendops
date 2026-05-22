# Agent Deployment Standard
**Version:** 1.0  
**Effective:** 2026-04-19  
**Authority:** David Hunter (AscendOps)  
**Enforced by:** Dane (orchestrator)

---

## Purpose

No new agent may be deployed to the AscendOps fleet until this standard is completed and approved by David. This gate exists to ensure every agent has a defined role, memory architecture, and decision boundary before it interacts with live operational data.

---

## Required Before Deployment

### 1. Agent Memory Profile (AMP)
Complete the template at `orgs/ascendops/docs/agent-memory-profile-template.md`.

Confirm:
- [ ] Which memory layers the agent reads (daily memory, MEMORY.md, KB, CMEM, secure-local)
- [ ] Which memory layers the agent writes
- [ ] Whether the agent creates any parallel truth store (must be: **no**)
- [ ] Where sensitive data (credentials, PII) is stored and access controls applied

### 2. Role Definition
- [ ] Agent name and emoji
- [ ] Primary role in one sentence
- [ ] What specialist work this agent owns
- [ ] What this agent explicitly does NOT do (boundary with other agents)
- [ ] Who this agent reports to (escalation path)

### 3. Episode and Decision Boundaries
Define the scope of autonomous action:
- [ ] What decisions the agent can make without approval
- [ ] What decisions require David approval (always_ask list)
- [ ] What triggers escalation to Dane
- [ ] Maximum blast radius of any single autonomous action

### 4. Entity Definition
- [ ] Which external systems the agent reads from
- [ ] Which external systems the agent writes to or takes actions in
- [ ] What constitutes a "completed task" for this agent

### 5. Importance Rules
- [ ] What events warrant an immediate Telegram alert to David
- [ ] What events warrant a message to Dane only
- [ ] What events are logged silently

### 6. Escalation Thresholds
- [ ] Stale heartbeat threshold before Dane hard-restarts (default: 8h / 2 missed cycles)
- [ ] Context threshold for proactive reset (default: 70%)
- [ ] Error rate or crash threshold before David is alerted

---

## Approval Process

1. Dane reviews completed AMP + deployment checklist
2. Dane sends summary to David via Telegram
3. David approves or requests changes
4. Only after explicit David approval: `cortextos start <agent>`

---

## Template

```
Agent Name: 
Role (one sentence): 
Emoji: 
Reports to: dane

## Memory Layers
Reads: 
Writes: 
Parallel truth store: no

## Role Boundaries
Owns: 
Does NOT do: 

## Decision Boundaries
Autonomous: 
Requires David approval: 
Escalates to Dane when: 
Max blast radius: 

## Entity Definition
Reads from: 
Writes to / acts in: 
Task complete when: 

## Importance Rules
Immediate David alert: 
Dane-only: 
Silent log: 

## Escalation Thresholds
Stale restart: 8h
Context reset: 70%
Crash alert: 

## Approval
Reviewed by Dane: 
Approved by David: 
Deploy date: 
```

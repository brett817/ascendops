# AscendOps Fleet Governance Policy
**Version:** 1.0  
**Effective:** 2026-04-19  
**Authority:** David Hunter  
**Enforced by:** Dane (orchestrator)

---

## Mandatory Gates

### Gate 1 — Agent Deployment
**No new agent may be deployed until:**
- Agent Deployment Standard is completed (`docs/agent-deployment-standard.md`)
- Agent Memory Profile is completed (`docs/agent-memory-profile-template.md`)
- Dane has reviewed both documents
- David has given explicit written approval via Telegram

Dane will reject any deployment request that arrives without a completed standard.

### Gate 2 — Software Integration
**No new software may be adopted into agent workflows until:**
- Software Integration Standard is completed (`docs/software-integration-standard.md`)
- Dane has reviewed the document
- David has given explicit written approval via Telegram

Agents may not begin using a new platform operationally until approval is on record.

---

## Standards Documents

| Document | Location | Purpose |
|----------|----------|---------|
| Agent Deployment Standard | `docs/agent-deployment-standard.md` | Gate for new agents |
| Agent Memory Profile Template | `docs/agent-memory-profile-template.md` | Memory architecture for new agents |
| Software Integration Standard | `docs/software-integration-standard.md` | Gate for new software/platforms |

---

## Doctrine Layer Placement

These documents are **canonical doctrine**:
- Primary location: `orgs/ascendops/docs/` (version-controlled)
- Mirror: `AscendOps-Brain/00-Governance/` (Obsidian — for human review)
- KB: ingested into `shared-ascendops` collection so agents can query them

They are **not** stored in agent memory files. Memory files are ephemeral. These are durable policy.

---

## Amendment Process

Changes to any standard require:
1. Dane drafts proposed change with rationale
2. David approves via Telegram
3. Version number incremented, effective date updated
4. Existing agents notified via send-message if the change affects their operations

# Pre-Change Protocol
**Version:** 1.0  
**Effective:** 2026-04-19  
**Authority:** David Hunter (AscendOps)  
**Enforced by:** Dane (orchestrator)

---

## Purpose

A targeted safety rule for modifying high-risk code zones. Does not apply to general code changes.

---

## Rule: Is This File in a High-Risk Zone?

Check `orgs/ascendops/docs/high-risk-change-zones.md`.

The five high-risk files are:
- `src/utils/atomic.ts`
- `src/daemon/agent-process.ts`
- `src/daemon/fast-checker.ts`
- `src/daemon/agent-manager.ts`
- `src/bus/message.ts` (HMAC layer)

---

## If YES — High-Risk Zone

Before making any changes, agents must complete all four steps:

1. **Graphify structure review** — run `/graphify query "<module name>"` to see what else connects to this file and where changes will ripple
2. **Governance-check** — confirm the change does not affect agent roles, memory boundaries, or integrations without approval
3. **Review doctrine note** — read the entry for this file in `high-risk-change-zones.md` (risk level, known failure modes, what to check)
4. **Verify tests exist** — confirm the relevant test file is present and covers the behavior being changed. If not, write the test first.

Then proceed with the modification.

---

## If NO — All Other Code Changes

Run governance-check only. Proceed normally. The full four-step flow does not apply.

---

## Notes

- This rule is intentionally narrow. Most code changes do not trigger it.
- The high-risk file list lives in `high-risk-change-zones.md` — that document is the source of truth, not this one.
- If a change spans both a high-risk file and other files, the high-risk protocol applies to the full changeset.

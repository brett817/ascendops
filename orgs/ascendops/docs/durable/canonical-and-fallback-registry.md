# Canonical & Fallback Registry

**Author:** Aussie
**Date:** 2026-04-29
**Status:** Living registry — every Stage 3-RETAINED-AS-FALLBACK classification recorded here
**Audit cadence:** quarterly, paired with `mcp-stage-classification-<date>.md`

---

## 1. Why This Doc Exists

David's instinct (2026-04-29): critical infrastructure deserves vendor diversity. When the canonical primary tool fails, having an uncorrelated fallback prevents a fleet-wide outage. The schema-tax of keeping the fallback installed is an insurance premium.

The risk this doc guards against is **silent retirement on next audit.** A fallback MCP/CLI sitting installed-but-unused looks like cruft to a future maintainer. Without naming the diversity intentionally, someone audits, sees zero invocations, and removes it — and the next time the canonical tool fails, the fleet is down with no recovery path.

This registry names every canonical-and-fallback pair with explicit reason. It pairs with RFC #16 §4.1 (Stage 3-RETAINED-AS-FALLBACK category) and `mcp-stage-classification-<date>.md` (per-MCP audit). Future audits read this doc first; if a tool appears here, do NOT retire on usage-zero alone.

---

## 2. Capability Registry

| Capability domain | Canonical tool | Fallback tool | Stage of fallback | Why we keep fallback |
|---|---|---|---|---|
| Google Workspace (Gmail / Calendar / Drive) | `gws` CLI | `claude_ai_Gmail` + `claude_ai_Google_Calendar` + `claude_ai_Google_Drive` MCP trio (session-injected) | Stage 3-RETAINED-AS-FALLBACK | Different vendor (Google direct vs Anthropic-mediated). Uncorrelated failure modes — Google outage doesn't propagate to Anthropic, Anthropic outage doesn't propagate to Google. ~0.1% cap schema-tax accepted as insurance premium. Technically un-removable anyway (session-injected, RFC #16 §3.5). |
| Memory (cross-session search/recall) | `claude-mem` MCP (Stage 1 eternal — primary IS the MCP) | `mcp2cli` wrapper (installed inert) | N/A — wrapper not adopted | mcp2cli was tested per Collie's NN doc but parity gaps + <0.1% savings made it not worth adopting. Wrapper stays installed as "tested-but-unused fallback path" — if claude-mem MCP breaks, mcp2cli is the documented escape hatch. NO active dual-tool pattern. |
| Property Meld operations | `pm` CLI via snapcli (Nexus API + cookie capture per `pm_cli_session_method.md`) | Manual web UI (David in Safari) | Human fallback | If snapcli auth breaks AND cookie recapture fails AND we need a meld update RIGHT NOW, David does it manually in browser. Documented escape hatch, not a tool we install. |
| PropertyMeld photo/file capture | `pm work-orders files` (Apr 28 ship) | None | None — single point of failure today | **Documented gap.** If the Nexus API path or cookie auth breaks, no fallback to retrieve files. Browser screenshot is the only manual escape hatch. Worth flagging for future hardening. |
| AppFolio operations | `af` CLI via snapcli | Manual web UI | Human fallback | Same pattern as PM. AppFolio API permanently blocked per `project_appfolio_no_api.md`, so the manual fallback is the only true alternative. |
| Property Meld session capture (auth) | `pm-recapture-session-safari.py` (Safari binary cookies) | `pm-recapture-session-playwright.py` (cross-platform browser drive) | Stage 3 active fallback | Both scripts ship; safari path is primary on macOS; playwright path is the cross-platform / Linux fallback. Same vendor (still PM API), different mechanism (binary cookie file vs browser session). |
| Browser automation (general) | `from playwright.sync_api import ...` Python lib + `@playwright/cli` codegen | `pyobjc + AXUIElement` (macOS Accessibility) | Investigated, not adopted | Per `ax-pyobjc-vs-playwright-scope.md`, pyobjc was scoped as alternative. Playwright won on portability + maintainability. pyobjc is documented-not-adopted; revisit if Playwright proves problematic. |
| Code execution / writing | Codex (via `codex-rescue` plugin) | Self-write by Collie / Aussie | Mode-fallback (Stage 1 → Stage 3 same agent) | When Codex is unavailable (Mode 1 OpenAI cap, Mode 2 sandbox blocks /projects/*), agents self-write. Not a separate-tool fallback — the agent IS the fallback. Documented in `pacing-rules.md`. |

---

## 3. Diversity Principle

When does a capability deserve fallback diversity? Cost/benefit threshold:

**KEEP a fallback if:**
- The capability is critical infrastructure (loss blocks fleet operations, not just a single feature).
- The fallback is from a different vendor or different mechanism (vendor-locked fallback ≠ diversity).
- The fallback's schema-tax / install cost is bounded and small (single-digit %).
- The technical removal cost is high OR removal is impossible (session-injected, harness-managed).

**DON'T keep a fallback if:**
- Same vendor (no diversity benefit). Use one or the other; don't double-pay.
- High-frequency exploratory tool (it's a primary, not a fallback).
- Schema-tax materially affects cap pressure (single-digit % is fine, double-digit % needs justification).
- Removal is trivial AND the canonical tool has independent redundancy elsewhere (e.g. retries, cache).

**The framing:** "if the canonical tool dies for 30 minutes during peak ops, what does the fleet do?" If the answer is "nothing, we wait" → fallback is worth its weight. If the answer is "no impact, the cron retries in 30 min" → no fallback needed.

This formalizes the Aussie integration-roadmap §4 honest-take (Stage 3 dependency hardening) plus David's instinct (intentional vendor diversity for critical infra). Both arrived independently at the same threshold.

---

## 4. Anti-Patterns

Three failure modes the registry guards against:

1. **Keeping ALL old tools forever ("just-in-case clutter").** Every legacy tool gets nostalgia-retained. Schema-tax compounds. Symptom: fleet boots are slow, tool-search returns 50 results for any query, no one remembers which is canonical. **Mitigation:** registry is opt-in; only documented fallbacks stay. Undocumented duplicates retire on next audit.
2. **Retiring without alternative (single-point-of-failure).** Canonical tool ships, MCP retires same day, no fallback declared. First outage takes the fleet down. **Mitigation:** Stage 3 retirement requires either explicit fallback registration OR explicit "no fallback acceptable" justification. We accept SPOFs only when documented.
3. **Fallback that uses same vendor (no diversity).** "Gmail MCP fallback to Gmail API direct" — same vendor, correlated failures. **Mitigation:** vendor-diversity check in the registry. The "Why we keep fallback" column must name the uncorrelation reason.

---

## 5. Audit Cadence

- **Quarterly:** review registry alongside `mcp-stage-classification-<date>.md`. For each entry: validate the canonical tool still works, validate the fallback is still reachable, validate the diversity reason still holds.
- **On canonical-tool change:** if the canonical tool is replaced (e.g. `gws` v1 → `gws` v2), re-evaluate whether the existing fallback still applies.
- **On vendor change:** if a fallback's vendor changes (Anthropic restructures the claude.ai integration, or Google ships a different API surface), re-evaluate.
- **Update mechanism:** edit this doc directly. Cite the change date inline next to the affected row.

Default rhythm: pair with `mcp-stage-classification` audit (next: 2026-05-29). Add to Aussie's quarterly cron alongside that audit.

---

## 6. Open Questions for David

1. **PropertyMeld photo/file capture (§2 row):** documented as single-point-of-failure today. Worth investing in a fallback (e.g. browser-screenshot script via Playwright codegen)? Lean: defer until first outage demonstrates the gap is operationally painful.
2. **Memory fallback (§2 row 2):** mcp2cli is "installed inert." Should we explicitly UNINSTALL it to avoid drift, or keep installed-tested-not-adopted as a known escape hatch? Lean: keep — install cost was already paid.
3. **Threshold tuning (§3):** "single-digit % schema-tax = fine, double-digit % = needs justification" — is 10% the right break? Lean: yes, but revisit if cap pressure changes.
4. **Documented manual fallbacks (PM / AppFolio web UI):** worth listing explicitly here, or implicit since David IS the human fallback for everything? Listed for completeness; argument for either.

---

## 7. Cross-References

- **RFC #16 §4.1** (`rfc-16-mcp-prototype-to-cli-production.md`): Stage 3-RETAINED-AS-FALLBACK category definition.
- **RFC #16 §3.5**: session-injected MCPs removability gap.
- **`mcp-stage-classification-2026-04-29.md`** §3: stage-transition record showing the claude.ai trio reversal.
- **`integration-roadmap-2026-04-29.md`** §4 honest-take: original Aussie flag of dependency-hardening concern.
- **`pacing-rules.md`**: Codex Mode 1 / Mode 2 / self-write fallback chain.
- **`cron-ownership.md`** §6: RR ledger entry closed by SS.

---

## Word count: ~960 (within 600-1000 target)

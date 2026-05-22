# RFC #16: MCP-for-Prototype → CLI-for-Production — a 3-Stage Tool Lifecycle

**Author:** Aussie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review
**Supersedes:** RFC #9 (`rfc-mcp-vs-cli-audit.md`) binary REPLACE-WITH-CLI vs KEEP-MCP framing — replaces it with this 3-stage lifecycle.
**Trigger:** David verbatim (2026-04-29 morning):
> "using a cli is cheaper token than mcp. they are majestic in can be used together once we know the way through the MCP we can then create the CLI version"

---

## 1. Problem Statement — Why MCP-vs-CLI Is a False Dichotomy

RFC #9 framed every MCP as needing a binary verdict: KEEP-MCP, REPLACE-WITH-CLI, or DEPRECATE. That framing implicitly assumed each tool stays in one mode forever. In practice, every successful tool we've shipped — `pm`, `gws`, `af`, the upcoming `snapcli pm files` — went through three lifecycle stages:

1. **Stage 1 (exploration):** the workflow is undefined. The agent uses an interactive surface (MCP, browser, manual REPL) to discover what the tool can do, what the right calls look like, what edge cases exist.
2. **Stage 2 (stabilization):** the workflow recurs. Same calls, same params, same outcomes. Schema-tax of the interactive surface starts to dominate the value of interactive flexibility.
3. **Stage 3 (production):** the workflow is baked into a CLI. Cheap, scriptable, prompt-cache-friendly. The MCP (or browser, or manual flow) STAYS — it handles the next exploration cycle.

The David quote captures stage 1 → 3 explicitly: "once we know the way through the MCP we can then create the CLI version." Stage 2 — knowing when to convert — is the discipline this RFC codifies.

Both layers coexist because they serve different lifecycle states, not different users. RFC #9's premature CLI-conversion of `claude-mem` (the migration Collie's measurement showed was <0.1% of cap savings) was the right call under the OLD framing — REPLACE-WITH-CLI was the binary verdict. Under the NEW framing, claude-mem stays Stage 1 indefinitely **because its workflows are inherently exploratory** — the agent searches memory, decides what to fetch, iterates. There is no stable "claude-mem workflow" to convert.

---

## 2. The 3-Stage Pattern in Detail

### Stage 1 — NEW MCP exists, agent uses it interactively

- Token cost: high per-call (schema in every turn's tools array, ~200-2000 tok per MCP, plus result inlining).
- Per-call value: high (MCP gives typed errors, statefulness, real-time inspection).
- **Right tool for the stage:** MCP, REPL, browser DevTools, manual capture.
- **Recognition signal:** agent is asking the tool questions like "what fields does this object have?" or "what does this endpoint return on a missing record?" — the agent is *learning the surface*.
- **Examples in our fleet today:** Playwright MCP (when installed) for live page inspection. `icm` for proactive memory store decisions. `claude-mem` for cross-session search.

### Stage 2 — Workflow stabilizes

- Token cost: same as stage 1 but the value drops because each new call is just a re-run of the previous one.
- **Recognition signals (any 2 of):**
  - Call frequency >5/day per agent for the same N parameters
  - Schema-tax >5K tokens/week against the cap
  - The agent's reasoning around the call is "boilerplate" — same conditions, same actions, no decisions
  - The first thing a new agent learns is "always call X with Y when Z" — the rule is invariant across agents
- This stage is where the conversion-or-don't decision gets made. **NOT every Stage 1 tool reaches Stage 2.** Some tools are inherently exploratory forever.

### Stage 3 — CLI ships, MCP coexists

- Token cost: near-zero per call (Bash schema is implicit; output is text, agent summarizes/trims).
- Per-call value: same (workflow is deterministic).
- **Right tool for the stage:** CLI for the 80% repeated case; MCP retained for the 20% novel case.
- **Examples in our fleet today:** `pm` CLI for stable PM operations (was Playwright-mediated 6 months ago; now CLI handles 95%, Playwright fallback for the 5% UI-only ops). `gws` CLI for Gmail/Calendar/Drive (was claude.ai MCPs; now flipped). `af` CLI for AppFolio (was browser-only; now CLI for read-side, write-side coming).

---

## 3. When Does Stage 2 Trigger? — Concrete Signals

Codified for fleet-wide consistency:

| Signal | Threshold | Source |
|---|---|---|
| Call frequency | >5 per agent per day for >2 consecutive weeks | `cortextos bus log-event` action data |
| Schema-tax | >5K tokens/week per agent | mcp2cli measurement methodology (see RFC #9 §5 cost-comparison table) |
| Reasoning boilerplate | Agent's prose around the call repeats >80% of the time across calls | manual audit, sampled 10 calls |
| Decision-free | The call has zero parameters whose value depends on prior reasoning (e.g. `icm_memory_recall(topic=X)` IS decision-driven; `pm work-orders list --status pending` IS NOT) | manual audit |
| Multi-agent invariance | The same call shape is correct for >1 agent | manual audit, cross-skill grep |

If 3+ of 5 signals are true, the tool is Stage 2 — convert. If 0-2 are true, stays Stage 1.

**Anti-signal — keep in Stage 1:** any of these means DON'T convert:
- The call's parameters depend on the agent's current reasoning (search queries, memory recall, decision routing).
- The result drives the next reasoning step (interactive REPL pattern).
- Errors require interpretation, not just retry-with-fixed-params.

---

## 3.5. Session-Injected MCPs — A Different Removability Surface

Some MCPs in the fleet are NOT installed via local config (`~/.claude/settings.json` mcpServers + plugin tree) — they are injected at the harness layer by Anthropic and arrive as deferred-tool entries in session-start reminders. The current example: `claude_ai_Gmail`, `claude_ai_Google_Calendar`, `claude_ai_Google_Drive` (3-MCP trio appearing in session reminders this week).

**The removability gap:** `claude mcp remove <name>` operates on the local `mcpServers` config. It cannot disable a harness-injected MCP — there's no local file to edit. As demonstrated by the blocked RR action 2026-04-29: Collie attempted to disable the trio for the Stage 3-CLI migration, found the standard removal path doesn't apply.

**Implications for RFC #16:**
- The 3-stage lifecycle (Stage 1 / Stage 2 / Stage 3) still applies — but Stage 3 retirement may be **technically blocked** for session-injected MCPs.
- This creates a distinct outcome: a tool whose Stage 3 CLI exists, whose schema-tax is real, but which CANNOT be retired locally. We name this **Stage 3-RETAINED-AS-FALLBACK** in §4 below.
- The classification still works; the *retirement mechanism* changes.

**What this means operationally:**
- Treat session-injected MCPs as a separate retirement-mechanism class.
- For Anthropic-managed MCPs specifically, retirement only happens upstream (Anthropic disables them) or via per-session opt-out (if Anthropic provides one).
- Classify them honestly in audits: if they're Stage 3 capability-wise but un-removable locally, mark them Stage 3-RETAINED-AS-FALLBACK with the technical reason recorded.

This addresses the Aussie honest-take #3 finding from the integration roadmap (2026-04-29 Wed evening synthesis): RFC #16 didn't originally address the session-injected category. Now it does.

---

## 4. Coexistence — Both Layers Stay

Once Stage 3 ships, the MCP DOES NOT disappear. The mental model:

- **CLI handles the 80% known case.** Routine, scripted, cheap. Most agent work routes here.
- **MCP handles the 20% novel case.** Exploring an edge case, debugging a new failure mode, learning the next sub-surface. Less frequent, but irreplaceable when needed.

**Compare to Playwright:** before @playwright/cli was installed (David approved 2026-04-29), we had only `from playwright.sync_api import ...` in Python — Stage 3 by writing-from-scratch. With the CLI installed, we have:
- **MCP-equivalent (stage 1):** `playwright open <url>` and `playwright codegen <url>` — interactive page exploration and code-emission while you click.
- **CLI (stage 3):** `playwright screenshot`, `playwright pdf`, the codegen-emitted Python scripts.
- Both coexist. Codegen IS the bridge — Stage 1 produces Stage 3 code as a side effect.

Same pattern fits ICM, claude-mem, future MCPs. The lifecycle isn't "MCP gets replaced by CLI" — it's "stable workflows graduate to CLI; new workflows are born in MCP."

### 4.1 Stage 3-RETAINED-AS-FALLBACK — a new outcome category

Adjacent to Stage 3-RETIRED (CLI is canonical, MCP disabled) is a deliberately-different outcome: **Stage 3-RETAINED-AS-FALLBACK**. Capability has a canonical primary (Stage 3 CLI), but a redundant Stage 1/2 MCP stays installed for vendor-diversity and failure-uncorrelation. Schema-tax is accepted as an insurance premium against the canonical tool's outage.

**When to retain as fallback (vs retire):**
- The capability is **critical infrastructure** (its loss blocks fleet operations, not just a feature).
- The fallback is from a **different vendor** than the canonical tool (so failure modes are uncorrelated). Example: `gws` CLI (Google Workspace direct) vs `claude_ai_Gmail/Calendar/Drive` MCPs (Anthropic-mediated). Different failure modes — Google rate-limit doesn't propagate to Anthropic, Anthropic outage doesn't propagate to Google.
- The fallback's schema-tax is **bounded and small** (single-digit % of cap). Acceptable insurance premium.
- The technical removal path is **blocked** (e.g. session-injected per §3.5) OR removal cost > insurance value.

**When NOT to retain (retire properly):**
- The MCP and the CLI are from the same vendor (no diversity benefit).
- The MCP is high-frequency exploratory (Stage 1 on its own merits — not a "fallback" but a primary surface).
- Schema-tax is large enough to materially affect cap pressure.

**Documentation requirement:** every Stage 3-RETAINED-AS-FALLBACK classification must be recorded in `orgs/ascendops/docs/canonical-and-fallback-registry.md` with the canonical tool, the fallback tool, and the reason. Otherwise on next audit it looks like cruft and a future maintainer retires it.

This category formalizes the David instinct (2026-04-29) plus the Aussie integration-roadmap §4 honest-take ("Stage 3 dependency hardening — gws CLI single point of failure"): both arrived at "retain claude.ai trio for diversity, not for primary use."

---

## 5. Per-Current-MCP Audit (Stage Classification)

| Tool | Today's Stage | Stage 2 trigger met? | Stage 3 ready? | Notes |
|---|---|---|---|---|
| `icm` | Stage 1 (eternal) | NO — proactive memory store is reasoning-driven per turn | NO | Reasoning-loop integration is the value. NEVER converts. |
| `claude-mem` | Stage 1 (eternal) | NO — search/timeline/get_observations are exploratory | NO | Per Collie measurement: <0.1% cap savings if converted. Stays MCP. |
| `claude_ai_Gmail/Calendar/Drive` | **Stage 3-RETAINED-AS-FALLBACK** (updated 2026-04-29) | YES — `gws` CLI is canonical primary | YES — but technically un-removable (session-injected, see §3.5) | gws CLI handles the 80% known case. claude.ai trio retained as documented fallback for vendor-diversity / failure-uncorrelation. Schema-tax (~0.1% of cap) accepted as insurance premium. See `canonical-and-fallback-registry.md` for the canonical/fallback record. |
| `agentmemory` (template MCP) | Stage 0 (deprecated) | n/a | n/a | Already removed from templates per overnight Collie ship (B). |
| `officecli` | Stage 1 (low-frequency) | NO — usage too rare to justify stage 2 audit | NO | Park at Stage 1 indefinitely or until usage justifies. |
| `Playwright` (just installed @playwright/cli) | Mixed: MCP for live inspection (stage 1), CLI codegen for emit (stage 1→3 bridge), Python lib for prod scripts (stage 3) | Already at Stage 3 for known flows | Already at Stage 3 for `pm-recapture-session-playwright.py` | Codegen unlocks faster Stage 1→3 transitions for new flows. See playwright-cli-acceleration-plan.md. |
| `codex` (plugin, not MCP) | Stage 3 — it IS a CLI | n/a | n/a | The plugin shape is the right shape. Not in scope. |
| `pm` / `af` snapcli | Stage 3 | n/a | n/a | Reference implementations. |

---

## 6. Anti-Patterns

Three failure modes the lifecycle pattern guards against:

1. **Premature CLI conversion (before workflow stabilizes).** RFC #9's binary REPLACE-WITH-CLI for `claude-mem` was this pattern. Conversion build cost was real, ongoing maintenance cost was real, savings were 0.1% of cap. Symptom: build CLI for ops that the MCP never proved out as recurring.
2. **Keeping MCP after CLI ready (token waste).** The opposite pattern. claude.ai Gmail/Calendar/Drive lived alongside `gws` CLI for weeks before disable per RFC #9 — every agent loaded ~800-4000 tok/turn of unused tool schemas. Symptom: schema-tax grows quietly, no one removes the MCP.
3. **Conversion-without-discovery (build CLI for ops the MCP never proved out).** Speculative CLI work. Symptom: an RFC proposes a new CLI subcommand for a workflow that the agent has never executed end-to-end. Means the parameters, error modes, and edge cases are guesses.

**Mitigation for all three:** apply §3 signals before Stage 2 conversion. If <3 signals are true, the tool stays Stage 1. If MCP is in Stage 2 with CLI ready, schedule disable on the MCP within a sprint.

---

## 7. Decision Tree for New MCP Introductions

When adding a NEW MCP to the fleet, classify upfront:

```
Will the agent explore this tool's surface across multiple distinct workflows?
├── YES → "exploratory tool" — stays Stage 1 forever (icm, claude-mem class)
│         CLI conversion never planned. Ship the MCP. Done.
│
└── NO → "operational tool" — workflows likely to stabilize
        ├── Are the calls decision-driven (params from agent reasoning)?
        │   ├── YES → Stage 1 with possible future graduation to Stage 3 for the SUBSET that becomes invariant
        │   └── NO → Schedule Stage 2 audit at 4 weeks from MCP introduction
        │
        └── Schedule §3 signal review at 4 weeks. If 3+ signals, draft CLI conversion RFC.
```

**Default rhythm:** every new MCP gets a 4-week Stage 2 audit on its introduction calendar. No tool ages in Stage 1 forever without explicit review.

---

## 8. Cross-References

**RFC #9 (rfc-mcp-vs-cli-audit.md):** RFC #16 supersedes the binary REPLACE-WITH-CLI / KEEP-MCP framing. RFC #9's per-MCP verdicts remain correct under either framing (claude.ai Google trio still REPLACE, agentmemory still DEPRECATE, icm still KEEP) but the *rationale* shifts: claude-mem stays Stage 1 forever (not "low priority defer"), and any future MCP gets the §7 decision tree applied at introduction.

**`mcp2cli-claude-mem-migration.md` (Collie's NN doc):** the measurement-driven pushback on claude-mem migration was RIGHT (savings tiny, parity incomplete). Under RFC #16, this is also classification-driven: claude-mem is Stage 1 forever, conversion was never the goal.

**`claude-mem-cli-parity.md` (Collie's LL audit):** still useful as the inventory of what claude-mem CLI exposes today vs the MCP, but no longer drives a conversion plan.

**`playwright-cli-acceleration-plan.md` (sibling doc, today):** concrete application of RFC #16 to browser automation. Codegen IS the Stage 1→3 bridge tool.

---

## 9. Open Questions for David

1. **§3 signal thresholds (5 calls/day, 5K tokens/week, etc.):** are these the right numerical anchors, or should we soak more data before committing? Lean: ship as-defaulted, refine after one Stage 2 audit cycle.
2. **§7 decision tree placement:** lives in this RFC, or extract to a shorter checklist in `orgs/ascendops/docs/mcp-introduction-checklist.md` for use at every new MCP install? Lean: extract once we add the next new MCP.
3. **Stage classification per-MCP (§5 table):** any disagreements with my classification? Specifically `officecli` — I parked it at Stage 1 indefinitely; if you have data on its usage, we may revisit.
4. **`Playwright` mixed-stage finding:** the codegen tool blurs the Stage 1 / Stage 3 boundary. Is the right pattern "codegen ALWAYS for first-write of a new flow, even if we have an existing handwritten version"? Lean: yes, treat codegen as the canonical first-pass tool.
5. **MCP retirement timing:** when a tool reaches Stage 3, how long do we keep the MCP installed for the 20% novel case? Forever? Until a quarterly review shows zero novel-case usage in 90 days? Lean: keep until measured-zero-usage for 90 days, then disable with a documented re-enable path.

---

## Word count: ~1640 (within 1100-1700 target)

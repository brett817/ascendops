# Subagent Prompt Structure Pattern

**Status:** LOCKED 2026-05-24 by David via Dane.
**Origin:** David proposal 2026-05-23 evening; locked 2026-05-24 morning after weekly review surfaced 4 P1 bugs that should have been caught at dispatch time, not merge time.

---

## Rationale

Most of the week's P1 bugs were INTEGRATION-SHAPE mismatches, not implementation defects:

- **Singleton-state pollution** — subagent wrote a route-level gate referencing module-level state, but had no contract that its output must be safe across test isolation
- **Address-disambiguation silent-failure** — subagent wrote `resolveMeldByAddress` returning first match, but had no contract that multi-unit / repeat-visit address overlap was a scenario it owned
- **Hold-queue race condition** — subagent wrote the consumer reading entries without removing/locking, but had no contract that concurrent reply webhooks were a scenario the consumer must handle

Bot review caught these post-merge. **Contracts at dispatch would have caught them never-shipping.** This pattern moves catch-point upstream.

---

## The four-part structure

Every non-trivial subagent dispatch prompt must include all four parts.

### Part 1: Index-doc framing

The prompt is a high-level pointer, not an inlined document. Subagents skim-load context, not full-load.

```
Read these files before starting:
- src/foo.ts (lines 100-200) — current implementation you'll modify
- docs/foo-spec.md — the acceptance criteria
- tests/foo.test.ts — patterns to follow for new tests
```

Each file gets a **"why" annotation** so the subagent knows which step needs it. Avoids redundant whole-file reads.

### Part 2: High-level workflow steps

Describe the WHAT, not the HOW. Subagent decides tactics within the strategy.

```
Workflow:
1. Read the spec + existing impl
2. Identify the integration surfaces (callers, state, side effects)
3. Implement the change in a worktree
4. Add tests covering the contracts in Part 4
5. Verify tests pass + lint clean
6. Surface artifact paths for integration review
```

Avoid micromanagement. Avoid step-by-step bash. Outcome-oriented.

### Part 3: Validation loop

The proof-not-word rule, encoded into the prompt as a required step.

```
Before reporting complete:
1. Run the full test suite (not just your new tests) — paste exit code + line count
2. ls the worktree path to confirm files landed where claimed
3. git diff --stat to show actual change scope
4. Cite line numbers for each contract you satisfied
```

This bakes verification into the dispatch instead of hoping the agent remembers the meta-rule.

### Part 4: Contracts with past and future steps (KEYSTONE)

This is the load-bearing piece. Explicit shape obligations:

**Past contracts** (what came BEFORE you in the pipeline produced):
```
Input shape contract:
- The caller hands you a normalized PhoneNumber type (E.164 string)
- The PM API response shape is documented at docs/pm-shapes.md#meld
- Test fixtures live at tests/fixtures/melds/ — do not invent new shapes
```

**Future contracts** (what comes AFTER you in the pipeline expects):
```
Output shape contract:
- Your function returns Discriminated<{kind: 'none'|'unique'|'ambiguous', candidates?: Meld[]}> — the consumer at src/handler.ts:200 pattern-matches on `kind`
- Your function must be safe to call concurrently — the route handler may invoke from N parallel webhooks
- Multi-unit address overlap is YOUR responsibility — return `kind: 'ambiguous'`, don't pick first
- Test isolation: if you touch module-level singleton state, export a `__clearFooState` mirror so test setup can reset
```

Past/future contracts catch:
- "Your output must be X-shape because next step consumes Y" → automatic at dispatch time
- "This scenario is yours to handle, not something to silently first-match through" → explicit ownership
- "The handoff between you and the consumer has these invariants" → no integration surprises

---

## Scope: applies to ALL dispatches (spawn-worker + peer-agent)

**Revised 2026-05-24 by David pushback.** Earlier draft hedged "softer for peer agents" — that was wrong. Less direct supervision means contracts matter MORE, not less.

The four-part pattern applies to **every dispatch type**:
- **Spawn-worker dispatches** (specialist → ephemeral subagent)
- **Peer-agent dispatches** (orchestrator → specialist, specialist → specialist like Collie → Codie)

For peer-agent dispatches, the index-doc framing may be slightly less critical when the receiver has prior session state + MEMORY.md context, but past/future contracts and the validation loop apply equally. Workflow steps still keep dispatches outcome-oriented rather than micromanaged.

### Self-accountability without orchestrator policing

Two mechanisms make this rule self-enforcing across the fleet:

1. **Dispatcher side** — peer agents apply the 4-part pattern when sending work to another peer. No shortcuts. Same shape as any other dispatch.
2. **Receiver side** — if a peer dispatch arrives missing contracts, the receiver PUSHES BACK and requests them before starting. Refusal-to-start is the enforcement.

This is the same shape as a code reviewer rejecting an unclear PR — the recipient enforces the standard. Neither agent needs the orchestrator to police it.

Direct application: when Collie writes a spec for Codie, contracts are mandatory. When Codie receives a contract-less spec, he asks for them before opening any worktree.

---

## Worked example: hotfix dispatch using the pattern

```
HOTFIX — P1-a address disambiguation

Read before starting:
- src/routes-telnyx-mms.ts:700-730 (resolveMeldByAddress current) — why: that's the function you'll replace
- docs/durable/subagent-prompt-structure-2026-05-24.md §Part 4 — why: contracts are the keystone, read them
- tests/routes-telnyx-mms.test.ts — why: extend these test patterns, don't invent new ones

Workflow:
1. Read the current resolveMeldByAddress + Codex bot's P1 description
2. Design a discriminated-union return type for the 3 cases (none / unique / ambiguous)
3. Implement in a worktree
4. Add tests for each kind including the multi-unit / repeat-visit scenarios
5. Run shuffle-verified suite, paste exit + line count

Validation loop:
- Cite the line numbers where you changed resolveMeldByAddress
- Cite the line numbers of the 3 new test cases
- Confirm 302/302 shuffle pass

Past contract:
- Input is a normalized address string (the caller did the normalization)
- PM work-orders list response shape per docs/pm-shapes.md#work-orders
- Existing token-subset match logic is the baseline behavior to preserve for the `unique` case

Future contract:
- Consumer at src/handler.ts:200 pattern-matches on `kind`
- `kind: 'ambiguous'` MUST trigger the retry-SMS-listing-candidates flow at the consumer — your job is to surface it, consumer handles UX
- The queue entry must NOT be removed in ambiguous case (consumer needs it for retry)
- Concurrent invocation safety: this function is called from N parallel webhooks; pure function preferred, no module-level mutable state
```

---

## Adoption

**Effective immediately for all new non-trivial dispatches across the fleet.**

Specialist agents (Codie, Collie, Aussie, Blue) update their dispatch templates / spec-writing patterns to apply the four-part structure.

Trivial scope (single PATCH + verification, <15 min total) — solo inline is fine when faster, per the existing locked rule. Judgment call, lean toward applying the pattern when unsure.

---

## Layered behind this pattern

After this catch moves upstream, the remaining detection layers:
1. Hard merge gate (5-min pause after LGTM) — catches timing-window slips
2. Adversarial sub-agent review before LGTM — different specialist tries to break the work fresh
3. Test fixture upgrades for concurrency / multi-unit / singleton-state scenarios

Three-layer detection, no human in the loop.

---

## Cross-references

- David's original proposal: 2026-05-23 evening Telegram conversation
- This week's bug data: orgs/ascendops/docs/weekly-prep-2026-05-24.md
- Aussie's concurrency-safety checklist (3-question scan): ~/.claude/projects/-Users-davidhunter-cortextos-orgs/memory/feedback_concurrency_safety_peer_review_checklist.md
- Worktree hooks audit (related code-review surface): orgs/ascendops/docs/durable/worktree-hooks-audit-2026-05-23.md

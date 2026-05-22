# High-Risk Change Zones
**Version:** 1.0  
**Effective:** 2026-04-19  
**Authority:** David Hunter (AscendOps)  
**Source:** Graphify src/ + tests/ passes, 2026-04-19

---

## Purpose

These five files have the highest blast radius in the cortextos codebase. Changes here ripple across the entire fleet. Before touching any of them, both a Graphify structure review and a governance-check are required.

---

## High-Risk Files

### 1. src/utils/atomic.ts
**Risk level:** CRITICAL  
**Why:** `atomicWriteSync()` (21 edges) and `ensureDir()` (38 edges, bridges 10 communities) are called by every module that writes to disk — bus, oauth, metrics, task, inbox. A regression here is a fleet-wide write failure.  
**Current coverage:** Covered. `atomic.test.ts` added 2026-04-19 (7 tests). Covers write/rename/cleanup/file mode 0o600/ensureDir idempotency on real filesystem.  
**Before changes:** Review all callers via Graphify query. Write `atomic.test.ts` covering write/rename/rollback behavior before modifying.

---

### 2. src/daemon/agent-process.ts
**Risk level:** HIGH  
**Why:** Owns the full agent session lifecycle — startup prompts, crash recovery, cron state, deliverables block, PTY exit handling. 32 edges in the graph.  
**Current coverage:** Good. 1,232-line dedicated test file. Specific regression tests for BUG-011 (stop awaiting PTY exit) and BUG-048 (session timer re-reads config). Crash recovery paths, stale markers, and cron verification all tested.  
**Before changes:** Run `fast-checker.test.ts` and `agent-process.test.ts` suites. Verify any new session lifecycle logic has regression coverage before merging.

---

### 3. src/daemon/fast-checker.ts
**Risk level:** HIGH  
**Why:** All inbound Telegram messages flow through this node first (40 edges — highest degree in graph). Performance regressions or dedup logic changes affect real-time responsiveness for the entire fleet.  
**Current coverage:** Good. Two test files: `fast-checker.test.ts` (1,232 lines) and `sprint6-fastchecker.test.ts`. Covers dedup persistence, urgent signal detection, stdout.log growth, SIGUSR1 wake.  
**Before changes:** Graphify query to check what else shares the inbound message path. Confirm dedup behavior is preserved if modifying loop or polling logic.

---

### 4. src/daemon/agent-manager.ts
**Risk level:** HIGH  
**Why:** Single point of fleet knowledge. Discovers, starts, and monitors all agents (21 edges). Fleet bootstrap depends entirely on this.  
**Current coverage:** Covered. `agent-manager-discovery.test.ts` added 2026-04-19 (6 tests). Covers missing orgs dir, multi-org scan, config loading, non-directory filtering, per-org error isolation.  
**Before changes:** Verify discovery path behavior with a mock filesystem test before modifying agent registration or startup sequencing. Gap task: agent-manager discovery test (see below).

---

### 5. src/bus/inbox.ts
**Risk level:** HIGH  
**Why:** HMAC signing and inbox delivery are the integrity layer for all inter-agent messages. A regression silently breaks agent coordination without any visible error.  
**Current coverage:** Covered. `hmac.test.ts` added 2026-04-19 (4 tests). Covers sign+verify via sendMessage+checkInbox, tamper detection (invalid messages rejected), no-key backward compat.  
**Before changes:** Do not modify inbox.ts or the HMAC layer without first writing `hmac.test.ts`. Any change to signing logic that passes all tests is not verified safe.

---

## Baseline Test Coverage Added 2026-04-19

The following tests were added to close all three coverage gaps identified by the Graphify tests/ pass:

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `tests/unit/utils/atomic.test.ts` | 7 | write/rename/cleanup/file mode 0o600/ensureDir idempotency (real filesystem) |
| `tests/unit/bus/hmac.test.ts` | 4 | sign, verify, tamper detection, no-key backward compat (via sendMessage+checkInbox) |
| `tests/unit/daemon/agent-manager-discovery.test.ts` | 6 | multi-org scan, config loading, non-dir filtering, per-org error isolation (mock filesystem) |

Suite after: 52 files, 769 tests, 0 failures. No production code modified.

---

## Governance Rule

**Changes touching any high-risk change zone must use both:**
1. Graphify structure review — run `/graphify query "<module>"` to see what else will be affected
2. `governance-check` — confirm no agent role, memory boundary, or integration is implicitly changed

Both are required before implementation begins. Neither replaces the other.

---

## Queued Test Gaps (Next Highest-Value Code Safety Tasks)

| Test file | Covers | Priority |
|-----------|--------|----------|
| `atomic.test.ts` | write/rename/rollback behavior of `atomicWriteSync()` and `ensureDir()` | DONE 2026-04-19 |
| `hmac.test.ts` | sign, verify, tamper detection for inter-agent message integrity | DONE 2026-04-19 |
| `agent-manager discovery test` | `discoverAgents()` + `discoverAndStart()` with mock filesystem | DONE 2026-04-19 |

These three tests are the prerequisite for safely modifying any of the high-risk zones above.

---

## Graphify Dashboard Decision

Dashboard (`/dashboard`) graphing deferred. Re-evaluate only after the three test gaps above are addressed or deliberately deferred by David.

---

## Amendment Process

Changes to this document require Dane review and David approval via Telegram.

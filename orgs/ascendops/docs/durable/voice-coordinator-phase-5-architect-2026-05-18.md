# Phase 5 Architect — Dispatch Plan

**Date:** 2026-05-18
**Author:** Collie (Phase 5 architect)
**Scope:** Voice Coordinator post-call transcript pipeline: Neon store → Telnyx pull → GET endpoint → /finalize-call (Anthropic summary + PM patch + transcript upload).
**Constraint:** 3 parallel build sub-agents, no file overlap, no production code in this doc.

---

## Codebase summary

Read-back of the relevant files in `/Users/davidhunter/projects/blue-voice-gateway/`:

- **`src/index.ts`** — Fastify app. Custom `application/json` + wildcard content-type parsers (empty body → `{}`). Registers `voice`, `sms`, `voice-tools` routes plus `/health`. Listens on `PORT` (default 3000), host `0.0.0.0`. Phase 5 hook point: one more `register*Routes(fastify)` line for the new transcript + finalize-call routes.
- **`src/voice-tools.ts`** — 18 tool routes wired off `runPm`. Reads include `lookup_meld`, `recent_melds_for_property`; writes include `assign_vendor`, `send_message_on_meld`, `complete_meld`. All meld-bound routes pass through `guardCallerForMeld` (uses `caller-scope.ts`). Pattern for Phase 5: every new route returns `reply.code(200).send({ ok, ... })` JSON.
- **`src/sms.ts`** — Inbound SMS + MMS. Reads `data.payload.media[]` + Twilio fallback. Returns 200 immediately, then runs the side effect under `setImmediate(...)` so Telnyx never sees latency. Phase 5 lesson: `/finalize-call` should follow the same fire-and-fire-200 shape — Telnyx status_callback expects a quick 200.
- **`src/pm-cli.ts`** — `runPm(args[])` spawns the `pm` binary (path overridable via `PM_CLI_PATH`), 8 s timeout, parses stdout JSON, strips owner names (`David Hunter`/`Brittany Hunter` → `redacted`). Returns `{ ok, data?, error?, raw? }`. Phase 5 uses two commands: `pm work-orders update-notes` and `pm work-orders upload-file`.
- **`src/telnyx-sms.ts`** — `sendTelnyxSms(to, body)` POSTs to `https://api.telnyx.com/v2/messages` with `TELNYX_API_KEY`. 5 s `AbortSignal.timeout`. Not used by Phase 5 directly but is the reference shape for `transcript-fetch.ts`'s Telnyx GETs.
- **`src/caller-scope.ts`** — `extractCallerPhone(request)` already issues `GET https://api.telnyx.com/v2/ai/conversations?filter[call_control_id]={ccid}` with `Authorization: Bearer ${TELNYX_API_KEY}` and a 5 s timeout. **This is the exact bearer-auth pattern Sub-agent B must reuse for the messages pull.** It also keeps a 10-min in-memory cache of `ccid → phone` which we should mirror for `ccid → conversation_id` to avoid double-lookups.
- **`package.json`** — Fastify 4.28, `telnyx` 6.41 (already a dep — but we use raw `fetch` everywhere), Vitest 4.1, TS 5.4. No `pg`, no `@anthropic-ai/sdk` yet. Phase 5 adds both.

Test scaffold: `vitest` already wired (`npm test`). Phase 6 left a `tests/` directory pattern Sub-agent C should mirror.

---

## Architectural decisions

### A. DB driver + connection
- **Driver: `pg` (node-postgres).** Reasons: (a) Neon's official Node quickstart uses `pg`, (b) ubiquitous, well-typed, no surprises under Railway's Node 20; (c) `postgres` (porsager) is faster but adds a tagged-template API the team hasn't standardised on — not worth the cognitive cost for a single small table.
- **Pool, not Client.** One `Pool` (max 5 connections — Neon free tier caps at ~20 total, Railway typically runs 1 instance) module-singleton, exported from `src/neon.ts`. SSL forced via `{ ssl: { rejectUnauthorized: false } }` because Neon requires TLS and Railway's CA bundle drift has bitten us before.
- **Env var name: `DATABASE_URL`** (Neon's default + Railway's convention). Single source of truth, no per-host suffix.

### B. Migration strategy
- **No migration framework.** One table, one schema, low churn. Sub-agent A ships `migrations/001_transcripts.sql` and a `runMigrations()` helper that:
  - Creates a `schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)` ledger.
  - On startup, scans `migrations/*.sql`, applies anything not in the ledger inside a single transaction, records the filename.
- Idempotent, survives restart, no `node-pg-migrate` dependency. If we ever exceed 5 migrations we re-evaluate; until then, ceremony tax > benefit.
- Migration is invoked once from `main()` in `index.ts` **before** `fastify.listen` — fail-loud if DB is unreachable on boot. Sub-agent A exposes `await runMigrations()`; Collie wires the call site.

### C. Anthropic SDK + model
- **SDK: `@anthropic-ai/sdk` (official).** Versions pin to `^0.30.0` line (current stable as of 2026-05).
- **Model: `claude-haiku-4-5`.** Summaries are 3–5 sentences, input is ~2–10 KB of transcript JSON. Haiku 4.5 hits the speed + cost target (~$0.001/call) and beats latency p95 on Sonnet. Per the project-wide claude-api skill, enable prompt caching on the system prompt (the summary template is identical across calls — cache hit rate should approach 100% after warmup).
- **Prompt shape:** system prompt = role + 3–5 sentence template "Caller reported X. Discussed Y. Promised Z. Followups: A."; user prompt = JSON-stringified transcript. `max_tokens: 400`, `temperature: 0.2`.
- API key in `orgs/ascendops/secrets.env` as `ANTHROPIC_API_KEY`; Railway env var of the same name.

### D. Telnyx call-ended trigger wiring
- TeXML app `2954301261882590783` currently has `status_callback: null`. Main Collie (post-sub-agent integration) PATCHes it to `https://blue-voice-gateway.up.railway.app/finalize-call` via the Telnyx PATCH `/v2/texml_applications/{id}` endpoint.
- Telnyx fires Twilio-compatible form body: `CallSid`, `CallStatus`, `From`, `To`, `Direction`, `CallDuration`. Filter to `CallStatus === 'completed'`; ignore `failed`/`busy`/`no-answer` for v1 (those have no useful transcript). Log them, don't summarize.
- We need to map Twilio `CallSid` → Telnyx `call_control_id`. **CallSid is NOT the same as call_control_id on Telnyx.** The status_callback for TeXML uses Telnyx's own call leg id; verify via the first real fire. Worst case: pull the conversation by `from/to + recent window` and grab the most recent. Sub-agent C surfaces this as a runtime concern (see Risks).
- Status_callback handler returns 200 immediately, then runs the pull-summarize-patch chain in `setImmediate(...)` (same pattern as `sms.ts`). Telnyx retries non-2xx — we don't want duplicate summaries.

---

## Sub-agent dispatch plan

> **File-ownership rule (locked):** no two sub-agents touch the same file. The lists below are exhaustive. If a sub-agent thinks they need to edit something not in their list, they **stop and escalate to Collie** — they do not improvise.

### Sub-agent A: Neon store

**Owns (writes-only):**
- `src/neon.ts` — pg Pool factory, `query()` wrapper, `runMigrations()` function.
- `src/transcripts-store.ts` — typed CRUD: `saveTranscript(row)`, `getTranscript(call_control_id)`, `hasTranscript(call_control_id)`.
- `migrations/001_transcripts.sql` — schema DDL.
- `docs/phase-5a-integration-plan.md` — integration notes (what Collie wires into `index.ts`, what env vars Railway needs).

**Does NOT touch:** `src/index.ts`, anything under `src/routes-*`, `src/transcript-fetch.ts`, `src/routes-finalize-call.ts`, `src/summarize.ts`, `package.json`.

**Implementation sketch:**
- `neon.ts`: `import { Pool } from 'pg'` → singleton `pool` with `connectionString: process.env.DATABASE_URL`, `ssl: { rejectUnauthorized: false }`, `max: 5`. Export `query(sql, params)` that delegates to `pool.query`. Export `runMigrations()` that ensures `schema_migrations` exists, lists `migrations/*.sql` sorted, applies missing ones in a transaction.
- `transcripts-store.ts`:
  - `Transcript` type: `{ call_control_id: string; conversation_id: string | null; from_phone: string | null; to_phone: string | null; messages: unknown; metadata: unknown; created_at: Date }`.
  - `saveTranscript(row)` — `INSERT ... ON CONFLICT (call_control_id) DO UPDATE SET messages = EXCLUDED.messages, metadata = EXCLUDED.metadata`. Upsert because Telnyx may retry the status_callback.
  - `getTranscript(ccid)` — `SELECT * WHERE call_control_id = $1`. Returns null on miss.
  - `hasTranscript(ccid)` — boolean shortcut.
- `001_transcripts.sql`:
  ```
  CREATE TABLE IF NOT EXISTS transcripts (
    call_control_id  TEXT PRIMARY KEY,
    conversation_id  TEXT,
    from_phone       TEXT,
    to_phone         TEXT,
    messages         JSONB NOT NULL,
    metadata         JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS transcripts_conversation_id_idx ON transcripts(conversation_id);
  CREATE INDEX IF NOT EXISTS transcripts_created_at_idx ON transcripts(created_at DESC);
  ```

**Acceptance criteria:**
- `npm run build` clean.
- Unit test: `runMigrations()` against a mocked pg client (or pg-mem if cheap) applies 001 then is a no-op on second run.
- Unit test: `saveTranscript` upsert behaviour — two calls with same `call_control_id`, second one wins on `messages`.
- `docs/phase-5a-integration-plan.md` lists: env var (`DATABASE_URL`), npm install (`pg`, `@types/pg`), index.ts call site (`await runMigrations()` before `fastify.listen`).

---

### Sub-agent B: Telnyx transcript fetch + GET endpoint

**Owns:**
- `src/transcript-fetch.ts` — Telnyx API wrapper that pulls a transcript by `call_control_id` and writes to Neon via `transcripts-store`.
- `src/routes-transcripts.ts` — `GET /transcripts/:call_control_id` route registration function.
- `docs/phase-5b-integration-plan.md`.

**Imports from A (read-only):** `transcripts-store` (`saveTranscript`, `getTranscript`).

**Does NOT touch:** `src/index.ts`, A's files, C's files, `package.json`.

**Implementation sketch:**
- `transcript-fetch.ts`:
  - `fetchAndStoreTranscript(call_control_id): Promise<{ ok, transcript?, error? }>`.
  - Step 1: `GET https://api.telnyx.com/v2/ai/conversations?filter[call_control_id]=${ccid}` with `Authorization: Bearer ${TELNYX_API_KEY}`, 5 s timeout. Extract `data[0].id` as `conversation_id`. Also capture `metadata.from`, `metadata.to`.
  - Step 2: `GET /v2/ai/conversations/{conversation_id}/messages?include_content=true`. Capture `data[]` as `messages` array.
  - Step 3: Call `saveTranscript({ call_control_id, conversation_id, from_phone, to_phone, messages, metadata })`.
  - Return `{ ok: true, transcript: {...} }` or `{ ok: false, error }`.
  - Reuse the bearer-auth + `AbortSignal.timeout(5000)` shape from `caller-scope.ts` line-for-line.
- `routes-transcripts.ts`:
  - `registerTranscriptRoutes(fastify)`.
  - `GET /transcripts/:call_control_id`:
    - Call `getTranscript(ccid)`. Hit → return `{ ok: true, transcript }`.
    - Miss → call `fetchAndStoreTranscript(ccid)`. Success → return new row. Failure → 404 + `{ ok: false, error }`.
  - Optional query flag `?refresh=1` — always re-pull from Telnyx even on cache hit (Sub-agent C's /finalize-call may use this).

**Acceptance criteria:**
- `npm run build` clean.
- Unit test (Telnyx `fetch` mocked): conversation lookup → messages lookup → `saveTranscript` called with right shape.
- Unit test: cached path — getTranscript hit short-circuits the Telnyx calls.
- Manual smoke (deferred to Collie integration): `curl https://blue-voice-gateway.up.railway.app/transcripts/<real-ccid>` returns messages for one of David's recent calls.

**Test fixture note:** there are 5+ real conversations on the Telnyx assistant from the last 24h (greet smoke, persona v3.x, photo_handoff smoke, David's 01:40Z retest). Sub-agent B's vitest mocks the Telnyx API with one captured response payload; integration smoke uses a real `call_control_id` chosen by Collie at deploy time.

---

### Sub-agent C: /finalize-call + Anthropic summary + PM patch

**Owns:**
- `src/routes-finalize-call.ts` — `POST /finalize-call` Telnyx status_callback handler.
- `src/summarize.ts` — Anthropic SDK wrapper, `summarizeTranscript(messages): Promise<string>`.
- `docs/phase-5c-integration-plan.md`.
- **Tests for all three sub-agents** live under `tests/phase-5/` — C owns the test directory but each sub-agent's logic gets its own test file (`tests/phase-5/a-store.test.ts`, `b-fetch.test.ts`, `c-finalize.test.ts`). Sub-agents A and B write their own test files; C owns the shared fixtures + the `c-finalize.test.ts` integration test that exercises the full chain with all upstream calls mocked.

**Imports from A:** `getTranscript`, `saveTranscript` (only via the public `transcripts-store` surface).
**Imports from B:** `fetchAndStoreTranscript`.

**Does NOT touch:** `src/index.ts`, A's files, B's files, `package.json`.

**Implementation sketch:**
- `summarize.ts`:
  - `import Anthropic from '@anthropic-ai/sdk'` → module-singleton client with `apiKey: process.env.ANTHROPIC_API_KEY`.
  - `summarizeTranscript(messages: unknown): Promise<{ ok: boolean; summary?: string; error?: string }>`.
  - `client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 400, temperature: 0.2, system: [{ type:'text', text: SYSTEM, cache_control: { type:'ephemeral' } }], messages: [{ role:'user', content: JSON.stringify(messages) }] })`.
  - System prompt template: "You are summarizing a property-management maintenance call transcript. Output 3 to 5 sentences in this template: 'Caller reported X. Discussed Y. Promised Z. Followups: A.' Use plain prose. No markdown. No emoji. No PII beyond what's already in the transcript."
  - Return `summary` text from `response.content[0].text`.
- `routes-finalize-call.ts`:
  - `POST /finalize-call`. Body is form-encoded (Twilio-compat). Read `CallStatus`, `CallSid`/`call_control_id`.
  - **Return 200 immediately**, then run the chain under `setImmediate(...)`.
  - Chain steps:
    1. If `CallStatus !== 'completed'` → log + exit.
    2. Resolve `call_control_id` (may need to map from `CallSid` — see Risks).
    3. Get transcript: `getTranscript(ccid)` first, fall back to `fetchAndStoreTranscript(ccid)`.
    4. Parse out the `meld_id` from the transcript metadata or message content. **Heuristic:** scan tool_use blocks in the messages for the most recent `meld_id` argument (lookup_meld, assign_vendor, etc.). If no meld_id found → log + exit (cold call, nothing to attach to).
    5. `summarizeTranscript(messages)` → `summary`.
    6. `runPm(['work-orders', 'update-notes', '--meld-id', meld_id, '--notes', summary, '--append', '--json'])`.
    7. Write transcript to `/tmp/transcript-{ccid}.txt` (plain text rendering: `[timestamp] role: content` lines).
    8. `runPm(['work-orders', 'upload-file', '--meld-id', meld_id, '--file', '/tmp/transcript-{ccid}.txt', '--json'])`.
    9. If upload fails: append a deeplink to the Neon transcript GET endpoint as a second `update-notes --append` line: "Full transcript: https://blue-voice-gateway.up.railway.app/transcripts/{ccid}".
    10. Log final status with all step outcomes.

**Acceptance criteria:**
- `npm run build` clean.
- Unit test: `summarizeTranscript` with mocked Anthropic SDK returns the expected text. Asserts model = `claude-haiku-4-5`, prompt cache enabled.
- Unit test: full `/finalize-call` chain with `getTranscript`/`runPm`/`fetchAndStoreTranscript`/Anthropic all mocked. Asserts:
  - non-completed status → no-op.
  - completed status + transcript present + meld_id found → update-notes called, upload-file called.
  - upload-file fail → deeplink appended via second update-notes.
- Test fixture: a captured Telnyx messages payload from one of David's recent calls (anonymized phone numbers OK; meld_id present).

---

## Main Collie integration plan (post-sub-agent)

Sequential, single-threaded, runs after all 3 sub-agent PRs land.

1. `npm install pg @anthropic-ai/sdk` + `npm install -D @types/pg`. Commit `package.json` + `package-lock.json`.
2. Set Railway env vars: `DATABASE_URL` (Neon connection string from David), `ANTHROPIC_API_KEY` (from `orgs/ascendops/secrets.env`). Verify via `railway variables`.
3. Edit `src/index.ts`:
   - `import { runMigrations } from './neon.js'`.
   - `import { registerTranscriptRoutes } from './routes-transcripts.js'`.
   - `import { registerFinalizeCallRoutes } from './routes-finalize-call.js'`.
   - In `main()`, after `formbody` register, before `fastify.listen`: `await runMigrations()`.
   - After existing `registerVoiceToolRoutes`: `await registerTranscriptRoutes(fastify); await registerFinalizeCallRoutes(fastify)`.
4. `npm run build && npm test` locally.
5. `git push` → Railway auto-deploys. Verify `/health` returns ok and check logs for "migration applied 001_transcripts.sql".
6. PATCH Telnyx TeXML app `2954301261882590783`:
   ```
   curl -X PATCH https://api.telnyx.com/v2/texml_applications/2954301261882590783 \
     -H "Authorization: Bearer $TELNYX_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"status_callback":"https://blue-voice-gateway.up.railway.app/finalize-call","status_callback_method":"POST"}'
   ```
   Verify via GET on the same endpoint.
7. Smoke test: fire one new test call to `+14236331021`, hang up, watch logs for `/finalize-call` POST → confirm Anthropic summary lands on the test meld via PM web UI.
8. Backfill smoke: `curl https://blue-voice-gateway.up.railway.app/transcripts/<ccid-of-david-01:40z-retest>` to confirm GET endpoint works on a non-finalized historical conversation.

---

## Open questions for Dane / David

- **Q1 (David, blocker):** Does Neon already have a database provisioned for `blue-voice-gateway`, or do we need to create one? If new: please create a Postgres DB on Neon, drop the connection string into `orgs/ascendops/secrets.env` as `BLUE_VOICE_DATABASE_URL`, and mirror to Railway as `DATABASE_URL`. Sub-agent A can build + test against a local Postgres but cannot deploy without this.
- **Q2 (Dane):** Should `/finalize-call` also push insights to Dane IQ middleware (the existing emergency-dispatch-middleware), or just to PM? **Architect default: just PM for v1.** Dane IQ insights = Phase 9, after we have ≥20 real transcripts to learn from.
- **Q3 (Dane, privacy):** Does the transcript `.txt` uploaded to PM `/files/` need PII redaction (phone numbers, last names)? **Architect read: NO** — manager uploads it, the file is not visible to vendors by default (manager-uploaded files require explicit `--share-with-vendor`), and the PM-side audit trail benefits from full fidelity. Please confirm.
- **Q4 (David, design):** Telnyx recording URLs expire in 10 min (signed). Save the Telnyx recording ID + retrieve on demand, OR download + store in Cloudflare R2? **Architect default: Telnyx ID + retrieval helper now; R2 download is Phase 9** (it's a separate cost/storage decision and not needed for the summary path — the transcript JSON is sufficient for v1).

---

## Risks + mitigations

- **R1: CallSid ≠ call_control_id on Telnyx TeXML status_callback.** Twilio's `CallSid` is what Telnyx puts in the status_callback body, but our caller-scope cache and conversations API key off `call_control_id`. **Mitigation:** Sub-agent C's `/finalize-call` handler tries the body field as a `call_control_id` first; on Neon miss + Telnyx conversations API miss, falls back to filtering conversations by `from`+`to`+recency. Surfaced as a runtime log warning so Collie can swap the mapping after the first real fire.
- **R2: Telnyx conversation messages may be empty if the AI assistant didn't engage** (e.g., caller hung up during greeting). **Mitigation:** Sub-agent C exits cleanly with a logged "transcript empty, skipping summary" — does not summarize an empty array (Anthropic would happily generate a hallucinated summary). Threshold: require ≥2 messages.
- **R3: Anthropic API outage during /finalize-call.** **Mitigation:** transcript is already in Neon by the time we hit Anthropic. On Anthropic failure, append a deeplink note to PM ("Transcript available; AI summary failed, manual review: {link}") and log for retry. No retry queue in v1 — manual rerun via a future `/finalize-call/retry/:ccid` endpoint (Phase 5.1 if needed).
- **R4: `pm work-orders upload-file` may not exist yet on snapcli, or may have a different flag shape.** **Mitigation:** Sub-agent C verifies the command exists via `pm work-orders upload-file --help` during implementation. If missing, escalates to Collie immediately — this is a hard dependency on a snapcli capability we asserted in Phase 4. Fallback (already designed in step 9): deeplink-in-notes covers the gap if upload-file isn't ready.
- **R5: Neon cold-start latency on the first query of a paused instance.** **Mitigation:** `runMigrations()` at boot warms the pool. Neon free-tier auto-pauses after ~5 min idle; first real `/finalize-call` after pause may see ~1 s extra latency. Acceptable — status_callback responds 200 before any DB work happens.
- **R6: Two sub-agents finish before the third → integration drift.** **Mitigation:** Collie reviews each PR as it lands, holds merging into `main` until all three are green; integration step in this doc is one atomic commit by Collie post-merge. No partial deploys.
- **R7: Migration runner race on parallel Railway restarts.** **Mitigation:** wrap migration application in `BEGIN; ... COMMIT;` with a `SELECT ... FOR UPDATE` on `schema_migrations` (or simpler: `INSERT ... ON CONFLICT DO NOTHING` on the ledger row before applying — losers no-op).

---

/Users/davidhunter/cortextos/orgs/ascendops/docs/voice-coordinator-phase-5-architect-2026-05-18.md

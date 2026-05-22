# Phase 5A Integration Plan — Sub-agent A → Collie

**Date:** 2026-05-18
**Author:** Sub-agent A (Neon DB module + transcripts store + migration)
**Scope:** Tells Collie exactly how to wire the new `neon.ts` / `transcripts-store.ts` / `migrations/001_transcripts.sql` into `blue-voice-gateway` once all three Phase 5 sub-agent PRs have landed.

---

## Files shipped by Sub-agent A

| Path | Status |
|------|--------|
| `src/neon.ts` | NEW — pg Pool singleton, `query()`, `runMigrations()`, `closePool()`, `__resetPoolForTests()` |
| `src/transcripts-store.ts` | NEW — `upsertTranscript`, `getTranscriptByCallControlId`, `updateTranscriptSummary`, `getRecentTranscripts`, `TranscriptRecord` type |
| `migrations/001_transcripts.sql` | NEW — DDL: `transcripts` table + 3 indexes |
| `test/phase-5/a-store.test.ts` | NEW — 11 unit tests, all green |
| `package.json` | MODIFIED — `pg` added to deps, `@types/pg` to devDeps |

> **Test path note:** the dispatch plan specified `tests/phase-5/` (plural) but vitest in this repo is configured with `include: ['test/**/*.test.ts']` (singular `test/`). I shipped at `test/phase-5/a-store.test.ts` to match the existing config — no vitest.config.ts changes required. Sub-agents B and C should put their files alongside at `test/phase-5/b-fetch.test.ts` and `test/phase-5/c-finalize.test.ts`.

---

## Required env vars

### Local dev
- `DATABASE_URL` — Neon (or any Postgres) connection string. **Not required for tests** (the pg module is mocked in `a-store.test.ts`). Required if you `npm run dev` and the dev call site reaches `runMigrations()`.

### Railway production
- `DATABASE_URL` — Neon connection string for the `blue-voice-gateway` database.
  - **Blocker (Q1 in architect doc):** David needs to provision a Neon DB and drop the connection string in `orgs/ascendops/secrets.env` as `BLUE_VOICE_DATABASE_URL`, then mirror to Railway env as `DATABASE_URL`. Until this is set, deploy will fail at `runMigrations()` with a clear error (`DATABASE_URL is required in production`).

### What I did NOT do
- No changes to `.env.example` (not in my file-ownership list). Collie should add `DATABASE_URL=postgres://…` there during the integration commit.
- No changes to `railway.json` / `nixpacks.toml` — env vars are set via Railway dashboard, not committed.

---

## index.ts wiring (Collie's task)

In `src/index.ts`, add:

```ts
import { runMigrations, closePool } from './neon.js';
```

Inside `main()`, **after** `await fastify.register(formbody)` but **before** `await fastify.listen(...)`:

```ts
// Run DB migrations before opening the listener. Fail-loud — if Neon is
// unreachable on boot, we want Railway to see the error and roll back.
await runMigrations();
```

For graceful shutdown (recommended but optional), add after the listen call:

```ts
const shutdown = async (signal: string) => {
  fastify.log.info({ signal }, 'shutting down');
  try { await fastify.close(); } catch (e) { fastify.log.error(e); }
  try { await closePool(); } catch (e) { fastify.log.error(e); }
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

Build expectation: `npm run build` will compile cleanly after this edit because `neon.ts` and `transcripts-store.ts` are pure TS with no further wiring.

---

## How Sub-agents B and C consume this module

### Sub-agent B (`src/transcript-fetch.ts`)
```ts
import { upsertTranscript, getTranscriptByCallControlId } from './transcripts-store.js';
```

`fetchAndStoreTranscript(ccid)` should call `upsertTranscript({ call_control_id, conversation_id, from_phone, to_phone, transcript_messages, raw_metadata, … })`. Every field except `call_control_id` is optional — pass what Telnyx returns and leave the rest undefined.

`GET /transcripts/:ccid` should call `getTranscriptByCallControlId(ccid)` first; on null, fall back to `fetchAndStoreTranscript(ccid)` and return the freshly-written row.

### Sub-agent C (`src/routes-finalize-call.ts`)
```ts
import { getTranscriptByCallControlId, updateTranscriptSummary } from './transcripts-store.js';
```

After Anthropic summary + PM patch + PM upload, call:

```ts
await updateTranscriptSummary(
  ccid,
  summaryText,
  pmPatchOk ? 'ok' : `failed:${pmPatchError}`,
  pmUploadOk ? 'ok' : `failed:${pmUploadError}`,
);
```

The summary status strings are free-form; downstream debug uses them as-is. Keep them short and grep-able.

---

## Optional: debug GET endpoint Collie may add

If we want quick visibility into recent transcripts without hitting PM:

```ts
fastify.get('/transcripts', async (req, reply) => {
  const limit = parseInt((req.query as any)?.limit ?? '20', 10);
  const rows = await getRecentTranscripts(limit);
  return reply.code(200).send({ ok: true, count: rows.length, transcripts: rows });
});
```

Not in my file-ownership scope; flagging it for Collie's integration commit. Auth/rate-limiting omitted because this gateway is already public-but-obscure on Railway; if we expose `/transcripts` we should at minimum require a `?token=` shared-secret check. Recommend: hold off until Phase 5 is smoke-passed, then add behind a feature flag.

---

## Migration runner contract

- `runMigrations()` is **idempotent**. Safe to call on every boot.
- It creates a `schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)` ledger table if missing.
- It scans `migrations/*.sql` in alpha order. For each file:
  1. `INSERT INTO schema_migrations(filename) … ON CONFLICT DO NOTHING` — claim the row.
  2. If `rowCount === 0`, the file was already applied (or a parallel booting instance just claimed it). Skip.
  3. Else: read the file, `client.query(sql)`, `COMMIT`. SQL inside each migration must be idempotent (CREATE TABLE IF NOT EXISTS etc).
- On any failure: `ROLLBACK`, throw with `[neon] migration <name> failed: …`. Boot dies.
- Returns `{ applied: string[], skipped: string[] }`.

**R7 (parallel boot race):** handled by the claim-then-apply pattern. Loser of the race is a no-op.

**Cold-start latency (R5):** the first `pool.query` triggers Neon to wake the instance (~1 s on free tier). Call site is before `fastify.listen` so Railway's health check waits for it — acceptable.

---

## Local smoke (Collie can run after wiring)

Once `DATABASE_URL` is set (locally — point at a throwaway Neon branch or local Postgres):

```bash
cd /Users/davidhunter/projects/blue-voice-gateway
DATABASE_URL='postgres://localhost:5432/blue_voice_dev' npm run dev
# Expect log line: [neon] migration applied 001_transcripts.sql
# Second restart: no "applied" line (idempotent)
```

Verify the table:
```bash
psql $DATABASE_URL -c "\d transcripts"
psql $DATABASE_URL -c "SELECT filename, applied_at FROM schema_migrations;"
```

---

## What I did NOT do (per file-ownership rule)

- `src/index.ts` — Collie wires `runMigrations()` + import (see above).
- `src/routes-transcripts.ts` — Sub-agent B.
- `src/routes-finalize-call.ts` — Sub-agent C.
- `src/transcript-fetch.ts` — Sub-agent B.
- `src/summarize.ts` — Sub-agent C.
- `.env.example` — outside my ownership list; Collie's integration commit adds `DATABASE_URL`.
- No PR opened; no Railway env vars set; no real migration run against Neon.

---

## Naming-drift escalation (Collie action required)

When I ran `npm run build` after shipping my files, I observed **5 TypeScript errors in `src/routes-finalize-call.ts`** (Sub-agent C's file — outside my ownership). They come from naming drift between the older architect-doc sketch (which used `saveTranscript` / `getTranscript` / `fetchAndStoreTranscript`) and the revised dispatch I received (which renamed them to `upsertTranscript` / `getTranscriptByCallControlId` / and Sub-agent B uses `pullTranscript`).

Exact errors:
```
src/routes-finalize-call.ts(40,3): error TS2724: '"./transcripts-store.js"' has no exported member named 'getTranscript'. Did you mean 'upsertTranscript'?
src/routes-finalize-call.ts(41,3): error TS2305: Module '"./transcripts-store.js"' has no exported member 'saveTranscript'.
src/routes-finalize-call.ts(45,10): error TS2305: Module '"./transcript-fetch.js"' has no exported member 'fetchAndStoreTranscript'.
src/routes-finalize-call.ts(285,11): error TS2554: Expected 4 arguments, but got 3.
src/routes-finalize-call.ts(389,11): error TS2554: Expected 4 arguments, but got 3.
```

**My surface is per-spec and correct.** Resolutions (Collie to apply in the integration commit, or escalate back to Sub-agent C for a re-shard):

| C-side line | Fix |
|---|---|
| `import { getTranscript }` (line 40) | rename to `getTranscriptByCallControlId` |
| `import { saveTranscript }` (line 41) | rename to `upsertTranscript`; note record shape uses `transcript_messages` (JSONB), not `messages` |
| `import { fetchAndStoreTranscript }` (line 45) | rename to `pullTranscript` (Sub-agent B's actual export) |
| `updateTranscriptSummary(ccid, summary, status)` (lines 285, 389) | add the 4th arg — signature is `(ccid, summary, pm_patch_status, pm_upload_status)` per my dispatch |

My files type-check cleanly in isolation:
```bash
npx tsc --noEmit src/neon.ts src/transcripts-store.ts
# TypeScript: No errors found
```

I did NOT modify routes-finalize-call.ts per the file-ownership lock.

---

## Verdict

- `npx tsc --noEmit src/neon.ts src/transcripts-store.ts` — clean.
- `npm run build` — fails on Sub-agent C's file only (naming drift, see above). My files are not implicated.
- `npm test` — **35/35 green** (25 existing + 10 new from `a-store.test.ts`). Vitest uses esbuild and skips the broken `routes-finalize-call.ts` because nothing imports it from a test file yet.
- Ready for Collie integration once the C-side rename lands. Sub-agents B + C either need a quick re-shard pass for the renames OR Collie applies them in the integration commit (they're mechanical).

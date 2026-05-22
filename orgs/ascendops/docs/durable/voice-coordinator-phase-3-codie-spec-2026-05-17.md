# Voice Coordinator — Phase 3 Dispatch Spec for Codie

**Build:** task_1778991572765_579980 (Voice Coordinator Sprint, ship Mon 5/25)
**Author:** Collie, Phase 3 dispatch
**Generated:** 2026-05-17 04:45 UTC
**Target executor:** Codie (Codex)
**Repo:** /Users/davidhunter/projects/blue-voice-gateway
**Branch:** `feat/voice-tools-expansion-25` (create from main)

---

## Scope

Wrap 8 additional pm CLI commands as Telnyx Voice AI tool webhooks in `src/voice-tools.ts`. Take voice tool count from **17 → 25**. Add contract tests via vitest (test runner not yet present in repo — scaffold as part of this PR).

Hard-stops:
- No changes outside `src/voice-tools.ts`, `test/voice-tools.test.ts`, `package.json` (devDep + script), `tsconfig.json` (only if vitest types require)
- No edits to existing 17 routes
- No new external deps beyond `vitest` + `@vitest/coverage-v8`
- All new routes must follow existing pattern (`getArg`, `runPm`, `{ok, data?, error?}` shape, never throw)

---

## Prerequisites Codie Owns

### P0: pipx reinstall cli-anything-pm (BLOCKING update_meld_notes wrap)

```bash
pipx reinstall cli-anything-pm
# verify:
pm work-orders update-notes --help    # should NOT error "No such command"
pm projects create --help              # should NOT error
```

Source/binary skew flagged in `voice-coordinator-phase-0-cli-delta-2026-05-17.md` — PR #4 (commit 13c3902) shipped these but pipx binary is stale.

### P1: Scaffold test runner

```bash
cd /Users/davidhunter/projects/blue-voice-gateway
npm install --save-dev vitest @vitest/coverage-v8
mkdir -p test
```

Add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

---

## 8 New Voice Routes — Implementation Spec

For each route below: POST handler in `src/voice-tools.ts`, append after the existing 17. Use the same `getArg` helper. Always `reply.code(200).send(...)`. Never throw — catch errors in `runPm` (it already does).

### Route 1: `inspect_meld`

Catch-all snapshot — caller asks "tell me everything about TX12345"

```typescript
fastify.post('/voice/tools/inspect_meld', async (request, reply) => {
  const meldId = getArg<string>(request.body, 'meld_id');
  if (!meldId) return reply.code(200).send({ ok: false, error: 'meld_id is required' });
  fastify.log.info({ tool: 'inspect_meld', meldId }, 'voice tool invoked');
  const result = await runPm(['work-orders', 'inspect', String(meldId).replace(/^TX/i, ''), '--json']);
  return reply.code(200).send(result);
});
```

### Route 2: `merge_melds`

Vendor scenario: "we got two work orders for the same thing"

```typescript
fastify.post('/voice/tools/merge_melds', async (request, reply) => {
  const sourceMeldId = getArg<string>(request.body, 'source_meld_id', 'source');
  const targetMeldId = getArg<string>(request.body, 'target_meld_id', 'target', 'destination_meld_id');
  if (!sourceMeldId || !targetMeldId) {
    return reply.code(200).send({ ok: false, error: 'source_meld_id and target_meld_id are required' });
  }
  fastify.log.info({ tool: 'merge_melds', sourceMeldId, targetMeldId }, 'voice tool invoked');
  const result = await runPm([
    'work-orders', 'merge',
    String(sourceMeldId).replace(/^TX/i, ''),
    String(targetMeldId).replace(/^TX/i, ''),
    '--json',
  ]);
  return reply.code(200).send(result);
});
```

Per feedback_pm_merge_before_assign — destination must be in PENDING_ASSIGNMENT. Don't try to enforce in voice tool; let pm CLI surface error and persona handles via graceful failure.

### Route 3: `schedule_tech_meld`

In-house tech schedule — distinct from existing `schedule_meld` (vendor)

```typescript
fastify.post('/voice/tools/schedule_tech_meld', async (request, reply) => {
  const meldId = getArg<string>(request.body, 'meld_id');
  const techName = getArg<string>(request.body, 'tech_name', 'tech');
  const dtstart = getArg<string>(request.body, 'dtstart', 'start_time', 'datetime');
  const hours = getArg<number>(request.body, 'hours');
  if (!meldId || !techName || !dtstart) {
    return reply.code(200).send({ ok: false, error: 'meld_id, tech_name, and dtstart (ISO 8601) are required' });
  }
  const args = [
    'work-orders', 'schedule',
    '--meld-id', String(meldId).replace(/^TX/i, ''),
    '--tech', String(techName),
    '--dtstart', String(dtstart),
  ];
  if (hours) args.push('--hours', String(hours));
  args.push('--json');
  fastify.log.info({ tool: 'schedule_tech_meld', meldId, techName, dtstart }, 'voice tool invoked');
  const result = await runPm(args);
  return reply.code(200).send(result);
});
```

Codie: verify `pm work-orders schedule --help` for exact flag names (--tech vs --tech-name vs positional). Adjust spec if CLI differs.

### Route 4: `list_projects`

```typescript
fastify.post('/voice/tools/list_projects', async (request, reply) => {
  const limit = getArg<string>(request.body, 'limit') || '10';
  fastify.log.info({ tool: 'list_projects', limit }, 'voice tool invoked');
  const result = await runPm(['projects', 'list', '--limit', String(limit), '--json']);
  return reply.code(200).send(result);
});
```

### Route 5: `get_project`

```typescript
fastify.post('/voice/tools/get_project', async (request, reply) => {
  const projectId = getArg<string>(request.body, 'project_id');
  if (!projectId) return reply.code(200).send({ ok: false, error: 'project_id is required' });
  fastify.log.info({ tool: 'get_project', projectId }, 'voice tool invoked');
  const result = await runPm(['projects', 'get', String(projectId), '--json']);
  return reply.code(200).send(result);
});
```

### Route 6: `list_properties`

```typescript
fastify.post('/voice/tools/list_properties', async (request, reply) => {
  const limit = getArg<string>(request.body, 'limit') || '20';
  fastify.log.info({ tool: 'list_properties', limit }, 'voice tool invoked');
  const result = await runPm(['properties', 'list', '--limit', String(limit), '--json']);
  return reply.code(200).send(result);
});
```

Note: pm properties list may not have `--limit` flag — Codie verify and drop the flag if unsupported.

### Route 7: `get_tenant` (PRIVACY-GATED)

**Critical: this wrapper MUST redact PII before returning to the Voice AI.** Persona is instructed never to read owner names or full last names, but defense-in-depth at the tool layer.

```typescript
fastify.post('/voice/tools/get_tenant', async (request, reply) => {
  const tenantId = getArg<string>(request.body, 'tenant_id');
  if (!tenantId) return reply.code(200).send({ ok: false, error: 'tenant_id is required' });
  fastify.log.info({ tool: 'get_tenant', tenantId }, 'voice tool invoked');
  const result = await runPm(['tenants', 'get', String(tenantId), '--json']);
  if (!result.ok) return reply.code(200).send(result);

  // Privacy redaction: voice path gets first name + phone only
  const tenant = result.data as Record<string, unknown>;
  const firstName = (tenant.first_name as string) || (tenant.name as string)?.split(' ')[0] || 'tenant';
  const phone = tenant.phone || tenant.mobile_phone || null;
  return reply.code(200).send({
    ok: true,
    data: {
      tenant_id: tenant.id || tenantId,
      first_name: firstName,
      phone,
      // explicitly DO NOT include: last_name, email, dob, ssn, lease_amount, owner_name, balance
    },
  });
});
```

If the pm CLI tenant payload uses different field names (e.g. `full_name`, `home_phone`), Codie adjusts the redaction logic accordingly — first verify with `pm tenants get <known_id> --json` against a test tenant.

### Route 8: `update_meld_notes` (REQUIRES pipx reinstall)

```typescript
fastify.post('/voice/tools/update_meld_notes', async (request, reply) => {
  const meldId = getArg<string>(request.body, 'meld_id');
  const notes = getArg<string>(request.body, 'notes', 'maintenance_notes', 'text');
  if (!meldId || !notes) {
    return reply.code(200).send({ ok: false, error: 'meld_id and notes are required' });
  }
  fastify.log.info({ tool: 'update_meld_notes', meldId }, 'voice tool invoked');
  const result = await runPm([
    'work-orders', 'update-notes',
    '--meld-id', String(meldId).replace(/^TX/i, ''),
    '--notes', String(notes),
    '--json',
  ]);
  return reply.code(200).send(result);
});
```

Codie: verify flag names with `pm work-orders update-notes --help` after pipx reinstall. The flag set above is a best-guess based on existing pm patterns.

---

## Contract Tests (vitest)

Create `test/voice-tools.test.ts`. For each new route, three tests:

1. **happy_path**: valid args → response includes `ok: true` OR `ok: false` with a non-empty `error` (asserts the route DOESN'T throw and returns the shape, NOT that the PM mutation succeeds — runPm is mocked or returns whatever PM returns)
2. **missing_required_arg**: omit a required field → response `{ ok: false, error: "<field> is required" }`
3. **graceful_failure**: runPm returns `{ ok: false, error: '...' }` → route passes it through (response code 200, body ok:false)

Test scaffolding pattern (using `fastify.inject` — no live HTTP):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerVoiceToolRoutes } from '../src/voice-tools.js';

vi.mock('../src/pm-cli.js', () => ({
  runPm: vi.fn(),
}));
import { runPm } from '../src/pm-cli.js';

describe('inspect_meld', () => {
  let app: any;
  beforeEach(async () => {
    app = Fastify();
    await registerVoiceToolRoutes(app);
    await app.ready();
    vi.mocked(runPm).mockReset();
  });

  it('returns ok:false when meld_id missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/voice/tools/inspect_meld', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, error: expect.stringContaining('meld_id') });
  });

  it('subprocesses pm work-orders inspect and returns result', async () => {
    vi.mocked(runPm).mockResolvedValue({ ok: true, data: { id: 'X' } } as any);
    const res = await app.inject({ method: 'POST', url: '/voice/tools/inspect_meld', payload: { meld_id: 'TX12345' } });
    expect(res.statusCode).toBe(200);
    expect(runPm).toHaveBeenCalledWith(['work-orders', 'inspect', '12345', '--json']);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true });
  });

  it('passes through ok:false from runPm', async () => {
    vi.mocked(runPm).mockResolvedValue({ ok: false, error: 'pm exited 2' } as any);
    const res = await app.inject({ method: 'POST', url: '/voice/tools/inspect_meld', payload: { meld_id: '12345' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, error: 'pm exited 2' });
  });
});
```

Replicate the same 3-test pattern per route. **Minimum 24 tests across 8 new routes.** Don't lift coverage to 100% — these three branches per route are sufficient.

For `get_tenant` privacy test specifically — extra test:
```typescript
it('redacts last_name, email, and owner_name from PM response', async () => {
  vi.mocked(runPm).mockResolvedValue({
    ok: true,
    data: { id: '99', first_name: 'Sarah', last_name: 'Johnson', email: 'sarah@example.com', phone: '+14235551234', dob: '1990-01-01', owner_name: 'David Hunter' },
  } as any);
  const res = await app.inject({ method: 'POST', url: '/voice/tools/get_tenant', payload: { tenant_id: '99' } });
  const body = JSON.parse(res.body);
  expect(body.ok).toBe(true);
  expect(body.data.first_name).toBe('Sarah');
  expect(body.data.phone).toBe('+14235551234');
  expect(body.data).not.toHaveProperty('last_name');
  expect(body.data).not.toHaveProperty('email');
  expect(body.data).not.toHaveProperty('dob');
  expect(body.data).not.toHaveProperty('owner_name');
});
```

---

## Telnyx Voice AI Assistant Tool Registration (Collie executes post-merge)

After Codie ships + we merge, Collie runs PATCH to add the 8 new tool definitions to `assistant-47a8c606-2e96-4730-b58c-24d626250748`. Codie does NOT touch Telnyx config — that's Collie's lane.

Codie deliverable: just ship the routes + tests + green CI. Collie picks up from there.

---

## Acceptance Criteria

- [ ] `pipx reinstall cli-anything-pm` completed; `pm work-orders update-notes --help` returns success
- [ ] `npm install --save-dev vitest @vitest/coverage-v8` done; `package.json` has `test` script
- [ ] 8 new POST routes appended to `src/voice-tools.ts` following existing pattern
- [ ] `test/voice-tools.test.ts` has ≥24 contract tests (3 per route minimum) + 1 privacy test for get_tenant
- [ ] `npm test` passes locally with 100% of new tests green
- [ ] `npm run build` (tsc) passes with zero errors
- [ ] PR opened against main, includes acceptance-criteria checklist
- [ ] Codie ACKs the spec by replying with PR # within 24h of dispatch

---

## File Ownership (locked — no overlap)

| File | Owner | Edits |
|---|---|---|
| `src/voice-tools.ts` | Codie | Append 8 routes after existing 17 |
| `test/voice-tools.test.ts` | Codie | NEW file |
| `package.json` | Codie | Add vitest devDep + test script |
| `tsconfig.json` | Codie | Only if vitest types break tsc |
| `dist/*` | nobody | Build artifact — `npm run build` generates |
| Telnyx Voice AI Assistant config | Collie | Post-merge PATCH to add tool defs |
| `orgs/ascendops/docs/voice-coordinator-*` | Collie | Phase tracking docs |

---

## Why this spec is finalized (not draft)

- Phase 0 audit confirms all 8 commands exist in pm CLI source ✓
- Phase 0 audit confirmed installed-binary skew on 2 (projects create, update-notes) — pipx reinstall fixes ✓
- Phase 2 persona already references intent paths that map to these new tools ✓
- Phase 1 audit confirmed all 17 existing tools registered correctly in Telnyx Voice AI Assistant ✓
- voice-tools.ts pattern is uniform; new routes are mechanical adds, low risk ✓

Estimated Codie effort: 90-120 min including pipx setup + vitest scaffold + 8 routes + 25 tests + CI green.

---

## Open question for Codie

Are there any pm CLI flag names that differ from this spec? Codie verifies before writing — drop a one-line correction if so, otherwise execute as written.

Other open question for Collie (resolve post-merge, not blocking Codie):
- Tool definitions for Telnyx Voice AI Assistant: should each new tool include `description` strings + `parameters` JSON schema mirroring existing patterns. Collie writes these in the post-merge PATCH script.

---

## Links

- [[voice-coordinator-build-runbook-2026-05-18]] — parent runbook
- [[voice-coordinator-phase-0-cli-delta-2026-05-17]] — CLI delta analysis (source of the 8-tool list)
- [[voice-coordinator-telnyx-audit-2026-05-17]] — Telnyx portal audit
- [[voice-coordinator-persona-v2-2026-05-17]] — persona v2 (now live on assistant)
- voice-tools.ts: `/Users/davidhunter/projects/blue-voice-gateway/src/voice-tools.ts`
- pm CLI source: `/Users/davidhunter/projects/cli-anything-pm/cli_anything/propertymeld/cli.py`

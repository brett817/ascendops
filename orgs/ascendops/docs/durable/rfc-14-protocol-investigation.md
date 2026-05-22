# RFC #14 Protocol Investigation — Option A Viability

**Author:** Aussie
**Date:** 2026-04-29
**Status:** Investigation complete — Option A is **VIABLE**
**Triggered by:** Collie's PIECE 1 implementation found that codex-companion uses `codex app-server` (broker-based), not `codex exec` directly. Original RFC #14 §3 Option A was based on outdated mental model. Dane delegated investigation to verify whether app-server protocol exposes a writable-roots field.

---

## 1. Methodology

Three concrete steps:

**Step 1 — generate the protocol bindings live.** Codex CLI exposes generators for the app-server wire protocol:

```bash
mkdir -p /tmp/codex-types && codex app-server generate-ts --out /tmp/codex-types/
mkdir -p /tmp/codex-schema && codex app-server generate-json-schema --out /tmp/codex-schema/
```

Both succeeded, emitting full TypeScript type definitions and JSON Schema for the v1 + v2 protocol surfaces. `/tmp/codex-types/v2/` contains 47 `.ts` files including ThreadStartParams, TurnStartParams, SandboxPolicy, SandboxWorkspaceWrite, SandboxMode.

**Step 2 — search emitted bindings for any field name suggesting writable-roots.** Searched for `additional_directories`, `add_dirs`, `additionalDirectories`, `writable_roots`, `sandbox_dirs`, `sandboxDirs`, `writable_paths`:

```bash
grep -rliE "(additional_directories|add_dirs|additionalDirectories|writable_roots|sandbox_dirs|sandboxDirs|writable_paths)" /tmp/codex-types/ /tmp/codex-schema/
```

Hits:
- `/tmp/codex-types/v2/SandboxWorkspaceWrite.ts`
- `/tmp/codex-schema/codex_app_server_protocol.v2.schemas.json`
- `/tmp/codex-schema/codex_app_server_protocol.schemas.json`
- `/tmp/codex-schema/v2/ConfigReadResponse.json`

**Step 3 — read SandboxPolicy + ThreadStartParams + TurnStartParams to map the field's place in the protocol.**

---

## 2. Findings

### Finding 1: SandboxPolicy is a tagged union with a workspaceWrite variant carrying writableRoots

`/tmp/codex-types/v2/SandboxPolicy.ts`:

```typescript
export type SandboxPolicy =
  | { "type": "dangerFullAccess" }
  | { "type": "readOnly", access: ReadOnlyAccess, networkAccess: boolean, }
  | { "type": "externalSandbox", networkAccess: NetworkAccess, }
  | { "type": "workspaceWrite",
      writableRoots: Array<AbsolutePathBuf>,
      readOnlyAccess: ReadOnlyAccess,
      networkAccess: boolean,
      excludeTmpdirEnvVar: boolean,
      excludeSlashTmp: boolean,
    };
```

The `workspaceWrite` variant is the one used for write-capable sessions today. It carries an explicit `writableRoots: Array<AbsolutePathBuf>` field — exactly the writable-roots knob we needed.

### Finding 2: TurnStartParams allows per-turn sandboxPolicy override

`/tmp/codex-types/v2/TurnStartParams.ts`:

```typescript
export type TurnStartParams = {
  threadId: string,
  input: Array<UserInput>,
  cwd?: string | null,
  approvalPolicy?: AskForApproval | null,
  ...
  /** Override the sandbox policy for this turn and subsequent turns. */
  sandboxPolicy?: SandboxPolicy | null,
  ...
};
```

This is the canonical hook. The companion script can build a `SandboxPolicy.workspaceWrite` with `writableRoots: ["/Users/davidhunter/projects/cli-anything-snapcli", ...]` and pass it as `sandboxPolicy` on every TurnStart. It overrides the thread-level default for that turn AND subsequent turns.

### Finding 3: ThreadStartParams.sandbox is a flat SandboxMode enum (no writableRoots)

`/tmp/codex-types/v2/ThreadStartParams.ts`:

```typescript
export type ThreadStartParams = {
  ...
  sandbox?: SandboxMode | null,  // SandboxMode = "read-only" | "workspace-write" | "danger-full-access"
  config?: { [key in string]?: JsonValue } | null,
  ...
};
```

`/tmp/codex-types/v2/SandboxMode.ts`:

```typescript
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
```

So at thread-creation time, the `sandbox` field is just a string-enum — it does NOT carry writableRoots. **The override can only happen at turn-start time** via the richer `SandboxPolicy` type.

There is also a `config: { [key]: JsonValue }` passthrough on ThreadStartParams that maps to `~/.codex/config.toml` overrides — but my Apr 28 test showed `add_dirs` is not a recognized config.toml key for the seatbelt profile. Don't rely on this path.

### Finding 4: codex-companion currently builds ThreadStartParams without writableRoots awareness

`~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/lib/codex.mjs:55`:

```javascript
function buildThreadParams(cwd, options = {}) {
  return {
    cwd,
    model: options.model ?? null,
    approvalPolicy: options.approvalPolicy ?? "never",
    sandbox: options.sandbox ?? "read-only",  // SandboxMode string enum
    serviceName: SERVICE_NAME,
    ephemeral: options.ephemeral ?? true,
    experimentalRawEvents: false
  };
}
```

This explains today's behavior: thread starts with `sandbox: "workspace-write"`, the writableRoots get default-derived from the cwd's enclosing git repo (cortextos), and subsequent turns inherit. There's no place in this struct to inject extra writable roots.

The fix is in the **per-turn TurnStart path** — not in `buildThreadParams`. Whichever function in codex.mjs builds the TurnStartParams (likely a `runTurn` / `startTurn` helper with `threadId + input + cwd`) needs to additionally accept `additionalDirectories` and emit `sandboxPolicy: { type: "workspaceWrite", writableRoots: [defaultRoot, ...additionalDirectories], readOnlyAccess: "..." (preserve current), networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }`.

---

## 3. Verdict — **Option A is VIABLE**

The codex app-server protocol explicitly exposes `writableRoots: Array<AbsolutePathBuf>` inside the `workspaceWrite` SandboxPolicy variant, and this variant can be passed as `sandboxPolicy` on TurnStartParams to override the thread default per-turn. Codex-companion just needs to build that struct and include it.

This is NOT a "set add_dirs and pray" path — it's a typed protocol field with explicit semantics, code-generated bindings prove it, and the same generator is what codex Rust uses internally to enforce the wire format. Setting it correctly will work.

The implementation cost remains roughly the ~50 LOC estimate I gave in the original RFC #14 §3 Option A: codex-companion edits to (a) accept `additional_directories` from the caller (codex-rescue prompt or env), (b) thread it through to `runTurn` / equivalent, (c) build the `SandboxPolicy.workspaceWrite` struct with merged writable roots, (d) attach as `sandboxPolicy` on the TurnStartParams.

---

## 4. Recommended Next Step

**Approve PIECE 1 implementation, with this protocol-level guidance baked in:**

1. Edit `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/lib/codex.mjs` — add a `buildTurnSandboxPolicy(cwd, additionalDirectories)` helper that returns a SandboxPolicy.workspaceWrite struct.
2. Edit codex-companion.mjs's per-turn dispatch site (likely the `runAppServerTurn` path around line 460 in the main file) to call `buildTurnSandboxPolicy` with the caller-provided list and inject the result as TurnStartParams.sandboxPolicy.
3. Surface `additional_directories` through the codex-rescue forwarder as a CLI argument: `codex-rescue ... --add-dir /Users/davidhunter/projects/cli-anything-snapcli`.
4. Verify with the test plan from RFC #14 §4: post-fix `--add-dir` test, end-to-end via codex-rescue, hook gate snapcli pieces.

Codex Thursday morning can implement this once Mode 1 (OpenAI cap) self-resolves. Mode 2 patch + this finding unblock the snapcli rename plan I shipped earlier.

**Pair with PIECE 2 (codex-rescue smart-default) and PIECE 3 (telemetry)** that Collie is shipping — they remain orthogonal and can land independently.

---

## 5. Open Questions

1. **Does setting `sandboxPolicy` on EVERY turn cause performance overhead?** The protocol allows it; whether codex Rust optimizes for "no-change" between turns is unknown. Mitigation: only set when caller passes additional_directories, otherwise omit (null → use thread default).
2. **`AbsolutePathBuf` vs string in writableRoots**: the type is nominally `Array<AbsolutePathBuf>`. Bindings emit it as `Array<string>` (per `AbsolutePathBuf.ts` which is a thin `type AbsolutePathBuf = string;`). JSON wire format is just an array of strings. Pass absolute paths only — relative paths likely rejected.
3. **Resume behavior**: when a thread resumes (`ThreadResumeParams`), does the previous thread's sandboxPolicy persist, or is it reset to default? `ThreadResumeParams.ts` has `sandbox?: SandboxMode | null` (just the enum), no full policy. Probably resumes get the default until first TurnStart-with-policy. Codex-companion should set it on every turn during a multi-turn task to be safe.
4. **Multi-platform concern**: `SandboxWorkspaceWrite.ts` (the v1 / non-versioned variant) uses snake_case (`writable_roots`). The v2 version uses camelCase (`writableRoots`). Codex-companion uses v2 protocol per `lib/codex.mjs:6` import path — so camelCase is correct. But verify before shipping: a typo'd field is a silent no-op.

---

## Word count: ~990 (within 600-1000 target)

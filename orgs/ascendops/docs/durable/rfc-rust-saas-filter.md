# Rust SaaS Response Filter — strip-and-passthrough

**Date:** 2026-04-29 (Wed PM)
**Author:** Collie (Dane dispatch, David greenlit Option B)
**Companion:** [rfc-snapcli-saas-adapter.md](rfc-snapcli-saas-adapter.md). Adapter handles auth + endpoints; this filter handles response bloat. Two halves of the same lever.
**Implementation:** Rust binary, RTK-pattern. PM instance ships first (Blue is heaviest user); reusable across TenantTurner / LeadSimple / AppFolio / Monday / future SaaS.

David's constraint, verbatim: "I dont wanna over engineer it. I just wanna make sure it works."

## §1 — Problem

Every snapcli call returns SaaS-shaped JSON: 30+ fields per object, nested relations, audit metadata, internal IDs, deprecated columns. An agent typically reads 3–8 fields. The other 90%+ enters the agent's context and dies there. RTK measures this same problem on local CLIs: `rtk gain` reports **94.5% tokens saved across 1781 commands**. SaaS responses are worse — JSON is denser per byte, and the surface is wider.

Snapcli today returns raw vendor JSON unmodified. The filter is the layer between vendor and agent.

## §2 — Pattern

Mirror RTK's command-proxy scaffolding:

```
agent → snapcli pm work-orders get 12345
        ↓
        snapcli http_backend → PM API → raw JSON (~12 KB)
        ↓
        rust filter: parse → match allowlist for endpoint → strip → re-emit (~1 KB)
        ↓
agent receives stripped JSON
```

**Mechanism:** intercept the snapcli command surface (not HTTP — too granular). The filter is a separate binary `snapcli-filter` that wraps snapcli's stdout. Plain UNIX pipe contract: takes JSON on stdin (or a captured stdout), produces stripped JSON on stdout. No HTTP-level interception, no in-process integration. Same shape RTK uses.

Invocation:

```bash
snapcli pm work-orders get 12345 --json | snapcli-filter pm work-orders.get
```

Or with shell-alias / wrapper-script integration so agents continue to call `pm work-orders get 12345` and the filter is invisible.

## §3 — Per-SaaS allowlist config schema

Filters live at `orgs/$ORG/saas-filters/<vendor>.json`. One file per vendor. Schema:

```json
{
  "schema_version": "1.0",
  "vendor": "pm",
  "endpoints": {
    "work-orders.get": {
      "allow": [
        "id", "brief_description", "status", "created_at",
        "completion_notes", "maintenance_notes",
        "assigned_technicians[].id", "assigned_technicians[].first_name", "assigned_technicians[].last_name",
        "work_entries[].hours",
        "tenant_obj.{first_name,last_name,phone,email}",
        "unit.address"
      ]
    },
    "work-orders.list": {
      "allow": ["id", "brief_description", "status", "created_at", "assigned_technicians[].id"],
      "max_items": 50
    }
  }
}
```

**Path syntax:** dotted JSONPath-lite (`a.b.c`), array-element wildcard (`a[].field`), brace-enumeration (`obj.{x,y,z}`), trailing `*` for "this whole subtree". No conditional logic, no transforms, no renames — just allow/strip. Anything not listed is dropped.

**Adding a vendor:** drop a new `<vendor>.json` into the dir, register the per-endpoint paths, ship. No code change. Filter binary loads all `*.json` from the configured filter dir at startup.

**Sensible defaults:** if an endpoint is invoked but not present in the allowlist, **passthrough unchanged with a warning to stderr** — never silently strip what the user did not ask for. Telemetry tags the call as `unfiltered_endpoint`.

## §4 — Hook into snapcli architecture

Filter sits **between snapcli's response emission and the agent's stdout**. Two integration modes:

| Mode | When | How |
|---|---|---|
| **Pipe** | Manual / one-off | `snapcli pm ... --json \| snapcli-filter pm <endpoint>`. Explicit. Easy to bypass for debugging. |
| **Wrapper** | Default agent path | `pm` shell wrapper (~30 LOC bash) auto-pipes through the filter when snapcli produces `--json`. Filter is transparent to the caller. |

The wrapper precedes the real `pm` binary in PATH (same path-shadow pattern as the Codex 2-seat rotation wrapper shipped this morning). Bypass with `PM_FILTER_OFF=1` env var.

This is **layered above** rfc-snapcli-saas-adapter.md §3's adapter interface. Adapters keep returning raw vendor JSON; the filter is a per-org concern, not a per-adapter one.

## §5 — Telemetry

Mirror `rtk gain` exactly:

- Per-call: bytes-in, bytes-out, percent-saved, endpoint, vendor, timestamp.
- Aggregate: total calls, total bytes saved, top-N endpoints by impact, per-vendor breakdown.
- Storage: `~/.snapcli-filter/telemetry.jsonl` — append-only JSONL.
- CLI: `snapcli-filter gain` prints the same shape RTK does (count / saved / avg% / time / impact bar).

Bus event on every call (best-effort, fire-and-forget):

```bash
cortextos bus log-event action snapcli_filter_call info \
  --meta '{"vendor":"pm","endpoint":"work-orders.get","bytes_in":12480,"bytes_out":1024,"saved_pct":91.8}'
```

Aggregation lives in the local JSONL; the bus event is for fleet-wide visibility.

## §6 — Reuse from RTK

Concretely lift, do not reinvent:

- **Rust scaffolding:** clap-based subcommand router + JSON parser (serde_json).
- **Command-name proxying:** RTK's `<binary> <args>` pattern → `snapcli-filter <vendor> <endpoint>`. Same shape.
- **Telemetry pipeline:** RTK's per-call append + `rtk gain` aggregation logic. Copy the data shape and the CLI output format verbatim.
- **Cache-on-disk pattern:** RTK caches frequent commands. We probably don't need this for the filter (passthrough is already fast); skip until profiling says otherwise.

Effort estimate: ~600 LOC Rust for the filter binary + 1 wrapper bash script + 1 PM filter JSON. ~2-3 days for one engineer comfortable with Rust + serde_json.

## §7 — Migration

**Phase 1 (week 1) — PM instance.** Blue runs the most snapcli calls; she gets the highest savings first. Ship `pm.json` filter with allowlists for the top 6 endpoints by call volume (`work-orders.list`, `work-orders.get`, `work-orders.files`, `comments.list`, `tenants.list`, `vendors.list`). Soak 3 days. Compare `snapcli-filter gain` vs prior bytes-in totals — David sees a real number.

**Phase 2 (week 2-3) — second SaaS.** Whichever vendor has snapcli adapter parity first (likely AppFolio per current build queue, or Monday for low-stakes stress test). Add `<vendor>.json`, no code change.

**Phase 3 — fleet-wide.** Drop new filter JSON for each new SaaS as adapters land. Filter is one-off-per-vendor config + zero recurring code work.

**Rollback:** `unset PM_FILTER_OFF=1` (single env flip) OR remove the wrapper from PATH. Filter is opt-in via wrapper precedence — removing it returns to today's raw passthrough.

## §8 — Open questions for David

1. **Filter dir location:** `orgs/$ORG/saas-filters/` (committed to repo, per-org) or `~/.snapcli-filter/configs/` (user-local, machine-specific). Lean repo — filters are SaaS-shape decisions, not per-machine. Same place adapters and skills live.
2. **Unfiltered-endpoint policy:** when an endpoint hits the filter without an allowlist entry, passthrough-with-warn (lean) vs strip-to-empty vs hard-error. Lean passthrough — never break working callers.
3. **Wildcard escape hatch:** allow `"*"` to mean "everything for this endpoint" so a user can register an endpoint as known-safe-passthrough? Lean yes — explicit > implicit, and the telemetry still records the call.
4. **Telemetry retention:** append-only JSONL grows unbounded. Cap at last 30 days, last 100k entries, or roll daily? Lean roll daily under `~/.snapcli-filter/telemetry/YYYY-MM-DD.jsonl`.
5. **First-vendor-after-PM choice** (Phase 2): pick by call volume (probably AppFolio if PM bloat is largest in absolute terms) OR by build readiness (Monday adapter is simplest). Lean readiness — savings are everywhere, lowest-friction win first.

## §9 — Out of scope

- Per-vendor rate limiting (David quote: not for tonight).
- A `doctor` / health-check command (RTK has it; we don't need it for v1).
- Response transformation, renaming, computed fields. Strip-and-passthrough only.
- HTTP-level interception. Snapcli command surface is the right boundary.
- Caching responses. Passthrough is already fast; revisit only if telemetry shows a hot endpoint worth caching.

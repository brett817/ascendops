# PM Phone Field Investigation - 2026-05-21

Owner: codie
Status: complete (research-only)
Scope: investigate whether PM API exposes phone/mobile fields on agent records via currently accessible endpoints.
Deferred: no MMS handler code changes from this research.

## Objective
Determine whether any currently accessible PM API surface exposes reliable phone/mobile fields for agent identity matching.

## Method
- Ingested endpoint sweep transcript from `/tmp/c2-pm-phone-field-sweep-2026-05-21.md`.
- Recorded endpoint path, auth/result status, whether phone/mobile fields were present, and reliability.
- Evaluated whether direct agent->phone lookup is viable today.

## Endpoints Tried (summary table)
| Endpoint / Query | Auth/Status | Phone/Mobile Field Present? | Notes |
|---|---|---|---|
| `pm agents list --json` | 200 | **No** | Agent list shape has no phone-like fields. |
| `pm agents search david --json` | 200 | **No** | Search payload mirrors list shape; no phone fields. |
| `/api/agents/{id}/` | 200 | **No (direct)** | `contact` is FK integer only; not dereferenced to phone. |
| `/api/agents/{id}/?expand=contact` and similar include/expand params | 200 | **No** | Params ignored on probed surface. |
| `/api/v2/*` candidate variants | 404 | N/A | Candidate routes not present on this tenant surface. |
| `/api/melds/{id}/` detail | 200 | **Yes (indirect)** | Inlined `agents[i].contact.cell_phone`/`business_phone` available when contact exists. |
| `work-orders list` assigned_technicians payload | Mixed / not reliable | **Not sufficient** | Does not provide direct, authoritative phone source for all agents. |
| `/api/vendors/` and `/api/all-maintenance/` (`type: Vendor`) | 200 | **Yes (vendor only)** | Vendor phone available, but this is not agent roster identity. |

## Findings (structured)
1. **No direct agent->phone endpoint** was found on currently accessible agent-scoped API surfaces (`/api/agents/`, `/api/agents/{id}/`, or tested expand/include variants).
2. **Phone is available indirectly** for agents only via meld detail payloads: `GET /api/melds/{id}/` -> `agents[i].contact.cell_phone`.
3. **Coverage is partial** even there: agents with `contact: null` have no phone values inlined.
4. **Vendor phone fields exist** on vendor-scoped endpoints, but that is a distinct entity path and not a complete in-house agent identity source.
5. **Nexus/OAuth-backed CLI surfaces were constrained** in this environment (e.g., `pm vendors list` requiring `PM_CLIENT_ID`/`PM_CLIENT_SECRET`), so this report is based on cookie-session-accessible PM surfaces from the transcript.

## Preliminary Read
On currently accessible PM surfaces, reliable direct phone-roster lookup for in-house agents is **not available** as a single authoritative endpoint. The only discovered path is meld-detail-coupled and therefore contextual/partial, not roster-grade.

## Confidence
**High** for the scoped question on currently accessible endpoints.

Reasoning:
- broad route/param sweep performed
- repeated 200 responses on core endpoints with stable field shapes
- consistent absence of direct phone fields on agent-scoped payloads
- positive control where phone does appear (meld detail and vendor entities)

## Next Action
- Treat this as a research artifact only (no code-path change from this doc).
- If future product direction requires direct agent phone identity, evaluate whether a different authenticated PM surface (outside current cookie-session probe scope) exposes dereferenced contact records or an explicit roster endpoint.

## Source Transcript
- `/tmp/c2-pm-phone-field-sweep-2026-05-21.md`

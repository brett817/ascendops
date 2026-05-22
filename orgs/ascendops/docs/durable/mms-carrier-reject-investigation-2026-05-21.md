# MMS Inbound Investigation - 2026-05-21 (Refocused)

- Owner: codie
- Refocus timestamp: 2026-05-21 19:00 UTC / 3:00 PM EDT
- Scope lock: **Inbound MMS to +14236331021** (vendors + in-house technicians), then ingest to Property Meld files.

## Question Set (Inbound Lens)
1. Did the known inbound delivered MMS hit our webhook?
2. Is gateway webhook/signing/config correct for inbound MMS?
3. Is there a carrier/TCR gate pattern that explains "worked once" + "none in last 24h"?

## Evidence Collected

### A) Telnyx message records (Subagent A)
Source summary: `/tmp/mms-api-sweep/subagent-a-summary.md`
Raw: `/tmp/mms-api-sweep/subagent-a/*.json`

- Last-24h window at sweep time: `2026-05-20T18:58:09Z` → `2026-05-21T18:58:09Z`
- Inbound MMS from `+16788156005` to `+14236331021` in-window: **0**
- Exact pair records in-window: **0**
- Nearest inbound MMS evidence just outside window:
  - `2026-05-20T18:40:32Z` inbound MMS `+16788156005 -> +14236331021`, status `delivered`, id `0feca473-06a1-4b03-9bf4-5956b6cde26e`

### B) Gateway webhook boundary verification (Codie + Subagent B)
Subagent summary: `/tmp/mms-api-sweep/subagent-b-summary.md`
Raw: `/tmp/mms-api-sweep/subagent-b/*`
Railway logs snapshot: `/tmp/mms-api-sweep/railway-logs-latest.txt`

- Number `+14236331021` attached to messaging profile `40019d9d-6df8-4c94-bd39-0460573b7aa7` (`blue-sms-gateway`).
- Messaging profile inbound webhook URL is correctly set to:
  - `https://blue-voice-gateway-production.up.railway.app/webhook/telnyx/mms-inbound`
- Signing key parity confirmed:
  - Railway `TELNYX_PUBLIC_KEY` == gateway runtime `TELNYX_PUBLIC_KEY` (**match**)

#### Critical inbound trace (proves webhook fired)
From gateway logs around the delivered MMS timestamp:
- `2026-05-20T18:40:38Z` incoming `POST /webhook/telnyx/mms-inbound`
- `statusCode=200`
- handler log: `action="skipped" detail="no-active-meld" message_id="ffbeafb1-ab6e-4ff6-8c5d-2970c111f27b" from_phone="+16788156005" media_count=2`

Conclusion: the inbound MMS did reach Telnyx and did fire our webhook at least once end-to-end; it was skipped by business logic (no active meld at processing time), not dropped by signature or route misconfiguration.

### C) 10DLC / brand state (Subagent C)
Source summary: `/tmp/mms-api-sweep/subagent-c-summary.md`
Raw: `/tmp/mms-api-sweep/subagent-c/*.json`

- Brand: `identityStatus=VERIFIED`, `status=OK`
- Campaign: `status=ACTIVE`, `campaignStatus=MNO_PROVISIONED`, `isTMobileRegistered=true`
- Warning still present in campaign failure reasons:
  - `Unable to verify, need working website or online presence provided for brand validation. (804)`
- No explicit MMS-approval field, queue, reviewer, or ETA in these API payloads.

## Localization Read (Most Likely)

1. **Not a webhook wiring problem** (URL + signature + 200 handling all confirmed).
2. **Not purely a universal inbound block** (at least one inbound MMS delivered and processed to handler).
3. Current failure pattern most likely a combination of:
   - **Carrier/TCR trust variability** tied to incomplete brand validation signal (804), and/or
   - **Business-logic skip path** (`no-active-meld`) causing valid inbound media to be intentionally dropped before PM upload.

## Monday Decision Frame (Inbound Use Case)

### Decision A — If we need immediate reliability by Monday
Implement route-side fallback behavior for valid inbound MMS when no active meld is found:
- create triage record + alert, or
- map to most recent eligible vendor/tech meld with explicit guardrails.

### Decision B — Compliance path (parallel)
Treat TCR validation warning `(804)` as a must-fix carrier trust issue and submit brand online-presence evidence.

## Specific Next Actions (Fleet-owned, not David-owned implementation)

1. **TCR evidence packet prep** (we draft, David approves):
- Ascend Property Management public website URL
- Matching legal/business identity references
- Contact page and service presence links

2. **Gateway logic patch proposal** (if approved):
- For inbound MMS with media and known sender but no active meld, do not silently drop.
- Persist pending photo event for operator triage.

3. **Controlled inbound test matrix**
- Repeat inbound MMS from at least two carriers to `+14236331021`
- Record Telnyx ingress + gateway action + PM file outcome per attempt.

## Artifact Index
- `/tmp/mms-api-sweep/subagent-a-summary.md`
- `/tmp/mms-api-sweep/subagent-b-summary.md`
- `/tmp/mms-api-sweep/subagent-c-summary.md`
- `/tmp/mms-api-sweep/railway-logs-latest.txt`

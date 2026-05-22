# Telnyx MMS Setup — Vendor Photo -> PM Files (Phase 1)

Date: 2026-05-19
Owner (Telnyx-side): codie
Companion (gateway-side): collie
Foundation: [telnyx-voice-agent-setup-guide-2026-05-19.md](./telnyx-voice-agent-setup-guide-2026-05-19.md)

Scope: MMS-specific layer only (messaging profile, MMS capability, inbound webhook route, signature verification parity).

## 1) Messaging Profile Create/Audit

### What
Ensure a messaging profile exists and is bound to the operator number used for vendor photo intake.

### How
List profiles:

```bash
TELNYX_API_KEY=KEY...
curl -sS https://api.telnyx.com/v2/messaging_profiles \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H 'Content-Type: application/json' | jq '.data[] | {id,name,enabled,webhook_url,webhook_api_version}'
```

Ground truth (AscendOps account at run time):
- `messaging_profile_id`: `40019d9d-6df8-4c94-bd39-0460573b7aa7`
- `name`: `blue-sms-gateway`
- `enabled`: `true`

### Verify
GET profile directly:

```bash
PROFILE_ID=40019d9d-6df8-4c94-bd39-0460573b7aa7
curl -sS "https://api.telnyx.com/v2/messaging_profiles/$PROFILE_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H 'Content-Type: application/json' | jq '{id:.data.id,name:.data.name,enabled:.data.enabled}'
```

### Fail-mode
- `401`/`403`: invalid/revoked API key or wrong account.
- `404`: profile id not in this account.

---

## 2) MMS Capability on Existing Number

### What
Confirm the existing number supports MMS and is attached to the target messaging profile.

### How
List numbers attached to the messaging profile:

```bash
PROFILE_ID=40019d9d-6df8-4c94-bd39-0460573b7aa7
curl -sS "https://api.telnyx.com/v2/messaging_profiles/$PROFILE_ID/phone_numbers" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H 'Content-Type: application/json' | jq '.data[] | {phone_number,messaging_profile_id,features}'
```

Ground truth (AscendOps account at run time):
- `phone_number`: `+14236331021`
- `messaging_profile_id`: `40019d9d-6df8-4c94-bd39-0460573b7aa7`
- `features.mms.domestic_two_way`: `true`

### Verify
Direct number lookup:

```bash
NUMBER_ID=2939003968266699862
curl -sS "https://api.telnyx.com/v2/phone_numbers/$NUMBER_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H 'Content-Type: application/json' | jq '{id:.data.id,phone_number:.data.phone_number,messaging_profile_id:.data.messaging_profile_id,status:.data.status}'
```

### Fail-mode
- Number exists but `messaging_profile_id` missing/wrong: attach number to correct messaging profile in portal/API.
- MMS feature absent on number: Telnyx account/number capability issue (human escalation to Telnyx support).

---

## 3) Configure MMS Inbound Webhook URL

### What
Set messaging profile inbound webhook target to gateway MMS receiver route:
- `POST /webhook/telnyx/mms-inbound`

### How
Patch messaging profile:

```bash
PROFILE_ID=40019d9d-6df8-4c94-bd39-0460573b7aa7
curl -sS -X PATCH "https://api.telnyx.com/v2/messaging_profiles/$PROFILE_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
    "webhook_url":"https://blue-voice-gateway-production.up.railway.app/webhook/telnyx/mms-inbound",
    "webhook_api_version":"2"
  }'
```

### Verify
GET-back must show new URL:

```bash
curl -sS "https://api.telnyx.com/v2/messaging_profiles/$PROFILE_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H 'Content-Type: application/json' | jq '{id:.data.id,webhook_url:.data.webhook_url,webhook_api_version:.data.webhook_api_version,updated_at:.data.updated_at}'
```

Ground truth after patch:
- `webhook_url`: `https://blue-voice-gateway-production.up.railway.app/webhook/telnyx/mms-inbound`
- `webhook_api_version`: `2`
- PATCH returned HTTP `200`

### Fail-mode
- PATCH `200` but URL unchanged: stale write target/profile id mismatch; re-GET and re-run with explicit profile id.
- `422`: malformed URL/body.
- `404`: wrong profile id.

---

## 4) Ed25519 Signature Parity (MMS vs Voice)

### What
Confirm MMS webhook verification uses the same Telnyx Ed25519 model and same account public key (`TELNYX_PUBLIC_KEY`) as voice webhooks.

### How
Authoritative Telnyx docs confirm messaging webhooks include:
- `telnyx-signature-ed25519`
- `telnyx-timestamp`

and are verified against account public key from Mission Control -> Keys & Credentials.

Primary docs:
- https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks
- https://developers.telnyx.com/docs/messaging/messages/receive-message
- https://developers.telnyx.com/development/api-fundamentals/webhooks/receiving-webhooks

### Verify
Gateway-level behavior check (unsigned probe should fail closed):

```bash
curl -i -X POST "https://blue-voice-gateway-production.up.railway.app/webhook/telnyx/mms-inbound" -d '{}'
# expected: 401 signature verification failed (or equivalent fail-closed)
# NOT expected: 503 TELNYX_PUBLIC_KEY not configured
```

Interpretation:
- `401` = signature middleware active (correct gate behavior for unsigned test)
- `503` = env/config gap (`TELNYX_PUBLIC_KEY` missing)

### Fail-mode
- `503` on MMS route while voice routes are 401: MMS route not wired into shared signature middleware.
- `200` on unsigned MMS probe: signature verification bypass bug in route wiring.

---

## Current Status (Ready for Collie Integration)

Completed on Telnyx side:
1. Messaging profile audited (exists, enabled)
2. Number/profile MMS capability confirmed (`mms.domestic_two_way=true`)
3. MMS inbound webhook URL updated to `/webhook/telnyx/mms-inbound` (PATCH 200 + GET-back)
4. Ed25519 parity model documented with source links + runtime verification pattern

Next owner action (Collie):
- Finish gateway receiver implementation + media download + PM upload flow
- Re-run signed/unsigned route probes + live MMS smoke from vendor handset

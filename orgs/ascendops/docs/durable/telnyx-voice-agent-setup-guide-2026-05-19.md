# Telnyx Voice Agent Setup Guide (Agent-Executable)

Date: 2026-05-19
Authors: codie (Telnyx account, API, assistant, TeXML, insights, number wiring) + collie (repo + Railway, env matrix, webhook architecture, deploy, smoke, outbound dispatch, live test)
Scope: end-to-end voice-agent setup — from a fresh Telnyx signup through a live outbound test call

This guide is written for a fresh Claude Code agent on a new AscendOps operator machine. Doubles as productization playbook + Monday CEO/CTO call demo material. Sections 0-8 are Telnyx-side prerequisites; Sections 9-16 are deployment + integration + first-call smoke; Sections 17-19 are reference (env vars, failure modes, handoff).

## 0. Preconditions (Plan First)

### What
Define the minimal inputs before touching APIs.

### How
Collect and set these local values:

```bash
export TELNYX_EMAIL="<operator-email>"
export TELNYX_PASSWORD="<stored securely / human login>"
export TELNYX_API_KEY="KEY..."
export VOICE_GATEWAY_URL="https://<operator-voice-gateway>.up.railway.app"
export INSIGHTS_WEBHOOK_URL="$VOICE_GATEWAY_URL/voice/conversation-insights"
export CALL_STATUS_WEBHOOK_URL="$VOICE_GATEWAY_URL/voice/call-status"
```

### Verify
- `TELNYX_API_KEY` starts with `KEY`.
- `VOICE_GATEWAY_URL` is publicly reachable.

### Fail-mode
- Missing operator login or 2FA access: create `[HUMAN]` task for account owner.
- If no public gateway URL yet: finish deployment side first, then continue.

---

## 1. Create Telnyx Account + Baseline Verification

### What
Create Mission Control account and complete baseline verification gates.

### How
1. Human signs up at `https://portal.telnyx.com`.
2. Complete baseline account setup:
- email verification
- phone verification
- business profile (name/address/contact)
- payment method
- 2FA
3. If KYC/L1/L2 verification prompts appear, follow them.

### Verify
- User can log in to Mission Control.
- API sections and AI Assistant sections are visible.
- Account has active payment method.

### Fail-mode
- KYC requests docs (passport, business docs, EIN proof): **human step**. Agent creates `[HUMAN]` task with exact doc list shown by portal.
- If portal features hidden after signup: account not fully verified; stop and escalate.

---

## 2. Generate API Key

### What
Create API key for all subsequent API actions.

### How
Portal path: Mission Control -> Keys & Credentials -> API Keys -> Create.

Store as env var:

```bash
export TELNYX_API_KEY="KEY..."
```

Health check:

```bash
curl -sS https://api.telnyx.com/v2/call_control_applications \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H 'Content-Type: application/json' | jq '{count:(.data|length),errors:.errors}'
```

### Verify
- Response has `data` array or valid empty set.
- No auth errors.

### Fail-mode
- `401`/`403`: wrong key, revoked key, or wrong account.
- Network/TLS failure: machine connectivity issue; retry then escalate.

---

## 3. Retrieve TELNYX_PUBLIC_KEY (Ed25519)

### What
Get webhook signature verification public key for `TELNYX_PUBLIC_KEY` env var.

### How
Important: in current Telnyx surfaces this is **portal-only** (not exposed on AI assistant/TeXML/call-control/insight APIs).

Portal path:
- Mission Control -> Keys & Credentials -> Public Key
- Copy raw base64 Ed25519 key

Set env var in gateway runtime:

```bash
TELNYX_PUBLIC_KEY="<base64-44-char-key>"
```

### Verify
After deploy, probe signed endpoints without signature and expect `401 signature verification failed` (not `503 not configured`):

```bash
curl -i -X POST "$VOICE_GATEWAY_URL/voice/call-status" -d '{}'
curl -i -X POST "$VOICE_GATEWAY_URL/voice/conversation-insights" -d '{}'
curl -i -X POST "$VOICE_GATEWAY_URL/webhook/telnyx/transcript" -d '{}'
```

### Fail-mode
- If route returns `503 TELNYX_PUBLIC_KEY not configured`: env var missing in deployment runtime.
- If route returns `401 signature verification failed`: expected for unsigned test calls.
- If route returns `404`: stale deploy image/source mismatch (redeploy from current main).

---

## 4. Create Voice AI Assistant

### What
Create Alex-style assistant in Telnyx via API.

### How
Endpoint: `POST /v2/ai/assistants`

Example payload (sanitized):

```bash
cat > /tmp/telnyx-assistant-create.json <<'JSON'
{
  "name": "blue-maint-coord-test",
  "model": "moonshotai/Kimi-K2.5",
  "instructions": "You are Alex, the maintenance coordinator at Ascend Property Management...",
  "voice_settings": {
    "voice": "alloy",
    "language": "en-US"
  },
  "tools": [
    {
      "type": "webhook",
      "timeout_ms": 5000,
      "webhook": {
        "name": "lookup_meld",
        "description": "Look up a Property Meld work order by ID",
        "url": "https://<voice-gateway>/voice/tools/lookup_meld",
        "method": "POST",
        "body_parameters": {
          "type": "object",
          "properties": {"meld_id": {"type": "string"}},
          "required": ["meld_id"]
        }
      }
    }
  ]
}
JSON

curl -sS -X POST https://api.telnyx.com/v2/ai/assistants \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H 'Content-Type: application/json' \
  --data @/tmp/telnyx-assistant-create.json | tee /tmp/telnyx-assistant-create-resp.json
```

Capture assistant ID:

```bash
jq -r '.id // .data.id' /tmp/telnyx-assistant-create-resp.json
```

Set:

```bash
export TELNYX_ALEX_ASSISTANT_ID="assistant-..."
```

### Verify

```bash
curl -sS "https://api.telnyx.com/v2/ai/assistants/$TELNYX_ALEX_ASSISTANT_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" | jq '{id,name,model,tools_count:(.tools|length)}'
```

### Fail-mode
- `400 Missing required parameter`: malformed JSON body.
- `401`: bad key.
- `422`: invalid tool schema or model/voice config.

---

## 5. Update Persona Prompt (Voicemail SMS-Pivot)

### What
Patch assistant instructions with voicemail behavior that pivots back to SMS.

### How
Endpoint used in production flow: `POST /v2/ai/assistants/{assistant_id}` with updated `instructions`.

Canonical voicemail block (from `src/persona-voicemail-note.md`):

> If you reach a voicemail or answering machine instead of a live person, leave a brief, natural-sounding message. Identify yourself as Alex from Ascend Property Management, state the reason for the call in one sentence, and invite a text-back: "If you'd rather text, the easiest way to reach me is to send a text to this same number — I'll get right back to you." Keep the whole message under 15 seconds. Then end the call.

Patch flow:

```bash
ASSISTANT_ID="$TELNYX_ALEX_ASSISTANT_ID"

curl -sS "https://api.telnyx.com/v2/ai/assistants/$ASSISTANT_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" > /tmp/alex-before.json

# Build instructions string by appending block once (scripted in agent runtime).
python3 - <<'PY'
import json
from pathlib import Path
obj=json.loads(Path('/tmp/alex-before.json').read_text())
base=obj.get('instructions') or ''
block=("If you reach a voicemail or answering machine instead of a live person, leave a brief, natural-sounding message. "
"Identify yourself as Alex from Ascend Property Management, state the reason for the call in one sentence, and invite a text-back: \"If you'd rather text, the easiest way to reach me is to send a text to this same number — I'll get right back to you.\" Keep the whole message under 15 seconds. Then end the call.")
new=base if block in base else (base.rstrip()+"\n\n"+block).strip()
Path('/tmp/alex-instructions.txt').write_text(new)
PY

jq -n --rawfile instructions /tmp/alex-instructions.txt '{instructions:$instructions}' > /tmp/alex-patch.json

curl -sS -X POST "https://api.telnyx.com/v2/ai/assistants/$ASSISTANT_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H 'Content-Type: application/json' \
  --data @/tmp/alex-patch.json
```

### Verify
GET-back semantic checks:

```bash
curl -sS "https://api.telnyx.com/v2/ai/assistants/$ASSISTANT_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" | jq '{
    contains_voicemail:(.instructions|contains("If you reach a voicemail or answering machine")),
    contains_brand:(.instructions|contains("Ascend Property Management")),
    contains_sms_pivot:(.instructions|contains("text to this same number"))
  }'
```

### Fail-mode
- `400 Missing required parameter`: malformed patch body.
- No text change on GET-back: patch call hit wrong assistant ID or wrong account.

---

## 6. Resolve TeXML Application + Bind to Assistant

### What
Find TeXML app that targets the assistant and record `TELNYX_TEXML_APP_ID`.

### How
List TeXML apps:

```bash
curl -sS https://api.telnyx.com/v2/texml_applications \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H 'Content-Type: application/json' > /tmp/texml-apps.json

jq '.data[] | {id,friendly_name,voice_url}' /tmp/texml-apps.json
```

Find app whose `voice_url` points to:
- `https://api.telnyx.com/v2/ai/assistants/<assistant-id>/texml`

Example ground truth from production run:
- `id: 2954301261882590783`
- `friendly_name: ai-assistant-47a8c606-2e96-4730-b58c-24d626250748`

Set:

```bash
export TELNYX_TEXML_APP_ID="<id>"
```

### Verify

```bash
curl -sS "https://api.telnyx.com/v2/texml_applications/$TELNYX_TEXML_APP_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" | jq '{id:(.data.id),friendly_name:(.data.friendly_name),voice_url:(.data.voice_url)}'
```

### Fail-mode
- No matching app: create one in portal or API and point `voice_url` at assistant TeXML URL.
- `401`: wrong API key.

---

## 7. Configure Conversation Insights Webhook

### What
Set Insight Group webhook to the gateway endpoint so post-call insights flow into Blue.

### How
1. Resolve assistant insight-group id:

```bash
ASSISTANT_ID="$TELNYX_ALEX_ASSISTANT_ID"
INSIGHT_GROUP_ID=$(curl -sS "https://api.telnyx.com/v2/ai/assistants/$ASSISTANT_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" | jq -r '.insight_settings.insight_group_id')

echo "$INSIGHT_GROUP_ID"
```

2. GET before:

```bash
curl -sS "https://api.telnyx.com/v2/ai/conversations/insight-groups/$INSIGHT_GROUP_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" | jq '{id:(.data.id // .id),webhook:(.data.webhook // .webhook)}'
```

3. PUT webhook:

```bash
jq -n --arg webhook "$INSIGHTS_WEBHOOK_URL" '{webhook:$webhook}' > /tmp/insight-put.json

curl -sS -X PUT "https://api.telnyx.com/v2/ai/conversations/insight-groups/$INSIGHT_GROUP_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H 'Content-Type: application/json' \
  --data @/tmp/insight-put.json
```

### Verify
GET-back must show webhook exactly equals `$INSIGHTS_WEBHOOK_URL`.

### Fail-mode
- `404 Resource not found`: wrong insight group id or wrong endpoint path.
- `401`: wrong key/account.
- Webhook still empty after PUT: update failed or written to different account.

---

## 8. Phone Number Assignment (Inbound + Outbound Caller ID)

### What
Attach number routing and outbound caller identity.

### How
1. Acquire/port a number in Telnyx Mission Control.
2. For inbound handling, attach number to relevant voice app/assistant routing in portal.
3. For outbound, set caller ID number in gateway env as `TELNYX_FROM_NUMBER` (or equivalent in dispatch layer).

API sanity on numbers:

```bash
curl -sS https://api.telnyx.com/v2/phone_numbers \
  -H "Authorization: Bearer $TELNYX_API_KEY" | jq '.data[] | {phone_number,connection_id,voice_url}'
```

### Verify
- Inbound call reaches assistant/gateway flow.
- Outbound calls display expected caller ID.

### Fail-mode
- Call fails with channel/cap limits: account verification/concurrency cap issue.
- Inbound dead air/wrong route: number not attached to correct app/flow.

---

## 9. Clone + Build the Voice Gateway Repo

### What
Get the gateway source locally, install dependencies, build, and run a local smoke before pushing to Railway.

### How
```bash
# Clone the operator's fork of blue-voice-gateway
# (or the canonical noogalabs repo on first install)
git clone https://github.com/noogalabs/blue-voice-gateway.git
cd blue-voice-gateway

# Install dependencies (Node 20+)
npm install

# Build the TypeScript to dist/
npm run build

# Optional: run unit tests locally before deploy
npm test
```

Local smoke (offline; verifies the build is intact):
```bash
PORT=8788 \
TELNYX_PUBLIC_KEY=placeholder-44-char-base64=========================== \
TELNYX_API_KEY=placeholder \
VOICE_GATEWAY_INTERNAL_TOKEN=$(openssl rand -hex 32) \
PM_WEBHOOK_SECRET=$(openssl rand -hex 32) \
node dist/index.js &

sleep 2
curl -sS http://localhost:8788/health | jq .
kill %1
```

### Verify
- `npm run build` exits 0; `dist/` directory populated.
- `npm test` reports green (current count: 23/23 unit + integration).
- Local `/health` curl returns `{"ok":true,...}`.

### Fail-mode
- `npm install` SSL/CA errors: check corporate proxy + Node version; require Node 20+.
- TypeScript build errors after a `git pull`: stale `node_modules`; `rm -rf node_modules && npm install`.
- Local smoke fails with `Error: TELNYX_PUBLIC_KEY missing`: the placeholder above must be exactly 44 base64 characters (Ed25519 length); pad with `=` if needed for local-only testing.

---

## 10. Provision Railway Service

### What
Create the Railway project + service that will host the gateway, then connect it to the GitHub repo so deploys flow from commits.

### How
1. Install Railway CLI if not present:
   ```bash
   npm install -g @railway/cli
   railway login
   ```

2. From the repo root, create a new project + service:
   ```bash
   cd blue-voice-gateway
   railway init                 # interactive: pick "Empty Project", name it ascend-voice-gateway
   railway link                 # link the local repo to the new project
   ```

3. Connect the GitHub repo for auto-deploy on `main`:
   - Railway dashboard → Project → Settings → Source → connect repo, set deploy branch = `main`.
   - Note: the Railway CLI does not expose a `service connect` subcommand for repo wire-up (current `railway service` subcommands: list/link/delete/status/logs/redeploy/restart/scale). Use the dashboard for source-repo linkage.

4. Build + start config (auto-detected; override only if needed):
   - Build command: `npm install && npm run build`
   - Start command: `node dist/index.js`

5. Capture the public URL Railway assigns:
   ```bash
   railway status --json | jq -r '.services[0].domains[0].url'
   # → https://<service>.up.railway.app
   export VOICE_GATEWAY_URL="https://<service>.up.railway.app"
   ```

### Verify
- `railway status` shows the service in `BUILDING` then `DEPLOYED`.
- `curl -sS $VOICE_GATEWAY_URL/health` returns `200` (will fail until env vars set in next step — that is expected on first deploy).
- Railway dashboard shows the GitHub repo linked under Source.

### Fail-mode
- `railway init` 401: re-run `railway login`.
- Build fails on Railway with "Cannot find module": missing `package-lock.json` in the repo; commit it.
- Service deploys but immediate 502: env vars not set yet — proceed to Section 11, do not treat as a bug.

---

## 11. Environment Variables — Full Matrix

### What
Set every env var the gateway needs in one batch, with secret hygiene (prefix-only proofs, never echo plaintext).

### How
Variables fall into three groups:

**Group A — Telnyx (from Codie's sections):**
| Var | Source | Sensitivity |
|---|---|---|
| `TELNYX_API_KEY` | Section 2 (`KEY...`) | secret |
| `TELNYX_PUBLIC_KEY` | Section 3 (portal-only, 44-char base64 Ed25519) | secret |
| `TELNYX_ALEX_ASSISTANT_ID` | Section 4 (`assistant-...`) | non-secret |
| `TELNYX_TEXML_APP_ID` | Section 6 (numeric id) | non-secret |
| `TELNYX_FROM_NUMBER` | Section 8 (E.164, `+1...`) | non-secret |

**Group B — Gateway-internal secrets (operator generates):**
| Var | How to generate | Sensitivity |
|---|---|---|
| `VOICE_GATEWAY_INTERNAL_TOKEN` | `openssl rand -hex 32` | secret |
| `PM_WEBHOOK_SECRET` | `openssl rand -hex 32` | secret |

**Group C — URL plumbing (derived from Section 10):**
| Var | Value |
|---|---|
| `VOICE_STATUS_CALLBACK_URL` | `${VOICE_GATEWAY_URL}/voice/call-status` |
| `INSIGHTS_WEBHOOK_URL` | `${VOICE_GATEWAY_URL}/voice/conversation-insights` |

Set them all in one Railway call (auto-triggers redeploy from latest snapshot):

```bash
# Generate the internal secrets first
INT_TOKEN=$(openssl rand -hex 32)
PM_SECRET=$(openssl rand -hex 32)

railway variables \
  --set "TELNYX_API_KEY=$TELNYX_API_KEY" \
  --set "TELNYX_PUBLIC_KEY=$TELNYX_PUBLIC_KEY" \
  --set "TELNYX_ALEX_ASSISTANT_ID=$TELNYX_ALEX_ASSISTANT_ID" \
  --set "TELNYX_TEXML_APP_ID=$TELNYX_TEXML_APP_ID" \
  --set "TELNYX_FROM_NUMBER=$TELNYX_FROM_NUMBER" \
  --set "VOICE_GATEWAY_INTERNAL_TOKEN=$INT_TOKEN" \
  --set "PM_WEBHOOK_SECRET=$PM_SECRET" \
  --set "VOICE_STATUS_CALLBACK_URL=${VOICE_GATEWAY_URL}/voice/call-status" \
  --set "INSIGHTS_WEBHOOK_URL=${VOICE_GATEWAY_URL}/voice/conversation-insights"
```

**Secret hygiene — never log plaintext:**
```bash
# Confirm a secret landed by prefix/suffix proof only, never full value:
railway variables --json | jq -r '.TELNYX_PUBLIC_KEY' | \
  awk '{print "prefix:"substr($0,1,4)" suffix:"substr($0,length-3)" len:"length}'
# → prefix:lse/ suffix:2To= len:44
```

Store the operator's plaintext copies in the operator's password manager (1Password, Bitwarden) — **never** commit them to git, never paste them in chat or Telegram.

### Verify
- `railway variables --json` lists all 9 keys above with non-empty values.
- Prefix-proof matches what was sourced from Telnyx portal (especially `TELNYX_PUBLIC_KEY` since it is portal-only and easy to mistype).
- A fresh redeploy triggers automatically from the `railway variables --set` call; wait for `DEPLOYED` status before smoking.

### Fail-mode
- Prefix-proof mismatch on `TELNYX_PUBLIC_KEY`: re-copy from Mission Control portal (Section 3); base64 keys often pick up trailing whitespace on paste.
- Variable set but service crash-loops on boot: check Railway logs for `Error: <VAR_NAME> required` — usually means the var is set with an empty string. Re-set with the real value.
- `railway variables` lists keys but service still 503s on routes: the redeploy did not yet pick them up; wait 30-60s and re-check status.

---

## 12. Webhook Receiver Architecture

### What
Understand which routes the gateway exposes and what auth each one enforces. This is the contract Telnyx + Property Meld + the agent runtime all rely on.

### How
Six routes exist after a successful deploy:

| Route | Method | Auth | Caller |
|---|---|---|---|
| `/health` | GET | none | Railway + operator | 
| `/voice/call-status` | POST | Ed25519 sig (TELNYX_PUBLIC_KEY) | Telnyx call-status webhook |
| `/voice/conversation-insights` | POST | Ed25519 sig (TELNYX_PUBLIC_KEY) | Telnyx post-call insights |
| `/webhook/telnyx/transcript` | POST | Ed25519 sig (TELNYX_PUBLIC_KEY) | Telnyx transcript webhook |
| `/voice/outbound` | POST | Bearer token (VOICE_GATEWAY_INTERNAL_TOKEN) | agent runtime (Collie → dial) |
| `/webhook/pm` | POST | Shared secret header `X-PM-Webhook-Secret` | Property Meld webhook |

**Ed25519 signature verification (Telnyx-signed routes):**
- Reference implementation: `src/middleware/verify-telnyx-signature.ts` in blue-voice-gateway (landed in PR #5).
- Pattern: extract `Telnyx-Signature-Ed25519` header, verify against raw body + `TELNYX_PUBLIC_KEY` via `crypto.verify('ed25519', ...)`.
- Fail-closed: any verification error → `401 signature verification failed`. Missing key → `503 TELNYX_PUBLIC_KEY not configured` (deploy bug, not auth bug).

**Bearer token (outbound dial):**
- `/voice/outbound` requires `Authorization: Bearer ${VOICE_GATEWAY_INTERNAL_TOKEN}` header.
- This is the auth boundary between the agent runtime and the gateway — agents that want to fire a call must hold the token.
- Token rotation: regenerate with `openssl rand -hex 32`, set via `railway variables`, redeploy; update the agent runtime's stored copy in `orgs/<org>/secrets.env`.

**Shared secret (PM webhook):**
- `/webhook/pm` requires `X-PM-Webhook-Secret: ${PM_WEBHOOK_SECRET}` header.
- Set the same value on the Property Meld side when subscribing the webhook to the gateway URL.

### Verify
After deploy, all five non-health routes should fail-closed on unauthenticated probes:
```bash
curl -i -X POST "$VOICE_GATEWAY_URL/voice/call-status" -d '{}'                        # → 401
curl -i -X POST "$VOICE_GATEWAY_URL/voice/conversation-insights" -d '{}'              # → 401
curl -i -X POST "$VOICE_GATEWAY_URL/webhook/telnyx/transcript" -d '{}'                # → 401
curl -i -X POST "$VOICE_GATEWAY_URL/voice/outbound" -d '{}'                           # → 401
curl -i -X POST "$VOICE_GATEWAY_URL/webhook/pm" -d '{}'                               # → 401
curl -sS "$VOICE_GATEWAY_URL/health"                                                  # → 200
```

### Fail-mode
- Any signed route returns `503 TELNYX_PUBLIC_KEY not configured`: env var missing (re-do Section 11).
- Any signed route returns `200` on unsigned probe: verification middleware not wired — check `src/index.ts` route registration order, signature middleware must run BEFORE the route handler.
- `/voice/outbound` returns `200` on no-token probe: bearer middleware off — check that `requireInternalToken` is applied to that route.

---

## 13. Deploy from Clean Main

### What
Ship the current `main` branch HEAD to Railway, avoiding the snapshot pitfall.

### How
**Critical detail (learned 2026-05-18 night):** `railway redeploy` rebuilds from the **stored snapshot**, not the latest git HEAD. After merging a PR into `main`, you must run `railway up` from a clean local main to push the latest source — `railway redeploy` will silently rebuild yesterday's snapshot.

```bash
# Verify local main is clean + at the latest remote HEAD
git checkout main
git pull origin main
git status                    # working tree clean
git log -1 --oneline          # should match what is on GitHub

# Push the current source to Railway
railway up

# Watch the build + deploy
railway logs --tail 50
```

### Verify
- `railway status` transitions BUILDING → DEPLOYED with no error.
- `railway logs` shows the gateway booted: `Server listening on port <PORT>`.
- `/health` returns 200 and the version/commit field (if exposed) matches the local HEAD SHA.

### Fail-mode
- Deploy succeeds but signed routes still 503: env vars not set (Section 11).
- Deploy succeeds but routes return 404: source/snapshot mismatch — re-run `railway up` from a fresh `git pull`, do NOT use `railway redeploy`.
- Build fails on Railway: check `railway logs` for the failed step; common cause is a missing build dependency in `package.json` that worked locally because of a global install.

---

## 14. End-to-End Smoke Matrix

### What
Run a one-shot smoke test covering every gateway route + every auth boundary. This is the gate that flips Phase 7 from "deployed" to "live".

### How
Run this matrix after Section 13 completes:

```bash
echo "=== /health (must 200) ==="
curl -sS -o /dev/null -w "%{http_code}\n" "$VOICE_GATEWAY_URL/health"

echo "=== Signed routes — unsigned probes (must 401 sig verify failed) ==="
for route in /voice/call-status /voice/conversation-insights /webhook/telnyx/transcript; do
  printf "%-40s " "$route"
  curl -sS -o /dev/null -w "%{http_code}\n" -X POST "$VOICE_GATEWAY_URL$route" -d '{}'
done

echo "=== Bearer route — no token (must 401 unauthorized) ==="
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "$VOICE_GATEWAY_URL/voice/outbound" -d '{}'

echo "=== Shared-secret route — no secret (must 401 invalid X-PM-Webhook-Secret) ==="
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "$VOICE_GATEWAY_URL/webhook/pm" -d '{}'
```

Body-level proof (full response messages, not just status codes):
```bash
for route in /voice/call-status /voice/conversation-insights /webhook/telnyx/transcript; do
  echo "=== $route ==="
  curl -sS -X POST "$VOICE_GATEWAY_URL$route" -d '{}' | jq .
done
```

### Verify
Expected gate matrix:
| Route | Probe | Expected status | Expected body fragment |
|---|---|---|---|
| `/health` | GET | 200 | `{"ok":true}` |
| `/voice/call-status` | POST `{}` | 401 | `signature verification failed` |
| `/voice/conversation-insights` | POST `{}` | 401 | `signature verification failed` |
| `/webhook/telnyx/transcript` | POST `{}` | 401 | `signature verification failed` |
| `/voice/outbound` | POST `{}` | 401 | `unauthorized` |
| `/webhook/pm` | POST `{}` | 401 | `invalid X-PM-Webhook-Secret` |

All six green = deployment is live and fail-closed correctly.

### Fail-mode
- `503 TELNYX_PUBLIC_KEY not configured` on any signed route: redo Section 11 env var set.
- `404 Not Found` on any voice route: stale deploy — redo Section 13 with `railway up` from latest main, NOT `railway redeploy`.
- `200` returned on an unsigned probe: signature middleware not wired (see Section 12 Fail-mode).
- `500` on `/health`: gateway crash-looping; `railway logs` will show the cause.

---

## 15. Outbound Dispatch Agent Runtime

### What
Wire the cortextos agent runtime (Collie) so an operator can trigger an outbound call from Telegram with a per-call approval gate.

### How
The agent-side dispatch flow lives in `.claude/skills/voice-call-dispatch/` inside the operator's collie agent dir (`orgs/<org>/agents/collie/`). It is two cooperating parts:

**Part A — Telegram command parser:**
- Skill: `.claude/skills/voice-call-dispatch/SKILL.md`
- Trigger: operator sends a Telegram message matching `Alex call <phone> about <topic>` (or any of the documented variants in the skill).
- Action: parse phone + topic, create an approval entry, post the approval prompt back to the operator.

**Part B — Scheduled callback fire:**
- Trigger: a scheduled time arrives for a previously approved callback, OR the operator approves a pending request.
- Action: POST to `/voice/outbound` on the gateway with the bearer token and the dial payload.

Dial payload shape (POST `/voice/outbound`):
```bash
curl -sS -X POST "$VOICE_GATEWAY_URL/voice/outbound" \
  -H "Authorization: Bearer $VOICE_GATEWAY_INTERNAL_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "to": "+1XXXYYYZZZZ",
    "from": "'"$TELNYX_FROM_NUMBER"'",
    "assistant_id": "'"$TELNYX_ALEX_ASSISTANT_ID"'",
    "context": {
      "topic": "HVAC scheduling",
      "meld_id": "TXXXXXX",
      "operator_approval_id": "appr_..."
    }
  }'
```

**Per-call approval pattern (cortextos approvals subsystem):**
- Operator's collie agent calls `cortextos bus create-approval "Outbound call: Alex → +1XXX about <topic>" external-comms "<context>"` BEFORE firing the dial.
- Approval routes to operator's Telegram via the same fast-checker that routes inbound messages.
- On `approved` decision arriving in the agent inbox: agent fires the dial within 1-2 seconds.
- On `rejected`: agent logs `approval_rejected`, no dial fires.

The dispatch agent runtime must store `VOICE_GATEWAY_INTERNAL_TOKEN` in `orgs/<org>/secrets.env` so the Bash call can read it. **Never** put the token in `.claude/skills/voice-call-dispatch/SKILL.md` or any committed file.

### Verify
- Trigger Telegram message: `Alex call +1XXX about test`.
- Agent posts approval prompt on Telegram within a few seconds.
- Approve via Telegram callback button.
- Telnyx dashboard shows an outbound call attempt within 1-2 seconds of approval.
- A bus event `voice_outbound_dispatched` is logged with the dial payload.

### Fail-mode
- Telegram message arrives but agent does not post an approval: skill not loaded — check `cortextos bus list-skills | grep voice-call-dispatch`.
- Approval posts but dial never fires after approve: token missing or wrong — check `VOICE_GATEWAY_INTERNAL_TOKEN` in `orgs/<org>/secrets.env`.
- Dial returns 401 from gateway: token mismatch between agent runtime and Railway env var; re-sync.
- Dial returns 422 from Telnyx: bad `to` number format or assistant_id mismatch with the assistant created in Section 4.

---

## 16. End-to-End Live Smoke (First Call Test)

### What
Run the full operator-to-conversation-to-canonical-notes loop in one shot. This is the test you run last, after every earlier gate is green.

### How
**Setup (one-time):**
- Operator has a phone they control where they can answer + receive an outbound call from `$TELNYX_FROM_NUMBER`.
- A test work order ("meld") exists in PM that the agent can reference — e.g., create a dummy meld titled "Voice agent smoke test" and capture its meld ID.

**Run:**
1. Operator sends Telegram: `Alex call +1<my-phone> about test meld <meld_id>`
2. Operator sees approval prompt; taps **Approve**.
3. Phone rings within ~2 seconds. Operator answers.
4. Alex greets, references the meld topic, asks a clarifying question. Operator has a brief conversation, then hangs up.
5. Within 30-60s: operator's inbox (Blue, the triage agent) receives a bus message with the call transcript + extracted facts.
6. Within another minute: Blue writes to the PM meld's `maintenance_notes`, unit notes, or resident notes per the extracted facts.

### Verify
- Outbound call fires within ~2s of approval (Telnyx dashboard timeline).
- Call-status webhook fires on each transition (initiated → ringing → answered → hangup), all visible in `railway logs`.
- Conversation insights webhook fires post-call (one event with the transcript).
- Blue inbox shows the post-call message (`cortextos bus check-inbox` on Blue's agent).
- PM meld shows the new `maintenance_notes` entry within ~2 minutes of hangup.

### Fail-mode
- Call attempts but immediately drops: outbound caller-ID number not attached to the right voice profile (re-check Section 8) OR account concurrency cap reached (check Telnyx Mission Control billing → concurrency).
- Call connects but Alex says nothing: assistant TeXML binding broken (re-check Section 6).
- Hangup happens but no insights webhook: Section 7 insight-group webhook URL not set OR pointing at wrong URL.
- Insights arrive but Blue does not write to PM: triage agent's voice-call-triage skill not loaded, or PM CLI auth (cookie session) expired — `pm probe` from Blue's agent should return ok.

---

## 17. Environment Variables (Combined Reference)

The full operator env-var matrix, consolidated:

```bash
# === Telnyx-side (Sections 2, 3, 4, 6, 8) ===
TELNYX_API_KEY=KEY...
TELNYX_PUBLIC_KEY=<base64-44-char-ed25519-public-key>
TELNYX_ALEX_ASSISTANT_ID=assistant-...
TELNYX_TEXML_APP_ID=<numeric-id>
TELNYX_FROM_NUMBER=+1...

# === Gateway-internal secrets (Section 11, openssl-generated) ===
VOICE_GATEWAY_INTERNAL_TOKEN=<64-hex-chars>
PM_WEBHOOK_SECRET=<64-hex-chars>

# === URL plumbing (Section 11, derived from VOICE_GATEWAY_URL) ===
VOICE_STATUS_CALLBACK_URL=https://<gateway>/voice/call-status
INSIGHTS_WEBHOOK_URL=https://<gateway>/voice/conversation-insights
```

Store the plaintext in the operator's password manager. Never commit, never echo, never message in chat.

---

## 18. Common Failure Modes (Quick Triage)

### Telnyx-side

1. `401` from Telnyx API calls
   - Cause: wrong/revoked API key
   - Fix: regenerate key in Mission Control, re-set `TELNYX_API_KEY` in Railway

2. Signed webhook routes return `503 TELNYX_PUBLIC_KEY not configured`
   - Cause: env var missing from Railway runtime
   - Fix: copy public key from Mission Control portal (Section 3), `railway variables --set TELNYX_PUBLIC_KEY=...`

3. Signed routes return `401 signature verification failed` on unsigned curl probes
   - Cause: none (this is the expected fail-closed behavior)
   - Fix: use real Telnyx-signed traffic to exercise the pass path

4. Cannot proceed due to KYC verification prompt
   - Cause: account-level human verification required
   - Fix: create `[HUMAN]` task with exact docs requested

5. Conversation insights never arrive after live call
   - Cause: insight-group webhook URL missing or wrong
   - Fix: PUT webhook on correct insight group (Section 7) + GET-back verify

### Deployment-side

6. Voice routes return `404` after merging a PR to main
   - Cause: Railway redeployed from stored snapshot, not latest git HEAD
   - Fix: `git checkout main && git pull && railway up` (NOT `railway redeploy`)

7. Service crash-loops on boot after first env var set
   - Cause: a required env var is set but empty (e.g. paste error)
   - Fix: `railway logs --tail 100` shows the missing var name; re-set with the real value

8. `/voice/outbound` returns 401 from agent runtime
   - Cause: token mismatch between agent runtime and Railway env
   - Fix: re-sync `VOICE_GATEWAY_INTERNAL_TOKEN` in `orgs/<org>/secrets.env` to match `railway variables`

9. PM webhook posts arrive but return 401
   - Cause: `X-PM-Webhook-Secret` header value mismatch between PM-side config and `PM_WEBHOOK_SECRET` env
   - Fix: re-set both sides to the same value (regenerate with `openssl rand -hex 32` if rotating)

### Agent-runtime-side

10. Telegram message lands but no approval prompt posts
    - Cause: `voice-call-dispatch` skill not loaded
    - Fix: `cortextos bus list-skills | grep voice-call-dispatch`; if missing, the skill dir is missing from `.claude/skills/`

11. Approval approved but dial does not fire
    - Cause: `VOICE_GATEWAY_INTERNAL_TOKEN` missing in `orgs/<org>/secrets.env`
    - Fix: copy the token from Railway → operator's password manager → secrets.env

12. Dial fires but Telnyx returns 422
    - Cause: `to` number malformed (not E.164), OR `assistant_id` does not match the assistant created in Section 4
    - Fix: ensure phone numbers are `+1XXXYYYZZZZ` shape; cross-check assistant ID prefix

---

## 19. Operator Handoff Notes

- This document is the canonical end-to-end setup runbook (Telnyx-side: Sections 0-8; deployment + integration side: Sections 9-16).
- For customer-facing language, always use "Ascend Property Management" (not "AscendOps"). The `AscendOps` brand is internal-only (bus, logs, agent names).
- Maintained by: Codie (Telnyx) + Collie (deployment + integration).
- When a step changes, update this doc + bump the date in the header.

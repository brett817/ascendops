#!/usr/bin/env node
// LeadSimple REST API CLI (read-first). Wraps api.leadsimple.com/rest.
// Auth: LEADSIMPLE_API_KEY, loaded from env or orgs secrets.env fallback.
//
// Usage:
//   leadsimple <resource> <action> [args...] [--query key=value ...] [--json]
//
// See `leadsimple help` for the full command list.

const path = require('path');
const fs = require('fs');

const BASE_URL = 'https://api.leadsimple.com/rest';

function findSecretsPath() {
  const repoRoot = path.resolve(__dirname, '../..');
  const org = process.env.CTX_ORG || 'homelife-pm-bc';
  return path.join(repoRoot, 'orgs', org, 'secrets.env');
}

function loadApiKey() {
  if (process.env.LEADSIMPLE_API_KEY) return process.env.LEADSIMPLE_API_KEY;
  const secretsPath = findSecretsPath();
  if (fs.existsSync(secretsPath)) {
    const contents = fs.readFileSync(secretsPath, 'utf8');
    for (const line of contents.split('\n')) {
      const m = line.match(/^LEADSIMPLE_API_KEY=(.*)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

async function apiGet(pathSuffix, query) {
  const apiKey = loadApiKey();
  if (!apiKey) {
    console.error('LEADSIMPLE_API_KEY not found in env or secrets.env');
    process.exit(1);
  }
  const url = new URL(BASE_URL + pathSuffix);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
    process.exit(1);
  }
  return body;
}

// Auto-paginates a list endpoint (per_page=200/page) and concatenates every
// page's `data` array. LeadSimple's default page size is 25 - most real
// resources (custom_fields: 331, properties: 1314+) span many pages, and
// silently returning only page 1 makes an audit look complete when it isn't.
async function apiGetAll(pathSuffix, query) {
  const perPage = 200;
  let page = 1;
  let combined = [];
  let firstBody = null;
  for (;;) {
    const body = await apiGet(pathSuffix, { ...query, per_page: perPage, page });
    if (!firstBody) firstBody = body;
    const pageData = Array.isArray(body.data) ? body.data : [];
    combined = combined.concat(pageData);
    const totalPages = body.meta && body.meta.total_pages;
    if (!totalPages || page >= totalPages || pageData.length === 0) break;
    page += 1;
  }
  return { data: combined, meta: firstBody && firstBody.meta ? { ...firstBody.meta, page_number: 1, total_pages: 1, per_page: combined.length } : undefined };
}

async function apiPut(pathSuffix, formBody) {
  const apiKey = loadApiKey();
  if (!apiKey) {
    console.error('LEADSIMPLE_API_KEY not found in env or secrets.env');
    process.exit(1);
  }
  const url = new URL(BASE_URL + pathSuffix);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(formBody)) {
    if (Array.isArray(v)) v.forEach((item) => params.append(`${k}[]`, item));
    else params.set(k, v);
  }
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
    process.exit(1);
  }
  return body;
}

function parseArgs(argv) {
  const positional = [];
  const query = {};
  let asJson = false;
  let apply = false;
  let all = false;
  let add = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { asJson = true; continue; }
    if (a === '--apply') { apply = true; continue; }
    if (a === '--all') { all = true; continue; }
    if (a === '--add') {
      const v = argv[++i] || '';
      add = v.split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (a === '--query') {
      const kv = argv[++i] || '';
      const [k, v] = kv.split('=');
      if (k) query[k] = v ?? '';
      continue;
    }
    positional.push(a);
  }
  return { positional, query, asJson, apply, all, add };
}

function printResult(data, asJson) {
  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  // LeadSimple wraps list responses as { data: [...], meta: {...} }.
  const list = Array.isArray(data) ? data : Array.isArray(data && data.data) ? data.data : null;
  if (list) {
    const meta = data && data.meta;
    const header = meta
      ? `${list.length} of ${meta.total_count} (page ${meta.page_number}/${meta.total_pages})`
      : `${list.length} result(s)`;
    console.log(header);
    for (const item of list) {
      const id = item.id || item.uuid || item.label_id || '';
      const label = item.name || item.title || item.label || item.description || item.event_name
        || item.subject || item.full_address?.full_address || item.address || item.email || item.key
        || (item.direction && item.to ? `${item.direction} ${item.to}` : '')
        || (item.kind && item.inbox ? `${item.kind} · ${item.inbox}` : '')
        || '';
      console.log(`${id}\t${label}`);
    }
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

const HELP = `
leadsimple <resource> <action> [id] [--query key=value] [--json]

Resources (read-only, wraps api.leadsimple.com/rest):
  info account                       GET /info/account
  info user                          GET /info/user
  pipelines list                     GET /pipelines
  pipelines get <pipeline_id>        GET /pipelines/{id}
  pipelines stages <pipeline_id>     GET /pipelines/{id}/stages
  pipelines deals <pipeline_id>      GET /pipelines/{id}/deals
  deals list                         GET /deals
  deals get <deal_id>                GET /deals/{id}
  contacts list                      GET /contacts
  contacts get <contact_id>          GET /contacts/{id}
  properties list                    GET /properties
  properties get <property_id>       GET /properties/{id}
  properties units <property_id>     GET /properties/{id}/units
  properties tag <property_id> --add tag1,tag2 [--apply]
                                      Dry-run by default: fetches current tags,
                                      shows the exact PUT it would send with the
                                      merged (union) tag list. --apply sends it.
  tasks list                         GET /tasks
  custom-fields list                 GET /custom_fields
  process-types list                 GET /process_types
  processes list                     GET /processes
  conversations list                 GET /conversations
  calls list                         GET /calls
  text-messages list                 GET /text_messages
  webhooks list                      GET /webhook_subscriptions
  raw <path>                         GET /{path} passthrough for anything not wrapped above

Flags:
  --query key=value   pass a query param through (repeatable)
  --json              print full raw JSON instead of the compact summary
  --all               auto-paginate a list command and return every page
                       combined (most resources default to 25/page - custom-
                       fields alone spans 14 pages at the default size).
                       Not available on conversations/calls/text-messages
                       (see known API quirks below).

Notes:
  - Read-only. No create/update/delete commands yet - those are a separate,
    explicitly-gated phase (see build-your-own-cli skill: writes default to
    dry-run, --apply required, never guess a payload).
  - Auth comes from LEADSIMPLE_API_KEY (env var, or secrets.env in the org root).
`;

async function main() {
  const [resource, action, ...rest] = process.argv.slice(2);
  if (!resource || resource === 'help' || resource === '--help') {
    console.log(HELP);
    return;
  }
  const { positional, query, asJson, apply, all, add } = parseArgs(rest);
  const id = positional[0];
  // --all auto-paginates list commands (see apiGetAll). Single-record `get`
  // routes always use the plain apiGet since pagination doesn't apply to them.
  const list = all ? apiGetAll : apiGet;

  const routes = {
    'info:account': () => apiGet('/info/account', query),
    'info:user': () => apiGet('/info/user', query),
    'pipelines:list': () => list('/pipelines', query),
    'pipelines:get': () => apiGet(`/pipelines/${requireId(id)}`, query),
    'pipelines:stages': () => list(`/pipelines/${requireId(id)}/stages`, query),
    'pipelines:deals': () => list(`/pipelines/${requireId(id)}/deals`, query),
    'deals:list': () => list('/deals', query),
    'deals:get': () => apiGet(`/deals/${requireId(id)}`, query),
    'contacts:list': () => list('/contacts', query),
    'contacts:get': () => apiGet(`/contacts/${requireId(id)}`, query),
    'properties:list': () => list('/properties', query),
    'properties:get': () => apiGet(`/properties/${requireId(id)}`, query),
    'properties:units': () => list(`/properties/${requireId(id)}/units`, query),
    'tasks:list': () => list('/tasks', query),
    'custom-fields:list': () => list('/custom_fields', query),
    'process-types:list': () => list('/process_types', query),
    'processes:list': () => list('/processes', query),
    'conversations:list': () => apiGet('/conversations', query),
    'calls:list': () => apiGet('/calls', query),
    'text-messages:list': () => apiGet('/text_messages', query),
    'webhooks:list': () => apiGet('/webhook_subscriptions', query),
  };

  function requireId(v) {
    if (!v) {
      console.error(`Missing required id argument for ${resource} ${action}`);
      process.exit(1);
    }
    return v;
  }

  if (resource === 'raw') {
    const data = await apiGet(`/${action}`, query);
    printResult(data, asJson);
    return;
  }

  if (resource === 'properties' && action === 'tag') {
    const propertyId = requireId(id);
    if (!add.length) {
      console.error('Missing --add tag1,tag2 (nothing to tag)');
      process.exit(1);
    }
    const current = await apiGet(`/properties/${propertyId}`, {});
    const existingTags = (current.data && current.data.tags) || [];
    const mergedTags = Array.from(new Set([...existingTags, ...add]));
    const putUrl = `${BASE_URL}/properties/${propertyId}`;

    if (!apply) {
      console.log('DRY RUN - nothing sent. Re-run with --apply to execute.');
      console.log(`PUT ${putUrl}`);
      console.log(`Authorization: Bearer <redacted>`);
      console.log(`Content-Type: application/x-www-form-urlencoded`);
      console.log(`Body: tags[]=${mergedTags.join('&tags[]=')}`);
      console.log('');
      console.log(`Current tags: ${JSON.stringify(existingTags)}`);
      console.log(`Adding:       ${JSON.stringify(add)}`);
      console.log(`Result would be: ${JSON.stringify(mergedTags)}`);
      return;
    }

    const result = await apiPut(`/properties/${propertyId}`, { tags: mergedTags });
    console.log('Applied. New tags:', JSON.stringify((result.data && result.data.tags) || mergedTags));
    return;
  }

  const key = `${resource}:${action}`;
  const handler = routes[key];
  if (!handler) {
    console.error(`Unknown command: ${resource} ${action || ''}\n`);
    console.log(HELP);
    process.exit(1);
  }
  const data = await handler();
  printResult(data, asJson);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

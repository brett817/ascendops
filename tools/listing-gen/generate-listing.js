#!/usr/bin/env node
// Phase 1 Listing Content Generator (Prototype)
// Pulls property data from Jotform + LeadSimple, generates listing copy via Claude API.
//
// Usage:
//   node generate-listing.js --submission <jotform_id>  [--dry-run]
//   node generate-listing.js --input <file.json>        [--dry-run]
//
// Requires: ANTHROPIC_API_KEY in environment
//           JOTFORM_API_KEY + LEADSIMPLE_API_KEY (in env or secrets.env)

const path = require('path');
const fs = require('fs');

const SECRETS_PATH = path.resolve(__dirname, '../../orgs', process.env.CTX_ORG || 'homelife-pm-bc', 'secrets.env');
const JOTFORM_FORM_ID = '241266410519048';

function loadSecret(name) {
  if (process.env[name]) return process.env[name];
  if (fs.existsSync(SECRETS_PATH)) {
    const contents = fs.readFileSync(SECRETS_PATH, 'utf8');
    for (const line of contents.split('\n')) {
      const m = line.match(new RegExp(`^${name}=(.*)`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

// --- Jotform ---

async function fetchJotformSubmission(submissionId) {
  const apiKey = loadSecret('JOTFORM_API_KEY');
  if (!apiKey) throw new Error('JOTFORM_API_KEY not found');
  const url = `https://api.jotform.com/submission/${submissionId}?apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Jotform API error: ${res.status}`);
  const data = await res.json();
  return data.content?.answers || {};
}

function parseJotformData(answers) {
  const get = (qid) => {
    const ans = answers[qid];
    if (!ans) return null;
    return ans.answer || ans.prettyFormat || null;
  };
  const getDate = (qid) => {
    const ans = answers[qid]?.answer;
    if (!ans) return null;
    if (typeof ans === 'object' && ans.year) return `${ans.year}-${ans.month}-${ans.day}`;
    return ans;
  };

  const inclusions = get('67');
  const amenities = get('242');

  const bedrooms = get('121') || get('99');
  const bathrooms = get('122') || get('100');

  return {
    address: get('196'),
    property_type: get('45'),
    sqft: get('46') ? parseInt(get('46')) : null,
    year_built: get('164') ? parseInt(get('164')) : null,
    bedrooms: bedrooms ? parseInt(bedrooms) : null,
    bathrooms: bathrooms && !Array.isArray(answers['100']?.answer) ? parseInt(bathrooms) : null,
    den: get('124') ? parseInt(get('124')) : 0,
    available_date: getDate('43'),
    pet_policy: get('203') === 'Yes' ? 'Yes' : get('203') === 'No' ? 'No' : 'Negotiable',
    parking_spots: get('126') ? parseInt(get('126')) : 0,
    inclusions: Array.isArray(inclusions) ? inclusions : [],
    amenities: Array.isArray(amenities) ? amenities : [],
    strata: get('44') === 'Yes',
    strata_complex_name: get('131') || null,
    service_level: get('144') || 'Full Property Management',
    owner_email: get('141') || null,
  };
}

// --- LeadSimple ---

async function searchLeadSimpleProperty(address) {
  const apiKey = loadSecret('LEADSIMPLE_API_KEY');
  if (!apiKey) return null;
  const searchTerm = address.split(',')[0].trim();
  const url = new URL('https://api.leadsimple.com/rest/properties');
  url.searchParams.set('search', searchTerm);
  url.searchParams.set('per_page', '5');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.data?.length) return null;
  const match = data.data.find(p =>
    p.full_address?.full_address?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || data.data[0];
  return match;
}

function parseLeadSimpleData(property) {
  if (!property) return {};
  const cfs = {};
  if (property.custom_fields) {
    for (const cf of property.custom_fields) {
      const key = cf.key || cf.label?.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      if (cf.value) cfs[key] = cf.value;
    }
  }
  return {
    bedrooms: property.bedrooms || null,
    bathrooms: property.bathrooms || null,
    sqft: property.sqft || null,
    rent: cfs.new_tenancy_rent_rate ? parseInt(cfs.new_tenancy_rent_rate) : null,
    available_date: cfs.available_by_date || null,
    pet_policy: cfs.pets_allowed || null,
    year_built: cfs.year_built_custom ? parseInt(cfs.year_built_custom) : null,
    property_type: cfs.property_type_custom || null,
    drive_folder: cfs.google_drive_property_folder || null,
  };
}

// --- Merge ---

function mergePropertyData(jotform, leadsimple) {
  return {
    address: jotform.address || leadsimple.address || 'Unknown',
    property_type: jotform.property_type || leadsimple.property_type || 'Residential',
    sqft: jotform.sqft || leadsimple.sqft || null,
    year_built: jotform.year_built || leadsimple.year_built || null,
    bedrooms: jotform.bedrooms || leadsimple.bedrooms || 0,
    bathrooms: jotform.bathrooms || leadsimple.bathrooms || 0,
    den: jotform.den || 0,
    rent: leadsimple.rent || null,
    available_date: jotform.available_date || leadsimple.available_date || null,
    pet_policy: jotform.pet_policy || leadsimple.pet_policy || 'No',
    parking_spots: jotform.parking_spots || 0,
    laundry: jotform.inclusions?.some(i => /washer|laundry/i.test(i)) ? 'In-unit' : 'Shared',
    inclusions: jotform.inclusions || [],
    amenities: jotform.amenities || [],
    strata: jotform.strata || false,
    strata_complex_name: jotform.strata_complex_name || null,
    service_level: jotform.service_level || 'Full Property Management',
  };
}

// --- Claude API ---

const SYSTEM_PROMPT = `You are a professional rental listing copywriter for HomeLife Property Management BC. Your job is to write compelling, accurate, and legally compliant rental listing descriptions from property intake form data.

COMPLIANCE REQUIREMENT (BC Human Rights Code): Do not include any language that discriminates based on race, colour, ancestry, place of origin, religion, marital status, family status, physical or mental disability, sex, sexual orientation, gender identity or expression, or age. Do not include phrases like "suitable for professionals", "quiet building", "mature tenants preferred", "no children", or any language that could screen tenants based on a protected characteristic. HomeLife properties comply with BC Human Rights Code and the Residential Tenancy Act.

You will receive property data as JSON. Write the following sections:

---

SECTION 1 — HEADLINE (1 line, max 80 characters)
A punchy, benefit-first headline. Lead with the best feature (location, views, suite quality, price). No ALL CAPS. No exclamation marks.
Example: "Bright 2BR in Burnaby Heights — In-Suite Laundry, Steps to SkyTrain"

---

SECTION 2 — PROPERTY DESCRIPTION (2–3 sentences)
Describe the building and neighbourhood. Before writing this section, use the web_search tool to look up the property address and find real neighbourhood context (area/neighbourhood name, nearby transit, walkability, notable amenities). Use what you find to write specific, accurate details. If search returns nothing useful or the address is ambiguous, fall back to general language ("walking distance to shops and transit") rather than inventing specific businesses or transit stops.

---

SECTION 3 — UNIT DESCRIPTION (2–3 sentences + bullet list)
Describe the interior highlights first (layout, finishes, natural light, storage). Then a bullet list of unit features including bedrooms, bathrooms, and sqft from the input data.

Bullet list format:
• X bedrooms, Y bathrooms
• [sqft if provided]
• [laundry, parking, other features]

---

SECTION 4 — SPECIAL NOTES (1–3 sentences)
Include: availability date, pet policy, parking, and any notable lease terms. Keep factual and neutral. Do not repeat information already in the unit description.

---

MLS VERSION (label clearly as "MLS VERSION:"):
Write a condensed version of sections 1–4 for MLS/Realtor.ca/Paragon. Hard limit: 800 characters including spaces and punctuation. Prioritize: bedroom count, key features, location, availability. Cut adjectives before cutting facts.

---

FACEBOOK MARKETPLACE VERSION (label clearly as "FACEBOOK MARKETPLACE VERSION:"):
Write a plain-text version for Facebook Marketplace. Facebook Marketplace does not render markdown — no bullet symbols, no bold, no headers. Use plain paragraphs separated by line breaks only.

Structure (use this order, each group separated by a blank line):

Line 1: $[rent]/month — [X] bed / [Y] bath in [Neighbourhood/Area]

Lines 3–5: 2–3 sentence description combining property and unit highlights. Mention key features (laundry, parking, pets if allowed). Plain sentences only.

Line 7: Available [date]. [Lease term.] [Pet policy if applicable.]

Line 9: Professionally managed by [PM NAME] and HomeLife Property Management BC. We work on behalf of the property owner.
Line 10: [WEBSITE URL]

Hard limit: 1,500 characters total. No emojis. No exclamation marks. [PM NAME] and [WEBSITE URL] are literal placeholders — the PM fills these in during review.

---

OUTPUT FORMAT:
Return all sections with these exact labels:
HEADLINE:
PROPERTY DESCRIPTION:
UNIT DESCRIPTION:
SPECIAL NOTES:
MLS VERSION:
FACEBOOK MARKETPLACE VERSION:

Do not add commentary, greetings, or meta-text. The PM will paste this directly into the review document.`;

async function callClaude(propertyJson) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in environment');

  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3,
      }
    ],
    messages: [
      { role: 'user', content: JSON.stringify(propertyJson, null, 2) }
    ],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const result = await res.json();
  const textBlocks = result.content?.filter(b => b.type === 'text') || [];
  return textBlocks.map(b => b.text).join('\n');
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2);
  let submissionId = null;
  let inputFile = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--submission') submissionId = args[++i];
    else if (args[i] === '--input') inputFile = args[++i];
    else if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Usage:
  node generate-listing.js --submission <jotform_id> [--dry-run]
  node generate-listing.js --input <file.json> [--dry-run]

Options:
  --submission <id>   Jotform submission ID to pull data from
  --input <file>      JSON file with property data (unified schema)
  --dry-run           Show merged data + prompt without calling Claude API

Requires: ANTHROPIC_API_KEY in environment
          JOTFORM_API_KEY + LEADSIMPLE_API_KEY (in env or secrets.env)`);
      return;
    }
  }

  if (!submissionId && !inputFile) {
    console.error('Error: provide --submission <id> or --input <file.json>');
    process.exit(1);
  }

  let propertyData;

  if (inputFile) {
    propertyData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    console.log(`Loaded property data from ${inputFile}`);
  } else {
    console.log(`Fetching Jotform submission ${submissionId}...`);
    const answers = await fetchJotformSubmission(submissionId);
    const jotform = parseJotformData(answers);
    console.log(`  Address: ${jotform.address}`);
    console.log(`  Type: ${jotform.property_type}, ${jotform.bedrooms}BR/${jotform.bathrooms}BA, ${jotform.sqft}sqft`);

    console.log(`Searching LeadSimple for property...`);
    const lsProp = await searchLeadSimpleProperty(jotform.address);
    const leadsimple = parseLeadSimpleData(lsProp);
    if (lsProp) console.log(`  Found: ${lsProp.full_address?.full_address}`);
    else console.log(`  Not found in LeadSimple`);

    propertyData = mergePropertyData(jotform, leadsimple);
  }

  console.log(`\n--- Merged Property Data ---`);
  console.log(JSON.stringify(propertyData, null, 2));

  if (dryRun) {
    console.log(`\n--- DRY RUN: would send to Claude API ---`);
    console.log(`Model: claude-haiku-4-5-20251001`);
    console.log(`Max tokens: 1200`);
    console.log(`Web search: enabled (max 3 uses)`);
    console.log(`System prompt: ${SYSTEM_PROMPT.length} chars`);
    console.log(`User message: property JSON above`);
    return;
  }

  console.log(`\nCalling Claude API...`);
  const output = await callClaude(propertyData);
  console.log(`\n--- Generated Listing Copy ---\n`);
  console.log(output);
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

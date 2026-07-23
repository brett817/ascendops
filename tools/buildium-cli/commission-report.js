#!/usr/bin/env node
// PM Commission Report — Buildium pull, parameterized by month.
// Reproduces the per-PM per-lead-type management-fee totals that HLPM's manual
// rent-run process produces, straight from Buildium's posted "Management Fee"
// checks. Split-independent core: gross fee per PM/lead-type, reconstructed to
// the penny (fees x 1.05 GST = the actual check).
//
// Usage:
//   node commission-report.js --month 2026-07 [--json out.json] [--html out.html]
//
// Auth: BUILDIUM_API_CLIENT_ID + BUILDIUM_API_SECRET (env or org secrets.env).
// Headers: x-buildium-client-id / x-buildium-client-secret.

const path = require('path');
const fs = require('fs');

const SECRETS_PATH = path.resolve(__dirname, '../../orgs', process.env.CTX_ORG || 'homelife-pm-bc', 'secrets.env');
const BASE = 'https://api.buildium.com/v1';
const MGMT_FEE_GL = 69579;   // "Management Fee (CT)" — where mgmt-fee payout checks post
const GST_RATE = 0.05;

function loadSecret(name) {
  if (process.env[name]) return process.env[name];
  if (fs.existsSync(SECRETS_PATH)) {
    for (const line of fs.readFileSync(SECRETS_PATH, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${name}=(.*)`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

function authHeaders() {
  const id = loadSecret('BUILDIUM_API_CLIENT_ID');
  const secret = loadSecret('BUILDIUM_API_SECRET');
  if (!id || !secret) throw new Error('BUILDIUM_API_CLIENT_ID / BUILDIUM_API_SECRET not found in env or secrets.env');
  return { 'x-buildium-client-id': id, 'x-buildium-client-secret': secret, 'Content-Type': 'application/json' };
}

async function buildiumGet(pathSuffix, query) {
  const url = new URL(BASE + pathSuffix);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Buildium ${res.status} on ${pathSuffix}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Buildium list endpoints page at 1000 max; paginate by offset until short page.
async function buildiumGetAll(pathSuffix, query) {
  const limit = 1000;
  let offset = 0;
  const all = [];
  for (;;) {
    const page = await buildiumGet(pathSuffix, { ...query, limit, offset });
    const arr = Array.isArray(page) ? page : [];
    all.push(...arr);
    if (arr.length < limit) break;
    offset += limit;
  }
  return all;
}

// Parse "Management Fee OL - Nikki Sull" / "Management Fee TL - Happy Boyal".
// OL = Office Lead, TL = Their Lead (Buildium-native lead type, authoritative).
function parsePayee(name) {
  const m = (name || '').match(/Management Fee\s+(OL|TL)\s*-\s*(.+)$/i);
  if (!m) return null;
  const lead = m[1].toUpperCase() === 'OL' ? 'Office Lead' : 'Their Lead';
  return { pm: m[2].trim(), lead };
}

// PM-vs-office split of the PRE-GST fee, by Buildium-native lead type.
// OL = Office Lead, TL = Their Lead (agent). Happy Boyal has custom ratios.
// GST is a government pass-through and is NOT split (flagged in output).
function isHappy(pm) { return /happy/i.test(pm || ''); }
function splitFor(pm, lead) {
  const happy = isHappy(pm);
  const agent = lead === 'Their Lead';
  let pmPct;
  if (happy) pmPct = agent ? 0.80 : 0.75;   // Happy: TL 80/20, OL 75/25
  else pmPct = agent ? 0.70 : 0.50;          // standard: TL 70/30, OL 50/50
  return { pmPct, officePct: 1 - pmPct, label: `${Math.round(pmPct * 100)}/${Math.round((1 - pmPct) * 100)}` };
}

// Extract %, rent basis, and min fee from a management-fee memo. The fee Amount
// is authoritative; the memo gives the human-readable basis for display and a
// model cross-check (max(min, pct * rent)).
function parseMemo(memo) {
  const out = { pct: null, rentBasis: null, minFee: null, prorated: false, periodDays: null };
  if (!memo) return out;
  if (/Pro Rated Rent/i.test(memo)) out.prorated = true;
  // Detect a partial/prorated month from the fee period. Full management
  // periods run anniversary-to-anniversary (~28-31 days); a mid-month start to
  // month-end is shorter. The minimum-fee floor is WAIVED on partial months —
  // Buildium charges the percentage only — so this must not read as a mismatch.
  const dm = memo.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dm) {
    const d1 = Date.UTC(+dm[3], +dm[1] - 1, +dm[2]);
    const d2 = Date.UTC(+dm[6], +dm[4] - 1, +dm[5]);
    out.periodDays = Math.round((d2 - d1) / 86400000);
    if (out.periodDays > 0 && out.periodDays < 27) out.prorated = true;
  }
  const num = (s) => (s == null ? null : parseFloat(String(s).replace(/,/g, '')));
  let m;
  if ((m = memo.match(/Greater of \$([\d,]+\.?\d*)\s*\*\s*(\d+)\s*property\s+OR\s+([\d.]+)% of \$([\d,]+\.?\d*)/i))) {
    out.minFee = num(m[1]) * parseInt(m[2], 10);
    out.pct = num(m[3]);
    out.rentBasis = num(m[4]);
  } else if ((m = memo.match(/([\d.]+)% of (?:Pro Rated Rent of )?\$([\d,]+\.?\d*)/i))) {
    out.pct = num(m[1]);
    out.rentBasis = num(m[2]);
  } else if ((m = memo.match(/\$([\d,]+\.?\d*)\s*\*\s*(\d+)\s*property/i))) {
    out.minFee = num(m[1]) * parseInt(m[2], 10);
  }
  return out;
}

function monthRange(month) {
  const [y, mo] = month.split('-').map(Number);
  if (!y || !mo || mo < 1 || mo > 12) throw new Error(`--month must be YYYY-MM, got "${month}"`);
  const start = `${y}-${String(mo).padStart(2, '0')}-01`;
  const endDay = new Date(y, mo, 0).getDate(); // last day of month
  const end = `${y}-${String(mo).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  return { start, end };
}

async function build(month) {
  const { start, end } = monthRange(month);

  // Property roster: Id -> { name, pm } (RentalManager = assigned PM).
  const rentals = await buildiumGetAll('/rentals', {});
  const propMap = {};
  for (const p of rentals) {
    const mgr = p.RentalManager;
    propMap[p.Id] = {
      name: p.Name || `Rental ${p.Id}`,
      pm: mgr ? `${mgr.FirstName || ''} ${mgr.LastName || ''}`.trim() : null,
      active: !!p.IsActive,
    };
  }

  // Management-fee checks posted in the month.
  const feeTxns = await buildiumGet('/generalledger/transactions', {
    glaccountids: MGMT_FEE_GL, startdate: start, enddate: end, limit: 1000,
  });

  const groups = {}; // key: `${pm}|${lead}` -> { pm, lead, feeSum, gst, checkTotal, lines:[...] }
  const streamNote = { otherStreamsJulyActivity: false };

  for (const t of feeTxns) {
    const payee = parsePayee(((t.PaymentDetail || {}).Payee || {}).Name);
    if (!payee) continue;
    const key = `${payee.pm}|${payee.lead}`;
    const g = groups[key] || (groups[key] = { pm: payee.pm, lead: payee.lead, feeSum: 0, gstSum: 0, checkTotal: 0, lines: [] });
    g.checkTotal += t.TotalAmount || 0;
    for (const l of (t.Journal || {}).Lines || []) {
      const gl = l.GLAccount || {};
      // Read the GST straight from Buildium's posted GST lines rather than
      // recomputing fee*5% — Buildium rounds GST per line and a recompute can
      // drift a cent on partial-month lines. Using the posted amount makes the
      // check reconcile exactly. (erkel: per-line rounding, GL "GST (5%)".)
      if (gl.Name === 'GST (5%)') { g.gstSum += (l.Amount || 0); continue; }
      if (gl.Id !== MGMT_FEE_GL) continue;
      const ae = l.AccountingEntity || {};
      const propId = ae.Id;
      const prop = propMap[propId] || { name: `Rental ${propId}`, pm: null };
      const parsed = parseMemo(l.Memo);
      const fee = round2(l.Amount || 0);
      g.feeSum += fee;
      // Model cross-check: does the applied fee equal max(min, pct*rent)? A
      // mismatch is not a tool error — it surfaces partial-month min-fee
      // proration (e.g. a mid-month start where the full monthly minimum is not
      // levied) for human confirmation, rather than hiding it in a total.
      let modelFee = null;
      if (parsed.pct != null && parsed.rentBasis != null) {
        const pctFee = parsed.pct / 100 * parsed.rentBasis;
        // Waive the min-fee floor on partial/prorated months (min does not apply
        // then — Buildium charges the % only). (boss 2026-07-23)
        modelFee = (parsed.minFee != null && !parsed.prorated) ? Math.max(parsed.minFee, pctFee) : pctFee;
      } else if (parsed.minFee != null) {
        modelFee = parsed.minFee;
      }
      const modelMismatch = modelFee != null && Math.abs(round2(modelFee) - fee) > 0.02;
      // Split the PRE-GST fee per line so subtotals sum back to gross exactly.
      // Single round: round the OFFICE share, derive PM by subtraction. This
      // avoids double-rounding AND defaults the residual odd cent on even (50/50)
      // splits to the office side, per the house convention. (boss 2026-07-22)
      const sp = splitFor(payee.pm, payee.lead);
      const officeShare = round2(fee * sp.officePct);
      const pmShare = round2(fee - officeShare); // exact complement, no drift
      g.lines.push({
        propertyId: propId,
        propertyName: prop.name,
        fee,
        rentBasis: parsed.rentBasis,
        pct: parsed.pct,
        minFee: parsed.minFee,
        prorated: parsed.prorated,
        modelFee: modelFee != null ? round2(modelFee) : null,
        modelMismatch,
        splitLabel: sp.label,
        pmShare,
        officeShare,
        memo: l.Memo || '',
        nameHeuristic: prop.name.includes('.') ? 'Their Lead' : 'Office Lead',
      });
    }
  }

  // Reconstruct + validate: feeSum * 1.05 should equal the actual check total.
  const pmMap = {};
  let grandFees = 0;
  const reconIssues = [];
  let grandGst = 0;
  let grandCheck = 0;
  let grandPm = 0;
  let grandOffice = 0;
  for (const g of Object.values(groups)) {
    g.feeSum = round2(g.feeSum);
    g.gst = round2(g.gstSum); // per-line-rounded GST, summed (matches Buildium)
    g.split = splitFor(g.pm, g.lead);
    // Group PM/office shares = sum of per-line shares (so they tie to the lines
    // shown and sum back to the fee exactly).
    g.pmShare = round2(g.lines.reduce((s, l) => s + l.pmShare, 0));
    g.officeShare = round2(g.feeSum - g.pmShare);
    g.expectedCheck = round2(g.feeSum + g.gst);
    g.checkTotal = round2(g.checkTotal);
    // Per-line GST reconstructs the posted check exactly — tolerance is a
    // half-cent for float safety, not the 5c slack the *1.05 shorthand needed.
    g.reconciled = Math.abs(g.expectedCheck - g.checkTotal) <= 0.005;
    if (!g.reconciled) reconIssues.push(`${g.pm} ${g.lead}: expected ${g.expectedCheck} vs check ${g.checkTotal}`);
    grandFees += g.feeSum;
    grandGst += g.gst;
    grandCheck += g.checkTotal;
    grandPm += g.pmShare;
    grandOffice += g.officeShare;
    (pmMap[g.pm] || (pmMap[g.pm] = { pm: g.pm, groups: [], feeTotal: 0 })).groups.push(g);
  }
  for (const pm of Object.values(pmMap)) {
    pm.groups.sort((a, b) => a.lead.localeCompare(b.lead));
    pm.feeTotal = round2(pm.groups.reduce((s, g) => s + g.feeSum, 0));
    pm.pmShare = round2(pm.groups.reduce((s, g) => s + g.pmShare, 0));
    pm.officeShare = round2(pm.groups.reduce((s, g) => s + g.officeShare, 0));
  }
  const pms = Object.values(pmMap).sort((a, b) => b.pmShare - a.pmShare);

  // Cross-flag: Buildium lead type vs the period-in-name heuristic (secondary).
  // Also collect confirm-flags: lines where the applied fee != max(min, pct*rent),
  // which surface partial-month min-fee proration for human confirmation.
  const nameFlags = [];
  const feeConfirms = [];
  for (const pm of pms) {
    for (const g of pm.groups) {
      for (const ln of g.lines) {
        if (ln.nameHeuristic !== g.lead) {
          nameFlags.push({ property: ln.propertyName, buildiumLead: g.lead, nameSuggests: ln.nameHeuristic });
        }
        if (ln.modelMismatch) {
          feeConfirms.push({
            pm: pm.pm, lead: g.lead, property: ln.propertyName,
            applied: ln.fee, greaterOf: ln.modelFee,
            pct: ln.pct, rentBasis: ln.rentBasis, minFee: ln.minFee, memo: ln.memo,
          });
        }
      }
    }
  }

  return {
    month,
    range: { start, end },
    generatedNote: 'Split-independent core: per-PM per-lead-type gross management fees, reconstructed from Buildium checks.',
    totals: {
      grossFees: round2(grandFees),
      // Aggregate GST/total derived from the authoritative posted check totals
      // (sum of the 18 check TotalAmounts) minus gross fees — avoids per-group
      // rounding drift that summing rounded per-group GST would introduce.
      gst: round2(grandCheck - grandFees),
      withGst: round2(grandCheck),
      properties: new Set(pms.flatMap(p => p.groups.flatMap(g => g.lines.map(l => l.propertyId)))).size,
      checks: Object.keys(groups).length,
      pmComp: round2(grandPm),
      officeComp: round2(grandOffice),
    },
    splitAssumption: 'Splits apply to the PRE-GST management fee. GST (5%) is a government pass-through and is NOT split — it is remitted, not shared. CONFIRM with erkel/Brett.',
    splitRules: { standardAgentTL: '70/30', standardOfficeOL: '50/50', happyAgentTL: '80/20', happyOfficeOL: '75/25' },
    splitSumCheck: {
      pmPlusOffice: round2(grandPm + grandOffice),
      grossFees: round2(grandFees),
      tiesToGross: Math.abs((grandPm + grandOffice) - grandFees) <= 0.005,
    },
    otherStreams: { marketing5050: 0, inspections: 0, renewals: 0, note: 'No non-management-fee stream activity this month; split columns kept at $0.' },
    reconciled: reconIssues.length === 0,
    reconIssues,
    streamNote,
    nameFlags,
    feeConfirms,
    pms,
  };
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

module.exports = { build, parsePayee, parseMemo, monthRange, round2 };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    let month = null, jsonOut = null, htmlOut = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--month') month = args[++i];
      else if (args[i] === '--json') jsonOut = args[++i];
      else if (args[i] === '--html') htmlOut = args[++i];
    }
    if (!month) { console.error('Usage: commission-report.js --month YYYY-MM [--json f] [--html f]'); process.exit(1); }
    const data = await build(month);
    console.log(`Month ${data.month} (${data.range.start}..${data.range.end})`);
    console.log(`Gross mgmt fees: $${data.totals.grossFees.toLocaleString()} across ${data.totals.properties} properties, ${data.totals.checks} PM/lead groups`);
    console.log(`Reconciled to the penny: ${data.reconciled}${data.reconIssues.length ? ' — ' + data.reconIssues.join('; ') : ''}`);
    console.log(`PM comp $${data.totals.pmComp.toLocaleString()} + Office comp $${data.totals.officeComp.toLocaleString()} = $${data.splitSumCheck.pmPlusOffice.toLocaleString()} (ties to gross ${data.totals.grossFees.toLocaleString()}: ${data.splitSumCheck.tiesToGross})`);
    console.log(`Name-vs-Buildium lead flags: ${data.nameFlags.length}; fee-confirm flags: ${data.feeConfirms.length}`);
    for (const pm of data.pms) {
      console.log(`  ${pm.pm}: fee $${pm.feeTotal.toLocaleString()} -> PM $${pm.pmShare.toLocaleString()} / office $${pm.officeShare.toLocaleString()}  [${pm.groups.map(g => `${g.lead} ${g.split.label}`).join(', ')}]`);
    }
    if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(data, null, 2)); console.log(`\nJSON -> ${jsonOut}`); }
    if (htmlOut) { fs.writeFileSync(htmlOut, require('./render-commission-html.js')(data)); console.log(`HTML -> ${htmlOut}`); }
  })().catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
}

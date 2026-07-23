// Render the commission report data to a self-contained, private HTML file.
// Matches boss's mockup layout (scratchpad/pm-commission-dashboard.html): summary
// tiles, per-PM cards with per-property rows, per-PM subtotals. Split-independent:
// PM-vs-office split columns are intentionally NOT shown yet (pending Brett's
// answer on whether the check is the payout or the gross pool to split).

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function money(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function initials(name) {
  return (name || '?').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

module.exports = function render(data) {
  const [y, mo] = data.month.split('-').map(Number);
  const monthLabel = `${MONTHS[mo - 1]} ${y}`;

  const tiles = `
  <section class="tiles" aria-label="Summary">
    <div class="tile"><p class="k">Gross Management Fees</p><p class="v num">${money(data.totals.grossFees)}</p><p class="cap">before GST, charged to owners</p></div>
    <div class="tile money"><p class="k">PM Commission</p><p class="v num">${money(data.totals.pmComp)}</p><p class="cap">total to managers</p></div>
    <div class="tile office"><p class="k">Office Share</p><p class="v num">${money(data.totals.officeComp)}</p><p class="cap">retained by office</p></div>
    <div class="tile"><p class="k">GST (5%)</p><p class="v num">${money(data.totals.gst)}</p><p class="cap">pass-through, not split</p></div>
  </section>`;

  const recon = data.reconciled
    ? `<span class="ok">Reconciled to the penny against Buildium's posted checks.</span>`
    : `<span class="bad">Reconciliation gaps: ${esc(data.reconIssues.join('; '))}</span>`;

  const flags = data.nameFlags.length
    ? `<section class="attention"><div class="ah"><h2>Lead type: name-vs-Buildium cross-check</h2><span class="cnt num">${data.nameFlags.length}</span></div>` +
      data.nameFlags.map(f => `<div class="arow"><span class="badge miss">Cross-flag</span><div class="txt"><div class="p">${esc(f.property)}</div><div class="d">Buildium says <b>${esc(f.buildiumLead)}</b>; the period-in-name rule would suggest <b>${esc(f.nameSuggests)}</b>. Buildium is authoritative; listed for spot-check only.</div></div></div>`).join('') +
      `</section>`
    : '';

  const confirms = (data.feeConfirms && data.feeConfirms.length)
    ? `<section class="attention"><div class="ah"><h2>Confirm: partial-month min fee</h2><span class="cnt num">${data.feeConfirms.length}</span></div>` +
      data.feeConfirms.map(c => `<div class="arow"><span class="badge miss">Confirm</span><div class="txt"><div class="p">${esc(c.property)} · ${esc(c.pm)} (${esc(c.lead)})</div><div class="d">Memo greater-of ${money(c.greaterOf)} (min ${money(c.minFee)} vs ${c.pct != null ? c.pct.toFixed(2) + '%' : '—'} of ${money(c.rentBasis)}), but Buildium applied <b>${money(c.applied)}</b> — reads as partial-month proration of the minimum. Please confirm this is intended.</div></div></div>`).join('') +
      `</section>`
    : '';

  const splitCheck = (data.splitSumCheck && data.splitSumCheck.tiesToGross)
    ? `<div class="banner"><span class="dot"></span><div>PM commission ${money(data.totals.pmComp)} + office share ${money(data.totals.officeComp)} = ${money(data.splitSumCheck.pmPlusOffice)}, tying exactly to gross management fees ${money(data.totals.grossFees)}.</div></div>`
    : `<div class="banner"><span class="dot"></span><div class="bad">Split columns do not tie to gross — investigate before use.</div></div>`;

  const cards = data.pms.map(pm => {
    const happy = /happy/i.test(pm.pm);
    const bodyAndFeet = pm.groups.map(g => {
      const rows = g.lines.sort((a, b) => b.fee - a.fee).map(ln => `
        <tr>
          <td class="l prop">${esc(ln.propertyName)}</td>
          <td class="l"><span class="chip ${g.lead === 'Their Lead' ? 'agent' : 'office'}">${esc(g.lead)}</span></td>
          <td class="num">${money(ln.rentBasis)}</td>
          <td class="num">${ln.pct != null ? ln.pct.toFixed(2) + '%' : '—'}</td>
          <td class="num">${money(ln.fee)}${ln.prorated ? '<span class="flag">pro-rated</span>' : ''}${ln.modelMismatch ? '<span class="flag">confirm</span>' : ''}</td>
          <td class="num money">${money(ln.pmShare)}</td>
          <td class="num">${money(ln.officeShare)}</td>
        </tr>`).join('');
      const sub = `<tr class="sub"><td class="l" colspan="4">${esc(g.lead)} — subtotal · ${g.split.label} split · ${g.lines.length} ${g.lines.length === 1 ? 'door' : 'doors'}</td><td class="num">${money(g.feeSum)}</td><td class="num money">${money(g.pmShare)}</td><td class="num">${money(g.officeShare)}</td></tr>`;
      return { rows, sub };
    });
    const rows = bodyAndFeet.map(x => x.rows).join('');
    const subs = bodyAndFeet.map(x => x.sub).join('');
    const doorCount = pm.groups.reduce((s, g) => s + g.lines.length, 0);
    return `
    <article class="pmcard">
      <div class="pmhead">
        <div class="who"><div class="avatar">${esc(initials(pm.pm))}</div>
          <div><p class="nm">${esc(pm.pm)}${happy ? ' <span class="tag">custom split</span>' : ''}</p><p class="doors">${doorCount} ${doorCount === 1 ? 'door' : 'doors'} · ${pm.groups.map(g => esc(g.lead) + ' ' + g.split.label).join(' · ')}</p></div></div>
        <div class="pay"><p class="lbl">PM Commission</p><p class="amt num">${money(pm.pmShare)}</p></div>
      </div>
      <div class="scroll"><table>
        <thead><tr><th class="l">Property</th><th class="l">Lead type</th><th>Rent (basis)</th><th>Rate</th><th>Mgmt fee</th><th>PM share</th><th>Office share</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>${subs}<tr><td class="l" colspan="4">${esc(pm.pm)} — total</td><td class="num">${money(pm.feeTotal)}</td><td class="num money">${money(pm.pmShare)}</td><td class="num">${money(pm.officeShare)}</td></tr></tfoot>
      </table></div>
    </article>`;
  }).join('');

  return `<title>PM Commission Report — ${esc(monthLabel)}</title>
<style>
  :root{--paper:#f5f7f9;--surface:#fff;--surface-2:#fafbfc;--ink:#1a2230;--muted:#5b6573;--faint:#8a93a1;--hairline:#e4e8ed;--hairline-2:#eef1f4;--accent:#0f766e;--accent-weak:#d9ece9;--accent-ink:#0b5850;--money:#15803d;--office:#475569;--warn-bg:#fdf4e3;--warn-ink:#8a5a12;--warn-line:#efd9ad;--ok-bg:#e7f5ec;--ok-ink:#15803d;--alert-bg:#fbeceb;--alert-ink:#a32a20;--alert-line:#f2c9c4;--shadow:0 1px 2px rgba(16,24,40,.04),0 4px 16px rgba(16,24,40,.05);}
  @media (prefers-color-scheme:dark){:root{--paper:#0e1116;--surface:#161b22;--surface-2:#1a212a;--ink:#e7ebf1;--muted:#9aa4b2;--faint:#6b7482;--hairline:#262c36;--hairline-2:#20262f;--accent:#2dd4bf;--accent-weak:#123833;--accent-ink:#7fe9db;--money:#4ade80;--office:#94a3b8;--warn-bg:#2a2113;--warn-ink:#f2c46a;--warn-line:#4a3a1a;--ok-bg:#13291b;--ok-ink:#4ade80;--alert-bg:#2a1512;--alert-ink:#f2a79d;--alert-line:#4d211b;--shadow:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.35);}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1080px;margin:0 auto;padding:32px 20px 64px}
  .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
  header.top{margin-bottom:18px}
  .eyebrow{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--accent);font-weight:600;margin:0 0 6px}
  h1{font-size:26px;line-height:1.2;margin:0 0 4px;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:14.5px;margin:0}
  .banner{display:flex;gap:12px;align-items:flex-start;background:var(--ok-bg);color:var(--ok-ink);border:1px solid color-mix(in srgb,var(--ok-ink) 25%,transparent);border-radius:10px;padding:12px 14px;margin:18px 0 22px;font-size:13.5px}
  .banner .dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:currentColor;margin-top:6px;opacity:.8}
  .ok{font-weight:600}.bad{color:var(--alert-ink);font-weight:600}
  .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}
  .tile{background:var(--surface);border:1px solid var(--hairline);border-radius:12px;padding:15px 16px;box-shadow:var(--shadow)}
  .tile .k{font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
  .tile .v{font-size:24px;font-weight:650;letter-spacing:-.02em;margin:0}
  .tile.money .v{color:var(--money)}
  .tile .cap{font-size:12px;color:var(--faint);margin:5px 0 0}
  .assume{background:var(--accent-weak);border-radius:10px;padding:14px 16px;margin-bottom:22px;font-size:13px;color:var(--accent-ink)}
  .assume h3{margin:0 0 8px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
  .assume p{margin:0 0 6px}
  .rules{display:grid;grid-template-columns:1fr 1fr;gap:4px 22px;margin:8px 0 10px}
  .rules .r{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dotted color-mix(in srgb,var(--accent) 30%,transparent)}
  .rules .r span:first-child{opacity:.85}.rules .r b{white-space:nowrap}
  .tag{font-size:10.5px;font-weight:650;text-transform:uppercase;letter-spacing:.04em;color:var(--accent);background:var(--accent-weak);padding:2px 7px;border-radius:5px;vertical-align:middle}
  tr.sub td{background:var(--surface-2);font-weight:600;border-top:1px solid var(--hairline-2);text-transform:none;font-size:12.5px;letter-spacing:0}
  tr.sub td.l{color:var(--muted)}
  @media(max-width:720px){.rules{grid-template-columns:1fr}}
  .attention{background:var(--surface);border:1px solid var(--warn-line);border-radius:14px;box-shadow:var(--shadow);margin-bottom:24px;overflow:hidden}
  .attention .ah{display:flex;align-items:center;gap:9px;padding:12px 18px;background:var(--warn-bg);border-bottom:1px solid var(--warn-line)}
  .attention .ah h2{margin:0;font-size:14px;color:var(--warn-ink);font-weight:640}
  .attention .ah .cnt{margin-left:auto;font-size:12px;color:var(--warn-ink);background:color-mix(in srgb,var(--warn-ink) 12%,transparent);padding:2px 9px;border-radius:999px;font-weight:600}
  .arow{display:flex;align-items:flex-start;gap:12px;padding:12px 18px;border-bottom:1px solid var(--hairline-2)}
  .arow:last-child{border-bottom:none}
  .arow .badge{flex:0 0 auto;font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.03em;padding:3px 9px;border-radius:6px;margin-top:1px;background:var(--warn-bg);color:var(--warn-ink);border:1px solid var(--warn-line)}
  .arow .txt{font-size:13.5px}.arow .txt .p{font-weight:600}.arow .txt .d{color:var(--muted);font-size:13px}
  .pmcard{background:var(--surface);border:1px solid var(--hairline);border-radius:14px;box-shadow:var(--shadow);margin-bottom:18px;overflow:hidden}
  .pmhead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--hairline-2)}
  .pmhead .who{display:flex;align-items:center;gap:11px}
  .avatar{width:32px;height:32px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-size:13px;font-weight:650;flex:0 0 auto}
  .pmhead .nm{font-weight:640;font-size:15.5px;margin:0}
  .pmhead .doors{font-size:12.5px;color:var(--muted);margin:1px 0 0}
  .pmhead .pay{text-align:right}
  .pmhead .pay .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0}
  .pmhead .pay .amt{font-size:19px;font-weight:660;color:var(--money);margin:1px 0 0}
  .scroll{overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:680px}
  thead th{text-align:right;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:10px 14px;border-bottom:1px solid var(--hairline-2);white-space:nowrap;background:var(--surface-2)}
  thead th.l,tbody td.l{text-align:left}
  tbody td{padding:11px 14px;border-bottom:1px solid var(--hairline-2);text-align:right;white-space:nowrap}
  tbody tr:last-child td{border-bottom:none}
  .prop{font-weight:560}
  .chip{display:inline-block;font-size:11.5px;font-weight:600;padding:2px 9px;border-radius:999px}
  .chip.agent{background:var(--accent-weak);color:var(--accent-ink)}
  .chip.office{background:transparent;color:var(--office);border:1px solid var(--hairline)}
  td.money{color:var(--money);font-weight:560}
  .flag{display:inline-block;margin-left:5px;font-size:10px;color:var(--warn-ink);background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:4px;padding:0 4px;vertical-align:middle}
  tfoot td{padding:11px 14px;text-align:right;font-weight:650;border-top:1.5px solid var(--hairline);background:var(--surface-2);white-space:nowrap}
  tfoot td.l{text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:.05em;color:var(--muted)}
  footer.note{margin-top:30px;padding-top:20px;border-top:1px solid var(--hairline);font-size:13px;color:var(--muted)}
  footer.note h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink);margin:0 0 10px}
  footer.note ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px}
  footer.note b{color:var(--ink)}
  @media(max-width:720px){.tiles{grid-template-columns:repeat(2,1fr)}h1{font-size:22px}.wrap{padding:22px 14px 48px}}
</style>
<div class="wrap">
  <header class="top">
    <p class="eyebrow">HomeLife Property Management · Confidential</p>
    <h1>PM Commission Report — ${esc(monthLabel)}</h1>
    <p class="sub">As of the ${esc(monthLabel)} rent run. Management fees per property manager, grouped by lead type, straight from Buildium.</p>
  </header>
  <div class="banner"><span class="dot"></span><div><b>Real Buildium data.</b> ${recon} These are the gross management fees the owners were charged, matched line-for-line to the payout checks Buildium posted for the ${esc(monthLabel)} run.</div></div>
  ${tiles}
  <div class="assume">
    <h3>How to read this</h3>
    <p>Each management fee = the greater of the door's minimum fee or (management rate × rent collected) — read directly from Buildium. <b>Lead type</b> is Buildium's own: <b>Their Lead</b> = the PM's own lead, <b>Office Lead</b> = office-sourced.</p>
    <div class="rules">
      <div class="r"><span>Agent lead (Their Lead), standard</span><b>PM 70 / Office 30</b></div>
      <div class="r"><span>Office lead, standard</span><b>PM 50 / Office 50</b></div>
      <div class="r"><span>Agent lead — Happy Boyal</span><b>PM 80 / Office 20</b></div>
      <div class="r"><span>Office lead — Happy Boyal</span><b>PM 75 / Office 25</b></div>
    </div>
    <p><b>GST assumption — please confirm:</b> the split is applied to the <b>pre-GST</b> management fee. The 5% GST is treated as a government pass-through (remitted, not shared), so it is <b>not</b> split. It stays a separate line and the grand total still lands at ${money(data.totals.grossFees)} fees + ${money(data.totals.gst)} GST.</p>
    <p><b>Other streams this month:</b> marketing (flat 50/50 when present), inspections and renewals (lead-based split) had <b>no ${esc(monthLabel)} activity</b> — shown as $0, columns retained.</p>
  </div>
  ${splitCheck}
  ${flags}
  ${confirms}
  ${cards}
  <footer class="note">
    <h3>Notes</h3>
    <ul>
      <li><b>Source:</b> Buildium posted management-fee checks for the ${esc(monthLabel)} run. Figures reconcile to the penny against those checks.</li>
      <li><b>Split:</b> applied to the pre-GST fee by Buildium-native lead type. GST (5%) is a pass-through, not split — confirm this treatment.</li>
      <li><b>Repeatable:</b> this report regenerates for any month from the same Buildium data.</li>
    </ul>
  </footer>
</div>`;
};

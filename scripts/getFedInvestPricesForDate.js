// Write a YieldsFromFedInvestPrices.csv for a PAST trading day, in the format shared/src/market-data.js parses
// (line 1 = settlement date, line 2 = header, rows 3+ = data).
//
// Why this exists: FedInvest is the only source with per-CUSIP prices for a past date, which is
// what makes a realistic year-over-year test possible — build a ladder in the world as it stood a
// year ago, export it, then load that export against today's data (TipsLadderManager
// KNOWN_ISSUES §Reproducing the year-over-year scenario). It is also the source's remaining live
// purpose: the app itself prices off market quotes (3.1_Data_Pipeline.md §4.0).
//
// Distinct from getYieldsFedInvest.js, which handles the daily endpoint and has no historical
// equivalent. This one drives the date-selection flow instead, and writes a local file rather than
// uploading to R2.
//
// Usage: node scripts/getFedInvestPricesForDate.js 2025-08-26 [outfile]
//        defaults to ./YieldsFromFedInvestPrices-<date>.csv

import { writeFileSync } from 'fs';
import { yieldFromPrice } from '../shared/src/bond-math.js';
import { localDate } from '../shared/src/settlement.js';

const FEDINVEST = 'https://www.treasurydirect.gov/GA-FI/FedInvest';
const R2 = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';

function jar(res, prior = '') {
  const set = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]);
  const m = new Map(prior ? prior.split('; ').map(c => [c.split('=')[0], c]) : []);
  for (const c of set) m.set(c.split('=')[0], c);
  return [...m.values()].join('; ');
}

// Parse a form's action and every declared input. TreasuryDirect has renamed these fields more than
// once (the date triple became a single ISO `priceDate`), so never hardcode them — submit whatever
// the live page declares. Same discipline getYieldsFedInvest.js adopted for the daily endpoint.
function form(html, id) {
  const body = html.match(new RegExp(`<form[^>]*id="${id}"[^>]*>([\\s\\S]*?)</form>`, 'i'));
  if (!body) return null;
  const action = (html.match(new RegExp(`<form[^>]*id="${id}"[^>]*action="([^"]+)"`, 'i')) || [])[1];
  const fields = {};
  for (const tag of body[1].matchAll(/<input[^>]*name="([^"]+)"[^>]*>/gi)) {
    fields[tag[1]] = (tag[0].match(/value="([^"]*)"/) || [, ''])[1];
  }
  return { action, fields };
}

export async function fetchPricesForDate(iso) {
  const g = await fetch(`${FEDINVEST}/selectSecurityPriceDate`);
  if (!g.ok) throw new Error(`FedInvest date page: HTTP ${g.status}`);
  let cookies = jar(g);
  const html1 = await g.text();

  const dateForm = form(html1, 'fromToDate');
  if (!dateForm) throw new Error('FedInvest: no fromToDate form (page structure changed)');
  if (!('_csrf' in dateForm.fields)) throw new Error('FedInvest: no _csrf token (page structure changed)');

  // Overwrite only the date; keep the token and anything else the form declares.
  const dateKey = Object.keys(dateForm.fields).find(k => /^priceDate/i.test(k));
  if (!dateKey) throw new Error('FedInvest: no priceDate field (page structure changed)');
  const sel = await fetch(`${FEDINVEST}/selectSecurityPriceDate`, {
    method: 'POST',
    headers: { Cookie: cookies, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...dateForm.fields, [dateKey]: iso, submit: 'Show Prices' }),
  });
  cookies = jar(sel, cookies);
  const html2 = await sel.text();
  if (!/Prices For/i.test(html2)) return null;

  // A non-trading day still renders a "Prices For:" page — just with an empty table — so the date
  // header alone is not proof of data. Confirm it echoes the date asked for, then require rows.
  const shown = (html2.match(/Prices For:\s*([^<]+)/i) || [, ''])[1].trim();

  const csvForm = form(html2, 'CSVFormat');
  if (!csvForm) throw new Error('FedInvest: no CSVFormat form on the price page');
  const res = await fetch(new URL(csvForm.action, `${FEDINVEST}/`).toString(), {
    method: 'POST',
    headers: { Cookie: cookies, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(csvForm.fields),
  });
  if (!res.ok) throw new Error(`FedInvest CSV: HTTP ${res.status}`);
  const text = await res.text();
  if (text.trim().startsWith('<')) return null;
  if (!text.split('\n').some(l => /^[A-Z0-9]{9},/.test(l))) return null;  // weekend / holiday
  return { text, shown };
}

async function main() {
  const iso = process.argv[2];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) {
    console.error('Usage: node scripts/getFedInvestPricesForDate.js YYYY-MM-DD [outfile]');
    process.exit(2);
  }
  const out = process.argv[3] || `YieldsFromFedInvestPrices-${iso}.csv`;

  const refRes = await fetch(`${R2}/TIPS/TipsRef.csv`);
  if (!refRes.ok) throw new Error(`TipsRef.csv: HTTP ${refRes.status}`);
  const refMap = new Map((await refRes.text()).trim().split('\n').slice(1)
    .filter(l => l.trim())
    .map(line => {
      const [cusip, maturity, datedDate, coupon, datedDateRefCpi] = line.split(',');
      return [cusip, { maturity, coupon: parseFloat(coupon), datedDateRefCpi: parseFloat(datedDateRefCpi) }];
    }));

  const got = await fetchPricesForDate(iso);
  if (got === null) { console.error(`No FedInvest prices for ${iso} (weekend, holiday, or not yet published).`); process.exit(1); }
  const { text: raw, shown } = got;

  // Guard against a silent fallback to some other day's prices, which would produce a fixture
  // labeled with a date it does not contain.
  const [yy, mm, dd] = iso.split('-').map(Number);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const expected = new RegExp(`${yy}\\s+${MONTHS[mm - 1]}\\s+0?${dd}\\b|${MONTHS[mm - 1]}\\s+0?${dd},\\s*${yy}`);
  if (shown && !expected.test(shown)) {
    console.error(`FedInvest returned prices for "${shown}", not ${iso} — refusing to write.`);
    process.exit(1);
  }

  // Same merge rules as getYieldsFedInvest.js: price = buy || sell || eod, TIPS metadata from
  // TipsRef.csv, yield computed via the shared yieldFromPrice at that day's settlement.
  const rows = [];
  const missing = [];
  for (const line of raw.trim().split('\n')) {
    if (!/^[A-Z0-9]{9},/.test(line)) continue;
    const c = line.split(',').map(s => s.trim());
    if (c[1] !== 'TIPS') continue;
    const ref = refMap.get(c[0]);
    if (!ref) { missing.push(c[0]); continue; }
    const price = parseFloat(c[5]) || parseFloat(c[6]) || parseFloat(c[7]) || null;
    const yld = price ? yieldFromPrice(price, ref.coupon, localDate(iso), localDate(ref.maturity)) : null;
    rows.push(['TIPS', c[0], ref.maturity, ref.coupon, ref.datedDateRefCpi, price ?? '', yld ?? ''].join(','));
  }
  if (!rows.length) throw new Error('No TIPS rows produced');

  writeFileSync(out, [iso, 'type,cusip,maturity,coupon,datedDateCpi,price,yield', ...rows].join('\n') + '\n');
  console.error(`${iso}: ${rows.length} TIPS → ${out}`);
  if (missing.length) console.error(`  skipped (no TipsRef metadata): ${missing.join(', ')}`);
}

// Only when run directly, so fetchPricesForDate stays importable.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('getFedInvestPricesForDate.js')) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}

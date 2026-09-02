// updateGswTipsCurve.js — pulls the latest Gürkaynak-Sack-Wright fitted TIPS yield curve
// (FEDS 2008-05) and writes its 6 Svensson parameters to R2 for the YieldCurves app to
// evaluate as a reference overlay against our own spot fit.
//
// Source: https://www.federalreserve.gov/data/yield-curve-tables/feds200805_1.html
// The Board publishes this weekly on Tuesdays, covering data through the prior Friday.
// The HTML "recent data" table is newest-row-first; dates are DD-MM-YYYY.
//
// R2 key: TIPS/GswTipsCurve.json  →  { date: "YYYY-MM-DD", beta0..beta3, tau1, tau2 }
// Run: node YieldCurves/scripts/updateGswTipsCurve.js  [--dry]

import { uploadToR2 } from './r2.js';

const URL = 'https://www.federalreserve.gov/data/yield-curve-tables/feds200805_1.html';
const R2_KEY = 'TIPS/GswTipsCurve.json';
const DRY = process.argv.includes('--dry');

function parseLatestRow(html) {
  const anchor = html.indexOf('>Date</th>');
  if (anchor < 0) throw new Error('Date column header not found — page layout changed?');
  // Column headers, in order, starting with "Date" then BETA0, BETA1, … (the "recent data" table).
  const cols = [...html.slice(anchor - 4000, anchor + 40000)
    .matchAll(/<th[^>]*>((?:Date|BETA\d|TAU\d|BKEVEN\w+|TIPS\w+))<\/th>/g)].map(m => m[1]);
  if (cols[0] !== 'Date' || !cols.includes('BETA0')) throw new Error('Unexpected header layout');

  const tbody = html.indexOf('<tbody>', anchor);
  const firstRow = html.slice(tbody, html.indexOf('</tr>', tbody) + 5);
  const date = (firstRow.match(/<th scope=['"]row['"]>([\d-]+)<\/th>/) || [])[1];
  const cells = [...firstRow.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(m => m[1].trim());
  if (!date || cells.length + 1 < cols.length) {
    throw new Error(`First data row did not parse (date=${date}, cells=${cells.length}, cols=${cols.length})`);
  }

  const rec = {};
  cols.forEach((c, i) => { rec[c] = i === 0 ? date : cells[i - 1]; });

  const [d, mo, y] = date.split('-');                       // DD-MM-YYYY
  const iso = `${y}-${mo}-${d}`;
  const num = k => {
    const v = parseFloat(rec[k]);
    if (!Number.isFinite(v)) throw new Error(`${k} missing/NaN in latest row (${rec[k]})`);
    return v;
  };
  return {
    date: iso,
    beta0: num('BETA0'), beta1: num('BETA1'), beta2: num('BETA2'), beta3: num('BETA3'),
    tau1: num('TAU1'), tau2: num('TAU2'),
  };
}

async function main() {
  const res = await fetch(URL, { headers: { 'User-Agent': 'Treasuries/YieldCurves updateGswTipsCurve' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching GSW table`);
  const parsed = parseLatestRow(await res.text());
  const body = JSON.stringify(parsed);
  console.log('Latest GSW TIPS curve:', body);
  if (DRY) { console.log('(dry run — not uploaded)'); return; }
  await uploadToR2(R2_KEY, body, 'application/json');
  console.log(`Wrote ${R2_KEY}`);
}

main().catch(err => { console.error(err); process.exit(1); });

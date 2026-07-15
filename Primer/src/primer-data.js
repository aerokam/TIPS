// primer-data.js — Live R2 data for the Treasury Security Primer's interactive
// calculators. Fetches the same feeds the other apps use; picks one
// representative security of each kind (TIPS, nominal note/bond, short bill,
// long bill) to seed calculator defaults.
// Spec: knowledge/1.0_Primer.md
import { parseCsv } from '../../shared/src/csv.js';
import { lookupRefCpi } from '../../shared/src/ref-cpi.js';

const R2_ROOT = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const TIPS_URL = R2_ROOT + '/TIPS';
const TREAS_URL = R2_ROOT + '/Treasuries';

export { lookupRefCpi };

// ─── Fetch ───────────────────────────────────────────────────────────────────
export async function loadPrimerData() {
  const [yieldsRes, refCpiRes, tipsRefRes] = await Promise.all([
    fetch(TREAS_URL + '/YieldsFromFedInvestPrices.csv', { cache: 'no-cache' }),
    fetch(TIPS_URL + '/RefCPI.csv', { cache: 'no-cache' }),
    fetch(TIPS_URL + '/TipsRef.csv', { cache: 'no-cache' }),
  ]);
  if (!yieldsRes.ok) throw new Error('YieldsFromFedInvestPrices.csv: HTTP ' + yieldsRes.status);
  if (!refCpiRes.ok) throw new Error('RefCPI.csv: HTTP ' + refCpiRes.status);
  if (!tipsRefRes.ok) throw new Error('TipsRef.csv: HTTP ' + tipsRefRes.status);

  // Row 1 = settlement date, row 2 = header, rows 3+ = data.
  const yieldsText = await yieldsRes.text();
  const yieldsLines = yieldsText.trim().split('\n');
  const settlementDate = yieldsLines[0].trim();
  const yieldsRows = parseCsv(yieldsLines.slice(1).join('\n')).map(r => ({
    type:     r.type,
    cusip:    r.cusip,
    maturity: r.maturity,
    coupon:   parseFloat(r.coupon),
    baseCpi:  parseFloat(r.datedDateCpi) || null,
    price:    parseFloat(r.price) || null,
    yield:    parseFloat(r.yield) || null,
  })).filter(r => r.maturity && !isNaN(r.coupon));

  const refCpiRows = parseCsv(await refCpiRes.text()).map(r => ({
    date: r.date,
    refCpi: parseFloat(r.refCpi),
  }));

  const tipsRefRows = parseCsv(await tipsRefRes.text()).map(r => ({
    cusip: r.cusip,
    maturity: r.maturity,
    datedDate: r.datedDate,
    coupon: parseFloat(r.coupon),
    baseCpi: parseFloat(r.baseCpi),
    term: r.term,
  }));

  return { settlementDate, yieldsRows, refCpiRows, tipsRefRows };
}

// ─── Featured-security pickers ──────────────────────────────────────────────
// Pick one illustrative security of each kind so calculators open with a real,
// live example instead of a blank form. All pick the maturity closest to a
// target term from the settlement date.
function closestByTerm(rows, settlementDate, targetYears) {
  const settle = new Date(settlementDate);
  const targetMs = targetYears * 365.25 * 86400000;
  let best = null, bestDiff = Infinity;
  for (const r of rows) {
    const mat = new Date(r.maturity);
    const diff = Math.abs((mat - settle) - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = r; }
  }
  return best;
}

export function pickFeaturedTips(data, targetYears = 10) {
  const rows = data.yieldsRows.filter(r => r.type === 'TIPS' && r.baseCpi);
  return closestByTerm(rows, data.settlementDate, targetYears);
}

export function pickFeaturedNote(data, targetYears = 10) {
  const rows = data.yieldsRows.filter(r => r.type === 'MARKET BASED NOTE' || r.type === 'MARKET BASED BOND');
  return closestByTerm(rows, data.settlementDate, targetYears);
}

// Shortest bill with MORE than 26 weeks (182 days) to maturity — the smallest
// live example of the "frequency = 2" bill case.
export function pickFeaturedLongBill(data) {
  const settle = new Date(data.settlementDate);
  const rows = data.yieldsRows
    .filter(r => r.type === 'MARKET BASED BILL')
    .map(r => ({ ...r, days: Math.round((new Date(r.maturity) - settle) / 86400000) }))
    .filter(r => r.days > 182)
    .sort((a, b) => a.days - b.days);
  return rows[0] || null;
}

// Longest bill with 26 weeks (182 days) or less to maturity — the largest
// live example of the "frequency = 1" bill case.
export function pickFeaturedShortBill(data) {
  const settle = new Date(data.settlementDate);
  const rows = data.yieldsRows
    .filter(r => r.type === 'MARKET BASED BILL')
    .map(r => ({ ...r, days: Math.round((new Date(r.maturity) - settle) / 86400000) }))
    .filter(r => r.days > 0 && r.days <= 182)
    .sort((a, b) => b.days - a.days);
  return rows[0] || null;
}

// Ref CPI on a given date for a given TIPS: base CPI at dated date, from
// TipsRef.csv (authoritative dated-date CPI), falling back to the yields row.
export function baseCpiFor(data, cusip) {
  const ref = data.tipsRefRows.find(r => r.cusip === cusip);
  if (ref && ref.baseCpi) return ref.baseCpi;
  const y = data.yieldsRows.find(r => r.cusip === cusip);
  return y ? y.baseCpi : null;
}

export const fmtDate = iso => {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
};

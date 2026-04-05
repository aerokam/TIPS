// data.js -- CSV fetch and parse (4.0_Computation_Modules.md)
// Exports: parseCsv, fetchTipsData

const R2_ROOT = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const BASE_URL = R2_ROOT + '/Treasuries';

// Parse BondHolidaysSifma.csv into a Set of YYYY-MM-DD ISO strings.
// CSV rows look like: "Thursday, April 03, 2025","Good Friday"
function parseBondHolidays(text) {
  const months = { January:1, February:2, March:3, April:4, May:5, June:6,
                   July:7, August:8, September:9, October:10, November:11, December:12 };
  const holidays = new Set();
  for (const line of text.trim().split('\n')) {
    const m = line.match(/"[^,]+,\s+(\w+)\s+(\d+),\s+(\d{4})"/);
    if (!m) continue;
    const mo = months[m[1]];
    if (!mo) continue;
    holidays.add(`${m[3]}-${String(mo).padStart(2,'0')}-${String(+m[2]).padStart(2,'0')}`);
  }
  return holidays;
}

// Returns the next bond trading day after isoDateStr (skips weekends + bond market holidays).
export function nextBondTradingDay(isoDateStr, bondHolidays) {
  const [y, mo, d] = isoDateStr.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  do {
    dt.setDate(dt.getDate() + 1);
    const iso = dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' +
      String(dt.getDate()).padStart(2, '0');
    if (dt.getDay() !== 0 && dt.getDay() !== 6 && !bondHolidays.has(iso)) return iso;
  } while (true);
}

export function parseCsv(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(s => s.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(s => s.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
}

// Fetches YieldsDerivedFromFedInvestPrices.csv and RefCPI.csv from R2, parses and types the rows.
// Returns: { yieldsRows, refCpiRows }
// Throws on HTTP errors.

// Looks up the reference CPI for a given settlement date string (YYYY-MM-DD).
// Returns the most recent refCpi on or before the date.
export function lookupRefCpi(refCpiRows, dateStr) {
  const matches = refCpiRows.filter(r => r.date <= dateStr);
  if (matches.length === 0) throw new Error('No RefCPI data on or before ' + dateStr);
  return matches[matches.length - 1].refCpi;
}

export async function fetchTipsData() {
  const [yieldsRes, refCpiRes, tipsRefRes] = await Promise.all([
    fetch(BASE_URL + '/YieldsDerivedFromFedInvestPrices.csv'),
    fetch(BASE_URL + '/RefCPI.csv'),
    fetch(BASE_URL + '/TipsRef.csv'),
  ]);
  if (!yieldsRes.ok) throw new Error('YieldsDerivedFromFedInvestPrices.csv: HTTP ' + yieldsRes.status);
  if (!refCpiRes.ok) throw new Error('RefCPI.csv: HTTP ' + refCpiRes.status);
  if (!tipsRefRes.ok) throw new Error('TipsRef.csv: HTTP ' + tipsRefRes.status);

  // Holiday fetch is optional — 3s timeout so it never blocks required data
  let bondHolidays = new Set();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const holidayRes = await fetch(R2_ROOT + '/misc/BondHolidaysSifma.csv', { signal: ctrl.signal });
    clearTimeout(timer);
    if (holidayRes.ok) bondHolidays = parseBondHolidays(await holidayRes.text());
  } catch (_) { /* unavailable — T+1 falls back to weekend-skip only */ }

  // YieldsDerivedFromFedInvestPrices.csv: row 1 = settlement date, row 2 = header, rows 3+ = data
  const yieldsText = await yieldsRes.text();
  const yieldsLines = yieldsText.trim().split('\n');
  const settlementDate = yieldsLines[0].trim();
  const yieldsRows = parseCsv(yieldsLines.slice(1).join('\n'))
    .filter(r => r.type === 'TIPS')
    .map(r => ({
      settlementDate,
      cusip:    r.cusip,
      maturity: r.maturity,
      coupon:   parseFloat(r.coupon),
      baseCpi:  parseFloat(r.datedDateCpi),
      price:    parseFloat(r.price)  || null,
      yield:    parseFloat(r.yield)  || null,
    }));

  const refCpiRows = parseCsv(await refCpiRes.text()).map(r => ({
    date:   r.date,
    refCpi: parseFloat(r.refCpi),
  }));

  const tipsRefRows = parseCsv(await tipsRefRes.text()).map(r => ({
    cusip:     r.cusip,
    maturity:  r.maturity,
    datedDate: r.datedDate,
    coupon:    parseFloat(r.coupon),
    baseCpi:   parseFloat(r.baseCpi),
    term:      r.term,
  }));

  return { yieldsRows, refCpiRows, tipsRefRows, bondHolidays };
}

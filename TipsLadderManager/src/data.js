// data.js -- CSV fetch and parse (4.0_Computation_Modules.md)
// Exports: parseCsv, fetchTipsData, fetchFidelityTipsData, lookupRefCpi (re-exported from shared)

// Ref CPI lookup is defined once in shared/src/ref-cpi.js (no-redundancy directive,
// projects/CLAUDE.md §2a). Re-exported here so existing `from './data.js'` imports resolve.
export { lookupRefCpi } from '../../shared/src/ref-cpi.js';
import { parseFidelityTipsRows, parseFidelityDownloadDate, fidelityDownloadDateIso } from '../../shared/src/fidelity-parse.js';
import { yieldFromPrice } from '../../shared/src/bond-math.js';
import { localDate } from '../../shared/src/settlement.js';

const R2_ROOT = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const BASE_URL = R2_ROOT + '/Treasuries';

const TIPS_URL = R2_ROOT + '/TIPS';

// Parse BondHolidaysSifma.csv into a Set of YYYY-MM-DD ISO strings.
// CSV rows look like: "Thursday, April 03, 2025","Good Friday"
export function parseBondHolidays(text) {
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

// A coupon/principal dated on a weekend or bond holiday is actually paid the next bond trading
// day — the cash isn't in hand until then. `bondHolidays` defaults to an empty Set (weekend-only
// rolling still applies via the day-of-week check in nextBondTradingDay; pass real holiday data
// for full accuracy). 5.0 §Cash Flow Calendar.
export function actualPaymentDate(d, bondHolidays = new Set()) {
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const isTradingDay = d.getDay() !== 0 && d.getDay() !== 6 && !bondHolidays.has(iso);
  if (isTradingDay) return d;
  const [ny, nmo, nd] = nextBondTradingDay(iso, bondHolidays).split('-').map(Number);
  return new Date(ny, nmo - 1, nd);
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

// Fetches RefCPI.csv, TipsRef.csv, YieldsSaSao.csv, and BondHolidaysSifma.csv from R2 —
// shared by both fetchTipsData() (FedInvest) and fetchFidelityTipsData() (Fidelity) so the
// parsing isn't duplicated between the two sources (projects/CLAUDE.md §2a).
// Throws on HTTP errors for RefCPI/TipsRef/YieldsSaSao; holidays are optional (3s timeout).
async function fetchAuxTipsData() {
  const [refCpiRes, tipsRefRes, saSaoRes] = await Promise.all([
    fetch(TIPS_URL + '/RefCPI.csv', { cache: 'no-cache' }),
    fetch(TIPS_URL + '/TipsRef.csv', { cache: 'no-cache' }),
    fetch(TIPS_URL + '/YieldsSaSao.csv', { cache: 'no-cache' }),
  ]);
  if (!refCpiRes.ok) throw new Error('RefCPI.csv: HTTP ' + refCpiRes.status);
  if (!tipsRefRes.ok) throw new Error('TipsRef.csv: HTTP ' + tipsRefRes.status);
  if (!saSaoRes.ok) throw new Error('YieldsSaSao.csv: HTTP ' + saSaoRes.status);

  let bondHolidays = new Set();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const holidayRes = await fetch(R2_ROOT + '/misc/BondHolidaysSifma.csv', { signal: ctrl.signal });
    clearTimeout(timer);
    if (holidayRes.ok) bondHolidays = parseBondHolidays(await holidayRes.text());
  } catch (_) { /* unavailable — T+1 falls back to weekend-skip only */ }

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

  // YieldsSaSao.csv: cusip,maturity,coupon,ask_yield,sa_yield,sao_yield — produced by
  // YieldCurves/scripts/updateSaSaoYields.js. Only sa_yield is consumed (2.0 §Within-Year
  // Allocation Policy); ask_yield/sao_yield are parsed but unused here.
  const saSaoRows = parseCsv(await saSaoRes.text()).map(r => ({
    cusip:    r.cusip,
    saYield:  parseFloat(r.sa_yield),
  }));

  return { refCpiRows, tipsRefRows, saSaoRows, bondHolidays };
}

// Fetches YieldsFromFedInvestPrices.csv and RefCPI.csv from R2, parses and types the rows.
// Returns: { yieldsRows, refCpiRows }
// Throws on HTTP errors.

export async function fetchTipsData() {
  const [yieldsRes, aux] = await Promise.all([
    fetch(BASE_URL + '/YieldsFromFedInvestPrices.csv', { cache: 'no-cache' }),
    fetchAuxTipsData(),
  ]);
  if (!yieldsRes.ok) throw new Error('YieldsFromFedInvestPrices.csv: HTTP ' + yieldsRes.status);
  const { refCpiRows, tipsRefRows, saSaoRows, bondHolidays } = aux;

  // YieldsFromFedInvestPrices.csv: row 1 = settlement date, row 2 = header, rows 3+ = data
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

  return { yieldsRows, refCpiRows, tipsRefRows, saSaoRows, bondHolidays };
}

// Fetches FidelityTreasuriesTips.csv from R2 (ask price; yield is computed from that price
// via the shared yieldFromPrice(), not read from Fidelity's own quoted yield column — verified
// more accurate than Fidelity's own figure, see 3.1_Data_Pipeline.md). baseCpi comes from
// TipsRef.csv (Fidelity's export doesn't carry it). Settlement is T+1 from Fidelity's download
// date (real broker trade settlement), unlike FedInvest's T=0 (needed for its own price->yield
// math) — see 3.1_Data_Pipeline.md "Settlement Date Conventions".
// Returns the same shape as fetchTipsData(): { yieldsRows, refCpiRows, tipsRefRows, bondHolidays }
// Throws on HTTP errors.
//
// Returns both `asOfDate` (the raw Fidelity download date -- "today", analogous to
// FedInvest's own settlementDate row) and each yieldsRow's `settlementDate` (asOfDate's
// T+1, used for the yield/duration math). Callers deriving a "next trading day from
// today" default (e.g. the Trade Ticket's Ref CPI date) must use `asOfDate`, not
// yieldsRows[].settlementDate -- that's already T+1 and would double-advance.
export async function fetchFidelityTipsData() {
  const [fidRes, aux] = await Promise.all([
    fetch(BASE_URL + '/FidelityTreasuriesTips.csv', { cache: 'no-cache' }),
    fetchAuxTipsData(),
  ]);
  if (!fidRes.ok) throw new Error('FidelityTreasuriesTips.csv: HTTP ' + fidRes.status);
  const { refCpiRows, tipsRefRows, saSaoRows, bondHolidays } = aux;
  const tipsRefByCusip = new Map(tipsRefRows.map(r => [r.cusip, r]));

  const fidText = await fidRes.text();
  const asOfDate = fidelityDownloadDateIso(parseFidelityDownloadDate(fidText));
  if (!asOfDate) throw new Error('FidelityTreasuriesTips.csv: no "Date downloaded" footer found');
  const settlementDate = nextBondTradingDay(asOfDate, bondHolidays);
  const settlementDateObj = localDate(settlementDate);

  const yieldsRows = parseFidelityTipsRows(fidText).map(r => {
    const ref = tipsRefByCusip.get(r.cusip);
    const maturity = r.maturity || ref?.maturity;
    const maturityDateObj = localDate(maturity);
    const price = isNaN(r.askPrice) ? null : r.askPrice;
    const yld = (price != null && maturityDateObj)
      ? yieldFromPrice(price, r.coupon, settlementDateObj, maturityDateObj)
      : null;
    return {
      settlementDate,
      cusip:    r.cusip,
      maturity,
      coupon:   r.coupon,
      baseCpi:  ref?.baseCpi ?? null,
      price,
      yield:    yld,
    };
  });

  return { yieldsRows, refCpiRows, tipsRefRows, saSaoRows, bondHolidays, asOfDate };
}

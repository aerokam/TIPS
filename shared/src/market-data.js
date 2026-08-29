// market-data.js -- CSV fetch and parse for TIPS market data (4.0_Computation_Modules.md,
// TipsLadderManager/knowledge/3.1_Data_Pipeline.md).
// Moved here from TipsLadderManager/src/data.js so TipsReference can share it too, per the
// project-wide no-redundancy directive (projects/CLAUDE.md §2a) -- a source flip in YIELD_SOURCE
// now applies to every consumer at once, instead of being able to strand one app on the dormant
// source while another moved on (see handoff-shared-data-js.md).
// Named market-data.js, not data.js: CpiExplorer/src/data.js already exists and is unrelated
// (fetchCpiHistory, fetchRefCpi) -- two data.js files, one of them shared, invites exactly the
// wrong-file mistake this move is meant to prevent.
//
// Exports: parseCsv, fetchTipsData, fetchFidelityTipsData, loadMarketData, nextBondTradingDay,
// lookupRefCpi (re-exported from shared/src/ref-cpi.js)

// Ref CPI lookup is defined once in shared/src/ref-cpi.js (no-redundancy directive,
// projects/CLAUDE.md §2a). Re-exported here so existing `from './market-data.js'` imports resolve.
export { lookupRefCpi } from './ref-cpi.js';
import { parseFidelityTipsRows, parseFidelityDownloadDate, fidelityDownloadDateIso } from './fidelity-parse.js';
import { yieldFromPrice } from './bond-math.js';
import { localDate, toIsoDate, nextBusinessDay, parseHolidaySet } from './settlement.js';
import { parseCsv as parseCsvRows } from './csv.js';

const R2_ROOT = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const BASE_URL = R2_ROOT + '/Treasuries';

const TIPS_URL = R2_ROOT + '/TIPS';

// Next bond trading day after isoDateStr (skips weekends + SIFMA bond-market holidays), as an
// ISO string in, ISO string out -- a thin wrapper so callers here keep working with dates the way
// this module's CSVs already do, while the actual weekend/holiday-skip logic lives once in
// shared/src/settlement.js (nextBusinessDay), imported by every app that needs it.
export function nextBondTradingDay(isoDateStr, holidaySet) {
  return toIsoDate(nextBusinessDay(localDate(isoDateStr), holidaySet));
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

// Fetches RefCPI.csv, TipsRef.csv, YieldsSaSao.csv, and BondHolidaysSifma.csv from R2 --
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
    if (holidayRes.ok) bondHolidays = parseHolidaySet(parseCsvRows(await holidayRes.text(), false));
  } catch (_) { /* unavailable -- T+1 falls back to weekend-skip only */ }

  const refCpiRows = parseCsv(await refCpiRes.text()).map(r => ({
    date:   r.date,
    refCpi: parseFloat(r.refCpi),
  }));

  const tipsRefRows = parseCsv(await tipsRefRes.text()).map(r => ({
    cusip:     r.cusip,
    maturity:  r.maturity,
    datedDate: r.datedDate,
    coupon:    parseFloat(r.coupon),
    // `baseCpi` is the pre-rename header; read both while R2 still carries files written
    // before the rename (DD S2, "dated date Ref CPI").
    baseCpi:   parseFloat(r.datedDateRefCpi ?? r.baseCpi),
    term:      r.term,
  }));

  // YieldsSaSao.csv: cusip,maturity,coupon,ask_yield,sa_yield,sao_yield -- produced by
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
// via the shared yieldFromPrice(), not read from Fidelity's own quoted yield column -- verified
// more accurate than Fidelity's own figure, see 3.1_Data_Pipeline.md). baseCpi comes from
// TipsRef.csv (Fidelity's export doesn't carry it). Settlement is T+1 from Fidelity's download
// date (real broker trade settlement), unlike FedInvest's T=0 (needed for its own price->yield
// math) -- see 3.1_Data_Pipeline.md "Settlement Date Conventions".
// Returns the same shape as fetchTipsData(): { yieldsRows, refCpiRows, tipsRefRows, bondHolidays }
// Throws on HTTP errors.
//
// Returns both `asOfDate` (the raw Fidelity download date -- "today", analogous to
// FedInvest's own settlementDate row) and each yieldsRow's `settlementDate` (asOfDate's
// T+1, used for the yield/duration math). Callers deriving a "next trading day from
// today" default (e.g. the Trade Ticket's Ref CPI date) must use `asOfDate`, not
// yieldsRows[].settlementDate -- that's already T+1 and would double-advance.
// The single decision point for which source the app prices from (3.1 §4.0 Yield Sources).
// FedInvest is dormant, kept as a cross-check path; flip this to 'fedinvest' to use it.
// Nothing outside this module chooses a source: every caller goes through loadMarketData(), so a
// script cannot silently price off the dormant source while the app prices off the live one.
const YIELD_SOURCE = 'fidelity';

// The one entry point for market data. Returns the raw rows plus the dates whose derivation is
// source-dependent, so no caller has to know -- or can get wrong -- which source is active.
// Callers build the TIPS map themselves via buildTipsMapFromYields (TipsLadderManager's
// rebalance-lib.js): this module is a leaf and does not import an orchestrator
// (TipsLadderManager knowledge/4.0_Computation_Modules.md §Module Dependency Graph).
export async function loadMarketData() {
  const d = YIELD_SOURCE === 'fedinvest' ? await fetchTipsData() : await fetchFidelityTipsData();
  const { yieldsRows, refCpiRows, tipsRefRows, saSaoRows, bondHolidays, asOfDate } = d;
  const settleDateStr = yieldsRows[0]?.settlementDate;
  if (!settleDateStr) throw new Error('No market data returned for source: ' + YIELD_SOURCE);
  // FedInvest's settleDateStr IS "today" (T), so trade === settle there; Fidelity's is already
  // T+1, so its "today"/trade reference is the download date.
  const tradeDateStr = YIELD_SOURCE === 'fedinvest' ? settleDateStr : asOfDate;
  return {
    source: YIELD_SOURCE,
    yieldsRows, refCpiRows, tipsRefRows, saSaoRows, bondHolidays, asOfDate,
    saYieldByCusip: new Map(saSaoRows.map(r => [r.cusip, r.saYield])),
    settleDateStr,
    tradeDateStr,
    defaultRefCpiDateStr: nextBondTradingDay(tradeDateStr, bondHolidays),
  };
}

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

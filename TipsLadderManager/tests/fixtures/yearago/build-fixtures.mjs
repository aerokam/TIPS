// Builds ladders on REAL market data from a year ago and writes them out in the app's own
// CUSIP/Qty export format, so they load in Rebalance exactly like a file exported back then.
// Prices, yields and Ref CPI all come from 2025-08-26 — nothing is mixed with today.
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../../..');
// Directory holding a snapshot of the R2 files for the target date. Populate it with
// scripts/getFedInvestPricesForDate.js plus the RefCPI/TipsRef/SaSao/holiday files of the day.
const SNAPSHOT = process.env.SNAPSHOT;
if (!SNAPSHOT) { console.error(`Set SNAPSHOT to a directory holding that day’s R2 files.`); process.exit(1); }
const OUT = HERE;

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop().split('?')[0];
  try { return { ok: true, status: 200, async text() { return readFileSync(`${SNAPSHOT}/${name}`, 'utf8'); } }; }
  catch { return { ok: false, status: 404, async text() { return ''; } }; }
};
const data  = await import(`file:///${path.resolve(APP, '..', 'shared', 'src', 'market-data.js')}`);
const rl    = await import(`file:///${APP}/src/rebalance-lib.js`);
const build = await import(`file:///${APP}/src/build-lib.js`);

const d = await data.fetchTipsData();          // FedInvest: settle == trade == the file's own date
const settleDateStr = d.yieldsRows[0].settlementDate;
const settlementDate = rl.localDate(settleDateStr);
const tipsMap = rl.buildTipsMapFromYields(d.yieldsRows);
const bondHolidays = d.bondHolidays;
// The Ref CPI date a real export records: the next bond trading day after the trade date.
const refCpiDate = data.nextBondTradingDay(settleDateStr, bondHolidays);
const refCPI = data.lookupRefCpi(d.refCpiRows, refCpiDate);
console.log(`year-ago market data: settle ${settleDateStr}   Ref CPI date ${refCpiDate}   Ref CPI ${refCPI.toFixed(5)}`);

// Mirrors index.html _exportCusipQty(): cusip,qty,excess + #fundedYear,dara + #params.
function exportText(res, params) {
  const rows = ['cusip,qty,excess'];
  const zeroed = new Set(res.summary.zeroedFundedYears ?? []);
  for (const x of res.details) {
    const q = x.fundedYearQty, e = x.excessQty;
    if (q + e > 0) rows.push(`${x.cusip},${q},${e}`);
    else if (zeroed.has(x.fundedYear)) rows.push(`${x.cusip},0,0`);
  }
  const m = res.summary.daraByYearResolved;
  if (m && m.size > 0) {
    rows.push('#fundedYear,dara');
    for (const y of [...m.keys()].sort((a, b) => a - b)) rows.push(`${y},${Math.round(m.get(y))}`);
  }
  rows.push(`#params,preLadderInterest=${params.pli ? 'true' : 'false'},maturityPref=${params.maturityPref},`
    + `couponPref=${params.couponPref},refCpiDate=${refCpiDate},availableCash=0,rmdCouponMode=all`);
  return rows.join('\n');
}

// 'last' holds one TIPS per year, the latest-maturing; 'all' holds every maturity month in the
// year. The second matters for the settlement year: with all four 2026 months held, three of them
// have already matured by late August, which is what exercises maturity proceeds as received cash
// (2.0 §Available Cash). 'first' is the opposite extreme -- its settlement-year rung matured in
// January, so the whole rung is cash before the rebalance even starts.
const cases = [
  { name: 'ladder-2026-2040-dara40k',      dara: 40000,  firstYear: 2026, lastYear: 2040, maturityPref: 'last' },
  { name: 'ladder-2026-2055-dara40k',      dara: 40000,  firstYear: 2026, lastYear: 2055, maturityPref: 'last' },
  { name: 'ladder-2026-2045-dara100k',     dara: 100000, firstYear: 2026, lastYear: 2045, maturityPref: 'last' },
  { name: 'ladder-2027-2050-dara60k',      dara: 60000,  firstYear: 2027, lastYear: 2050, maturityPref: 'last' },
  { name: 'ladder-2026-2040-dara40k-all',  dara: 40000,  firstYear: 2026, lastYear: 2040, maturityPref: 'all' },
  { name: 'ladder-2026-2055-dara40k-all',  dara: 40000,  firstYear: 2026, lastYear: 2055, maturityPref: 'all' },
  { name: 'ladder-2026-2045-dara100k-all', dara: 100000, firstYear: 2026, lastYear: 2045, maturityPref: 'all' },
  { name: 'ladder-2026-2040-dara40k-first',dara: 40000,  firstYear: 2026, lastYear: 2040, maturityPref: 'first' },
];

for (const c of cases) {
  const daraByYear = new Map();
  for (let y = c.firstYear; y <= c.lastYear; y++) daraByYear.set(y, c.dara);
  const res = build.runBuild({
    dara: c.dara, firstYear: c.firstYear, lastYear: c.lastYear, tipsMap, refCPI, settlementDate,
    maturityPref: c.maturityPref, couponPref: 'higher', preLadderInterest: false, daraByYear,
    yearOverrides: null, bondHolidays, availableCash: 0, rmdCouponMode: 'all', tradeDate: settlementDate,
  });
  const text = exportText(res, { pli: false, maturityPref: c.maturityPref, couponPref: 'higher' });
  const file = `${OUT}/${c.name}.csv`;
  writeFileSync(file, text);
  const positions = text.split('\n').filter(l => /^[0-9A-Z]{9},/.test(l)).length;
  console.log(`  ${c.name}.csv  ${positions} positions  cost ${Math.round(res.summary.totalBuyCost).toLocaleString()}`);
}

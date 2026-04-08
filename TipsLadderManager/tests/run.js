// Regression tests — must pass after every refactor phase
// Replicates browser data loading + parsing, then runs rebalance and build.
// Any refactor must produce identical output for all assertions here.

import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { buildTipsMapFromYields, localDate, runRebalance, inferDARAFromCash } from '../src/rebalance-lib.js';
import { runBuild } from '../src/build-lib.js';

// ── CSV helpers (match index.html exactly) ────────────────────────────────────
function parseCsv(text) {
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

function parseHoldings(text) {
  const CUSIP_RE = /^[A-Z0-9]{9}$/i;
  const rawLines = text.trim().split('\n').filter(l => l.trim());
  const startIdx = CUSIP_RE.test(rawLines[0].split(',')[0].trim()) ? 0 : 1;
  const map = new Map();
  for (let i = startIdx; i < rawLines.length; i++) {
    const parts = rawLines[i].split(',').map(s => s.trim());
    const [cusip, qtyStr] = parts;
    if (!CUSIP_RE.test(cusip)) continue;
    const qty = parseInt(qtyStr, 10);
    if (!isNaN(qty) && qty >= 0) map.set(cusip, (map.get(cusip) ?? 0) + qty);
  }
  return Array.from(map, ([cusip, qty]) => ({ cusip, qty }));
}

function lookupRefCpi(refCpiRows, dateStr) {
  const matches = refCpiRows.filter(r => r.date <= dateStr);
  if (!matches.length) throw new Error(`No RefCPI on or before ${dateStr}`);
  return matches[matches.length - 1].refCpi;
}

// ── Load shared data ──────────────────────────────────────────────────────────
const yieldsPath = path.resolve('tests/e2e/YieldsDerivedFromFedInvestPrices.csv');
const refCpiPath = path.resolve('tests/e2e/RefCPI.csv');

console.log(`[Test Setup] Market Data:   ${yieldsPath}`);
// YieldsDerivedFromFedInvestPrices.csv: row 1 = settlement date, row 2 = header, rows 3+ = data
const yieldsText = readFileSync(yieldsPath, 'utf8');
const yieldsLines = yieldsText.trim().split('\n');
const yieldsCsvSettleDate = yieldsLines[0].trim();
const yieldsRows = parseCsv(yieldsLines.slice(1).join('\n')).map(r => ({
  settlementDate: yieldsCsvSettleDate,
  cusip:    r.cusip,
  maturity: r.maturity,
  coupon:   parseFloat(r.coupon),
  baseCpi:  parseFloat(r.datedDateCpi),
  price:    parseFloat(r.price)  || null,
  yield:    parseFloat(r.yield)  || null,
}));
console.log(`[Test Setup] Loaded ${yieldsRows.length} bonds from market data.`);

console.log(`[Test Setup] Reference CPI: ${refCpiPath}`);
const refCpiRows = parseCsv(readFileSync(refCpiPath, 'utf8')).map(r => ({
  date:   r.date,
  refCpi: parseFloat(r.refCpi),
}));

const settleDateStr = yieldsRows[0]?.settlementDate;
const settlementDate = localDate(settleDateStr);
const tipsMap = buildTipsMapFromYields(yieldsRows);
const refCPI = lookupRefCpi(refCpiRows, settleDateStr);

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

// Suppress "CUSIP not found" warnings from rebalance-lib during tests
// (Happens when local dev files contain CUSIPs missing from the static mock fixture)
const originalWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('not found in TIPS data')) return;
  originalWarn.apply(console, args);
};

function assert(name, actual, expected, tolerance = 0) {
  const ok = tolerance > 0
    ? Math.abs(actual - expected) <= tolerance
    : actual === expected;
  if (ok) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}`);
    console.error(`        expected: ${expected}`);
    console.error(`        actual:   ${actual}`);
    failed++;
  }
}

// ── Helper: Run Full Rebalance on a holdings file ─────────────────────────────
function runFullRebalanceTest(name, filePath) {
  const fullPath = path.resolve(filePath);
  if (!existsSync(fullPath)) return;

  console.log(`\n${name} — Full rebalance`);
  console.log(`  Input: ${fullPath}`);
  
  const holdings = parseHoldings(readFileSync(fullPath, 'utf8'));
  const { dara, portfolioCash } = inferDARAFromCash({ holdings, tipsMap, refCPI, settlementDate });
  const { summary } = runRebalance({ dara, method: 'Full', holdings, tipsMap, refCPI, settlementDate });
  
  // Net cash should be effectively non-negative (surplus) and < cost of ~two bonds (~$3000).
  // (Allowing > -50 to account for binary search tolerance in inferDARA)
  const netCash = summary.costDeltaSum;
  const ok = netCash > -50 && netCash < 3000;
  
  if (ok) {
    console.log(`  PASS  net cash within (-50, 3000)`);
    passed++;
  } else {
    console.error(`  FAIL  net cash within (-50, 3000)`);
    console.error(`        actual:   ${netCash}`);
    failed++;
  }
  console.log(`        inferred DARA: ${Math.round(dara).toLocaleString()}`);
  console.log(`        net cash:      ${Math.round(netCash).toLocaleString()}`);
  console.log(`        surplus check: ${Math.round(summary.gapCoverageSurplus).toLocaleString()}`);
}

// ── Run tests on known files and local dev files ──────────────────────────────

// 1. Standard public test file
runFullRebalanceTest('CusipQtyTestLumpy', './tests/CusipQtyTestLumpy.csv');

// 2. Specific test for 3-bracket logic and multi-year aggregation (Fix for bug reported Mar 23)
{
  const filePath = './tests/dev/TipsLadderCom.csv';
  if (existsSync(path.resolve('TipsLadderManager', filePath))) {
    console.log(`\nTipsLadderCom — 3-bracket validation`);
    const holdings = parseHoldings(readFileSync(path.resolve('TipsLadderManager', filePath), 'utf8'));
    const dara = 20000;
    const { summary, details } = runRebalance({ dara, method: 'Gap', bracketMode: '3bracket', holdings, tipsMap, refCPI, settlementDate });
    
    // 91282CPU9 (Jan 2036) is the newLower bracket and has massive excess. 
    // identifyBrackets should now correctly pick it as origLower because it has the most excess.
    assert('origLower IS Jan 2036', summary.brackets.lowerCUSIP === '91282CPU9', true);
    assert('newLower IS Jan 2036', summary.newLowerCUSIP === '91282CPU9', true);
    
    // Weights should be non-negative
    assert('origLowerWeight >= 0', (summary.origLowerWeight ?? 0) >= 0, true);
    assert('newLowerWeight3 >= 0', (summary.newLowerWeight3 ?? 0) >= 0, true);
    assert('upperWeight3 >= 0', (summary.upperWeight3 ?? 0) >= 0, true);
    
    // Jan 2036 Quantity check: Should be significantly more than 3 (approx 25-30 total)
    const jan2036 = details.find(d => d.cusip === '91282CPU9');
    assert('Jan 2036 Qty After > 10', jan2036.qtyAfter > 10, true);
    console.log(`        Jan 2036 Qty:  ${jan2036.qtyAfter}`);
    const w1 = summary.origLowerWeight ?? 0, w2 = summary.newLowerWeight3 ?? 0, w3 = summary.upperWeight3 ?? 0;
    console.log(`        Weights:       Orig=${w1.toFixed(4)}, New=${w2.toFixed(4)}, Upper=${w3.toFixed(4)}`);
  }
}

// 3. All other local CSVs in tests/dev/

// ── Test: Build from scratch — deterministic output ───────────────────────────
console.log('\nBuild — DARA=50000, lastYear=2040');
{
  const dara = 50000, lastYear = 2040;
  const { summary, results } = runBuild({ dara, lastYear, tipsMap, refCPI, settlementDate });
  assert('totalBuyCost > 0', summary.totalBuyCost > 0, true);
  assert('result rows > 0', results.length > 0, true);
  assert('lowerYear < upperYear', summary.lowerYear < summary.upperYear, true);
  assert('lowerWeight + upperWeight ≈ 1', summary.lowerWeight + summary.upperWeight, 1, 0.0001);
  console.log(`        totalBuyCost:  ${Math.round(summary.totalBuyCost).toLocaleString()}`);
  console.log(`        lowerYear:     ${summary.lowerYear}, upperYear: ${summary.upperYear}`);
  console.log(`        weights:       ${summary.lowerWeight.toFixed(4)} / ${summary.upperWeight.toFixed(4)}`);
}

// ── Test: Build — future years (lastYear > maxRealYear) ───────────────────────
console.log('\nBuild — DARA=50000, lastYear=2060 (future years)');
{
  const dara = 50000, lastYear = 2060;
  const { summary } = runBuild({ dara, lastYear, tipsMap, refCPI, settlementDate });
  assert('futureYears.length > 0', (summary.futureYears?.length ?? 0) > 0, true);
  assert('futureLowerYear === 2056', summary.futureLowerYear, 2056);
  assert('futureUpperYear === 2052', summary.futureUpperYear, 2052);
  assert('futureLowerWeight + futureUpperWeight ≈ 1',
    (summary.futureLowerWeight ?? 0) + (summary.futureUpperWeight ?? 0), 1, 0.0001);
  assert('avgDuration between lower and upper',
    summary.futureParams?.avgDuration > summary.futureLowerDuration &&
    summary.futureParams?.avgDuration < summary.futureUpperDuration, true);
  assert('futureFellBack === false', summary.futureFellBack, false);
  assert('totalBuyCost > 0', summary.totalBuyCost > 0, true);
  console.log(`        futureYears:         ${JSON.stringify(summary.futureYears)}`);
  console.log(`        d_lower(2056):       ${summary.futureLowerDuration?.toFixed(4)}`);
  console.log(`        d_avg(future):       ${summary.futureParams?.avgDuration?.toFixed(4)}`);
  console.log(`        d_upper(2052):       ${summary.futureUpperDuration?.toFixed(4)}`);
  console.log(`        weights 2056/2052:   ${summary.futureLowerWeight?.toFixed(4)} / ${summary.futureUpperWeight?.toFixed(4)}`);
  console.log(`        exQty  2056/2052:    ${summary.futureLowerExQty} / ${summary.futureUpperExQty}`);
  console.log(`        totalBuyCost:        ${Math.round(summary.totalBuyCost).toLocaleString()}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

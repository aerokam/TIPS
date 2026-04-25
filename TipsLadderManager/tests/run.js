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
const yieldsPath = path.resolve('tests/e2e/YieldsFromFedInvestPrices.csv');
const refCpiPath = path.resolve('tests/e2e/RefCPI.csv');

console.log(`[Test Setup] Market Data:   ${yieldsPath}`);
// YieldsFromFedInvestPrices.csv: row 1 = settlement date, row 2 = header, rows 3+ = data
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

// 2. Regression: portfolio with no 2040 holding — lastYear must stop at 2035, not extend to 2045
//    (Bug: lastYear derivation incorrectly reached into >2040 holdings when 2040 not held,
//     causing spurious gap/bracket rows and rebuilding 2045/2051 as funded rungs.)
{
  console.log('\nMarisTOD — lastYear regression (no 2040 in holdings)');
  const holdings = parseHoldings(readFileSync('./tests/MarisTOD.csv', 'utf8'));
  const { dara } = inferDARAFromCash({ holdings, tipsMap, refCPI, settlementDate });
  const { summary, details } = runRebalance({ dara, method: 'Full', holdings, tipsMap, refCPI, settlementDate });

  assert('lastYear === 2035',       summary.lastYear, 2035);
  assert('firstYear === 2027',      summary.firstYear, 2027);
  assert('rungCount === 9',         summary.rungCount, 9);
  assert('gapYears is empty',       summary.gapYears.length, 0);
  assert('no 2040 funded rung',     details.some(d => d.fundedYear === 2040), false);
  assert('no 2036 funded rung',     details.some(d => d.fundedYear === 2036), false);
  // 2045 and 2051 must be untouched (LMI contributors only, not ladder rungs).
  // If those CUSIPs aren't in test market data, no detail row is generated — also correct.
  const d2045 = details.find(d => d.cusip === '912810RL4');
  const d2051 = details.find(d => d.cusip === '912810SV1');
  const delta2045 = d2045 ? (d2045.qtyAfter - d2045.qtyBefore) : 0;
  const delta2051 = d2051 ? (d2051.qtyAfter - d2051.qtyBefore) : 0;
  assert('2045 not rebuilt (qtyDelta 0 or absent)', delta2045, 0);
  assert('2051 not rebuilt (qtyDelta 0 or absent)', delta2051, 0);
  console.log(`        lastYear:      ${summary.lastYear}`);
  console.log(`        rungCount:     ${summary.rungCount}`);
  console.log(`        inferredDARA:  ${Math.round(dara).toLocaleString()}`);
  console.log(`        netCash:       ${Math.round(summary.costDeltaSum).toLocaleString()}`);
}

// 3. Specific test for 3-bracket logic and multi-year aggregation (Fix for bug reported Mar 23)
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
  const firstYear = settlementDate.getFullYear();
  const { summary, results, details } = runBuild({ dara, lastYear, tipsMap, refCPI, settlementDate });
  assert('totalBuyCost > 0', summary.totalBuyCost > 0, true);
  assert('result rows > 0', results.length > 0, true);
  assert('lowerYear < upperYear', summary.lowerYear < summary.upperYear, true);
  assert('lowerWeight + upperWeight ≈ 1', summary.lowerWeight + summary.upperWeight, 1, 0.0001);
  const numRungs = lastYear - firstYear + 1;
  const totalAmt = details.reduce((s, d) => s + (d.fundedYearAmt ?? 0) + (d.excessAmt ?? 0), 0);
  const avgAmt = totalAmt / numRungs;
  assert('avgAmt ≈ DARA (gap LMI included)', avgAmt, dara, 200);
  console.log(`        totalBuyCost:  ${Math.round(summary.totalBuyCost).toLocaleString()}`);
  console.log(`        lowerYear:     ${summary.lowerYear}, upperYear: ${summary.upperYear}`);
  console.log(`        weights:       ${summary.lowerWeight.toFixed(4)} / ${summary.upperWeight.toFixed(4)}`);
  console.log(`        avgAmt/rung:   ${Math.round(avgAmt).toLocaleString()} (DARA=${dara.toLocaleString()}, rungs=${numRungs})`);
}

// ── Test: Build — Future 30Y years (lastYear > maxRealYear) ───────────────────────
console.log('\nBuild — DARA=50000, lastYear=2060 (Future 30Y years)');
{
  const dara = 50000, lastYear = 2060;
  const { summary } = runBuild({ dara, lastYear, tipsMap, refCPI, settlementDate });
  assert('future30yYears.length > 0', (summary.future30yYears?.length ?? 0) > 0, true);
  assert('future30yLowerYear === 2056', summary.future30yLowerYear, 2056);
  assert('future30yUpperYear === 2052', summary.future30yUpperYear, 2052);
  assert('future30yLowerWeight + future30yUpperWeight ≈ 1',
    (summary.future30yLowerWeight ?? 0) + (summary.future30yUpperWeight ?? 0), 1, 0.0001);
  assert('avgDuration between lower and upper',
    summary.future30yParams?.avgDuration > summary.future30yLowerDuration &&
    summary.future30yParams?.avgDuration < summary.future30yUpperDuration, true);
  assert('future30yFellBack === false', summary.future30yFellBack, false);
  assert('totalBuyCost > 0', summary.totalBuyCost > 0, true);
  console.log(`        future30yYears:      ${JSON.stringify(summary.future30yYears)}`);
  console.log(`        d_lower(2056):       ${summary.future30yLowerDuration?.toFixed(4)}`);
  console.log(`        d_avg(Future 30Y):   ${summary.future30yParams?.avgDuration?.toFixed(4)}`);
  console.log(`        d_upper(2052):       ${summary.future30yUpperDuration?.toFixed(4)}`);
  console.log(`        weights 2056/2052:   ${summary.future30yLowerWeight?.toFixed(4)} / ${summary.future30yUpperWeight?.toFixed(4)}`);
  console.log(`        exQty  2056/2052:    ${summary.future30yLowerExQty} / ${summary.future30yUpperExQty}`);
  console.log(`        totalBuyCost:        ${Math.round(summary.totalBuyCost).toLocaleString()}`);
}

// ── Test: Build — firstYear=2036, lastYear=2056, preLadderInterest=true ───────
// Regression for bug: inflated prelim LMI in calcGapParams caused totalCost→0,
// collapsing bracket excess quantities to 0 even while gap breakdown showed non-zero.
console.log('\nBuild — firstYear=2036, lastYear=2056, preLadderInterest=true');
{
  const dara = 20000, firstYear = 2036, lastYear = 2056;
  const { summary, results, details } = runBuild({ dara, firstYear, lastYear, tipsMap, refCPI, settlementDate, preLadderInterest: true });
  const lower = results.find(r => r[2] === summary.lowerYear);
  const upper = results.find(r => r[2] === summary.upperYear);
  const lowerTotalQty = (lower?.[3] ?? 0) + (lower?.[4] ?? 0); // fundedYearQty + excessQty
  const upperTotalQty = (upper?.[3] ?? 0) + (upper?.[4] ?? 0);
  assert('gap totalCost > 0', (summary.gapParams?.totalCost ?? 0) > 0, true);
  assert('lowerExQty > 0', summary.lowerExQty > 0, true);
  assert('upperExQty > 0', summary.upperExQty > 0, true);
  assert('lower bracket total qty > 0', lowerTotalQty > 0, true);
  assert('upper bracket total qty > 0', upperTotalQty > 0, true);
  const numRungs = lastYear - firstYear + 1;
  const totalAmt = details.reduce((s, d) => s + (d.fundedYearAmt ?? 0) + (d.excessAmt ?? 0), 0);
  const avgAmt = totalAmt / numRungs;
  assert('avgAmt ≈ DARA with PLI (gap LMI included)', avgAmt, dara, 200);
  console.log(`        lowerYear: ${summary.lowerYear}, upperYear: ${summary.upperYear}`);
  console.log(`        lowerExQty: ${summary.lowerExQty}, upperExQty: ${summary.upperExQty}`);
  console.log(`        zeroedFundedYears: [${summary.zeroedFundedYears?.join(', ')}]`);
  console.log(`        gapTotalCost: ${Math.round(summary.gapParams?.totalCost ?? 0).toLocaleString()}`);
  console.log(`        avgAmt/rung:  ${Math.round(avgAmt).toLocaleString()} (DARA=${dara.toLocaleString()}, rungs=${numRungs})`);
}

// ── Test: Build→Rebalance symmetry ───────────────────────────────────────────
// Build(firstYear=2036, lastYear=2065, PLI, explicit DARA) → export CUSIP/qty
// → Rebalance with identical params → expect zero qty changes on every rung.
//
// Requires explicit DARA. Inferred DARA cannot guarantee symmetry: bracket
// excess P+I at 2036 inflates the inferred average above Build's DARA, and gap
// years 2037-2039 (no bonds) have ARA < DARA. The inferred value is diagnostic.
//
// Uses 2-bracket mode to expose any remaining algorithm differences. 3-bracket
// "freeze orig lower" would mask mismatches by pinning 2036 excess at its
// current holdings value regardless of gap-params accuracy.
console.log('\nBuild→Rebalance symmetry — firstYear=2036, lastYear=2065, PLI=true, DARA=40000');
{
  const DARA = 40000, firstYear = 2036, lastYear = 2065;

  // 1. Build
  const { details: buildDetails, summary: buildSummary } = runBuild({
    dara: DARA, firstYear, lastYear, tipsMap, refCPI, settlementDate,
    preLadderInterest: true,
  });

  // 2. Construct holdings (mirrors "Export CUSIP/Qty" button: fundedYearQty + excessQty)
  const holdings = buildDetails
    .map(d => ({ cusip: d.cusip, qty: d.fundedYearQty + d.excessQty }))
    .filter(h => h.qty > 0);

  // 3. Rebalance with identical params
  const { summary: rebalSummary, results: rebalResults } = runRebalance({
    dara: DARA,
    method: 'Gap',
    bracketMode: '2bracket',
    holdings,
    tipsMap,
    refCPI,
    settlementDate,
    preLadderInterest: true,
    firstYearOverride: firstYear,
    lastYearOverride: lastYear,
  });

  // 4. Assert: no qty changes on any rung
  const totalAbsQtyDelta = rebalResults.reduce((s, r) => s + Math.abs(r[9] ?? 0), 0);
  assert('Build→Rebalance: zero total |qtyDelta|', totalAbsQtyDelta, 0);
  assert('Build→Rebalance: zero net cash', Math.round(rebalSummary.costDeltaSum), 0);

  if (totalAbsQtyDelta > 0) {
    const changed = rebalResults.filter(r => (r[9] ?? 0) !== 0);
    for (const r of changed) {
      console.error(`        FY ${r[3]}  CUSIP ${r[0]}  before=${r[1]}  after=${r[8]}  delta=${r[9]}`);
    }
  }
  console.log(`        Build total cost:  ${Math.round(buildSummary.totalBuyCost).toLocaleString()}`);
  console.log(`        Rebal net cash:    ${Math.round(rebalSummary.costDeltaSum).toLocaleString()}`);
  console.log(`        Total |qtyDelta|:  ${totalAbsQtyDelta}`);
}

// ── Test: Build→Rebalance symmetry — Full method, default bracket mode ───────
// Same scenario as the Gap-method test above, but with method='Full'.
// 3-bracket is equivalent to 2-bracket here (firstYear=2036 = anchorBefore),
// but this test covers the Full-mode estimation path in calculateGapParameters.
console.log('\nBuild→Rebalance symmetry — firstYear=2036, lastYear=2065, PLI=true, DARA=40000, method=Full');
{
  const DARA = 40000, firstYear = 2036, lastYear = 2065;

  // 1. Build
  const { details: buildDetailsFull, summary: buildSummaryFull } = runBuild({
    dara: DARA, firstYear, lastYear, tipsMap, refCPI, settlementDate,
    preLadderInterest: true,
  });

  // 2. Holdings from build export
  const holdingsFull = buildDetailsFull
    .map(d => ({ cusip: d.cusip, qty: d.fundedYearQty + d.excessQty }))
    .filter(h => h.qty > 0);

  // 3. Rebalance with Full method
  const { summary: rebalSummaryFull, results: rebalResultsFull, details: rebalDetailsFull } = runRebalance({
    dara: DARA,
    method: 'Full',
    bracketMode: '3bracket',
    holdings: holdingsFull,
    tipsMap,
    refCPI,
    settlementDate,
    preLadderInterest: true,
    firstYearOverride: firstYear,
    lastYearOverride: lastYear,
  });

  const totalAbsQtyDeltaFull = rebalResultsFull.reduce((s, r) => s + Math.abs(r[9] ?? 0), 0);
  assert('Build→Rebalance Full: zero total |qtyDelta|', totalAbsQtyDeltaFull, 0);
  assert('Build→Rebalance Full: zero net cash', Math.round(rebalSummaryFull.costDeltaSum), 0);

  // Cover-year split: fundedYearQtyBefore must equal fundedYearQtyAfter (no phantom fy/cover trades)
  const coverYears = new Set([buildSummaryFull.future30yLowerYear, buildSummaryFull.future30yUpperYear].filter(Boolean));
  for (const d of (rebalDetailsFull ?? [])) {
    if (coverYears.has(d.fundedYear)) {
      assert(`FY ${d.fundedYear} cover-year funded split stable (before==after)`,
        d.fundedYearQtyBefore, d.fundedYearQtyAfter);
    }
  }

  if (totalAbsQtyDeltaFull > 0) {
    const changed = rebalResultsFull.filter(r => (r[9] ?? 0) !== 0);
    for (const r of changed) {
      console.error(`        FY ${r[3]}  CUSIP ${r[0]}  before=${r[1]}  after=${r[8]}  delta=${r[9]}`);
    }
  }
  console.log(`        Build total cost:  ${Math.round(buildSummaryFull.totalBuyCost).toLocaleString()}`);
  console.log(`        Rebal net cash:    ${Math.round(rebalSummaryFull.costDeltaSum).toLocaleString()}`);
  console.log(`        Total |qtyDelta|:  ${totalAbsQtyDeltaFull}`);
}

// ── Test: DARA inference from build CUSIP/qty output ─────────────────────────
// Build (firstYear=2035, lastYear=2064, PLI=true, DARA=40000) → export CUSIP/qty
// → Rebalance (firstYear=2036, lastYear=2065, PLI=true, dara=null).
// inferredDARA should land close to the build DARA (within ±500).
// If this fails it means the inference formula is broken, not the rebalance itself.
console.log('\nBuild→Rebalance DARA inference — firstYear=2035→2036, lastYear=2064→2065, PLI=true');
{
  const BUILD_DARA = 40000;

  // 1. Build
  const { details: inferBuildDetails } = runBuild({
    dara: BUILD_DARA,
    firstYear: 2035,
    lastYear: 2064,
    tipsMap, refCPI, settlementDate,
    preLadderInterest: true,
  });

  // 2. Export CUSIP/qty — mirror "Export CUSIP/Qty" button behaviour:
  //    include all rows (fundedYearQty + excessQty), including PLI-zeroed rows (qty=0).
  const inferHoldings = inferBuildDetails
    .map(d => ({ cusip: d.cusip, qty: d.fundedYearQty + d.excessQty }));

  // 3. Rebalance with no explicit DARA — shift to firstYear=2036, lastYear=2065
  const { summary: inferRebalSummary } = runRebalance({
    dara: null,
    method: 'Gap',
    bracketMode: '2bracket',
    holdings: inferHoldings,
    tipsMap, refCPI, settlementDate,
    preLadderInterest: true,
    firstYearOverride: 2036,
    lastYearOverride: 2065,
  });

  const inferred = inferRebalSummary.inferredDARA;
  assert('inferredDARA within 500 of build DARA (40000)',
    Math.abs(inferred - BUILD_DARA) <= 500, true);
  console.log(`        build DARA:      ${BUILD_DARA.toLocaleString()}`);
  console.log(`        inferredDARA:    ${Math.round(inferred).toLocaleString()}`);
  console.log(`        delta:           ${Math.round(inferred - BUILD_DARA).toLocaleString()}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

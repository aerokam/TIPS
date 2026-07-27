// Any refactor must produce identical output for all assertions here.

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import path from 'path';
import { buildTipsMapFromYields, localDate, runRebalance, runFundedRebalance, inferDARAFromCash, inferScaledDARAFromPortfolio, inferSegmentedDARAFromPortfolio, computePortfolioARAByYear, getGapYearBracketCandidates, getGapYears, derivePerYearDara, parseFundedYearDaraBlock, parseParamsBlock, inferFirstYearFromHoldings, inferLastYearFromHoldings } from '../src/rebalance-lib.js';
import { segmentRanges, constantMap, applySegmentMap } from '../src/segment-dara.js';
import { bracketWeights, bracketWeightsN } from '../src/gap-math.js';
import { runBuild } from '../src/build-lib.js';
import { parseBrokerCSV } from '../src/broker-import.js';
import { nextBondTradingDay, parseBondHolidays, lookupRefCpi } from '../src/data.js';
import { accruedInterest } from '../../shared/src/bond-math.js';

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

// Multi-format holdings parser — mirrors index.html logic for Formats 3, 4, 5.
// Formats 1/2 (broker CSV) tested separately via parseBrokerCSV below.
function parseHoldingsCSV(text, tipsMap) {
  const CUSIP_RE = /^[A-Z0-9]{9}$/i;
  const rawLines = text.trim().split('\n').filter(l => l.trim());
  if (!rawLines.length) return [];
  const firstLineLower = rawLines[0].replace(/\s/g, '').toLowerCase();
  const arr = [];

  if (firstLineLower === 'cusip,qty,excess') {
    // Format 5: header cusip,qty,excess — qty=fundedYearQty, excess=excessQty
    for (let i = 1; i < rawLines.length; i++) {
      const parts = rawLines[i].split(',').map(s => s.trim());
      if (parts.length < 2) continue;
      const [cusip, qtyStr] = parts;
      if (!CUSIP_RE.test(cusip)) continue;
      const fundedQty = parseInt(qtyStr, 10);
      if (isNaN(fundedQty) || fundedQty < 0) continue;
      const excessQty = parts.length >= 3 ? (parseInt(parts[2], 10) || 0) : 0;
      arr.push({ cusip, qty: fundedQty + excessQty, excessQty });
    }
  } else {
    const startIdx = CUSIP_RE.test(rawLines[0].split(',')[0].trim()) ? 0 : 1;
    const sampleParts = (rawLines[startIdx] ?? '').split(',').map(s => s.trim());
    const isFormat4 = sampleParts.length >= 3 && parseInt(sampleParts[2], 10) >= 2000;

    if (isFormat4) {
      // Format 4: no header, multi-row per CUSIP — year field classifies funded vs excess
      const cusipMap = new Map();
      for (const line of rawLines) {
        const parts = line.split(',').map(s => s.trim());
        if (parts.length < 3) continue;
        const [cusip, qtyStr, yearStr] = parts;
        if (!CUSIP_RE.test(cusip)) continue;
        const bond = tipsMap.get(cusip);
        if (!bond?.maturity) continue;
        const qty = parseInt(qtyStr, 10);
        const year = parseInt(yearStr, 10);
        if (isNaN(qty) || qty < 0 || isNaN(year)) continue;
        if (!cusipMap.has(cusip)) cusipMap.set(cusip, { fundedQty: 0, excessQty: 0 });
        const entry = cusipMap.get(cusip);
        if (year === bond.maturity.getFullYear()) entry.fundedQty += qty;
        else entry.excessQty += qty;
      }
      for (const [cusip, { fundedQty, excessQty }] of cusipMap) {
        const total = fundedQty + excessQty;
        if (total > 0) arr.push({ cusip, qty: total, excessQty });
      }
    } else {
      // Format 3: optional header cusip,qty — one row per CUSIP, no excess info
      for (let i = startIdx; i < rawLines.length; i++) {
        const parts = rawLines[i].split(',').map(s => s.trim());
        if (parts.length < 2) continue;
        const [cusip, qtyStr] = parts;
        if (!CUSIP_RE.test(cusip)) continue;
        const qty = parseInt(qtyStr, 10);
        if (!isNaN(qty) && qty >= 0) arr.push({ cusip, qty });
      }
    }
  }
  return arr;
}

// Keep old name as alias for callers that don't need tipsMap (Format 3 files only)
function parseHoldings(text) { return parseHoldingsCSV(text, tipsMap); }

// ── Load shared data ──────────────────────────────────────────────────────────
const yieldsPath = path.resolve('tests/e2e/YieldsFromFedInvestPrices.csv');
const refCpiPath = path.resolve('tests/e2e/RefCPI.csv');

console.log(`[Test Setup] Market Data:   ${yieldsPath}`);
// YieldsFromFedInvestPrices.csv: row 1 = settlement date (ignored), row 2 = header, rows 3+ = data
// Settlement date is always computed from today's date so excluded-bond behavior matches reality.
const yieldsText = readFileSync(yieldsPath, 'utf8');
const yieldsLines = yieldsText.trim().split('\n');

const holidayPath = path.resolve('tests/e2e/BondHolidaysSifma.csv');
const bondHolidays = parseBondHolidays(readFileSync(holidayPath, 'utf8'));
const _now = new Date();
const _todayISO = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
const settleDateStr = nextBondTradingDay(_todayISO, bondHolidays);

const yieldsRows = parseCsv(yieldsLines.slice(1).join('\n')).map(r => ({
  settlementDate: settleDateStr,
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

const settlementDate = localDate(settleDateStr);
console.log(`[Test Setup] Settlement:    ${settleDateStr} (T+1 from today ${_todayISO})`);
const tipsMap = buildTipsMapFromYields(yieldsRows);
const refCPI = lookupRefCpi(refCpiRows, settleDateStr);
if (refCPI == null) {
  const last = refCpiRows.length ? refCpiRows[refCpiRows.length - 1].date : '(none)';
  throw new Error(
    `RefCPI fixture is stale: settlement ${settleDateStr} is beyond the last fixture date ${last}. ` +
    `Refresh tests/e2e/RefCPI.csv from R2 (production keeps RefCPI through the last day of m+2). ` +
    `Exact-date lookup intentionally returns null beyond range — there is no snap-back.`
  );
}

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

// computePortfolioARAByYear / getGapYearBracketCandidates / derivePerYearDara are imported
// from rebalance-lib.js (single source of truth — the same code the app runs on import).

// ── Helper: assert no simultaneous buy+sell on the same TIPS at any bracket year ─
// Checks the ACTUAL trade quantities (fundedYearQtyDelta/excessQtyDelta) — the honest
// Before figures (fundedYearQtyBefore/excessQtyBefore) legitimately differ from the After
// targets on their own; that's exactly what the internal reallocation (3.0 §Named
// Quantities) exists to net out before a trade is sized, so it's the delta fields, not a
// naive Before/After subtraction, that must never disagree in sign.

// Blend and weight-sum across every lower-side leg a rebalance produced: all retained maturities
// (any number), the latest 10Y, and the upper bracket. Using summary.origLowerWeight alone was only
// ever right when exactly one leg was retained.
function legBlend(s) {
  const legs = s.retainedLegs ?? [];
  return legs.reduce((acc, l) => acc + l.weight * l.duration, 0)
    + (s.latest10yWeight3 ?? 0) * s.newLowerDuration
    + (s.upperWeight ?? 0) * s.upperDuration;
}
function legWeightSum(s) {
  const legs = s.retainedLegs ?? [];
  return legs.reduce((acc, l) => acc + l.weight, 0) + (s.latest10yWeight3 ?? 0) + (s.upperWeight ?? 0);
}
function assertNoBuySell(details, label) {
  const violations = details.filter(d => {
    if (!d.isBracketTarget) return false;
    const fDelta = d.fundedYearQtyDelta ?? 0;
    const eDelta = d.excessQtyDelta ?? 0;
    return (fDelta > 0 && eDelta < 0) || (fDelta < 0 && eDelta > 0);
  });
  assert(`${label}: no simultaneous buy+sell at any bracket year`, violations.length, 0);
  for (const v of violations) {
    console.error(`        violation FY ${v.fundedYear}: fundedDelta=${v.fundedYearQtyDelta} excessDelta=${v.excessQtyDelta}`);
  }
}

// ── Helper: assert Before + Delta === After for every row, funded and excess bucket
// alike. Guards the reallocation math (3.0 §Named Quantities) — a wrong reallocFundedBefore/
// reallocExcessBefore basis can leave the delta fields internally consistent while silently
// disagreeing with the Before/After figures shown in the table.
function assertReconciles(details, label) {
  const violations = details.filter(d =>
    Math.round((d.fundedYearQtyBefore ?? 0) + (d.fundedYearQtyDelta ?? 0)) !== Math.round(d.fundedYearQtyAfter ?? 0) ||
    Math.round((d.excessQtyBefore ?? 0) + (d.excessQtyDelta ?? 0)) !== Math.round(d.excessQtyAfter ?? 0)
  );
  assert(`${label}: Before + Delta === After for every row`, violations.length, 0);
  for (const v of violations) {
    console.error(`        violation ${v.cusip} FY ${v.fundedYear}: funded ${v.fundedYearQtyBefore}+${v.fundedYearQtyDelta}!=${v.fundedYearQtyAfter}, excess ${v.excessQtyBefore}+${v.excessQtyDelta}!=${v.excessQtyAfter}`);
  }
}

// ── Helper: Run Full Rebalance on a holdings file (per-year ARA path) ────────
function runFullRebalanceTest(name, filePath) {
  const fullPath = path.resolve(filePath);
  if (!existsSync(fullPath)) return;

  console.log(`\n${name} — Full rebalance (per-year ARA path)`);
  console.log(`  Input: ${fullPath}`);

  const holdings = parseHoldings(readFileSync(fullPath, 'utf8'));
  const rawARA = computePortfolioARAByYear(holdings, tipsMap, refCPI);
  const bracketCandidates = getGapYearBracketCandidates(tipsMap);
  const { daraMap } = derivePerYearDara(rawARA, bracketCandidates);
  const { scaledMap, scaledMedian } = inferScaledDARAFromPortfolio({
    daraMap, holdings, tipsMap, refCPI, settlementDate,
  });
  const { summary, details } = runRebalance({
    dara: scaledMedian, holdings, tipsMap, refCPI, settlementDate,
    daraByYear: scaledMap,
  });

  // Net cash must be small and non-negative — portfolio is self-financing.
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
  assertNoBuySell(details, name);
  assertReconciles(details, name);
  console.log(`        scaled DARA:   ${Math.round(scaledMedian).toLocaleString()}`);
  console.log(`        net cash:      ${Math.round(netCash).toLocaleString()}`);
  console.log(`        surplus check: ${Math.round(summary.gapCoverageSurplus).toLocaleString()}`);
}

// ── Run tests on known files and local dev files ──────────────────────────────

// 1. Sample holdings (Format 3 — derived from real Schwab data, generated by scripts/generate-test-fixtures.js)
runFullRebalanceTest('SampleHoldings (richest IRA)', './data/SampleHoldings.csv');

// 2. Regression: portfolio with no 2040+ bonds — lastYear must stop at 2035, not extend to 2045
//    (Bug: lastYear derivation incorrectly reached into >2040 holdings when 2040 not held,
//     causing spurious gap/bracket rows and rebuilding 2045/2051 as funded rungs.)
//    Uses Owner8_IRA 2031-2035 bonds (far from maturity, stable for years).
{
  console.log('\nIRA 2031-2035 — lastYear regression (no 2040+ in holdings)');
  const holdingsCsv = [
    'cusip,qty',
    '91282CBF7,6',   // Jan 2031
    '91282CCM1,9',   // Jul 2031
    '91282CDX6,7',   // Jan 2032
    '91282CEZ0,9',   // Jul 2032
    '91282CGK1,10',  // Jan 2033
    '91282CHP9,7',   // Jul 2033
    '91282CJY8,30',  // Jan 2034
    '91282CML2,14',  // Jan 2035
    '91282CNS6,4',   // Jul 2035
  ].join('\n');
  const holdings = parseHoldings(holdingsCsv);
  const rawARA2 = computePortfolioARAByYear(holdings, tipsMap, refCPI);
  const bc2 = getGapYearBracketCandidates(tipsMap);
  const { daraMap: daraMap2 } = derivePerYearDara(rawARA2, bc2);
  const { scaledMap: sMap2, scaledMedian: sDara2 } = inferScaledDARAFromPortfolio({ daraMap: daraMap2, holdings, tipsMap, refCPI, settlementDate });
  const { summary, details } = runRebalance({ dara: sDara2, holdings, tipsMap, refCPI, settlementDate, daraByYear: sMap2 });

  assert('lastYear === 2035',   summary.lastYear, 2035);
  assert('no 2040 funded rung', details.some(d => d.fundedYear === 2040), false);
  // Key regression: long-tier bonds beyond lastYear must NOT be rebuilt
  const d2045 = details.find(d => d.cusip === '912810RL4');
  const d2051 = details.find(d => d.cusip === '912810SV1');
  const delta2045 = d2045 ? (d2045.qtyAfter - d2045.qtyBefore) : 0;
  const delta2051 = d2051 ? (d2051.qtyAfter - d2051.qtyBefore) : 0;
  assert('2045 not rebuilt (qtyDelta 0 or absent)', delta2045, 0);
  assert('2051 not rebuilt (qtyDelta 0 or absent)', delta2051, 0);
  console.log(`        lastYear:      ${summary.lastYear}`);
  console.log(`        rungCount:     ${summary.rungCount}`);
  console.log(`        scaledDARA:    ${Math.round(sDara2).toLocaleString()}`);
  console.log(`        netCash:       ${Math.round(summary.costDeltaSum).toLocaleString()}`);
}

// ── Test: Format 4 parsing (TipsLadderCom — no header, multi-row per CUSIP) ──
{
  const filePath = path.resolve('./tests/dev/TipsLadderCom.csv');
  if (existsSync(filePath)) {
    console.log('\nFormat 4 (TipsLadderCom) — parsing + 3-bracket validation');
    const holdings = parseHoldingsCSV(readFileSync(filePath, 'utf8'), tipsMap);

    // Verify funded/excess split: CPU9 (Jan 2036) = 8 funded + (6+4+2)=12 excess
    const cpu9 = holdings.find(h => h.cusip === '91282CPU9');
    assert('F4: CPU9 total qty === 20',    cpu9?.qty,       20);
    assert('F4: CPU9 excessQty === 12',   cpu9?.excessQty, 12);

    // QF8 (Feb 2040) = 5 funded + (1+3+4)=8 excess
    const qf8 = holdings.find(h => h.cusip === '912810QF8');
    assert('F4: QF8 total qty === 13',    qf8?.qty,       13);
    assert('F4: QF8 excessQty === 8',     qf8?.excessQty,  8);

    // Non-bracket CUSIPs have no excess (single row each)
    const cfr7 = holdings.find(h => h.cusip === '91282CFR7');
    assert('F4: CFR7 excessQty === 0',    cfr7?.excessQty ?? 0, 0);

    // Run rebalance — excessQtyBefore uses funded-first rule (LMI formula), not h.excessQty
    const dara = 20000;
    const { summary, details } = runRebalance({ dara, bracketMode: '3bracket', holdings, tipsMap, refCPI, settlementDate });

    assert('F4: origLower IS Jan 2036', summary.brackets.lowerCUSIP === '91282CPU9', true);
    // When orig lower == new lower (both Jan 2036), 3-bracket falls back to 2-bracket.
    // newLowerCUSIP is null; the standard 2-bracket weights apply.
    assert('F4: newLowerCUSIP null (fell back to 2-bracket)', summary.newLowerCUSIP, null);
    assert('F4: origLowerWeight is null (2-bracket path)',    summary.origLowerWeight, null);

    const jan2036 = details.find(d => d.cusip === '91282CPU9' && d.isBracketTarget);
    // Format 4 has explicit excessQty=12 — the import value is used for the funded/excess split.
    assert('F4: CPU9 excessQtyBefore === 12', jan2036?.excessQtyBefore, 12);
    assert('F4: CPU9 fundedYearQtyBefore === 8', jan2036?.fundedYearQtyBefore, 8);
    console.log(`        CPU9 before:   funded=${jan2036?.fundedYearQtyBefore} excess=${jan2036?.excessQtyBefore}`);
    console.log(`        QF8 total:     ${qf8?.qty}  excess=${qf8?.excessQty}`);
  }
}

// ── Test: 3-bracket real-holdings reconciliation (distinct orig-lower/new-lower) ──
// Regression for a bug where a bracket year's honest Before split (fundedYearQtyBefore/
// excessQtyBefore) legitimately differs from its After target — the normal case whenever
// OTHER years' rebalancing shifts the LMI cascade feeding this year — but the trade-sizing
// reallocation (reallocFundedBefore/reallocExcessBefore) was computed from a different basis
// (After target vs. total held) than the displayed Before split, so Before + Delta != After
// per bucket even though the row-level total reconciled. Holdings below are a real IRA's
// CUSIP/qty (no account/PII data) that exercises a genuine 3-bracket split (distinct 2034
// orig-lower / 2036 new-lower), which the round-trip-only fixtures above never exercise.
console.log('\n3-bracket real-holdings reconciliation (distinct orig-lower/new-lower)');
{
  const holdings = [
    { cusip: '912810QF8', qty: 168 }, { cusip: '912810QP6', qty: 50 }, { cusip: '912810QV3', qty: 65 },
    { cusip: '912810RA8', qty: 68 }, { cusip: '912810RF7', qty: 82 }, { cusip: '912810RL4', qty: 83 },
    { cusip: '912810RR1', qty: 84 }, { cusip: '912810RW0', qty: 87 }, { cusip: '912810SB5', qty: 20 },
    { cusip: '912810SG4', qty: 15 }, { cusip: '912810SM1', qty: 76 }, { cusip: '912810SV1', qty: 30 },
    { cusip: '912810TE8', qty: 21 }, { cusip: '912810TP3', qty: 12 }, { cusip: '912810TY4', qty: 20 },
    { cusip: '912810UH9', qty: 16 }, { cusip: '9128283R9', qty: 10 }, { cusip: '9128285W6', qty: 20 },
    { cusip: '9128287D6', qty: 26 }, { cusip: '912828V49', qty: 10 }, { cusip: '912828Y38', qty: 9 },
    { cusip: '912828Z37', qty: 21 }, { cusip: '912828ZZ6', qty: 44 }, { cusip: '91282CBF7', qty: 28 },
    { cusip: '91282CCM1', qty: 46 }, { cusip: '91282CDC2', qty: 70 }, { cusip: '91282CDX6', qty: 34 },
    { cusip: '91282CEJ6', qty: 20 }, { cusip: '91282CEZ0', qty: 47 }, { cusip: '91282CFR7', qty: 10 },
    { cusip: '91282CGK1', qty: 52 }, { cusip: '91282CGW5', qty: 23 }, { cusip: '91282CHP9', qty: 36 },
    { cusip: '91282CJH5', qty: 30 }, { cusip: '91282CJY8', qty: 152 }, { cusip: '91282CKL4', qty: 22 },
    { cusip: '91282CML2', qty: 70 }, { cusip: '91282CNS6', qty: 19 }, { cusip: '91282CPU9', qty: 113 },
  ].filter(h => tipsMap.has(h.cusip));

  if (holdings.length > 0) {
    const { dara } = inferDARAFromCash({ bracketMode: '3bracket', holdings, tipsMap, refCPI, settlementDate });
    const { details, summary } = runRebalance({ dara, bracketMode: '3bracket', holdings, tipsMap, refCPI, settlementDate });

    assert('3B real: genuine 3-bracket (newLowerCUSIP present)', summary.newLowerCUSIP != null, true);

    // THE invariant that was missing: with a retained (orig lower) maturity held, the
    // cost-weighted duration across ALL THREE legs must equal the gap block's average.
    // Before the bracketWeightsN fix the retained leg was priced at the latest 10Y's
    // duration, so this landed short and nothing noticed. Spec 2.0 §Retained Bracket Excess.
    {
      const blend = legBlend(summary);
      const wSum  = legWeightSum(summary);
      assert('3B real: bracket weights sum to 1 across all three legs', wSum, 1, 1e-9);
      assert('3B real: realized duration matches the gap block average', blend, summary.gapParams.avgDuration, 1e-6);
      console.log('        legs: ' + (summary.retainedLegs ?? []).map(l => 'FY' + l.year + ' ' + l.weight.toFixed(4) + '@' + l.duration.toFixed(3)).join(' | ')
        + (summary.retainedLegs?.length ? ' | ' : '') + 'latest10Y ' + (summary.latest10yWeight3 ?? 0).toFixed(4) + '@' + summary.newLowerDuration.toFixed(3)
        + ' | upper ' + (summary.upperWeight ?? 0).toFixed(4) + '@' + summary.upperDuration.toFixed(3));
      console.log('        blend ' + blend.toFixed(6) + '  vs dGap ' + summary.gapParams.avgDuration.toFixed(6));
    }

    // The fixture above holds NO excess in the older lower maturity, so its retained weight is
    // 0 and the invariant holds trivially. This portfolio's 2034 also carries far MORE excess
    // than the gap block needs, so old and new code alike just sell it down — the over-allocated
    // regime, where the bug is invisible. It bites in the UNDER-allocated regime: a retained leg
    // small enough to be kept and frozen, whose shorter duration then has to be compensated for.
    // Size one to about a quarter of the block and rebuild the holding around it.
    {
      const olCusip   = summary.brackets.lowerCUSIP;
      const olRow     = details.find(d => d.cusip === olCusip);
      const olFyQty   = olRow?.fundedYearQtyBefore ?? 0;
      const olCpb     = olRow?.costPerBond ?? 0;
      const retainQty = Math.max(1, Math.round(0.25 * summary.gapParams.totalCost / olCpb));
      const fat = holdings.map(h => h.cusip === olCusip ? { ...h, qty: olFyQty + retainQty } : h);
      // EMIT_FIXTURE=1 writes this exact portfolio out as a loadable holdings file, so the
      // retained-excess case can be inspected by hand in the app rather than only in tests.
      if (process.env.EMIT_FIXTURE) {
        writeFileSync('data/RetainedBracketExcess.csv',
          ['cusip,qty', ...fat.map(h => h.cusip + ',' + h.qty)].join(String.fromCharCode(10)) + String.fromCharCode(10));
        console.log('        WROTE data/RetainedBracketExcess.csv  retained=' + olCusip +
          ' FY' + summary.brackets.lowerYear + ' qty=' + (olFyQty + retainQty) +
          ' (funded ' + olFyQty + ' + excess ' + retainQty + ')  latest10Y=' + summary.newLowerCUSIP +
          ' FY' + summary.newLowerYear + '  DARA=' + Math.round(dara));
      }
      // Hold DARA at the base run's level: re-inferring would raise the target and absorb the
      // retained bonds as funded-year quantity instead of excess.
      const { summary: s2, details: dt2 } = runRebalance({ dara, bracketMode: '3bracket', holdings: fat, tipsMap, refCPI, settlementDate });

      assert('3B retained: retained leg actually carries excess',
        (s2.retainedLegs ?? []).some(l => l.weight > 0), true);
      const blend2 = legBlend(s2);
      assert('3B retained: weights sum to 1', legWeightSum(s2), 1, 1e-9);
      assert('3B retained: realized duration matches the gap block average',
        blend2, s2.gapParams.avgDuration, 1e-6);

      // What the pre-fix code would have produced on this same portfolio: retained dollars
      // priced at the latest 10Y's duration, upper weight never recompensated.
      const old = bracketWeights(s2.newLowerDuration, s2.upperDuration, s2.gapParams.avgDuration);
      const wRet = (s2.retainedLegs ?? []).reduce((a, l) => a + l.weight, 0);
      const dRet = wRet > 0 ? (s2.retainedLegs ?? []).reduce((a, l) => a + l.weight * l.duration, 0) / wRet : 0;
      const oldBlend = wRet * dRet
                     + Math.max(0, old.lowerWeight - wRet) * s2.newLowerDuration
                     + old.upperWeight * s2.upperDuration;
      assert('3B retained: pre-fix treatment really did under-match this portfolio',
        oldBlend < s2.gapParams.avgDuration - 1e-4, true);
      console.log('        retained ' + wRet.toFixed(4) + '@' + dRet.toFixed(3)
        + '  active ' + (s2.latest10yWeight3 ?? 0).toFixed(4) + '@' + s2.newLowerDuration.toFixed(3)
        + '  upper ' + (s2.upperWeight ?? 0).toFixed(4) + '@' + s2.upperDuration.toFixed(3));
      console.log('        fixed blend ' + blend2.toFixed(6) + '   pre-fix blend ' + oldBlend.toFixed(6)
        + '   dGap ' + s2.gapParams.avgDuration.toFixed(6)
        + '   (pre-fix short by ' + (s2.gapParams.avgDuration - oldBlend).toFixed(4) + ' yrs)');
      // Multiple retained legs is the point: 2034 and 2035 both carrying excess alongside the
      // 2036 latest 10Y. Identification used to return exactly one, so the others silently lost
      // their excess to the ordinary sweep and never entered the duration match.
      const legs2 = (s2.retainedLegs ?? []).filter(l => l.weight > 0);
      assert('3B retained: more than one retained leg carries weight', legs2.length > 1, true);
      assert('3B retained: legs span at least two maturity years',
        new Set(legs2.map(l => l.year)).size > 1, true);
      assert('3B retained: legs are ordered oldest first',
        legs2.every((l, i) => i === 0 || l.year >= legs2[i-1].year), true);
      console.log('        retained legs: ' + legs2.map(l => 'FY' + l.year + ' ' + l.weight.toFixed(4)).join('  '));

      assertNoBuySell(dt2, '3B retained');
      assertReconciles(dt2, '3B retained');
    }
    assertNoBuySell(details, '3B real');
    assertReconciles(details, '3B real');

    // Regression: a custom per-year DARA plan (as "Apply saved DARA plan" installs) can legitimately
    // push a bracket year's funded target down while its excess target goes up — the funded and excess
    // naive deltas then point in OPPOSITE directions for the SAME held CUSIP. This is exactly the case
    // the reallocation exists for: display must show "before" as already relabeled (no phantom funded
    // trade) with the whole change landing on excess, not a same-maturity buy+sell. Verify the
    // reallocation branch actually fires here (not a vacuous same-direction case).
    const rawARA = computePortfolioARAByYear(holdings, tipsMap, refCPI);
    const bracketCandidates = getGapYearBracketCandidates(tipsMap);
    const { daraMap } = derivePerYearDara(rawARA, bracketCandidates);
    const { scaledMap, scaledMedian } = inferScaledDARAFromPortfolio({ daraMap, holdings, tipsMap, refCPI, settlementDate, bracketMode: '3bracket' });
    const customDara = new Map(scaledMap);
    customDara.set(2036, Math.round((customDara.get(2036) ?? scaledMedian) * 0.8));
    const { details: details2 } = runRebalance({ dara: scaledMedian, bracketMode: '3bracket', holdings, tipsMap, refCPI, settlementDate, daraByYear: customDara });
    const d2036 = details2.find(d => d.fundedYear === 2036 && d.isBracketTarget);
    assert('3B real (custom plan): 2036 bracket row present', d2036 != null, true);
    // Signature of the reallocation branch actually firing: the funded side fully absorbs into the
    // reallocated Before (delta 0) while the whole real trade lands on excess — matches the reported
    // case (funded shown 90->89 with no realloc would have been a phantom -1; correctly shows 0 here).
    assert('3B real (custom plan): 2036 exercises the reallocation branch (funded delta 0, excess absorbs the trade)',
      d2036 != null && d2036.fundedYearQtyDelta === 0 && d2036.excessQtyDelta !== 0, true);
    assertNoBuySell(details2, '3B real (custom plan)');
    assertReconciles(details2, '3B real (custom plan)');
  }
}

// ── Test: Format 5 parsing (cusip,qty,excess header) ─────────────────────────
{
  console.log('\nFormat 5 (inline) — parsing: header detection + excessQty');
  const csv5 = [
    'cusip,qty,excess',
    '91282CPU9,0,33',    // all excess (PLI-zeroed funded)
    '912810QF8,19,24',   // funded + excess
    '912810QP6,20,0',    // funded only
    '912810QV3,21,0',
  ].join('\n');
  const h5 = parseHoldingsCSV(csv5, tipsMap);

  const cpu9_5 = h5.find(h => h.cusip === '91282CPU9');
  assert('F5: CPU9 total qty === 33',   cpu9_5?.qty,       33);
  assert('F5: CPU9 excessQty === 33',   cpu9_5?.excessQty, 33);

  const qf8_5 = h5.find(h => h.cusip === '912810QF8');
  assert('F5: QF8 total qty === 43',    qf8_5?.qty,        43);
  assert('F5: QF8 excessQty === 24',    qf8_5?.excessQty,  24);

  const qp6_5 = h5.find(h => h.cusip === '912810QP6');
  assert('F5: QP6 total qty === 20',    qp6_5?.qty,        20);
  assert('F5: QP6 excessQty === 0',     qp6_5?.excessQty,  0);
}

// ── Test: Format 5 from file (tests/dev/CusipQtyExcess.csv) ─────────────────
{
  const filePath = path.resolve('./tests/dev/CusipQtyExcess.csv');
  if (existsSync(filePath)) {
    console.log('\nFormat 5 (CusipQtyExcess.csv) — file-based parsing + rebalance');
    const holdings = parseHoldingsCSV(readFileSync(filePath, 'utf8'), tipsMap);

    // Every row must produce a valid excessQty (not undefined)
    const missingExcess = holdings.filter(h => h.excessQty == null);
    assert('F5 file: all rows have excessQty', missingExcess.length, 0);

    // Run a full rebalance and verify excessQtyBefore is non-zero for bracket targets
    const { dara } = inferDARAFromCash({ holdings, tipsMap, refCPI, settlementDate });
    const { summary, details } = runRebalance({ dara, holdings, tipsMap, refCPI, settlementDate });
    const bracketTargets = details.filter(d => d.isBracketTarget);
    const hasImportedExcess = bracketTargets.some(d => d.excessQtyBefore > 0);
    assert('F5 file: bracket excessQtyBefore > 0 (from import or LMI fallback)', hasImportedExcess, true);
    console.log(`        bracket rows:  ${bracketTargets.length}`);
    for (const d of bracketTargets) {
      console.log(`        FY ${d.fundedYear}  exBefore=${d.excessQtyBefore}  exAfter=${d.excessQtyAfter}`);
    }
  }
}

// ── Test: Format 1 (Fidelity) — inline fixture ───────────────────────────────
{
  console.log('\nFormat 1 (Fidelity) — broker import parsing');
  const csv1 = [
    'Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Type',
    'X11111111,Owner8 IRA,91282CPU9,TIPS 0.125% 01/15/2031,5000,$100.00,$500000,Cash',
    'X11111111,Owner8 IRA,912810QF8,TIPS 0.25% 02/15/2040,8000,$100.00,$800000,Cash',
    'X11111111,Owner8 IRA,FDLXX,FIDELITY MONEY MARKET,1234.56,$1.00,$1234.56,Cash',
    'X22222222,Owner2 IRA,91282CPU9,TIPS 0.125% 01/15/2031,3000,$100.00,$300000,Cash',
    'X22222222,Owner2 IRA,VTI,VANGUARD TOTAL STOCK,50,$200.00,$10000,Cash',
  ].join('\n');
  const { holdings, tipsValues, totalAccountValues } = parseBrokerCSV(csv1, tipsMap);
  const accounts = holdings;

  assert('F1: Owner8 IRA has 2 TIPS', accounts['Owner8 IRA']?.length, 2);
  const cpu9 = accounts['Owner8 IRA']?.find(h => h.cusip === '91282CPU9');
  assert('F1: CPU9 qty === 5', cpu9?.qty, 5);
  const qf8 = accounts['Owner8 IRA']?.find(h => h.cusip === '912810QF8');
  assert('F1: QF8 qty === 8', qf8?.qty, 8);
  assert('F1: FDLXX filtered out', accounts['Owner8 IRA']?.find(h => h.cusip === 'FDLXX'), undefined);
  assert('F1: Owner2 IRA CPU9 qty === 3', accounts['Owner2 IRA']?.find(h => h.cusip === '91282CPU9')?.qty, 3);
  assert('F1: VTI filtered out', accounts['Owner2 IRA']?.find(h => h.cusip === 'VTI'), undefined);
  console.log(`        accounts: ${Object.keys(accounts).join(', ')}`);
}

// ── Test: Format 2 (Schwab) — inline fixture ─────────────────────────────────
{
  console.log('\nFormat 2 (Schwab) — broker import parsing');
  const csv2 = [
    '"Positions for All-Accounts as of 10:00 AM ET, 04/26/2026"',
    '',
    '"Owner8 IRA ...1234"',
    '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Asset Type"',
    '"91282CPU9","TIPS 0.125% 01/15/2031","5,000","100.00","$500,000.00","Fixed Income"',
    '"912810QF8","TIPS 0.25% 02/15/2040","8,000","100.00","$800,000.00","Fixed Income"',
    '"SCHZ","SCHWAB AGG BOND ETF","100","50.00","$5,000.00","ETFs"',
    '"Account Total","","","","$1,305,000.00",""',
    '',
    '"Owner2 IRA ...5678"',
    '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Asset Type"',
    '"91282CPU9","TIPS 0.125% 01/15/2031","3,000","100.00","$300,000.00","Fixed Income"',
    '"Account Total","","","","$300,000.00",""',
  ].join('\n');
  const { holdings, tipsValues, totalAccountValues } = parseBrokerCSV(csv2, tipsMap);
  const accounts = holdings;

  assert('F2: Owner8 IRA has 2 TIPS', accounts['Owner8 IRA']?.length, 2);
  const cpu9 = accounts['Owner8 IRA']?.find(h => h.cusip === '91282CPU9');
  assert('F2: CPU9 qty === 5 (comma-qty parsed)', cpu9?.qty, 5);
  const qf8 = accounts['Owner8 IRA']?.find(h => h.cusip === '912810QF8');
  assert('F2: QF8 qty === 8', qf8?.qty, 8);
  assert('F2: SCHZ filtered out', accounts['Owner8 IRA']?.find(h => h.cusip === 'SCHZ'), undefined);
  assert('F2: Owner2 IRA CPU9 qty === 3', accounts['Owner2 IRA']?.find(h => h.cusip === '91282CPU9')?.qty, 3);
  console.log(`        accounts: ${Object.keys(accounts).join(', ')}`);
}

// ── Test: Format 3 (Vanguard) — broker import parsing ────────────────────────
{
  console.log('\nFormat 3 (Vanguard) — broker import parsing');
  // Uses real CUSIPs from test data: 91282CPU9 (1.875% Jan 2036), 912810QF8 (2.125% Feb 2040)
  const csv3 = [
    'Account Number,Investment Name,Symbol,Shares,Share Price,Total Value,',
    '11111111,U S TREASURY NOTE INFLATION INDEX NOTE 1.875 01/15/36 01/15/06,null,5000,100.00,500000.00,',
    '11111111,U S TREASURY NOTE INFLATION INDEX NOTE 2.125 02/15/40 02/15/10,null,8000,100.00,800000.00,',
    '11111111,VANGUARD FEDERAL MONEY MARKET INVESTOR CL,VMFXX,1234.56,1,1234.56,',
    '22222222,U S TREASURY NOTE INFLATION INDEX NOTE 1.875 01/15/36 01/15/06,null,3000,100.00,300000.00,',
    '22222222,VANGUARD TOTAL STOCK MARKET ETF,VTI,50,200.00,10000.00,',
  ].join('\n');
  const { holdings, tipsValues, totalAccountValues } = parseBrokerCSV(csv3, tipsMap);
  const accounts = holdings;

  assert('F3: acct 11111111 has 2 TIPS', accounts['11111111']?.length, 2);
  const cpu9 = accounts['11111111']?.find(h => h.cusip === '91282CPU9');
  assert('F3: CPU9 qty === 5 (name-resolved)', cpu9?.qty, 5);
  const qf8 = accounts['11111111']?.find(h => h.cusip === '912810QF8');
  assert('F3: QF8 qty === 8 (name-resolved)', qf8?.qty, 8);
  assert('F3: VMFXX filtered out', accounts['11111111']?.find(h => h.cusip === 'VMFXX'), undefined);
  assert('F3: acct 22222222 CPU9 qty === 3', accounts['22222222']?.find(h => h.cusip === '91282CPU9')?.qty, 3);
  assert('F3: VTI filtered out', accounts['22222222']?.find(h => h.cusip === 'VTI'), undefined);
  assert('F3: tipsValues 11111111 ≈ 1300000', Math.abs((tipsValues['11111111'] || 0) - 1300000) < 1, true);
  assert('F3: totalAccountValues 11111111 > tipsValues', totalAccountValues['11111111'] > tipsValues['11111111'], true);
  console.log(`        accounts: ${Object.keys(accounts).join(', ')}`);
}

// ── Test: Format 3 (Vanguard) — whole-number coupon (no decimal point) ───────
{
  console.log('\nFormat 3 (Vanguard) — whole-number coupon name parsing');
  // Real bug: Vanguard prints exact 1.000% coupons as bare "1" (no decimal point at all),
  // same way it prints sub-1% coupons as ".125" (no leading zero, fixed in a80ddba).
  // 912810SB5 (Feb 2048) and 912810SG4 (Feb 2049) both carry a 1.000% coupon — the old
  // regex `(\d*\.\d+)` required a decimal point and silently dropped both.
  const csv3b = [
    'Account Number,Investment Name,Symbol,Shares,Share Price,Total Value,',
    '11111111,U S TREASURY NOTE INFLATION INDEX NOTE 1 02/15/48 02/15/18,null,50000,74.125,37062.50,',
    '11111111,U S TREASURY NOTE INFLATION INDEX NOTE 1 02/15/49 02/15/19,null,60000,73.0625,43837.50,',
  ].join('\n');
  const { holdings: holdings3b } = parseBrokerCSV(csv3b, tipsMap);
  const sb5 = holdings3b['11111111']?.find(h => h.cusip === '912810SB5');
  const sg4 = holdings3b['11111111']?.find(h => h.cusip === '912810SG4');
  assert('F3b: SB5 (Feb 2048, 1.000% coupon) qty === 50 (name-resolved)', sb5?.qty, 50);
  assert('F3b: SG4 (Feb 2049, 1.000% coupon) qty === 60 (name-resolved)', sg4?.qty, 60);
}

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
  // Tolerance is a flat dollar figure, not a % of DARA: TIPS trade in whole $1,000-face
  // increments, so each rung's amount can land up to ~half a bond's adjusted-price value
  // (price/100 x indexRatio x 1,000, roughly $1,000-1,400) off its target; the 2040
  // upper-excess-coupon fixpoint (View A, gap-math gapParamsWithUpperFeedback) adds a
  // further systematic residual on top. 700 matches the per-rung tolerance used elsewhere
  // in this file (see "amount ≈ DARA @${y}" below) for the same whole-bond-rounding reason.
  assert('avgAmt ≈ DARA (gap LMI included)', avgAmt, dara, 700);
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

// ── Test: Rev 6 — cover Amount = N×DARA, AMD net-out, roll coupon hand-off ─────────
console.log('\nBuild — Rev 6 cover Amount + roll coupon, DARA=40000, lastYear=2066');
{
  const dara = 40000, lastYear = 2066, firstYear = settlementDate.getFullYear();
  const { summary, details } = runBuild({ dara, lastYear, tipsMap, refCPI, settlementDate });
  const cover = details.filter(d => d.isFuture30yCover);
  const coverAmt = cover.reduce((s, d) => s + (d.excessAmt ?? 0), 0);
  const nFuture = summary.future30yYears.length;
  // 6a: cover Amount totals ≈ numFuture30yYears × DARA (was par-based ≈ 1.3× that). Within 2%.
  assert('cover Amount ≈ numFuture30yYears × DARA', coverAmt, nFuture * dara, nFuture * dara * 0.02);
  // 6a: the 2052 cover nets its lifetime AMD out of P+I — Amount strictly below raw par P+I.
  const c2052 = cover.find(d => d.fundedYear === 2052);
  assert('2052 cover Amount < raw par P+I (AMD netted out)',
    c2052.excessAmt < c2052.excessQty * c2052.fundedYearPi, true);
  assert('2052 excessAmdLifetime > 0', c2052.excessAmdLifetime > 0, true);
  // 6a: the 2056 lower cover also nets its lifetime AMD out (deep-discount cover, flipped on Rev 7).
  // Its Amount can sit ABOVE raw par (large LMI add-back, weight ≈0.76, exceeds its AMD) — so assert
  // the net-out is actually applied via the formula identity rather than a raw-par inequality.
  const c2056 = cover.find(d => d.fundedYear === 2056);
  assert('2056 excessAmdLifetime > 0', c2056.excessAmdLifetime > 0, true);
  assert('2056 cover Amount = par − AMD + LMI add-back (net-out applied)',
    c2056.excessAmt,
    c2056.excessQty * c2056.fundedYearPi - c2056.excessAmdLifetime + (c2056.future30yLMIAlloc ?? 0), 1);
  // 6b: roll coupon credited to each of 2053–2056; AMD now runs through 2056 (2052 + 2056 covers,
  // both held-to-maturity), so 2053–56 carry BOTH the 2052 roll coupon and the 2056-cover AMD.
  const roll = y => details.find(d => d.fundedYear === y)?.future30yRollCoupon ?? 0;
  const amd  = y => details.find(d => d.fundedYear === y)?.future30yUpperAnnualAmd ?? 0;
  for (const y of [2053, 2054, 2055, 2056]) assert(`roll coupon credited @${y}`, roll(y) > 0, true);
  assert('no roll coupon @2052', roll(2052), 0);
  assert('no roll coupon @2057', roll(2057), 0);
  assert('AMD present @2052', amd(2052) > 0, true);
  assert('AMD present @2053 (from 2056 cover)', amd(2053) > 0, true);
  assert('no AMD @2057 (covers matured by 2056)', amd(2057), 0);
  // Every funded year in 2050–2056 still lands on DARA after the credits.
  for (const y of [2050, 2052, 2053, 2056]) {
    const d = details.find(x => x.fundedYear === y);
    assert(`amount ≈ DARA @${y}`, d.fundedYearAmt, dara, 700);
  }
  console.log(`        cover Amount total:  ${Math.round(coverAmt).toLocaleString()} vs ${nFuture}×DARA = ${(nFuture*dara).toLocaleString()}`);
  console.log(`        2052 cover: amt ${Math.round(c2052.excessAmt).toLocaleString()}  rawPI ${Math.round(c2052.excessQty*c2052.fundedYearPi).toLocaleString()}  amdLifetime ${Math.round(c2052.excessAmdLifetime).toLocaleString()}`);
  console.log(`        roll 2053–56: ${[2053,2054,2055,2056].map(roll).map(v=>Math.round(v)).join(' / ')}`);
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
  assert('avgAmt ≈ DARA with PLI (gap LMI included)', avgAmt, dara, 700); // see note above (whole-bond rounding, not % of DARA)
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

  // 2. Construct holdings — mirrors the 3-column "Export CUSIP/Qty" CSV (Format 5)
  const holdings = buildDetails
    .map(d => ({ cusip: d.cusip, qty: d.fundedYearQty + d.excessQty, excessQty: d.excessQty }))
    .filter(h => h.qty > 0);

  // 3. Rebalance with identical params
  const { summary: rebalSummary, results: rebalResults } = runRebalance({
    dara: DARA,
    bracketMode: '2bracket',
    holdings,
    tipsMap,
    refCPI,
    settlementDate,
    preLadderInterest: true,
    firstYearOverride: firstYear,
    lastYearOverride: lastYear,
  });

  // 4. Assert: no qty changes on any rung.
  // Tolerance: ±2 bonds across all bracket years. Root cause is a pre-existing LMI
  // computation difference between calcGapParams (build) and calculateGapParameters
  // (rebalance). AMD's larger PLI pool can expose the asymmetry at both the lower
  // bracket (2036) and upper bracket (2040), hence the 2-bond / $4000 tolerance.
  const totalAbsQtyDelta = rebalResults.reduce((s, r) => s + Math.abs(r[9] ?? 0), 0);
  assert('Build→Rebalance: zero total |qtyDelta|', totalAbsQtyDelta <= 2, true);
  assert('Build→Rebalance: zero net cash', Math.abs(Math.round(rebalSummary.costDeltaSum)) <= 4000, true);

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

// ── Test: Build→Rebalance round-trip with NO year overrides — Future-30Y excess ──
// Regression: build 2026–2066 (default DARA), export CUSIP/Qty/excess, import, rebalance
// WITHOUT setting first/last year. lastYear must be INFERRED from the 2052/2056 cover excess
// (inferLastYearFromHoldings) so the round-trip preserves it instead of selling to DARA.
console.log('\nBuild→Rebalance NO-override round-trip — firstYear=2026, lastYear=2066, DARA=40000');
{
  const DARA = 40000, firstYear = settlementDate.getFullYear(), lastYear = 2066;
  const { details: bD, summary: bS } = runBuild({ dara: DARA, firstYear, lastYear, tipsMap, refCPI, settlementDate });
  const holdings = bD
    .map(d => ({ cusip: d.cusip, qty: d.fundedYearQty + d.excessQty, excessQty: d.excessQty }))
    .filter(h => h.qty > 0);

  // Direct inference check
  const inferredLast = inferLastYearFromHoldings({ holdings, tipsMap, refCPI, settlementDate });
  assert('inferLastYear from build holdings === 2066', inferredLast, 2066);

  // Rebalance with NO firstYearOverride / NO lastYearOverride — must self-infer.
  const { summary: rS, results: rR } = runRebalance({
    dara: DARA, bracketMode: '2bracket', holdings, tipsMap, refCPI, settlementDate,
  });
  assert('NO-override rebal infers lastYear 2066', rS.lastYear, 2066);
  assert('NO-override rebal preserves 2052 upper cover excess', rS.future30yUpperExQty, bS.future30yUpperExQty);
  assert('NO-override rebal preserves 2056 lower cover excess', rS.future30yLowerExQty, bS.future30yLowerExQty);
  const totalAbsQtyDelta = rR.reduce((s, r) => s + Math.abs(r[9] ?? 0), 0);
  assert('NO-override round-trip: zero total |qtyDelta|', totalAbsQtyDelta <= 2, true);
  assert('NO-override round-trip: zero net cash', Math.abs(Math.round(rS.costDeltaSum)) <= 4000, true);
  console.log(`        inferredLast: ${inferredLast}  future30y up/lo: ${rS.future30yUpperExQty}/${rS.future30yLowerExQty}  |qtyDelta|: ${totalAbsQtyDelta}  netCash: ${Math.round(rS.costDeltaSum).toLocaleString()}`);
}

// ── Test: Build→Rebalance round-trip through the REAL export string + parse (PLI) ──
// Regression for the Future-30Y import bug: mirrors the app's "Export CUSIP/Qty" → import path
// exactly (serialize to cusip,qty,excess; re-parse via parseHoldingsCSV), with PLI on. The last
// funded year must be recovered from the 2052/2056 cover excess so the round-trip is flat.
console.log('\nBuild→Rebalance export-string round-trip — firstYear=2036, lastYear=2066, PLI, DARA=40000');
{
  const DARA = 40000, firstYear = 2036, lastYear = 2066;
  const { details: bD, summary: bS } = runBuild({ dara: DARA, firstYear, lastYear, tipsMap, refCPI, settlementDate, preLadderInterest: true });
  const zeroed = new Set(bS.zeroedFundedYears ?? []);

  // Serialize exactly like index.html's export-cusip-qty handler
  const rows = ['cusip,qty,excess'];
  for (const d of bD) {
    const f = d.fundedYearQty, e = d.excessQty;
    if (f + e > 0) rows.push(`${d.cusip},${f},${e}`);
    else if (zeroed.has(d.fundedYear)) rows.push(`${d.cusip},0,0`);
  }
  const holdings = parseHoldingsCSV(rows.join('\n'), tipsMap);   // same parser the app uses (Format 5)

  const infLast = inferLastYearFromHoldings({ holdings, tipsMap, refCPI, settlementDate });
  assert('PLI round-trip: last year recovered as 2066', infLast, 2066);

  // Rebalance the way the (fixed) UI would: recovered last year, PLI on, no first-year override.
  const { summary: rS, results: rR } = runRebalance({
    dara: DARA, bracketMode: '2bracket', holdings, tipsMap, refCPI, settlementDate,
    preLadderInterest: true, lastYearOverride: infLast,
  });
  const totalAbsQtyDelta = rR.reduce((s, r) => s + Math.abs(r[9] ?? 0), 0);
  assert('PLI round-trip: zero total |qtyDelta|', totalAbsQtyDelta <= 2, true);
  assert('PLI round-trip: zero net cash', Math.abs(Math.round(rS.costDeltaSum)) <= 4000, true);
  console.log(`        infLast=${infLast}  future30y up/lo: ${rS.future30yUpperExQty}/${rS.future30yLowerExQty}  |qtyDelta|=${totalAbsQtyDelta}  netCash=${Math.round(rS.costDeltaSum).toLocaleString()}`);
}

// ── Test: FULL app round-trip via the EXPLICIT per-year DARA block (#fundedYear,dara) ──
// This is the path the app uses for our own export files: build → export (Format-5 holdings +
// #fundedYear,dara block) → import (parse both) → rebalance honoring the explicit per-year DARA.
// Because the DARA is STATED, not inferred, the ladder reproduces EXACTLY (0 trades) for any
// shape — flat, variable (user-edited per-year), PLI-zeroed early years, future-30Y covers.
// The best-effort inference path (computePortfolioARAByYear → inferScaledDARAFromPortfolio) is
// retained for broker/legacy files but is NOT exercised here.
{
  const SY = settlementDate.getFullYear();
  for (const tc of [
    { label: '2026–2056 flat',     firstYear: SY,   lastYear: 2056, pli: false, vary: false },
    { label: '2026–2066 flat',     firstYear: SY,   lastYear: 2066, pli: false, vary: false },
    { label: '2036–2066 +PLI',     firstYear: 2036, lastYear: 2066, pli: true,  vary: false },
    { label: '2026–2056 variable', firstYear: SY,   lastYear: 2056, pli: false, vary: true  },
    { label: '2034–2066 variable+PLI', firstYear: 2034, lastYear: 2066, pli: true, vary: true },
    // User repro: 40k base, RAISED later years (2040/41/42 = 50/60/70k), PLI, 2066. This drives the
    // gap-bracket excess toward 0 and exercises the "Before == build" + 0-excess bracket render fixes.
    { label: '2036–2066 high-mid+PLI', firstYear: 2036, lastYear: 2066, pli: true, vary: false,
      daraOverrides: { 2040: 50000, 2041: 60000, 2042: 70000 } },
  ]) {
    const { label, firstYear, lastYear, pli, vary, daraOverrides } = tc;
    console.log(`\nFULL explicit-DARA round-trip (build→export→import→rebalance) — ${label}`);
    const DARA = 40000;
    // Variable: edit the first two funded years to distinct lower values (mirrors user per-year edits).
    let buildDaraByYear = null;
    if (vary) {
      buildDaraByYear = new Map([[firstYear, 25000], [firstYear + 1, 30000]]);
    } else if (daraOverrides) {
      buildDaraByYear = new Map(Object.entries(daraOverrides).map(([y, v]) => [+y, v]));
    }
    const { details: bD, summary: bS } = runBuild({ dara: DARA, firstYear, lastYear, tipsMap, refCPI, settlementDate, preLadderInterest: pli, daraByYear: buildDaraByYear });

    // Serialize exactly like index.html export: Format-5 holdings + #fundedYear,dara block.
    const zeroed = new Set(bS.zeroedFundedYears ?? []);
    const rows = ['cusip,qty,excess'];
    for (const d of bD) {
      const f = d.fundedYearQty, e = d.excessQty;
      if (f + e > 0) rows.push(`${d.cusip},${f},${e}`);
      else if (zeroed.has(d.fundedYear)) rows.push(`${d.cusip},0,0`);
    }
    rows.push('#fundedYear,dara');
    for (const y of [...bS.daraByYearResolved.keys()].sort((a, b) => a - b)) rows.push(`${y},${Math.round(bS.daraByYearResolved.get(y))}`);
    const csv = rows.join('\n');

    // Import: holdings via the shared parser; explicit DARA via the shared block parser.
    const rawLines = csv.trim().split('\n').filter(l => l.trim());
    const holdings = parseHoldingsCSV(csv, tipsMap);
    const importedDara = parseFundedYearDaraBlock(rawLines);
    assert(`${label}: #fundedYear,dara block parsed`, importedDara != null && importedDara.size > 0, true);
    const yrs = [...importedDara.keys()].sort((a, b) => a - b);
    const vals = [...importedDara.values()].sort((a, b) => a - b);
    const med = Math.round(vals[Math.floor(vals.length / 2)]);

    // Rebalance honoring explicit DARA (what _initRebalDaraFromPortfolio + Run handler now do).
    const { summary: rS, results: rR, details: rD } = runRebalance({
      dara: med, bracketMode: '3bracket', holdings, tipsMap, refCPI, settlementDate,
      daraByYear: importedDara, lastYearOverride: yrs[yrs.length - 1], firstYearOverride: yrs[0], preLadderInterest: pli,
    });

    const totalAbsQtyDelta = rR.reduce((s, r) => s + Math.abs(r[9] ?? 0), 0);
    assert(`${label}: recovered last year`, rS.lastYear, lastYear);
    assert(`${label}: ZERO total |qtyDelta|`, totalAbsQtyDelta, 0);
    assert(`${label}: ZERO net cash`, Math.round(rS.costDeltaSum), 0);
    if (vary) assert(`${label}: variable DARA preserved (firstYear < median)`, importedDara.get(firstYear) < med, true);

    // Displayed Amount After must land on each year's DARA for fully PLI-funded (zeroed) years.
    // Regression for the variable+PLI overshoot: the zeroed-year credit was sized against the
    // preliminary LMI but displayed against the corrected LMI, inflating the row above its DARA.
    // UNIFICATION INVARIANT: rebalance "Amount After" must equal build's "Amount" for EVERY funded
    // year, and every build funded year must render (no silent skip of fully-covered rungs like the
    // "2035 skip"). This is the real build≡rebalance contract — it subsumes the zeroed-year check
    // (a zeroed year's build amount is its DARA) and the all-years-render check, and catches any
    // divergence between build-lib's per-year amount and rebalance's postARA "After" computation.
    {
      const buildAmtByYear = new Map(bD.map(d => [d.fundedYear, d.fundedYearAmt]));
      const rebalAraByYear = new Map();
      for (const d of rD) if (d.fundedYear != null && d.araAfterTotal != null) rebalAraByYear.set(d.fundedYear, d.araAfterTotal);
      const missing = [];
      let worstDiff = 0, worstY = null;
      for (const [y, amt] of buildAmtByYear) {
        if (!rebalAraByYear.has(y)) { missing.push(y); continue; }
        const diff = Math.abs(rebalAraByYear.get(y) - amt);
        if (diff > worstDiff) { worstDiff = diff; worstY = y; }
      }
      assert(`${label}: every build funded year renders in rebalance (missing: ${missing.join(',') || 'none'})`, missing.length, 0);
      assert(`${label}: rebal After == build amount per year (worst $${Math.round(worstDiff)}${worstY ? ' @' + worstY : ''})`, worstDiff < 2, true);

      // "Amount Before" is the current-holdings valuation. For our own no-trade round-trip the held
      // ladder IS the target, so Before must also equal build per year — via the SAME shared rule
      // (fundedYearAmount): bracket excess coupon, zeroed-year pre-ladder credit, and excess-only AMD
      // all included. Locks the unified Before sweep against drift (was: missing those → 20k+ deficits
      // at zeroed/bracket years and ~$500 AMD drift on every middle year).
      const rebalBeforeByYear = new Map();
      for (const d of rD) if (d.fundedYear != null && d.araBeforeTotal != null) rebalBeforeByYear.set(d.fundedYear, d.araBeforeTotal);
      let worstBef = 0, worstBefY = null;
      for (const [y, amt] of buildAmtByYear) {
        if (!rebalBeforeByYear.has(y)) continue; // render coverage already asserted above
        const diff = Math.abs(rebalBeforeByYear.get(y) - amt);
        if (diff > worstBef) { worstBef = diff; worstBefY = y; }
      }
      assert(`${label}: rebal Before == build amount per year (worst $${Math.round(worstBef)}${worstBefY ? ' @' + worstBefY : ''})`, worstBef < 2, true);
    }

    // Part-2 regression: a designated gap bracket (Jan 2036 lower / Jan 2040 upper) must carry the
    // isGapBracket flag in BOTH build and rebalance details, so render.js isBracket() renders it with
    // "*" + a qty-0 excess sub-row even when its excess sized to 0 (the high-mid scenario drove that).
    // Previously rebalance lacked the flag and hid 0-excess brackets that build showed.
    if (daraOverrides) {
      for (const y of [2036, 2040]) {
        assert(`${label}: build ${y} flagged isGapBracket`, bD.some(d => d.fundedYear === y && d.isGapBracket), true);
        assert(`${label}: rebal ${y} flagged isGapBracket (renders at 0 excess)`, rD.some(d => d.fundedYear === y && d.isGapBracket), true);
      }
    }
    console.log(`        med=${med}  yrs=${yrs[0]}–${yrs[yrs.length - 1]}  |qtyDelta|=${totalAbsQtyDelta}  netCash=${Math.round(rS.costDeltaSum).toLocaleString()}`);
  }
}

// ── Test: parseParamsBlock — construction params (#params line) ──────────────
// DARA doesn't encode PLI / maturityPref, but they change the target ladder. The export
// appends `#params,...`; the import parses it to set the UI controls (file-authoritative on
// load, user may override). Round-trip the values build/rebalance summaries expose.
console.log('\nparseParamsBlock — #params line');
{
  const fileLines = [
    'cusip,qty,excess', '91282CLE9,0,0', '91282CPU9,33,50',
    '#fundedYear,dara', '2034,20000', '2035,30000',
    '#params,preLadderInterest=true,maturityPref=first',
  ];
  const p = parseParamsBlock(fileLines);
  assert('params parsed not null', p != null, true);
  assert('params PLI=true', p?.preLadderInterest, true);
  assert('params maturityPref=first', p?.maturityPref, 'first');

  const pOff = parseParamsBlock(['#params,preLadderInterest=false,maturityPref=last']);
  assert('params PLI=false', pOff?.preLadderInterest, false);
  assert('params maturityPref=last', pOff?.maturityPref, 'last');

  // No #params line (broker/legacy) → null, so import falls back to UI/inference.
  assert('no #params line → null', parseParamsBlock(['cusip,qty', '91282CLE9,10']), null);

  // The values come from the summaries that the export reads.
  const { summary: bSum } = runBuild({ dara: 40000, firstYear: 2034, lastYear: 2047, tipsMap, refCPI, settlementDate, preLadderInterest: true, maturityPref: 'first' });
  assert('build summary carries preLadderInterest', bSum.preLadderInterest, true);
  assert('build summary carries maturityPref', bSum.maturityPref, 'first');
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

  // 2. Holdings from build export — mirrors the 3-column "Export CUSIP/Qty" CSV (Format 5)
  const holdingsFull = buildDetailsFull
    .map(d => ({ cusip: d.cusip, qty: d.fundedYearQty + d.excessQty, excessQty: d.excessQty }))
    .filter(h => h.qty > 0);

  // 3. Rebalance with Full method
  const { summary: rebalSummaryFull, results: rebalResultsFull, details: rebalDetailsFull } = runRebalance({
    dara: DARA,
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

  // 2. Export CUSIP/qty — mirrors the 3-column "Export CUSIP/Qty" CSV (Format 5).
  const inferHoldings = inferBuildDetails
    .map(d => ({ cusip: d.cusip, qty: d.fundedYearQty + d.excessQty, excessQty: d.excessQty }));

  // 3. Rebalance with no explicit DARA — shift to firstYear=2036, lastYear=2065
  const { summary: inferRebalSummary } = runRebalance({
    dara: null,
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

// ── Test: Build — firstYear inside gap (2037/2038/2039) ──────────────────────
// Lower bracket (Jan 2036) always exists — identified from tipsMap even when firstYear > 2036.
// 2036 row: fundedYearQty = 0, excessQty > 0 (pure bracket excess for duration matching).
for (const gapFirstYear of [2037, 2038, 2039]) {
  console.log(`\nBuild — firstYear=${gapFirstYear} (gap year), lastYear=2047`);
  const dara = 30000, lastYear = 2047;
  const { summary, results, details } = runBuild({ dara, firstYear: gapFirstYear, lastYear, tipsMap, refCPI, settlementDate });
  const gapYearsInRange = [];
  for (let y = gapFirstYear; y <= 2039; y++) gapYearsInRange.push(y);
  assert(`firstYear=${gapFirstYear}: gapYears covers [${gapFirstYear}–2039]`,
    summary.gapYears.length, gapYearsInRange.length);
  assert(`firstYear=${gapFirstYear}: lowerYear === 2036`,
    summary.lowerYear, 2036);
  assert(`firstYear=${gapFirstYear}: upperYear === 2040`,
    summary.upperYear, 2040);
  assert(`firstYear=${gapFirstYear}: lowerWeight + upperWeight ≈ 1`,
    summary.lowerWeight + summary.upperWeight, 1, 0.0001);
  assert(`firstYear=${gapFirstYear}: duration match (w_lo×d_lo + w_up×d_up ≈ avgDuration)`,
    summary.lowerWeight * summary.lowerDuration + summary.upperWeight * summary.upperDuration,
    summary.gapParams.avgDuration, 0.001);
  assert(`firstYear=${gapFirstYear}: lowerExQty > 0`, summary.lowerExQty > 0, true);
  assert(`firstYear=${gapFirstYear}: upperExQty > 0`, summary.upperExQty > 0, true);
  assert(`firstYear=${gapFirstYear}: result rows > 0`, results.length > 0, true);
  // 2036 appears as a pure bracket row (fundedYearQty=0, excessQty>0)
  const d2036 = details.find(d => d.fundedYear === 2036);
  assert(`firstYear=${gapFirstYear}: 2036 row present`, d2036 != null, true);
  assert(`firstYear=${gapFirstYear}: 2036 fundedYearQty === 0`, d2036?.fundedYearQty, 0);
  assert(`firstYear=${gapFirstYear}: 2036 excessQty > 0`, (d2036?.excessQty ?? 0) > 0, true);
  console.log(`        gapYears:  [${summary.gapYears.join(',')}]`);
  console.log(`        lowerYear: ${summary.lowerYear}  lowerExQty: ${summary.lowerExQty}  upperExQty: ${summary.upperExQty}`);
  console.log(`        weights:   ${summary.lowerWeight?.toFixed(4)} / ${summary.upperWeight?.toFixed(4)}`);
  console.log(`        durMatch:  ${(summary.lowerWeight*summary.lowerDuration + summary.upperWeight*summary.upperDuration).toFixed(4)} ≈ ${summary.gapParams?.avgDuration?.toFixed(4)}`);
  console.log(`        totalBuyCost: ${Math.round(summary.totalBuyCost).toLocaleString()}`);
}

// ── Test: Rebalance — firstYearOverride inside gap (2037/2038/2039) ───────────
{
  console.log('\nBuild→Rebalance — firstYearOverride=2037, lastYear=2047');
  const DARA = 30000, buildFirstYear = 2035, lastYear = 2047;
  const { details: bldDetails } = runBuild({
    dara: DARA, firstYear: buildFirstYear, lastYear,
    tipsMap, refCPI, settlementDate,
  });
  const holdings = bldDetails.map(d => ({ cusip: d.cusip, qty: d.fundedYearQty + d.excessQty, excessQty: d.excessQty }));

  const { summary: rSummary } = runRebalance({
    dara: DARA, bracketMode: '2bracket',
    holdings, tipsMap, refCPI, settlementDate,
    firstYearOverride: 2037, lastYearOverride: lastYear,
  });
  assert('Rebal firstYear=2037: lowerYear === 2036', rSummary.brackets.lowerYear, 2036);
  assert('Rebal firstYear=2037: upperYear 2040', rSummary.brackets.upperYear, 2040);
  assert('Rebal firstYear=2037: lowerWeight + upperWeight ≈ 1', rSummary.lowerWeight + rSummary.upperWeight, 1, 0.0001);
  assert('Rebal firstYear=2037: duration match', rSummary.lowerWeight * rSummary.lowerDuration + rSummary.upperWeight * rSummary.upperDuration, rSummary.gapParams.avgDuration, 0.001);
  assert('Rebal firstYear=2037: gapYears = [2037,2038,2039]', JSON.stringify(rSummary.gapYears), '[2037,2038,2039]');
  // costDeltaSum is positive: selling 2035/2036 funded bonds releases cash (ladder shortening)
  assert('Rebal firstYear=2037: costDeltaSum >= 0 (cash released from sold years)', rSummary.costDeltaSum >= 0, true);
  console.log(`        costDeltaSum: ${Math.round(rSummary.costDeltaSum).toLocaleString()}`);
  console.log(`        gapYears: [${rSummary.gapYears.join(',')}]`);
  console.log(`        lowerWeight/upperWeight: ${rSummary.lowerWeight}/${rSummary.upperWeight}`);
}

// ── Test: inferFirstYearFromHoldings ─────────────────────────────────────────
{
  console.log('\ninferFirstYearFromHoldings');
  const DARA = 30000, lastYear = 2047;

  // Build with firstYear=2038 (gap year) → 2036 gets pure bracket excess, no funded component.
  for (const firstYearIn of [2037, 2038, 2039]) {
    const { details: bldD } = runBuild({ dara: DARA, firstYear: firstYearIn, lastYear, tipsMap, refCPI, settlementDate });
    // Simulate Format 5 CSV round-trip: include excessQty for all rows.
    const holdings = bldD.map(d => ({ cusip: d.cusip, qty: d.fundedYearQty + d.excessQty, excessQty: d.excessQty }));
    const inferred = inferFirstYearFromHoldings({ holdings, tipsMap, refCPI, settlementDate });
    assert(`inferFirstYear from build firstYear=${firstYearIn}`, inferred, firstYearIn);
  }

  // Format 3 (no excessQty) → returns null (no inference possible).
  const { details: bldD3 } = runBuild({ dara: DARA, firstYear: 2038, lastYear, tipsMap, refCPI, settlementDate });
  const holdingsNoExcess = bldD3.map(d => ({ cusip: d.cusip, qty: d.fundedYearQty + d.excessQty }));
  const inferredNull = inferFirstYearFromHoldings({ holdings: holdingsNoExcess, tipsMap, refCPI, settlementDate });
  assert('inferFirstYear Format3 (no excessQty) → null', inferredNull, null);

  // Build with firstYear=2036 (funded year, not pure bracket) → 2036 has funded component → returns null.
  const { details: bldD36 } = runBuild({ dara: DARA, firstYear: 2036, lastYear, tipsMap, refCPI, settlementDate });
  const holdings36 = bldD36.map(d => ({ cusip: d.cusip, qty: d.fundedYearQty + d.excessQty, excessQty: d.excessQty }));
  const inferred36 = inferFirstYearFromHoldings({ holdings: holdings36, tipsMap, refCPI, settlementDate });
  assert('inferFirstYear from build firstYear=2036 → null (2036 is funded, not pure bracket)', inferred36, null);
}

// ── Test: segment-dara pure helpers (shared build/rebalance layer) ────────────
{
  console.log('\nsegment-dara helpers — partition / constant / no-clobber merge');
  const [lmpYears, specYears] = segmentRanges(2047, 2026, 2055);
  assert('segmentRanges: 2-way split count', segmentRanges(2047, 2026, 2055).length, 2);
  assert('segmentRanges: LMP count 2026–2047', lmpYears.size, 22);
  assert('segmentRanges: spec count 2048–2055', specYears.size, 8);
  assert('segmentRanges: split year is LMP', lmpYears.has(2047), true);
  assert('segmentRanges: split+1 is spec', specYears.has(2048), true);

  const [allLmp] = segmentRanges(2055, 2026, 2055);
  assert('segmentRanges: split=last (out of range) → single whole-ladder segment', segmentRanges(2055, 2026, 2055).length, 1);
  assert('segmentRanges: split=last → whole ladder LMP', allLmp.size, 30);

  // N-way split: two split years produce three consecutive segments.
  const [n1, n2, n3] = segmentRanges([2035, 2047], 2026, 2055);
  assert('segmentRanges: 3-way split count', segmentRanges([2035, 2047], 2026, 2055).length, 3);
  assert('segmentRanges: 3-way seg1 count 2026–2035', n1.size, 10);
  assert('segmentRanges: 3-way seg2 count 2036–2047', n2.size, 12);
  assert('segmentRanges: 3-way seg3 count 2048–2055', n3.size, 8);
  assert('segmentRanges: 3-way segments partition with no overlap', n1.size + n2.size + n3.size, 30);
  // Order of split years supplied shouldn't matter — they're sorted internally.
  const [r1, r2, r3] = segmentRanges([2047, 2035], 2026, 2055);
  assert('segmentRanges: split-year order is normalized', r1.size === n1.size && r2.size === n2.size && r3.size === n3.size, true);

  const cm = constantMap(specYears, 50000);
  assert('constantMap: covers every spec year', cm.size, 8);
  assert('constantMap: value stamped', cm.get(2050), 50000);

  // No-clobber: stamping the spec segment must not touch LMP entries.
  const store = new Map([[2030, 40000], [2047, 40000], [2050, 11111]]);
  applySegmentMap(store, specYears, constantMap(specYears, 60000));
  assert('applySegmentMap: spec year written', store.get(2050), 60000);
  assert('applySegmentMap: LMP year 2030 untouched', store.get(2030), 40000);
  assert('applySegmentMap: LMP year 2047 untouched', store.get(2047), 40000);
}

// ── Test: two-segment cascade self-finances each segment AND the whole portfolio ──
// Build a flat 2026–2055 ladder, hold it, then run the LMP/speculative cascade at split 2047.
// Each segment's own net cash (cost delta summed over its funded years) must be ≈ 0, the whole
// portfolio must be ≈ 0, and both segment medians must be positive (≈ the flat build DARA).
{
  console.log('\nTwo-segment cascade — split 2047, LMP 2026–2047 / speculative 2048–2055, DARA=40000');
  const DARA = 40000, firstYear = settlementDate.getFullYear(), lastYear = 2055, splitYear = 2047;

  const { details: bD } = runBuild({ dara: DARA, firstYear, lastYear, tipsMap, refCPI, settlementDate });
  const holdings = bD
    .map(d => ({ cusip: d.cusip, qty: d.fundedYearQty + d.excessQty, excessQty: d.excessQty }))
    .filter(h => h.qty > 0);

  const rawARA = computePortfolioARAByYear(holdings, tipsMap, refCPI);
  const { daraMap } = derivePerYearDara(rawARA, getGapYearBracketCandidates(tipsMap));

  const seg = inferSegmentedDARAFromPortfolio({
    daraMap, holdings, tipsMap, refCPI, settlementDate, splitYear, firstYear, lastYear,
  });

  assert('cascade: LMP median positive',  seg.lmpMedian > 0, true);
  assert('cascade: speculative median positive', seg.specMedian > 0, true);

  // Flat (even real income): every in-scope rung equals its segment median.
  const lmpEven  = [...seg.lmpMap.values()].every(v => v === seg.lmpMedian);
  const specEven = [...seg.specMap.values()].every(v => v === seg.specMedian);
  assert('cascade: LMP rungs are flat (even income)',  lmpEven, true);
  assert('cascade: speculative rungs are flat (even income)', specEven, true);

  // Run the actual rebalance with the merged map and partition cost delta by segment.
  const { results, details } = runRebalance({
    dara: seg.lmpMedian, holdings, tipsMap, refCPI, settlementDate,
    daraByYear: seg.combinedMap, lastYearOverride: lastYear, firstYearOverride: firstYear,
  });
  let lmpNet = 0, specNet = 0;
  for (let i = 0; i < results.length; i++) {
    const cd = results[i][11];
    if (typeof cd !== 'number') continue;
    if (details[i].fundedYear <= splitYear) lmpNet += cd; else specNet += cd;
  }
  const wholeNet = lmpNet + specNet;

  assert('cascade: LMP segment net cash within ±$4000', Math.abs(Math.round(lmpNet)) <= 4000, true);
  assert('cascade: speculative segment net cash within ±$4000', Math.abs(Math.round(specNet)) <= 4000, true);
  assert('cascade: whole-portfolio net cash within ±$4000', Math.abs(Math.round(wholeNet)) <= 4000, true);
  console.log(`        LMP median: ${Math.round(seg.lmpMedian).toLocaleString()}  spec median: ${Math.round(seg.specMedian).toLocaleString()}`);
  console.log(`        net cash — LMP: ${Math.round(lmpNet).toLocaleString()}  spec: ${Math.round(specNet).toLocaleString()}  whole: ${Math.round(wholeNet).toLocaleString()}`);
}

// Spec-only infer must NOT throw when probing high DARA floods later-maturity interest into a fixed
// downstream LMP year (regression: this aborted _runSegmentInferSpec before re-render → "does nothing").
// Build data is too uniform to hit it; the real-ish SampleHoldings (2040 gap, lumpy ARA) does.
{
  const fp = path.resolve('./data/SampleHoldings.csv');
  if (existsSync(fp)) {
    console.log('\nSpec-only infer on SampleHoldings (split 2047) — must converge, not throw');
    const holdings = parseHoldings(readFileSync(fp, 'utf8'));
    const yrs = holdings.map(h => tipsMap.get(h.cusip)?.maturity?.getFullYear()).filter(Boolean);
    const fy = Math.min(...yrs), ly = Math.max(...yrs);
    const rawARA = computePortfolioARAByYear(holdings, tipsMap, refCPI);
    const { daraMap } = derivePerYearDara(rawARA, getGapYearBracketCandidates(tipsMap));
    const specYears = new Set(); for (let y = fy; y <= ly; y++) if (y > 2047) specYears.add(y);
    let median = null, threw = false;
    try {
      ({ scaledMedian: median } = inferScaledDARAFromPortfolio({
        daraMap, holdings, tipsMap, refCPI, settlementDate,
        scopeYears: specYears, fixedDaraByYear: daraMap, flat: true,
      }));
    } catch { threw = true; }
    assert('spec-only infer does not throw', threw, false);
    assert('spec-only infer returns a positive flat DARA', median > 0, true);
    console.log(`        spec flat DARA: ${Math.round(median || 0).toLocaleString()}`);
  }
}

// ── Test: runFundedRebalance — gap-free pristine mirror is a no-op (no scale) ──────────────────
// A portfolio with no gap years (2037-39) / Future-30Y block has nothing to duration-match, so the
// self-financing scale must NOT run: the load mirror already nets to ≈0. Guards the 3.0 §Funding gate
// (previously only e2e-covered). Holdings 2027-2033 with holes at 2029/2032 (intentional empties).
{
  console.log('\nrunFundedRebalance — gap-free pristine mirror makes no large trades');
  const rawHoldings = [
    { cusip: '912828V49', qty: 61 }, { cusip: '9128283R9', qty: 63 },
    { cusip: '91282CPH8', qty: 100 }, { cusip: '91282CCM1', qty: 84 },
    { cusip: '91282CHP9', qty: 96 },
  ].filter(h => tipsMap.get(h.cusip)?.maturity);

  // Build the load mirror exactly as the UI does at file load (range form fills empty years w/ LMI).
  const heldARA = computePortfolioARAByYear(rawHoldings, tipsMap, refCPI);
  const heldYears = Object.keys(heldARA).map(Number);
  const firstYear = Math.min(...heldYears), lastYear = Math.max(...heldYears);
  const fullARA = computePortfolioARAByYear(rawHoldings, tipsMap, refCPI, { firstYear, lastYear });
  const { median, daraMap } = derivePerYearDara(heldARA, getGapYearBracketCandidates(tipsMap));
  const gapSet = new Set(getGapYears(tipsMap));
  const mirror = new Map();
  for (let y = firstYear; y <= lastYear; y++) {
    mirror.set(y, daraMap.has(y) ? daraMap.get(y) : (gapSet.has(y) ? median : Math.round(fullARA[y] ?? 0)));
  }

  const res = runFundedRebalance({
    dara: median, holdings: rawHoldings, tipsMap, refCPI, settlementDate,
    daraByYear: mirror, isPristineMirror: true,
  });
  assert('gap-free: engine reports no gap years', res.summary.gapYears.length, 0);
  const maxAbsDelta = Math.max(0, ...res.details.map(d => Math.abs((d.qtyAfter ?? 0) - (d.qtyBefore ?? 0))));
  assert('gap-free pristine mirror: max |qtyDelta| <= 3 bonds (scale skipped, no sell-down)', maxAbsDelta <= 3, true);
  assert('gap-free pristine mirror: net cash ~0', Math.abs(res.summary.costDeltaSum) <= 3000, true);
}

// ── Test: runFundedRebalance — gap/Future-30Y block: scale actually applies ─────────────────────
// Companion to the gap-free no-op test above: a portfolio that DOES have a gap-year/Future-30Y
// block to duration-match, so isPristineMirror must trigger the scale (not skip it). This is the
// exact reproduction the user found manually (2026-07-25): load the app with the pre-populated
// SampleHoldings.csv and click Run Rebalance — net cash came back a large negative number instead
// of ~0, because the whole scale-application branch had been silently deleted from
// runFundedRebalance in commit c0d233b (2026-07-16, an unrelated Ref CPI/Index Ratio refactor) —
// isPristineMirror kept getting computed and passed in from index.html, but nothing acted on it
// anymore, so funded years were never sold down to fund the bracket excess. The gap-free no-op
// test above didn't catch this because it only exercises the branch where the scale is correctly
// SKIPPED — it can't tell "skipped because gap-free" apart from "skipped because deleted". This
// test exercises the branch where the scale must actually fire.
{
  const fp = path.resolve('./data/SampleHoldings.csv');
  if (existsSync(fp)) {
    console.log('\nrunFundedRebalance — SampleHoldings pristine mirror: scale must apply and self-finance');
    const rawHoldings = parseHoldings(readFileSync(fp, 'utf8'));

    // Build the load mirror exactly as the UI does at file load (range form fills empty years w/ LMI).
    const heldARA = computePortfolioARAByYear(rawHoldings, tipsMap, refCPI);
    const heldYears = Object.keys(heldARA).map(Number);
    const firstYear = Math.min(...heldYears), lastYear = Math.max(...heldYears);
    const fullARA = computePortfolioARAByYear(rawHoldings, tipsMap, refCPI, { firstYear, lastYear });
    const { median, daraMap } = derivePerYearDara(heldARA, getGapYearBracketCandidates(tipsMap));
    const gapSet = new Set(getGapYears(tipsMap));
    const mirror = new Map();
    for (let y = firstYear; y <= lastYear; y++) {
      mirror.set(y, daraMap.has(y) ? daraMap.get(y) : (gapSet.has(y) ? median : Math.round(fullARA[y] ?? 0)));
    }

    const res = runFundedRebalance({
      dara: median, holdings: rawHoldings, tipsMap, refCPI, settlementDate,
      daraByYear: mirror, isPristineMirror: true,
    });
    const hasFundingBlock = res.summary.gapYears.length > 0 || res.summary.future30yYears.length > 0;
    assert('SampleHoldings: portfolio actually has a gap/Future-30Y block to fund (else this test proves nothing)', hasFundingBlock, true);
    assert('SampleHoldings pristine mirror: net cash is small and non-negative (self-financing scale applied)',
      res.summary.costDeltaSum >= -50 && res.summary.costDeltaSum <= 3000, true);
    console.log(`        net cash: ${Math.round(res.summary.costDeltaSum).toLocaleString()}`);
  }
}

// ── Test: Infer LMP DARA when lastYear lands inside the gap — orphaned bracket trade ────────────
// Regression: when lastYearOverride sits inside the structural gap (2037-2039), the upper bracket
// (2040) is NOT a funded rung, but the rebalance still emits a trade for it (3.0 §lastYear as a Gap
// Year). That trade's fundedYear (2040) falls outside [firstYear, lastYear], so a segment-scoped
// self-financing search (flat=true, scopeYears = the whole LMP range, no speculative segment — what
// "Infer LMP DARA" runs with no split set) must still count that trade's cash delta, or the search
// converges on a DARA that leaves large, oversized 2040 holdings unaccounted for and the reported
// whole-portfolio net cash lands far from zero (real-world case: a $38k, 26-bond 2040 position sized
// for build-era duration matching outlived its ladder — Dana's combined Schwab accounts, net cash
// +$12k+ before the fix). Oversize the 2040 position relative to the tiny 3-year gap it must cover.
{
  console.log('\nInfer LMP DARA — lastYear inside gap, oversized 2040 bracket must be counted');
  const holdings = [
    { cusip: '9128283R9', qty: 10 }, { cusip: '9128285W6', qty: 10 },
    { cusip: '912828Z37', qty: 10 }, { cusip: '91282CBF7', qty: 10 },
    { cusip: '91282CDX6', qty: 10 }, { cusip: '912810QF8', qty: 40 }, // 2040, oversized
  ].filter(h => tipsMap.get(h.cusip)?.maturity);

  const firstYear = 2028, lastYear = 2039;
  const heldARA = computePortfolioARAByYear(holdings, tipsMap, refCPI);
  const { daraMap } = derivePerYearDara(heldARA, getGapYearBracketCandidates(tipsMap));

  const lmpYears = new Set();
  for (let y = firstYear; y <= lastYear; y++) lmpYears.add(y);
  const { scaledMap, scaledMedian } = inferScaledDARAFromPortfolio({
    daraMap, holdings, tipsMap, refCPI, settlementDate,
    lastYearOverride: lastYear, firstYearOverride: firstYear,
    scopeYears: lmpYears, fixedDaraByYear: daraMap, flat: true,
  });
  assert('Infer LMP (last inside gap): returns a positive flat DARA', scaledMedian > 0, true);

  const result = runRebalance({
    dara: scaledMedian, holdings, tipsMap, refCPI, settlementDate,
    daraByYear: scaledMap, lastYearOverride: lastYear, firstYearOverride: firstYear,
  });
  assert('Infer LMP (last inside gap): whole-portfolio net cash small & non-negative',
    result.summary.costDeltaSum >= -50 && result.summary.costDeltaSum <= 3000, true);
  console.log(`        flat DARA: ${Math.round(scaledMedian).toLocaleString()}  whole-portfolio net cash: ${Math.round(result.summary.costDeltaSum).toLocaleString()}`);
}

// ── Test: accruedInterest — day-count proration (2.1 TIPS Basics, Trade Ticket) ──
console.log('\naccruedInterest — day-count proration');
{
  const coupon = 0.02; // 2% annual → 1.0 per $100 semiannual
  const maturity = new Date(2036, 0, 15); // Jan 15, 2036 — coupon dates Jan15/Jul15
  const periodStart = new Date(2025, 6, 15); // Jul 15, 2025
  const E_expected = (new Date(2026, 0, 15) - periodStart) / 86400000; // 184 days

  // One day after the coupon date: A=1, accrued is a thin sliver of the semiannual coupon.
  const early = accruedInterest(coupon, new Date(2025, 6, 16), maturity);
  assert('accruedInterest: E matches period length', early.E, E_expected);
  assert('accruedInterest: A=1 the day after a coupon', early.A, 1);
  assert('accruedInterest: accrued ≈ semiCoupon × 1/E', early.accrued, 1.0 * (1 / E_expected), 1e-9);

  // One day before the next coupon: A=E-1, accrued is nearly the full semiannual coupon —
  // NOT the flat cpn/2×par the app used to describe before switching to day-count proration.
  const late = accruedInterest(coupon, new Date(2026, 0, 14), maturity);
  assert('accruedInterest: A=E-1 the day before the next coupon', late.A, E_expected - 1);
  assert('accruedInterest: accrued ≈ semiCoupon × (E-1)/E', late.accrued, 1.0 * (E_expected - 1) / E_expected, 1e-9);
  assert('accruedInterest: accrued strictly below the full semiannual coupon', late.accrued < 1.0, true);

  console.log(`        E=${early.E} days   early(A=1) accrued=${early.accrued.toFixed(5)}   late(A=E-1) accrued=${late.accrued.toFixed(5)}`);
}


// ── Gap duration matching with retained lower-side maturities ─────────────────
// The invariant nothing asserted before 463b07a removed the 3-way solve: the COST-WEIGHTED
// duration of every leg actually held must equal the gap block's average duration. Spec 2.0
// §Retained Bracket Excess.
{
  console.log('');
  console.log('Gap duration match — retained lower-side maturities');

  // Gap average sits BETWEEN the two brackets — the normal case. (If dGap crowds dUpper,
  // a short retained leg can make the match unsolvable at any non-negative weight; the solver
  // then sells it, which is the only lever available and is exercised in case 4 below.)
  const dGap = 10.5, dAct = 9.2, dUp = 12.9;
  const blend = (retained, w) =>
    retained.reduce((s, r, i) => s + w.retainedWeights[i] * r.duration, 0)
    + w.latest10yWeight * dAct + w.upperWeight * dUp;

  // 1. No retained legs → must reproduce the plain two-sided answer exactly.
  {
    const base = bracketWeights(dAct, dUp, dGap);
    const w = bracketWeightsN({ retained: [], dLatest10y: dAct, dUpper: dUp, dGap, totalBlockCost: 300000 });
    assert('no retained: latest10yWeight == two-sided lowerWeight', w.latest10yWeight, base.lowerWeight, 1e-12);
    assert('no retained: upperWeight == two-sided upperWeight', w.upperWeight, base.upperWeight, 1e-12);
    assert('no retained: blend matches dGap', blend([], w), dGap, 1e-9);
  }

  // 2. One retained (shorter) leg, frozen at its held cost → blend still lands on dGap.
  //    This is the case the shipped code got wrong: it priced the retained leg at dAct.
  {
    const retained = [{ duration: 7.4, excessCost: 60000 }];
    const total = 300000;
    const w = bracketWeightsN({ retained, dLatest10y: dAct, dUpper: dUp, dGap, totalBlockCost: total });
    assert('one retained: feasible', w.feasible, true);
    assert('one retained: retained weight is its held share', w.retainedWeights[0], 60000/total, 1e-12);
    assert('one retained: blend matches dGap', blend(retained, w), dGap, 1e-9);
    assert('one retained: weights sum to 1',
      w.retainedWeights[0] + w.latest10yWeight + w.upperWeight, 1, 1e-12);

    // The old two-sided treatment, for contrast: retained dollars priced at dAct.
    const base = bracketWeights(dAct, dUp, dGap);
    const wRet = 60000/total;
    const oldBlend = wRet * 7.4 + (base.lowerWeight - wRet) * dAct + base.upperWeight * dUp;
    assert('one retained: old two-sided treatment really did fall short of dGap', oldBlend < dGap - 0.1, true);
    console.log('        old blend: ' + oldBlend.toFixed(3) + '  vs dGap ' + dGap + '  (short by ' + (dGap - oldBlend).toFixed(3) + ')');
  }

  // 3. Three retained legs (the Jan 2034 / Jan 2036 / Jul 2036 shape) → still exact.
  {
    const retained = [
      { duration: 6.1, excessCost: 30000 },
      { duration: 7.4, excessCost: 25000 },
      { duration: 8.6, excessCost: 20000 },
    ];
    const w = bracketWeightsN({ retained, dLatest10y: dAct, dUpper: dUp, dGap, totalBlockCost: 300000 });
    assert('three retained: feasible', w.feasible, true);
    assert('three retained: blend matches dGap', blend(retained, w), dGap, 1e-9);
    assert('three retained: weights sum to 1',
      w.retainedWeights.reduce((s,x)=>s+x,0) + w.latest10yWeight + w.upperWeight, 1, 1e-12);
  }

  // 4. Over-allocated → sell the OLDEST first, and only as far as needed.
  {
    const retained = [
      { duration: 6.1, excessCost: 260000 },   // oldest, grossly oversized
      { duration: 7.4, excessCost: 20000 },
    ];
    const w = bracketWeightsN({ retained, dLatest10y: dAct, dUpper: dUp, dGap, totalBlockCost: 300000 });
    assert('over-allocated: sold something', w.sold, true);
    assert('over-allocated: earliest sold, not fully depleted when a partial sale suffices',
      w.retainedWeights[0] > 0 && w.retainedWeights[0] < 260000/300000, true);
    assert('over-allocated: sold only down to where the match is restored', w.latest10yWeight, 0, 1e-9);
    assert('over-allocated: newer retained leg survives', w.retainedWeights[1] > 0, true);
    assert('over-allocated: blend still matches dGap', blend(retained, w), dGap, 1e-9);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

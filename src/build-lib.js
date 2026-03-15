// TIPS Ladder Builder — Build from Scratch
// Pure computation only — no Node.js I/O, no file system, no CLI.
//
// Entry point: runBuild({ dara, lastYear, tipsMap, refCPI, settlementDate })

import { fmtDate } from './rebalance-lib.js';
import { bondCalcs, calculateMDuration, rungAmount } from './bond-math.js';
import { interpolateYield, syntheticCoupon as _synCoupon, bracketWeights, bracketExcessQtys, fyQty as _fyQty } from './gap-math.js';

// ─── Gap parameters for build-from-scratch ─────────────────────────────────────
// prelim: { [year]: { targetFYQty, annualInterest } }
function calcGapParams(gapYears, tipsMap, settlementDate, refCPI, dara, prelim) {
  const minGapYear = Math.min(...gapYears);
  const maxGapYear = Math.max(...gapYears);

  let anchorBefore = null, anchorAfter = null;
  for (const bond of tipsMap.values()) {
    if (!bond.maturity || !bond.yield) continue;
    const yr = bond.maturity.getFullYear(), mo = bond.maturity.getMonth() + 1;
    if (yr === minGapYear - 1 && mo === 1) anchorBefore = bond;
    if (yr === maxGapYear + 1 && mo === 2) anchorAfter  = bond;
  }
  if (!anchorBefore || !anchorAfter)
    throw new Error('Could not find yield interpolation anchors for gap years');

  let totalDuration = 0, totalCost = 0;
  for (const year of [...gapYears].sort((a, b) => b - a)) {
    const synMat = new Date(year, 1, 15); // Feb 15
    const synYld = interpolateYield(anchorBefore, anchorAfter, synMat);
    const synCpn = _synCoupon(synYld);

    totalDuration += calculateMDuration(settlementDate, synMat, synCpn, synYld);

    // Sum annual interest from all non-gap bonds with maturity year > this gap year
    let laterMatInt = 0;
    for (const [y, p] of Object.entries(prelim)) {
      if (parseInt(y) > year) laterMatInt += p.annualInterest;
    }

    const piPerBond = 1000 + 1000 * synCpn * 0.5;
    totalCost += _fyQty(dara, laterMatInt, piPerBond) * 1000;
  }

  return { avgDuration: totalDuration / gapYears.length, totalCost };
}

// ─── Main entry point ──────────────────────────────────────────────────────────
// Inputs:
//   dara           — number (required)
//   lastYear       — number (last fiscal year to fund)
//   tipsMap        — Map from buildTipsMapFromYields()
//   refCPI         — number
//   settlementDate — Date (firstYear is derived as settlementDate.getFullYear())
//
// Bond selection: latest-to-mature TIPS within each fiscal year.
// Lower bracket: latest TIPS bond maturing before the first gap year.
// Upper bracket: always 2040.
//
// Returns: { results, HDR, summary }
// Spec: knowledge/3.0_TIPS_Ladders.md and knowledge/4.0_TIPS_Ladder_Rebalancing.md §Full Rebalance
// Variable naming note: fundedYearQty, excessQty, costPerBond (harmonized) — see §Code Variable Mapping
export function runBuild({ dara, firstYear: firstYearOpt, lastYear, tipsMap, refCPI, settlementDate, maturityPref = 'last', preLadderInterest = false, daraByYear = null }) {
  const firstYear      = firstYearOpt ?? settlementDate.getFullYear();
  const settleDateDisp = fmtDate(settlementDate);

  // 1. Build yearBondMap: for each year in [firstYear, lastYear],
  //    pick the latest-maturing TIPS that matures after settlement.
  const yearBondMap = {};
  for (const bond of tipsMap.values()) {
    if (!bond.maturity || bond.maturity <= settlementDate) continue;
    const yr = bond.maturity.getFullYear();
    if (yr < firstYear || yr > lastYear) continue;
    if (!yearBondMap[yr] || (maturityPref === 'first' ? bond.maturity < yearBondMap[yr].maturity : bond.maturity > yearBondMap[yr].maturity))
      yearBondMap[yr] = bond;
  }

  const rangeYears = Object.keys(yearBondMap).map(Number).sort((a, b) => a - b);
  if (!rangeYears.length) throw new Error('No TIPS bonds found in the specified year range');

  // Gap years: years in [firstYear, lastYear] with no available TIPS
  const gapYears = [];
  for (let y = firstYear; y <= lastYear; y++) {
    if (!yearBondMap[y]) gapYears.push(y);
  }
  if (!gapYears.length)
    throw new Error('No gap years in range — bracket logic requires at least one gap year');

  const minGapYear = Math.min(...gapYears);

  // 2. Identify brackets
  const upperYear = 2040;
  if (!yearBondMap[upperYear])
    throw new Error('No TIPS available in 2040 — lastYear must be ≥ 2040');

  // Lower bracket: the largest rangeYear strictly before the first gap year
  const yearsBeforeGap = rangeYears.filter(y => y < minGapYear);
  if (!yearsBeforeGap.length) throw new Error('No TIPS bonds available before the gap');
  const lowerYear = Math.max(...yearsBeforeGap);

  // 3. Preliminary sweep (longest → shortest, no bracket excess)
  //    Accumulates rebuildLaterMatInt the same way as Phase 4 of the rebalancer.
  const prelim = {};
  let laterMatInt = 0;
  for (const year of [...rangeYears].sort((a, b) => b - a)) {
    const bond = yearBondMap[year];
    const pi   = bondCalcs(bond, refCPI).piPerBond;
    const qty  = _fyQty(daraByYear?.get(year) ?? dara, laterMatInt, pi);
    const ir   = refCPI / (bond.baseCpi ?? refCPI);
    const ann  = qty * 1000 * ir * (bond.coupon ?? 0);
    prelim[year] = { targetFundedYearQty: qty, annualInterest: ann, laterMatInt, pi };
    laterMatInt += ann;
  }

  // 3b. Pre-ladder interest pool (Build only, spec: 5.0 §Pre-Ladder Interest Option)
  //     Coupons received from all ladder bonds before the ladder starts (years < firstYear).
  //     Applied short→long to zero out the earliest funded years first.
  const preLadderYears = preLadderInterest ? Math.max(0, firstYear - settlementDate.getFullYear()) : 0;
  let preLadderPool = 0;
  const zeroedFundedYears = new Set();
  let partialCreditYear = null, partialCredit = 0;

  if (preLadderYears > 0) {
    const totalAnnualInt = Object.values(prelim).reduce((s, p) => s + p.annualInterest, 0);
    preLadderPool = preLadderYears * totalAnnualInt;

    let remaining = preLadderPool;
    for (const year of [...rangeYears].sort((a, b) => a - b)) {  // short → long
      const need = (daraByYear?.get(year) ?? dara) - prelim[year].laterMatInt;
      if (need <= 0) { zeroedFundedYears.add(year); continue; }  // already covered by laterMatInt
      if (remaining >= need) {
        zeroedFundedYears.add(year);
        remaining -= need;
      } else {
        partialCreditYear = year;
        partialCredit = remaining;
        break;
      }
    }
  }

  // 4. Gap parameters → duration matching → bracket weights
  const gapParams = calcGapParams(gapYears, tipsMap, settlementDate, refCPI, dara, prelim);

  const lowerBond = yearBondMap[lowerYear];
  const upperBond = yearBondMap[upperYear];
  const lowerDuration = calculateMDuration(settlementDate, lowerBond.maturity, lowerBond.coupon ?? 0, lowerBond.yield ?? 0);
  const upperDuration = calculateMDuration(settlementDate, upperBond.maturity, upperBond.coupon ?? 0, upperBond.yield ?? 0);
  const { lowerWeight, upperWeight } = bracketWeights(lowerDuration, upperDuration, gapParams.avgDuration);

  const BL_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const lowerMonth = BL_MONTHS[lowerBond.maturity.getMonth()];
  const upperMonth = BL_MONTHS[upperBond.maturity.getMonth()];
  const lowerCPB = (lowerBond.price ?? 0) / 100 * (refCPI / (lowerBond.baseCpi ?? refCPI)) * 1000;
  const upperCPB = (upperBond.price ?? 0) / 100 * (refCPI / (upperBond.baseCpi ?? refCPI)) * 1000;
  const { lowerExQty, upperExQty } = bracketExcessQtys(gapParams.totalCost, lowerWeight, upperWeight, lowerCPB, upperCPB);
  const totalExcessCost = lowerExQty * lowerCPB + upperExQty * upperCPB;

  // 5. Build output rows (ascending year order for display)
  const results = [];
  const details = [];
  let totalBuyCost = 0;
  for (const year of rangeYears) {
    const bond = yearBondMap[year];
    const isZeroed = zeroedFundedYears.has(year);
    const prelim_pi = prelim[year].pi;
    const prelim_lmi = prelim[year].laterMatInt;
    const yearDara = daraByYear?.get(year) ?? dara;
    const fundedYearQty = isZeroed ? 0
      : year === partialCreditYear
        ? Math.max(0, Math.round((yearDara - prelim_lmi - partialCredit) / prelim_pi))
        : prelim[year].targetFundedYearQty;
    const excessQty  = year === lowerYear ? lowerExQty : year === upperYear ? upperExQty : 0;
    const totQty     = fundedYearQty + excessQty;
    const { indexRatio: ir, costPerBond: cpb } = bondCalcs(bond, refCPI);
    const isBracket = excessQty > 0;
    const monthF    = bond.maturity.getMonth() + 1;
    const halfOrFull = monthF < 7 ? 0.5 : 1.0;
    const principalPerBond     = 1000 * ir;
    const ownRungCouponPerBond = principalPerBond * (bond.coupon ?? 0) * halfOrFull;
    const preLadderCreditForYear = isZeroed
      ? Math.max(0, dara - prelim_lmi)
      : year === partialCreditYear ? partialCredit : 0;
    const fundedYearAmt = fundedYearQty * prelim[year].pi + prelim_lmi + preLadderCreditForYear;
    const exAmt  = isBracket ? excessQty * prelim[year].pi : '';
    const fundedYearCost = fundedYearQty * cpb;
    const exCost = isBracket ? excessQty * cpb : '';
    totalBuyCost += totQty * cpb;
    results.push([
      bond.cusip,             // 0: CUSIP
      fmtDate(bond.maturity), // 1: Maturity
      year,                   // 2: FY
      fundedYearQty,         // 3: Funded Year Qty
      excessQty || '',       // 4: Excess Qty (blank for non-bracket years)
      totQty,                 // 5: Total Qty
      fundedYearAmt,         // 6: Funded Year Amount
      fundedYearCost,        // 7: Funded Year Cost
      exAmt,                  // 8: Excess Amount (bracket only)
      exCost,                 // 9: Excess Cost (bracket only)
    ]);
    details.push({
      fundedYear: year,
      cusip: bond.cusip,
      maturityStr: fmtDate(bond.maturity),
      coupon: bond.coupon ?? 0,
      price: bond.price ?? 0,
      baseCpi: bond.baseCpi ?? refCPI,
      refCPI,
      indexRatio: ir,
      halfOrFull,
      dara,
      fundedYearQty: fundedYearQty,
      fundedYearLaterMatInt: prelim[year].laterMatInt,
      preLadderCreditForYear,
      fundedYearPi: prelim[year].pi,
      fundedYearPrincipalTotal: fundedYearQty * principalPerBond,
      fundedYearOwnRungInt: fundedYearQty * ownRungCouponPerBond,
      fundedYearAmt: fundedYearAmt,
      costPerBond: cpb,
      fundedYearCost: fundedYearCost,
      excessQty: excessQty,
      excessPrincipalTotal: excessQty * principalPerBond,
      excessOwnRungInt: excessQty * ownRungCouponPerBond,
      excessAmt: isBracket ? excessQty * prelim[year].pi : 0,
      excessCost: isBracket ? excessQty * cpb : 0,
    });
  }

  const HDR = ['CUSIP', 'Maturity', 'Funded Year', 'Funded Year Qty', 'Excess Qty', 'Total Qty', 'Funded Year Amount', 'Funded Year Cost', 'Excess Amount', 'Excess Cost'];

  const summary = {
    settleDateDisp, refCPI, dara,
    firstYear, lastYear, gapYears,
    gapParams, lowerYear, upperYear,
    lowerDuration, upperDuration, lowerWeight, upperWeight, lowerMonth, upperMonth,
    lowerExQty, upperExQty, totalExcessCost,
    totalBuyCost,
    preLadderInterest, preLadderYears, preLadderPool,
    zeroedFundedYears: [...zeroedFundedYears].sort((a, b) => a - b),
  };

  return { results, HDR, summary, details };
}

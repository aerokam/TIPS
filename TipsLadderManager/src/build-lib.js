// TIPS Ladder Builder — Build from Scratch
// Pure computation only — no Node.js I/O, no file system, no CLI.
//
// Entry point: runBuild({ dara, lastYear, tipsMap, refCPI, settlementDate })

import { fmtDate } from './rebalance-lib.js';
import { bondCalcs, calculateMDuration, rungAmount } from '../../shared/src/bond-math.js';
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
    if (yr > maxGapYear && mo === 2) {
      if (!anchorAfter || bond.maturity < anchorAfter.maturity) anchorAfter = bond;
    }
  }
  if (!anchorBefore || !anchorAfter)
    throw new Error('Could not find yield interpolation anchors for gap years');

  let totalDuration = 0, totalCost = 0, count = 0;
  const breakdown = [];
  // Process longest→shortest so each gap year's synthetic interest feeds the next shorter rung.
  let runningSynLMI = 0; // accumulates synthetic interest from gap years processed so far
  for (const year of [...gapYears].sort((a, b) => b - a)) {
    const synMat = new Date(year, 1, 15); // Feb 15
    const synYld = interpolateYield(anchorBefore, anchorAfter, synMat);
    const synCpn = _synCoupon(synYld);

    totalDuration += calculateMDuration(settlementDate, synMat, synCpn, synYld);

    // LMI = interest from actual funded-year bonds above this gap year
    //       + synthetic interest from longer hypothetical gap years already processed
    let laterMatInt = runningSynLMI;
    for (const [y, p] of Object.entries(prelim)) {
      if (parseInt(y) > year) laterMatInt += p.annualInterestReal;
    }

    const piPerBond = 1000 + 1000 * synCpn * 0.5;
    const qty = Math.round((dara - laterMatInt) / piPerBond);
    totalCost += qty * 1000;
    breakdown.push({ year, qty, piPerBond, laterMatInt });
    runningSynLMI += qty * 1000 * synCpn; // this gap year's synthetic interest feeds shorter rungs
    count++;
  }

  return { avgDuration: totalDuration / count, totalCost, breakdown };
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

  let rangeYears = Object.keys(yearBondMap).map(Number).sort((a, b) => a - b);
  if (!rangeYears.length) throw new Error('No TIPS bonds found in the specified year range');

  // Gap years: years in [firstYear, lastYear] with no available TIPS
  const gapYears = [];
  for (let y = firstYear; y <= lastYear; y++) {
    if (!yearBondMap[y]) gapYears.push(y);
  }

  // If gap years exist and lastYear < 2040, add the 2040 bond now (before prelim sweep)
  // so its coupons count as laterMatInt for earlier years.
  if (gapYears.length > 0 && !yearBondMap[2040]) {
    for (const bond of tipsMap.values()) {
      if (!bond.maturity) continue;
      if (bond.maturity.getFullYear() !== 2040) continue;
      if (!yearBondMap[2040] || bond.maturity > yearBondMap[2040].maturity)
        yearBondMap[2040] = bond;
    }
    if (!yearBondMap[2040])
      throw new Error('No TIPS available in 2040 for upper bracket');
    rangeYears = [...rangeYears, 2040].sort((a, b) => a - b);
  }

  // 2. Identify brackets (only needed when there are gap years)
  let lowerYear = null, upperYear = null;

  // 3. Preliminary sweep (longest \u2192 shortest, no bracket excess)
  //    Accumulates rebuildLaterMatInt the same way as Phase 4 of the rebalancer.
  const prelim = {};
  let laterMatInt = 0;
  for (const year of [...rangeYears].sort((a, b) => b - a)) {
    const bond = yearBondMap[year];
    const { indexRatio: ir, piPerBond: pi } = bondCalcs(bond, refCPI);
    const qty  = _fyQty(daraByYear?.get(year) ?? dara, laterMatInt, pi);
    // Real interest = qty * (1000 * IR) * coupon
    const annReal = qty * (1000 * ir) * (bond.coupon ?? 0);
    prelim[year] = { targetFundedYearQty: qty, annualInterestReal: annReal, laterMatInt, pi };
    laterMatInt += annReal;
  }

  // 3a. Validate: every funded year must have qty >= 1 (DARA too low if laterMatInt < dara but gap < piPerBond/2)
  for (const year of rangeYears) {
    const { targetFundedYearQty, laterMatInt, pi } = prelim[year];
    const yearDara = daraByYear?.get(year) ?? dara;
    if (targetFundedYearQty === 0 && yearDara > laterMatInt) {
      const minNeeded = Math.ceil(laterMatInt + pi);
      throw new Error(`DARA too low for ${year}: need at least $${minNeeded.toLocaleString()} to fund one bond (pi/bond = $${Math.round(pi).toLocaleString()}, later-mat interest = $${Math.round(laterMatInt).toLocaleString()})`);
    }
  }

  // 3b. Pre-ladder interest pool (Build only, spec: 5.0 §Pre-Ladder Interest Option)
  //     Coupons received from all ladder bonds before the ladder starts (years < firstYear).
  //     Applied short→long to zero out the earliest funded years first.
  const preLadderYears = preLadderInterest ? Math.max(0, firstYear - settlementDate.getFullYear()) : 0;
  let preLadderPool = 0;
  const zeroedFundedYears = new Set();
  let partialCreditYear = null, partialCredit = 0;

  if (preLadderYears > 0) {
    const totalAnnualIntReal = Object.values(prelim).reduce((s, p) => s + p.annualInterestReal, 0);
    preLadderPool = preLadderYears * totalAnnualIntReal;

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

  // 4. Gap parameters → duration matching → bracket weights (only when gap years exist)
  let gapParams = null;
  let lowerDuration = null, upperDuration = null, lowerWeight = null, upperWeight = null;
  let lowerMonth = null, upperMonth = null;
  let lowerExQty = 0, upperExQty = 0, totalExcessCost = 0;

  if (gapYears.length > 0) {
    const minGapYear = Math.min(...gapYears);
    upperYear = 2040;
    // yearBondMap[2040] is guaranteed present (added before prelim sweep above)
    const yearsBeforeGap = rangeYears.filter(y => y < minGapYear);
    if (!yearsBeforeGap.length) throw new Error('No TIPS bonds available before the gap');
    lowerYear = Math.max(...yearsBeforeGap);

    gapParams = calcGapParams(gapYears, tipsMap, settlementDate, refCPI, dara, prelim);

    const lowerBond = yearBondMap[lowerYear];
    const upperBond = yearBondMap[upperYear];
    lowerDuration = calculateMDuration(settlementDate, lowerBond.maturity, lowerBond.coupon ?? 0, lowerBond.yield ?? 0);
    upperDuration = calculateMDuration(settlementDate, upperBond.maturity, upperBond.coupon ?? 0, upperBond.yield ?? 0);
    ({ lowerWeight, upperWeight } = bracketWeights(lowerDuration, upperDuration, gapParams.avgDuration));

    const BL_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    lowerMonth = BL_MONTHS[lowerBond.maturity.getMonth()];
    upperMonth = BL_MONTHS[upperBond.maturity.getMonth()];
    const lowerCPB = (lowerBond.price ?? 0) / 100 * (refCPI / (lowerBond.baseCpi ?? refCPI)) * 1000;
    const upperCPB = (upperBond.price ?? 0) / 100 * (refCPI / (upperBond.baseCpi ?? refCPI)) * 1000;
    const lowerCPBReal = (lowerBond.price ?? 0) / 100 * 1000;
    const upperCPBReal = (upperBond.price ?? 0) / 100 * 1000;
    ({ lowerExQty, upperExQty } = bracketExcessQtys(gapParams.totalCost, lowerWeight, upperWeight, lowerCPBReal, upperCPBReal));
    totalExcessCost = lowerExQty * lowerCPB + upperExQty * upperCPB;
  }

  // 5. Corrected long→short sweep over actual funded years only.
  //    Recomputes fundedYearQty using an LMI pool that includes actual excess bracket bond interest.
  //    Gap year slots are skipped — no actual bonds exist there; the bracket excess covers them.
  //    Spec: 2.0 TIPS Ladders §Algorithm step 4.
  const corrFYQty = {};
  const corrLMI   = {};
  {
    const exByYear = {};
    if (lowerYear != null) exByYear[lowerYear] = lowerExQty;
    if (upperYear != null) exByYear[upperYear] = (exByYear[upperYear] ?? 0) + upperExQty;

    let runningLMI = 0;
    for (const year of [...rangeYears].sort((a, b) => b - a)) {
      corrLMI[year] = runningLMI;
      const bond    = yearBondMap[year];
      const { indexRatio: ir } = bondCalcs(bond, refCPI);
      const pi      = prelim[year].pi;
      const yearDara = daraByYear?.get(year) ?? dara;
      const isZrd   = zeroedFundedYears.has(year);
      const fyQty   = isZrd ? 0
        : year === partialCreditYear
          ? Math.max(0, Math.round((yearDara - runningLMI - partialCredit) / pi))
          : Math.max(0, Math.round((yearDara - runningLMI) / pi));
      corrFYQty[year] = fyQty;
      const exQty = exByYear[year] ?? 0;
      runningLMI += (fyQty + exQty) * 1000 * ir * (bond.coupon ?? 0);
    }
  }

  // 6. Build output rows (ascending year order for display)
  const results = [];
  const details = [];
  let totalBuyCost = 0;
  for (const year of rangeYears) {
    const bond = yearBondMap[year];
    const isZeroed = zeroedFundedYears.has(year);
    const prelim_pi = prelim[year].pi;
    const corr_lmi  = corrLMI[year] ?? prelim[year].laterMatInt;
    const yearDara = daraByYear?.get(year) ?? dara;
    const fundedYearQty = corrFYQty[year] ?? prelim[year].targetFundedYearQty;
    const excessQty  = year === lowerYear ? lowerExQty : year === upperYear ? upperExQty : 0;
    const totQty     = fundedYearQty + excessQty;
    const { indexRatio: ir, costPerBond: cpb } = bondCalcs(bond, refCPI);
    const isBracket = excessQty > 0;
    const monthF    = bond.maturity.getMonth() + 1;
    const halfOrFull = monthF < 7 ? 0.5 : 1.0;
    const principalPerBond     = 1000 * ir;
    const ownRungCouponPerBond = principalPerBond * (bond.coupon ?? 0) * halfOrFull;
    const preLadderCreditForYear = isZeroed
      ? Math.max(0, dara - corr_lmi)
      : year === partialCreditYear ? partialCredit : 0;
    const fundedYearAmt = fundedYearQty * prelim_pi + corr_lmi + preLadderCreditForYear;
    const exAmt  = isBracket ? excessQty * prelim_pi : '';
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
      yield: bond.yield ?? 0,
      price: bond.price ?? 0,
      baseCpi: bond.baseCpi ?? refCPI,
      refCPI,
      indexRatio: ir,
      halfOrFull,
      dara: yearDara,
      fundedYearQty: fundedYearQty,
      fundedYearLaterMatInt: corr_lmi,
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
      excessAmt: isBracket ? excessQty * prelim_pi : 0,
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

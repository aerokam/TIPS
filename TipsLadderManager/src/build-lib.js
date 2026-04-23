// TIPS Ladder Builder — Build from Scratch
// Pure computation only — no Node.js I/O, no file system, no CLI.
//
// Entry point: runBuild({ dara, lastYear, tipsMap, refCPI, settlementDate })

import { fmtDate } from './rebalance-lib.js';
import { bondCalcs, calculateMDuration, rungAmount } from '../../shared/src/bond-math.js';
import { interpolateYield, syntheticCoupon as _synCoupon, bracketWeights, bracketExcessQtys, fyQty as _fyQty } from './gap-math.js';

export const MAX_LAST_YEAR = 2066;

// ─── Gap parameters for build-from-scratch ─────────────────────────────────────
// prelim: { [year]: { targetFYQty, annualInterest } }
// prelim passed here must be the effective prelim: zeroed funded years have annualInterest = 0
// (they have no actual TIPS purchased and generate no coupon income).
// pliCreditByGapYear: remaining PLI pool allocated to each gap year (short→long interleaved pass).
function calcGapParams(gapYears, tipsMap, settlementDate, refCPI, dara, prelim, pliCreditByGapYear = {}) {
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

    const synDur = calculateMDuration(settlementDate, synMat, synCpn, synYld);
    totalDuration += synDur;

    // LMI = effective actual TIPS interest from funded years above (zeroed years contribute 0)
    //       + synthetic interest from longer hypothetical gap years already processed
    let laterMatInt = runningSynLMI;
    for (const [y, p] of Object.entries(prelim)) {
      if (parseInt(y) > year) laterMatInt += p.annualInterest;
    }

    const piPerBond = 1000 + 1000 * synCpn * 0.5;
    // Treat synthetic TIPS like any other rung: subtract LMI and PLI credit before sizing.
    const qty = Math.max(0, Math.round((dara - laterMatInt - (pliCreditByGapYear[year] ?? 0)) / piPerBond));
    totalCost += qty * 1000;
    breakdown.push({ year, qty, piPerBond, laterMatInt, pliCredit: pliCreditByGapYear[year] ?? 0, dur: synDur });
    runningSynLMI += qty * 1000 * synCpn; // this gap year's synthetic interest feeds shorter rungs
    count++;
  }

  return { avgDuration: totalDuration / count, totalCost, breakdown };
}

// ─── Future 30Y parameters for build-from-scratch ──────────────────────────────
// Uses 2056 coupon/yield as flat-curve anchor for all hypothetical future 30Y TIPS.
// Processes longest-to-shortest with a running LMI accumulator (same pattern as calcGapParams).
// No actual TIPS exist above future 30Y years, so inter-future synthetic LMI is the only source.
function calcFuture30yParams(future30yYears, bond2056, settlementDate, dara) {
  if (!future30yYears.length || !bond2056) return { avgDuration: 0, future30yTotalCost: 0, breakdown: [] };
  const coupon2056 = bond2056.coupon ?? 0;
  const yield2056  = bond2056.yield  ?? 0;
  // Feb maturity (30-year TIPS issued in Feb) → halfOrFull = 0.5; IR = 1.0 (par assumption)
  const piPerFuture30yTips = 1000 + 1000 * coupon2056 * 0.5;
  let totalDuration = 0, future30yTotalCost = 0, runningFuture30yLMI = 0;
  const breakdown = [];
  for (const year of [...future30yYears].sort((a, b) => b - a)) {
    const futureMat = new Date(year, 1, 15); // Feb 15
    const dur = calculateMDuration(settlementDate, futureMat, coupon2056, yield2056);
    totalDuration += dur;
    const qty = Math.max(0, Math.round((dara - runningFuture30yLMI) / piPerFuture30yTips));
    breakdown.push({ year, qty, piPerBond: piPerFuture30yTips, laterMatInt: runningFuture30yLMI, dur });
    runningFuture30yLMI += qty * 1000 * coupon2056;
    future30yTotalCost  += qty * 1000;
  }
  return { avgDuration: totalDuration / future30yYears.length, future30yTotalCost, breakdown, future30ySeedLMI: runningFuture30yLMI };
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

  // Find the maximum year with actual TIPS data
  let maxTipsYear = 0;
  for (const bond of tipsMap.values()) {
    if (bond.maturity) maxTipsYear = Math.max(maxTipsYear, bond.maturity.getFullYear());
  }

  // Gap years: within actual TIPS range but no TIPS issued.
  // Future 30Y years: beyond maxTipsYear (hypothetical, covered by future 30Y cover pair).
  const gapYears = [], future30yYears = [];
  for (let y = firstYear; y <= lastYear; y++) {
    if (!yearBondMap[y]) {
      if (y > maxTipsYear) future30yYears.push(y);
      else gapYears.push(y);
    }
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

  // ── Future 30Y cover pair identification ─────────────────────────────────────
  // future30yLower = 2056 (shorter duration due to higher coupon on recently-issued 30y TIPS)
  // future30yUpper = 2052 (longer duration: near-zero coupon from 2022 issuance ≈ zero-coupon bond)
  let future30yLowerYear = null, future30yUpperYear = null;
  let future30yLowerCoverBond = null, future30yUpperCoverBond = null;
  if (future30yYears.length > 0) {
    for (const bond of tipsMap.values()) {
      if (!bond.maturity) continue;
      const yr = bond.maturity.getFullYear();
      if (yr === 2056 && (!future30yLowerCoverBond || bond.maturity > future30yLowerCoverBond.maturity))
        future30yLowerCoverBond = bond;
      if (yr === 2052 && (!future30yUpperCoverBond || bond.maturity > future30yUpperCoverBond.maturity))
        future30yUpperCoverBond = bond;
    }
    if (!future30yLowerCoverBond) throw new Error('No 2056 TIPS found for Future 30Y lower cover');
    if (!future30yUpperCoverBond) throw new Error('No 2052 TIPS found for Future 30Y upper cover');
    future30yLowerYear = 2056;
    future30yUpperYear = 2052;
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
    const qty  = year > lastYear ? 0 : _fyQty(daraByYear?.get(year) ?? dara, laterMatInt, pi);
    // Annual interest = qty * 1000 * ir * coupon
    const annInt = qty * 1000 * ir * (bond.coupon ?? 0);
    prelim[year] = { targetFundedYearQty: qty, annualInterest: annInt, laterMatInt, pi };
    laterMatInt += annInt;
  }

  // 3a. Validate: every funded year must have qty >= 1 (DARA too low if laterMatInt < dara but gap < piPerBond/2)
  for (const year of rangeYears) {
    if (year > lastYear) continue;
    const { targetFundedYearQty, laterMatInt, pi } = prelim[year];
    const yearDara = daraByYear?.get(year) ?? dara;
    if (targetFundedYearQty === 0 && yearDara > laterMatInt) {
      const minNeeded = Math.ceil(laterMatInt + pi);
      throw new Error(`DARA too low for ${year}: need at least $${minNeeded.toLocaleString()} to fund one bond (pi/bond = $${Math.round(pi).toLocaleString()}, later-mat interest = $${Math.round(laterMatInt).toLocaleString()})`);
    }
  }

  // 3b. Pre-ladder interest pool (Build only, spec: 4.0 §Pre-Ladder Interest Option)
  //     Coupons received from all ladder TIPS before the ladder starts (years < firstYear).
  //     Single interleaved pass short→long over ALL year types (funded + gap).
  //     Gap years consume pool before longer-dated funded years — e.g. 2037-2039 before 2040.
  const preLadderYears = preLadderInterest ? Math.max(0, firstYear - settlementDate.getFullYear()) : 0;
  let preLadderPool = 0;
  const zeroedFundedYears = new Set();
  const pliCreditByGapYear = {};
  let partialCreditYear = null, partialCredit = 0;

  if (preLadderYears > 0) {
    const totalAnnualInt = Object.values(prelim).reduce((s, p) => s + p.annualInterest, 0);
    preLadderPool = preLadderYears * totalAnnualInt;

    const gapYearSet = new Set(gapYears);
    const allYearsSorted = [...new Set([...rangeYears, ...gapYears])].sort((a, b) => a - b);
    let remaining = preLadderPool;

    for (const year of allYearsSorted) {
      if (gapYearSet.has(year)) {
        // Gap year: estimate need using full prelim LMI (approximation — zeroing not yet complete).
        // Synthetic LMI from longer gap years not yet known; omitted consistently with funded year pass.
        const actualTIPSLMI = Object.entries(prelim)
          .filter(([y]) => parseInt(y) > year)
          .reduce((s, [, p]) => s + p.annualInterest, 0);
        const need = Math.max(0, dara - actualTIPSLMI);
        if (remaining >= need) {
          pliCreditByGapYear[year] = need;
          remaining -= need;
        } else {
          pliCreditByGapYear[year] = remaining;
          remaining = 0;
          break;
        }
      } else {
        // Funded year
        const need = (daraByYear?.get(year) ?? dara) - prelim[year].laterMatInt;
        if (need <= 0) { zeroedFundedYears.add(year); continue; }
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
  }

  // 3c. Build effective prelim for gap calculation: zeroed funded years have no actual TIPS
  //     purchased, so they generate no coupon income — zero their annualInterest.
  let effectivePrelim = prelim;
  if (zeroedFundedYears.size > 0) {
    effectivePrelim = { ...prelim };
    for (const yr of zeroedFundedYears) {
      if (effectivePrelim[yr]) effectivePrelim[yr] = { ...effectivePrelim[yr], annualInterest: 0 };
    }
  }

  const BL_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // 4a. Future 30Y parameters → duration matching → cover excess quantities (MUST run before gap params
  //     so future 30Y cover excess LMI at 2056/2052 can be included in the gap cost calculation).
  let future30yParams = null;
  let future30yLowerDuration = 0, future30yUpperDuration = 0;
  let future30yUpperWeight = 0, future30yLowerWeight = 0;
  let future30yUpperExQty = 0, future30yLowerExQty = 0;
  let future30yFellBack = false;
  let future30yTotalExcessCost = 0;
  let future30yLowerMonth = null, future30yUpperMonth = null;

  if (future30yYears.length > 0) {
    future30yParams = calcFuture30yParams(future30yYears, future30yLowerCoverBond, settlementDate, dara);
    future30yLowerDuration = calculateMDuration(settlementDate, future30yLowerCoverBond.maturity, future30yLowerCoverBond.coupon ?? 0, future30yLowerCoverBond.yield ?? 0);
    future30yUpperDuration = calculateMDuration(settlementDate, future30yUpperCoverBond.maturity, future30yUpperCoverBond.coupon ?? 0, future30yUpperCoverBond.yield ?? 0);

    ({ lowerWeight: future30yLowerWeight, upperWeight: future30yUpperWeight } = bracketWeights(future30yLowerDuration, future30yUpperDuration, future30yParams.avgDuration));
    if (future30yParams.avgDuration > future30yUpperDuration) future30yFellBack = true;

    const future30yLowerCPB = (future30yLowerCoverBond.price ?? 0) / 100 * (refCPI / (future30yLowerCoverBond.baseCpi ?? refCPI)) * 1000;
    const future30yUpperCPB = (future30yUpperCoverBond.price ?? 0) / 100 * (refCPI / (future30yUpperCoverBond.baseCpi ?? refCPI)) * 1000;
    ({ lowerExQty: future30yLowerExQty, upperExQty: future30yUpperExQty } = bracketExcessQtys(future30yParams.future30yTotalCost, future30yLowerWeight, future30yUpperWeight, future30yLowerCPB, future30yUpperCPB));
    future30yTotalExcessCost = future30yLowerExQty * future30yLowerCPB + future30yUpperExQty * future30yUpperCPB;
    future30yLowerMonth = BL_MONTHS[future30yLowerCoverBond.maturity.getMonth()];
    future30yUpperMonth = BL_MONTHS[future30yUpperCoverBond.maturity.getMonth()];
  }

  // 4b. Gap parameters → duration matching → bracket weights (only when gap years exist).
  //     Augment prelim with future 30Y cover excess LMI before calling calcGapParams so that
  //     the gap cost correctly reflects interest from additional 2056/2052 excess bonds.
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

    // Augment effectivePrelim with future 30Y cover excess interest (2052 and 2056 are above gap years)
    let augmentedPrelim = effectivePrelim;
    if (future30yYears.length > 0) {
      augmentedPrelim = { ...effectivePrelim };
      if (future30yUpperExQty > 0) {
        const { indexRatio: irU } = bondCalcs(future30yUpperCoverBond, refCPI);
        const extraU = future30yUpperExQty * 1000 * irU * (future30yUpperCoverBond.coupon ?? 0);
        augmentedPrelim[future30yUpperYear] = { ...effectivePrelim[future30yUpperYear], annualInterest: (effectivePrelim[future30yUpperYear]?.annualInterest ?? 0) + extraU };
      }
      if (future30yLowerExQty > 0) {
        const { indexRatio: irL } = bondCalcs(future30yLowerCoverBond, refCPI);
        const extraL = future30yLowerExQty * 1000 * irL * (future30yLowerCoverBond.coupon ?? 0);
        augmentedPrelim[future30yLowerYear] = { ...effectivePrelim[future30yLowerYear], annualInterest: (effectivePrelim[future30yLowerYear]?.annualInterest ?? 0) + extraL };
      }
    }

    gapParams = calcGapParams(gapYears, tipsMap, settlementDate, refCPI, dara, augmentedPrelim, pliCreditByGapYear);

    const lowerBond = yearBondMap[lowerYear];
    const upperBond = yearBondMap[upperYear];
    lowerDuration = calculateMDuration(settlementDate, lowerBond.maturity, lowerBond.coupon ?? 0, lowerBond.yield ?? 0);
    upperDuration = calculateMDuration(settlementDate, upperBond.maturity, upperBond.coupon ?? 0, upperBond.yield ?? 0);
    ({ lowerWeight, upperWeight } = bracketWeights(lowerDuration, upperDuration, gapParams.avgDuration));

    lowerMonth = BL_MONTHS[lowerBond.maturity.getMonth()];
    upperMonth = BL_MONTHS[upperBond.maturity.getMonth()];
    const lowerCPB = (lowerBond.price ?? 0) / 100 * (refCPI / (lowerBond.baseCpi ?? refCPI)) * 1000;
    const upperCPB = (upperBond.price ?? 0) / 100 * (refCPI / (upperBond.baseCpi ?? refCPI)) * 1000;
    ({ lowerExQty: lowerExQty, upperExQty: upperExQty } = bracketExcessQtys(gapParams.totalCost, lowerWeight, upperWeight, lowerCPB, upperCPB));
    totalExcessCost = lowerExQty * lowerCPB + upperExQty * upperCPB;
  }

  // 5. Corrected long→short sweep over actual funded years only.
  //    Recomputes fundedYearQty using an LMI pool that includes actual excess bracket bond interest.
  //    Gap year slots are skipped — no actual bonds exist there; the bracket excess covers them.
  //    Spec: 2.0 TIPS Ladders §Algorithm.
  const corrFYQty = {};
  const corrLMI   = {};
  {
    const exByYear = {};
    if (future30yUpperYear != null) exByYear[future30yUpperYear] = (exByYear[future30yUpperYear] ?? 0) + future30yUpperExQty;
    if (future30yLowerYear != null) exByYear[future30yLowerYear] = (exByYear[future30yLowerYear] ?? 0) + future30yLowerExQty;
    if (lowerYear != null) exByYear[lowerYear] = (exByYear[lowerYear] ?? 0) + lowerExQty;
    if (upperYear != null) exByYear[upperYear] = (exByYear[upperYear] ?? 0) + upperExQty;

    let runningLMI = 0;
    for (const year of [...rangeYears].sort((a, b) => b - a)) {
      corrLMI[year] = runningLMI;
      const bond    = yearBondMap[year];
      const { indexRatio: ir } = bondCalcs(bond, refCPI);
      const pi      = prelim[year].pi;
      const yearDara = daraByYear?.get(year) ?? dara;
      const isZrd   = zeroedFundedYears.has(year);
      
      const exQty = exByYear[year] ?? 0;
      const excessLMI = exQty * 1000 * ir * (bond.coupon ?? 0);

      const fyQty   = (isZrd || year > lastYear) ? 0
        : year === partialCreditYear
          ? Math.max(0, Math.round((yearDara - runningLMI - excessLMI - partialCredit) / pi))
          : Math.max(0, Math.round((yearDara - runningLMI - excessLMI) / pi));
      
      corrFYQty[year] = fyQty;
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
    const gapExQty    = year === lowerYear ? lowerExQty : year === upperYear ? upperExQty : 0;
    const future30yExQty = year === future30yLowerYear ? future30yLowerExQty : year === future30yUpperYear ? future30yUpperExQty : 0;
    const excessQty   = gapExQty + future30yExQty;
    const totQty      = fundedYearQty + excessQty;
    const { indexRatio: ir, costPerBond: cpb } = bondCalcs(bond, refCPI);
    const excessLMI   = excessQty * 1000 * ir * (bond.coupon ?? 0);
    
    const isBracket    = excessQty > 0;
    const isFuture30yCover = future30yExQty > 0;
    const monthF    = bond.maturity.getMonth() + 1;
    const halfOrFull = monthF < 7 ? 0.5 : 1.0;
    const principalPerBond     = 1000 * ir;
    const ownRungCouponPerBond = principalPerBond * (bond.coupon ?? 0) * halfOrFull;
    
    const preLadderCreditForYear = isZeroed
      ? Math.max(0, yearDara - (corr_lmi + excessLMI))
      : year === partialCreditYear ? partialCredit : 0;
    const fundedYearAmt = year > lastYear ? 0 : fundedYearQty * prelim_pi + corr_lmi + excessLMI + preLadderCreditForYear;
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
      longerDatedLMI: corr_lmi,
      excessLMI_After: excessLMI,
      preLadderCreditForYear,
      fundedYearPi: prelim[year].pi,
      fundedYearPrincipalTotal: fundedYearQty * principalPerBond,
      fundedYearOwnRungInt: fundedYearQty * ownRungCouponPerBond,
      fundedYearAmt: fundedYearAmt,
      costPerBond: cpb,
      fundedYearCost: fundedYearCost,
      isFuture30yCover,
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
    firstYear, lastYear, gapYears, future30yYears,
    gapParams, lowerYear, upperYear,
    lowerDuration, upperDuration, lowerWeight, upperWeight, lowerMonth, upperMonth,
    lowerExQty, upperExQty, totalExcessCost,
    future30yLowerYear, future30yUpperYear,
    future30yLowerDuration, future30yUpperDuration, future30yUpperWeight, future30yLowerWeight,
    future30yLowerExQty, future30yUpperExQty, future30yFellBack, future30yTotalExcessCost,
    future30yLowerMonth, future30yUpperMonth,
    future30yParams,
    totalBuyCost,
    preLadderInterest, preLadderYears, preLadderPool,
    zeroedFundedYears: [...zeroedFundedYears].sort((a, b) => a - b),
  };

  return { results, HDR, summary, details };
}

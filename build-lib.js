// TIPS Ladder Builder — Build from Scratch
// Pure computation only — no Node.js I/O, no file system, no CLI.
//
// Entry point: runBuildFromScratch({ dara, lastYear, tipsMap, refCPI, settlementDate })

import { calculatePIPerBond, calculateMDuration, fmtDate } from './rebalance-lib.js';

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
    const synYld = anchorBefore.yield +
      (synMat - anchorBefore.maturity) * (anchorAfter.yield - anchorBefore.yield) /
      (anchorAfter.maturity - anchorBefore.maturity);
    const synCpn = Math.max(0.00125, Math.floor(synYld * 100 / 0.125) * 0.00125);

    totalDuration += calculateMDuration(settlementDate, synMat, synCpn, synYld);

    // Sum annual interest from all non-gap bonds with maturity year > this gap year
    let laterMatInt = 0;
    for (const [y, p] of Object.entries(prelim)) {
      if (parseInt(y) > year) laterMatInt += p.annualInterest;
    }

    const piPerBond = 1000 + 1000 * synCpn * 0.5;
    totalCost += Math.max(0, Math.round((dara - laterMatInt) / piPerBond)) * 1000;
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
export function runBuildFromScratch({ dara, lastYear, tipsMap, refCPI, settlementDate }) {
  const firstYear      = settlementDate.getFullYear();
  const settleDateDisp = fmtDate(settlementDate);

  // 1. Build yearBondMap: for each year in [firstYear, lastYear],
  //    pick the latest-maturing TIPS that matures after settlement.
  const yearBondMap = {};
  for (const bond of tipsMap.values()) {
    if (!bond.maturity || bond.maturity <= settlementDate) continue;
    const yr = bond.maturity.getFullYear();
    if (yr < firstYear || yr > lastYear) continue;
    if (!yearBondMap[yr] || bond.maturity > yearBondMap[yr].maturity)
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
    const pi   = calculatePIPerBond(bond.cusip, bond.maturity, refCPI, tipsMap);
    const qty  = Math.max(0, Math.round((dara - laterMatInt) / pi));
    const ir   = refCPI / (bond.baseCpi ?? refCPI);
    const ann  = qty * 1000 * ir * (bond.coupon ?? 0);
    prelim[year] = { targetFYQty: qty, annualInterest: ann, laterMatInt, pi };
    laterMatInt += ann;
  }

  // 4. Gap parameters → duration matching → bracket weights
  const gapParams = calcGapParams(gapYears, tipsMap, settlementDate, refCPI, dara, prelim);

  const lowerBond = yearBondMap[lowerYear];
  const upperBond = yearBondMap[upperYear];
  const lowerDur  = calculateMDuration(settlementDate, lowerBond.maturity, lowerBond.coupon ?? 0, lowerBond.yield ?? 0);
  const upperDur  = calculateMDuration(settlementDate, upperBond.maturity, upperBond.coupon ?? 0, upperBond.yield ?? 0);
  const lowerWt   = (upperDur - gapParams.avgDuration) / (upperDur - lowerDur);
  const upperWt   = 1 - lowerWt;

  const BL_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const lowerMonth = BL_MONTHS[lowerBond.maturity.getMonth()];
  const upperMonth = BL_MONTHS[upperBond.maturity.getMonth()];
  const lowerCPB  = (lowerBond.price ?? 0) / 100 * (refCPI / (lowerBond.baseCpi ?? refCPI)) * 1000;
  const upperCPB  = (upperBond.price ?? 0) / 100 * (refCPI / (upperBond.baseCpi ?? refCPI)) * 1000;
  const lowerExQty     = lowerCPB > 0 ? Math.round(gapParams.totalCost * lowerWt / lowerCPB) : 0;
  const upperExQty     = upperCPB > 0 ? Math.round(gapParams.totalCost * upperWt / upperCPB) : 0;
  const totalExcessCost = lowerExQty * lowerCPB + upperExQty * upperCPB;

  // 5. Build output rows (ascending year order for display)
  const results = [];
  const details = [];
  let totalBuyCost = 0;
  for (const year of rangeYears) {
    const bond      = yearBondMap[year];
    const fyQty     = prelim[year].targetFYQty;
    const exQty     = year === lowerYear ? lowerExQty : year === upperYear ? upperExQty : 0;
    const totQty    = fyQty + exQty;
    const ir        = Math.round(refCPI / (bond.baseCpi ?? refCPI) * 1e5) / 1e5;
    const cpb       = (bond.price ?? 0) / 100 * ir * 1000;
    const isBracket = exQty > 0;
    const monthF    = bond.maturity.getMonth() + 1;
    const halfOrFull = monthF < 7 ? 0.5 : 1.0;
    const principalPerBond     = 1000 * ir;
    const ownRungCouponPerBond = principalPerBond * (bond.coupon ?? 0) * halfOrFull;
    const fyAmt  = fyQty * prelim[year].pi + prelim[year].laterMatInt;
    const exAmt  = isBracket ? exQty * prelim[year].pi : '';
    const fyCost = fyQty * cpb;
    const exCost = isBracket ? exQty * cpb : '';
    totalBuyCost += totQty * cpb;
    results.push([
      bond.cusip,             // 0: CUSIP
      fmtDate(bond.maturity), // 1: Maturity
      year,                   // 2: FY
      fyQty,                  // 3: FY Qty
      exQty || '',            // 4: Excess Qty (blank for non-bracket years)
      totQty,                 // 5: Total Qty
      fyAmt,                  // 6: FY Amount
      fyCost,                 // 7: FY Cost
      exAmt,                  // 8: Excess Amount (bracket only)
      exCost,                 // 9: Excess Cost (bracket only)
    ]);
    details.push({
      fy: year,
      cusip: bond.cusip,
      maturityStr: fmtDate(bond.maturity),
      coupon: bond.coupon ?? 0,
      price: bond.price ?? 0,
      baseCpi: bond.baseCpi ?? refCPI,
      refCPI,
      indexRatio: ir,
      halfOrFull,
      dara,
      fy_qty: fyQty,
      fy_laterMatInt: prelim[year].laterMatInt,
      fy_pi: prelim[year].pi,
      fy_principalTotal: fyQty * principalPerBond,
      fy_ownRungInt: fyQty * ownRungCouponPerBond,
      fy_amt: fyAmt,
      fy_costPerBond: cpb,
      fy_cost: fyCost,
      ex_qty: exQty,
      ex_principalTotal: exQty * principalPerBond,
      ex_ownRungInt: exQty * ownRungCouponPerBond,
      ex_amt: isBracket ? exQty * prelim[year].pi : 0,
      ex_cost: isBracket ? exQty * cpb : 0,
    });
  }

  const HDR = ['CUSIP', 'Maturity', 'FY', 'FY Qty', 'Excess Qty', 'Total Qty', 'FY Amount', 'FY Cost', 'Excess Amount', 'Excess Cost'];

  const summary = {
    settleDateDisp, refCPI, dara,
    firstYear, lastYear, gapYears,
    gapParams, lowerYear, upperYear,
    lowerDur, upperDur, lowerWt, upperWt, lowerMonth, upperMonth,
    lowerExQty, upperExQty, totalExcessCost,
    totalBuyCost,
  };

  return { results, HDR, summary, details };
}

// TIPS Ladder Builder — Build from Scratch
// Pure computation only — no Node.js I/O, no file system, no CLI.
//
// Entry point: runBuild({ dara, lastYear, tipsMap, refCPI, settlementDate })

import { fmtDate } from './date-util.js';
import { bondCalcs, calculateMDuration, rungAmount, calcMktWtdAvg } from '../../shared/src/bond-math.js';
import { sizeLadder, selectLadderBonds, fundedYearAmount } from './ladder-core.js';

export const MAX_LAST_YEAR = 2066;

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
export function runBuild({ dara, firstYear: firstYearOpt, lastYear, tipsMap, refCPI, settlementDate, maturityPref = 'last', couponPref = 'higher', preLadderInterest = false, daraByYear = null, yearOverrides = null }) {
  const firstYear      = firstYearOpt ?? settlementDate.getFullYear();
  const settleDateDisp = fmtDate(settlementDate);
  const settlementYear = settlementDate.getFullYear();

  // 1. Canonical ladder bond selection (shared with rebalance — single source of truth).
  const {
    yearBondMap, yearTipsListMap, rangeYears, gapYears, future30yYears,
    future30yLowerYear, future30yUpperYear, future30yLowerCoverBond, future30yUpperCoverBond,
  } = selectLadderBonds({ tipsMap, firstYear, lastYear, settlementDate, maturityPref, couponPref, yearOverrides });

  if (!rangeYears.length) throw new Error('No TIPS bonds found in the specified year range');

  // 2-5. Shared sizing pipeline — prelim, future-30Y/AMD, PLI, gap/excess, corrected sweep.
  //        Lives in ladder-core.js: the IDENTICAL code path build and rebalance both run.
  const {
    prelim, corrFYQty, corrLMI, corrRungs,
    zeroedFundedYears, partialCreditYear, partialCredit,
    lowerYear, upperYear, lowerExQty, upperExQty, lowerWeight, upperWeight,
    lowerDuration, upperDuration, lowerMonth, upperMonth, totalExcessCost,
    gapParams, future30yParams,
    future30yLowerDuration, future30yUpperDuration, future30yUpperWeight, future30yLowerWeight,
    future30yLowerExQty, future30yUpperExQty, future30yFellBack, future30yTotalExcessCost,
    future30yLowerMonth, future30yUpperMonth,
    future30yUpperAnnualAmdByYear, calcFuture30yUpperAnnualAmd,
    amdLifetimeByBracketYear, future30yLMITotal, calcFuture30yRollCoupon,
    preLadderYears, preLadderPool, preLadderCouponPool, preLadderAmdPool, preLadderRollCouponPool,
  } = sizeLadder({
    dara, daraByYear, firstYear, lastYear,
    rangeYears, gapYears, future30yYears,
    yearBondMap, yearTipsListMap, tipsMap, refCPI, settlementDate, settlementYear,
    preLadderInterest,
    future30yLowerCoverBond, future30yUpperCoverBond, future30yLowerYear, future30yUpperYear,
  });

  // 6. Build output rows (ascending year order for display)
  const results = [];
  const details = [];
  let totalBuyCost = 0;
  for (const year of rangeYears) {
    const repBond = yearBondMap[year];                        // representative TIPS (bracket/cover excess rides this)
    const isZeroed = zeroedFundedYears.has(year);
    const corr_lmi  = corrLMI[year] ?? prelim[year].laterMatInt;
    const yearDara = daraByYear?.get(year) ?? dara;
    const rungs = corrRungs[year] ?? [{ ...bondCalcs(repBond, refCPI), bond: repBond, coupon: repBond.coupon ?? 0, qty: corrFYQty[year] ?? 0 }];
    const repPi = prelim[year].pi;                            // representative P+I (bracket excess uses this)

    // Year excess (gap / future-30Y). Bracket years hold a single TIPS, so the excess rides row 0.
    const gapExQty    = year === lowerYear ? lowerExQty : year === upperYear ? upperExQty : 0;
    const future30yExQty = year === future30yLowerYear ? future30yLowerExQty : year === future30yUpperYear ? future30yUpperExQty : 0;
    const excessQty   = gapExQty + future30yExQty;
    const { indexRatio: irRep, costPerBond: cpbRep } = bondCalcs(repBond, refCPI);
    const excessLMI   = excessQty * 1000 * irRep * (repBond.coupon ?? 0);
    const future30yAmd  = calcFuture30yUpperAnnualAmd(year);
    const future30yRoll = calcFuture30yRollCoupon(year);   // cover-roll coupon credited to 2053–56
    const isBracket    = excessQty > 0;
    const isFuture30yCover = future30yExQty > 0;

    // Year-level funded aggregates — Σ over sub-rungs, each sized from its OWN pi/ir/coupon
    // (multi-TIPS years: quarterly ≤~2030, Jan/Jul ≤~2035). N=1 reproduces the legacy single-TIPS year.
    let fundedYearQty = 0, fundedYearPITotal = 0, fundedPrincipalTotal = 0, fundedOwnRungInt = 0;
    const fundedRungs = [];
    for (const r of rungs) {
      const moF = r.bond.maturity.getMonth() + 1;
      const hof = moF < 7 ? 0.5 : 1.0, nP = moF < 7 ? 1 : 2;
      const ppb = 1000 * r.ir;
      fundedYearQty += r.qty;
      fundedYearPITotal += r.qty * r.pi;
      fundedPrincipalTotal += r.qty * ppb;
      fundedOwnRungInt += r.qty * ppb * (r.coupon ?? 0) * hof;
      fundedRungs.push({ cusip: r.bond.cusip, maturityStr: fmtDate(r.bond.maturity),
        maturityMonth: moF - 1, maturityYear: r.bond.maturity.getFullYear(),
        qty: r.qty, principalPerBond: ppb, coupon: r.coupon ?? 0, nPeriods: nP, piPerBond: r.pi });
    }

    // Per-year Amount + pre-ladder credit via the shared rule (ladder-core.fundedYearAmount),
    // so build and rebalance "After" are identical by construction. Zeroed years are funded
    // entirely by the PLI pool; the credit subtracts LMI + own-excess coupon + AMD so the row
    // lands on DARA (not overshooting by the AMD).
    const { credit: preLadderCreditForYear, amount: _fundedAmt } = fundedYearAmount({
      principal: fundedYearPITotal, laterMatInt: corr_lmi, ownExcessCoupon: excessLMI,
      amd: future30yAmd, rollCoupon: future30yRoll, dara: yearDara, isZeroed,
      partialCredit: year === partialCreditYear ? partialCredit : 0,
    });
    const fundedYearAmt = (year > lastYear || year < firstYear) ? 0 : _fundedAmt;
    // Excess (bracket/cover) Amount = coverage the excess provides ≈ (missing years) × DARA. Built as
    // the excess P+I + the block coupon used to size the synthetic rungs down (gap or future-30Y),
    // MINUS any accretion (AMD) already delivered to earlier years — its market discount is income
    // booked to those years, not coverage delivered to this block. Net-out keyed by bracket year, so
    // 2056/2036/2040 auto-correct once they get an AMD schedule. Spec 2.0 §Future 30Y Upper Cover AMD.
    const gapLMIAlloc = gapExQty > 0
      ? (year === lowerYear ? lowerWeight : upperWeight) * (gapParams?.gapLMITotal ?? 0)
      : 0;
    const future30yLMIAlloc = future30yExQty > 0
      ? (year === future30yLowerYear ? future30yLowerWeight : future30yUpperWeight) * (future30yLMITotal ?? 0)
      : 0;
    const amdLifetime = amdLifetimeByBracketYear.get(year) ?? 0;
    const exAmt  = isBracket ? excessQty * repPi - amdLifetime + gapLMIAlloc + future30yLMIAlloc : '';
    const exCost = isBracket ? excessQty * cpbRep : '';

    // Emit one row per funded sub-rung. Year-level fields (Amount, LMI, credit, aggregates) ride the
    // FIRST row only — render's fyLevel picks the first non-null Amount and anchors the drill there;
    // Cost/Qty columns sum the per-rung values across the group. Excess rides the first (representative) row.
    rungs.forEach((r, j) => {
      const moF = r.bond.maturity.getMonth() + 1;
      const hof = moF < 7 ? 0.5 : 1.0, nP = moF < 7 ? 1 : 2;
      const ppb = 1000 * r.ir;
      const cpb_i = r.bond.price != null ? (r.bond.price / 100) * r.ir * 1000 : bondCalcs(r.bond, refCPI).costPerBond;
      const rungCost = r.qty * cpb_i;
      const mDuration = calculateMDuration(settlementDate, r.bond.maturity, r.bond.coupon ?? 0, r.bond.yield ?? 0);
      const first = j === 0;
      const rowExcessQty = first ? excessQty : 0;
      const totQty = r.qty + rowExcessQty;
      totalBuyCost += rungCost + (first ? excessQty * cpbRep : 0);
      results.push([
        r.bond.cusip,           // 0: CUSIP
        fmtDate(r.bond.maturity), // 1: Maturity
        year,                   // 2: FY
        r.qty,                  // 3: Funded Year Qty (this sub-rung)
        rowExcessQty || '',    // 4: Excess Qty (bracket row only)
        totQty,                 // 5: Total Qty
        first ? fundedYearAmt : '', // 6: Funded Year Amount (year total, first row only)
        rungCost,               // 7: Funded Year Cost (this sub-rung)
        first ? exAmt : '',    // 8: Excess Amount (bracket only)
        first ? exCost : '',   // 9: Excess Cost (bracket only)
      ]);
      details.push({
        fundedYear: year,
        cusip: r.bond.cusip,
        maturityStr: fmtDate(r.bond.maturity),
        coupon: r.coupon ?? 0,
        yield: r.bond.yield ?? 0,
        price: r.bond.price ?? 0,
        baseCpi: r.bond.baseCpi ?? refCPI,
        refCPI,
        indexRatio: r.ir,
        halfOrFull: hof,
        nPeriods: nP,
        dara: first ? yearDara : null,
        fundedYearQty: r.qty,
        longerDatedLMI: first ? corr_lmi : null,
        excessLMI_After: first ? excessLMI : 0,
        preLadderCreditForYear: first ? preLadderCreditForYear : null,
        future30yUpperAnnualAmd: first ? future30yAmd : 0,
        future30yRollCoupon: first ? future30yRoll : 0,
        fundedYearPi: r.pi,
        // Multi-TIPS Amount drill iterates fundedRungs (each TIPS's own P+I); single-TIPS uses the
        // per-bond breakdown. Year-level principal/own-coupon totals ride the first row for that drill.
        fundedRungs: first ? fundedRungs : null,
        fundedYearPrincipalTotal: first ? fundedPrincipalTotal : r.qty * ppb,
        fundedYearOwnRungInt: first ? fundedOwnRungInt : r.qty * ppb * (r.coupon ?? 0) * hof,
        fundedYearAmt: first ? fundedYearAmt : null,
        costPerBond: cpb_i,
        fundedYearCost: rungCost,
        isFuture30yCover,
        // Designated gap bracket (2036 lower / 2040 upper) — single TIPS, so flagged on its one row.
        isGapBracket: gapYears.length > 0 && (year === lowerYear || year === upperYear),
        excessQty: rowExcessQty,
        excessPrincipalTotal: rowExcessQty * 1000 * irRep,
        excessOwnRungInt: rowExcessQty * 1000 * irRep * (repBond.coupon ?? 0) * (repBond.maturity.getMonth() + 1 < 7 ? 0.5 : 1.0),
        excessAmt: (first && isBracket) ? excessQty * repPi - amdLifetime + gapLMIAlloc + future30yLMIAlloc : 0,
        gapLMIAlloc: first ? gapLMIAlloc : 0,
        future30yLMIAlloc: first ? future30yLMIAlloc : 0,
        excessAmdLifetime: first ? amdLifetime : 0,
        excessCost: (first && isBracket) ? excessQty * cpbRep : 0,
        mDuration,
      });
    });
  }

  const _mktCosts = details.map(d => (d.fundedYearQty + d.excessQty) * d.costPerBond);
  const weightedAvgDuration = calcMktWtdAvg(details.map(d => d.mDuration), _mktCosts);
  const weightedAvgYield    = calcMktWtdAvg(details.map(d => d.yield),     _mktCosts);

  const HDR = ['CUSIP', 'Maturity', 'Funded Year', 'Funded Year Qty', 'Excess Qty', 'Total Qty', 'Funded Year Amount', 'Funded Year Cost', 'Excess Amount', 'Excess Cost'];

  // Resolved per-year DARA for EVERY year in [firstYear, lastYear] (incl. gap + future-30Y
  // years that have no TIPS row). This is the durable build intent the export persists as the
  // `#fundedYear,dara` block, so a re-import reproduces the ladder exactly. See 2.1 Broker Import.
  const daraByYearResolved = new Map();
  for (let y = firstYear; y <= lastYear; y++) daraByYearResolved.set(y, daraByYear?.get(y) ?? dara);

  const summary = {
    settleDateDisp, refCPI, dara, daraByYearResolved,
    firstYear, lastYear, gapYears, future30yYears,
    gapParams, lowerYear, upperYear,
    lowerDuration, upperDuration, lowerWeight, upperWeight, lowerMonth, upperMonth,
    lowerExQty, upperExQty, totalExcessCost,
    future30yLowerYear, future30yUpperYear,
    future30yLowerDuration, future30yUpperDuration, future30yUpperWeight, future30yLowerWeight,
    future30yLowerExQty, future30yUpperExQty, future30yFellBack, future30yTotalExcessCost,
    future30yLowerMonth, future30yUpperMonth,
    future30yParams,
    future30yUpperAnnualAmdByYear,
    future30yLMITotal,
    totalBuyCost,
    weightedAvgDuration,
    weightedAvgYield,
    preLadderInterest, maturityPref, couponPref, preLadderYears, preLadderPool, preLadderCouponPool, preLadderAmdPool, preLadderRollCouponPool,
    zeroedFundedYears: [...zeroedFundedYears].sort((a, b) => a - b),
  };

  return { results, HDR, summary, details };
}

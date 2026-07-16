// gap-math.js — Gap year analysis, bracket sizing, and ladder sweep helpers
// Spec: knowledge/4.0_Computation_Modules.md §gap-math.js
// Math reference: knowledge/3.0_TIPS_Ladder_Rebalancing.md Phase 2, Phase 3, Phase 4

import { calculateMDuration, priceFromYield } from '../../shared/src/bond-math.js';
import { indexRatio as calcIndexRatio } from '../../shared/src/ref-cpi.js';

// ─── Yield interpolation ──────────────────────────────────────────────────────
// Spec: 4.0 Phase 2, 3.0 Synthetic TIPS Construction
export function interpolateYield(anchorBefore, anchorAfter, targetDate) {
  if (!anchorBefore || !anchorAfter || !targetDate) return NaN;
  const y1 = parseFloat(anchorBefore.yield);
  const y2 = parseFloat(anchorAfter.yield);
  return y1 + (targetDate - anchorBefore.maturity) * (y2 - y1) / (anchorAfter.maturity - anchorBefore.maturity);
}

// ─── Synthetic coupon ─────────────────────────────────────────────────────────
// Spec: 4.0 Phase 2, 3.0 Synthetic TIPS Construction
export function syntheticCoupon(yld) {
  return Math.max(0.00125, Math.floor(yld * 100 / 0.125) * 0.00125);
}

// ─── Bracket weights ──────────────────────────────────────────────────────────
// Spec: 4.0 Phase 3c
export function bracketWeights(lowerDuration, upperDuration, avgGapDuration) {
  // Degenerate guard: when the two cover durations coincide, split evenly (avoids /0).
  if (Math.abs(upperDuration - lowerDuration) < 0.0001) return { lowerWeight: 0.5, upperWeight: 0.5 };
  const lowerWeight = (upperDuration - avgGapDuration) / (upperDuration - lowerDuration);
  return { lowerWeight, upperWeight: 1 - lowerWeight };
}

// ─── Bracket excess quantities ────────────────────────────────────────────────
// Spec: 4.0 Phase 3c, 4.0 Named Quantities excessQtyAfter
export function bracketExcessQtys(totalCost, lowerWeight, upperWeight, lowerCostPerBond, upperCostPerBond) {
  return {
    lowerExQty: lowerCostPerBond > 0 ? Math.round(totalCost * lowerWeight / lowerCostPerBond) : 0,
    upperExQty: upperCostPerBond > 0 ? Math.round(totalCost * upperWeight / upperCostPerBond) : 0,
  };
}

// ─── Funded year qty (simple single-CUSIP case) ───────────────────────────────
// Spec: 4.0 Phase 4 step 2 targetFYQty, 5.0 §fyQty
// Note: multi-bond year logic in rebalance-lib.js extends this with sell-earliest-first
export function fyQty(dara, laterMatInt, piPerBond) {
  return Math.max(0, Math.round((dara - laterMatInt) / piPerBond));
}

// ─── 3-Bracket weights ────────────────────────────────────────────────────────
// Spec: 4.0 §3-Bracket Mode
// d1=origLower, d2=newLower, d3=upper, Dg=gapAvgDuration
// origExcess$ = current excess cost in original lower bracket
export function bracketWeights3(d1, d2, d3, Dg, origExcess$, gapTotalCost) {
  if (gapTotalCost <= 0) return { origLowerWeight: 0, newLowerWeight: 0, upperWeight: 0, feasible: true };
  // 2-bracket optimal lower weight — cap w1 so selling occurs when orig lower overshoots.
  const lw2b  = Math.abs(d3 - d1) > 0.0001 ? (d3 - Dg) / (d3 - d1) : 0.5;
  const w1_raw = origExcess$ / gapTotalCost;
  if (w1_raw >= lw2b) {
    return { origLowerWeight: lw2b, newLowerWeight: 0, upperWeight: 1 - lw2b, feasible: true };
  }
  const w1    = w1_raw;
  const den   = d2 - d3;
  if (Math.abs(den) < 0.0001) return { origLowerWeight: w1, newLowerWeight: Math.max(0, 1 - w1) / 2, upperWeight: Math.max(0, 1 - w1) / 2, feasible: true };
  const w2raw = (Dg - d3 + w1 * (d3 - d1)) / den;
  const w2    = Math.max(0, w2raw);
  const w3    = 1 - w1 - w2;
  return { origLowerWeight: w1, newLowerWeight: w2, upperWeight: w3, feasible: w2raw >= 0 };
}

// ─── Later maturity interest contribution ─────────────────────────────────────
// Spec: 4.0 Phase 4 step 4
// annualInt comes from bondCalcs(bond, refCPI).annualInt
export function laterMatIntContribution(qty, annualInt) {
  return qty * annualInt;
}

// ─── Gap parameters core sweep (shared by build and rebalance) ─────────────────
// Spec: 2.0 §Gap Years, §Duration Matching. Single source of truth for the gap-year
// synthetic ladder sweep. The ONLY thing build and rebalance supply differently is
// `lmiAboveByYear` — { [year]: annual coupon $ from funded years above the gap }:
//   • build derives it from its prelim funded sweep,
//   • rebalance derives it from holdings/targets (+ future-cover excess).
// Everything here — anchors, synthetic construction, qty formula, cost-weighted avg
// duration, gapLMITotal — is identical for both. Returns { avgDuration, totalCost,
// breakdown, gapLMITotal }.
export function gapParamsCore({ gapYears, tipsMap, settlementDate, dara, daraByYear = null, lmiAboveByYear = {}, pliCreditByGapYear = {}, amdByYear = null }) {
  if (!gapYears || gapYears.length === 0) return { avgDuration: 0, totalCost: 0, breakdown: [], gapLMITotal: 0 };
  const minGapYear = Math.min(...gapYears);
  const maxGapYear = Math.max(...gapYears);

  // Anchors: highest Jan TIPS strictly below the gap; nearest Feb TIPS above the gap.
  let anchorBefore = null, anchorAfter = null;
  for (const bond of tipsMap.values()) {
    if (!bond.maturity || !bond.yield) continue;
    const yr = bond.maturity.getFullYear(), mo = bond.maturity.getMonth() + 1;
    if (mo === 1 && yr < minGapYear && (!anchorBefore || yr > anchorBefore.maturity.getFullYear()))
      anchorBefore = { maturity: bond.maturity, yield: bond.yield };
    if (mo === 2 && yr > maxGapYear && (!anchorAfter || bond.maturity < anchorAfter.maturity))
      anchorAfter = { maturity: bond.maturity, yield: bond.yield };
  }
  if (!anchorBefore || !anchorAfter)
    throw new Error('Could not find yield interpolation anchors for gap years');

  let totalDuration = 0, totalCost = 0, count = 0;
  const breakdown = [];
  // Process longest→shortest so each gap year's synthetic interest feeds the next shorter rung.
  let runningSynLMI = 0;
  for (const year of [...gapYears].sort((a, b) => b - a)) {
    const synMat = new Date(year, 1, 15); // Feb 15
    const synYld = interpolateYield(anchorBefore, anchorAfter, synMat);
    const synCpn = syntheticCoupon(synYld);
    const synDur = calculateMDuration(settlementDate, synMat, synCpn, synYld);
    totalDuration += synDur;

    // LMI = synthetic interest from longer gap years already processed + actual TIPS interest above.
    let laterMatInt = runningSynLMI;
    for (const y in lmiAboveByYear) {
      if (parseInt(y) > year) laterMatInt += lmiAboveByYear[y];
    }

    const piPerBond = 1000 + 1000 * synCpn * 0.5;
    const yearDara = daraByYear?.get(year) ?? dara;
    // AMD from excess TIPS is income arriving this year, treated exactly like coupon LMI.
    const amd = amdByYear?.get(year) ?? 0;
    const qty = Math.max(0, Math.round((yearDara - laterMatInt - (pliCreditByGapYear[year] ?? 0) - amd) / piPerBond));
    totalCost += qty * 1000;
    breakdown.push({ year, qty, piPerBond, laterMatInt, pliCredit: pliCreditByGapYear[year] ?? 0, amd, dur: synDur });
    runningSynLMI += qty * 1000 * synCpn;
    count++;
  }

  // gapLMITotal "adds back" every income source used to size gap quantities down (laterMatInt + pli + amd).
  const gapLMITotal = breakdown.reduce((s, g) => s + g.laterMatInt + g.pliCredit + g.amd, 0);
  // Cost-weighted avg duration (Σ qty·dur / Σ qty); fall back to simple mean when no synthetic qty exists.
  const _qtySum = breakdown.reduce((s, g) => s + g.qty, 0);
  const avgDuration = _qtySum > 0
    ? breakdown.reduce((s, g) => s + g.qty * g.dur, 0) / _qtySum
    : (count > 0 ? totalDuration / count : 0);
  return { avgDuration, totalCost, breakdown, gapLMITotal };
}

// ─── Gap params with upper-bracket excess-coupon feedback (View A fixpoint) ─────
// Spec: 2.0 §Gap Year Coverage Model. The gap's upper bracket (2040) holds EXCESS TIPS,
// sized from the gap's total cost, whose coupon is paid through the gap years it spans.
// Like every other rung's coupon, that excess coupon is income arriving in the gap years and
// must size the gap synthetic quantities down — but upperExQty depends on the gap totalCost,
// which depends on this coupon. That's a contraction map (the term is ~1% of gap cost), so we
// iterate to a fixed point (converges in ~2 steps). Both build and rebalance call this with
// their own lmiAboveByYear, so equal inputs → equal output → the build↔rebalance round-trip
// stays exact. Falls back to plain gapParamsCore when bracket bonds can't be resolved.
// (3-bracket rebalance reuses the same 2-bracket upper weight here — the feedback is a tiny,
// second-order term and 3-bracket is not round-trip-symmetry-checked against build.)
export function gapParamsWithUpperFeedback(args) {
  const { gapYears, tipsMap, settlementDate, refCPI, creditUpperExcess = true } = args;
  if (!creditUpperExcess || !gapYears?.length || !refCPI) return gapParamsCore(args);

  const minGapYear = Math.min(...gapYears), maxGapYear = Math.max(...gapYears);
  // Bracket bonds (same anchors gapParamsCore uses): lower = highest Jan TIPS strictly below
  // the gap; upper = nearest Feb TIPS above. Only the UPPER coupon flows up into the gap years
  // (the lower bracket matures before them), so only it feeds back here.
  let lowerBond = null, upperBond = null;
  for (const b of tipsMap.values()) {
    if (!b.maturity || !b.yield) continue;
    const yr = b.maturity.getFullYear(), mo = b.maturity.getMonth() + 1;
    if (mo === 1 && yr < minGapYear && (!lowerBond || yr > lowerBond.maturity.getFullYear())) lowerBond = b;
    if (mo === 2 && yr > maxGapYear && (!upperBond || b.maturity < upperBond.maturity)) upperBond = b;
  }
  if (!lowerBond || !upperBond) return gapParamsCore(args);

  const upperYear = upperBond.maturity.getFullYear();
  const irU = calcIndexRatio(refCPI, upperBond.baseCpi ?? refCPI);
  const upperCPB = (upperBond.price ?? 0) / 100 * irU * 1000;          // cost per bond (real $)
  const upperAnnCpnPerBond = 1000 * irU * (upperBond.coupon ?? 0);     // annual coupon per bond (real $)
  if (!(upperCPB > 0) || !(upperAnnCpnPerBond > 0)) return gapParamsCore(args);

  const lowerDur = calculateMDuration(settlementDate, lowerBond.maturity, lowerBond.coupon ?? 0, lowerBond.yield ?? 0);
  const upperDur = calculateMDuration(settlementDate, upperBond.maturity, upperBond.coupon ?? 0, upperBond.yield ?? 0);
  const baseLMI = args.lmiAboveByYear ?? {};

  let extra = 0, params = null;
  for (let i = 0; i < 6; i++) {
    const lmi = { ...baseLMI, [upperYear]: (baseLMI[upperYear] ?? 0) + extra };
    params = gapParamsCore({ ...args, lmiAboveByYear: lmi });
    const { upperWeight } = bracketWeights(lowerDur, upperDur, params.avgDuration);
    const upperExQty = Math.round(params.totalCost * upperWeight / upperCPB);
    const newExtra = upperExQty * upperAnnCpnPerBond;
    if (newExtra === extra) break;   // fixed point: params already reflects this extra
    extra = newExtra;
  }
  return params;
}

// ─── Future 30Y parameters core (shared by build and rebalance) ────────────────
// Spec: 2.0 §Future 30Y Rungs, §Duration Matching. Hypothetical 30Y TIPS sized off the 2056
// cover bond's yield as a flat-curve anchor (coupon = syntheticCoupon(yield2056)). No actual
// TIPS exist above these years, so the only LMI is the running synthetic accumulator — there is
// no build/rebalance input divergence here (cf. gapParamsCore). Returns the same shape build/rebal
// used: { avgDuration, future30yTotalCost, breakdown, future30ySeedLMI }.
export function future30yParamsCore({ future30yYears, coverBond2056, settlementDate, dara, daraByYear = null }) {
  if (!future30yYears?.length || !coverBond2056) return { avgDuration: 0, future30yTotalCost: 0, breakdown: [], future30ySeedLMI: 0 };
  const yield2056 = coverBond2056.yield ?? 0;
  const synCoupon = syntheticCoupon(yield2056);
  const piPerBond = 1000 + 1000 * synCoupon * 0.5;   // Feb maturity → halfOrFull 0.5; IR 1.0 (par)
  let totalDuration = 0, future30yTotalCost = 0, runningLMI = 0;
  const breakdown = [];
  for (const year of [...future30yYears].sort((a, b) => b - a)) {
    const mat = new Date(year, 1, 15); // Feb 15
    const dur = calculateMDuration(settlementDate, mat, synCoupon, yield2056);
    totalDuration += dur;
    const yearDara = daraByYear?.get(year) ?? dara;
    const qty = Math.max(0, Math.round((yearDara - runningLMI) / piPerBond));
    breakdown.push({ year, qty, piPerBond, laterMatInt: runningLMI, dur });
    runningLMI += qty * 1000 * synCoupon;
    future30yTotalCost += qty * 1000;
  }
  // Cost-weighted avg duration so the per-rung 2052 cover decomposition sums exactly to the block excess.
  const _qtySum = breakdown.reduce((s, b) => s + b.qty, 0);
  const avgDuration = _qtySum > 0
    ? breakdown.reduce((s, b) => s + b.qty * b.dur, 0) / _qtySum
    : (future30yYears.length > 0 ? totalDuration / future30yYears.length : 0);
  return { avgDuration, future30yTotalCost, breakdown, future30ySeedLMI: runningLMI };
}

// ─── Excess-holding AMD schedule (Accrued Market Discount as interest) ──────────
// Spec: 2.0 §Future 30Y Upper Cover AMD. Single source of truth for build AND rebalance.
// GENERIC over any discount excess holding: pass the bond + its excess qty. Today only the
// Future-30Y upper cover (2052) is wired in; the 2056 / 2036 / 2040 excess can reuse this same
// function once specced (see sizeLadder's `amdExcessBonds`) — nothing here is 2052-specific.
//
// A deep-discount, low-coupon TIPS (e.g. the 2052: ~2.7% yield vs 0.125% coupon) returns almost all
// of its yield as price accretion, not coupon. AMD is treated EXACTLY like coupon interest — the only
// difference is that some bonds must be sold to turn the accrued discount into cash. Like coupon, the
// income is what the FULL held excess position earns each year, modeled held-to-maturity (settlement →
// the bond's own maturity), independent of how many bonds are sold to realize it. Under the constant-
// yield method the per-bond accretion increment IS that interest:
//   adjPrice(Y) = priceFromYield(yield, coupon, Feb(Y), mat)/100 × IR_settle × 1000   (real $)
//   a(Y)        = adjPrice(Y) − adjPrice(Y−1)     // accretion increment, per bond (basis steps up)
//   AMD(Y)      = exQty × a(Y)                     // full undepleted position — same basis as coupon
// Even (gently back-loaded by convexity), conserving (Σ a(Y) = par − cost). Returns Map<year, amd$>.
export function excessAmdSchedule({ bond, exQty, refCPI, settlementYear }) {
  const byYear = new Map();
  if (!(exQty > 0 && bond?.maturity)) return byYear;
  const ir          = calcIndexRatio(refCPI, bond.baseCpi ?? refCPI);
  const costPerBond = (bond.price ?? 0) / 100 * ir * 1000;
  const matYear     = bond.maturity.getFullYear();
  const parPerBond  = ir * 1000;                      // redemption value in settlement-real dollars
  const adjPrice = (year) => {                        // constant-yield real price at last cal day of Feb
    const saleDate = new Date(year, 2, 0);
    if (saleDate >= bond.maturity) return parPerBond;  // at/after maturity → par
    const p = priceFromYield(bond.yield ?? 0, bond.coupon ?? 0, saleDate, bond.maturity);
    return p == null ? null : p / 100 * ir * 1000;
  };
  let prevAdj = costPerBond;                           // basis starts at settlement cost
  for (let year = settlementYear + 1; year <= matYear; year++) {
    const ap = adjPrice(year);
    if (ap == null) continue;
    byYear.set(year, exQty * (ap - prevAdj));
    prevAdj = ap;                                      // basis steps up — next year counts only the next increment
  }
  return byYear;
}

// gap-math.js — Gap year analysis, bracket sizing, and ladder sweep helpers
// Spec: knowledge/5.0_Computation_Modules.md §gap-math.js
// Math reference: knowledge/4.0_TIPS_Ladder_Rebalancing.md Phase 2, Phase 3, Phase 4

import { calculateMDuration } from './bond-math.js';

// ─── Yield interpolation ──────────────────────────────────────────────────────
// Spec: 4.0 Phase 2, 3.0 Synthetic TIPS Construction
export function interpolateYield(anchorBefore, anchorAfter, targetDate) {
  return anchorBefore.yield +
    (targetDate - anchorBefore.maturity) * (anchorAfter.yield - anchorBefore.yield) /
    (anchorAfter.maturity - anchorBefore.maturity);
}

// ─── Synthetic coupon ─────────────────────────────────────────────────────────
// Spec: 4.0 Phase 2, 3.0 Synthetic TIPS Construction
export function syntheticCoupon(yld) {
  return Math.max(0.00125, Math.floor(yld * 100 / 0.125) * 0.00125);
}

// ─── Bracket weights ──────────────────────────────────────────────────────────
// Spec: 4.0 Phase 3c
export function bracketWeights(lowerDuration, upperDuration, avgGapDuration) {
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
  // w1 is fixed at current orig lower excess — never capped (no selling of orig lower)
  const w1    = gapTotalCost > 0 ? origExcess$ / gapTotalCost : 0;
  const w2raw = (Dg - d3 + w1 * (d3 - d1)) / (d2 - d3);
  const w2    = Math.max(0, w2raw); // clamp: if orig lower overshoots, skip new lower
  const w3    = 1 - w1 - w2;
  return { origLowerWeight: w1, newLowerWeight: w2, upperWeight: w3, feasible: w2raw >= 0 };
}

// ─── Later maturity interest contribution ─────────────────────────────────────
// Spec: 4.0 Phase 4 step 4
// annualInt comes from bondCalcs(bond, refCPI).annualInt
export function laterMatIntContribution(qty, annualInt) {
  return qty * annualInt;
}

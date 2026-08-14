// gap-math.js — Gap year analysis, bracket sizing, and ladder sweep helpers
// Spec: knowledge/4.0_Computation_Modules.md §gap-math.js
// Math reference: knowledge/3.0_TIPS_Ladder_Rebalancing.md Phase 2, Phase 3, Phase 4

import { calculateMDuration, calculateDurationDetail, priceFromYield } from '../../shared/src/bond-math.js';
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
// Weights are shares of the block cost, so neither can go negative or above 1. If the target
// duration falls outside [lowerDuration, upperDuration] — e.g. a deep-discount, near-zero-coupon
// cover (2052) durations-out past a higher-coupon block average — clamp to the nearer cover
// (weight 1) rather than solve past it. Accepts a slightly larger duration-match delta in that
// corner case in exchange for never buying/selling a negative quantity.
export function bracketWeights(lowerDuration, upperDuration, avgGapDuration) {
  // Degenerate guard: when the two cover durations coincide, split evenly (avoids /0).
  if (Math.abs(upperDuration - lowerDuration) < 0.0001) return { lowerWeight: 0.5, upperWeight: 0.5 };
  const rawLowerWeight = (upperDuration - avgGapDuration) / (upperDuration - lowerDuration);
  const lowerWeight = Math.min(1, Math.max(0, rawLowerWeight));
  return { lowerWeight, upperWeight: 1 - lowerWeight };
}

// ─── Bracket weights with retained lower-side maturities ──────────────────────
// Spec: 2.0 §Retained Bracket Excess; 3.0 §Lower-side priority rule.
//
// The plain two-sided `bracketWeights` above assumes EVERY lower-side dollar sits at the
// active lower bracket's duration. That is false once excess is retained in older maturities:
// they are shorter, so the realized blend lands short of `dGap` and the gap is under-matched.
// (That was the shipped behavior from 463b07a until this function replaced it.)
//
// Here the retained maturities are FROZEN at the excess the portfolio already holds — never
// increased — so their weights are inputs, not unknowns. Only the active lower bracket and the
// upper bracket are solved, and they absorb whatever the retained legs leave over:
//
//   Σ wᵣ·dᵣ + w_act·d_act + w_up·d_up = dGap        (duration match, all legs counted)
//   Σ wᵣ    + w_act       + w_up      = 1
//
// Let R = Σ wᵣ (retained share of the block) and D_R = Σ wᵣ·dᵣ. Then
//   w_up  = ((dGap − D_R) − (1 − R)·d_act) / (d_up − d_act)
//   w_act = (1 − R) − w_up
//
// **Over-allocated → sell the earliest leg, only as much as restoring the match requires.** If
// w_act solves negative, the lower side is carrying more than the block needs. Solve for the
// exact weight of the earliest retained leg that brings w_act back to 0 (holding every other leg
// fixed), clamp it to [0, currently held], and re-solve. Only if depleting that leg entirely is
// still not enough does the next-earliest leg get the same treatment. Selling a whole leg when a
// partial sale would do is needless trading, not the rule.
//
// `retained` is oldest → newest. `activeFloorWeight` (optional, default 0) is the active lower
// bracket's OWN currently-held excess, expressed as a share of totalBlockCost — the active bracket
// is "the only lower-side maturity a rebalance buys" (DATA_DICTIONARY §Active Lower Bracket); it is
// never sold to make room for a duration match the way retained legs may be. When the unconstrained
// solve would require shrinking active BELOW what it already holds, that is over-allocation exactly
// as much as a negative wAct is — the retained legs (oldest first) are sold down further to make
// room, so active never loses ground to an older, already-retained leg. Passing the default 0
// reproduces the exact old behavior (only a literal negative wAct triggers selling), so every
// existing caller/test that doesn't pass this is unaffected.
//
// Returns weights as shares of the total block cost.
export function bracketWeightsN({ retained = [], dActive, dUpper, dGap, totalBlockCost, activeFloorWeight = 0 }) {
  const degenerate = Math.abs(dUpper - dActive) < 0.0001;
  const n = retained.length;
  const floor = Math.max(0, activeFloorWeight || 0);

  // Retained weights as held (frozen). Zero block cost → nothing to allocate.
  const w = totalBlockCost > 0
    ? retained.map(r => Math.max(0, (r.excessCost ?? 0) / totalBlockCost))
    : retained.map(() => 0);

  const solve = () => {
    const R   = w.reduce((s, x) => s + x, 0);
    const D_R = w.reduce((s, x, i) => s + x * (retained[i].duration ?? 0), 0);
    if (degenerate) {                       // durations coincide: split the remainder evenly
      const rest = Math.max(0, 1 - R);
      return { wAct: rest / 2, wUp: rest / 2 };
    }
    const wUp  = ((dGap - D_R) - (1 - R) * dActive) / (dUpper - dActive);
    return { wAct: (1 - R) - wUp, wUp };
  };

  let { wAct, wUp } = solve();

  // wAct < floor means the lower side is carrying more than the block needs while still leaving
  // room for the active bracket's own current holding — you would have to shrink active below what
  // it already holds (floor=0: a literal negative amount) to come back to dGap. Sell the EARLIEST
  // retained maturity, and only as much as it takes to bring wAct back up to exactly `floor`; if
  // depleting it entirely still is not enough, move to the next earliest. Selling a whole leg when
  // a partial sale would do forces needless trading.
  //
  // Holding every other leg fixed, the weight of leg i that lands exactly on wAct = floor is
  //   wᵢ = [dGap − D_fixed − floor·d_act − (1 − R_fixed − floor)·d_up] / (dᵢ − d_up)
  // from the same two equations with w_act fixed at `floor` instead of dropped entirely; floor = 0
  // reduces this to the original formula exactly.
  let sold = false;
  for (let i = 0; i < n && wAct < floor; i++) {
    const R_fixed = w.reduce((s, x, j) => j === i ? s : s + x, 0);
    const D_fixed = w.reduce((s, x, j) => j === i ? s : s + x * (retained[j].duration ?? 0), 0);
    const di      = retained[i].duration ?? 0;
    const den     = di - dUpper;
    const wanted  = Math.abs(den) < 0.0001 ? 0 : (dGap - D_fixed - floor * dActive - (1 - R_fixed - floor) * dUpper) / den;
    const next    = Math.min(w[i], Math.max(0, wanted));   // never increase, never below zero
    if (next !== w[i]) { w[i] = next; sold = true; }
    ({ wAct, wUp } = solve());
  }

  // With every retained leg sold off this reduces to the plain two-sided case (activeFloorWeight
  // permitting), which always has a solution when the gap average sits between the two bracket
  // durations. `feasible` stays as a signal for the degenerate inputs (coincident durations, dGap
  // outside the bracket span, or a floor too high for even zero retained to satisfy).
  const feasible = wAct >= floor - 1e-9 && wUp >= -1e-9;
  return { retainedWeights: w, activeWeight: wAct, upperWeight: wUp, feasible, sold };
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
    const durDetail = calculateDurationDetail(settlementDate, synMat, synCpn, synYld);
    const synDur = durDetail ? durDetail.macaulay / (1 + synYld / 2) : null;
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
    breakdown.push({ year, qty, piPerBond, laterMatInt, pliCredit: pliCreditByGapYear[year] ?? 0, amd, dur: synDur, synYld, synCpn, durDetail });
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
  return { avgDuration, totalCost, breakdown, gapLMITotal, anchors: { before: anchorBefore, after: anchorAfter } };
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
    const durDetail = calculateDurationDetail(settlementDate, mat, synCoupon, yield2056);
    const dur = durDetail ? durDetail.macaulay / (1 + yield2056 / 2) : null;
    totalDuration += dur;
    const yearDara = daraByYear?.get(year) ?? dara;
    const qty = Math.max(0, Math.round((yearDara - runningLMI) / piPerBond));
    breakdown.push({ year, qty, piPerBond, laterMatInt: runningLMI, dur, synYld: yield2056, synCpn: synCoupon, durDetail });
    runningLMI += qty * 1000 * synCoupon;
    future30yTotalCost += qty * 1000;
  }
  // Cost-weighted avg duration so the per-rung 2052 cover decomposition sums exactly to the block excess.
  const _qtySum = breakdown.reduce((s, b) => s + b.qty, 0);
  const avgDuration = _qtySum > 0
    ? breakdown.reduce((s, b) => s + b.qty * b.dur, 0) / _qtySum
    : (future30yYears.length > 0 ? totalDuration / future30yYears.length : 0);
  return { avgDuration, future30yTotalCost, breakdown, future30ySeedLMI: runningLMI, anchorBond: coverBond2056 };
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

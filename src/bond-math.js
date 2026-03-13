// bond-math.js — Pure per-bond calculations
// No ladder state, no running pools, no side effects.
// Spec: knowledge/2.1_TIPS_Basics.md, knowledge/5.0_Computation_Modules.md §bond-math.js

// ─── Modified duration ────────────────────────────────────────────────────────
// Spec: 5.0 §calculateMDuration
export function getNumPeriods(settlement, maturity) {
  const months = (maturity.getFullYear() - settlement.getFullYear()) * 12 +
                 (maturity.getMonth() - settlement.getMonth());
  return Math.ceil(months / 6);
}

export function calculateDuration(settlement, maturity, coupon, yld) {
  const periods = getNumPeriods(settlement, maturity);
  let weightedSum = 0, pvSum = 0;
  for (let i = 1; i <= periods; i++) {
    const cashflow = i === periods ? 1000 + coupon * 1000 / 2 : coupon * 1000 / 2;
    const pv = cashflow / Math.pow(1 + yld / 2, i);
    weightedSum += i * pv;
    pvSum += pv;
  }
  return weightedSum / pvSum / 2;
}

export function calculateMDuration(settlement, maturity, coupon, yld) {
  return calculateDuration(settlement, maturity, coupon, yld) / (1 + yld / 2);
}

// ─── Per-bond quantities ──────────────────────────────────────────────────────
// Spec: 2.1 TIPS Basics, 5.0 §bondCalcs
// bond: { coupon, baseCpi, price, maturity: Date }
export function bondCalcs(bond, refCPI) {
  const coupon          = bond.coupon  ?? 0;
  const baseCpi         = bond.baseCpi ?? refCPI;
  const indexRatio      = refCPI / baseCpi;
  const principalPerBond = 1000 * indexRatio;
  const costPerBond     = (bond.price ?? 0) / 100 * indexRatio * 1000;
  const nPeriods        = (bond.maturity.getMonth() + 1) < 7 ? 1 : 2;
  const couponPerPeriod = coupon / 2;
  const ownRungInt      = principalPerBond * couponPerPeriod * nPeriods;
  const piPerBond       = principalPerBond + ownRungInt;
  const annualInt       = principalPerBond * coupon;
  return { indexRatio, principalPerBond, costPerBond, nPeriods, couponPerPeriod, ownRungInt, piPerBond, annualInt };
}

// ─── Rung amount ──────────────────────────────────────────────────────────────
// Spec: 5.0 §rungAmount, 4.0 Phase 5 ARA After formula
export function rungAmount(qty, piPerBond, laterMatInt) {
  return qty * piPerBond + laterMatInt;
}

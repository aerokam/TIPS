// bond-math.js — Core financial math for TIPS and nominal Treasuries.
// Pure per-unit calculations ($1,000 face value).
// Spec: ../knowledge/TIPS_Basics.md, knowledge/4.0_Computation_Modules.md §bond-math.js

import { indexRatio as calcIndexRatio } from './ref-cpi.js';

// ─── Macaulay / Modified duration ────────────────────────────────────────────
// Matches Google Sheets DURATION/MDURATION (Actual/Actual, semi-annual).
// Uses fractional first coupon period w = DSC/E to avoid the ±0.5y error
// that ceil(months/6) produces for bonds mid-period.

export function _nextCouponOnOrAfter(settle, mature) {
  const matMon  = mature.getMonth() + 1; // 1-indexed
  const cm1 = matMon <= 6 ? matMon : matMon - 6;
  const cm2 = cm1 + 6;
  const mDay = mature.getDate();
  const candidates = [];
  for (let y = settle.getFullYear() - 1; y <= settle.getFullYear() + 1; y++) {
    for (const mon of [cm1, cm2]) {
      const lastDay = new Date(y, mon, 0).getDate();
      candidates.push(new Date(y, mon - 1, Math.min(mDay, lastDay)));
    }
  }
  candidates.sort((a, b) => a - b);
  return candidates.find(c => c >= settle && c <= mature) || null;
}

// Returns Macaulay duration in years, or null if inputs are degenerate.
export function calculateDuration(settlement, maturity, coupon, yld) {
  if (settlement >= maturity || yld <= -2) return null;
  const nextCpn = _nextCouponOnOrAfter(settlement, maturity);
  if (!nextCpn) return null;
  const mDay   = maturity.getDate();
  const lastCpn = addSemiannualPeriods(nextCpn, -1, mDay);
  const days = (a, b) => (b - a) / 86400000;
  const E   = days(lastCpn, nextCpn);
  const DSC = days(settlement, nextCpn);
  const w   = DSC / E;
  const coupons = [];
  for (let k = 0; ; k++) {
    const d = addSemiannualPeriods(nextCpn, k, mDay);
    if (d > maturity) break;
    coupons.push(d);
  }
  const N = coupons.length;
  if (N === 0) return null;
  const semiCpn = coupon / 2 * 1000;
  const r = yld / 2;
  let wSum = 0, pvSum = 0;
  for (let j = 0; j < N; j++) {
    const cf = j === N - 1 ? semiCpn + 1000 : semiCpn;
    const t  = w + j;
    const pv = cf / Math.pow(1 + r, t);
    wSum  += t * pv;
    pvSum += pv;
  }
  return wSum / pvSum / 2;
}

export function calculateMDuration(settlement, maturity, coupon, yld) {
  const mac = calculateDuration(settlement, maturity, coupon, yld);
  return mac != null ? mac / (1 + yld / 2) : null;
}

// ─── Per-unit quantities ($1,000 face) ──────────────────────────────────────
// Spec: 2.1 TIPS Basics, 5.0 §bondCalcs
// security: { coupon, baseCpi, price, maturity: Date }
export function bondCalcs(bond, refCPI) {
  const coupon          = bond.coupon  ?? 0;
  const baseCpi         = bond.baseCpi ?? refCPI;
  const indexRatio      = calcIndexRatio(refCPI, baseCpi);
  const principalPerBond = 1000 * indexRatio;
  const costPerBond     = (bond.price ?? 0) / 100 * indexRatio * 1000;
  const nPeriods        = (bond.maturity.getMonth() + 1) < 7 ? 1 : 2;
  const couponPerPeriod = coupon / 2;
  const ownRungInt      = principalPerBond * couponPerPeriod * nPeriods;
  const piPerBond       = principalPerBond + ownRungInt;
  const annualInt       = principalPerBond * coupon;
  return { indexRatio, principalPerBond, costPerBond, nPeriods, couponPerPeriod, ownRungInt, piPerBond, annualInt };
}

// ─── Semi-annual date arithmetic (end-of-month safe) ─────────────────────────
// addSemiannualPeriods(date, n, matureDay)
// Moves date by n*6 months without overflow (e.g. Mar 31 + 6 → Sep 30, not Oct 1).
// matureDay is the maturity day-of-month used for coupon dates.
function addSemiannualPeriods(date, n, matureDay) {
  const d = new Date(date);
  d.setDate(1); // pin to 1st to prevent month overflow during setMonth
  d.setMonth(d.getMonth() + n * 6);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(matureDay, lastDay));
  return d;
}

// ─── Leap-day day-count helper ────────────────────────────────────────────────
// True if Feb 29 falls strictly after d1 and on/before d2.
export function hasLeapDayBetween(d1, d2) {
  for (let yr = d1.getFullYear(); yr <= d2.getFullYear(); yr++) {
    const feb29 = new Date(yr, 1, 29);
    if (feb29.getMonth() === 1 && feb29 > d1 && feb29 <= d2) return true;
  }
  return false;
}

// ─── Term (years to maturity) ─────────────────────────────────────────────────
// Under 1 year: actual/actual (365, or 366 if the span crosses Feb 29) — same
// leap-day convention as the zero-coupon bill yield formula below.
// 1 year or more: 365.25, the long-run average that avoids a single term's
// leap-year placement skewing a multi-year figure.
export function termYears(settle, maturity) {
  const daysToMat = (maturity.getTime() - settle.getTime()) / 86400000;
  if (daysToMat < 365) {
    return daysToMat / (hasLeapDayBetween(settle, maturity) ? 366 : 365);
  }
  return daysToMat / 365.25;
}

// ─── Yield from price (actual/actual, matches Excel YIELD(...,2,1)) ───────────
// Spec: 2.1 TIPS Basics (yield calculations)
// cleanPrice: percentage of par (e.g. 99.5)
// coupon: annual rate (decimal, e.g. 0.0125)
// settle: Date object
// mature: Date object
export function yieldFromPrice(cleanPrice, coupon, settle, mature) {
  if (!cleanPrice || cleanPrice <= 0) return null;
  if (settle >= mature) return null;

  const days = (a, b) => (b.getTime() - a.getTime()) / 86400000;
  const daysToMat = days(settle, mature);
  const semiCoupon = (coupon / 2) * 100;

  // Zero-coupon bills: simple investment rate 365/d, or 366/d if the period spans
  // a leap day (matches Treasury's published convention). No coupon schedule
  // exists to check against, so this stays a pure day-count test.
  if (semiCoupon === 0) {
    const leapSpan = hasLeapDayBetween(settle, mature);
    if (daysToMat < (leapSpan ? 183 : 182.5)) return (100 / cleanPrice - 1) * (leapSpan ? 366 : 365) / daysToMat;
  }

  const matMon = mature.getMonth() + 1;
  const cm1 = matMon <= 6 ? matMon : matMon - 6;
  const cm2 = cm1 + 6;

  function nextCouponOnOrAfter(d) {
    const mDay = mature.getDate(); // use maturity day, not hardcoded 15
    const candidates = [];
    for (let y = d.getFullYear() - 1; y <= d.getFullYear() + 1; y++) {
      for (const mon of [cm1, cm2]) {
        const lastDay = new Date(y, mon, 0).getDate(); // last day of that month
        candidates.push(new Date(y, mon - 1, Math.min(mDay, lastDay)));
      }
    }
    candidates.sort((a, b) => a - b);
    return candidates.find(c => c >= d && c <= mature) || null;
  }

  const nextCoupon = nextCouponOnOrAfter(settle);
  if (!nextCoupon) return null;
  const lastCoupon = addSemiannualPeriods(nextCoupon, -1, mature.getDate());
  const E = days(lastCoupon, nextCoupon);
  const A = days(lastCoupon, settle);
  const DSC = days(settle, nextCoupon);
  const accrued = semiCoupon * (A / E);
  const dirtyPrice = cleanPrice + accrued;
  const w = DSC / E;

  // Frequency is always 2 (semiannual), matching Excel YIELD(...,2,1) — there is no
  // separate near-maturity convention for coupon-bearing TIPS/notes/bonds. This also
  // correctly handles the final (N=1) period: same PV formula, just one cash flow.
  const coupons = [];
  for (let k = 0; ; k++) {
    const d = addSemiannualPeriods(nextCoupon, k, mature.getDate());
    if (d > mature) break;
    coupons.push(d);
  }
  const N = coupons.length;
  if (N === 0) return null;

  function pv(y) {
    const r = y / 2;
    let s = 0;
    for (let k = 0; k < N; k++) {
      const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
      s += cf / Math.pow(1 + r, w + k);
    }
    return s;
  }
  function dpv(y) {
    const r = y / 2;
    let s = 0;
    for (let k = 0; k < N; k++) {
      const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
      s += (-cf * (w + k)) / (2 * Math.pow(1 + r, w + k + 1));
    }
    return s;
  }

  let y = coupon > 0.005 ? coupon : 0.02;
  for (let i = 0; i < 200; i++) {
    const diff = pv(y) - dirtyPrice;
    if (Math.abs(diff) < 1e-10) break;
    const deriv = dpv(y);
    if (Math.abs(deriv) < 1e-15) break;
    y -= diff / deriv;
  }
  return y;
}

// ─── Price from yield (Actual/Actual) ─────────────────────────────────────────
// Spec: PV of cash flows for a bond.
// yld: annual yield (decimal, e.g. 0.02)
// coupon: annual rate (decimal)
// settle: Date object
// mature: Date object
export function priceFromYield(yld, coupon, settle, mature) {
  if (yld === null || yld === undefined) return null;
  if (settle >= mature) return null;

  const semiCoupon = (coupon / 2) * 100;
  const matMon = mature.getMonth() + 1;
  const cm1 = matMon <= 6 ? matMon : matMon - 6;
  const cm2 = cm1 + 6;

  function nextCouponOnOrAfter(d) {
    const mDay = mature.getDate();
    const candidates = [];
    for (let y = d.getFullYear() - 1; y <= d.getFullYear() + 1; y++) {
      for (const mon of [cm1, cm2]) {
        const lastDay = new Date(y, mon, 0).getDate();
        candidates.push(new Date(y, mon - 1, Math.min(mDay, lastDay)));
      }
    }
    candidates.sort((a, b) => a - b);
    return candidates.find(c => c >= d && c <= mature) || null;
  }

  const nextCoupon = nextCouponOnOrAfter(settle);
  if (!nextCoupon) return null;
  const lastCoupon = addSemiannualPeriods(nextCoupon, -1, mature.getDate());

  const days = (a, b) => (b.getTime() - a.getTime()) / 86400000;
  const E = days(lastCoupon, nextCoupon);
  const A = days(lastCoupon, settle);
  const DSC = days(settle, nextCoupon);
  const accrued = semiCoupon * (A / E);
  const w = DSC / E;

  const coupons = [];
  for (let k = 0; ; k++) {
    const d = addSemiannualPeriods(nextCoupon, k, mature.getDate());
    if (d > mature) break;
    coupons.push(d);
  }
  const N = coupons.length;

  const r = yld / 2;
  let pv = 0;
  for (let k = 0; k < N; k++) {
    const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
    pv += cf / Math.pow(1 + r, w + k);
  }

  return pv - accrued; // Return clean price
}

// ─── Market-value weighted average ────────────────────────────────────────────
// SUMPRODUCT(values, costs) / SUM(costs). Both arrays must be equal length.
// Null/undefined values contribute 0 to numerator (cost still counts in denominator).
export function calcMktWtdAvg(values, costs) {
  let num = 0, den = 0;
  for (let i = 0; i < values.length; i++) {
    const c = costs[i] ?? 0;
    num += (values[i] ?? 0) * c;
    den += c;
  }
  return den > 0 ? num / den : 0;
}

// ─── Rung amount ──────────────────────────────────────────────────────────────
// Spec: 5.0 §rungAmount, 4.0 Phase 5 ARA After formula
export function rungAmount(qty, piPerBond, laterMatInt) {
  return qty * piPerBond + laterMatInt;
}

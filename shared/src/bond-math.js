// bond-math.js — Core financial math for TIPS and nominal Treasuries.
// Pure per-unit calculations ($1,000 face value).
// Spec: ../knowledge/TIPS_Basics.md, knowledge/4.0_Computation_Modules.md §bond-math.js

import { indexRatio as calcIndexRatio } from './ref-cpi.js';

// ─── Calendar-day count ───────────────────────────────────────────────────────
// Date objects here are local-midnight timestamps (`new Date(y, m, d)`). Diffing
// their .getTime() values directly is WRONG whenever the interval crosses a DST
// transition: the local clock gains/loses an hour, so the ms delta is off by
// ±3,600,000ms (±1/24 day ≈ ±0.0417) from the true calendar-day count. Normalizing
// both endpoints to UTC-midnight before diffing removes the DST artifact.
export function daysBetween(a, b) {
  const utc = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return (utc(b) - utc(a)) / 86400000;
}

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

// Full Macaulay-duration workings: coupon-date walk, day-count fractions, per-period cash
// flows/PVs. calculateDuration/calculateMDuration are thin wrappers over this — single source
// for both the final number and any UI that needs to show how it was derived (5.0 §Nested
// (Level-3) drills, gap/Future 30Y synthetic-duration drill-downs).
// Returns null if inputs are degenerate (settlement >= maturity, yld <= -2, or no coupon dates).
export function calculateDurationDetail(settlement, maturity, coupon, yld) {
  if (settlement >= maturity || yld <= -2) return null;
  const nextCpn = _nextCouponOnOrAfter(settlement, maturity);
  if (!nextCpn) return null;
  const mDay   = maturity.getDate();
  const lastCpn = addSemiannualPeriods(nextCpn, -1, mDay);
  const E   = daysBetween(lastCpn, nextCpn);
  const DSC = daysBetween(settlement, nextCpn);
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
  const periods = [];
  for (let j = 0; j < N; j++) {
    const cf = j === N - 1 ? semiCpn + 1000 : semiCpn;
    const t  = w + j;
    const pv = cf / Math.pow(1 + r, t);
    wSum  += t * pv;
    pvSum += pv;
    periods.push({ date: coupons[j], t, cf, pv });
  }
  return { nextCpn, lastCpn, E, DSC, w, periods, macaulay: wSum / pvSum / 2 };
}

// Returns Macaulay duration in years, or null if inputs are degenerate.
export function calculateDuration(settlement, maturity, coupon, yld) {
  const detail = calculateDurationDetail(settlement, maturity, coupon, yld);
  return detail ? detail.macaulay : null;
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

// ─── Coupon payment schedule ──────────────────────────────────────────────────
// All coupon dates from `settle` (inclusive) through `maturity` (inclusive) — the final
// entry is also the principal repayment date. Spec: 5.0 §Cash Flow Calendar.
export function couponSchedule(settle, maturity) {
  const nextCpn = _nextCouponOnOrAfter(settle, maturity);
  if (!nextCpn) return [];
  const mDay = maturity.getDate();
  const dates = [];
  for (let k = 0; ; k++) {
    const d = addSemiannualPeriods(nextCpn, k, mDay);
    if (d > maturity) break;
    dates.push(d);
  }
  return dates;
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

// ─── Days in the year following a given date ──────────────────────────────────
// Per Treasury's Treasury-bill investment-rate formula (ofcalc6decbill.pdf, "Price,
// Yield and Rate Calculations for a Treasury Bill"): y = the actual number of days
// from settlement to the same calendar date one year later — 365, or 366 if that
// twelve-month span crosses Feb 29. This is NOT the same question as whether the
// (shorter) settlement-to-maturity window itself contains Feb 29 — a short bill
// settling in January and maturing in February, for example, never reaches Feb 29
// in its own window even in a leap year, but still uses y=366 because the year
// following settlement does. Spec: 1.0 Bond Basics §Treasury Bill Yield.
export function daysInYearFrom(settle) {
  const oneYearLater = new Date(settle.getFullYear() + 1, settle.getMonth(), settle.getDate());
  return daysBetween(settle, oneYearLater);
}

// ─── Term (years to maturity) ─────────────────────────────────────────────────
// Under 1 year: actual/actual (365, or 366 per daysInYearFrom above).
// 1 year or more: 365.25, the long-run average that avoids a single term's
// leap-year placement skewing a multi-year figure.
export function termYears(settle, maturity) {
  const daysToMat = daysBetween(settle, maturity);
  if (daysToMat < 365) {
    return daysToMat / daysInYearFrom(settle);
  }
  return daysToMat / 365.25;
}

// ─── Accrued interest (actual/actual day count) ───────────────────────────────
// Spec: 1.0 Bond Basics §Accrued Interest, 4.0 Computation Modules §accruedInterest
// Prorates the current coupon period by days elapsed since the last coupon date.
// Returns accrued interest per $100 par (nominal — no index ratio applied), plus
// the day-count components (A = days since last coupon, E = days in period).
// settle: Date object. mature: Date object.
export function accruedInterest(coupon, settle, mature) {
  const nextCoupon = _nextCouponOnOrAfter(settle, mature);
  if (!nextCoupon) return { accrued: 0, A: 0, E: 0, lastCoupon: null, nextCoupon: null };
  const lastCoupon = addSemiannualPeriods(nextCoupon, -1, mature.getDate());
  const E = daysBetween(lastCoupon, nextCoupon);
  const A = daysBetween(lastCoupon, settle);
  const semiCoupon = (coupon / 2) * 100;
  return { accrued: semiCoupon * (A / E), A, E, lastCoupon, nextCoupon };
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

  const daysToMat = daysBetween(settle, mature);
  const semiCoupon = (coupon / 2) * 100;

  // Zero-coupon bills: Treasury's own investment-rate (coupon-equivalent yield)
  // formula, per ofcalc6decbill.pdf. For bills of not more than one half-year to
  // maturity: i = ((100-P)/P) × (y/r), where y = daysInYearFrom(settle) (365 or
  // 366) and r = daysToMat. Bills of more than one half-year to maturity use
  // Treasury's quadratic CEY formula — validated (see knowledge/Bond_Basics.md
  // §Treasury Bill Yield) to match the standard frequency=2 YIELD formula below
  // to within rounding, so no separate quadratic solver is needed here; falling
  // through to the frequency=2 path (zero coupon, one synthetic final cash flow)
  // reproduces it. No coupon schedule exists for the ≤6mo case, so it stays a
  // pure day-count test.
  if (semiCoupon === 0) {
    const daysInYear = daysInYearFrom(settle);
    if (daysToMat < daysInYear / 2) return (100 / cleanPrice - 1) * daysInYear / daysToMat;
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
  const { accrued, E } = accruedInterest(coupon, settle, mature);
  const DSC = daysBetween(settle, nextCoupon);
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

  const { accrued, E } = accruedInterest(coupon, settle, mature);
  const DSC = daysBetween(settle, nextCoupon);
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

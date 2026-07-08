// bond-math.test.js — Regression coverage for shared/src/bond-math.js.
// Run: node shared/tests/bond-math.test.js
//
// yieldFromPrice/priceFromYield always use frequency=2 (semiannual), actual/actual —
// matching Excel YIELD(settlement, maturity, rate, pr, redemption, 2, 1). There is no
// separate "near-maturity simple discounting" convention for coupon-bearing TIPS/notes/
// bonds (a prior version had one, decided by days-to-maturity alone; it both broke when
// settle landed within a day of an INTERMEDIATE, non-final coupon — surfaced by
// YieldsMonitor's SA historical reconstruction sweeping settle across every calendar
// day — and diverged from priceFromYield, which never had that special case).

import { yieldFromPrice, priceFromYield } from '../src/bond-math.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };

function roundTrips(settle, mature, coupon, yld, tol = 1e-9) {
  const price = priceFromYield(yld, coupon, settle, mature);
  const back = yieldFromPrice(price, coupon, settle, mature);
  return { price, back, diff: Math.abs(back - yld) };
}

// Coupon dates Jan15/Jul15; maturity Jul15-2026. Settle one day before the INTERMEDIATE
// Jan15-2026 coupon (daysToMat = 182 < 182.5, but two cashflows remain, not one).
{
  const { back, diff } = roundTrips(new Date(2026, 0, 14), new Date(2026, 6, 15), 0.00125, 0.0293);
  ok(diff < 1e-9, `settle just before intermediate coupon: round-trip yield ${back} should equal 0.0293 (diff ${diff})`);
}

// Settle exactly ON the intermediate coupon date (DSC = 0 relative to that coupon).
{
  const { back, diff } = roundTrips(new Date(2026, 0, 15), new Date(2026, 6, 15), 0.00125, 0.0293);
  ok(diff < 1e-9, `settle exactly on intermediate coupon: round-trip yield ${back} should equal 0.0293 (diff ${diff})`);
}

// True last-period case (settle within 6mo of maturity, no intermediate coupon): still
// frequency=2, round-trips exactly, same as any other period count.
{
  const { back, diff } = roundTrips(new Date(2026, 5, 1), new Date(2026, 6, 15), 0.00125, 0.0293);
  ok(diff < 1e-9, `true last period: round-trip yield ${back} should equal 0.0293 (diff ${diff})`);
}

// Normal multi-year case, far from any boundary — unaffected by the fix.
{
  const { back, diff } = roundTrips(new Date(2026, 6, 2), new Date(2028, 0, 15), 0.005, 0.022);
  ok(diff < 1e-9, `normal multi-period case: round-trip yield ${back} should equal 0.022 (diff ${diff})`);
}

// Zero-coupon bill near maturity still uses the simple day-count formula.
{
  const settle = new Date(2026, 5, 1), mature = new Date(2026, 8, 1);
  const price = 99.2;
  const y = yieldFromPrice(price, 0, settle, mature);
  const daysToMat = (mature - settle) / 86400000;
  const expected = (100 / price - 1) * 365 / daysToMat;
  ok(Math.abs(y - expected) < 1e-12, `zero-coupon bill formula unchanged: ${y} vs ${expected}`);
}

// Zero-coupon bill whose term spans Feb 29 (leap day) uses 366, not 365, per
// Treasury's published convention (TIPS_Basics.md "Exception — zero-coupon
// Treasury Bills").
{
  const settle = new Date(2028, 0, 15), mature = new Date(2028, 3, 15); // 2028 is a leap year
  const price = 98.9;
  const y = yieldFromPrice(price, 0, settle, mature);
  const daysToMat = (mature - settle) / 86400000;
  const expected = (100 / price - 1) * 366 / daysToMat;
  ok(Math.abs(y - expected) < 1e-12, `leap-spanning zero-coupon bill uses 366: ${y} vs ${expected}`);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

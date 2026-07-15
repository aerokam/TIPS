// primer-bills.js — Treasury bill discount-rate/price formulas, 31 CFR 356
// Appendix B §VI.A and §VI.C. These are genuinely new (no other app in this
// suite bids or quotes bills by discount rate — they all work in yield/price),
// so they live here rather than in shared/src/bond-math.js.
//
// "Investment rate" (§VI.D, coupon-equivalent yield) is NOT reimplemented here:
// shared/src/bond-math.js's yieldFromPrice() already computes it (simple
// day-count formula for <=26-week bills, semiannual-compounded for longer
// ones) — see knowledge/1.0_Primer.md for why that is the same calculation.

// §VI.A — discount rate to price. d = discount rate (decimal), r = days to maturity.
export function discountRateToPrice(d, r) {
  return 100 * (1 - (d * r) / 360);
}

// §VI.C — price to discount rate.
export function priceToDiscountRate(price, r) {
  return ((100 - price) / 100) * (360 / r);
}

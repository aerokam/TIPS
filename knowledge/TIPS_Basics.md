# 2.1 TIPS Basics

## Dependencies
**Requires:** 1.0 Bond Basics

**Inherits all terms from 1.0:**
- Face Value (unadjusted baseline), Coupon Rate, Maturity Date, Settlement
- Semi-Annual Payment, Annual Interest per TIPS, Price
- Last-Year Interest Payments (general principle)

---

## TIPS-Specific Terms

**TIPS (Treasury Inflation-Protected Securities):** Marketable Treasury securities whose principal is adjusted by changes in the Consumer Price Index.

- **[Quantity](./DATA_DICTIONARY.md#quantity):** Number of TIPS held; qty 1 = $1,000 face value (e.g., qty 50 = $50,000 face value).
- **[Face Value](./DATA_DICTIONARY.md#face-value):** Quantity × $1,000 (e.g., $50,000).
- **[Par Value (Adjusted Principal)](./DATA_DICTIONARY.md#par-value-adjusted):** The principal value after being adjusted for inflation/deflation.
  - `Par Value = Face Value × Index Ratio`
  - This is the value used to calculate interest payments and the redemption amount at maturity.

**CPI-U (NSA):** Consumer Price Index for All Urban Consumers, Non-Seasonally Adjusted.
- Published monthly by Bureau of Labor Statistics.
- Released mid-month for prior month data.

- **[Reference CPI](./DATA_DICTIONARY.md#ref-cpi):** Daily interpolated value used for TIPS calculations.
  - **Legal Authority:** 31 CFR § 356 Appendix B, Section I, Paragraph B.
  - **Principle:** The Reference CPI for the first day of any month is the CPI-U (NSA) for the third month preceding that month.

```
For the 1st of the month:
  Ref CPI(month, 1) = CPI-U(month - 3)
  Example: Ref CPI for April 1st uses the CPI-U for January.

For days 2-31:
  Ref CPI(month, day) = Ref CPI(month, 1) + 
                       (Ref CPI(month+1, 1) - Ref CPI(month, 1)) * 
                       (day - 1) / daysInMonth
```

> **Two derivations, one authority.** The daily Ref CPI is obtained two ways that must agree: **retrieved** from TreasuryDirect (`RefCPI.csv`) is **authoritative** and used by all apps; **calculated** via the interpolation above is retained for educational value and as a **fallback** if retrieval fails. Both are implemented once in `shared/src/ref-cpi.js`. See [DATA_DICTIONARY.md#ref-cpi](./DATA_DICTIONARY.md#ref-cpi).

**Dated Date:** 15th of the month in which TIPS was issued.

**Ref CPI on Dated Date:** Reference CPI on the dated date (constant for bond lifetime).

- **[Index Ratio](./DATA_DICTIONARY.md#index-ratio):**
```
indexRatio(date) = refCPI(date) / refCPI(datedDate)
```

---

## Inflation-Adjusted Calculations

**Par Value (Adjusted Principal):**
```
parValue = faceValue * indexRatio
```

**Inflation-Adjusted Annual Interest (per TIPS):**
```
adjustedAnnualInterest = Par Value * couponRate
```

**Inflation-Adjusted Semi-Annual Interest:**
```
adjustedSemiAnnualInterest = adjustedAnnualInterest / 2
```

---

## TIPS-Specific Rules

**TIPS Maturity Dates:** Always 15th of month (Jan, Feb, Apr, Jul, Oct).

**Last-Year Interest (TIPS):**
- Jan-Jun maturity: 1 payment in final year
- Jul-Dec maturity: 2 payments in final year
```
For Jan maturity (month 1 < 7):
  lastYearInterest = adjustedAnnualInterest * 0.5

For Jul maturity (month 7 \u2265 7):
  lastYearInterest = adjustedAnnualInterest * 1.0
```

**[P+I per TIPS](./DATA_DICTIONARY.md#pi-per-tips):**
The total inflation-adjusted cash flow (Par Value + Last-Year Interest) received in the year the security matures.
```
piPerBond = Par Value + lastYearInterest
```

**[Cost per TIPS](./DATA_DICTIONARY.md#cost-per-tips):**
The nominal cost to purchase one $1,000 Face Value unit.
```
costPerBond = price/100 × indexRatio × 1,000
```

**[Accrued Interest](./DATA_DICTIONARY.md#accrued-interest-adjusted):**
Extends **1.0 Bond Basics §Accrued Interest** the same way Par Value (Adjusted) extends Par Value
(Nominal): take the nominal, per-$100-par accrued interest (Actual/Actual day count — same A/E
convention used by Yield Calculation Conventions and Duration below) and apply the Index Ratio.
```
accruedPerBond = accruedInterestNominal / 100 × indexRatio × 1,000   // real dollars per bond
```
Total settlement cost to acquire a TIPS = Cost per TIPS + Accrued Interest.

---

## Yield Calculation Conventions

TIPS yield-to-maturity (YTM) always uses semi-annual compounding, Actual/Actual day count — matching Excel's `YIELD(settlement, maturity, rate, pr, redemption, 2, 1)` with `frequency=2` fixed, regardless of how close settlement is to maturity. There is **no separate near-maturity/short-dated convention** for coupon-bearing TIPS, notes, or bonds — every remaining-period count (including the final period) is priced with the same multi-period PV formula.

A prior version of this app special-cased settlements within ~6 months of maturity with a simple/linear single-period formula. That was removed: deciding "is this the last period" from days-to-maturity alone is unsafe (a settlement date landing just before an *intermediate*, non-final coupon can also be under 6 months from maturity, which wrongly priced that intermediate coupon as the final payment), and it made `yieldFromPrice`/`priceFromYield` round-trip inconsistently near maturity even when correctly triggered. Always using `frequency=2` matches real-world spreadsheet YIELD calculations validated against broker data.

**Exception — zero-coupon Treasury Bills**: Bills have no coupon schedule to apply frequency/day-count to, so they use the simple investment-rate convention instead: `Yield = (100/Price − 1) × 365/DaysToMaturity` (366 if a leap day falls within the period). This is a different instrument, not a "near-maturity TIPS" case.

**Validated 2026-07-24** against the live `FidelityTreasuriesTips.csv` (settlement = T+1 business day, which Fidelity uses): spreadsheet `YIELD(settle, maturity, rate, price, 100, frequency, 1)` with `frequency=1` on a bill matched Fidelity's displayed yield to 0.1bp, but that's a coincidence of the bill case (frequency algebraically cancels out of Excel's own "one period or less remaining" formula for a zero-coupon instrument — it doesn't mean bills want `frequency=1`, and `frequency=2` matched equally well there). On an actual coupon-bearing security, `frequency=2` matched Fidelity to 3 decimal places while `frequency=1` was off by 1.8bp — confirming there is no near-maturity/frequency=1 case for coupon bonds, matching the rule above. A companion sweep across 1,400+ bid/ask observations in that file (bucketed by days-to-maturity) confirmed `frequency=2` wins decisively for coupon bonds beyond ~180 days (sub-0.1bp error vs several bp for `frequency=1`); under ~90 days both frequencies leave a few bp of residual, attributable to day-count/settlement precision (the same extreme yield-sensitivity-to-price effect noted for bills), not a real frequency effect.

**Computed yield vs. vendor-supplied yield field**: prefer computing yield from price (`yieldFromPrice`) over trusting a vendor's own displayed yield column directly. Vendor yield fields are rounded for display (Fidelity's to 3 decimals = 0.1bp granularity) while price fields carry more precision (Fidelity's to 6 decimals); the 2026-07-24 validation above confirms `yieldFromPrice` reproduces Fidelity's displayed yield to the limit of *their* rounding, so computing from price recovers real precision Fidelity's display already discarded, not formula error. See `knowledge/DATA_DICTIONARY.md` §S7 for where this is (and isn't yet) applied consistently across Treasury vs. TIPS parsing.

---

## Duration

**Macaulay Duration:** The present-value–weighted average time to receive a bond's cash flows, measured in years.

Uses the same convention as yield-to-maturity: **Actual/Actual day count, semi-annual compounding** (frequency = 2). Matches Google Sheets `DURATION(settlement, maturity, coupon, yld, 2, 1)`.

The fractional first coupon period `w = DSC/E` (where DSC = days from settlement to next coupon, E = length of that coupon period in days) is used to avoid the ±0.5 y error that arises from rounding to the nearest whole coupon period. See `4.0 §calculateDuration` for the full formula.

**Modified Duration:** Exact first derivative of price with respect to yield, normalized by price:

```
MD = -(1/P) · dP/dy = macaulayDuration / (1 + yld/2)
```

This is an exact result for semi-annual compounding, derived directly from differentiating the present-value sum. It measures price sensitivity: a bond with modified duration 8 loses approximately 8% of price for a +1% parallel shift in yield (first-order; convexity is a second-order correction).

**Guard conditions (both `calculateDuration` and `calculateMDuration`):**
- Return `null` if `settlement >= maturity`
- Return `null` if `yld ≤ −2`; negative yields between −2 and 0 are **valid** and are not filtered out

# 1.0 Bond Basics

## Dependencies
**None** (foundation layer)

---

## Scope
In this specification, "Treasury" refers to U.S. Treasury securities (bills, notes, bonds, TIPS). While the market often uses "bond" as a catch-all, Treasury technically distinguishes between Bills (maturity ≤ 1 year), Notes (2–10 years), and Bonds (> 10 years). TIPS are issued as either notes or bonds. We use "bond" here for the general $1,000 unit of account, while specifying the asset class where the distinction matters.

---

## Core Terms

- **[Quantity](./DATA_DICTIONARY.md#quantity):** The number of $1,000 units of a security (e.g., 50).
- **[Face Value](./DATA_DICTIONARY.md#face-value):** The original, unadjusted principal amount of a security (e.g., $50,000 for a quantity of 50). This is the baseline amount used as the unit of account. 
- **[Par Value (Nominal)](./DATA_DICTIONARY.md#par-value-nominal):** The current principal value of the security. For nominal Treasuries, Par Value equals Face Value. For TIPS, Par Value includes inflation adjustments (Face Value × Index Ratio).
- **[Annual Interest (Nominal)](./DATA_DICTIONARY.md#annual-interest-nominal):** The fixed annual coupon rate multiplied by the Face Value (for nominals) or Par Value (for TIPS).
  ```
  annualInterest = Face Value * couponRate (nominal)
  ```
  *(See 2.1 TIPS Basics for inflation-adjusted interest formulas)*
- **[Price](./DATA_DICTIONARY.md#price):** Market value expressed as percentage of par (e.g., 102.5 = 102.5% of par).
- **[Clean Price](./DATA_DICTIONARY.md#clean-price):** Quoted market price, excluding accrued interest.
- **[Accrued Interest](./DATA_DICTIONARY.md#accrued-interest-nominal):** Interest earned by the current holder since the last coupon payment, owed by the buyer to the seller at settlement — **Actual/Actual day count**, not a flat half-coupon.
  ```
  A = days elapsed since the last coupon date
  E = days in the current coupon period
  accruedInterest = (couponRate/2 × 100) × (A / E)   // per $100 par
  ```
  A bond bought the day after a coupon date owes almost no accrued interest; one bought the day before the next coupon owes nearly the full semiannual coupon. Dirty price (what the buyer actually pays) = Clean Price + Accrued Interest.
  *(See 2.1 TIPS Basics for the inflation-adjusted extension.)*
- **[Settlement Date](./DATA_DICTIONARY.md#settlement-date):** Trade date + 1 business day (T+1) for secondary market trades.
- **Maturity Date:** Date when principal is repaid to bondholder.
- **Last-Year Interest Payments:**
  - Coupon payments are always semi-annual (every 6 months)
  - If maturity date falls within 6 months of prior payment: 1 payment in final year
  - If maturity date falls more than 6 months after prior payment: 2 payments in final year

---

## Yield Calculation Conventions

Treasury note/bond yield-to-maturity always uses semi-annual compounding, Actual/Actual day count — matching Excel's `YIELD(settlement, maturity, rate, pr, redemption, 2, 1)` with `frequency=2` fixed, regardless of how close settlement is to maturity. There is **no separate near-maturity/short-dated convention** for coupon-bearing securities — every remaining-period count (including the final period) is priced with the same multi-period PV formula. (TIPS inherit this convention unchanged — see 2.1 TIPS Basics.)

A prior version of this app special-cased settlements within ~6 months of maturity with a simple/linear single-period formula. That was removed: deciding "is this the last period" from days-to-maturity alone is unsafe (a settlement date landing just before an *intermediate*, non-final coupon can also be under 6 months from maturity, which wrongly priced that intermediate coupon as the final payment), and it made `yieldFromPrice`/`priceFromYield` round-trip inconsistently near maturity even when correctly triggered. Always using `frequency=2` matches real-world spreadsheet YIELD calculations validated against broker data.

**Validated 2026-07-24** against the live `FidelityTreasuriesTips.csv` (settlement = T+1 business day, which Fidelity uses): spreadsheet `YIELD(settle, maturity, rate, price, 100, frequency, 1)` with `frequency=1` on a bill matched Fidelity's displayed yield to 0.1bp, but that's a coincidence of the bill case (frequency algebraically cancels out of Excel's own "one period or less remaining" formula for a zero-coupon instrument — it doesn't mean bills want `frequency=1`, and `frequency=2` matched equally well there). On an actual coupon-bearing security, `frequency=2` matched Fidelity to 3 decimal places while `frequency=1` was off by 1.8bp — confirming there is no near-maturity/frequency=1 case for coupon bonds, matching the rule above. A companion sweep across 1,400+ bid/ask observations in that file (bucketed by days-to-maturity) confirmed `frequency=2` wins decisively for coupon bonds beyond ~180 days (sub-0.1bp error vs several bp for `frequency=1`); under ~90 days both frequencies leave a few bp of residual, attributable to day-count/settlement precision (the same extreme yield-sensitivity-to-price effect noted for bills), not a real frequency effect.

**Computed yield vs. vendor-supplied yield field**: prefer computing yield from price (`yieldFromPrice`) over trusting a vendor's own displayed yield column directly. Vendor yield fields are rounded for display (Fidelity's to 3 decimals = 0.1bp granularity) while price fields carry more precision (Fidelity's to 6 decimals); the 2026-07-24 validation above confirms `yieldFromPrice` reproduces Fidelity's displayed yield to the limit of *their* rounding, so computing from price recovers real precision Fidelity's display already discarded, not formula error. See `knowledge/DATA_DICTIONARY.md` §S7 for where this is (and isn't yet) applied consistently across Treasury vs. TIPS parsing.

---

## Treasury Bill Yield (Investment Rate)

Treasury Bills carry no coupon, so the `frequency=2` convention above doesn't apply to them directly — Treasury specifies its own investment-rate (coupon-equivalent yield, CEY) formula, split by remaining maturity. Source: U.S. Treasury, *"Price, Yield and Rate Calculations for a Treasury Bill"* (https://www.treasurydirect.gov/instit/annceresult/press/preanre/2004/ofcalc6decbill.pdf).

**y (days in year)**: for both formulas below, `y` = the actual number of days from settlement to the same calendar date one year later — 365, or 366 if that twelve-month span crosses Feb 29. This is **not** the same question as whether the (shorter) settlement-to-maturity window itself contains Feb 29 — a bill settling in January and maturing in February never reaches Feb 29 in its own window even in a leap year, but still uses y=366 because the year following settlement does. `r` = days to maturity (settlement to maturity).

**Bills of not more than one half-year to maturity** (`r < y/2`):
```
i = ((100 - P) / P) × (y / r)
```

**Bills of more than one half-year to maturity** (`r ≥ y/2`) — Treasury's basic formula
```
P [1 + (r - y/2)(i/y)] (1 + i/2) = 100
```
expressed as a quadratic `a·i² + b·i + c = 0` and solved for `i`:
```
a = (r / 2y) - 0.25
b = r / y
c = (P - 100) / P
i = (-b + √(b² - 4ac)) / (2a)
```

**Validated 2026-08-15** against both of the PDF's own worked examples: the quadratic form (settle Jun 7 1990, mature Jun 6 1991, P=92.265000) gives i=8.237%; computing the same bill through the standard `frequency=2` YIELD formula above (treating the bill as a zero-coupon security with one synthetic final cash flow) gives 8.238% — a 0.1bp gap consistent with the PDF's own note that it rounds intermediate steps. **The app does not implement the quadratic separately** — `yieldFromPrice` routes bills of more than one half-year through the same `frequency=2` path used for coupon-bearing securities, which reproduces Treasury's CEY to within display rounding. Only the ≤6-month simple formula is implemented directly, since it diverges from the `frequency=2`/compound-interest formula (simple vs. compound interest — a real difference, not just rounding).

Implementation: `shared/src/bond-math.js` — `daysInYearFrom(settle)`, `yieldFromPrice()`.

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

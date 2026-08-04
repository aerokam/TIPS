# TIPS OID and Tax Reference

**Foundation dependency:** This document relies on [TaxationOfTreasuries_Foundation.md](TaxationOfTreasuries_Foundation.md) for the following shared principles: federal taxability, state and local exemption, composite 1099 structure, tax software general notes, and caveats. When editing this document, review the Foundation doc to determine whether any changes also belong there.

This document covers TIPS-specific OID calculation, ABP mechanics, broker reporting configurations, and cost basis. For the six purchase/disposition scenarios applicable to TIPS, see [TaxationOfTreasuryNotesAndBonds.md](TaxationOfTreasuryNotesAndBonds.md).

## Table of Contents

1. [Regulatory Basis](#regulatory-basis)
   - [Qualified Stated Interest — Treas. Reg. §1.1275-7(d)](#qualified-stated-interest--treas-reg-112757d)
   - [Form 1099 Reporting Authority](#form-1099-reporting-authority)
2. [The Three Taxable Items for TIPS Held in Taxable Accounts](#the-three-taxable-items-for-tips-held-in-taxable-accounts)
3. [Purchase Cost Formula](#purchase-cost-formula)
4. [Box 3: Qualified Stated Interest (Coupon)](#box-3-qualified-stated-interest-coupon)
5. [Box 8: OID (Annual Inflation Accrual)](#box-8-oid-annual-inflation-accrual)
   - [Vanguard — Monthly Breakdown](#vanguard--monthly-breakdown)
   - [Broker Comparison](#broker-comparison)
6. [Box 12: Amortized Bond Premium (ABP)](#box-12-amortized-bond-premium-abp)
   - [Bond Premium Calculation](#bond-premium-calculation)
   - [Amortization Method: Constant Yield (Semi-Annual Periods)](#amortization-method-constant-yield-semi-annual-periods)
   - [Example: CUSIP 91282CEJ6](#example-cusip-91282cej6)
   - [Notes on Broker ABP Reporting](#notes-on-broker-abp-reporting)
7. [Cost Basis Step-Up](#cost-basis-step-up)
8. [Vanguard Online Statement — TIPS Field Definitions](#vanguard-online-statement--tips-field-definitions)
9. [Broker Error Case Studies](#broker-error-case-studies)
   - [Schwab — CUSIP 91282CDX6](#broker-error-case-study-schwab--cusip-91282cdx6)
10. [Agent Instructions](#agent-instructions)
    - [Dependencies](#dependencies)

---

## Regulatory Basis

### Qualified Stated Interest — Treas. Reg. §1.1275-7(d)

For TIPS subject to the coupon bond method, the regulation defines qualified stated interest as follows:

> "All stated interest on the debt instrument is qualified stated interest. For purposes of this paragraph (d), stated interest is qualified stated interest if the interest is unconditionally payable in cash, or is constructively received under section 451, at least annually at a single fixed rate. **Stated interest is payable at a single fixed rate if the amount of each interest payment is determined by multiplying the inflation adjusted principal amount for the payment date by the single fixed rate.**"

This means each TIPS coupon payment = face × IR(payment date) × (coupon rate / 2), where IR is the index ratio on the payment date. The actual cash coupon paid embeds the inflation adjustment because it is applied to inflation-adjusted principal. This is what is reported in **1099-INT Box 3**.

### Form 1099 Reporting Authority

Per IRS Instructions for Forms 1099-INT and 1099-OID:

> "You may report any qualified stated interest on Treasury Inflation Protected Securities in box 3 of Form 1099-INT rather than in box 2 of Form 1099-OID."

Brokers elect either (a) report QSI on 1099-INT Box 3 and OID on 1099-OID Box 8, or (b) report both on 1099-OID (Box 2 and Box 8). Among the three major brokers, Vanguard and Fidelity use option (a); Schwab uses a hybrid (QSI on 1099-INT Box 3, ABP on 1099-OID Box 10 — see table below).

**ABP reporting is tied to QSI reporting — the two cannot be split across forms.** Per the same IRS instructions: if a broker reports QSI in 1099-OID Box 2, it must report ABP in 1099-OID Box 10 and may not report ABP on 1099-INT. Box 10 explicitly covers TIPS: *"For a taxable covered security, including a Treasury inflation-protected security, shows the amount of premium amortization allocable to the interest payment(s)."*

| Configuration | QSI Box | ABP Box |
|---|---|---|
| Common (e.g., Vanguard, Fidelity) | 1099-INT Box 3 | 1099-INT Box 12 |
| Alternative (per IRS instructions) | 1099-OID Box 2 | 1099-OID Box 10 |
| Schwab (confirmed) | 1099-INT Box 3 | 1099-OID Box 10 |

Schwab uses a hybrid configuration: QSI in 1099-INT Box 3 (not Box 2), ABP in 1099-OID Box 10. This does not match either standard configuration defined in the IRS instructions — the IRS rule pairs Box 2 with Box 10, but Schwab reports QSI on 1099-INT while placing ABP on 1099-OID. The practical effect is correct (ABP reduces interest income), but the split across forms is non-standard. Confirmed via Bogleheads forum (CUSIP 91282CDX6, $88,000 face). → [See Schwab ABP error case study](#broker-error-case-study-schwab--cusip-91282cdx6)

---

## The Three Taxable Items for TIPS Held in Taxable Accounts

| Box | Content | Formula / Effect | State-Exempt |
|---|---|---|---|
| 1099-INT Box 3 | Semi-annual coupon (QSI) | `face × IR(payment date) × coupon/2` | Yes |
| 1099-INT Box 12 | Amortized bond premium (ABP) — common config | Reduces Box 3 | — |
| 1099-OID Box 2 | Semi-annual coupon (QSI) — alternative config | Same formula as Box 3 | Yes |
| 1099-OID Box 8 | Annual inflation accrual (OID) | `face × (IR_end − IR_start)` | Yes |
| 1099-OID Box 10 | Amortized bond premium (ABP) — alternative/Schwab config | Reduces Box 2 or Box 3 | — |

Box 12 (or Box 10 if your broker uses the alternative or Schwab configuration) applies only if the TIPS was purchased at a premium (adjusted cost > indexed par). It reduces the taxable interest on Schedule B.

---

## Purchase Cost Formula

For auction purchases (original or reopening), all inputs from `TipsAuctionResults.csv`:

```
indexed_par  = face × IR(issue_date)
adj_cost     = indexed_par × (unadj_price / 100)
accrued_int  = face × (adj_accrued_int_per1000 / 1000)
total_paid   = adj_cost + accrued_int
bond_premium = adj_cost − indexed_par   (if positive; zero if purchased at discount)
```

Match the correct CSV row by CUSIP **and** issue date — multiple rows exist per CUSIP for original auction plus reopenings.

---

## Box 3: Qualified Stated Interest (Coupon)

Each semi-annual coupon payment reported in Box 3:

```
coupon_payment = face × (coupon_rate / 2) × IR(payment_date)
```

Where IR(payment_date) = refCPI(payment_date) / refCPI(dated_date).

The Box 3 annual total is the sum of both semi-annual payments. Note: because this is the actual cash received (inflation-adjusted), the payment will vary each period as inflation changes.

---

## Box 8: OID (Annual Inflation Accrual)

Per IRS Pub 1212, annual OID = inflation-adjusted principal at year-end minus inflation-adjusted principal at start of holding period for the year:

```
annual_OID = face × (IR(1/1 next year) − IR(first day held this year))
           = face × (refCPI(1/1 next year) − refCPI(first day held)) / refCPI_dated_date
```

For the first year held, "first day held" = settlement date. For subsequent years, it is 1/1 of that year.

### Vanguard — Monthly Breakdown

Vanguard subdivides the annual OID into monthly rows per tax lot. Formula for each row:

```
OID = face × (refCPI_end − refCPI_start) / refCPI_dated_date
```

**Period structure:**
- Row 1: settlement date → 1st of following month
- Rows 2–11: 1st of month → 1st of next month
- Final row: 12/1 → 1/1 of following year
- If sold/matured during year: final row ends on settlement/maturity date

Row 1 may be slightly negative if settlement is near month-end and ref CPI interpolation dips — normal, not an error. Rows sum to the Box 8 total within $0.01.

### Broker Comparison

| Broker | OID Detail | Year-End Date |
|---|---|---|
| Vanguard | Monthly rows per lot | 1/1 ✓ |
| Fidelity | Single total per CUSIP | 1/1 ✓ |
| TreasuryDirect | Annual only | 12/31 ❌ |

TD 1099-OID is calculated incorrectly per IRS Pub 1212 — always recalculate if using TD figures. (TD uses 12/31 as year-end; IRS Pub 1212 requires the ref CPI for 1/1 of the following year.)

---

## Box 12: Amortized Bond Premium (ABP)

Applies only when TIPS is purchased at a premium (adjusted cost > indexed par on issue date). The bond premium is amortized over the life of the bond and reported annually in 1099-INT Box 12 (or 1099-OID Box 10 for Schwab) as a reduction of interest income.

### Bond Premium Calculation

```
indexed_par  = face × IR(issue_date)
adj_cost     = indexed_par × (unadj_price / 100)
bond_premium = adj_cost − indexed_par
```

### Amortization Method: Constant Yield (Semi-Annual Periods)

The correct method per §171 uses the constant yield method with semi-annual accrual periods coinciding with coupon payment dates (confirmed by FactualFran and #Cruncher). Day count convention: Actual/Actual (US Treasury standard).

Key inputs:
```
interest_per_period = indexed_par × (coupon_rate / 2)   ← uses indexed par, NOT face
semi_annual_yield   = real_yield_to_maturity / 2
```

Note: the coupon used in the ABP formula is `indexed_par × (coupon_rate / 2)`, not `face × (coupon_rate / 2)`. This reflects the actual QSI payment on inflation-adjusted principal per Reg. §1.1275-7(d), and produces a near-perfect amortization match to the original premium.

**First period (stub):** TIPS are typically issued mid-period. The first coupon period runs from the dated date (COUPPCD) to the first coupon date (COUPNCD).

```
days_in_period       = first_coupon_date − dated_date
days_before_issued   = issue_date − dated_date
days_after_issued    = first_coupon_date − issue_date

accrued_at_issue     = interest_per_period × (days_before_issued / days_in_period)
constant_yield_first = cost × (semi_annual_yield) × (days_after_issued / days_in_period)
ABP_first            = interest_per_period − accrued_at_issue − constant_yield_first
ending_basis         = cost − ABP_first
```

**Subsequent regular periods:**
```
constant_yield  = beginning_basis × semi_annual_yield
ABP             = interest_per_period − constant_yield
ending_basis    = beginning_basis − ABP
```

The sum of all ABP over the life equals bond_premium to within rounding (e.g., 233.864 vs 233.865 for the example below — essentially exact, unlike the flat-coupon approach which left a $0.26 residual).

### Example: CUSIP 91282CEJ6

> **Verification only. All inputs below were sourced from `TipsAuctionResults.csv` and the ref CPI CSV. Do not hardcode these values.**

0.125% 5-Year TIPS | Issued 4/29/2022 | Matures 4/15/2027 | Face $10,000  
Unadj price: 102.328775 | IR on issue: 1.00424 | Real yield: -0.340%  
Indexed par: $10,042.40 | Cost basis: $10,276.26 | Bond premium: $233.86

```
Payment      Box 3 Coupon   Box 12 ABP    Box 8 OID
             (1099-INT)     (1099-INT)    (1099-OID)
-----------  -------------  ------------  ------------
2022-10-15         6.55729      21.92950
   Annual          6.55729      21.92950    511.01626

2023-04-15         6.63966      23.70887
2023-10-15         6.78010      23.66857
   Annual         13.41976      47.37744    342.23245

2024-04-15         6.84682      23.62833
2024-10-15         6.96519      23.58816
   Annual         13.81201      47.21649    282.67724

2025-04-15         7.04652      23.54806
2025-10-15         7.16024      23.50803
   Annual         14.20676      47.05609    351.13109

2026-04-15           (n/a)      23.46807
2026-10-15           (n/a)      23.42817
   Annual            (n/a)      46.89623       (n/a)

2027-04-15           (n/a)      23.38834
   Annual            (n/a)      23.38834       (n/a)

Total ABP                      233.86409
Bond premium                   233.86490  diff=-0.00081
```

Box 3 and Box 8 show n/a for 2026–2027 because ref CPI data is not yet available. Box 12 ABP can be computed through maturity from auction data alone.

ABP figures per #Cruncher and FactualFran; use of `indexed_par × (coupon_rate / 2)` as the per-period coupon produces a near-perfect total match to the bond premium.

### Notes on Broker ABP Reporting

- Brokers may use straight-line rather than constant yield — both methods are permissible under §171, though constant yield is preferred.
- Straight-line produces similar but slightly different annual amounts (e.g., ~$46.98 vs $47.06 for 2025).
- The correct 2025 ABP at $10,000 face for this CUSIP is **$47.056** (~$47). A broker reporting $52 would be in error — $52 corresponds to ~$11,000 face.
- If Box 12 is blank but the supplemental shows a bond premium figure, the broker may have netted it against Box 3 instead — check whether Box 3 equals the gross or net coupon.
- Schwab (confirmed) reports ABP in 1099-OID Box 10, not 1099-INT Box 12. If Box 12 is blank and Box 3 is not netted, check 1099-OID Box 10.
- Schwab has been observed applying ABP to only a fraction of the held position in later years, producing materially understated Box 10 values. The error pattern resembles applying the ABP rate to roughly half the actual face. If Schwab's Box 10 drops significantly from year 2 to year 3 without a corresponding position change, recalculate independently. → [See Schwab ABP error case study](#broker-error-case-study-schwab--cusip-91282cdx6)

---

## Cost Basis Step-Up

All brokers step up TIPS cost basis annually by the OID reported on 1099-OID, so that OID already taxed as ordinary income is not taxed again as capital gain at disposition.

```
original_cost  = face × IR(settlement) × (unadj_price_at_purchase / 100)
cumulative_OID = face × (IR(today) − IR(settlement_date))
adjusted_basis = original_cost + cumulative_OID
```

The capital gain/loss shown on broker statements = market value − adjusted basis, reflecting only price appreciation above the inflation-adjusted basis. This is correct and not double-counting OID.

Small discrepancies (a few dollars on $100K face) between calculated and displayed basis are normal due to internal IR precision differences.

---

## Vanguard Online Statement — TIPS Field Definitions

- **Price:** Unadjusted quoted price.
- **Current balance:** Inflation-adjusted market value. Formula: `face × (unadj_price/100) × IR`.
- **Remaining balance:** Inflation-adjusted principal. Formula: `face × IR`.
- **Inflation factor / Dec factor TIPS:** Index ratio. Formula: `refCPI(date) / refCPI(datedDate)`.
- **Accrued interest:** Accrued coupon since last payment. Formula: `face × IR × couponRate × days/180`.
- **Total cost (cost basis):** OID-adjusted basis. Formula: `original_cost + cumulative_OID`.
- **Cost per share:** Adjusted basis per $1 face. ≈ current IR.
- **Long-term capital gain:** Price appreciation only. Formula: `market_value − adjusted_basis`.

---

## Broker Error Case Studies

### Broker Error Case Study: Schwab — CUSIP 91282CDX6

> **Verification only. All inputs sourced from `TipsAuctionResults.csv`. Do not hardcode these values.**

**Summary:** Schwab reported correct ABP for 2022–2023, then silently dropped to roughly 55% of the correct value in 2024 and 2025, consistent with applying the ABP rate to a partial lot. The holder independently calculated correct values and is seeking corrected 1099-OIDs. Schwab had previously self-corrected a 2022 error (original Box 10 = $0; corrected to $282.24 in Nov 2023).

**Position details:**  
0.125% 10-Year TIPS | Dated 2022-01-15 | Issued 2022-01-31 | Matures 2032-01-15  
Face: $88,000 | Real yield: −0.540% | Unadj price: 106.811231 | IR on issue: 1.00253  
Indexed par: $88,222.64 | Adj cost: $94,231.69 | Bond premium: $6,009.05

**ABP comparison (1099-OID Box 10):**

```
Year   Correct (calc)   Schwab reported   Schwab error
2022       282.20           282.24          ~+0.04 (immaterial; self-corrected from $0)
2023       616.77           616.77          none
2024       613.45           339.11          −274.34 (understated ~45%)
2025       610.14           350.19          −259.95 (understated ~43%)
```

Correct values confirmed independently by holder (Klewles) and verified against `TipsAuctionResults.csv` using the constant yield method per §171 and Reg. §1.1275-7(d).

**Calculation inputs used:**
```
semi_annual_yield   = −0.540% / 2 = −0.270%
coupon_per_period   = $88,222.64 × (0.125% / 2) = $55.139
stub period         = 2022-01-31 issue → 2022-07-15 first coupon (165 days of 181-day period)
```

**Annual ABP schedule (constant yield, full term):**

```
Year    ABP
2022    282.20
2023    616.77
2024    613.45
2025    610.14
2026    606.85
2027    603.57
2028    600.32
2029    597.08
2030    593.86
2031    590.66
2032    294.13
Total  6009.04   (bond premium 6009.05 — diff $0.01, rounding)
```

**Reporting configuration confirmed:** Schwab reported QSI in 1099-INT Box 3 and ABP in 1099-OID Box 10 (no Box 2 entry). This confirms the hybrid configuration documented in the broker table above.

**Remediation:** Request corrected 1099-OID from Schwab for each affected year. If Schwab does not correct, the taxpayer may use the independently calculated figure and attach a statement. Source: Bogleheads forum, post by Klewles, thread "Taxation of Treasury bills, notes and bonds."

---

## Agent Instructions

> This section is for automated use only. Human readers can skip it.

**Examples caveat:** All examples in this document are for illustrative and verification purposes only. Never use hardcoded example values as algorithmic inputs. Always source inputs from `TipsAuctionResults.csv` and the ref CPI CSV as specified below.

### Dependencies

**Requires:** 2_1_TIPS_Basics.md (ref CPI formula, index ratio, adjusted principal), TaxationOfTreasuries_Foundation.md (shared tax principles), TaxationOfTreasuryNotesAndBonds.md (TIPS scenario coverage)

**Adds:** Regulatory basis for 1099 reporting, qualified stated interest definition, OID calculation detail, amortized bond premium (ABP) calculation, broker 1099 reporting differences, cost basis step-up, online statement field interpretation, verification workflow.

### Data Sources — Always Fetch, Never Guess

- **Daily ref CPI values:** `https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/RefCpiNsaSa.csv`
- **Dated-date ref CPI, issue-date IR, unadj price, accrued int per 1000:** `TipsAuctionResults.csv` (project file)

Ref CPI values are rounded to 5 decimal places in the CSV — use them as-is. Never use index ratios from TreasuryDirect XML/PDF for broker OID verification (TD rounds IR to 5 decimal places and uses 12/31 not 1/1 as year-end).

### Verification Workflow

1. Identify CUSIP → look up in `TipsAuctionResults.csv`: dated date, `ref_cpi_on_dated_date`, issue date, `unadj_price`, `adj_accrued_int_per1000`, real yield.
2. Fetch ref CPI CSV for all daily values needed.
3. Calculate Box 3 (QSI), Box 8 (OID), and Box 12 (ABP) from formulas above.
4. **If Box 8 doesn't match:** work backwards — `implied_refCPI_end = (OID × refCPI_datedDate / face) + refCPI_start` — then look up that value in the CSV to identify the correct end date. Do not guess dates.
5. **If Box 3 doesn't match:** confirm face value. Box 3 = face × (coupon/2) × IR(payment date). An apparent mismatch often reveals the correct face value.
6. **If Box 12 doesn't match:** check whether broker used straight-line vs constant yield, and whether the starting premium was computed correctly (must use indexed par, not flat par).
7. Never assume broker is wrong before verifying your own inputs.

### Project File Access Rule

For any content in project files including PDFs: **use `project_knowledge_search` first.** It reads PDFs and all project files. Do not attempt bash-based PDF extraction.

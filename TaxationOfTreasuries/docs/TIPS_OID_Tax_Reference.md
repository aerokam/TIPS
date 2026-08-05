# TIPS OID and Tax Reference

## Table of Contents

1. [About This Document](#about-this-document)
2. [Regulatory Basis](#regulatory-basis)
   - [Qualified Stated Interest — Treas. Reg. §1.1275-7(d)](#qualified-stated-interest-treas-reg-11275-7d)
   - [Market Discount and Premium for Subsequent Holders — Treas. Reg. §1.1275-7(f)(3)](#market-discount-and-premium-for-subsequent-holders-treas-reg-11275-7f3)
   - [Form 1099 Reporting Authority](#form-1099-reporting-authority)
3. [The Four Taxable Items for TIPS Held in Taxable Accounts](#the-four-taxable-items-for-tips-held-in-taxable-accounts)
4. [Purchase Cost Formula](#purchase-cost-formula)
5. [Box 3: Qualified Stated Interest (Coupon)](#box-3-qualified-stated-interest-coupon)
6. [Box 8: OID (Annual Inflation Accrual)](#box-8-oid-annual-inflation-accrual)
   - [Vanguard — Monthly Breakdown](#vanguard-monthly-breakdown)
   - [Broker Comparison](#broker-comparison)
7. [Box 12: Amortized Bond Premium (ABP)](#box-12-amortized-bond-premium-abp)
   - [Bond Premium Calculation](#bond-premium-calculation)
   - [Amortization Method: Constant Yield (Semi-Annual Periods)](#amortization-method-constant-yield-semi-annual-periods)
   - [Example: CUSIP 91282CEJ6](#example-cusip-91282cej6)
   - [Notes on Broker ABP Reporting](#notes-on-broker-abp-reporting)
8. [Cost Basis Step-Up](#cost-basis-step-up)
9. [Vanguard Online Statement — TIPS Field Definitions](#vanguard-online-statement-tips-field-definitions)
10. [Broker Error Case Studies](#broker-error-case-studies)
    - [Schwab — CUSIP 91282CDX6](#broker-error-case-study-schwab-cusip-91282cdx6)
11. [Agent Instructions](#agent-instructions)
    - [Dependencies](#dependencies)

---

## About This Document

See [TaxationOfTreasuries_Foundation.md](TaxationOfTreasuries_Foundation.md) for principles that apply across all Treasury types: federal taxability, state and local exemption, composite 1099 structure, general tax software notes, and caveats.

This document covers TIPS-specific OID calculation, ABP mechanics, broker reporting configurations, and cost basis. For how individual tax items (coupon interest, accrued interest, market discount, amortized bond premium) apply to TIPS specifically depending on acquisition and disposition method, see [TaxationOfTreasuryNotesAndBonds.md](TaxationOfTreasuryNotesAndBonds.md).

---

## Regulatory Basis

### Qualified Stated Interest — Treas. Reg. §1.1275-7(d)

For TIPS subject to the coupon bond method, the regulation defines qualified stated interest as follows:

> "All stated interest on the debt instrument is qualified stated interest. For purposes of this paragraph (d), stated interest is qualified stated interest if the interest is unconditionally payable in cash, or is constructively received under section 451, at least annually at a single fixed rate. **Stated interest is payable at a single fixed rate if the amount of each interest payment is determined by multiplying the inflation adjusted principal amount for the payment date by the single fixed rate.**"

This means each TIPS coupon payment = face × IR(payment date) × (coupon rate / 2), where IR is the index ratio on the payment date. The actual cash coupon paid embeds the inflation adjustment because it is applied to inflation-adjusted principal. This is what is reported in **1099-INT Box 3**.

### Market Discount and Premium for Subsequent Holders — Treas. Reg. §1.1275-7(f)(3)

For a TIPS acquired after original issuance (reopening or secondary market), this is the paragraph that governs both market discount and bond premium. Full text of 26 CFR §1.1275-7(f)(3), *Subsequent holders*:

> "A holder determines the amount of acquisition premium or market discount on an inflation-indexed debt instrument by reference to the adjusted issue price of the instrument on the date the holder acquires the instrument. A holder determines the amount of bond premium on an inflation-indexed debt instrument by assuming that the amount payable at maturity on the instrument is equal to the instrument's inflation-adjusted principal amount for the day the holder acquires the instrument. Any premium or market discount is taken into account over the remaining term of the debt instrument as if there were no further inflation or deflation. See section 171 for additional rules relating to the amortization of bond premium and sections 1276 through 1278 for additional rules relating to market discount."

The regulation uses two different reference terms — "adjusted issue price" for market discount/acquisition premium, and "inflation-adjusted principal amount" for bond premium. IRS Publication 1212 defines adjusted issue price generally (not TIPS-specific) as "the sum of the issue price and all the OID includible in income before that accrual period." For a TIPS that has not previously carried premium or discount, the OID includible in income under the coupon bond method is defined in paragraph (d)(4) of this same regulation as the increase in inflation-adjusted principal — so for the ordinary case (a TIPS bought after original issuance at its first change of hands), adjusted issue price and inflation-adjusted principal amount are the same figure: what this document computes as `inflation_adjusted_principal`. That is why the [Purchase Cost Formula](#purchase-cost-formula) below uses `inflation_adjusted_principal` as the reference point for both `bond_premium` and `market_discount`.

Once the discount (or premium) amount is fixed by that acquisition-date comparison, the regulation requires it be "taken into account over the remaining term ... as if there were no further inflation or deflation" — i.e., accrued on a non-inflation-adjusted schedule from that point forward, per the ordinary market discount rules of IRC §§1276–1278. This accrual is separate from, and in addition to, the annual OID inflation adjustment reported in Box 8.

Publication 1212 itself does not provide separate worked guidance for market discount on inflation-indexed instruments — its "Market discount" definition and Form 1099-OID Box 5 instructions are the general (non-inflation-indexed) rules, and the publication explicitly defers TIPS-specific treatment to this regulation: "For more information concerning premium or market discount on an inflation-indexed debt instrument, see [Regulations section 1.1275-7](https://www.law.cornell.edu/cfr/text/26/1.1275-7)." This document quotes the two paragraphs of that regulation relevant to TIPS taxation: qualified stated interest, paragraph (d), [above](#qualified-stated-interest-treas-reg-11275-7d), and market discount and premium, paragraph (f)(3), quoted just above in this subsection. The regulation's other paragraphs — definitions, the discount bond method, deflation adjustments, and TIPS reopening and premium-at-issuance rules — are not reproduced here.

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

Schwab uses a hybrid configuration: QSI in 1099-INT Box 3 (not Box 2), ABP in 1099-OID Box 10. This does not match either standard configuration defined in the IRS instructions — the IRS rule pairs Box 2 with Box 10, but Schwab reports QSI on 1099-INT while placing ABP on 1099-OID. The practical effect is correct (ABP reduces interest income), but the split across forms is non-standard. Confirmed via Bogleheads forum (CUSIP 91282CDX6, $88,000 face). → [See Schwab ABP error case study](#broker-error-case-study-schwab-cusip-91282cdx6)

---

## The Four Taxable Items for TIPS Held in Taxable Accounts

| Box | Content | Formula / Effect | State-Exempt |
|---|---|---|---|
| 1099-INT Box 3 | Semi-annual coupon (QSI) | `face × IR(payment date) × coupon/2` | Yes |
| 1099-INT Box 12 | Amortized bond premium (ABP) — common config | Reduces Box 3 | — |
| 1099-OID Box 2 | Semi-annual coupon (QSI) — alternative config | Same formula as Box 3 | Yes |
| 1099-OID Box 8 | Annual inflation accrual (OID) | `face × (IR_end − IR_start)` | Yes |
| 1099-OID Box 10 | Amortized bond premium (ABP) — alternative/Schwab config | Reduces Box 2 or Box 3 | — |
| 1099-B Box 1f | Accrued market discount (AMD) at disposal — default | `inflation_adjusted_principal(acquisition) − adj_cost`, accrued to date of disposal | Unsettled by state (see [TaxationOfTreasuryNotesAndBonds.md](TaxationOfTreasuryNotesAndBonds.md#caveats)) |
| 1099-OID Box 5 | AMD — only if §1278(b) annual-inclusion election made and broker notified | Same discount amount, accrued and reported annually instead of at disposal | Unsettled by state |

Box 12 (or Box 10 if your broker uses the alternative or Schwab configuration) applies only if the TIPS was purchased at a premium (adjusted cost > inflation-adjusted principal). It reduces the taxable interest on Schedule B.

Box 1f (or Box 5, under the annual-inclusion election) applies only if the TIPS was purchased at a discount (adjusted cost < inflation-adjusted principal) and that discount exceeds the de minimis threshold. Market discount and ABP are both measured against **inflation-adjusted principal** — see [Market Discount and Premium for Subsequent Holders — Treas. Reg. §1.1275-7(f)(3)](#market-discount-and-premium-for-subsequent-holders-treas-reg-11275-7f3) above for the regulation's exact text and how `inflation_adjusted_principal` maps to it. The discount amount itself is fixed at acquisition and accrues on a non-inflation-adjusted basis from there — it does not track subsequent CPI changes the way Box 8 OID does. See [TaxationOfTreasuryNotesAndBonds.md](TaxationOfTreasuryNotesAndBonds.md#market-discount-and-accrued-market-discount-amd) for how AMD is reported and taxed depending on acquisition and disposition method, and for the annual-inclusion election mechanics.

---

## Purchase Cost Formula

For auction purchases (original or reopening), all inputs from `TipsAuctionResults.csv`:

```
inflation_adjusted_principal = face × IR(issue_date)
adj_cost     = inflation_adjusted_principal × (unadj_price / 100)
accrued_int  = face × (adj_accrued_int_per1000 / 1000)
total_paid   = adj_cost + accrued_int
bond_premium = adj_cost − inflation_adjusted_principal      (if positive; zero if purchased at discount)
market_discount = inflation_adjusted_principal − adj_cost   (if positive; zero if purchased at premium)
```

`market_discount` is the amount subject to the de minimis test and, if it exceeds that threshold, to AMD treatment — see [The Four Taxable Items](#the-four-taxable-items-for-tips-held-in-taxable-accounts) above.

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

Applies only when TIPS is purchased at a premium (adjusted cost > inflation-adjusted principal on issue date). The bond premium is amortized over the life of the bond and reported annually in 1099-INT Box 12 (or 1099-OID Box 10 for Schwab) as a reduction of interest income.

### Bond Premium Calculation

```
inflation_adjusted_principal = face × IR(issue_date)
adj_cost     = inflation_adjusted_principal × (unadj_price / 100)
bond_premium = adj_cost − inflation_adjusted_principal
```

### Amortization Method: Constant Yield (Semi-Annual Periods)

The correct method per §171 uses the constant yield method with semi-annual accrual periods coinciding with coupon payment dates (confirmed by FactualFran and #Cruncher). Day count convention: Actual/Actual (US Treasury standard).

Key inputs:
```
interest_per_period = inflation_adjusted_principal × (coupon_rate / 2)   ← NOT face
semi_annual_yield   = real_yield_to_maturity / 2
```

Note: the coupon used in the ABP formula is `inflation_adjusted_principal × (coupon_rate / 2)`, not `face × (coupon_rate / 2)`. This reflects the actual QSI payment on inflation-adjusted principal per Reg. §1.1275-7(d), and produces a near-perfect amortization match to the original premium.

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
Inflation-adjusted principal: $10,042.40 | Cost basis: $10,276.26 | Bond premium: $233.86

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

ABP figures per #Cruncher and FactualFran; use of `inflation_adjusted_principal × (coupon_rate / 2)` as the per-period coupon produces a near-perfect total match to the bond premium.

### Notes on Broker ABP Reporting

- Brokers may use straight-line rather than constant yield — both methods are permissible under §171, though constant yield is preferred.
- Straight-line produces similar but slightly different annual amounts (e.g., ~$46.98 vs $47.06 for 2025).
- The correct 2025 ABP at $10,000 face for this CUSIP is **$47.056** (~$47). A broker reporting $52 would be in error — $52 corresponds to ~$11,000 face.
- If Box 12 is blank but the supplemental shows a bond premium figure, the broker may have netted it against Box 3 instead — check whether Box 3 equals the gross or net coupon.
- Schwab (confirmed) reports ABP in 1099-OID Box 10, not 1099-INT Box 12. If Box 12 is blank and Box 3 is not netted, check 1099-OID Box 10.
- Schwab has been observed applying ABP to only a fraction of the held position in later years, producing materially understated Box 10 values. The error pattern resembles applying the ABP rate to roughly half the actual face. If Schwab's Box 10 drops significantly from year 2 to year 3 without a corresponding position change, recalculate independently. → [See Schwab ABP error case study](#broker-error-case-study-schwab-cusip-91282cdx6)

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
Inflation-adjusted principal: $88,222.64 | Adj cost: $94,231.69 | Bond premium: $6,009.05

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

**Adds:** Regulatory basis for 1099 reporting, qualified stated interest definition, OID calculation detail, amortized bond premium (ABP) calculation, market discount (AMD) basis for TIPS, broker 1099 reporting differences, cost basis step-up, online statement field interpretation, verification workflow.

### Data Sources — Always Fetch, Never Guess

- **Daily ref CPI values:** `https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/RefCpiNsaSa.csv`
- **Dated-date ref CPI, issue-date IR, unadj price, accrued int per 1000:** `TipsAuctionResults.csv` (project file)

Ref CPI values are rounded to 5 decimal places in the CSV — use them as-is. Never use index ratios from TreasuryDirect XML/PDF for broker OID verification (TD rounds IR to 5 decimal places and uses 12/31 not 1/1 as year-end).

### Verification Workflow

1. Identify CUSIP → look up in `TipsAuctionResults.csv`: dated date, `ref_cpi_on_dated_date`, issue date, `unadj_price`, `adj_accrued_int_per1000`, real yield.
2. Fetch ref CPI CSV for all daily values needed.
3. Calculate Box 3 (QSI), Box 8 (OID), and Box 12 (ABP) from formulas above.
4. **If Box 8 doesn't match:** work backwards — `implied_refCPI_end = (OID × refCPI_datedDate / face) + refCPI_start` — then look up that value in the CSV to identify the correct end date. Do not guess dates.
5. **If Box 3 doesn't match:** confirm par amount held. Box 3 = face × (coupon/2) × IR(payment date). An apparent mismatch often reveals the correct par amount.
6. **If Box 12 doesn't match:** check whether broker used straight-line vs constant yield, and whether the starting premium was computed correctly (must use inflation-adjusted principal, not par).
7. Never assume broker is wrong before verifying your own inputs.

### Project File Access Rule

For any content in project files including PDFs: **use `project_knowledge_search` first.** It reads PDFs and all project files. Do not attempt bash-based PDF extraction.

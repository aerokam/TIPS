# Treasury Investors Portal Data Dictionary (DD)

**Scope:** Global — Covers all apps and pipelines in the Treasuries repo.
**Authority:** This document is the primary source of truth for all data definitions. It supersedes all other documentation for variable meanings and data structures.

---

## 0.0 DD Notation

| Symbol | Meaning |
|---|---|
| `=` | is composed of / is defined as |
| `+` | AND |
| `[ x \| y ]` | Selection (either x or y) |
| `{ x }` | Iteration (zero or more of x) |
| `( x )` | Optional (x may or may not be present) |
| `* x *` | Comment / Narrative definition |
| `@ x` | Identifier (Key field) |

---

<a id="1.0-external-entities-e"></a>
## 1.0 External Entities (E)
*External sources providing data to the system.*

- <a id="e1"></a>**E1: FedInvest** = *US Treasury price source for bills, notes, bonds, TIPS (no STRIPS)*
- <a id="e2"></a>**E2: TreasuryDirect SecIndex** = *Source for daily interpolated RefCPI values*
- <a id="e3"></a>**E3: FiscalData API** = *Source for auction results and TIPS metadata*
- <a id="e4"></a>**E4: BLS Public API** = *Source for monthly NSA and SA CPI-U time series*
- <a id="e5"></a>**E5: CNBC GraphQL** = *Source for market mid-price yields*
- <a id="e6"></a>**E6: Fidelity Fixed Income** = *Broker source for real-time ask/bid quotes including STRIPS*

---

<a id="2.0-data-stores-s"></a>
## 2.0 Data Stores (S)
*Internal R2 data files and their schemas.*

- <a id="s1"></a>**S1: Yields.csv** = `Settlement_Date + { @CUSIP + Type + Maturity + Coupon + DatedDateCPI + Price + Yield }`
- <a id="s2"></a>**S2: TipsRef.csv** = `{ @CUSIP + Maturity + DatedDate + Coupon + BaseCPI + Term }`
- <a id="s3"></a>**S3: RefCPI.csv** = `{ @Date + RefCPI }`
- <a id="s4"></a>**S4: RefCpiNsaSa.csv** = `{ @Date + CPI_NSA + CPI_SA + SA_Factor }`
- <a id="s5"></a>**S5: Auctions.csv** = `{ @CUSIP + @Auction_Date + Security_Type + ... + High_Yield + ... }`
- <a id="s6"></a>**S6: YieldHistory** = `{ @Symbol + { [ Timestamp + Yield_Value ] } }`
- <a id="s7"></a>**S7: FidelityQuotes** = `{ @CUSIP + Maturity + Coupon + Ask_Price + Bid_Price + Ask_Yield + Bid_Yield }`

---

<a id="3.0-data-elements-primitives"></a>
## 3.0 Data Elements (Primitives)

<a id="cusip"></a>
### CUSIP
`CUSIP` = *9-character unique identifier for a Treasury security*

<a id="quantity"></a>
### Quantity
`Quantity` = *Integer number of $1,000 face-value units held (e.g., 50 = $50,000 face value)*

<a id="face-value"></a>
### Face Value
`Face_Value` = `Quantity × 1000` *(original, unadjusted principal — the baseline unit of account)*

<a id="par-value"></a>
<a id="par-value-nominal"></a>
### Par Value (Nominal)
`Par_Value_Nominal` = *Current principal value of a nominal Treasury. Equals Face Value at all times. For inflation-adjusted principal see [Par Value (Adjusted)](#par-value-adjusted).*

<a id="price"></a>
### Price
`Price` = *Market value expressed as percentage of par (e.g., 102.5 = 102.5% of par)*

<a id="clean-price"></a>
### Clean Price
`Clean_Price` = *Quoted market price excluding accrued interest and (for TIPS) before inflation adjustment. Canty (2009) formal notation: CP.*

<a id="settlement-date"></a>
### Settlement Date
`Settlement_Date` = *[ Trade_Date + 1 Business Day | Manual_Override ]*

<a id="maturity-date"></a>
### Maturity Date
`Maturity_Date` = *Date on which principal is repaid to the bondholder*

<a id="coupon-rate"></a>
### Coupon Rate
`Coupon_Rate` = *Fixed annual interest rate paid by the security, expressed as a decimal*

<a id="yield"></a>
### Yield
`Yield` = *Yield-to-Maturity (YTM): the discount rate equating present value of all future cash flows to the current price. Computed with Actual/Actual day count, semi-annual compounding (Excel YIELD convention). Near-maturity bonds (≤ 6 months to maturity) use simple annual discounting.*

<a id="tips"></a>
### TIPS
`TIPS` = *Treasury Inflation-Protected Securities: marketable U.S. Treasury securities whose principal is adjusted by changes in the Consumer Price Index (CPI-U NSA). Issued as notes (2–10y) or bonds (30y).*

<a id="treasury-bill"></a>
### Treasury Bill
`Treasury_Bill` = *U.S. Treasury security with original maturity ≤ 1 year. Issued at a discount; no coupon. Typical maturities: 4-Week, 8-Week, 13-Week, 17-Week, 26-Week, 52-Week.*

<a id="treasury-note"></a>
### Treasury Note
`Treasury_Note` = *U.S. Treasury security with original maturity of 2–10 years. Pays semi-annual coupons. Typical maturities: 2, 3, 5, 7, 10 Year.*

<a id="treasury-bond"></a>
### Treasury Bond
`Treasury_Bond` = *U.S. Treasury security with original maturity > 10 years. Pays semi-annual coupons. Typical maturities: 20, 30 Year.*

---

<a id="4.0-financial-composites-formulas"></a>
## 4.0 Financial Composites & Formulas

**TIPS Elements**

<a id="ref-cpi"></a>
### Ref CPI
`Ref_CPI` = *Daily interpolated Consumer Price Index (CPI-U NSA) value used for TIPS calculations. Authority: 31 CFR § 356 Appendix B.*
- **Dated:** `Ref_CPI_dated` — Reference CPI on the TIPS Dated Date (constant for the bond's lifetime)
- **Settle:** `Ref_CPI_settle` — Reference CPI on the Settlement Date

<a id="index-ratio"></a>
### Index Ratio
`Index_Ratio` = `Ref_CPI_settle / Ref_CPI_dated`

<a id="par-value-adjusted"></a>
### Par Value (Adjusted)
`Par_Value_Adjusted` = `Face_Value × Index_Ratio` *(inflation-adjusted principal, also called Adjusted Principal)*

<a id="annual-interest-real"></a>
### Annual Interest (Real)
`Annual_Interest_Real` = `Face_Value × Coupon_Rate` *(coupon applied to fixed face value — constant in real terms)*

<a id="annual-interest-nominal"></a>
### Annual Interest (Nominal)
`Annual_Interest_Nominal` = `Par_Value_Adjusted × Coupon_Rate` *(coupon applied to inflation-adjusted principal)*

<a id="pi-per-tips"></a>
### P+I per TIPS
`P+I_per_TIPS` = `Par_Value_Adjusted + (Annual_Interest_Nominal × [0.5 | 1.0])` *Total inflation-adjusted cash flow in the maturity year. See TIPS_Basics.md for half-year rule.*

<a id="cost-per-tips"></a>
### Cost per TIPS
`Cost_per_TIPS` = `(Price / 100) × Index_Ratio × 1000` *(nominal cost to purchase one $1,000 face-value unit)*

---

**Ladder & Portfolio Elements**

<a id="funded-year"></a>
### Funded Year
`Funded_Year` = *Calendar year (rung) in the ladder for which total cash flow is calculated*

<a id="ladder-period"></a>
### Ladder Period
`Ladder_Period` = `First_Year + ... + Last_Year`

<a id="daa"></a>
### DAA
`DAA` = *Desired Annual Amount: target total cash flow for a funded year in nominal terms (generic bond ladders)*

<a id="aa"></a>
### AA
`AA` = *Annual Amount: actual cash flow produced for a funded year in nominal terms. May differ from DAA due to rounding.*

<a id="dara"></a>
### DARA
`DARA` = *Desired Annual Real Amount: target total cash flow for a funded year in real (inflation-adjusted) terms (TIPS ladders)*

<a id="ara"></a>
### ARA
`ARA` = `P+I_per_TIPS + LMI` *(Actual Real Amount: total real cash flow produced for a Funded Year)*

<a id="lmi"></a>
### LMI
`LMI` = `Σ Annual_Interest_Real for TIPS maturing in years > Current_Year` *(Later Maturity Interest: interest contributions to the current funded year from bonds maturing in future years)*

<a id="gap-years"></a>
### Gap Years
`Gap_Years` = *Funded Years within the ladder period where no Treasury TIPS exist (currently 2037, 2038, 2039)*

<a id="synthetic-tips"></a>
### Synthetic TIPS
`Synthetic_TIPS` = *Theoretical TIPS constructed for Gap Years. Yield interpolated from surrounding real maturities; index ratio = 1.0; price = 100.*

<a id="bracket-year"></a>
### Bracket Year
`Bracket_Year` = *Existing TIPS maturity used to fund or bracket a Gap Year*

---

**Seasonal Adjustment (SA) Elements**

<a id="sa-factor"></a>
### SA Factor
`SA_Factor` = `CPI_NSA / CPI_SA` *(multiplicative factor derived from BLS CPI-U NSA vs SA series; normalizes for seasonal inflation patterns)*

<a id="sa-yield"></a>
### SA Yield
`SA_Yield` = *Real yield derived from a Seasonally Adjusted Clean Price. Removes predictable seasonal CPI inflation carry from the raw YTM.*

<a id="sao-yield"></a>
### SAO Yield
`SAO_Yield` = *SA Yield with additional Outlier adjustment. Produced by backwards-anchored linear regression blending of the SA curve; smooths idiosyncratic front-end "wiggles".*

<a id="sacp"></a>
### SACP
`SACP` = *Seasonally Adjusted Clean Price (Canty 2009, Eq. 14 approximation): `SACP ≈ CP × (S_settle / S_maturity)`. Strips predictable seasonal carry from the quoted clean price.*

<a id="facp"></a>
### FACP
`FACP` = *Fully Adjusted Clean Price (Canty 2009, Eq. 21): `FACP = CP × (S_settle / S_maturity) × (1 / O_maturity)`. Strips both seasonal carry and one-off outlier shocks. Provides the cleanest "trend" price for relative value analysis.*

<a id="sa-anchor"></a>
### SA Anchor
`SA_Anchor` = *Long-end region of the SAO curve where SAO = SA (bonds with maturity > 7 years, or the last 4 bonds in the series). Yields in this region are considered stable; no trend blending applied.*

<a id="sliding-window"></a>
### Sliding Window
`Sliding_Window` = *4-bond window of longer-maturity bonds used to compute a linear regression trend line in the SAO algorithm. Applied as the algorithm sweeps from the anchor region toward shorter maturities.*

<a id="blend-weights"></a>
### Blend Weights
`Blend_Weights` = *`trendWeight` values controlling how much of the SAO yield comes from the projected trend vs. the bond's actual SA yield. Vary by time-to-maturity: 90% trend (< 0.5y), 15% (0.5–2y), 25% (2–5y), 20% (> 5y non-anchor).*

<a id="iqr-clip"></a>
### IQR Clip
`IQR_Clip` = *Y-axis floor applied to the Treasuries chart tab to suppress near-maturity Notes with extreme negative YTM. Floor = Q1 − max(1.0 × IQR, 0.5%) computed from positive-yield Notes values only. Does not remove data points — only adjusts the visible axis scale. Upper bound unconstrained.*

---

## 5.0 Global Constants

`LOWEST_LOWER_BRACKET_YEAR` = 2026
`REFCPI_CUSIP` = "912828V98" *Reference CUSIP for CPI-U index tracking*
`SIFMA_HOLIDAYS` = *Calendar of bond market closures*

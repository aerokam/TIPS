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
*External sources providing data to the system. Click these in the Context Diagram to see their data structures.*

- <a id="e1"></a>**E1: FedInvest** = `CUSIP + Security_Type + Maturity_Date + Rate + Price`
  *US Treasury price source. Price represents the **midpoint of market bid and ask prices** (mid-market reference). Because it is a midpoint, it is consistently lower than commercial market Ask prices, resulting in calculated FedInvest yields that are slightly higher than broker Ask yields. This is particularly noticeable for short-dated Bills. Note: FedInvest does not specify a settlement date; our system infers T=0 (Price Date = Settlement Date) based on empirical yield matching. We calculate the Yield (YTM) based on this price.*
- <a id="e2"></a>**E2: TreasuryDirect SecIndex** = `CUSIP + Index_Date + Ref_CPI`
  *Authority for daily interpolated RefCPI. Provides values for every day of the month.*
- <a id="e3"></a>**E3: FiscalData API** = `CUSIP + Auction_Date + Security_Type + High_Yield + Bid_to_Cover + ...`
  *U.S. Treasury official auction results and immutable security metadata (Coupons, Dated Dates).*
- <a id="e4"></a>**E4: BLS Public API** = `Year + Month + Value + Seasonal_Adjustment_Flag`
  *Consumer Price Index (CPI-U) monthly data. Used to derive SA factors by comparing NSA vs. SA values.*
- <a id="e5"></a>**E5: CNBC GraphQL** = `Symbol + Timestamp + Price + Change + Yield`
  *Market mid-price feed for live monitoring. Symbols include US10Y, US30Y, etc.*
- <a id="e6"></a>**E6: Fidelity Fixed Income** = `CUSIP + Maturity + Coupon + Price_Bid + Price_Ask + Yield_Bid + Ask_Yield_to_Maturity + ( Inflation_Factor + Adjusted_Price_Bid + Adjusted_Price_Ask ) + Quantity`
  *Broker bid/ask quotes. Used for "Market Price" comparisons and bid/ask spread analysis. Two files: one for TIPS (includes inflation-adjustment columns), one for Nominals (includes quantity columns). Column names are as they appear in the exported CSV header row (used verbatim for parsing).*

---

<a id="2.0-data-stores-s"></a>
## 2.0 Data Stores (S)
*Internal R2 data files. Schemas are normalized from External Entities.*

- <a id="s1"></a>**S1: Yields.csv** = `Settlement_Date + { @CUSIP + Type + Maturity + Coupon + DatedDateCPI + Price + Yield }`
  *Primary R2 key for daily FedInvest prices and yields. Legacy alias: `YieldsDerivedFromFedInvestPrices.csv`.*
- <a id="s2"></a>**S2: TipsRef.csv** = `{ @CUSIP + Maturity + DatedDate + Coupon + BaseCPI + Term }`
- <a id="s3"></a>**S3: RefCPI.csv** = `{ @Date + Ref_CPI }`
- <a id="s4"></a>**S4: RefCpiNsaSa.csv** = `{ @Date + CPI_NSA + CPI_SA + SA_Factor }`
- <a id="s5"></a>**S5: Auctions.csv** = `{ @CUSIP + @Auction_Date + Security_Type + High_Yield + Bid_to_Cover + Primary_Dealer_Accepted + ... }`
- <a id="s6"></a>**S6: YieldHistory** = `{ @Symbol + { [ Timestamp + Yield_Value ] } }`
- <a id="s7a"></a>**S7a: FidelityTips.csv** — TIPS bid/ask quotes. Local drop path: `YieldCurves/data/FidelityTips.csv` (gitignored). R2 key: `Treasuries/FidelityTips.csv`.
  CSV columns (exact header names): `Cusip, State, Description, Coupon, Maturity Date, Moody's Rating, S&P Rating, Price Bid, Price Ask, Yield Bid, Ask Yield to Worst, Ask Yield to Maturity, Inflation Factor, Adjusted Price Bid, Adjusted Price Ask, Attributes`
  *Parser normalises headers to lowercase. Key fields used: `cusip`, `price ask` (ask clean real price), `price bid` (bid clean real price), `inflation factor`, `adjusted price bid`, `adjusted price ask`. Bid yield is computed from `price bid` via `yieldFromPrice` (not from `yield bid`) to ensure consistency with ask yield method. Price spread uses adjusted prices (actual dollar cost). Footer line `Date downloaded MM/DD/YYYY HH:MM AM/PM` supplies the download timestamp.*

- <a id="s7b"></a>**S7b: FidelityTreasuries.csv** — Nominal Treasury bid/ask quotes. Local drop path: `YieldCurves/data/FidelityTreasuries.csv` (gitignored). R2 key: `Treasuries/FidelityTreasuries.csv`.
  CSV columns (exact header names): `Cusip, State, Description, Coupon, Maturity Date, Moody's Rating, S&P Rating, Price Bid, Price Ask, Yield Bid, Ask Yield to Worst, Ask Yield to Maturity, Quantity Bid(min), Quantity Ask(min), Attributes`
  *Parser normalises headers to lowercase. Key fields used: `cusip`, `price ask`, `price bid`, `yield bid` (bid yield, percentage form — divide by 100), `ask yield to maturity` (ask yield, percentage form). Spread: `yield_spread_bps = (yield_bid − ask_ytm) × 10000`; `price_spread_pct = (price_ask − price_bid) / price_ask × 100`. Footer line `Date downloaded ...` supplies the download timestamp.*

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
`Settlement_Date` = *The date on which a bond trade is settled. Standard system logic: [ Trade_Date + 1 Bond Trading Day (T+1) | Manual_Override ]. T+1 excludes weekends and US bond market holidays (source: BondHolidaysSifma.csv). Exception: For FedInvest price ingestion, yield calculations use T=0 (Price Date = Settlement Date) to match FedInvest reported yields empirically. However, the default Ref CPI date is still set to T+1 bond trading day of the FedInvest price date, to match broker convention (where the Ref CPI used is that of the actual settlement date).*

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
`ARA` = `Funded_PI + LMI + Role_Playing_LMI` *(Actual Real Amount: total real cash flow produced for a Funded Year)*

<a id="lmi"></a>
### LMI
`LMI` = `Σ Annual_Interest_Real for TIPS maturing in years > Current_Year` *(Later Maturity Interest: interest contributions to the current funded year from bonds maturing in future years)*

<a id="role-playing-lmi"></a>
### Role Playing LMI
`Role_Playing_LMI` = `Σ Annual_Interest_Real for bracket excess bonds maturing in Current_Year`
*Interest from additional bonds held in the current year to cover future rungs (gaps or future years). In the sizing phase, these bonds 'role play' as the future rungs they replace, contributing their full annual coupon to the current year's ARA.*

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

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
- <a id="e6"></a>**E6: Fidelity Fixed Income** = `Product + CUSIP + Maturity + Coupon + Price_Bid + Price_Ask + Yield_Bid + Ask_Yield_to_Maturity + ( Inflation_Factor + Adjusted_Price_Bid + Adjusted_Price_Ask ) + Quantity`
  *Broker bid/ask quotes. Used for "Market Price" comparisons and bid/ask spread analysis. One combined export (Treasury + TIPS rows in a single CSV, distinguished by the `Product` column); TIPS rows carry the inflation-adjustment columns, Treasury rows carry the quantity columns. Column names are as they appear in the exported CSV header row (used verbatim for parsing).*
- <a id="e7"></a>**E7: Vanguard Advisors API** = `CUSIP + Holding_Name + Ticker + Category + ( Quantity | Face_Amount ) + Coupon_Rate + Percent_Of_Fund + Market_Value + Maturity_Date + ISIN + SEDOL + As_Of_Date`
  *Fund holdings for Vanguard Treasury/TIPS funds (e.g., VBIL, VTIP, VTP), scraped from the public `advisors.vanguard.com` product holdings endpoint. Not every fund publishes a "daily" snapshot — the scraper tries `holdings/daily` first and falls back to `holdings/latest`. Expense ratio and 30-Day SEC yield (not in the holdings endpoint) come from two sibling endpoints on the same host: `api/funds/<portId>/fees` (`adjustedExpenseRatio.value`) and `api/funds/<portId>/analytics/yields` (`secYield.percent`). Fetched daily by the `FundHoldings` Windows Task (`FundHoldings/updateAllHoldings.js`), same as the rest of the ingestion pipeline.*
- <a id="e8"></a>**E8: fminvest.com API** = `field_symbol (CUSIP) + field_name (Holding_Name) + field_par_value (Quantity) + field_weightings (Percent_Of_Fund) + field_market_value + field_as_of_date`
  *Fund holdings for ETFs not covered by Vanguard's own API (currently RBIL only). Keyed by an internal numeric ETF id with no public ticker lookup, so the id is hardcoded per fund in `FundHoldings/fminvest/updateFminvestHoldings.js`. Coupon and maturity are parsed out of the trailing `"<coupon>% MM/DD/YYYY"` suffix on `field_name` — cash/sweep rows have no such suffix and are naturally excluded downstream. fminvest.com is F/m Investments' own site (the fund issuer), not a third-party aggregator; its separate product page (`fminvest.com/etfs/<slug>`) is scraped for expense ratio and 30-Day SEC yield, rendered directly into the page (no API call). Fetched daily by the `FundHoldings` Windows Task, same as E7.*
- <a id="e9"></a>**E9: PIMCO fund-detail API** = `CUSIP + Description (Holding_Name) + Coupon_Rate + Percent_Of_Net_Assets + Market_Value + Notional/Par_Value_Quantity/Units + Maturity_Date + AsOfDate`
  *Fund holdings for PIMCO funds (currently LTPZ only), fetched as an xlsx export from `fund-ui.pimco.com/fund-detail-api/api/funds/<CUSIP>/topTenHoldings/export?asOfDate=9999-12-31` (despite the endpoint name, the far-future `asOfDate` returns full holdings, not just the top ten). Keyed by the fund's own CUSIP with no public ticker lookup, so it is hardcoded per fund in `FundHoldings/pimco/updateLtpzHoldings.js`. `Coupon_Rate` is rounded to 2 decimals by PIMCO (lossy for TIPS's eighth-of-a-percent coupons, e.g. 1.375% → "1.38"); the scraper instead parses the precise coupon from the trailing number in `Description` (e.g. "TSY INFL IX N/B 02/44 1.375"), falling back to `Coupon_Rate` only when `Description` has no parseable suffix (cash/sweep/currency lines). Expense ratio comes from `key-information` → `netExpenseRatio` (percent-scale already, not date-sensitive so fetched at "latest"). 30-Day SEC yield comes from `fund-stats` → `unsubsidized30SecYield` × 100 (a true fraction, unlike every other PIMCO field used here — confirmed by grepping the product page's own Angular bundle for the label's data binding, present at two separate places on the page, both bound to this exact field). `key-statistics`' similarly-named `subsidizedSecYield` is a different, month-end (not live-daily) figure and is *not* what the page displays under "30-Day SEC Yield" — do not use it. The `asOfDate=9999-12-31` "latest" trick (used for every other endpoint on this API, including the holdings export) does *not* apply to `unsubsidized30SecYield`: PIMCO's backend already has a business day's worth of that figure the product page hasn't published yet (confirmed by direct testing — the page kept showing a stale value even after a hard refresh, i.e. a genuine backend lag on this specific regulatory figure, not caching). SEC yield must be for the same date as the holdings themselves (the as-of date already shown in the app's banner) — rather than guessing a fixed day-offset, the scraper fetches `fund-stats` at that exact `asOfDate` (converted from the holdings export's own `AsOfDate:` line). Fetched daily by the `FundHoldings` Windows Task, same as E7/E8.*
- <a id="e10"></a>**E10: Schwab Asset Management holdings export** = `As-Of-Date + Symbol + Quantity + Percent_of_Assets + Name + BBG_FIGI + Coupon_Rate + Maturity_Date`
  *Fund holdings for Schwab funds (currently SCHP only): a date-stamped CSV linked from `schwabassetmanagement.com/products/<ticker>` (filename e.g. `SCHP_FundHoldings_2026-07-31.CSV`, discovered by scraping the link each run since the date changes). Schwab's site 403s plain HTTP requests (Akamai bot protection, confirmed by direct testing); `FundHoldings/schwab/updateSchpHoldings.js` uses Puppeteer (headless Chrome) to load the product page and fetch the CSV from within that page's session. Unlike E7-E9, this export carries no CUSIP (identifies securities by Bloomberg FIGI instead) and no dollar Market Value (only `Quantity` + a precise `Percent_of_Assets`). The scraper resolves both by matching each holding's `(Maturity_Date, Coupon_Rate)` — a unique key for TIPS — against [S7](#s7) (FidelityTreasuriesTips.csv, which is CUSIP-keyed and carries price): `Quantity` is confirmed (by cross-checking against the fund's own abbreviated Market Value display) to already be inflation-adjusted current face value, not original par, so `Market Value = Quantity × (S7 Adjusted_ask_price / S7 Inflation_factor) / 100` (the *raw*, not inflation-adjusted, price — using the adjusted price would double-count the inflation factor already baked into `Quantity`). The fund's cash-sweep line ("SSC GOVERNMENT MM GVMXX") reports a Bloomberg FIGI with no CUSIP and isn't in S7 (not a Treasury/TIPS security); its CUSIP (7839989D1) is hardcoded from E9, which sweeps the same State Street fund and reports it directly. Expense ratio and SEC Yield (30 Day) are rendered directly into the already-loaded product page's key-stats table (no separate request) — the page also repeats expense ratio in a simpler summary-band span earlier in the page, but the scraper anchors on the detailed table row specifically. Fetched daily by the `FundHoldings` Windows Task, same as E7-E9.*
- <a id="e11"></a>**E11: BondBloxx product-page holdings table** = `Name + CUSIP + Market_Value + Percent_of_Net_Assets`
  *Fund holdings for BondBloxx funds (currently XHLF only): unlike E7-E10, BondBloxx exposes no JSON/CSV API — the product page at `bondbloxxetf.com/<fund-slug>/` server-renders the full "All Holdings" table as static HTML (the page's own "Download CSV" button just re-serializes this same table client-side via JS), so `FundHoldings/bondbloxx/updateXhlfHoldings.js` fetches the page and parses the table directly (`<table border="1">`, the only one on the page with that exact attribute). Fund slug is hardcoded per ticker with no public ticker lookup. The table carries no Quantity, Coupon, or Maturity Date column: XHLF holds only zero-coupon T-Bills, whose `Name` reads `"US T BILL ZCP MM/DD/YY"` — Coupon (0) and Maturity Date are parsed from that suffix (analogous to E8's name-suffix parsing); the CASHUSD and NET OTHER ASSETS balancing rows don't match the suffix pattern and are left with a blank Coupon/Maturity Date, naturally excluded downstream (no CUSIP match in the yield files). Expense ratio and 30-Day Sec Yield are rendered directly into the same already-fetched product page (no separate request). Fetched daily by the `FundHoldings` Windows Task, same as E7-E10.*
- <a id="e12"></a>**E12: BlackRock iShares fund-document API** = `Name + Sector + Asset_Class + Market_Value + Weight_(%) + Notional_Value + Par_Value + CUSIP + ISIN + SEDOL + Price + Duration + YTM_(%) + Maturity + Coupon_(%) + Mod._Duration + Real_Duration + Real_YTM_(%)`
  *Fund holdings for iShares funds (currently ICPI only), fetched as a plain CSV from `blackrock.com/varnish-api/blk-one01-product-data/product-data/api/v1/get-fund-document?...&portfolioId=<id>&component=holdings`, a preamble (fund name, as-of date, inception date) above the actual holdings table rather than a plain header-first CSV. Keyed by the fund's numeric `portfolioId` (visible in the product page URL) with no public ticker lookup, so it is hardcoded per fund in `FundHoldings/ishares/updateIcpiHoldings.js`. The endpoint accepts an `asOfDate` param but does not require it — a stale/mismatched date returns an empty body, while omitting it entirely returns the latest holdings (confirmed by direct testing), avoiding the chicken-and-egg problem of needing to know the fund's current as-of date before requesting it. Unlike E7-E11, the source itself reports `Duration`/`YTM`/`Real Duration`/`Real YTM`, but per the project's single-source-of-truth directive these are discarded, not ingested — `FundHoldings/enrichHoldings.js` computes Ask/SA/SAO Yield and Duration the same way for every fund, from [S10](#s10)/[S7](#s7) by CUSIP, so a fund's figures are always comparable to every other fund's rather than mixing each provider's own (possibly differently-defined) analytics. Expense ratio and 30-Day SEC yield, however, are provider-reported figures with no cross-fund computation to replace them with — these come from a separate product-page fetch (not the holdings CSV), parsed out of the page's own schema.org JSON-LD block (`@graph` node ending `#key-datapoints`, `additionalProperty` entries named `"Expense Ratio:"` and `"30 Day SEC Yield as of"`) rather than HTML-scraping, since BlackRock renders it as clean structured data. Fetched daily by the `FundHoldings` Windows Task, same as E7-E11.*

---

<a id="2.0-data-stores-s"></a>
## 2.0 Data Stores (S)
*Internal R2 data files. Schemas are normalized from External Entities.*

- <a id="s1"></a>**S1: YieldsFromFedInvestPrices.csv** = `Settlement_Date + { @CUSIP + Type + Maturity + Coupon + DatedDateCPI + Price + Yield }`
  *Primary R2 key for daily FedInvest prices and yields. Legacy alias: `YieldsDerivedFromFedInvestPrices.csv`, `Yields.csv`.*
- <a id="s2"></a>**S2: TipsRef.csv** = `{ @CUSIP + Maturity + DatedDate + Coupon + DatedDateRefCpi + Term }`
- <a id="s3"></a>**S3: RefCPI.csv** = `{ @Date + Ref_CPI }` *— authoritative retrieved NSA Ref CPI (TreasuryDirect). Consumed by all apps.*
- <a id="s4"></a>**S4: RefCpiNsaSa.csv** = `{ @Date + CPI_NSA + CPI_SA + SA_Factor }` *— calculated (App. B daily interpolation), built for the SA pipeline: `CPI_NSA` and `CPI_SA` interpolated daily so `SA_Factor = CPI_NSA / CPI_SA`. The daily SA series has no official or retrieved equivalent — this is its **sole source**.*
- <a id="s5"></a>**S5: Auctions.csv** = `{ @CUSIP + @Auction_Date + Security_Type + High_Yield + Bid_to_Cover + Primary_Dealer_Accepted + ... }`
- <a id="s6"></a>**S6: YieldHistory** = `{ @Symbol + { [ Timestamp + Yield_Value ] } }`
- <a id="s8"></a>**S8: CPI_history.csv** = `{ @Year + @Period + PeriodName + NSA + SA }`
  *Full monthly BLS CPI-U history from January 1913 to present. NSA = `CUUR0000SA0`; SA = `CUSR0000SA0`. SA blank before 1947. R2 key: `bls/CPI_history.csv`.*
- <a id="s9"></a>**S9: Tentative-Auction-Schedule.xml** = XML `{ AuctionCalendarDate: [ AuctionDate + SecurityTermWeekYear + SecurityType + ReOpeningIndicator + TIPS + FloatingRate + AnnouncementDate + SettlementDate ] }`
  *Mirror of the Treasury's Tentative Auction Schedule. Fetched directly by TreasuryAuctions to flag TIPS in the upcoming-auctions feed (matched by `AuctionDate` + `SecurityTermWeekYear`), since that feed lacks a native TIPS flag. R2 key: `TIPS/Tentative-Auction-Schedule.xml`.*
- <a id="s10"></a>**S10: YieldsSaSao.csv** = `{ @cusip + maturity + coupon + ask_yield + sa_yield + sao_yield }`
  *TIPS ask/SA/SAO yields derived from Fidelity quotes, produced by `YieldCurves/scripts/updateSaSaoYields.js` (triggered by the `FidelityQuotes` task). Consumed by FundHoldings to enrich TIPS fund holdings with seasonally-adjusted yield. R2 key: `TIPS/YieldsSaSao.csv`.*
- <a id="s11"></a>**S11: FundHoldings/Holdings-\<TICKER\>(-Enriched).csv** — Vanguard/fminvest/PIMCO/Schwab/BondBloxx/iShares fund holdings (E7/E8/E9/E10/E11/E12), raw and enriched, one pair per fund ticker (VBIL, VTIP, VTP, RBIL, LTPZ, SCHP, XHLF, ICPI). Own top-level R2 prefix (`FundHoldings/`) rather than nested under `TIPS/`/`Treasuries/`: a single fund's holdings CSV mixes TIPS and nominal rows (discriminated downstream by CUSIP presence in S10, not a column flag), so it doesn't belong to either instrument-type prefix — same rationale as `misc/`. Also stores `FundHoldings/FundMeta.json` (`{ @Ticker: { fundName, portId | etfId | cusip | portfolioId, expenseRatio, secYield } }` — `expenseRatio`/`secYield` are percent-scale numbers, e.g. `0.09` for 0.09%, matching the Coupon column convention; each provider's own reported figure, not independently computed). Written by `FundHoldings/updateAllHoldings.js`; fetched directly by `FundHoldings/index.html` client-side.

- <a id="s7"></a>**S7: FidelityTreasuriesTips.csv** — Combined Treasury + TIPS bid/ask quotes (replaces the old separate `FidelityTips.csv`/`FidelityTreasuries.csv` pair as of ~2026-06-23). Local drop path: `~/Downloads/FidelityTreasuriesTips.csv` (gitignored, re-downloaded fresh each run). R2 key: `Treasuries/FidelityTreasuriesTips.csv`.
  CSV columns (exact header names): `Product, Description, Cusip, State, Coupon, Frequency, Maturity date, Call protected, Call date, Moody's rating, S&P rating, Yield, Bid price/Quantity (min), Adjusted bid price, Inflation factor, Ask price/Quantity (min), Adjusted ask price, Ask yield to worst, Ask yield to sink, Ask yield to maturity, 3rd party price, Depth of book, Attributes`
  *`Product` = `Treasury` or `TIPS`; parsers filter on this column before further processing (Treasury rows lack `Inflation factor`/`Adjusted bid price`/`Adjusted ask price`; both row types carry `Yield`, which doubles as the bid yield column — there is no separate "Yield Bid" header in the combined export). Parser normalises headers to lowercase. Key fields used: `cusip`, `coupon`, `ask price/quantity (min)` (ask clean real price), `bid price/quantity (min)` (bid clean real price), `adjusted bid price`/`adjusted ask price` (TIPS only), `inflation factor` (TIPS only), `ask yield to maturity` (ask yield, percentage form), `yield` (bid yield, percentage form). For TIPS, bid yield is computed from `bid price/quantity (min)` via `yieldFromPrice` (not from `yield`) to ensure consistency with the ask yield method; for Treasuries, bid yield is read directly from `yield`. Price spread uses adjusted prices for TIPS (actual dollar cost) and raw prices for Treasuries: `yield_spread_bps = (yield_bid − ask_ytm) × 10000`; `price_spread_pct = (price_ask − price_bid) / price_ask × 100`. Footer line `Date downloaded MM/DD/YYYY HH:MM AM/PM` supplies the download timestamp.*

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

<a id="accrued-interest-nominal"></a>
### Accrued Interest (Nominal)
`Accrued_Interest_Nominal` = `(Coupon_Rate / 2 × 100) × (A / E)` *(interest owed to the seller since the last coupon date, per $100 par — Actual/Actual day count: A = days since last coupon, E = days in the current coupon period. NOT a flat half-coupon. For TIPS, index-ratio adjusted: see [Accrued Interest (Adjusted)](#accrued-interest-adjusted).)*

<a id="settlement-date"></a>
### Settlement Date
`Settlement_Date` = *The date on which a bond trade is settled. Standard system logic: [ Trade_Date + 1 Bond Trading Day (T+1) | Manual_Override ]. T+1 excludes weekends and US bond market holidays (source: BondHolidaysSifma.csv). Exception: For FedInvest price ingestion, yield calculations use T=0 (Price Date = Settlement Date) to match FedInvest reported yields empirically. However, the default Ref CPI date is still set to T+1 bond trading day of the FedInvest price date, to match broker convention (where the Ref CPI used is that of the actual settlement date).*

<a id="maturity-date"></a>
### Maturity Date
`Maturity_Date` = *Date on which principal is repaid to the bondholder*

<a id="dated-date"></a>
### Dated Date
`Dated_Date` = *For a TIPS, the 15th of the month of issue, and the date inflation indexation is stated relative to: the [Index Ratio](#index-ratio) is 1.00000 on the dated date, because the [Ref CPI](#ref-cpi) of that date is the ratio’s denominator. The issue date is the last business day of the month, so for a TIPS the dated date and the issue date never coincide.*

For nominal Treasuries, 31 CFR §356.2 applies: *"Dated date means the date from which interest accrues for notes and bonds. The dated date and issue date are usually the same."* That sense governs auction accrued interest. For TIPS the reg’s exception is the rule, the dated date always falling before the issue date.

<a id="coupon-rate"></a>
### Coupon Rate
`Coupon_Rate` = *Fixed annual interest rate paid by the security, expressed as a decimal*

<a id="yield"></a>
### Yield
`Yield` = *Yield-to-Maturity (YTM): the discount rate equating present value of all future cash flows to the current price. Computed with Actual/Actual day count, semi-annual compounding (Excel `YIELD(settlement, maturity, rate, pr, redemption, 2, 1)` convention) for every coupon-bearing security regardless of remaining time to maturity — frequency is always 2, never a separate near-maturity simple-discounting case. Zero-coupon Treasury Bills are the one exception: priced via the simple investment-rate convention (`365/days-to-maturity`), since they have no coupon schedule to apply frequency/day-count to in the first place.*

<a id="yield-curve"></a>
### Yield Curve
`Yield_Curve` = *A plot of yield against term or maturity.*

<a id="ask"></a>
<a id="bid"></a>
### Ask / Bid
`Ask` = *The price or yield at which a security may be bought; the side a buyer transacts on.*
`Bid` = *The price or yield at which a security may be sold.*
*Broker quote files carry both ([S7](#s7)).*

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

<a id="cpi-nsa"></a>
### CPI-U NSA
`CPI_NSA` = *Consumer Price Index for All Urban Consumers, Not Seasonally Adjusted (BLS series `CUUR0000SA0`). The reference index used for TIPS principal adjustments per 31 CFR § 356.*

<a id="cpi-sa"></a>
### CPI-U SA
`CPI_SA` = *Consumer Price Index for All Urban Consumers, Seasonally Adjusted (BLS series `CUSR0000SA0`). Strips predictable seasonal patterns to expose underlying inflation trend.*

<a id="cpi-change-p2p"></a>
### CPI Change (Point-to-Point)
`CPI_Change_P2P` = `(CPI[end] / CPI[start] − 1) × 100` *(Total percent change in CPI between two user-specified dates)*

<a id="cpi-change-yoy"></a>
### CPI Change (Year-over-Year)
`CPI_Change_YoY` = `(CPI[t] / CPI[t − 12 months] − 1) × 100` *(Annual inflation rate: percent change vs. same month prior year)*

<a id="cpi-change-mom"></a>
### CPI Change (Month-over-Month)
`CPI_Change_MoM` = `(CPI[t] / CPI[t − 1 month] − 1) × 100` *(Monthly inflation rate: percent change vs. prior month)*

<a id="rolling-cpi-change"></a>
### Rolling CPI Change
`Rolling_CPI_Change` = `(CPI[t] / CPI[t − N months] − 1) × 100` for each t *(Continuous series of trailing N-month total percent change. N is user-specified.)*

<a id="cpi-cagr"></a>
### CPI CAGR
`CPI_CAGR` = `((CPI[end] / CPI[start])^(12 / N_months) − 1) × 100` *(Compound Annual Growth Rate over N months. Annualizes the point-to-point change.)*

---

<a id="4.0-financial-composites-formulas"></a>
## 4.0 Financial Composites & Formulas

**TIPS Elements**

<a id="ref-cpi"></a>
### Ref CPI
`Ref_CPI` = *Daily interpolated Consumer Price Index (CPI-U NSA) value used for TIPS calculations. Authority: 31 CFR § 356 Appendix B.* One value per **specific calendar day** (not "nearest" — see lookup rule below).
- **Dated:** `Ref_CPI_dated` — Reference CPI on the TIPS [Dated Date](#dated-date) (constant for the bond's lifetime). Carried as `DatedDateCPI` in [S1](#s1) and `DatedDateRefCpi` in [S2](#s2). **Dated date Ref CPI** is the term, matching the Treasury FiscalData field it is sourced from (`ref_cpi_on_dated_date`). *Base CPI* was the earlier name and is retired.
- **Settle:** `Ref_CPI_settle` — Reference CPI on the Settlement Date

**Two derivations — retrieved is authoritative, calculated is the fallback:**
- **Retrieved (authoritative):** TreasuryDirect SecIndex ([E2](#e2)) → `RefCPI.csv` ([S3](#s3)). **All apps use this.**
- **Calculated (NSA fallback + educational):** 31 CFR App. B interpolation of the monthly CPI-U NSA series ([E4](#e4)). For **NSA only**, this is a **fallback** used if retrieval is unavailable, and is retained for educational value. The retrieved and calculated NSA series **must agree** (verified by test).

**Seasonally adjusted daily Ref CPI is a calculated construct — the *only* source, never a fallback.** BLS publishes **monthly** CPI-SA alongside CPI-NSA, but there is **no official daily SA Ref CPI**: App. B daily interpolation officially applies to **NSA only**, because NSA is what drives TIPS inflation accrual. The daily **SA Ref CPI** and **`SA_Factor`** (`RefCpiNsaSa.csv` [S4](#s4)) were devised here for seasonal yield comparison, so they are **necessarily calculated** and must always be produced. The App. B interpolation is defined once in `shared/src/ref-cpi.js` and applied to both series (NSA and SA); the math is shared, but SA production is never removed.

**Lookup rule:** exact entry for the requested date; `null` if the date is **outside the published range** (before the series starts or past the last published day). The series carries one row per calendar day, so within range there is always an exact match — there is no "snap to an earlier date."

**Single implementation:** all Ref CPI logic (retrieve-lookup, calc-fallback, index ratio) lives once in `shared/src/ref-cpi.js`; every app imports it. No per-app copies.

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

<a id="accrued-interest-adjusted"></a>
### Accrued Interest (Adjusted)
`Accrued_Interest_Adjusted` = `Accrued_Interest_Nominal / 100 × Index_Ratio × 1000` *(index-ratio-adjusted accrued interest per TIPS, real dollars — extends [Accrued Interest (Nominal)](#accrued-interest-nominal) the same way [Par Value (Adjusted)](#par-value-adjusted) extends [Par Value (Nominal)](#par-value-nominal). See TIPS_Basics.md §Accrued Interest.)*

---

**Ladder & Portfolio Elements**

<a id="bond-ladder"></a>
### Bond Ladder
`Bond_Ladder` = *A portfolio of securities with staggered maturities that produces a consistent cash flow at regular intervals. In these applications each rung is one calendar year. Specified in [1.0 Bond Ladders](../TipsLadderManager/knowledge/1.0_Bond_Ladders.md).*

<a id="tips-ladder"></a>
### TIPS Ladder
`TIPS_Ladder` = *A [Bond Ladder](#bond-ladder) built from TIPS, so that the cash flow targeted and produced is real rather than nominal: [DARA](#dara) and [ARA](#ara) take the place of [DAA](#daa) and [AA](#aa). Specified in [2.0 TIPS Ladders](../TipsLadderManager/knowledge/2.0_TIPS_Ladders.md), which builds on 1.0.*

<a id="ladder"></a>
### Ladder
`Ladder` = *[Bond Ladder](#bond-ladder), or [TIPS Ladder](#tips-ladder) in a TIPS context. A TIPS ladder is a subset of bond ladders.*

<a id="maturity-year"></a>
### Maturity Year
`Maturity_Year` = *A calendar year in which outstanding TIPS mature. Maturity years are the superset from which [Funded Years](#funded-year) are drawn: a maturity year becomes a funded year when a [DARA](#dara) is specified for it.*

<a id="funded-year"></a>
### Funded Year
`Funded_Year` = *A [Maturity Year](#maturity-year) for which a [DARA](#dara) is specified, and for which total cash flow is calculated. A maturity year lying inside the [Ladder Period](#ladder-period) with no DARA specified is a **missing rung**, the ladder analogy holding: the step is absent. Term adopted from tipsladder.com, so that users moving between the two applications meet the same one.*

<a id="rung"></a>
### Rung
`Rung` = *Synonym for [Funded Year](#funded-year). From the ladder metaphor: each rung is one calendar year (1.0 Bond Ladders §Bond Ladder Concepts).*

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
`ARA` = `Funded_PI + LMI + Same_Year_Excess_Interest` *(Annual Real Amount: total real cash flow produced for a Funded Year)*

Displayed as **Amount**, and as **Real Amount** where a fuller header fits. The header drops *Annual* because it applies to each funded year while the totals row beneath is not annual, and drops *Real* because every principal and interest value in a TIPS ladder is inflation-adjusted, so real is implied throughout. The Cost and Quantity headers drop *Annual* for the same reason.

<a id="lmi"></a>
### LMI
`LMI` = `Σ Annual_Interest_Real for TIPS maturing in years > Current_Year` *(Later Maturity Interest: interest contributions to the current funded year from bonds maturing in future years)*

<a id="same-year-excess-interest"></a>
### Same-Year Excess Interest
`Same_Year_Excess_Interest` = `Σ Annual_Interest_Real for bracket or cover excess TIPS maturing in Current_Year`
*Bracket or cover excess TIPS ([Duration Matching](../TipsLadderManager/knowledge/2.0_TIPS_Ladders.md#duration-matching-brackets)) are ordinary held bonds — their coupon interest behaves exactly like any other TIPS's: interest paid in their own maturity year counts toward that year's Amount (this term, credited only to the year the excess bonds themselves mature), and it also continues flowing down into [LMI](#lmi) for every shorter-maturity year, same as any other coupon. Bracket excess (the lower/upper gap brackets) covers [Gap Years](#gap-years), where 10-year TIPS have not yet been issued; cover excess (the Future 30Y cover pair) covers [Future 30Y Rungs](../TipsLadderManager/knowledge/2.0_TIPS_Ladders.md#future-30y-rungs-section), where 30-year TIPS have not yet been issued — the two block types are covered by different excess holdings and should not be conflated. Example: excess Feb 2056 TIPS held to cover Future 30Y Rungs (2057–2066) — their interest contributes to the 2056 funded year's Amount as Same-Year Excess Interest, reducing the 2056 rung's own quantity, and the same coupon also flows down as ordinary LMI to 2055, 2054, and every year below.*


<a id="gap-years"></a>
### Gap Years
`Gap_Years` = *Funded Years within the ladder period where no Treasury TIPS exist (currently 2037, 2038, 2039)*

<a id="synthetic-tips"></a>
### Synthetic TIPS
`Synthetic_TIPS` = *Theoretical TIPS constructed for Gap Years. Yield interpolated from surrounding real maturities; index ratio = 1.0; price = 100.*

<a id="bracket-year"></a>
### Bracket Year
`Bracket_Year` = *Existing TIPS maturity used to fund or bracket a Gap Year*

<a id="ladder-eligible-tips"></a>
### Ladder-Eligible TIPS
`Ladder_Eligible_TIPS` = *A TIPS that has been **issued** and is tradable at the market-data source the ladder prices against. A TIPS is issued on the last trading day of the month in which it is auctioned; between auction and issuance it exists in reference data but cannot be bought, so it is excluded from ladder construction, rebalancing, and maturity selection. Eligibility is a property of the security, not of a mode — it applies identically to Build and Rebalance.*

<a id="active-lower-bracket"></a>
### Active Lower Bracket
`Active_Lower_Bracket` = *The latest-maturing [ladder-eligible](#ladder-eligible-tips) TIPS maturing before the first [Gap Year](#gap-years) — the only lower-side maturity a rebalance will **buy**. It absorbs whatever gap coverage the [Retained Bracket Excess](#retained-bracket-excess) does not supply, and it is the maturity used for lower-side duration matching. Stated as a rule rather than a value because it advances as new TIPS are issued: it is whichever maturity currently satisfies the rule, not a fixed CUSIP or month.*

<a id="retained-bracket-excess"></a>
### Retained Bracket Excess
`Retained_Bracket_Excess` = *Excess held in a lower-bracket maturity older than the [Active Lower Bracket](#active-lower-bracket), carried forward from an earlier rebalance when that maturity was itself active. A rebalance **never increases** it. It is sold **only** when total lower-side excess exceeds the duration-matched target, **oldest maturity first**, and only until the overage is absorbed. Any number of older maturities may accumulate as successive maturities become active — the count is not fixed, so the structure is never named by how many brackets it contains.*

<a id="available-cash"></a>
### Available Cash
`Available_Cash` = *Cash on hand applied toward the [ARA](#ara) of the earliest [Funded Years](#funded-year). A pool, applied to the earliest funded year first and moving up the ladder until exhausted, so a year it covers in full needs no TIPS. Stated by the holder rather than detected: cash intended for reinvestment in the ladder is simply not entered (2.0 §Available Cash).*

<a id="net-cash"></a>
### Net Cash
`Net_Cash` = *The cash credit or debit left after a rebalance: the per-row cost deltas summed across the run. Negative when the rebalance buys more than it sells. Rebalance’s counterpart to [Total Cost](#total-cost).*

<a id="total-cost"></a>
### Total Cost
`Total_Cost` = *The cost of every TIPS a build says to buy: the [Funded Year](#funded-year) rung holdings, together with the bracket and cover excess held in lieu of the missing gap-year and Future 30Y TIPS. That excess is held to cover a missing block rather than to fund the maturity year it falls in, so its principal is not applied toward that year’s ARA, although its coupon interest is (see [Same-Year Excess Interest](#same-year-excess-interest)). Build’s counterpart to [Net Cash](#net-cash).*

<a id="reference-date"></a>
### Reference Date
`Reference_Date` = *The date a calculation is stated relative to. Restating per-year amounts to a Ref CPI uses that Ref CPI’s date as the reference date (3.0 §DARA Reference Date). In the two specific contexts of auction accrued interest and TIPS indexation, the term is [Dated Date](#dated-date).*

<a id="last-year-interest"></a>
### Last-Year Interest
`Last_Year_Interest` = *Interest paid in a funded year by securities maturing in that year. Treasuries pay semiannually, so a January–June maturity pays one coupon in its final year and a July–December maturity pays two (1.0 Bond Ladders §Bond Ladder Concepts).*

<a id="duration-matching"></a>
### Duration Matching
`Duration_Matching` = *Covering a missing block of maturities, whether [Gap Years](#gap-years) or Future 30Y years, with additional holdings in a bracket pair or cover pair, weighted so that the excess changes in value as the missing block would under a rate move. Modified duration throughout (2.0 §Duration Matching).*

<a id="within-year-allocation-policy"></a>
### Within-Year Allocation Policy
`Within_Year_Allocation_Policy` = *Which candidate TIPS a rebalance trades for a [Funded Year](#funded-year) when more than one is in play. Rebalance only: a build splits its need evenly across every candidate (2.0 §Within-Year Allocation Policy).*

<a id="trade-ticket"></a>
### Trade Ticket
`Trade_Ticket` = *The list of trades required to produce the ladder shown, in either Build or Rebalance.*

<a id="cash-flow-calendar"></a>
### Cash Flow Calendar
`Cash_Flow_Calendar` = *When a portfolio’s current holdings pay, and how much, by date. Independent of funded years, DARA, brackets, gaps and covers: a fact about the held CUSIPs and quantities rather than a ladder-construction result (5.0 §Cash Flow Calendar).*

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
`IQR_Clip` = *Y-axis floor applied to the Treasuries chart tab to suppress near-maturity Bills/Notes with extreme negative YTM. Floor = Q1 − max(1.0 × IQR, 0.5%) computed from positive-yield Bills + Notes values only. Does not remove data points — only adjusts the visible axis scale. Upper bound unconstrained.*

---

## 5.0 Global Constants

### 5.1 Issuance-Dependent Values

Some values are true only until Treasury issues more TIPS. Left inline as approximations across specs, they go stale silently — "Jan/Jul ≤~2035" was accurate when written and gave no signal when a Jul 2036 was auctioned.

**Protocol** (generalizes the [`REFCPI_CUSIP`](#5.0-global-constants) entry below, which already states a selection principle plus a rotation trigger):

1. **Specs state the rule, not the value.** A value appears only as illustration, marked with the date it was true.
2. **The volatile values live here**, each with the event that changes it — not scattered as inline approximations across 2.0, 3.0 and app help text.
3. **A test derives each value from live data and asserts it matches this table.** Issuance drift then fails a test instead of rotting unnoticed. This is verifying redundancy (two independent derivations, gated by an assertion), not a duplicated definition.

| Value | Rule | As of 2026-08-25 | Changes when |
|---|---|---|---|
| Gap years | Years in the ladder period with no issued TIPS | 2037, 2038, 2039 | A 10-year TIPS maturing in a gap year is issued |
| Multi-maturity boundary | Years below it may hold more than one maturity month; at/above, 30-year February issues only | 2040 | 10-year issuance extends past the current boundary |
| Maturity-month pattern | Quarterly at the short end, January/July for 10-year, February for 30-year | quarterly ≤~2030, Jan/Jul ≤~2036, Feb 2040+ | Issuance calendar changes |
| Longest issued maturity year | Maturity year of the longest-dated issued TIPS | 2056 | A new 30-year TIPS is issued |
| Active lower bracket | [Active Lower Bracket](#active-lower-bracket) — latest ladder-eligible maturity before the first gap year | Jul 2036 | The next pre-gap maturity is issued |

`LOWEST_LOWER_BRACKET_YEAR` = 2032 *(floor of the holdings search range for [retained bracket excess](#retained-bracket-excess): only maturity years in `[LOWEST_LOWER_BRACKET_YEAR, minGapYear)` are considered. Matches `rebalance-lib.js`.)*
`REFCPI_CUSIP` = "912810FD5" *(3.625% TIPS, issued 1998, matures 2028-04-15)* — CUSIP used to pull the authoritative daily Ref CPI from TreasuryDirect ([E2](#e2)).
  **Selection principle (the rule, not the value):** Ref CPI is *market-wide* — identical across all TIPS on a given date — so the CUSIP only determines how far back history reaches. Use the **oldest TIPS not yet matured** to maximize available history. `912810FD5` fits today; **when it matures (2028-04-15), rotate to the next-oldest un-matured TIPS** and update `scripts/fetchRefCpi.js`. *(The stale value `912828V98` previously recorded here does not correspond to any TIPS.)*
`SIFMA_HOLIDAYS` = *Calendar of bond market closures*

# System Data Stores (S)

This document provides the technical schemas and field-level specifications for all internal data files stored in the Cloudflare R2 bucket.

---

## <a id="s1"></a>S1: YieldsFromFedInvestPrices.csv
**Description**: Daily Treasury settlement prices and derived Yield-to-Maturity (YTM).
**Update Frequency**: Weekdays ~1:05 PM ET.

| Field | Type | Description |
|---|---|---|
| `Settlement_Date` | Date | The date used for yield calculations. Inferred as T=0 (Price Date) for FedInvest. |
| `CUSIP` | String | 9-character security identifier. |
| `Type` | String | Security type (Bill, Note, Bond, TIPS). |
| `Maturity` | Date | The maturity date of the security. |
| `Coupon` | Number | The annual coupon rate (e.g., 0.125). |
| `DatedDateCPI` | Number | For TIPS: The Ref CPI on the bond's dated date. |
| `Price` | Number | The raw price provided by the source. |
| `Yield` | Number | The computed real YTM (Excel YIELD convention). |

**Live Data**: [View Preview (Toggles Table)](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/YieldsFromFedInvestPrices.csv)

---

## <a id="s2"></a>S2: TipsRef.csv
**Description**: Immutable TIPS metadata fetched from FiscalData.
**Update Frequency**: Weekly (or on-demand for new auctions).
**R2 Key**: `TIPS/TipsRef.csv` (written by `scripts/fetchTipsRef.js`). The old `Treasuries/TipsRef.csv` key was consolidated away (see `R2_Cleanup.md`) but the stale object was never deleted from R2 — it is frozen at 2026-07-13 and must not be read.

| Field | Type | Description |
|---|---|---|
| `CUSIP` | String | 9-character security identifier. |
| `Maturity` | Date | Maturity date. |
| `DatedDate` | Date | The dated date (start of interest accrual). |
| `Coupon` | Number | The fixed real coupon rate. |
| `DatedDateRefCpi` | Number | The Ref CPI on the Dated Date. |
| `Term` | String | Original issuance term (5-year, 10-year, 30-year). |

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/TipsRef.csv)

---

## <a id="s3"></a>S3: RefCPI.csv
**Description**: Daily interpolated Reference CPI for index ratio calculations.
**Update Frequency**: Monthly (on BLS release).

| Field | Type | Description |
|---|---|---|
| `Date` | Date | The specific date for the RefCPI value. |
| `RefCPI` | Number | The daily interpolated CPI-U value. |

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/RefCPI.csv)

---

## <a id="s4"></a>S4: RefCpiNsaSa.csv
**Description**: Daily interpolated Reference CPI (NSA and SA) derived from monthly BLS CPI-U data via 31 CFR §356 App. B interpolation. SA daily Ref CPI is a calculated sole source (no official daily SA series).
**Update Frequency**: Monthly (on BLS release).
**R2 Key**: `TIPS/RefCpiNsaSa.csv`

| Field | Type | Description |
|---|---|---|
| `Ref CPI Date` | Date | The specific date for the Ref CPI values. |
| `Ref CPI NSA` | Number | Daily interpolated NSA Reference CPI (App. B). |
| `Ref CPI SA` | Number | Daily interpolated SA Reference CPI (App. B). |
| `SA Factor` | Number | Computed seasonal factor (`Ref CPI NSA / Ref CPI SA`). |

**Sort order**: Descending by date (newest row first).

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/RefCpiNsaSa.csv)

---

## <a id="s5"></a>S5: Auctions.csv
**Description**: Historical Treasury auction results since 1980.
**Update Frequency**: Weekdays.

**Key Fields**: `CUSIP`, `Auction_Date`, `Security_Type`, `High_Yield`, `Bid_to_Cover`.

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/Auctions.csv)

---

## <a id="s6"></a>S6: yields-history/
**Description**: Single consolidated JSON, nested by symbol (US10Y, US30Y, … — all 14).
**Update Frequency**: Weekdays (end-of-day snapshots) via `updateYieldsHistory.js`.

**Format**: one object keyed by symbol, each value a `{ x, y }` array, e.g. `{ "US10Y": [ { "x": "20260403150000", "y": 4.25 }, ... ], "US30Y": [ ... ], ... }`.
- `x` is CNBC's compact `tradeTime` string `YYYYMMDDHHMMSS` (no separators). Daily-close bars are stamped at 15:00 ET (`...150000`) — the ~3PM benchmark close (see `YieldsMonitor/knowledge/Close_Price_Investigation.md`).
- `y` is the yield as a number (percent, `%` stripped).

**Refresh logic**: `updateYieldsHistory.js` rereads the 1Y/2Y/3Y daily feeds and merges the coarser 10Y/ALL feeds, skipping the current (provisional) ET day, and rewrites the whole file. One daily 3PM close per completed trading day per symbol. The browser stitches live intraday on top of this daily baseline. (Replaces the retired per-symbol `snapHistory.js` append model.)

**Live Sample**: [View consolidated history](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/yields-history/history.json)

---

## <a id="s13"></a>S13: SpotYieldCurves.csv
**Description**: Evaluated yields for every priced Treasury and TIPS security, plus the fitted nominal and TIPS-SA zero-coupon (spot) yield curves evaluated on a term grid — general-purpose, spreadsheet-ready (unlike [S12](#s12), which stores unevaluated Svensson parameters). Superseded the parameters-only `SpotYieldCurves.json` (retired 2026-09-07): six coefficients aren't usable in a spreadsheet, so this file stores actual yields instead. One row per **actual security** (`cusip`/`maturity_date`/`security_type` populated; `ask_yield`/`sa_yield`/`sao_yield` populated where they exist) or one row per **fitted grid point** (`cusip`/`maturity_date`/`security_type` blank; `spot_yield`/`spot_sa_yield`/`bei` populated).
**Update Frequency**: Same cadence as the `FidelityQuotes` pipeline (3x daily on weekdays), via `updateSpotYieldCurves.js`.
**R2 Key**: `Treasuries/SpotYieldCurves.csv`

| Field | Type | Description |
|---|---|---|
| `term_years` | Number | Years from settlement to maturity (actual security row), or the grid horizon (fitted row). |
| `maturity_date` | Date | Maturity date. Blank on a fitted grid row. |
| `cusip` | String | 9-character security identifier. Blank on a fitted grid row. |
| `security_type` | String | `Bill`, `Note`, `Bond`, or `TIPS`. Blank on a fitted grid row (STRIPS excluded, same as [S1](#s1)'s fitting inputs). |
| `source` | String | `FedInvest` or `Market`, same distinction as [S10](#s10)/[S14](#s14)/[S15](#s15). |
| `ask_yield` | Number | Ask yield-to-maturity (decimal). Actual security rows only. FedInvest carries a single mid-market yield ([E1](./DATA_DICTIONARY.md#e1)), not a true ask — this column holds that mid-market figure on FedInvest-source rows. |
| `sa_yield` | Number | [SA Yield](./DATA_DICTIONARY.md#sa-yield) (decimal). TIPS rows only. |
| `sao_yield` | Number | [SAO Yield](./DATA_DICTIONARY.md#sao-yield) (decimal). TIPS rows only. |
| `spot_yield` | Number | Fitted nominal Treasury zero-coupon yield at `term_years` (decimal, semi-annual bond-equivalent — converted from the module's continuously-compounded `z(t)` so it sits on the same basis as `ask_yield`). Fitted grid rows only. |
| `spot_sa_yield` | Number | Fitted TIPS zero-coupon yield at `term_years`, fit to seasonally adjusted prices (decimal, semi-annual bond-equivalent, same conversion as `spot_yield`). Fitted grid rows only. |
| `bei` | Number | `spot_yield − spot_sa_yield` at `term_years`: nominal spot yield minus real (SA) spot yield, per [4.0 Spot Yield Curves](../YieldCurves/knowledge/4.0_Spot_Yield_Curves.md#spot-bei). Fitted grid rows only. |

**Term grid**: half-year steps (0.5, 1.0, 1.5, …), matching the chart's own `spotCurveGrid` convention, clipped per `source` to the range where both the nominal and TIPS-SA fits are valid (`max(tMin)` to `min(tMax)` of the two fits) so `bei` is always defined wherever a grid row appears. A grid point is dropped if either fit's sanity check fails there (see `shared/src/spot-curve.js#spotCurveFit`).

**Not fit here**: the quoted (non-SA) TIPS spot curve (`tips_ask` in the retired S13 JSON) — not part of this file's schema. The YieldCurves app still fits it live in the browser for its own chart; this pipeline only persists the nominal and TIPS-SA fits, since those are what `bei` and the general-purpose spreadsheet need.

**Logic**: Loads the same R2 inputs the YieldCurves app loads (S1, S4, S7, `misc/BondHolidaysSifma.csv`) and fits with `shared/src/spot-curve.js#spotCurveFit` — the same module `src/app.js` imports, so the app and this pipeline can never drift onto two different fits. The script evaluates the fit objects' own `z(t)`/`sane()` on the term grid rather than refitting.

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/SpotYieldCurves.csv)

---

## <a id="s14"></a>S14: BreakevenInflation.csv
**Description**: Per-TIPS breakeven inflation — the Ask/SA/SAO yield for each TIPS against the yield of its nearest-maturity nominal Treasury, `Market` (Fidelity) source only. Matches the YieldCurves BEI tab's per-bond table, which the app computes but does not persist.
**Update Frequency**: Same cadence as the `FidelityQuotes` pipeline (3x daily on weekdays), via `updateSpotYieldCurves.js`.
**R2 Key**: `Treasuries/BreakevenInflation.csv`

| Field | Type | Description |
|---|---|---|
| `cusip` | String | TIPS CUSIP. |
| `maturity` | Date | TIPS maturity date. |
| `coupon` | Number | Real coupon rate (decimal). |
| `ask_yield` | Number | Ask yield-to-maturity (decimal). |
| `sa_yield` | Number | [SA Yield](./DATA_DICTIONARY.md#sa-yield). |
| `sao_yield` | Number | [SAO Yield](./DATA_DICTIONARY.md#sao-yield). |
| `nominal_cusip` | String | CUSIP of the nearest-maturity nominal Treasury. |
| `nominal_maturity` | Date | That nominal's maturity date. |
| `nominal_yield` | Number | That nominal's ask yield-to-maturity (decimal). |
| `ask_bei` | Number | `nominal_yield − ask_yield`. |
| `sa_bei` | Number | `nominal_yield − sa_yield`. |
| `sao_bei` | Number | `nominal_yield − sao_yield`. |

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/BreakevenInflation.csv)

---

## <a id="s15"></a>S15: BidAskSpreads.csv
**Description**: Per-security broker bid/ask yield and price spread, TIPS and nominal Treasuries combined in one file (`security_type` discriminates, same pattern as [S7](#s7)'s `Product` column). `Market` (Fidelity) source only — FedInvest carries a single mid-market price, not a separate bid and ask.
**Update Frequency**: Same cadence as the `FidelityQuotes` pipeline (3x daily on weekdays), via `updateSpotYieldCurves.js`.
**R2 Key**: `Treasuries/BidAskSpreads.csv`

| Field | Type | Description |
|---|---|---|
| `security_type` | String | `TIPS` or `Treasury`. |
| `cusip` | String | 9-character security identifier. |
| `maturity` | Date | Maturity date. |
| `coupon` | Number | Coupon rate (decimal). |
| `ask_yield` | Number | Ask yield-to-maturity (decimal). |
| `bid_yield` | Number | Bid yield-to-maturity (decimal). |
| `yield_spread_bps` | Number | `(bid_yield − ask_yield) × 10000`. |
| `ask_price` | Number | Ask price (TIPS: raw clean price, matching S7). |
| `bid_price` | Number | Bid price (TIPS: raw clean price, matching S7). |
| `price_spread_pct` | Number | TIPS: `(adjusted_ask − adjusted_bid) / adjusted_ask × 100` (actual dollar cost). Treasury: `(ask − bid) / ask × 100`. |

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/BidAskSpreads.csv)

---

## <a id="s7"></a>S7: FidelityTreasuriesTips.csv
**Description**: Combined broker market quotes from Fidelity — Treasury and TIPS rows in one file, distinguished by the `Product` column (`Treasury` / `TIPS`).
**Update Frequency**: 3× Daily (Local Windows Task).

**Fields**: `Product`, `CUSIP`, `Maturity`, `Coupon`, `Ask_Price`, `Bid_Price`, `Ask_Yield`, `Bid_Yield`.

**Live Sample**: [View FidelityTreasuriesTips.csv](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/FidelityTreasuriesTips.csv)

---

## <a id="s8"></a>S8: CPI_history.csv
**Description**: Full monthly BLS CPI-U history (NSA and SA) from January 1913 to present.
**Update Frequency**: Monthly (on BLS release).
**R2 Key**: `bls/CPI_history.csv`

| Field | Type | Description |
|---|---|---|
| `Year` | String | 4-digit year (e.g., `"1913"`) |
| `Period` | String | BLS period code (e.g., `"M01"` = January) |
| `PeriodName` | String | Full month name (e.g., `"January"`) |
| `NSA` | Number | CPI-U Not Seasonally Adjusted ([E4](./DATA_DICTIONARY.md#e4) series `CUUR0000SA0`) |
| `SA` | Number | CPI-U Seasonally Adjusted ([E4](./DATA_DICTIONARY.md#e4) series `CUSR0000SA0`). Blank for periods before January 1947. |

**Sort order**: Ascending by Year, then Period (oldest row first).

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/bls/CPI_history.csv)

---

## <a id="s9"></a>S9: Tentative-Auction-Schedule.xml
**Description**: Copy of the Treasury's Tentative Auction Schedule, used to identify TIPS auctions that the FiscalData upcoming-auctions feed doesn't flag.
**Update Frequency**: Local Windows Task `TreasuryAuctions-TentativeSchedule`. Treasury revises this schedule at its Quarterly Refunding press conference (first Wednesday of Feb/May/Aug/Nov), with the document itself updated ~1–3 weeks later, so the task runs daily for 21 days after each of the next 2 quarterly-refunding dates, plus a monthly safety-net check the rest of the year. A companion task, `TreasuryAuctions-TentativeSchedule-Refresh`, re-runs `scripts/setup-tentative-schedule-task.ps1` quarterly to roll the trigger window forward — no manual maintenance needed.
**R2 Key**: `Treasuries/Tentative-Auction-Schedule.xml`

**Format**: XML `<AuctionCalendarDate>` elements, each with `AuctionDate`, `SecurityTermWeekYear`, `SecurityType`, `ReOpeningIndicator` (Y/N), `TIPS` (Y/N), `FloatingRate` (Y/N), `AnnouncementDate`, `SettlementDate`.

**Logic**: Fetched directly by the TreasuryAuctions app, which matches each upcoming-auction row to an `<AuctionCalendarDate>` node by `AuctionDate` + `SecurityTermWeekYear` and flags it TIPS if that node's `TIPS` field is `Y`.

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/Tentative-Auction-Schedule.xml)

---

## <a id="s10"></a>S10: YieldsSaSao.csv
**Description**: TIPS ask/SA/SAO yields derived from Fidelity quotes.
**Update Frequency**: Triggered by the `FidelityQuotes` task (3× daily on weekdays), via `updateSaSaoYields.js`.
**R2 Key**: `TIPS/YieldsSaSao.csv`

| Field | Type | Description |
|---|---|---|
| `cusip` | String | 9-character security identifier. |
| `maturity` | Date | Maturity date. |
| `coupon` | Number | Real coupon rate (decimal). |
| `ask_yield` | Number | Ask yield-to-maturity (decimal). |
| `sa_yield` | Number | [SA Yield](./DATA_DICTIONARY.md#sa-yield). |
| `sao_yield` | Number | [SAO Yield](./DATA_DICTIONARY.md#sao-yield). |

**Consumer**: FundHoldings ([E7](./DATA_DICTIONARY.md#e7)/[E8](./DATA_DICTIONARY.md#e8) holdings enrichment) — cross-references by CUSIP to attach ask/SA/SAO yield to TIPS fund holdings.

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/YieldsSaSao.csv)

---

## <a id="s11"></a>S11: FundHoldings/Holdings-&lt;TICKER&gt;(-Enriched).csv
**Description**: Treasury and TIPS fund holdings by CUSIP, one raw and one enriched CSV per fund ticker (VBIL, VTIP, VTP, RBIL, LTPZ, SCHP, XHLF, ICPI). The enriched file adds ask/SA/SAO yield, term, and duration, computed the same way for every fund from [S10](#s10) and [S7](#s7) rather than taken from each provider’s own reported analytics.
**Update Frequency**: Daily, Local Windows Task `FundHoldings`, via `FundHoldings/updateAllHoldings.js` then `FundHoldings/enrichHoldings.js`.
**R2 Key**: `FundHoldings/` (its own top-level prefix, since a fund’s holdings mix TIPS and nominal rows and so belong under neither `TIPS/` nor `Treasuries/`)

**CSV columns** (exact header names): `CUSIP, Holding Name, Ticker, Category, Quantity, Coupon, % of Fund, Market Value, Maturity Date, ISIN, SEDOL, As of` — and, in the `-Enriched` file only, `Ask Yield, SA Yield, SAO Yield, Term, Duration`. These are the file’s own headers; the [E7](./DATA_DICTIONARY.md#e7)–[E12](./DATA_DICTIONARY.md#e12) entries name the same fields in the Data Dictionary’s normalized form.

**Companion file**: `FundHoldings/FundMeta.json` = `{ @Ticker: { fundName, portId | etfId | cusip | portfolioId, expenseRatio, secYield } }`. `expenseRatio` and `secYield` are percent-scale numbers (`0.09` for 0.09%), each the provider’s own reported figure rather than an independently computed one.

**Sources**: [E7](./DATA_DICTIONARY.md#e7) Vanguard, [E8](./DATA_DICTIONARY.md#e8) fminvest.com, [E9](./DATA_DICTIONARY.md#e9) PIMCO, [E10](./DATA_DICTIONARY.md#e10) Schwab, [E11](./DATA_DICTIONARY.md#e11) BondBloxx, [E12](./DATA_DICTIONARY.md#e12) BlackRock iShares. Per-fund detail: [FundHoldings 1.0](../FundHoldings/knowledge/1.0_FundHoldings.md).

**Live Data**: [View FundMeta.json](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/FundHoldings/FundMeta.json)

---

## <a id="s12"></a>S12: GswTipsCurve.json
**Description**: The latest published row of the Federal Reserve's Gürkaynak-Sack-Wright fitted TIPS (real) yield curve (FEDS 2008-05), scraped from `feds200805_1.html`. Just the six Svensson parameters and the observation date — the app evaluates the curve itself. Used only as a reference overlay against YieldCurves' own spot fit.
**Update Frequency**: `GswTipsCurve` task, daily 7:15am PT, via `YieldCurves/scripts/updateGswTipsCurve.js`. The source itself updates weekly (Tuesdays, covering through the prior Friday); the daily poll just picks up new or revised rows promptly.
**R2 Key**: `TIPS/GswTipsCurve.json`

| Field | Type | Description |
|---|---|---|
| `date` | Date | Observation date of the fitted curve (`YYYY-MM-DD`). |
| `beta0`–`beta3` | Number | Svensson level / slope / two curvature coefficients (percent). |
| `tau1`, `tau2` | Number | Svensson decay parameters (years). |

**Consumer**: YieldCurves (TIPS tab) — evaluates the Svensson zero-yield formula from these parameters to draw the "GSW zero" reference line.

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/GswTipsCurve.json)

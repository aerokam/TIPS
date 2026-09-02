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

| Field | Type | Description |
|---|---|---|
| `CUSIP` | String | 9-character security identifier. |
| `Maturity` | Date | Maturity date. |
| `DatedDate` | Date | The dated date (start of interest accrual). |
| `Coupon` | Number | The fixed real coupon rate. |
| `DatedDateRefCpi` | Number | The Ref CPI on the Dated Date. |
| `Term` | String | Original issuance term (5-year, 10-year, 30-year). |

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/TipsRef.csv)

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
**R2 Key**: `TIPS/Tentative-Auction-Schedule.xml`

**Format**: XML `<AuctionCalendarDate>` elements, each with `AuctionDate`, `SecurityTermWeekYear`, `SecurityType`, `ReOpeningIndicator` (Y/N), `TIPS` (Y/N), `FloatingRate` (Y/N), `AnnouncementDate`, `SettlementDate`.

**Logic**: Fetched directly by the TreasuryAuctions app, which matches each upcoming-auction row to an `<AuctionCalendarDate>` node by `AuctionDate` + `SecurityTermWeekYear` and flags it TIPS if that node's `TIPS` field is `Y`.

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/Tentative-Auction-Schedule.xml)

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

## <a id="s11"></a>S11: GswTipsCurve.json
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

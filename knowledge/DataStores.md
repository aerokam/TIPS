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
| `DatedDateCPI` | Number | For TIPS: The reference CPI on the bond's dated date (Base CPI). |
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
| `BaseCPI` | Number | The reference CPI on the Dated Date. |
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
**Description**: Monthly BLS CPI-U data (NSA and SA series) for seasonal adjustment derivation.
**Update Frequency**: Monthly.

| Field | Type | Description |
|---|---|---|
| `Date` | Date | Month-end date. |
| `CPI_NSA` | Number | Non-seasonally adjusted CPI-U. |
| `CPI_SA` | Number | Seasonally adjusted CPI-U. |
| `SA_Factor` | Number | Computed seasonal factor (`CPI_SA / CPI_NSA`). |

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/RefCpiNsaSa.csv)

---

## <a id="s5"></a>S5: Auctions.csv
**Description**: Historical Treasury auction results since 1980.
**Update Frequency**: Weekdays.

**Key Fields**: `CUSIP`, `Auction_Date`, `Security_Type`, `High_Yield`, `Bid_to_Cover`.

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/Auctions.csv)

---

## <a id="s6"></a>S6: yield-history/
**Description**: JSON time series of yields per symbol (US10Y, US30Y, etc.).
**Update Frequency**: Weekdays (end-of-day snapshots).

**Format**: `{ "symbol": "US10Y", "history": [ { "x": "2026-03-01", "y": 4.25 }, ... ] }`

**Live Sample**: [View US10Y History](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/yield-history/US10Y_history.json)

---

## <a id="s7"></a>S7: FidelityQuotes
**Description**: Broker market quotes from Fidelity.
**Update Frequency**: 3× Daily (Local Windows Task).

**Fields**: `CUSIP`, `Maturity`, `Coupon`, `Ask_Price`, `Bid_Price`, `Ask_Yield`, `Bid_Yield`.

**Live Sample**: [View FidelityTreasuries.csv](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/FidelityTreasuries.csv)

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

## <a id="s9"></a>S9: tentative_tips.json
**Description**: Upcoming TIPS auctions extracted from the Treasury's Tentative Auction Schedule.
**Update Frequency**: Periodic (Local Windows Task).
**R2 Key**: `TIPS/tentative_tips.json`

**Format**: `[ { "auction_date": "2026-04-23", "security_term": "5-Year", "reopening": "No" }, ... ]`

**Logic**: Used by the TreasuryAuctions app to identify TIPS in the upcoming auctions feed, which lacks a native TIPS flag.

**Live Data**: [View Preview](https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/tentative_tips.json)

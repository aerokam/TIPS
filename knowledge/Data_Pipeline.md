# Data Pipeline

Project-wide data acquisition architecture. This document tracks the sources, schedules, and ownership (GitHub vs. Local) of all ingestion jobs.

---

## 1.0 External Data Sources

All data enters the system from these 6 external entities. Click the **Drill-down Schema** to see exactly which fields are provided by each source.

| ID | Source | Data Provided | Method | Drill-down Schema |
|---|---|---|---|---|
| **E1** | **FedInvest** | Daily mid-market reference prices | Automated Scrape | [E1 Schema](./DATA_DICTIONARY.md#e1) |
| **E2** | **TreasuryDirect** | Daily interpolated RefCPI | REST API | [E2 Schema](./DATA_DICTIONARY.md#e2) |
| **E3** | **FiscalData** | Auction results & TIPS metadata | REST API | [E3 Schema](./DATA_DICTIONARY.md#e3) |
| **E4** | **BLS API** | Monthly CPI-U (NSA/SA) factors | REST API | [E4 Schema](./DATA_DICTIONARY.md#e4) |
| **E5** | **CNBC** | Real-time market yields | GraphQL | [E5 Schema](./DATA_DICTIONARY.md#e5) |
| **E6** | **Fidelity** | Broker ask/bid quotes | Automated Download | [E6 Schema](./DATA_DICTIONARY.md#e6) |

---

## 2.0 Ingestion Jobs (Ownership & Schedule)

All ingestion jobs have been migrated to **Local Windows Scheduled Tasks** to ensure precision and reliability.

### [LOCAL] Local Scheduled Tasks (Windows)
These jobs run on the host machine via Windows Task Scheduler.

| Task Name | Schedule | Script | Primary Output |
|---|---|---|---|
| **FedInvest Download** | Weekdays 1:05pm ET | `scripts/getYieldsFedInvest.js` | `YieldsFromFedInvestPrices.csv` |
| **Fidelity Quotes** | 3× Daily | *(Windows Task)* | `FidelityTreasuriesTips.csv` (combined Treasury + TIPS) |
| **Auction Refresh** | Weekdays 8:05/10:35am PT | `scripts/getAuctions.js` | `Auctions.csv` |
| **TIPS Ref Refresh** | Mondays 7am PT | `scripts/fetchTipsRef.js` | `TipsRef.csv` |
| **Update Yields History** | Weekdays 2:00pm PT | `YieldsMonitor/scripts/updateYieldsHistory.js` | `yields-history/history.json` |
| **Ref CPI Refresh** | 8:35 AM ET on each BLS release date | `scripts/fetchRefCpi.js` (`run-ref-cpi.cmd`) | `TIPS/RefCPI.csv` |
| **SA Factor Update** | Daily 6:35am | `YieldCurves/scripts/updateRefCpi.js` | `RefCpiNsaSa.csv` |
| **CPI History Refresh** | 8:35 AM ET on each BLS release date | `scripts/fetchCpiHistory.js` (`run-cpi-history.cmd`) | `bls/CPI_history.csv` |

**CPI release date triggers:** `RefCPI` and `FetchCpiHistory` tasks use date-specific `Once` triggers (not a daily poll). Triggers are set by `scripts/setup-cpi-release-tasks.ps1`, which reads `bls/CpiReleaseSchedule{year}.csv` from R2 and registers one trigger per release date. A `RefreshCpiTasks` task runs Dec 29 each year to reload the next year's schedule and self-reschedule. Re-run the script manually if the schedule changes.

---

## 3.0 R2 Data Store
All jobs above upload their results to the central Cloudflare R2 bucket.
- **Reference**: See [DataStores.md](./DataStores.md) for the full file manifest and live previews.

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

We have migrated several unreliable GitHub Actions to **Local Windows Scheduled Tasks** to ensure precision. **If a job is marked [LOCAL], it runs on the host machine.**

### [LOCAL] Local Scheduled Tasks (Windows)
These jobs are the primary ingestion engine. They run on the owner's machine via Windows Task Scheduler.

| Task Name | Schedule | Script | Primary Output |
|---|---|---|---|
| **FedInvest Download** | Weekdays 1:05pm ET | `scripts/getYieldsFedInvest.js` | `YieldsDerivedFromFedInvestPrices.csv` |
| **Fidelity Quotes** | 3× Daily | *(Windows Task)* | `FidelityTreasuries.csv` |
| **CPI Refresh** | Monthly (Release Day) | `scripts/fetchRefCpi.js` | `RefCPI.csv` |
| **SA Factor Update** | Daily 6:35am | `YieldCurves/scripts/updateRefCpi.js` | `RefCpiNsaSa.csv` |

### [CLOUD] Active GitHub Actions
These jobs still run on GitHub's infrastructure.

| Workflow | Schedule | Script | Primary Output |
|---|---|---|---|
| `get-auctions.yml` | Weekdays 8:05/10:35am PT | `scripts/getAuctions.js` | `Auctions.csv` |
| `fetch-tips-ref.yml` | Mondays 7am PT | `scripts/fetchTipsRef.js` | `TipsRef.csv` |
| `update-yield-history.yml` | Weekdays 11am PT | `YieldsMonitor/scripts/snapHistory.js` | `yield-history/` |

---

## 3.0 R2 Data Store
All jobs above upload their results to the central Cloudflare R2 bucket.
- **Reference**: See [DataStores.md](./DataStores.md) for the full file manifest and live previews.

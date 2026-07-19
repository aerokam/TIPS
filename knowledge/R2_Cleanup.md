# R2 Bucket Cleanup Audit

Audit run 2026-04-30. Cleanup executed 2026-05-21.

**Background:** Gradual migration from `TIPS/` → `Treasuries/` prefix left many scripts writing to both locations; only one location was read. Cleanup completed — orphan writes patched, dead objects deleted via `scripts/r2-cleanup.js`.

---

## Confirmed Active — Keep

| Prefix | Files |
|--------|-------|
| `TIPS/` | `RefCPI.csv`, `TipsRef.csv`, `RefCpiNsaSa.csv`, `tentative_tips.json`, `Tentative-Auction-Schedule.xml`, `YieldsSaSao.csv` |
| `Treasuries/` | `YieldsFromFedInvestPrices.csv`, `Auctions.csv`, `FidelityTreasuriesTips.csv`, `yield-history/*.json` (14 files) |
| `bls/` | `CPI.csv`, `CPI_history.csv`, `CpiReleaseSchedule2025.csv`, `CpiReleaseSchedule2026.csv` |
| `misc/` | `BondHolidaysSifma.csv` |
| `schwab/` | `SchwabHoldings-SCHP.csv` (written by external ScrapeSchwabHoldings project) |

### Key dependencies:
- `TIPS/TipsRef.csv` — used by `scripts/getYieldsFedInvest.js` (script input) and TipsLadderManager browser app
- `TIPS/RefCPI.csv` — used by TipsLadderManager and CpiExplorer

---

## Cleanup Applied (2026-05-21)

### Script patches — orphan writes removed

| Script | Change |
|--------|--------|
| `scripts/fetchRefCpi.js` | Removed upload to `Treasuries/RefCPI.csv` |
| `scripts/getAuctions.js` | Removed upload to `TIPS/Auctions.csv` |
| `scripts/getYieldsFedInvest.js` | Removed upload to `TIPS/YieldsFromFedInvestPrices.csv` |
| `YieldsMonitor/scripts/snapHistory.js` | Removed `r2KeyOld` variable and `TIPS/yield-history/` upload |
| `YieldCurves/scripts/updateSaSaoYields.js` | Removed upload to `TIPS/YieldsSaSao.csv` — **REVERTED 2026-06-01, see correction below** |
| `scripts/fetchTipsRef.js` | Removed upload to `Treasuries/TipsRef.csv` |
| `TipsLadderManager/src/data.js` | Changed TipsRef.csv fetch from `Treasuries/` to `TIPS/` |

### R2 objects deleted (30 objects via `scripts/r2-cleanup.js`)

**Orphan writes (were written every pipeline run, never read):**
- `Treasuries/RefCPI.csv`
- `TIPS/Auctions.csv`
- `TIPS/YieldsFromFedInvestPrices.csv`
- `TIPS/YieldsSaSao.csv` — **misclassified; see correction below**
- `TIPS/yield-history/*_history.json` (14 files)

**Stale legacy (no current reader or writer):**
- `TIPS/Yields.csv` (old filename, last written 2026-04-03)
- `TIPS/TipsYields.csv` (2026-03-24)
- `Treasuries/TipsYields.csv` (2026-03-25)
- `Treasuries/RefCpiNsaSa.csv` (migration artifact — canonical is `TIPS/RefCpiNsaSa.csv`)

**Audit clarification items:**
- `misc/TIPS_SAO.csv` — no code references, deleted
- `misc/BondMarketHolidays.csv` — old pre-SIFMA file, only referenced in external Bogleheads spreadsheet, deleted
- `bls/CpiReleaseSchedule2024.csv` — year expired, deleted

**TipsRef consolidation:**
- `Treasuries/TipsRef.csv` — consolidated to `TIPS/TipsRef.csv`; browser app updated accordingly

---

## Correction (2026-06-01)

`TIPS/YieldsSaSao.csv` was **wrongly classified as an orphan** above. It is read by no
*app*, but it is a deliberate **public resource** — published so people can pull market
SA/SAO TIPS yields into their own spreadsheets. The upload in
`YieldCurves/scripts/updateSaSaoYields.js` has been restored and the file is written
to `TIPS/YieldsSaSao.csv` on every Fidelity broker-quote run. Do not remove it.

Separately, that run was logging `Exited with code 1` even on success: the script wrote
its progress via `console.error`, and `run-fidelity.cmd`'s `2>&1` pipe makes PowerShell 5.1
wrap any native stderr as a `NativeCommandError` and flip the exit code. Progress logging
was moved to `console.log` (stdout); `console.error` + `exit(1)` is now reserved for real
failures only.

---

## Correction (2026-07-19)

`fidelityDownload.js` was changed (~2026-06-23) to download one combined
`FidelityTreasuriesTips.csv` (Treasury + TIPS rows in a single export, split by a
`Product` column) instead of two separate files, and `uploadFidelityDownload.js` was
updated to upload only the combined file to `Treasuries/FidelityTreasuriesTips.csv`.
The old R2 keys `Treasuries/FidelityTreasuries.csv` and `Treasuries/FidelityTips.csv`
stopped being written at that point, but several consumers kept reading them directly
and were never repointed at the combined file:

- **Admin Dashboard** (`Dashboard/server.js`, `Dashboard/index.html`) — two pipeline
  rows/nodes (`broker-nominals`/`S7a`, `broker-tips`/`S7b`) monitored the dead keys, so
  the dashboard silently showed ~1-month-stale data instead of flagging staleness (the
  keys still existed in R2 from before the cutover, just frozen). Consolidated to one
  `broker-quotes`/`S7` pipeline pointing at `Treasuries/FidelityTreasuriesTips.csv`.
- **FundHoldings** (`FundHoldings/enrichHoldings.js`) — fetched
  `Treasuries/FidelityTreasuries.csv` directly for nominal Ask Yield/Coupon enrichment,
  so nominal fund holdings (e.g. VBIL) were enriched from a frozen June 23 snapshot for
  about a month. Repointed at the combined file, filtering to non-TIPS rows by `Product`.

`YieldCurves/src/app.js` itself was already reading the combined file correctly — it was
not affected.

**Old keys to delete** (superseded, no longer written by any script):
- `Treasuries/FidelityTreasuries.csv`
- `Treasuries/FidelityTips.csv`

See [DataStores.md#s7](./DataStores.md#s7) and [DATA_DICTIONARY.md#s7](./DATA_DICTIONARY.md#s7) for the current combined-file schema.

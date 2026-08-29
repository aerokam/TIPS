# TipsLadderManager Technical Reference

This document maps conceptual definitions from the [Master Glossary](../../knowledge/DATA_DICTIONARY.md) to specific implementation variables and constants within the TipsLadderManager project.

---

## Technical Constants

| Spec Constant | Variable Name | Value / Purpose |
|---|---|---|
| REFCPI_CUSIP | `REFCPI_CUSIP` | `912810FD5` (used for fetching daily RefCPI) |
| MIN_BRACKET_YEAR | `LOWEST_LOWER_BRACKET_YEAR` | `2032` (defines the search range for the lower bracket) |
| MAX_LAST_YEAR | `MAX_LAST_YEAR` | `2066` (UI upper bound for lastYear; years 2057–2066 are Future 30Y Rungs covered by 2056 bracket) |

---

## Variable Mapping: Core Calculations

| Concept ID | Code Symbol (rebalance-lib.js) | Code Symbol (build-lib.js) |
|---|---|---|
| [Index Ratio](../../knowledge/DATA_DICTIONARY.md#index-ratio) | `d.indexRatio` | `d.indexRatio` |
| [Inflation-Adjusted Principal](../../knowledge/DATA_DICTIONARY.md#inflation-adjusted-principal) | `d.principalPerBond` | `d.principalPerBond` |
| [Cost per TIPS](../../knowledge/DATA_DICTIONARY.md#cost-per-tips) | `d.costPerBond` | `d.costPerBond` |
| [P+I per TIPS](../../knowledge/DATA_DICTIONARY.md#pi-per-tips) | `d.piPerBond` | `d.fundedYearPi` |
| [DARA](../../knowledge/DATA_DICTIONARY.md#dara) | `d.DARA` | `summary.dara` |
| [ARA](../../knowledge/DATA_DICTIONARY.md#ara) | `d.araAfterTotal` | `d.fundedYearAmt` |
| [LMI](../../knowledge/DATA_DICTIONARY.md#lmi) | `d.araAfterLaterMatInt` | `d.laterMatInt` |

---

## Quantity Tracking

| Concept ID | Code Symbol (rebalance-lib.js) | Code Symbol (build-lib.js) |
|---|---|---|
| [Quantity](../../knowledge/DATA_DICTIONARY.md#quantity) (Current) | `d.qtyBefore` | N/A |
| [Quantity](../../knowledge/DATA_DICTIONARY.md#quantity) (Target) | `d.qtyAfter` | `d.fundedYearQty + d.excessQty` |
| Funded Year Qty | `d.fyQty` | `d.fundedYearQty` |
| Excess Qty | `d.excessQtyAfter` | `d.excessQty` |

---

## Missing-Block Coverage & Ladder Bounds

Concepts from 2.0 §Duration Matching and §Gap/Future-30Y, bound to code symbols. A *missing block* is a
stretch of years whose TIPS have not yet been issued; each is duration-covered by a *pair* of real TIPS.

| Concept | Code Symbol | Notes |
|---|---|---|
| First / Last Funded Year (ladder endpoints) | `firstYear` / `lastYear` | endpoints of the ladder, not bracket years |
| Gap lower bracket / upper bracket (gap **bracket pair**) | `lowerYear`/`lowerCUSIP`, `upperYear`/`upperCUSIP` | most recently issued 10-year TIPS below the gap / 2040 |
| Future-30Y lower cover / upper cover (Future-30Y **cover pair**) | `future30yLowerCoverBond` (2056) / `future30yUpperCoverBond` (2052) | longest actual TIPS / longest duration excl. 2056 |
| Imported excess (cover/bracket excess from the file's excess column) | `h.excessQty` (Format 4/5 import) | a calculated field, only ever written by this app's export; records build intent, not user-edited |
| First-funded-year recovery (reverse-engineer gap duration match) | `inferFirstYearFromHoldings` | gap side may use the excess→DARA ratio shortcut |
| Last-funded-year recovery (reverse-engineer Future-30Y duration match) | `inferLastYearFromHoldings` | matches the imported cover split; user-overridable |
| Upper-bracket coupon feedback (gap fixpoint) | `gapParamsWithUpperFeedback` | shared by build + rebalance; see 2.0 §Gap Year Coverage Model |

---

## Project-Specific Details

### Settlement Date
In this project, the settlement date is determined by `walkBackFromToday(fedinvestData)`. It is typically T+1 or the most recent available price date.

### Annual Real Amount (ARA) Components
For drill-down purposes, the code splits ARA into components:
- `d.araAfterPrincipal`: (Quantity * Adjusted Principal)
- `d.araAfterOwnCoupon`: (Quantity * Semi-annual interest * nPayments)
- `d.araAfterLaterMatInt`: Sum of LMI from already-processed rungs.

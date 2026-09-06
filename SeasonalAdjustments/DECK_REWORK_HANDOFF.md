# SeasonalAdjustments deck rework — handoff

Working notes for the session continuing this. Delete this file when the rework
is done and the spec is updated. Not a spec.

## Where things are

- **Branch/checkout:** all work is on `main` in the primary checkout
  `C:/Users/aerok/projects/Treasuries`. Not pushed (main is ahead of origin —
  pushing is the user's call). No worktrees. Coordination policy (CLAUDE.md
  `d46f93e`): all work on main in the primary checkout, small commits, work
  around other sessions' uncommitted changes.
- **Serve:** persistent dev server on `localhost:8080` = primary checkout = main.
  Always running in the user's own terminal. **Never start / kill / restart it.**
- **No build step.** ES modules served statically. Frozen data snapshot in
  `SeasonalAdjustments/data/*.snapshot.csv` — no runtime R2 dependency.
- **Screenshots:** `C:/Users/aerok/projects/Treasuries/sa-shot.mjs` (playwright,
  gitignored via `.git/info/exclude`).
  `node sa-shot.mjs <slideIndex 0-6> [viewportWidth]` → `sa-shot.png`;
  `node sa-shot.mjs all` → `sa-shot-1..7.png`. Needs 8080 up.
- **No e2e** exists for this deck.

## Files

| File | Role |
|---|---|
| `SeasonalAdjustments/index.html` | shell + `PAGES` registry (7 entries) |
| `SeasonalAdjustments/src/snap-data.js` | data layer: `loadSnapshot()`, `SNAP` (`bonds`, `wave`, `refRows`), `Sat()`, `BLS_SEASONAL_FACTOR`, `buildWave()`, date helpers |
| `SeasonalAdjustments/src/snap-slides.js` | `drawS1`..`drawS7`, one per slide (`drawSN` == slide N) |
| `SeasonalAdjustments/src/sa-annotate.js` | SVG annotation helpers: `note`, `callout`, `vBracket`, `ring`, `arrow`, palette |

## The 7 slides now

| # | fn | title | status |
|---|-----|-------|--------|
| 1 | `drawS1` | The Sawtooth | approved |
| 2 | `drawS2` | The Seasonal Factor | **just reworked (commit `7806be6`); awaiting user's next look** |
| 3 | `drawS3` | Why the Month Matters | content approved earlier (as old slide 2); unchanged, renumbered |
| 4 | `drawS4` | The Extra Months | first pass only, not re-reviewed |
| 5 | `drawS5` | Trend × Seasonal | first pass only, not re-reviewed |
| 6 | `drawS6` | From Payments to One Ratio | first pass only, not re-reviewed |
| 7 | `drawS7` | Near and Far | first pass only, not re-reviewed |

**User is reviewing slide by slide from the top. Slides 4–7 are NOT approved and
will likely change. User said: "I'm not commenting on anything after slide 2 at
this point."**

## NEXT TASK — insert a new slide 3 (user's explicit plan)

Between current slide 2 and current slide 3:

- **New slide 3:** the same view as slide 2 (years 2021–2025 on x, seasonal
  factor on y, one line per calendar month) **plus the Ref CPI seasonal factor
  layered on** for the same 5 years. Purpose: show the Ref CPI factor is the CPI
  factor **shifted by the 3-month indexation lag** — e.g. the CPI July peak shows
  up as the Ref CPI October value. "shows both cpi and ref cpi cycles over 5 years."
- On that slide, note: since TIPS use the Ref CPI for inflation adjustments, the
  deck uses the Ref CPI from here on.
- It transitions into the current "Why the Month Matters" slide, which becomes
  **slide 4**. So renumber again: `drawS3`→`drawS4` … `drawS7`→`drawS8`, new
  slide is `drawS3`.
- Data for the Ref CPI factor: `SNAP.refRows` (daily NSA/SA/factor from
  `RefCpiNsaSa.snapshot.csv`). Take one day per month (15th) per year 2021–2025.
  The lag means Ref-CPI-month-M factor ≈ CPI-month-(M−3) factor.

## Established facts / decisions

### Pipeline (the "how the data is made" story)
- `YieldCurves/scripts/updateRefCpi.js` (daily 6:35am, "SA Factor Update" task)
  runs `fetchCpiBls.js` → `calcRefCpi.js` → `updateSaSaoYields.js`.
- `fetchCpiBls.js`: BLS Public Data API v2, monthly, series `CUUR0000SA0` (NSA) +
  `CUSR0000SA0` (SA), 2019→present → `bls/CPI.csv`.
- `calcRefCpi.js`: applies 31 CFR Part 356 App. B (3-month lag, daily linear
  interpolation — `shared/src/ref-cpi.js#refCpiFromMonthly`) to **both** monthly
  series → daily Ref CPI NSA, daily Ref CPI SA, `SA Factor = NSA / SA` →
  `TIPS/RefCpiNsaSa.csv` (DataStores S4).
- Separately, `scripts/fetchRefCpi.js` pulls the **official** daily Ref CPI (NSA
  only) from TreasuryDirect → `TIPS/RefCPI.csv`, used to cross-check the
  calculated NSA.
- There is **no official or third-party daily SA Ref CPI** — we construct it.
  "Available from several sources" applies only to the **monthly** SA CPI (BLS
  API, FRED `CPIAUCSL`, the annual revised-seasonal-indexes XLSX).
- The ingestion spec (`knowledge/Data_Pipeline.md`,
  `YieldCurves/knowledge/1.0_Seasonal_Adjustments.md`) is being refined by the
  user in a separate session — **do not fix it here.**

### BLS seasonal factor — verified 2026-09-05
Our monthly CPI NSA/SA (`bls/CPI.csv`, from the BLS API) reproduces BLS's
published **SEASONAL FACTOR** (revised-seasonal-indexes XLSX, `CUSR0000SA0`) to
3 dp for all 59 published months 2021–2025. NSA and SA match BLS's UNADJUSTED /
SEASONALLY ADJUSTED INDEX exactly. Max raw diff 0.00048, from BLS rounding its SA
index to 3 dp. **No bug.** Data hardcoded verbatim as `BLS_SEASONAL_FACTOR` in
`snap-data.js` (the XLSX is bot-blocked by BLS Akamai; the user pasted it).

### BLS revised seasonal factors are an ANNUAL publication
Released with the January CPI, covering the prior five years (X-13ARIMA-SEATS).
The monthly NSA/SA CPI release is a separate thing — do not conflate them.
Three data types in the file, names verbatim: `UNADJUSTED INDEX`,
`SEASONALLY ADJUSTED INDEX`, `SEASONAL FACTOR`
(= UNADJUSTED INDEX / SEASONALLY ADJUSTED INDEX, ×100).

### Oct 2025 patch — FLAGGED to user, may address separately
`fetchCpiBls.js` has a hardcoded patch: `2025-M10` NSA `325.604`, SA `325.551`,
because BLS published no CPI that month. This feeds the daily factors. Slide 2
shows Oct 2025 as a gap (matching BLS).

### The wave (`buildWave` in snap-data.js)
As of commit `cc5decf`: uses the **most recent COMPLETE calendar year** in the
snapshot (2025) for all 365 days — one seam-free annual cycle. This diverged
deliberately from commit `3eacb3d` (another session) which used "most recent year
per mm-dd" and left a visible seam at Oct 1 (snapshot ends 2026-10-01). User was
told; not objected.

### Slide 4–7 numbers
Computed from the wave via `priceFromYield`/`yieldFromPrice`
(`shared/src/bond-math.js`), NOT from the snapshot's `sa_yield` column, for
internal consistency with the wave shown on slides 3–5. FAR (1.25% Apr-2028)
−41 bp, NEAR (2.375% Oct-2028) −5 bp — these also match the frozen vendor
`sa_yield` closely.

## Recurring user feedback — apply to ALL text work

- **No metaphoric language, period.** Not just idioms — any figurative verb or
  noun. Killed this rework: "carries", "runs", "sits", "distorts", "put through".
  State the literal operation/relation. "peak", "trough", "cycle" (periodicity),
  "interpolate", "derive" are literal and fine.
- **State facts plainly; do not massage language to your style.** No invented
  phrasing, titles, or framing. Use the user's words and the sources' words.
- **No possessives on security types** ("TIPS's", "a Note's"). Reword around.
- **Never name the data vendor** ("Fidelity") in user-visible copy — "market
  prices" / "market yields".
- **BLS / spec term names verbatim.**
- **`note()` SVG captions do not wrap** — a line wider than the 900-unit viewBox
  clips on a narrow window. Keep each caption line short; verify at ~920–960px.
- **Verify every claim in a passage, not just the flagged one.**

## Canonical references

- `YieldCurves/knowledge/Canty.md` — SA math. Eq. 14: `SACP ≈ CP × S_settle /
  S_maturity`. §1b motivating example (the "extra months"), §2 decomposition
  (`I = T·S`), §3 derivation.
- `YieldCurves/knowledge/1.0_Seasonal_Adjustments.md` — canonical SA transform.
- `knowledge/DATA_DICTIONARY.md` — SA Factor, SA Price Factor, SACP, SA Yield,
  Clean Price, Index Ratio, CPI-U NSA/SA (all reviewed/edited this rework).
- `SeasonalAdjustments/knowledge/1.0_SeasonalAdjustments_Explorer.md` — **STALE**:
  describes the old 12-page deck. Rewrite to match once the deck stabilises.

## Commits this rework (all on main, not pushed)

```
2049df9  DD terminology: SA Factor, SA Price Factor, CPI FRED aliases
e114a5f  slide 2: drop "TIPS's" possessive
4fe8607  slide 2: literal wording, SA Ref CPI is ours
8fee419  slide 2: remove metaphors + caption viewBox fix
815c73b  3 new slides (Extra Months, Trend×Seasonal, Payments→Ratio) + rework Near&Far
cc5decf  wave = most recent COMPLETE year
70bc6fb  slides layout + wording (old numbering 3/4/6)
1438db7  new slide 2 "The Seasonal Factor" + renumber drawS2-6 → drawS3-7 + BLS_SEASONAL_FACTOR
7806be6  slide 2: years on x-axis, one line per month, caption fixed (annual not monthly)
```

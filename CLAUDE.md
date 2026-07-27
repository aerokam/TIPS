# CLAUDE.md - Treasuries Project

## Commands (TipsLadderManager)

```bash
# Unit/algorithm tests
npm test

# E2E regression tests (run after every change)
npm run test:e2e          # headless, ~7s
npx playwright test --headed   # headed (debug)

# Serve locally (no build step required)
npx serve .
```

## Architecture (TipsLadderManager)

**No build step.** Pure ES modules served statically via GitHub Pages. Data fetched from Cloudflare R2 at runtime.

### Module Roles

| Module | Role |
|--------|------|
| `src/bond-math.js` | Pure per-bond math: `bondCalcs()`, `calculateMDuration()`, `rungAmount()` |
| `src/gap-math.js` | Gap/bracket math: `calcGapParams()`, `bracketWeights()`, `bracketExcessQtys()`, yield interpolation |
| `src/ladder-math.js` | Sweep helpers: `fyQty()`, `laterMatIntContribution()` |
| `src/rebalance-lib.js` | Rebalance orchestrator — calls the above, no raw formulas |
| `src/build-lib.js` | Build-from-scratch orchestrator — same constraint |
| `src/render.js` | Table HTML from unified `COLS` schema |
| `src/drill.js` | Popup builder: `buildDrillHTML(d, colKey, summary, mode)` |
| `src/data.js` | CSV fetch/parse from R2 |
| `index.html` | Thin shell: event wiring, calls render/drill, zero business logic |

### Key Algorithms

**Phase 4 Ladder Rebuild** (rebalance): single longest-to-shortest sweep over ALL years including brackets. Maintains `rebuildLaterMatInt` running pool. Phase 3 only produces weights; Phase 4 does all computation.

**Retained Bracket Excess** (rebalance): lower-side excess in maturities older than the *active lower bracket* (the latest-maturing ladder-eligible TIPS below `minGapYear` — **not** "the latest January"). Never increased; sold **oldest maturity first**, and only when the lower side is over-allocated. Any number of generations may accumulate — do NOT name this by a bracket count. Spec: 2.0 §Retained Bracket Excess.

**Full Rebalance**: `inferDARAFromCash()` binary-searches DARA until `costDeltaSum ≈ 0`.

### COLS Schema

`render.js` drives table output via a single `COLS` array. Each entry defines: header label, cell value function, sub-row value, totals, drill colKey, and `rebalOnly` flag. After/Before cols in Rebalance = same math as Build cols + `rebalOnly: true`.

### Data Infrastructure

- **R2 bucket**: `https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/` — files: `Treasuries/YieldsFromFedInvestPrices.csv`, `TIPS/RefCPI.csv`, `TIPS/TipsRef.csv`
- **Scheduled updates**: Windows Task Scheduler (local)

## Architecture (YieldCurves)

**No build step.** Pure ES modules served statically via GitHub Pages.

### Commands

```bash
npm run test:e2e          # E2E regression tests (headless, ~14s)
npx playwright test --headed   # headed debug
npx serve .               # Serve locally (run from root of Treasuries repo)
```

### Data Infrastructure (R2)

| R2 Key | Updated by | Task |
|--------|-----------|------|
| `Treasuries/YieldsFromFedInvestPrices.csv` | `scripts/run-fedinvest.cmd` | `YieldsFromFedInvestPrices` |
| `Treasuries/FidelityTreasuriesTips.csv` | `scripts/run-fidelity.cmd` | `FidelityQuotes` (3× weekdays) |
| `TIPS/RefCpiNsaSa.csv` | shared with TipsLadderManager | — |
| `TIPS/YieldsSaSao.csv` | `scripts/updateSaSaoYields.js` | triggered by `FidelityQuotes` |
| `misc/BondHolidaysSifma.csv` | shared | — |

`FidelityTreasuriesTips.csv` is a **combined file** — Treasury and TIPS rows in one CSV, distinguished by the `Product` column (`Treasury` / `TIPS`). Parsers split them by product; do **not** expect two separate Fidelity files.

### Fidelity Download Flow

Playwright + real Chrome via CDP (`fidelityDownload.js`):
1. Navigate to `https://digital.fidelity.com/ftgw/digital/finewexp/secondaries`
2. **Product type** → check **Treasury** + **TIPS** → **Apply**
3. Three-dot menu → **Download Offerings** (browser download intercepted by Playwright)
4. Saved to `~/Downloads/FidelityTreasuriesTips.csv` → uploaded to R2
5. Upload triggers `updateSaSaoYields.js` → refreshes `TIPS/YieldsSaSao.csv`

### Naming Conventions

- `fundedYear` (not `fy`) everywhere: `d.fundedYear`, `fundedYearQty`, `fundedYearAmt`, `fundedYearCost`; column header "Funded Year"
- `runBuild` (not `runBuildFromScratch`), `renderBuildOutput`, `buildSummary`, `buildDetails`, `build-table`

### Terminology

| Use this | Not this | Why |
|---|---|---|
| **TIPS** | bond, note, security | TIPS is a distinct Treasury category |
| **actual TIPS** | real bond, real TIPS | "real" means inflation-adjusted |
| **funded year** | real year, actual year | A funded year is a ladder rung |
| **bracket year** | — | A funded year that also holds excess TIPS for duration matching gap years |
| **gap year** | — | A calendar year with no TIPS issuance (currently 2037–2039) |
| **synthetic TIPS** | synthetic bond | Hypothetical TIPS for gap years — never purchased |
| **LMI** | — | Later Maturity Interest — annual coupon from ALL TIPS maturing after the funded year |
| **retained bracket excess** | 3-bracket, orig lower, "retain brackets" | Excess in a lower-bracket maturity older than the active one. Never name it by a bracket count — the count grows as TIPS are issued. It's the *excess* that's retained, not the holding |
| **active lower bracket** | new lower, canonical lower, Jan 2036 | The latest-maturing ladder-eligible TIPS below the first gap year — the only lower-side maturity a rebalance buys. A rule, not a fixed month or CUSIP |

### Windows / Tooling Note

The Edit tool may fail with `EEXIST` on project files (Windows path bug). Use node scripts via Bash to patch files when Edit fails.

**Never edit text files via PowerShell `Get-Content`/`Set-Content`/`Out-File`.** Windows PowerShell's `Get-Content` falls back to the system codepage (Windows-1252) when a file has no BOM, silently mis-decoding UTF-8 multi-byte characters (em dashes, smart quotes, arrows, non-breaking hyphens); writing the result back with `-Encoding UTF8` then bakes that corruption in as real Unicode text and adds a BOM. This exact bug corrupted `index.html` in commit `342e673`. If Edit fails and a script is truly needed, use Node (`fs.readFileSync(path, 'utf8')` / `fs.writeFileSync(path, text)`, both implicitly UTF-8, no BOM) instead. A pre-commit hook (`.githooks/pre-commit` → `scripts/check-encoding.js`, wired via `git config core.hooksPath .githooks`) now blocks commits containing this mojibake pattern or a stray BOM as a backstop.

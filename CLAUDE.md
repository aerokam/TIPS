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

**3-Bracket Mode**: "orig lower + new lower + upper" where new lower = `anchorBefore` (latest 10y TIPS with Jan maturity at minGapYear−1). Weights: w1 fixed (orig lower never sold/bought), w2/w3 duration-matched.

**Full Rebalance**: `inferDARAFromCash()` binary-searches DARA until `costDeltaSum ≈ 0`.

### COLS Schema

`render.js` drives table output via a single `COLS` array. Each entry defines: header label, cell value function, sub-row value, totals, drill colKey, and `rebalOnly` flag. After/Before cols in Rebalance = same math as Build cols + `rebalOnly: true`.

### Data Infrastructure

- **R2 bucket**: `https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/` — files: `YieldsFromFedInvestPrices.csv`, `RefCPI.csv`, `TipsRef.csv`
- **GitHub Actions**: daily yield fetch (`get-tips-yields.yml`), monthly CPI fetch (`fetch-ref-cpi.yml`)

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

### Windows / Tooling Note

The Edit tool may fail with `EEXIST` on project files (Windows path bug). Use node scripts via Bash to patch files when Edit fails.

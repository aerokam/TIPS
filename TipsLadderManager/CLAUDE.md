# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Unit/algorithm tests
npm test

# E2E regression tests (run after every change)
npm run test:e2e          # headless, ~7s
npx playwright test --headed   # headed (debug)

# Serve locally (no build step required)
npx serve .
# Local test server already running on port 8080
```

## Architecture

**No build step.** Pure ES modules served statically via GitHub Pages. Data fetched from Cloudflare R2 at runtime.

### Module Roles

| Module | Role |
|--------|------|
| `src/bond-math.js` | Pure per-bond math: `bondCalcs()`, `calculateMDuration()`, `rungAmount()` |
| `src/gap-math.js` | Gap/bracket math: `calcGapParams()`, `bracketWeights()`, `bracketExcessQtys()`, yield interpolation |
| `src/ladder-math.js` | Sweep helpers: `fyQty()`, `laterMatIntContribution()` |
| `src/rebalance-lib.js` | Rebalance orchestrator — calls the above, no raw formulas |
| `src/build-lib.js` | Build-from-scratch orchestrator — same constraint |
| `src/render.js` | Table HTML from unified `COLS` schema (183L) |
| `src/drill.js` | Popup builder: `buildDrillHTML(d, colKey, summary, mode)` |
| `src/data.js` | CSV fetch/parse from R2 |
| `index.html` | Thin shell: event wiring, calls render/drill, zero business logic |

### Spec-First Protocol (hard rule)

**Knowledge docs are the source of truth for algorithm intent.** Any algorithm change updates the spec BEFORE or WITH the code, never after.

| Doc | Governs |
|-----|---------|
| `knowledge/3.0_TIPS_Ladder_Rebalancing.md` | Core rebalance algorithm, all named quantities, formulas, variable mapping |
| `knowledge/4.0_Computation_Modules.md` | Module APIs (bond-math, gap-math, ladder-math) |
| `knowledge/5.0_UI_Schema.md` | COLS schema, table structure, drill popup routing |
| `../knowledge/TIPS_Basics.md` | costPerBond, piPerBond, indexRatio, adjustedPrincipal |

**Documentation Parity**: Whenever core logic, UI fields, or default behaviors are changed:
- `README.md` must be updated to reflect new capabilities.
- `index.html` Help Modal (`#help-overlay`) must be updated to ensure in-app help is accurate.

Before touching any displayed value: read the relevant knowledge doc first.

### Key Algorithms

**Phase 4 Ladder Rebuild** (rebalance): single longest-to-shortest sweep over ALL years including brackets. Maintains `rebuildLaterMatInt` running pool. Phase 3 only produces weights; Phase 4 does all computation.

**3-Bracket Mode**: "orig lower + new lower + upper" where new lower = `anchorBefore` (latest 10y TIPS with Jan maturity at minGapYear−1). Weights: w1 fixed (orig lower never sold/bought), w2/w3 duration-matched.

**Full Rebalance**: `inferDARAFromCash()` binary-searches DARA until `costDeltaSum ≈ 0`.

### COLS Schema

`render.js` drives table output via a single `COLS` array. Each entry defines: header label, cell value function, sub-row value, totals, drill colKey, and `rebalOnly` flag. After/Before cols in Rebalance = same math as Build cols + `rebalOnly: true`.

### Data Infrastructure

- **R2 bucket**: `https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/` — files: `YieldsDerivedFromFedInvestPrices.csv`, `RefCPI.csv`, `TipsRef.csv`
- **GitHub Actions**: daily yield fetch (`get-tips-yields.yml`), monthly CPI fetch (`fetch-ref-cpi.yml`)
- **DST note**: After Mar 8 2026, change `0 18` → `0 17` in `get-tips-yields.yml`

### Naming Conventions

- `fundedYear` (not `fy`) everywhere: `d.fundedYear`, `fundedYearQty`, `fundedYearAmt`, `fundedYearCost`; column header "Funded Year"
- `runBuild` (not `runBuildFromScratch`), `renderBuildOutput`, `buildSummary`, `buildDetails`, `build-table`

### Windows / Tooling Note

The Edit tool may fail with `EEXIST` on project files (Windows path bug). Use node scripts via Bash to patch files when Edit fails.

# TIPS Ladder Builder — Project Vision

## Purpose

A web-based tool for building and rebalancing TIPS (Treasury Inflation-Protected Securities) ladders. Designed to be both practically useful for investment decisions and **educational** — every number on screen should be explainable down to first principles.

---

## Current State (as of early 2026)

Both core modes are shipped and operational:

- **Build**: Given a DARA and time horizon, constructs a fresh TIPS ladder with duration-matching excess for gap years
- **Rebalance**: Given current holdings, computes trades needed to realign the ladder — either gap-only (fill newly-available maturities from bracket proceeds) or full (rebuild from current portfolio cash at inferred DARA)

The UI provides:
- Main table: CUSIP/Maturity/FY rows with bracket rows split into FY portion (main row) + Gap portion (sub-row)
- Drill-down popups on key cells showing the full calculation chain
- Parameters bar and net cash/market value callout
- Frozen headers and totals row

---

## Design Principles

### 1. Educational over opaque
Every displayed value should be traceable: popup → formula → spec doc. The tool should teach the math, not just show results. A user who clicks through every popup should understand TIPS ladder construction from first principles.

### 2. Spec-first development
The knowledge MD files are the source of truth. Code implements the spec; the spec is not inferred from code. Any calculation question is answered from the spec first, then verified in code.

### 3. Build and Rebalance share a common mathematical foundation
They are the same algorithm — both do a longest-to-shortest ladder sweep, both use duration-matching to size bracket excess, both use the same cost/P+I formulas. The difference is only in the "before state": Rebalance has one (current holdings), Build does not. The codebase should reflect this shared foundation rather than treating them as separate implementations.

### 4. Transparency via progressive disclosure
- Main table: clean, user-facing values
- Popup (one click): full calculation chain for any cell
- Future: deeper drill-down into sub-components (e.g., duration derivation, yield interpolation, CPI lookup)

---

## Long-Term UX Vision

The ideal UX is a layered drill-down:

1. **Summary view**: Total portfolio value, net cash impact, ARA vs DARA gap
2. **Ladder table**: Per-rung view with FY/Gap split for bracket years
3. **Cell popup**: Full calculation chain for any value (current)
4. **Deep drill**: Sub-popups for components — e.g., click "Later Maturity Interest" in an ARA popup to see the running pool breakdown; click a duration to see the yield curve and interpolation
5. **Weight rationale**: Visual showing gap year duration and how brackets bracket it

This positions the tool as educational infrastructure for understanding TIPS ladders, not just a trade calculator.

---

## Completed Refactor (March 2026)

The following architectural improvements have been implemented to stabilize the codebase:

1. **Modularization**: JS moved from `index.html` to `src/` modules (`render.js`, `drill.js`, `data.js`, etc.).
2. **Unified Rendering**: Single `buildDrillHTML` and `COLS` schema serving both Build and Rebalance modes.
3. **Variable Harmonization**: Consistent naming (`fyQty`, `costPerBond`) across `build-lib` and `rebalance-lib`.
4. **Shared Math**: Gap/bracket logic extracted to `src/gap-math.js`.
5. **Data Pipeline**: Backend scripts moved to `scripts/` and integrated with Cloudflare R2 via GitHub Actions.
6. **Testing**: Robust E2E and regression suite in `tests/` with static fixtures.

---

## Knowledge Architecture

The `knowledge/` directory is the spec layer:

- **1.0** Bond Basics → **2.0** Bond Ladders → **2.1** TIPS Basics → **3.0** TIPS Ladders / **3.1** Data Pipeline → **4.0** TIPS Ladder Rebalancing
- Each file inherits from dependencies; formulas are additive up the chain
- **4.0** is the primary reference: contains all named quantities, formulas, code variable mapping, and algorithm phases
- When adding a new displayed value: spec it in the appropriate knowledge file first, then implement

The traceability chain for any popup value:
```
UI display → popup formula → spec section (4.0 Named Quantities or Phase formulas) → code variable (4.0 Code Variable Mapping) → implementation
```

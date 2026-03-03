# TIPS Ladder Rebalancer - Development Roadmap

This document outlines a phased approach to evolving this tool from its current specialized rebalancing engine into a robust, comprehensive TIPS ladder builder.

## Core Philosophical Goal
The tool should provide a "No-Build" experience (run directly in a browser from a folder) while maintaining the mathematical rigor of professional fixed-income software.

---

### Phase 1: Foundation & Reliability (Current Focus)
*Goal: Eliminate logic duplication and ensure correctness.*

- **Shared Logic:** Consolidate the calculation engine into a single file (`rebalance-engine.js`) imported by both the CLI (`rebalance.js`) and the Web UI (`rebalance-lib.js`).
- **Type Safety via JSDoc:** Use `// @ts-check` and `@typedef` for core types (`Bond`, `Holding`, `RebalanceResult`). 
    - *Why?* This provides TypeScript-level safety (autocompletion, error checking) without requiring a build step or changing file extensions.
- **Automated Testing:** Implement a `/tests` suite to verify `yieldFromPrice` and `calculateMDuration` against known Treasury benchmarks.
- **Robust CSV Parsing:** Move away from basic `split('
')` to a more resilient parser.

### Phase 2: Functional Completeness (Version 2 & 3)
*Goal: Implement the "Reinvestment" and "Full Rebuild" algorithms.*

- **V2 (Reinvestment):** Take proceeds from bracket sales and reinvest into newly-available gap years.
- **V3 (Full Rebuild):** Calculate an "Ideal Ladder" from scratch and compare it to current holdings to generate buy/sell orders.

### Phase 3: Scope Expansion (New Investor Support)
*Goal: Enable building new ladders from cash.*

- **"Cash" as a Holding:** Treat cash positions as a source of funds for the rebalancer.
- **Build Wizard:** Add a "New Build" mode for users starting with $0 in TIPS.

### Phase 4: UX & Retention
*Goal: Professional polish and persistence.*

- **Persistence:** Use `localStorage` to save user parameters and holdings across sessions.
- **Exporting:** Allow users to download their rebalance plan as a CSV/PDF for their brokerage.

---

## Technical Recommendation: The Case for TypeScript

While we are starting with JSDoc to maintain a "No-Build" environment, we should consider a full migration to TypeScript if the codebase exceeds 5,000 lines. 

**Benefits for this project:**
1. **Mathematical Integrity:** TS prevents "silent failures" (e.g., adding a string to a number) which are catastrophic in financial software.
2. **Domain Modeling:** Interfaces for `TIPS_Bond` and `Rebalance_Result` act as living documentation for complex domain logic.
3. **Refactoring Safety:** Safely changing data structures as we move toward "Full Rebuild" mode.

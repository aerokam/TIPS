# GEMINI.md - TipsLadderManager Context

## Project Overview
TipsLadderManager is a browser-based, privacy-first tool for designing and rebalancing **TIPS (Treasury Inflation-Protected Securities) ladders**. It is designed to be both a practical financial utility and educational resource, where every calculation is transparent and traceable to first principles.

### Core Objectives
- **Build Mode**: Construct a new TIPS ladder from scratch given a target annual real amount (DARA) and time horizon.
- **Rebalance Mode**: Align existing holdings to a target amount, handling "gap years" (years where no TIPS are issued) via duration-matched "bracket years."
- **Educational Transparency**: Every value in the UI should be explainable via a drill-down calculation chain.

### Key Financial Concepts
- **DARA (Desired Annual Real Amount)**: The target annual amount in inflation-adjusted dollars.
- **Gap Years**: Years currently missing TIPS issuances (e.g., 2037–2039).
- **Bracket Years**: TIPS (e.g., 2036, 2040) used to cover gap years by holding additional TIPS that match the average duration of the missing maturities.
- **Later Maturity Interest**: Interest from later-maturing TIPS that cascades down to fund earlier rungs of the ladder.

---

## Technical Stack & Architecture
- **Frontend**: Vanilla JavaScript (ES Modules), HTML5, CSS3. No heavy frameworks or build steps required.
- **Logic Layer (`src/`)**:
  - `build-lib.js`: Algorithms for new ladder construction.
  - `rebalance-lib.js`: Algorithms for "Gap-only" and "Full" rebalancing.
  - `gap-math.js`: Shared logic for yield interpolation and duration matching.
  - `bond-math.js`: Core financial formulas (PV, Duration, P+I).
  - `render.js` & `drill.js`: UI rendering and calculation drill-down logic.
- **Data Pipeline (`scripts/`)**: Node.js scripts fetch daily TIPS prices/yields (FedInvest) and monthly RefCPI (BLS), stored to Cloudflare R2. Jobs run on local Windows Task Scheduler (not GitHub Actions).
- **Documentation (`knowledge/`)**: **Spec-First Development.** The Markdown files here are the source of truth for all formulas and algorithms.

---

## Development Conventions

### 0. Terminology (read every session — do not infer, do not substitute)

Derived from `knowledge/1.0_Bond_Ladders.md` → `knowledge/TIPS_Basics.md` → `knowledge/2.0_TIPS_Ladders.md`. If you see any of these used incorrectly in specs or code comments, flag it.

| Use this | Not this | Why |
|---|---|---|
| **TIPS** | bond, note, security | TIPS is a distinct Treasury category; use it in prose everywhere. Code variable names (`piPerBond`, `costPerBond`) are legacy — acceptable in code, never in spec prose or agent commentary. |
| **actual TIPS** | real bond, real TIPS | "real" means inflation-adjusted (e.g., DARA = Desired Annual *Real* Amount). Never use "real" to mean "existing/purchased." |
| **funded year** | real year, actual year | All years are real. A funded year is a ladder rung — a calendar year bucket that delivers ARA. |
| **bracket year** | *(no bad term, just define it)* | A funded year that *also* holds excess TIPS for duration matching gap years. Same maturity, dual role. |
| **gap year** | *(no bad term)* | A calendar year with no TIPS issuance (currently 2037–2039). |
| **synthetic TIPS** | synthetic bond | Hypothetical TIPS constructed for gap years to enable duration matching. Never purchased. |
| **LMI** | *(no bad term)* | Later Maturity Interest — annual coupon from ALL TIPS maturing after the funded year. Identical concept whether the rung is actual or synthetic. |

### 1. Spec-First Implementation
Always refer to the `knowledge/` directory (specifically `3.0_TIPS_Ladder_Rebalancing.md`) before modifying core logic. Code must implement the spec; the spec is never inferred from the code.

### 2. Documentation Parity (New Rule)
Whenever core logic, UI fields, or default behaviors are changed:
- **README.md** must be updated to reflect the new capabilities and input descriptions.
- **index.html Help Modal** (the `<div id="help-overlay">` section) must be updated to ensure in-app help remains accurate.
A change is considered incomplete until both the implementation and these user-facing docs are synchronized.

### 3. The Longest-to-Shortest Rule
All ladder calculations **MUST** process maturities from **longest to shortest**. This is critical because later maturity interest is a prerequisite for calculating the required quantity of shorter-dated bonds.

### 3. Naming Standards
Adhere to the following variable mappings:
- `fundedYearQty` (not `fyQty`): Quantity of TIPS needed for the funded year portion.
- `costPerBond`: `(price/100) * indexRatio * 1000`. (Legacy variable name; in prose, say "cost per TIPS".)
- `piPerBond`: The total Principal + Interest payout per $1,000 unit at maturity. (Legacy variable name; in prose, say "P+I per TIPS".)
- `indexRatio`: `refCPI / baseCPI`.

### 4. Testing & Validation
- **STOP ON FAIL (MANDATORY)**: If any test fails, stop immediately and debug.
- **Unit Tests**: Run `npm test`.
- **E2E Tests**: Run `cmd /c "npm run test:e2e -- --max-failures=1"`.
- **Verification**: After any logic change, ensure the "After ARA" in the UI still approximates the target DARA within rounding limits (~$1).

---

## Key Commands (Win32 Standards)
- **Run Locally**: `node ..\node_modules\serve\bin\serve.js .. -p 8080` (Run from root or use correct relative path).
- **Regression Tests**: `node tests/run.js`
- **E2E Tests**: `cmd /c "npm run test:e2e -- --max-failures=1"`
- **Update Data**: `node scripts/getYieldsFedInvest.js` (Run from root).

---

## Directory Structure Highlights
- `src/`: Core modular logic.
- `knowledge/`: Specification layer (1.0 to 6.0).
- `scripts/`: Data fetching and pipeline maintenance.
- `tests/`: Regression and E2E suites.
- `index.html`: Main application entry point.

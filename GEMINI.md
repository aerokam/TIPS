# GEMINI.md - TipsLadderBuilder Context

## Project Overview
TipsLadderBuilder is a browser-based, privacy-first tool for designing and rebalancing **TIPS (Treasury Inflation-Protected Securities) ladders**. It is designed to be both a practical financial utility and an educational resource, where every calculation is transparent and traceable to first principles.

### Core Objectives
- **Build Mode**: Construct a new TIPS ladder from scratch given a target annual real amount (DARA) and time horizon.
- **Rebalance Mode**: Align existing holdings to a target amount, handling "gap years" (years where no TIPS are issued) via duration-matched "bracket years."
- **Educational Transparency**: Every value in the UI should be explainable via a drill-down calculation chain.

### Key Financial Concepts
- **DARA (Desired Annual Real Amount)**: The target annual amount in inflation-adjusted dollars.
- **Gap Years**: Years currently missing TIPS issuances (e.g., 2037–2039).
- **Bracket Years**: TIPS (e.g., 2036, 2040) used to cover gap years by holding excess bonds that match the average duration of the missing maturities.
- **Later Maturity Interest**: Interest from longer-dated bonds that cascades down to fund earlier rungs of the ladder.

---

## Technical Stack & Architecture
- **Frontend**: Vanilla JavaScript (ES Modules), HTML5, CSS3. No heavy frameworks or build steps required.
- **Logic Layer (`src/`)**:
  - `build-lib.js`: Algorithms for new ladder construction.
  - `rebalance-lib.js`: Algorithms for "Gap-only" and "Full" rebalancing.
  - `gap-math.js`: Shared logic for yield interpolation and duration matching.
  - `bond-math.js`: Core financial formulas (PV, Duration, P+I).
  - `render.js` & `drill.js`: UI rendering and calculation drill-down logic.
- **Data Pipeline (`scripts/`)**: Node.js scripts fetch daily TIPS prices/yields (FedInvest) and monthly RefCPI (BLS), deployed via GitHub Actions to Cloudflare R2.
- **Documentation (`knowledge/`)**: **Spec-First Development.** The Markdown files here are the source of truth for all formulas and algorithms.

---

## Development Conventions

### 1. Spec-First Implementation
Always refer to the `knowledge/` directory (specifically `4.0_TIPS_Ladder_Rebalancing.md`) before modifying core logic. Code must implement the spec; the spec is never inferred from the code.

### 2. Documentation Parity (New Rule)
Whenever core logic, UI fields, or default behaviors are changed:
- **README.md** must be updated to reflect the new capabilities and input descriptions.
- **index.html Help Modal** (the `<div id="help-overlay">` section) must be updated to ensure in-app help remains accurate.
A change is considered incomplete until both the implementation and these user-facing docs are synchronized.

### 3. The Longest-to-Shortest Rule
All ladder calculations **MUST** process maturities from **longest to shortest**. This is critical because later maturity interest is a prerequisite for calculating the required quantity of shorter-dated bonds.

### 3. Naming Standards
Adhere to the following variable mappings:
- `fyQty` / `fy_qty`: Quantity of bonds needed for the funded year portion.
- `costPerBond`: `(price/100) * indexRatio * 1000`.
- `piPerBond`: The total Principal + Interest payout per bond at maturity.
- `indexRatio`: `refCPI / baseCPI`.

### 4. Testing & Validation
- **Regression Tests**: Run `npm test` to execute the Node.js regression suite (`tests/run.js`). This verifies that refactors do not change the mathematical output for known holdings.
- **E2E Tests**: Run `npm run test:e2e` for Playwright-based browser tests.
- **Verification**: After any logic change, ensure the "After ARA" in the UI still approximates the target DARA within rounding limits (~$1).

---

## Key Commands
- **Run Locally**: `npx serve .` (Open `index.html` in a browser).
- **Run Tests**: `npm test`
- **E2E Tests**: `npx playwright test`
- **Update Data (Local)**: `node scripts/getTipsYields.js` (Requires environment variables for S3/R2 if uploading).

---

## Directory Structure Highlights
- `src/`: Core modular logic.
- `knowledge/`: Specification layer (1.0 to 6.0).
- `scripts/`: Data fetching and pipeline maintenance.
- `tests/`: Regression and E2E suites.
- `index.html`: Main application entry point.

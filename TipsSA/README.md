# TipsSA: TIPS Seasonal Adjustments

A project to analyze and adjust for CPI seasonality in TIPS payments and index ratios.

## Features
- **Daily CPI Data**: Fetches latest CPI-U (NSA/SA) from BLS API.
- **Reference CPI Calculation**: Generates daily Reference CPI and Seasonal Adjustment (SA) factors.
- **SA Yield Analysis**: Calculates seasonally-adjusted yields for all outstanding TIPS.
- **Web Interface**: Visualize Ask vs. SA yields in tabular and chart form.

## Web Interface
To run the web interface locally:
1. From the repository root, run `npx serve .`.
2. Open `http://localhost:3000/TipsSA/` in your browser.

## Scripts
- `scripts/updateRefCpi.js`: Orchestrator to fetch CPI and calculate daily reference data.
- `scripts/calcAllSaYields.js`: CLI tool to generate SA yield results to CSV.

## Shared Resources
This project leverages the following from the `shared/` directory:
- `shared/knowledge/1.0_Bond_Basics.md`
- `shared/knowledge/2.1_TIPS_Basics.md`
- `shared/src/bond-math.js`

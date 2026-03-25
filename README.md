# Treasury Investors Portal

A collection of free, open-source tools for the **Bogleheads** community to manage and analyze Treasury securities, with a specialized focus on TIPS (Treasury Inflation-Protected Securities).

[**Read our Project Vision**](./PROJECT_VISION.md)

## Projects
- **TipsLadderManager**: Browser-based TIPS ladder design and rebalancing.
- **Yields**: Seasonal Adjustment (SA) analysis for TIPS and Nominal Treasury yield curves.
- **YieldsMonitor**: Real-time and historical Treasury yield monitoring across the curve.
- **TreasuryAuctions**: Comprehensive Treasury auction results and filtering.

## Shared Infrastructure
- **shared/**: Common libraries and knowledge base used across projects.
- **scripts/**: Root-level data-fetch scripts shared across projects.

## Web Interface
- **Live Version**: [https://aerokam.github.io/Treasuries/](https://aerokam.github.io/Treasuries/)

## Local Development
To run the tools locally:
1. Ensure you are at the monorepo root.
2. Run `npx serve .`
3. Navigate to the desired tool in your browser (e.g. `http://localhost:8080/TipsLadderManager/`).

Integration tests use Playwright (`npx playwright test` from the relevant project directory).

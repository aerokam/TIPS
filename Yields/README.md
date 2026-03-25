# Yields: TIPS Seasonal Adjustments

A browser-based tool for analyzing **Seasonally Adjusted (SA)** and **SA Outlier-adjusted (SAO)** TIPS yields. This project helps identify "cheap" or "rich" spots on the TIPS curve by removing predictable seasonal inflation noise.

## Features
- **Interactive Yield Curve**: Compare Market Ask, SA, and SAO yields.
- **Broker Integration**: Upload Schwab or Fidelity CSVs to see your own quotes adjusted.
- **Drill-down Transparency**: Click any SA yield to see the exact multiplicative factor and adjustment math.
- **SAO Trend Fitting**: See the institutional view of the yield curve via backwards-anchored linear regression.

## Getting Started
- **Live Version**: [https://aerokam.github.io/Treasuries/Yields/](https://aerokam.github.io/Treasuries/Yields/)
- **Local Dev**:
  1. From the monorepo root: `npx serve .`
  2. Open `http://localhost:8080/Yields/` in your browser. (Note: Root serving is required for shared components).

## Knowledge Base
- **[1.0 Seasonal Adjustments](./knowledge/1.0_Seasonal_Adjustments.md)**: The core multiplicative transform logic.
- **[2.0 SAO Adjustment](./knowledge/2.0_SAO_Adjustment.md)**: Outlier smoothing and trend fitting.
- **[3.0 Visual Standards](./knowledge/3.0_Visual_Standards.md)**: Charting and UI conventions.

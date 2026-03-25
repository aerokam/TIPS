# Treasury Yields Monitor

A tool for monitoring and charting Treasury and TIPS yields fetched from public chart services.

## Features
- Fetches real-time and historical yield data.
- Supports both Nominal Treasury and TIPS yields.
- Interactive charts with zoom and pan capabilities.
- 2x2 grid view for key maturities (10Y/30Y).

## Disclosure
For personal and educational use only. Data retrieved from public chart services. Yields represent market mid-prices and may vary by provider.

## Architecture
- **appsScripts/**: Contains original Google Apps Scripts used for data fetching.
- **src/**: Browser-based logic for rendering charts and processing data.
- **knowledge/**: Documentation on data sources and calculation methodology.

## Getting Started
To run locally, execute `npx serve .` from the root directory of the `Treasuries` repository and navigate to the "Yields Monitor" card.

# Treasury Yields Monitor - API Mapping

**Disclaimer:** For personal and educational use only. Data retrieved from public chart services. [Yields](../../knowledge/DATA_DICTIONARY.md#yield) represent market mid-prices and may vary by provider.

## Public Data Alternatives
While this tool uses high-resolution (intraday) and real-time data feeds, official daily closing rates can be sourced from:
- **U.S. Treasury Department:** Provides [Daily Treasury Yield Curve Rates](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve) (Nominal and Real) via XML/JSON feeds.
- **FRED (St. Louis Fed):** Offers historical data for most Treasury series with a 1-day lag.

## Time Range Mapping

| UI Label | Data Source | Provider `timeRange` / Store | Notes |
| :--- | :--- | :--- | :--- |
| **2D** | CNBC | `1D` | Intraday |
| **10D** | CNBC | `5D` | Recent history |
| **1Y / 2Y / 3Y** | CNBC | `6M` (same feed for all three) | Reread fresh each load, filtered client-side to the selected cutoff |
| **10Y / ALL** | R2 | `yields-history/history.json` | Persistent daily-close baseline |
| **Custom** | R2 + CNBC | `yields-history/history.json` + `5D` tip | Baseline plus latest live points |

## Symbol Reference

The following symbols are currently supported and grouped by security type:

### Nominal Treasuries
- `US1M`: 1-Month [Treasury Bill](../../knowledge/DATA_DICTIONARY.md#treasury-bill)
- `US2M`: 2-Month [Treasury Bill](../../knowledge/DATA_DICTIONARY.md#treasury-bill)
- `US3M`: 3-Month [Treasury Bill](../../knowledge/DATA_DICTIONARY.md#treasury-bill)
- `US6M`: 6-Month [Treasury Bill](../../knowledge/DATA_DICTIONARY.md#treasury-bill)
- `US1Y`: 1-Year [Treasury Bill](../../knowledge/DATA_DICTIONARY.md#treasury-bill)
- `US2Y`: 2-Year [Treasury Note](../../knowledge/DATA_DICTIONARY.md#treasury-note)
- `US5Y`: 5-Year [Treasury Note](../../knowledge/DATA_DICTIONARY.md#treasury-note)
- `US10Y`: 10-Year [Treasury Note](../../knowledge/DATA_DICTIONARY.md#treasury-note)
- `US30Y`: 30-Year [Treasury Bond](../../knowledge/DATA_DICTIONARY.md#treasury-bond)

### [TIPS (Treasury Inflation-Protected Securities)](../../knowledge/DATA_DICTIONARY.md#tips)
- `US1YTIPS`: 1-Year TIPS
- `US2YTIPS`: 2-Year TIPS
- `US5YTIPS`: 5-Year TIPS
- `US10YTIPS`: 10-Year TIPS
- `US30YTIPS`: 30-Year TIPS

## CNBC API

**2D, 10D ranges**: Use CNBC GraphQL with mapped `timeRange` (1D, 5D).

**1Y, 2Y, 3Y ranges**: CNBC GraphQL with `6M` `timeRange` — the same feed is refetched fresh for all three UI ranges and filtered client-side to the selected cutoff. This is deliberate (matches CNBC's own daily window, no drift), not a CORS fallback.

**5D latest yields**: All ranges (except 10D) append CNBC 5D data for current market context.

- **Base URL**: `https://webql-redesign.cnbcfm.com/graphql`
- **Operation**: `getQuoteChartData`
- **Persisted Query Hash**: `9e1670c29a10707c417a1efd327d4b2b1d456b77f1426e7e84fb7d399416bb6b`

## R2 Historical Baseline

Used for **10Y, ALL, and Custom** ranges. R2 CORS is live for this app's origins (`localhost:8080`, `localhost:8081`, production) — see repo-root `knowledge/Data_Pipeline.md` §3.1 for the full CORS policy. The browser fetches `history.json` directly, no proxy needed.

- **Base URL**: `https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/yields-history/`
- **File**: `history.json` — single nested object `{ "<SYMBOL>": [{x: timestamp, y: yield}, …], … }`

## No Local Fallbacks

App fetches only from remote sources (CNBC, R2). Never falls back to local files.


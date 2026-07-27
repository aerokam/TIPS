# FedInvest Pricing Logic

## Overview
FedInvest (TreasuryDirect) provides daily price data for US Treasury securities. These prices are calculated from secondary-market dealer quotations surveyed by the Federal Reserve Bank of New York. For the authoritative methodology by which Treasury derives these prices, see [FedInvest Treasury Pricing Methodology](FedInvest_Treasury_Pricing_Methodology.md) (based on Treasury Fiscal Service Appendix 1).

## What FedInvest publishes
The FedInvest daily price list has three price columns per security: **Buy**, **Sell**, and **End of Day**. The portal's ingestion (`scripts/getYieldsFedInvest.js`) takes the Buy price, falling back to Sell, then End of Day, and calculates yields from it.

Per Treasury Fiscal Service Appendix 1:
- **Purchase prices** (FedInvest "Buy") are the average of prevailing dealer bid and asked prices on the specified security, as reported by the Federal Reserve Bank of New York (survey taken 11:15–11:45 a.m. ET each business day).
- **Redemption prices** (early sales) are the prevailing dealer bid price on the security.

### Key implications
1. **Dealer-based, not retail-actionable**: FedInvest prices derive from secondary-market dealer quotations; broker ask-side quotes reflect retail execution prices, which differ.
2. **Empirical offset**: In practice the FedInvest yield curve typically sits slightly above the broker ask-yield curve. This is an observed pattern, not a documented pricing rule.
3. **Bill sensitivity**: The discrepancy is most pronounced for short-dated Treasury Bills, where small price differences produce large annualized yield deltas.

## Usage in Treasury Investors Portal
The portal uses FedInvest as a primary daily data source due to its stability and comprehensive coverage. It is also offered because it is available to anybody and is used by non-portal apps like tipsladder.com.
When comparing sources on the Yield Curves charts:
-   **FedInvest (Dotted Lines)**: yields derived from FedInvest prices.
-   **Broker/Market (Solid Lines)**: actionable ask-side quotes.

---
## Revision History

**(2026-07-27):** Added link to Treasury Fiscal Service's official pricing methodology (Appendix 1), which documents how FedInvest prices are derived from Federal Reserve Bank of New York dealer surveys.

**(2026-07-18):** An earlier version of this file stated the FedInvest price "represents the midpoint of the market bid and ask prices." That claim was unsourced and is withdrawn — FedInvest prices apply to intergovernmental transactions, and their relationship to market bid/ask is not documented.

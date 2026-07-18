# FedInvest Pricing Logic

## Overview
FedInvest (TreasuryDirect) provides daily price data for US Treasury securities. These prices apply to transactions made directly between governmental agencies; they are not secondary-market quotes.

## What FedInvest publishes
The FedInvest daily price list has three price columns per security: **Buy**, **Sell**, and **End of Day**. The portal's ingestion (`scripts/getYieldsFedInvest.js`) takes the Buy price, falling back to Sell, then End of Day, and calculates yields from it. The relationship of these prices to secondary-market bid/ask quotes is not documented by FedInvest — do not describe them as market midpoints or market quotes.

### Key implications
1. **Not market pricing**: FedInvest yields are not representative of what a secondary-market buyer or seller gets; broker quotes are.
2. **Empirical offset**: In practice the FedInvest yield curve typically sits slightly above the broker ask-yield curve. This is an observed pattern, not a documented pricing rule.
3. **Bill sensitivity**: The discrepancy is most pronounced for short-dated Treasury Bills, where small price differences produce large annualized yield deltas.

## Usage in Treasury Investors Portal
The portal uses FedInvest as a primary daily data source due to its stability and comprehensive coverage. It is also offered because it is available to anybody and is used by non-portal apps like tipsladder.com.
When comparing sources on the Yield Curves charts:
-   **FedInvest (Dotted Lines)**: yields derived from FedInvest prices.
-   **Broker/Market (Solid Lines)**: actionable ask-side quotes.

---
*Revision note (2026-07-18): an earlier version of this file stated the FedInvest price "represents the midpoint of the market bid and ask prices." That claim was unsourced and is withdrawn — FedInvest prices apply to intergovernmental transactions, and their relationship to market bid/ask is not documented.*

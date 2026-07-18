# FedInvest Pricing Logic

## Overview
FedInvest (TreasuryDirect) provides daily price data for US Treasury securities. This data is primarily intended for intergovernmental and institutional accounting, but it serves as a reliable daily reference for individual investors.

## Mid-Market Pricing
The "Price" reported by FedInvest represents the **midpoint of the market bid and ask prices**.

### Key Implications:
1.  **Lower than Ask Price**: Because it is a midpoint, the FedInvest price is consistently lower than the **Ask Price** (the price an investor pays to buy) quoted by commercial brokers like Schwab or Fidelity.
2.  **Higher Yields**: In bond math, price and yield move inversely. Since the FedInvest price is lower than the market ask price, the calculated **FedInvest Yield is higher** than the market ask yield.
3.  **Bill Sensitivity**: This discrepancy is most pronounced for short-dated Treasury Bills, where small price differences result in significant annualized yield deltas.

## Usage in Treasury Investors Portal
The portal uses FedInvest as a primary daily data source due to its stability and comprehensive coverage. It is also offered because it is available to anybody and is used by non-portal apps like tipsladder.com. However, when comparing FedInvest data to real-time broker quotes:
-   **FedInvest (Dotted Lines)**: Represents mid-market reference data.
-   **Broker/Market (Solid Lines)**: Represents actionable "Ask" pricing.

It is expected and mathematically correct for the FedInvest (dotted) curve to sit slightly above the broker (solid) curve in yield terms.

---
*Authority: FedInvest Treasury Securities Pricing documentation; Empirical market analysis.*

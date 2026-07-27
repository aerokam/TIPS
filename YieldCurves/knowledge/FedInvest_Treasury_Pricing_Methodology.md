# FedInvest Treasury Pricing Methodology

**Source:** Treasury Fiscal Service, *Appendix 1: Purchase Prices and Yields on Investments and Sales Prices on Redemptions* (updated 2024-03)  
**Official URL:** https://tfx.treasury.gov/sites/default/files/2024-03/Appendix-1-2-4300.pdf

---

## Overview

FedInvest prices for all Treasury security types (bills, notes, bonds, TIPS, floating rate notes, zero-coupon bonds, one-day certificates) are derived from **market-based dealer quotations** surveyed by the Federal Reserve Bank of New York and reported to Treasury.

---

## Pricing Methodology by Security Type

### Fixed-Principal Securities (Notes & Bonds)

**Purchase Price:**  
The average of prevailing bid and offered prices for the specified marketable Treasury security on the day the investment instruction is received by Fiscal Service, as reported to Treasury by the Federal Reserve Bank of New York.

**Sales Price (redemption before maturity):**  
The prevailing bid price for the corresponding marketable Treasury security on the day the redemption instruction is received by Fiscal Service.

**Survey timing:**  
Based on a survey of Treasury securities dealers taken by the Federal Reserve Bank of New York between approximately **11:15 a.m. and 11:45 a.m. (Eastern Time) each Business Day**.

---

### Treasury Bills

**Purchase Price:**  
The average of the prevailing bid and offered **bank Discount rates** (not prices) on the specified marketable Treasury bill, as reported by the Federal Reserve Bank of New York.

**Sales Price (early redemption):**  
The prevailing bank Discount **bid rate** on the corresponding Treasury bill.

**Survey timing:**  
Between approximately **11:15 a.m. and 11:45 a.m. (Eastern Time) each Business Day**.

---

### TIPS (Inflation-Protected Securities)

**Purchase Price:**  
The average of prevailing bid and offered prices for the specified marketable TIPS on the day the investment instruction is received by Fiscal Service, as reported to Treasury by the Federal Reserve Bank of New York.

**Sales Price (early redemption):**  
The prevailing bid price for the marketable TIPS on the day the redemption instruction is received by Fiscal Service.

**Principal Adjustment:**  
TIPS principal is adjusted by daily Reference Index numbers, as published by Fiscal Service.

**Negative yield policy:**  
Unlike nominal securities, TIPS have no pricing floor. Treasury's Office of Debt Management has established a floor of zero percent for all nominal securities, but this policy does **not** apply to TIPS because they may recover due to inflation. Real yields on TIPS can and do trade at negative rates—a function of investor views on inflation and potential arbitrage between TIPS and comparable nominal securities.

---

### Floating Rate Notes

**Purchase Price:**  
The average of prevailing bid and offered prices for the specified marketable Treasury floating rate note on the day the investment instruction is received by Fiscal Service.

**Sales Price (early redemption):**  
The prevailing bid price for the corresponding floating rate note on the day the redemption instruction is received by Fiscal Service.

---

### Zero-Coupon Bonds (STRIPS)

**Pricing Formula:**

```
        F
P = ─────────────────────
    (1 + ri/2s)(1 + i/2)^n
```

Where:
- **P** = Price
- **F** = Face value
- **i** = Discount rate (as determined below)
- **n** = Number of full semi-annual periods to maturity
- **r** = Number of days to the next semi-annual date (or zero if on a semi-annual date)
- **s** = Number of days in the semi-annual period

**Discount rate for purchase:**  
Determined by Treasury based on the **mean of prevailing market bid and ask yields** on the specified marketable Treasury STRIPS principal or interest component as of **12:00 p.m. (Eastern Time)** on the purchase date.

**Discount rate for redemption:**  
Determined by Treasury based on the **prevailing market bid yield** on the same STRIPS component as of **12:00 p.m. (Eastern Time)** on the redemption date.

**Market source:**  
Treasury surveys available quotations from market sources, including financial information services and primary dealers active in the Treasury STRIPS market.

---

### One-Day Certificates of Indebtedness

**Interest Rate:**  
Determined by the Secretary of the Treasury, taking into consideration the current market-bid coupon-equivalent yield to maturity of the most recently auctioned United States Treasury bill of the shortest maturity then being regularly auctioned.

---

## Pricing Floors

| Security Type | Pricing Floor |
|---|---|
| Treasury Bills (non-Market-Based) | 0% (no negative yields) |
| Notes & Bonds (fixed-principal) | 0% (no negative yields) |
| TIPS | None — real yields can trade negative |
| Floating Rate Notes | 0% (no negative yields) |
| Zero-Coupon Bonds | 0% (no negative yields) |
| One-Day Certificates | 0% (no negative yields) |

---

## Connection to Portal Ingestion

The FedInvest daily price list publishes three prices per security: **Buy**, **Sell**, and **End of Day**. The Treasury portal's ingestion script (`scripts/getYieldsFedInvest.js`) takes the Buy price, falling back to Sell, then End of Day, and calculates yields from it. This pricing methodology describes the market-based foundation for those published prices.

---

## See Also

- [FedInvest Pricing Logic](FedInvest_Pricing_Logic.md) — How TipsLadderManager and YieldCurves interpret and use FedInvest prices
- [3.1 Data Pipeline](../../TipsLadderManager/knowledge/3.1_Data_Pipeline.md) — Ingestion processes and yield source selection

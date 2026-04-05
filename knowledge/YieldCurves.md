# YieldCurves (App Overview)

**YieldCurves** is a tool for analyzing TIPS (Treasury Inflation-Protected Securities) real yields through the lens of seasonal and outlier adjustments. It provides a more accurate "fair value" curve by removing predictable inflation noise and idiosyncratic market shocks.

---

## 1.0 App Context (Level 1 DFD)

```mermaid
graph LR
    %% Data Stores (S)
    S1[("S1 YieldsDerivedFromFedInvestPrices.csv")]
    S4[(S4 RefCpiNsaSa.csv)]
    S7[(S7 FidelityQuotes)]

    %% Processes (P)
    P1((1.0 Seasonal Adjustment))
    P2((2.0 SAO Outlier Adjustment))
    P3((3.0 Interactive Charting))

    %% User (E)
    U[User / Investor]

    %% Inbound Data
    S1 --> P1
    S4 --> P1
    S7 --> P1
    
    %% Internal Flows
    P1 --> P2
    P2 --> P3
    
    %% User Interaction
    U <-->|Zoom / Pan / Filters| P3

    %% Links to Specs
    click P1 "#/md/YieldCurves/knowledge/1.0_Seasonal_Adjustments.md" "View SA Logic"
    click P2 "#/md/YieldCurves/knowledge/2.0_SAO_Adjustment.md" "View SAO Logic"
    click P3 "#/md/YieldCurves/knowledge/3.0_Visual_Standards.md" "View UI Specs"
    click S1 "#/md/knowledge/DataStores.md#s1" "View Schema"
    click S4 "#/md/knowledge/DataStores.md#s4" "View Schema"
    click S7 "#/md/knowledge/DataStores.md#s7" "View Schema"
```

---

## 2.0 Core Processes

### [1.0 Seasonal Adjustment (SA)](../YieldCurves/knowledge/1.0_Seasonal_Adjustments.md)
Normalizes real yields by applying seasonal factors derived from BLS CPI-U (NSA vs SA) data.
- **Goal**: Enable "fair" comparison of yields across different months of the year.
- **Formula**: `SA Yield = Clean Price * (S_settle / S_maturity)`

### [2.0 SAO Outlier Adjustment](../YieldCurves/knowledge/2.0_SAO_Adjustment.md)
Applies a backwards-anchored linear regression to smooth the front-end of the SA curve.
- **Goal**: Remove idiosyncratic "wiggles" caused by liquidity or one-off shocks to specific CUSIPs.
- **Method**: Blending the SA yield with a projected trend line.

### [3.0 Interactive Visualization](../YieldCurves/knowledge/3.0_Visual_Standards.md)
A high-performance charting interface built with Chart.js and Hammer.js.
- **Features**: Full X/Y zoom, vertical panning, and dataset visibility toggles.
- **Visual Priority**: SAO > SA > Ask (Market).

---

## 3.0 Foundational Logic (The Engine Room)

- **[SA Intuition (2.1)](../YieldCurves/knowledge/2.1_SA_Intuition.md)**: Conceptual guide to why seasonality matters for TIPS.
- **[Canty Authority](../YieldCurves/knowledge/Canty.md)**: Technical reference for the mathematical foundations of SA/SAO (Canty, 2009).
- **[Data Pipeline](../../knowledge/Data_Pipeline.md)**: Details on the GitHub Actions that update the R2 data stores.

# YieldsMonitor (App Overview)

**YieldsMonitor** is a real-time and historical visualization tool for U.S. Treasury yields (Nominal and TIPS). It provides high-resolution intraday tracking and long-term trend analysis, focusing on consistency and market-state awareness.

---

## 1.0 App Context (Level 1 DFD)

```mermaid
graph LR
    %% Data Stores (S)
    S6[(S6 yields-history/)]
    E5[E5 CNBC GraphQL]

    %% Processes (P)
    P1((1.0 Data Blending))
    P2((2.0 Yield Change Logic))
    P3((3.0 Interactive Charts))

    %% User (E)
    U[User / Investor]

    %% Inbound Data
    S6 --> P1
    E5 -->|Live Tip| P1
    
    %% Internal Flows
    P1 --> P2
    P2 --> P3
    
    %% User Interaction
    U <-->|Symbol Select / Time Range| P3

    %% Links to Specs
    click P1 "#/md/YieldsMonitor/knowledge/1.0_Operation.md#data-blending-the-live-tip" "View Blending Logic"
    click P2 "#/md/YieldsMonitor/knowledge/1.0_Operation.md#20-yield-change-logic" "View Change Logic"
    click P3 "#/md/YieldsMonitor/knowledge/1.0_Operation.md#30-interactive-visualization" "View UI Specs"
    click S6 "#/md/knowledge/DataStores.md#s6" "View Schema"
```


---

## 2.0 Core Processes

### [1.0 Data Blending](../YieldsMonitor/knowledge/1.0_Operation.md#data-architecture)
For 10Y, ALL, and Custom ranges: blend R2 historical baseline with latest intraday yields from CNBC for current market context. (1Y/2Y/3Y instead reread a CNBC feed fresh each load — no R2 involved; see linked spec.)
- **Goal**: Ensure "Latest Yield" and "Day Change" always reflect current trading, not stale historical closes.
- **Method**: 10Y/ALL/Custom fetch R2 historical baseline (daily 3PM closes, refreshed by updateYieldsHistory.js), then append latest intraday yields from CNBC 5D feed.

### [2.0 Yield Change Logic](../YieldsMonitor/knowledge/1.0_Operation.md#yield-change-calculation)
Calculates the difference between the latest yield and the previous market close (17:00 ET).
- **Goal**: Provide a consistent "Day Change" metric across all views.
- **Timezone**: All logic is anchored to `America/New_York` wall-clock time.
- **Reference point**: The last bar at exactly **17:00 ET** on the previous trading day. This is the official end-of-trading-day close.
- **Deviation from CNBC**: CNBC's displayed yield change uses an earlier reference (their `previous_day_closing` field from the Tradeweb quote service), which appears to reflect a **mid-afternoon settlement quote** (~3:00 PM ET) rather than the 5 PM close. On 2026-04-08 for US1Y, our 17:00 close = 3.693% vs. CNBC's reference = 3.685% — a 0.008% discrepancy. This is expected and intentional.

### [3.0 Interactive Visualization](../YieldsMonitor/knowledge/1.0_Operation.md#uiux-standards)
Intraday and historical charts featuring market-state annotations.
- **Features**: After-hours and weekend shading, Y-axis auto-rescaling, comparative yield curve overlays, and **custom date range** selection.
- **Custom Date Range**: A dedicated sidebar control lets users input a specific start and end date. Time Series charts filter to that window; Yield Curve and Breakeven Inflation snapshot curves automatically reflect the custom start/end dates.
- **Precision**: Yields are tracked to 3 decimal places for granular movement analysis.

---

## 3.0 Foundational Logic (The Engine Room)

- **[Operation Manual (1.0)](../YieldsMonitor/knowledge/1.0_Operation.md)**: Details on timezone handling, shading, and CNBC API range mappings.
- **[API Mapping](../YieldsMonitor/knowledge/API_Mapping.md)**: Required CNBC `timeRange` parameter mappings for all UI ranges.
- **[Data Pipeline](../../knowledge/Data_Pipeline.md)**: Automation scripts only (not app). No local fallbacks in app code.

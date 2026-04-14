# TreasuryAuctions (App Overview)

**TreasuryAuctions** is a tool for monitoring and analyzing U.S. Treasury auction results (Bills, Notes, Bonds, and TIPS). It provides historical data and real-time updates on upcoming issuances.

---

## 1.0 App Context (Level 1 DFD)

```mermaid
graph LR
    %% Data Stores (S)
    S5[(S5 Auctions.csv)]
    S9[(S9 tentative_tips.json)]
    E3[E3 FiscalData API]
    E4[E4 Treasury XML]

    %% Processes (P)
    P1((1.0 Auction Search))
    P2((2.0 Historical Trends))
    P3((3.0 Upcoming TIPS Logic))
    P4((4.0 Interactive Filters))

    %% User (E)
    U[User / Investor]

    %% Inbound Data
    S5 --> P1
    E3 -->|Live Fetch| P1
    E4 -->|XML Scraping| S9
    S9 --> P3
    P1 --> P3
    
    %% Internal Flows
    P3 --> P2
    P2 --> P4
    
    %% User Interaction
    U <-->|Search / Filter| P4

    %% Links to Specs
    click P1 "#/md/TreasuryAuctions/knowledge/Data_Pipeline.md" "View Data Logic"
    click S5 "#/md/knowledge/DataStores.md#s5" "View Schema"
    click S9 "#/md/knowledge/DataStores.md#s9" "View Tentative Data"
```

---

## 2.0 Core Processes

### [1.0 Auction Search](../TreasuryAuctions/knowledge/Data_Pipeline.md)
Retrieves auction results from both the local `Auctions.csv` database and the live FiscalData API.
- **Goal**: Enable exploration of historical auction performance (e.g., high yields, bid-to-cover ratios).
- **Sources**: FiscalData (accounting/od/auctions_query).

### 2.0 Upcoming TIPS Logic
Augments the live `upcoming_auctions` feed with accurate TIPS identification.
- **Source**: `tentative_tips.json` (S9).
- **Goal**: Label TIPS in the upcoming table even when the official API lacks the field.

---

## 3.0 Foundational Logic (The Engine Room)

- **[Auctions Query Reference](../../knowledge/AuctionsQuery_Reference.md)**: Technical guide to the FiscalData API fields and query logic.
- **[Data Pipeline](../../knowledge/Data_Pipeline.md)**: Details on the local **Auction Refresh** job that maintains the historical database.

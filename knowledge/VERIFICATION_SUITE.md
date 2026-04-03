# Knowledge Base Verification Suite (Manual)

Follow these steps to verify that the navigation, rendering, and drill-down features are working correctly.

## 1. Context Diagram & Top-Level Navigation
- [ ] Open `http://localhost:8080/knowledge/KNOWLEDGE_MAP`.
- [ ] **Top Header**: Verify "Data Dictionary", "Data Stores", "Admin Dashboard", and "Verify Setup" are at the **top** of the page.
- [ ] **Apps Column**: Click the **TipsLadderManager** bubble. 
    - *Expected*: Opens the rendered Overview in the viewer.
- [ ] **Back Navigation**: From inside the viewer, click **← KNOWLEDGE MAP**.
    - *Expected*: Returns to `/knowledge/KNOWLEDGE_MAP` (the full visual map). The viewer should not attempt to render an HTML file — if the guard trips, it redirects automatically.
- [ ] **Storage Column**: Click the **Cloudflare R2** box.
    - *Expected*: Opens the detailed `DataStores.md` spec in the viewer.
- [ ] **Source Drilling**: Click **FedInvest** in the map.
    - *Expected*: Opens `DATA_DICTIONARY.md` at the E1 schema section. Verify the note about mid-market pricing and inferred T=0.

## 2. Document Drill-Down (Inside Apps)
- [ ] Open **TipsLadderManager Overview** via the Map.
- [ ] **Bubble 1.0**: Click the **1.0 Build Logic** bubble in the Mermaid diagram.
    - *Expected*: Navigates to the rendered `1.0_Bond_Ladders.md`.
- [ ] **S1 Cylinder**: Click the **S1** cylinder in the diagram.
    - *Expected*: Navigates to `DataStores.md` and highlights/scrolls to the S1 row. **NO RAW MD SHOULD BE VISIBLE.**

## 3. Data Inspection (CSV Previews)
- [ ] Open **Data Stores** from the top header of the Map.
- [ ] **Preview Toggle**: Click **"View"** next to `Yields.csv`.
    - *Expected*: A table with the first 10 rows appears.
- [ ] **Toggle Off**: Click the **"View"** link again.
    - *Expected*: The table disappears.

## 4. Anchor Handling (Inside YieldCurves)
- [ ] Open **YieldCurves Overview**.
- [ ] **Process Click**: Click the **1.0 Seasonal Adjustment** bubble.
    - *Expected*: Navigates to the detailed `1.0_Seasonal_Adjustments.md` document.

## 5. Ingestion Pipeline
- [ ] Click **Ingestion Jobs** in the Context Map.
- [ ] **Ownership Split**: Verify the document clearly separates `[LOCAL]` Windows tasks from `[CLOUD]` GitHub Actions.
- [ ] **Fidelity Status**: Verify Fidelity quotes are listed as a local Windows task.

# Treasury Investors Portal — Vision and Principles

This portal offers a variety of web apps that help investors manage their U.S. Treasury investments — and, through extensive in-context pop-up help, build a better understanding of how Treasuries and TIPS actually work.

## 1. Productivity
Replace spreadsheet-based workflows with tools that are faster, more powerful, and easier to use. A user should be able to accomplish in seconds what would take minutes in a spreadsheet — with fewer errors and no manual maintenance.

## 2. Transparency and Understanding
Numbers on screen should be explainable and verifiable wherever practical. A user new to TIPS should be able to understand what a number means and where it comes from. An experienced user should be able to confirm that a number is being calculated correctly — without having to trust a black box.

Both goals are served by the same mechanisms: pop-up explanations that show the calculation behind a value, and CSV export so numbers can be independently analyzed in a spreadsheet. Terms align with market convention (e.g., "Ref CPI", "Dated Date Ref CPI").

Knowledge is layered. Users can stay at the surface or drill deeper:
- **Level 1 — The UI**: Clean, actionable, and distraction-free. Numbers are front and center.
- **Level 2 — Pop-up Help**: Explanations of what a value means, what drives it, and how to interpret it. Accessible in context, without leaving the page.
- **Level 3 — Multi-level Explanations**: For genuinely complex topics (e.g., seasonal adjustment, index ratios), plain-language, institutional, and mathematical explanations are available in layers.
- **Level 4 — The Specification**: Internal knowledge documents (`knowledge/`) define the implementation in detail.
- **Level 5 — The Authority**: Direct references to the source of truth — CFR Title 31 Money and Finance: Treasury, BLS methodology, or official Treasury documentation.

*This principle is most fully realized in the Ladder Manager, which supports drill-down traceability from ladder totals all the way to the official CFR Title 31 calculation chain.*

## 3. Maintainability
Each concept is defined in exactly one place. The data pipeline is transparent and owner-operated. All data ingestion jobs run as local Windows scheduled tasks, with full visibility into the source-to-storage flow.

## 4. Privacy
All code runs locally in the browser. No portfolio data, inputs, or calculations are uploaded to any server.

# TIPS Ladder Manager

A free, browser-based tool for building and rebalancing [TIPS](https://www.treasurydirect.gov/marketable-securities/tips/) (Treasury Inflation-Protected Securities) ladders.

All calculations run locally in your browser — no data is uploaded anywhere.

---

## What It Does

**Rebalance** — for existing TIPS ladder holders rebalancing into newly issued TIPS. By default keeps the excess you already hold in older lower bracket maturities.

**Build** — designs a new ladder from scratch with zero existing holdings.

---

## Traceability & Deep Drill

This tool is designed for **transparency first**. Every number in the UI is traceable to its source:
- **Level 1: UI Summary**: Actionable ladder totals and rung details.
- **Level 2: The Drill-Down**: Click any underlined value (Amount, Cost, etc.) to see the exact calculation chain.
- **Level 3: The Component Math**: Click nested variables within popups (like **Index Ratio** or **Ref CPI**) to see the underlying interpolation math and official formulas.
- **Level 4: Legal Authority**: Deep-links to the **Code of Federal Regulations (31 CFR § 356)** are provided within math popups for institutional-grade verification.

---

## Key Concepts

**TIPS** — Treasury Inflation Protected Securities: Treasury notes and bonds whose principal adjusts daily with inflation as measured by CPI-U. Coupon interest is paid semi-annually, and is calculated based on the inflation-adjusted principal. At maturity you receive the inflation-adjusted principal plus the final coupon payment. All amounts shown in the application are in *real* (inflation-adjusted, today's dollars) terms.

**TIPS Ladder** — A portfolio of TIPS maturing in successive years, which along with the semi-annual interest payments, provides a predictable inflation-adjusted amount each year throughout the ladder.

**DARA (Desired Annual Real Amount)** — Your desired annual real amount from the ladder. Each rung is sized to produce this amount.

**Gap Years** — Years within the current TIPS timeline (e.g. 2037–2039) where Treasury has not issued securities. These are covered by holding excess bonds in surrounding *bracket* years to match the average duration of the missing maturities.

**Future 30Y Rungs** — Years beyond the currently issued TIPS (e.g. 2057–2066). Like gap years, these are handled via duration-matched excess in existing long-dated cover pairs (currently the 2052 and 2056 TIPS).

**Bracket Years** — Maturity years used to cover gaps or Future 30Y rungs. *Upper bracket*: always the Feb 2040 TIPS. *Active lower bracket*: the most recently issued 10-year TIPS. With **Retain lower bracket excess** on, excess you already hold in a retained lower bracket is kept and never added to; it is sold, oldest first, only if the lower brackets are over-covered.

**Same-Maturity Excess Interest** — Bracket and cover excess TIPS are ordinary held bonds: interest paid in their own maturity year counts toward that year's amount, and it also flows down as LMI to every shorter year, the same as any other TIPS's coupon. Bracket excess (lower/upper gap brackets) covers gap years; cover excess (the Future 30Y cover pair) covers Future 30Y rungs. Example: excess Feb 2056 TIPS held to cover Future 30Y rungs (2057–2066) — their interest contributes to the 2056 funded year's amount, reducing the quantity of 2056 TIPS needed, and the same coupon also flows down to 2055 and every year below.

---

## Data Sources

| Data | Source | Schedule |
|---|---|---|
| TIPS prices & yields | Market prices from a broker | Several times per weekday |
| Reference CPI | BLS (via TreasuryDirect) | Monthly |
| TIPS metadata (coupon, dated date Ref CPI) | TreasuryDirect securities list | As needed |

Prices are fetched from the broker feed several times a day and uploaded to Cloudflare R2; the app fetches the CSV data directly from R2. FedInvest (TreasuryDirect) prices are also ingested daily as a dormant cross-check path, not currently surfaced in the app.

---

## Technical Documentation & Glossary

This project is built on **spec-first development**. All logic and formulas are documented in the following knowledge-base files:

- **[Master Glossary](../knowledge/DATA_DICTIONARY.md)**: Authoritative source for all financial terms, mathematical formulas, and project-specific terminology.
- **[Bond Basics](../knowledge/Bond_Basics.md)**: Fundamental concepts for nominal Treasuries.
- **[TIPS Basics](../knowledge/TIPS_Basics.md)**: Detailed interpolation logic and inflation-adjustment rules.
- **[TIPS Ladder Rebalancing](./knowledge/3.0_TIPS_Ladder_Rebalancing.md)**: The core algorithm for rebalancing existing holdings.

---

## Getting Started

To get started, visit the [Treasury Investors Portal](https://aerokam.github.io/Treasuries/) and select the **TipsLadderManager** tool, or go directly to the [TipsLadderManager URL](https://aerokam.github.io/Treasuries/TipsLadderManager/).

---

## Local Development

For local development, execute `npx serve .` from the root directory of the `Treasuries` repository and navigate to `http://localhost:8080/TipsLadderManager/`. (Note: Root serving is required for shared components).

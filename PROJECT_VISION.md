# TIPS Portal — Project Vision

## The Mission
To provide the **Bogleheads.org** community with clear, free, and transparent tools for managing TIPS (Treasury Inflation-Protected Securities) portfolios. This is a contribution to the community's tradition of evidence-based investing, intended to replace "black box" financial tools with open, educational infrastructure.

We don't just show results; we show the **work**.

---

## Core Principles

### 1. The Understandability Reward
Understandability is our primary metric. Every UI adjustment and logic decision should be a positive reward for improving the clarity of the information displayed. If a change makes the tool more powerful but more opaque, it doesn't belong here.
- **Traceability**: Every number on screen must be explainable.
- **Visual Intuition**: Use charts and grids to make complex relationships (like duration matching) feel obvious.
- **Language Alignment**: Adhere to market-standard terms (e.g., "Ref CPI", "Dated date Ref CPI") to build real-world financial literacy.

### 2. "Drill Baby Drill" (in a good way) — Progressive Disclosure
Knowledge is layered. A user should be able to start at a high-level summary and "drill" all the way down to the legal authority.
- **Level 1: The UI**: Clean, actionable, and distraction-free.
- **Level 2: The Drill-Down**: Interactive popups showing the exact calculation chain.
- **Level 3: The Specification**: Internal knowledge documents (`shared/knowledge/`) that define our implementation.
- **Level 4: The Authority**: Direct references to the source of truth, such as the **Code of Federal Regulations (CFR)** or official BLS/Treasury methodology.
  - *Example*: Explaining that Ref CPI for the 1st of the month is equal to the CPI-U (NSA) from three months prior, per 31 CFR § 356.

### 3. Multi-Level Education
TIPS are notoriously counter-intuitive. We aim to explain concepts like **Seasonal Adjustments** at various levels:
- **Common Sense**: "Prices change with the seasons. We flatten those waves so you can see the real value of the bond."
- **Institutional Logic**: Explaining why traders look at seasonally-adjusted yields to make "fair value" comparisons.
- **The Math**: Using linear regression and backwards-anchored sliding windows to isolate idiosyncratic outliers.

---

## Community Commitment

- **Always Free, Always Open**: No accounts, no tracking, and no hidden logic. All calculations run locally in your browser.
- **Bogleheads-First**: Designed by and for the Bogleheads community. The goal is to simplify the complex without removing the rigor.
- **Educational First Principles**: If you can't drill into a value to understand where it came from, we haven't finished building it.

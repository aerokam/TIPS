# Layer 3: Bond Ladder Basics

**Goal:** Construct a portfolio of bonds with staggered maturities that produces a consistent cash flow at regular intervals

**Ladder Metaphor:** Like rungs on a physical ladder, each step represents a time interval
- In this specification: each rung = one calendar year
- Alternative constructions possible (monthly, quarterly) but not covered here

**Funded Year (FY):** A calendar year (rung) in the ladder for which we calculate total cash flow

**Ladder Period:** Range of funded years from first year to last year

**Desired Annual Amount (DAA):** Target total cash flow for a funded year (includes both maturing principal and interest payments)

**Annual Amount (AA):** Actual cash flow produced by the ladder for a funded year (may differ from DAA due to rounding)

**Interest from Later Maturities:** Annual interest contributed by bonds maturing after the funded year

**Last-Year Interest:** Interest payments received in the funded year from bonds maturing that year
- Treasury bonds/notes pay semi-annually
- Jan-Jun maturity: 1 coupon payment in final year
- Jul-Dec maturity: 2 coupon payments in final year

**Principal + Last-Year Interest (P+I):** Combined cash flow from maturing principal and interest payments in the funded year from bonds maturing that year

**Construction Method:** Work backwards from longest to shortest maturity

**Why Work Backwards:**
- Final funded year has no later maturities → simple calculation
- Each earlier year requires interest from later maturities in its calculation
- Processing longest-to-shortest ensures later year values are computed before earlier years reference them

**Basic Algorithm:**
1. Sort bonds by maturity (longest first)
2. For each bond (longest to shortest):
   - Calculate annual interest contribution
   - Store by maturity year for use by earlier funded years
3. For each funded year:
   - B = Set of all bonds maturing in that year (can include multiple maturity months)
   - ILM = Sum(interest from later maturities)
   - Required (P+I) = DAA - ILM
   - Quantity = ROUND(Required (P+I) / (P+I per bond))
   - AA = Quantity * (P+I per bond) + ILM

Where:
- B = Bonds maturing in funded year
- ILM = Interest from Later Maturities
- P+I = Principal + Last-Year Interest
- DAA = Desired Annual Amount
- AA = Annual Amount (actual)

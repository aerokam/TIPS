# Tier 3: TIPS Ladder Rebalancing for Duration-Matched Gap Coverage

**Dependencies:** Tier 1a (Bond Basics), Tier 1b (TIPS Basics), Tier 2a (Bond Ladder Basics), Tier 2b (TIPS Ladder Basics), Reference Guide v1.1

## Purpose

Rebalance an existing TIPS ladder by selling excess holdings from bracket years and buying into formerly-gap years (now available) to improve duration matching and reduce ARA-DARA gaps across funded years.

## Context

When a TIPS ladder was originally built (e.g., 2022), certain years had no TIPS available (gap years, e.g., 2033-2039). Excess holdings were concentrated in bracket years flanking the gaps to duration-match the missing coverage. Over time, Treasury issues new TIPS filling some former gap years (e.g., 2033-2036 now available). Rebalancing sells excess from bracket years and buys into these newly available maturities.

## Key Concepts

### Official Ladder Range
- **firstYear**: Earliest year with holdings
- **lastYear**: Latest contiguous year with holdings before any gap above 2040
- Gap years above 2040 truncate the official range (e.g., holdings in 2047 and 2049 but not 2048 â†’ lastYear = 2047)
- Known gap years (2037-2039, no TIPS issued) do NOT break contiguity

### DARA Derivation
DARA is not an input â€” it is inferred from current holdings:
1. Calculate ARA for every funded year using the standard holdings ladder algorithm (Algorithm 2 from Reference Guide)
2. Sum ARA for all years within the official range (firstYear to lastYear), excluding gap years
3. DARA = total ARA / number of funded rungs in range

### Gap Years
Years within the official ladder range where no TIPS exist in TIPSSAO. Currently 2037, 2038, 2039.

### Bracket Years
- **Upper bracket**: Always 2040 (Feb maturity)
- **Lower bracket**: Dynamically identified â€” the single holding with the most bonds among all maturities in years between `LOWEST_LOWER_BRACKET_YEAR` (configurable constant, default 2032) and the first gap year (exclusive)
- **Bracket maturity**: The specific CUSIP within a bracket year that has the most holdings

### Rebalance Years
Years between the lower bracket year and the first current gap year, exclusive on both ends. These were gap years when the ladder was originally built but now have TIPS available.
- Lower bracket 2032 â†’ rebalance years: 2033, 2034, 2035, 2036
- Lower bracket 2034 â†’ rebalance years: 2035, 2036
- Rebalance years are always > lower bracket year (they were gaps when ladder was built, which can only be after the bracket year)

### FY vs Excess (Bracket Years)
- **FY portion**: Holdings needed to achieve DARA for that year's funded rung
- **Excess portion**: Additional holdings beyond FY, held for duration matching gap years
- **Target FY Qty**: For bracket maturity, calculated using residual P+I after subtracting non-bracket maturities in that year (held constant)
- Calculations use P+I for FY/ARA, $ (cost) for duration matching

## Algorithm Flow

### Phase 0: Derive Parameters (No LadderBuilder Dependency)

```
0a. Settlement date:
    T+1 business day from today, skipping weekends and holidays
    Holidays sourced from Holidays sheet column A

0b. RefCPI:
    Look up settlement date in RefCPI sheet (col A = date, col B = refCPI NS)

0c. Build holdings ladder (standard Algorithm 2):
    Process all holdings longest to shortest
    Calculate ARA for every funded year

0d. Determine official range:
    firstYear = first year with holdings
    lastYear = last contiguous year before any gap above 2040

0e. DARA = SUM(ARA for funded years in range) / count of funded years in range

0f. Identify gap years:
    Years in [firstYear, lastYear] missing from TIPSSAO
```

### Phase 1: Gap Parameters (Reference Guide Step 1)

Calculate synthetic TIPS for gap years (e.g., 2037-2039 as of Feb 2026):
- Interpolate yields between lower anchor (most recently issued 10y TIPS before gaps) and Feb 2040
- Calculate MDURATION for each synthetic
- Gap Avg Duration = average of synthetic durations
- Gap Total Cost = sum of synthetic quantities Ã— $1,000
- Gap Annual Interest By Year = annual interest for each synthetic gap year
- Use target qty for 2040 (not actual holdings) and actual holdings for 2041+

### Phase 1.5: Interest Cascade Substitution

**Conceptual Foundation:**
- Before rebalancing: Bracket excess holdings contribute annual interest to earlier years
- After rebalancing: Bracket excess sold, proceeds buy synthetic gap TIPS (e.g., 2037-2039 as of Feb 2026)
- Gap TIPS contribute annual interest to earlier years
- Expected equivalence: excess bracket interest ≈ synthetic gap interest
- Validation: Net Cash should be near-zero if excess $ approximates gap total cost

**Implementation for Post-Rebalance Calculations:**

For future interest calculations after rebalancing:
1. Bracket years contribute: targetFYQty annual interest (FY portion only)
2. Synthetic gap years contribute: their calculated annual interest (from Phase 1)
3. All other years: actual holdings annual interest

This substitution applies to:
- Rebalance year target calculations (Phase 3)
- Post-rebalance ARA display (Phase 4)

### Phase 2: Bracket Identification and Duration Matching (Steps 2-6)

```
2. Identify brackets:
   Upper: 2040 (always Feb maturity)
   Lower: Among holdings in [LOWEST_LOWER_BRACKET_YEAR, firstGapYear),
          pick the single CUSIP with most ARA

3. Calculate MDURATION for each bracket maturity

4. Weights:
   lowerWeight = (upperDuration - gapAvgDuration) / (upperDuration - lowerDuration)
   upperWeight = 1 - lowerWeight

5. Target FY Qty for each bracket maturity:
   For years with multiple maturities:
     Non-bracket maturities held constant
     Residual P+I = (DARA - future interest) - SUM(non-bracket P+I)
     Target FY Qty = ROUND(Residual / P+I per bond)

6. Duration matching in dollars:
   Target Excess $ = Gap Total Cost Ã— weight
   Cost per bond = price/100 Ã— indexRatio Ã— 1000
   Holdings Excess $ = (current qty Ã— costPerBond) - (targetFYQty Ã— costPerBond)
   Buy/Sell $ = Target Excess $ - Holdings Excess $
   Buy/Sell Qty = ROUND(Buy/Sell $ / costPerBond)
   Post-Rebal Qty = current qty + Buy/Sell Qty
```

### Phase 3: Rebalance Year Buys (V2)

Process rebalance years **longest to shortest** (critical principle):

```
For each rebalance year:
  1. Find target maturity: CUSIP with most holdings in that year
  2. Calculate future interest from later years:
     - Actual holdings interest from years > rebalance year
     - PLUS added interest from buys in later rebalance years (cascade)
  3. Target FY P+I = DARA - future interest
  4. Target FY Qty (residual method if multiple maturities)
  5. Qty Delta = Target FY Qty - current qty (positive = buy)
  6. Cost Delta = -(qty delta Ã— cost per bond) (negative = cash outflow)
  7. Track added annual interest for earlier rebalance years
```

### Phase 4: Verification Output

**Main table columns:**
- CUSIP, Qty, Maturity, FY, Principal FY, Interest FY, ARA FY, Cost FY
- Target Qty, Qty Delta, Target Cost, Cost Delta
- ARA FY (FY Only), ARA-DARA Before, ARA FY Post, ARA-DARA After

**Sign conventions:**
- Qty Delta: negative = sell, positive = buy
- Cost Delta: positive = cash received (sell), negative = cash outflow (buy)
- Net Cash = SUM(Cost Delta): positive = excess cash, negative = need to add funds

**ARA columns:**
- ARA FY: Full holdings ARA (includes excess bracket bonds)
- ARA FY (FY Only): Bracket years use targetFYQty instead of full qty â€” shows FY-only ARA
- ARA FY Post: Post-rebalance ARA using updated quantities and future interest
- ARA-DARA: Gap between ARA and target â€” minimizing this is an overarching goal

**Summary table:**
- Parameters (settlement date, refCPI, DARA, firstYear, lastYear, rungs)
- Gap parameters (avg duration, total cost)
- Bracket details (duration, current/post-rebal/targetFY/excess quantities and costs)
- Weight verification: Target vs Before vs After
- Rebalance years list
- Net Cash

### Weight Verification
```
Before weights: current excess $ / total current excess $ for each bracket
After weights: post-rebal excess $ / total post-rebal excess $ for each bracket
Target weights: from duration matching formula (Step 4)

Expected: After weights â‰ˆ Target weights (minor rounding differences)
Before weights typically show lower bracket overweighted (insufficient rebalancing since build)
```

## Important Formulas (Tier 1b conventions)

All calculations use Tier 1b formulas:
```
indexRatio = refCPI / refCPIOnDated
adjustedPrincipal = 1000 Ã— indexRatio   (faceValue = 1000)
adjustedAnnualInterest = adjustedPrincipal Ã— couponRate
lastYearInterest = adjustedAnnualInterest Ã— (month < 7 ? 0.5 : 1.0)
piPerBond = adjustedPrincipal + lastYearInterest
cleanCost = qty Ã— (price / 100 Ã— indexRatio Ã— 1000)
```

## Critical Principles

1. **ALWAYS process longest to shortest maturity** for future interest calculations
2. **Future interest** from years STRICTLY GREATER than current year
3. **Bracket maturity selection**: CUSIP with most holdings gets rebalanced; others held constant
4. **Rebalance years** are always > lower bracket year and < first gap year (exclusive both ends)
5. **Rebalance year interest cascades**: Buying into 2036 adds annual interest that affects 2035's target calculation, etc.
6. **Gap year synthetic interest**: DO NOT add back to future interest pool
7. **P+I for FY, $ for duration matching**: Two different units for two different purposes
8. **FY-only ARA for bracket years**: When showing bracket year ARA comparable to DARA, use targetFYQty and exclude excess â€” both for P+I contribution AND for annual interest contribution to earlier years' future interest

## Open Issues

### Proceeds Constraint
**Resolution:** Show Net Cash as validation metric (option c).
- Near-zero validates that excess allocation matched gap needs
- Positive = over-funded (excess cash after rebalancing)
- Negative = under-funded (additional funds needed)
- User decides whether to add external funds for shortfall

### FY-Only Future Interest Consistency
**Resolution:** Use targetFYQty for bracket years and synthetic gap interest in future interest calculations (per Phase 1.5).

For "FY-only" and "Post-rebalance" ARA displays:
- Bracket years contribute annual interest based on targetFYQty (not full holdings)
- Synthetic gap years contribute their calculated annual interest
- This ensures internal consistency in ARA-DARA comparisons
- Bracket years: ARA(FY only) ≈ DARA (small gap due to rounding)
- Earlier years: future interest reflects FY portion from brackets + gap interest, not excess

## Configuration

```javascript
const LOWEST_LOWER_BRACKET_YEAR = 2032;  // Global constant, easily changed per ladder
```

## Data Sources

| Data | Source | Purpose |
|------|--------|---------|
| Holdings | Holdings sheet (CUSIP, Qty, Maturity) | Current portfolio |
| TIPSSAO | TIPSSAO sheet (CUSIP, Maturity, Coupon, Yield, Price) | Market data |
| TIPSref | TIPSref sheet (CUSIP, RefCPI on Dated Date) | Inflation adjustment |
| RefCPI | RefCPI sheet (Date, RefCPI NS) | Current reference CPI |
| Holidays | Holidays sheet (Date) | Settlement date calculation |

No dependency on LadderBuilder sheet â€” all parameters derived from holdings and reference data.

# Tier 3: TIPS Ladder Rebalancing for Duration-Matched Gap Coverage

**Dependencies:** Tier 1a (Bond Basics), Tier 1b (TIPS Basics), Tier 2a (Bond Ladder Basics), Tier 2b (TIPS Ladder Basics), Reference Guide v1.1

## Purpose

Rebalance an existing TIPS ladder by selling excess holdings from bracket years and buying into formerly-gap years (now available) to improve duration matching and reduce ARA-DARA gaps across funded years.

## Context

When a TIPS ladder was originally built (e.g., 2023), certain years had no TIPS available (gap years, e.g., 2034-2039). Excess holdings were concentrated in bracket years flanking the gaps to duration-match the missing coverage. Over time, Treasury issues new TIPS filling some former gap years (e.g., 2033-2036 now available). Rebalancing sells excess from bracket years and buys into these newly available maturities.

## Key Concepts

### Official Ladder Range
- **firstYear**: Earliest year with holdings
- **lastYear**: Latest contiguous year with holdings before any gap above 2040
- Gap years above 2040 truncate the official range (e.g., holdings in 2047 and 2049 but not 2048 → lastYear = 2047)
- Known gap years (2037-2039, no TIPS issued) do NOT break contiguity

### DARA Derivation
DARA is not an input — it is inferred from current holdings:
1. Calculate ARA for every funded year using the standard holdings ladder algorithm (Algorithm 2 from Reference Guide)
2. Sum ARA for all years within the official range (firstYear to lastYear), excluding gap years
3. DARA = total ARA / number of funded rungs in range

### Gap Years
Years within the official ladder range where no TIPS exist in TIPSSAO. Currently 2037, 2038, 2039.

### Bracket Years
- **Upper bracket**: Always 2040 (Feb maturity)
- **Lower bracket**: Dynamically identified — the single holding with the most bonds among all maturities in years between `LOWEST_LOWER_BRACKET_YEAR` (configurable constant, default 2032) and the first gap year (exclusive)
- **Bracket maturity**: The specific CUSIP within a bracket year that has the most holdings

### Rebalance Years
Years between the lower bracket year and the first current gap year, exclusive on both ends. These were gap years when the ladder was originally built but now have TIPS available.
- Lower bracket 2032 → rebalance years: 2033, 2034, 2035, 2036
- Lower bracket 2034 → rebalance years: 2035, 2036
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
- Interpolate yields between lower anchor (Jan 2036) and upper anchor (Feb 2040)
- Calculate synthetic coupon: MAX(0.00125, FLOOR(yield × 100 / 0.125) × 0.00125)
- Calculate MDURATION for each synthetic
- Gap Avg Duration = average of synthetic durations
- Gap Total Cost = sum of synthetic quantities × $1,000
- **Gap Annual Interest By Year** = annual interest for each synthetic gap year (qty × 1000 × syntheticCoupon). This is returned for use in Phase 1.5.
- Use target qty for 2040 (not actual holdings) and actual holdings for 2041+
- DO NOT add synthetic gap year interest back to the gap future interest pool

**Note on Gap Total Cost:** This can be larger than expected when years above 2040 are underfunded relative to DARA. Less interest from later maturities means more bonds needed for each gap year, increasing total cost.

### Phase 1.5: Interest Cascade Substitution (Implemented)

**Conceptual Foundation:**
- Before rebalancing: Bracket excess holdings contribute annual interest to earlier years
- After rebalancing: Bracket excess sold, proceeds buy into rebalance years and hypothetical gap TIPS
- Gap TIPS and rebalance year TIPS contribute annual interest to earlier years
- The substituted future interest map replaces the bracket excess interest with FY-only bracket interest plus synthetic gap interest

**Implementation — `substitutedFutureInterestByYear` map:**

Built after bracket targets (Phase 2) are computed:

```
For each year in futureInterestByYear:
  If year is a bracket year:
    For bracket maturity: use targetFYQty (not full holdings qty)
    For non-bracket maturities in that year: use actual qty (held constant)
    substitutedFutureInterestByYear[year] = sum of above
  Else:
    substitutedFutureInterestByYear[year] = futureInterestByYear[year]

Then add synthetic gap year entries:
  For each gap year:
    substitutedFutureInterestByYear[gapYear] = gapAnnualInterestByYear[gapYear]
```

This substituted map is used by:
- **Phase 3**: Rebalance year target calculations (future interest from later years)
- **Phase 4 "Before" ARA**: FY-only view with bracket targetFYQty P+I + substituted future interest
- **Phase 4 "After" ARA**: Post-rebalance view uses substituted map + rebalance added interest

### Phase 2: Bracket Identification and Duration Matching (Steps 2-6)

```
2. Identify brackets:
   Upper: 2040 (always Feb maturity)
   Lower: Among holdings in [LOWEST_LOWER_BRACKET_YEAR, firstGapYear),
          pick the single CUSIP with most holdings (by qty)

3. Calculate MDURATION for each bracket maturity

4. Weights:
   lowerWeight = (upperDuration - gapAvgDuration) / (upperDuration - lowerDuration)
   upperWeight = 1 - lowerWeight

5. Target FY Qty for each bracket maturity:
   Future interest uses futureInterestByYear (full holdings — not substituted)
   For years with multiple maturities:
     Non-bracket maturities held constant
     Residual P+I = (DARA - future interest) - SUM(non-bracket P+I)
     Target FY Qty = ROUND(Residual / P+I per bond)

6. Duration matching in dollars:
   Target Excess $ = Gap Total Cost × weight
   Cost per bond = price/100 × indexRatio × 1000
   Holdings Excess $ = (current qty × costPerBond) - (targetFYQty × costPerBond)
   Buy/Sell $ = Target Excess $ - Holdings Excess $
   Buy/Sell Qty = ROUND(Buy/Sell $ / costPerBond)
   Post-Rebal Qty = current qty + Buy/Sell Qty
```

**Note:** Step 5 uses `futureInterestByYear` (full holdings), not the substituted map. This is correct because we're calculating what the FY qty should be given the current ladder state.

### Phase 3: Rebalance Year Buys (V2)

Process rebalance years **longest to shortest** (critical principle):

```
For each rebalance year:
  1. Find target maturity: CUSIP with most holdings in that year
  2. Calculate future interest from later years using substitutedFutureInterestByYear:
     - Substituted interest from all years > rebalance year
     - PLUS added interest from buys in later rebalance years (cascade)
  3. Target FY P+I = DARA - future interest
  4. Target FY Qty (residual method if multiple maturities)
  5. Qty Delta = Target FY Qty - current qty (positive = buy)
  6. Cost Delta = -(qty delta × cost per bond) (negative = cash outflow)
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
- ARA FY (FY Only): Uses substitutedFutureInterestByYear for future interest; bracket years use targetFYQty for P+I — shows what the ladder produces excluding excess
- ARA FY Post: Uses substitutedFutureInterestByYear + rebalanceAddedInterest for future interest; bracket years use targetFYQty for P+I, rebalance years use postRebalQty
- ARA-DARA: Gap between ARA and target — minimizing this is an overarching goal

**Summary table:**
- Parameters (settlement date, refCPI, DARA, firstYear, lastYear, rungs)
- Gap parameters (avg duration, total cost)
- Bracket details (duration, current/post-rebal/targetFY/excess quantities and costs)
- Weight verification: Target vs Before vs After
- Rebalance years list
- Net Cash
- Excess Balance Check (see below)

### Weight Verification
```
Before weights: current excess $ / total current excess $ for each bracket
After weights: post-rebal excess $ / total post-rebal excess $ for each bracket
Target weights: from duration matching formula (Step 4)

Expected: After weights ≈ Target weights (minor rounding differences)
Before weights typically show lower bracket overweighted (insufficient rebalancing since build)
```

### Excess Balance Check

Validates whether brackets were properly funded for the full gap coverage task. Three components:

```
1. Bracket Excess $ (gapExcess):
   For each bracket: (currentQty - targetFYQty) × costPerBond
   Sum across both brackets

2. Cost to Fill Rebalance Years (costForPrevGaps):
   For each rebalance year: targetFY cost - current holdings cost
   Sum across all rebalance years

3. Gap Hypothetical Cost (gapCost):
   Sum of synthetic gap year quantities × $1,000
   (from Phase 1 calculation)

Surplus/(Shortfall) = 1 - 2 - 3

Near-zero: Brackets were properly funded for full gap coverage
Large negative: Brackets underfunded — insufficient excess to cover both
  rebalance year buys and hypothetical gap year needs
Large positive: Brackets overfunded
```

**Note:** Gap Total Cost can be higher than expected when years above 2040 are underfunded relative to DARA (less interest from later maturities → more gap TIPS needed → higher gap cost).

## Important Formulas (Tier 1b conventions)

All calculations use Tier 1b formulas:
```
indexRatio = refCPI / refCPIOnDated
adjustedPrincipal = 1000 × indexRatio   (faceValue = 1000)
adjustedAnnualInterest = adjustedPrincipal × couponRate
lastYearInterest = adjustedAnnualInterest × (month < 7 ? 0.5 : 1.0)
piPerBond = adjustedPrincipal + lastYearInterest
cleanCost = qty × (price / 100 × indexRatio × 1000)
```

## TIPSSAO Column Mapping

Yields and prices from TIPSSAO use seasonally-adjusted + outlier-corrected values:

| Column | Index (0-based) | Field | Usage |
|--------|----------------|-------|-------|
| A | 0 | CUSIP | Lookup key |
| B | 1 | Maturity | Maturity date |
| C | 2 | Coupon rate | Annual coupon (decimal) |
| D | 3 | Ask yield | Not used |
| E | 4 | SA yield | Not used |
| F | 5 | SA+O yield | **Used for duration calcs and gap interpolation** |
| G | 6 | Ask price | **Used for cost calculations** |

SA = seasonally adjusted. SA+O = seasonally adjusted + outlier factor (additional adjustment).

## Critical Principles

1. **ALWAYS process longest to shortest maturity** for future interest calculations
2. **Future interest** from years STRICTLY GREATER than current year
3. **Bracket maturity selection**: CUSIP with most holdings gets rebalanced; others held constant
4. **Rebalance years** are always > lower bracket year and < first gap year (exclusive both ends)
5. **Rebalance year interest cascades**: Buying into 2036 adds annual interest that affects 2035's target calculation, etc.
6. **Gap year synthetic interest**: DO NOT add back to gap future interest pool during Phase 1 calculation
7. **P+I for FY, $ for duration matching**: Two different units for two different purposes
8. **FY-only ARA for bracket years**: When showing bracket year ARA comparable to DARA, use targetFYQty and exclude excess — both for P+I contribution AND for annual interest contribution to earlier years' future interest
9. **Phase 1.5 substitution scope**: Bracket targets (Phase 2 Step 5) use full holdings `futureInterestByYear`; rebalance targets (Phase 3), "Before" ARA, and "After" ARA use `substitutedFutureInterestByYear`
10. **Phase 1 must return gapAnnualInterestByYear**: Needed by Phase 1.5 to populate substituted future interest for gap years

## Resolved Issues

### Proceeds Constraint
**Resolution:** Show Net Cash and Excess Balance Check as validation metrics.
- Net Cash = SUM(Cost Delta) across all bracket and rebalance transactions
- Excess Balance Check decomposes: bracket excess $ − rebalance fill cost − gap hypo cost
- Near-zero surplus validates proper bracket funding
- Negative shortfall = brackets underfunded; user decides whether to add external funds
- Positive surplus = brackets overfunded; excess cash after all transactions

### FY-Only Future Interest Consistency
**Resolution:** Implemented via Phase 1.5 Interest Cascade Substitution.
- `substitutedFutureInterestByYear` map built after bracket targets computed
- Bracket years contribute targetFYQty annual interest (FY portion only)
- Synthetic gap years contribute their calculated annual interest
- All other years use actual holdings annual interest
- Used for: rebalance year targets, "Before" ARA, "After" ARA (+ rebalance added interest)
- Result: Bracket year ARA(FY only) ≈ DARA (small gap due to rounding); earlier years see consistent future interest

## Configuration

```javascript
const LOWEST_LOWER_BRACKET_YEAR = 2032;  // Global constant, easily changed per ladder
```

## Data Sources

| Data | Source | Purpose |
|------|--------|---------|
| Holdings | Holdings sheet (CUSIP, Qty, Maturity) | Current portfolio |
| TIPSSAO | TIPSSAO sheet (CUSIP, Maturity, Coupon, SA+O Yield, Ask Price) | Market data |
| TIPSref | TIPSref sheet (CUSIP, RefCPI on Dated Date) | Inflation adjustment |
| RefCPI | RefCPI sheet (Date, RefCPI NS) | Current reference CPI |
| Holidays | Holidays sheet (Date) | Settlement date calculation |

No dependency on LadderBuilder sheet — all parameters derived from holdings and reference data.

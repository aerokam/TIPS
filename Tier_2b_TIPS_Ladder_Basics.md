# Tier 2b: TIPS Ladder Basics

**Dependencies:** Tier 1a (Bond Basics), Tier 1b (TIPS Basics), Tier 2a (Bond Ladder Basics)

**Foundation:** Tier 2a (Bond Ladder Basics) with Tier 1b (TIPS) adjustments

**Terminology Changes:**
- DAA → DARA (Desired Annual Real Amount)
- AA → ARA (Annual Real Amount)
- All values use inflation-adjusted calculations from Tier 1b

**Gap Years:** Years within ladder period where no TIPS exist (currently 2037, 2038, 2039)

**Synthetic TIPS for Gap Years:**
- Maturity: January 15 of gap year
- Index ratio: 1.0
- Price: 100 (par)

**Yield Interpolation:**
```
Anchors: Latest maturity before gaps, first maturity after gaps
Example: Jan 2036 and Feb 2040

syntheticYield = lowerYield + (gapDate - lowerDate) * (upperYield - lowerYield) / (upperDate - lowerDate)
```

**Coupon:**
```
syntheticCoupon = MAX(0.00125, FLOOR(syntheticYield * 100 / 0.125) * 0.00125)
```

**Algorithm:** Tier 2a algorithm with:
1. Add: Identify gaps, create synthetic TIPS
2. Substitute: All Tier 1b TIPS formulas for inflation adjustment

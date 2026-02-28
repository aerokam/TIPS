# TIPS Ladder Project - Ultimate Vision

## End State: Web Interface Tool

**Input**: 
- User's current holdings (CUSIP, quantity)
- Parameters (DARA, settlement date, etc.)

**Output**:
- Current ladder display
- Rebalancing changes needed to align with duration matching

---

## Development Roadmap

### Version 1: Bracket Year Rebalancing
- Holdings input → Calculate duration matching targets for bracket years
- Output: What to buy/sell in bracket maturities to align excess holdings with gap duration

### Version 2: Reinvestment of Proceeds
- Extend V1: Take proceeds from bracket sales
- Reinvest into previously-gap-year maturities (years that became available since original ladder build)
- Example: Ladder built 2023 had gaps 2034-2039. Now (2026), 2034-2036 available. Use proceeds to buy those.
- Process longest to shortest maturity within gap range
- Stop when proceeds exhausted

### Version 3: Full Ladder Rebuild
- User inputs holdings + new parameters (or accepts current)
- Output: Complete target ladder with all changes needed

---

## Key Implementation Notes

- All algorithms in reference guide apply to V1
- V2 adds sequential buying logic for newly-available maturities
- North star: Clean, simple UX—just upload holdings, get back ladder + changes

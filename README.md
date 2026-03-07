# TIPS Ladder Builder

A free, browser-based tool for building and rebalancing [TIPS](https://www.treasurydirect.gov/marketable-securities/tips/) (Treasury Inflation-Protected Securities) ladders.

**Live app:** https://aerokam.github.io/TipsLadderBuilder/

All calculations run locally in your browser — no data is uploaded anywhere.

---

## What It Does

**Rebalance** — for existing TIPS ladder holders rebalancing into newly issued TIPS. Assumes you want to keep using the same lower bracket TIPS you originally purchased.

**Build** — designs a new TIPS ladder from scratch with zero existing holdings.

---

## Key Concepts

**TIPS** — Treasury bonds whose principal adjusts with CPI inflation. At maturity you receive the inflation-adjusted principal plus the final coupon. All values are in *real* (inflation-adjusted, today's dollars) terms.

**TIPS Ladder** — A portfolio of TIPS maturing in successive years, providing predictable inflation-adjusted income each year throughout the ladder period.

**DARA (Desired Annual Real Amount)** — Your target annual income from the ladder, in today's dollars. Each rung is sized to produce this amount.

**Gap Years** — Years where Treasury has not issued TIPS (currently 2037, 2038, 2039). The ladder holds excess bonds in *bracket* years flanking the gap to match the average duration of the missing maturities.

**Bracket Years** — *Upper bracket*: always the Feb 2040 TIPS. *Lower bracket*: for Build, the latest issued 10-year TIPS before the gap; for Rebalance, the TIPS before the gap with the largest existing holdings.

---

## Inputs

### Rebalance mode

| Field | Description |
|---|---|
| **Holdings CSV** | Two-column CSV with headers `cusip` and `qty`. One row per TIPS position. |
| **DARA ($)** | Target annual real income. Leave blank to auto-infer from current holdings. |
| **Method** | **Gap** — rebalances only bracket years and previous gap years. **Full** — rebalances all rungs across the full contiguous ladder range. |

Holdings CSV format:

```
cusip,qty
912828S50,50
91282CEJ6,30
912810QF8,100
```

### Build mode

| Field | Description |
|---|---|
| **DARA ($)** | Target annual real income (required). Defaults to $10,000. |
| **Last Year** | Final funded year of the ladder. Dropdown populated from available TIPS maturities. |

The first funded year is always the current calendar year. Gap years (2037–2039) are handled automatically.

---

## Duration Matching

For gap years, the tool creates synthetic TIPS (yield-interpolated between the bracket anchors) and calculates their average modified duration. Excess bonds are split between the lower and upper bracket so the weighted duration matches:

```
lowerWt × lowerDur + upperWt × upperDur = gapAvgDuration
e.g.  0.46 × 9.1 (2036) + 0.54 × 12.1 (2040) = 10.7
```

---

## Data Sources

| Data | Source | Schedule |
|---|---|---|
| TIPS prices & yields | FedInvest (TreasuryDirect) | Daily ~1 PM ET, Mon–Fri |
| Reference CPI | BLS (via TreasuryDirect) | Monthly |
| TIPS metadata (coupon, base CPI) | TreasuryDirect securities list | As needed |

Prices are fetched from FedInvest once daily and committed to the repository via GitHub Actions. CSV data is served from Cloudflare R2.

---

## Running Locally

No build step required — open `index.html` in a browser, or serve the project root with any static file server:

```bash
npx serve .
```

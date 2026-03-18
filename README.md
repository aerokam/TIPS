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

**TIPS** — Treasury Inflation Protected Securities: Treasury notes and bonds whose principal adjusts daily with inflation as measured by CPI-U. Coupon interest is paid semi-annually, and is calculated based on the inflation-adjusted principal. At maturity you receive the inflation-adjusted principal plus the final coupon payment. All amounts shown in the application are in *real* (inflation-adjusted, today's dollars) terms.

**TIPS Ladder** — A portfolio of TIPS maturing in successive years, which along with the semi-annual interest payments, provides a predictable inflation-adjusted amount each year throughout the ladder period.

**DARA (Desired Annual Real Amount)** — Your desired annual real amount from the ladder. Each rung is sized to produce this amount.

**Gap Years** — Years where Treasury has not issued TIPS (currently 2037, 2038, 2039). The ladder holds excess bonds in TIPS maturing in *bracket* years, bracketing the gap, to match the average duration of hypothetical TIPS that represent the missing maturities.

**Bracket Years** — Maturity years bracketing the gap years. *Upper bracket*: always the Feb 2040 TIPS. *Lower bracket*: TIPS maturing in a year before the first gap year; the typical use case is a maturity of 2035 or lower as of the initial development of this project. In **3-bracket mode**, a second "new lower" bracket (the most recently issued 10-year TIPS) is used alongside the original lower bracket for more efficient duration matching.

---

## Data Sources

| Data | Source | Schedule |
|---|---|---|
| TIPS prices & yields | FedInvest (TreasuryDirect) | Daily ~1 PM ET, Mon–Fri |
| Reference CPI | BLS (via TreasuryDirect) | Monthly |
| TIPS metadata (coupon, base CPI) | TreasuryDirect securities list | As needed |

Prices are fetched from FedInvest once daily by GitHub Actions and uploaded to Cloudflare R2. The app fetches the CSV data directly from R2.

---

## Running Locally

No build step required — open `index.html` in a browser, or serve the project root with any static file server:

```bash
npx serve .
```

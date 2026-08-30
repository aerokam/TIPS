# AMD Formula Analysis — Working Notes
*Status: Historical analysis log (Rev 1–4). Superseded by **Revision 5 — Option C**, refined by **Revision 6** (cover Amount accounting + roll coupon) and **Revision 7** (2056 lower cover AMD flipped on), all shipped to `main`. Read Rev 7 then 6 then Rev 5 (bottom) first; Rev 1–4 are kept for the derivation history. Canonical spec is 2.0 §Future 30Y Cover AMD.*

---

## Background

The TipsLadderManager was recently enhanced to include Accrued Market Discount (AMD) from excess 2052 TIPS holdings as an income source that reduces the number of funded-year bonds needed. The current implementation was found to use the wrong mathematical model.

---

## Foundational Principle (confirmed, do not change)

**Sell as soon as possible.** Each year a new 30Y TIPS is issued (2057 in Feb 2027, 2058 in Feb 2028, …, 2066 in Feb 2036), excess 2052 holdings are sold and the proceeds used to buy the newly-issued bond. This is the foundational design principle of the rebalancing feature.

Duration matching with bracket pairs (2052 upper cover, 2056 lower cover) is a **temporary approximation** — a placeholder until the actual desired TIPS become available. Rolling into each new issuance as soon as possible replaces synthetic coverage with actual coverage, which improves duration matching by keeping bracket years as close together as possible. This minimizes drift from non-parallel yield curve shifts.

*Note (Rev 1 framing — superseded): a "hold to maturity" variant (excess 2052s never sold, AMD realized only at 2052 maturity) was flagged here as a possible future enhancement. It became the chosen design in **Rev 5 (Option C)** below: income is decoupled from sales — AMD is realized each year by selling the market discount that accrued over the prior year, not by an annual sell-into-roll swap into the newly-issued 30Y. The sell-ASAP/swap paradigm in this Background block is no longer current.*

---

## Why the Current Formula Is Wrong

The current spec and code use **annual accretion on remaining holdings**:

```
AMD(Y) = exQty × (2036 − Y) / N × amdPerBondPerYear    ← WRONG (not cash)
```

This is an accounting entry, not a cash flow. No cash arrives from market discount accretion — cash only arrives when bonds are **sold**. Since the funded year's purpose is to pay actual liabilities, only real cash flows count. Annual accretion does not fund liabilities.

Additionally, this formula produces a **decreasing** AMD profile (maximum in 2027, near zero in 2036), which is the wrong direction.

---

## Definitions

```
settlementYear       = 2026  (current)
N                    = 2036 − settlementYear = 10  (total swaps: one per year 2027–2036)
exQty                = excess 2052 bonds at settlement (constant — fixed at settlement)
C                    = cost per bond at settlement (accreted price, ~65 cents on the dollar × index ratio × 1000)
amdPerBondPerYear    = (principalPerBond − C) / yearsToMaturity  (straight-line annual accretion rate)
rate                 = shorthand for amdPerBondPerYear in formulas below
```

First swap year: **settlementYear + 1 = 2027** (the 2056 and 2036 TIPS were already issued in early 2026, so they are held at settlement; the next new 30Y TIPS is the 2057, issuing February 2027).

---

## Correct Cash-Flow Framing

For funded year Y, AMD cash income = **(gain above original cost) × (quantity sold in year Y)**.

Under constant yields, each bond accretes straight-line toward par. A bond sold in year Y has appreciated for (Y − settlementYear) years:

```
gain per bond sold in year Y = (Y − settlementYear) × rate
```

---

## Model 1: Flat Quantity (Simple Approximation)

Assume exQty / N bonds are sold each year regardless of price changes.

```
qty_sold(Y)   = exQty / N   (constant)
AMD_cash(Y)   = (exQty / N) × (Y − settlementYear) × rate
```

| Year | Qty sold | Gain/bond | AMD cash |
|------|----------|-----------|----------|
| 2027 | exQty/N  | 1 × rate  | exQty/N × 1 × rate |
| 2028 | exQty/N  | 2 × rate  | exQty/N × 2 × rate |
| …    | …        | …         | … |
| 2036 | exQty/N  | 10 × rate | exQty/N × 10 × rate |

AMD profile: **linearly increasing**, peaks at 2036. No special case needed for 2036 (the old `2/12` partial-year factor was an artifact of the wrong annual-accretion model and does not apply here).

Total AMD realized: `exQty × rate × N(N+1)/2 / N = exQty × rate × (N+1)/2`
For N=10: `exQty × rate × 5.5`

---

## Model 2: Variable Quantity (More Accurate)

As the 2052 accretes, each bond is worth more, so **fewer bonds need to be sold** each year to raise the same dollar amount for the new 30Y TIPS purchase. Under constant yields the new 30Y TIPS cost is roughly constant per year, so:

```
qty_sold(Y)  ∝  1 / price_2052(Y)  =  1 / (C + (Y − settlementYear) × rate)
AMD_cash(Y)  ∝  (Y − settlementYear) × rate / (C + (Y − settlementYear) × rate)
```

Let `x = (Y − settlementYear) × rate`:

```
AMD_cash(Y)  ∝  x / (C + x)
```

This is still **increasing** in Y (correct direction), but curves toward an asymptote rather than rising linearly. For the 2052, C (cost per bond) is large relative to x over the 10-year window, so the curve is close to linear in practice — but not identical.

---

## Decisions Made

1. **Model 1 (flat quantity) implemented.** C >> x for the 10-year window; error is small. Model 2 (variable qty) deferred as a future refinement if needed.

2. **2036 partial-year special case removed.** The old `(2/12)` factor was an artifact of the annual-accretion model. Under realized-at-sale, 2036 is a normal year — the last tranche has appreciated the most and gets the highest AMD.

3. **AMD-driven rebalance year range extended to include 2036** (`y <= 2036` instead of `y < 2036`).

## Changes Made

| File | Change |
|------|--------|
| `src/build-lib.js` | `calcFuture30yUpperAnnualAmd` — new formula, updated comment |
| `src/rebalance-lib.js` | `calcFuture30yUpperAnnualAmdForQty` — new formula; rebalYearSet loop upper bound `< 2036` → `<= 2036` |
| `knowledge/2.0_TIPS_Ladders.md` | §Future 30Y Upper Cover AMD — formula, narrative, PLI note |
| `knowledge/4.0_Computation_Modules.md` | §Future 30Y Upper Cover AMD — formula; AMD-driven rebalance years range |

---

## Revision 2 — Constant-Yield Method + Per-Rung Quantity (current)

The straight-line model above (Model 1) was superseded. Two problems with flat `exQty / N`:

1. **Quantity is not flat.** The excess 2052 is the long-duration lever in the cover pair. Rolling into the *nearest* new 30Y (2057, adjacent to the 2056) releases almost no 2052 (upper weight ≈ 0.0075); rolling into the *farthest* (2066) releases the most. Selling `exQty / N` every year mis-states both ends by large factors. The per-year quantity must come from the duration-match decomposition.

2. **Accretion is not linear.** A deep-discount bond accretes **convexly** toward par under a constant yield. Straight-line overstates early-year gain and understates late-year gain.

### The two-factor (decoupled) model

```
q(Y)           = rung.qty × 1000 × wUpper(rung) / costPerBond_2052      // duration side
gainPerBond(Y) = (priceFromYield(yield, coupon, saleDate(Y), mat) − price) / 100 × IR_settle × 1000   // pricing side
AMD(Y)         = q(Y) × gainPerBond(Y)
   saleYear(Y) = rung.year − 30   (nearest-first roll: 2057→2027 … 2066→2036)
   wUpper(rung)= (rung.dur − d_2056) / (d_2052 − d_2056)
```

- **Quantity** is a pure duration result; **gain** is a pure pricing result; AMD is their product. This is the decoupling MtnBiker pushed for: income realization is driven by accretion/duration drift, not by the purchase decision — yet it coincides with the "sell to buy the new 30Y" roll, which remains the founding paradigm (assume each new 30Y *is* bought).
- **Closure is exact:** with the Future 30Y average duration computed **cost-weighted** (`Σ qty·dur / Σ qty`), `Σ q(Y) = future30yUpperExQty` identically — the schedule is a partition of the held excess, no residual. Verified empirically (a simple-mean average left a ~4.66% residual; cost-weighting removes it).
- **Cost-weighting also applies to the gap years** — required now that per-year DARA can be uneven (a heavier-funded rung must pull the average toward its duration). Simple mean is wrong under uneven funding.
- **`N`, `amdPerBondPerYear`, and the hardcoded `≤ 2036` cap are removed.** The sale-year range is exactly `{rung.year − 30}`, so a smaller `lastYear` shortens it automatically.

### Empirical shape (DARA $80k, 2027–2066, settlement 2026-05-29)

`q(Y)` ran 0.7 (2027, buy 2057) → 110 (2036, buy 2066); `gainPerBond` ran $11 → $170; total AMD ≈ $64.8k vs $61.9k under flat-1/N — similar total, very different (back-loaded) shape.

### Decisions

- **Sale date** = last calendar day of February (`new Date(saleYear, 2, 0)`). The trading-day adjustment (≤ 3 days on a 26-year bond) is immaterial to the accreted price, so bond-holiday data is not threaded into the libs.
- **Yield anchor** = the 2052's own quoted YTM held constant; cost basis = its quoted price.
- **2052 only.** The 2056 cover carries a smaller discount; AMD for it is a possible future extension.

### Changes Made (Revision 2)

| File | Change |
|------|--------|
| `src/build-lib.js` | `calcGapParams` + `calcFuture30yParams` avgDuration → cost-weighted; `calcFuture30yUpperAnnualAmd` → `amdByYear` map (constant-yield × per-rung q); removed `future30yUpperN` / `future30yUpperAmdPerBondPerYear`; import `priceFromYield` |
| `src/rebalance-lib.js` | same avgDuration + AMD changes; `calcFuture30yUpperAnnualAmdForQty` scales the map linearly; `rebalYearSet` follows sale years (no `≤ 2036`) |
| `knowledge/2.0_TIPS_Ladders.md` | §Future 30Y Upper Cover AMD rewrite; §Duration Matching cost-weighted note; Transparency derivation note |
| `knowledge/4.0_Computation_Modules.md` | AMD section rewrite; gap `avgDuration` comment |

---

## Revision 3 — AMD as interest on the held position (current)

Revision 2 booked AMD as `q(Y) × gainPerBond(Y)` — the realized gain on *the bonds sold that year*. That is the wrong **timing**. Because the near rungs (2057, adjacent to the 2056 lower cover) release almost no 2052 (`q ≈ 0.7`), the 2027 AMD came out to ~$9 (or ~$4 at a smaller exQty) — effectively nothing in the early years, with everything dumped at the back (2036 ≈ $18.8k). The user flagged this: the 2052s are deep-discount, near-zero-coupon TIPS, and the discount accretes **as it goes** — early years should realize real income.

### Correct framing — AMD is interest

A par bond returns its yield as coupon; a zero-coupon bond returns it all as accreted discount. The 2052 (0.125% coupon vs ~2.7% yield) is near the zero-coupon end, so almost all its return is accretion. Under the constant-yield method that accretion **is** interest above the coupon. We sell a few bonds each year only to turn that accrued interest into cash — but the **income is the interest that accrued on the position still held**, not the gain on the bonds sold.

```
adjPrice(Y) = priceFromYield(yield, coupon, saleDate(Y), mat)/100 × IR_settle × 1000;  adjPrice(settle)=cost
a(Y)   = adjPrice(Y) − adjPrice(Y−1)                 // per-bond accretion increment (basis steps up)
qRoll(Y) = rung.qty × 1000 × wUpper(rung) / cost      // 2052s sold into the Feb roll (Σ qRoll = exQty)
H(Y)   = exQty − Σ_{y<Y} qRoll(y)                     // bonds still held entering year Y
AMD(Y) = H(Y) × a(Y)
```

### The exact reconciliation (why Rev 2 and Rev 3 totals are identical)

By Abel (summation by parts), with `Σ qRoll = exQty`:

```
Σ_Y H(Y)·a(Y)  ≡  Σ_Y qRoll(Y)·(adjPrice(Y) − cost)
   (interest realized as it accrues)   (gain on bonds sold)
```

Verified empirically (DARA $80k, exQty 537, settlement 2026-05-29): **both total $64,866** (Rev 2 production was $64,848; the $18 difference is last-trading-day vs last-cal-day Feb rounding). Only the **shape** changed — Rev 3 is a front-loaded hump, Rev 2 was back-loaded:

| saleYr | 2027 | 2028 | 2029 | 2030 | 2031 | 2032 | 2033 | 2034 | 2035 | 2036 |
|---|---|---|---|---|---|---|---|---|---|---|
| **Rev 3 (H×a)** | 6,208 | 8,468 | 8,465 | 8,334 | 7,975 | 7,401 | 6,513 | 5,393 | 3,945 | 2,163 |
| Rev 2 (q×gain) | 9 | 321 | 1,004 | 2,062 | 3,567 | 5,535 | 8,007 | 11,009 | 14,579 | 18,756 |

### Decisions (Revision 3)

- **Income = `H(Y) × a(Y)`** (interest on held position), realized as cash by selling into the roll. Sale qty (`qRoll`) and income are decoupled — the small early `qRoll` does **not** suppress early income.
- **Depletion = the duration roll `qRoll`**, `Σ = exQty` (closure preserved). Selling early depletes the back-end coverage pool; offset by the higher basis of the bonds that remain.
- **Excess only.** Funded-year 2052s are held to maturity (par); their discount is realized at maturity and already in P+I — never double-counted as AMD.
- `saleDate`, constant-yield, IR_settle, 2052-only — unchanged from Rev 2.

### Changes Made (Revision 3)

| File | Change |
|------|--------|
| `src/build-lib.js` | AMD block: `q × gainPerBond` per rung → walk sale years ascending, `AMD(Y) = held × (adjPrice(Y) − prevAdj)`, deplete `held` by `qRoll(Y)`, step basis |
| `src/rebalance-lib.js` | same AMD-block rewrite; `ForQty` linear scale unchanged |
| `knowledge/2.0_TIPS_Ladders.md` | §Future 30Y Upper Cover AMD rewritten to the interest/held-position model + Abel reconciliation |
| `knowledge/4.0_Computation_Modules.md` | AMD pseudocode rewritten (qRoll + held-walk); front-loaded profile note |

### Revisit (Revision 4): "excess only" applied to the rebalance "Before"/inference qty

The "excess only" rule (Rev 3, above) was honored by build and by the rebalance "After" sweep, but the
rebalance **"Before" / DARA-inference** path scaled AMD by `future30yUpperQtyBefore` = the *total* held
2052 (funded + excess), via `s + h.qty`. That over-credited the funded-year 2052s with AMD — exactly
the double-count Rev 3 forbids (funded 2052s mature at par; their discount is in P+I, not AMD). For a
no-trade round-trip this inflated "Amount Before" by ~`(funded/excess)·AMD` on every year (~$500/yr in
the 40k-DARA case), independent of the separately-missing excess-coupon and pre-ladder-credit terms.

**Fix:** `future30yUpperQtyBefore` now sums held **excess** of the 2052 cover bond
(`s + (h.excessQty != null ? h.excessQty : h.qty)`). Our files carry the funded/excess split
(`h.excessQty`) so this is exact; broker files (Formats 1–3, no split) fall back to total held —
**unchanged** until broker handling is revisited. This feeds both the "Before" display and the
`dara === null` AMD-inclusive DARA inference. Locked by the "rebal Before == build amount per year"
invariant in tests/run.js.

---

## Revision 5 — Option C (even, held-to-maturity) — SHIPPED, supersedes Rev 2–4

**The sell-into-roll model documented in Rev 2–4 above is no longer current.** The "hold to maturity"
variant flagged as a possible future PR in the Background note at the top of this file became the chosen
design ("Option C"). It shipped on branch `amd-option-c-and-gap-unification` and merged to `main`.

What changed vs Rev 3/4:

- **Income basis is the full, undepleted excess**, not the depleting held pool. `AMD(Y) = future30yUpperExQty × a(Y)` — there is no `qRoll`, no `H(Y)`, no `wUpper` decomposition. Selling 2052s realizes cash but does **not** reduce the income basis; sale qty and income are fully decoupled, exactly as coupon income is earned on a whole position regardless of which bonds are later sold.
- **Range is every year `settlementYear+1 → 2052 maturity`**, not the `{rung.year − 30}` sale window. AMD is credited to every funded year in ladder range, not just 2027–2036.
- **Profile is even (gently back-loaded by convexity)**, not the front-loaded hump of Rev 3. Still conserving: `Σ a(Y) = par − cost`.
- The Abel reconciliation (Rev 3) and the cost-weighted `Σ qRoll = exQty` closure (Rev 2) no longer apply to AMD — AMD does not use the roll partition at all. Cost-weighted `avgDuration` is still used for the **duration match / cover split** that sizes `future30yUpperExQty`.

Single source of truth: `future30yUpperAmdSchedule()` in `gap-math.js`, consumed by `ladder-core.js`
for both build and rebalance. Canonical spec: **2.0 §Future 30Y Upper Cover AMD** (rewritten to Option C);
implementation detail: **4.0 §Future 30Y Upper Cover AMD**; DARA-inference interaction: **3.0**.

---

## Revision 6 — Cover Amount accounting + cover-roll coupon (MtnBiker) — SHIPPED

Two corrections from MtnBiker, after Option C was live. Both close double-/under-count gaps in how the
Future-30Y cover is **accounted across time**; neither changes the AMD income model itself.

### 6a. Cover Amount must equal the coverage delivered (≈ numFuture30yYears × DARA), not par P+I

The build "Amount" for the cover rows showed `excessQty × pi` — the **par** value at maturity. For the 2052
that double-counts: par = cost + accretion, and the accretion **is** the AMD already credited to funded
years 2027–2052. So the cover total read ~`539,337` (fixture) when the coverage those 10 future years
actually receive is `10 × DARA = 400,000`. The gap brackets already land on `numGapYears × DARA` (they add
their sizing LMI back via `gapLMITotal`); the Future-30Y cover added nothing back.

Fix — the cover Amount mirrors the gap, with one extra term for the discount:
```
excessAmt_b = excessQty_b × pi_b − amdLifetime_b + weight_b × future30yLMITotal
```
- `− amdLifetime_b`: the bond's total AMD, delivered to earlier years, netted out (2052 only today).
- `+ weight_b × future30yLMITotal`: the intra-cover coupon (`Σ breakdown.laterMatInt`) that sized the
  synthetic rungs down — the analog of `gapLMITotal`.
- Result (fixture): `2052 228,641 + 2056 177,329 = 405,970 ≈ 400,000`. The removed `175,366` is exactly
  the 2052 AMD on the 2027–2052 rows. **Conserved across the whole table, counted once.**
- This is keyed by bracket year (`amdLifetimeByBracketYear`), so 2056/2036/2040 auto-correct once given
  AMD schedules. (Scope note: applied to the **build** Amount column; the rebalance Before/After excess
  sub-rows still show raw held P+I, a pre-existing build/rebal display divergence shared by gap brackets.)

### 6b. Cover-roll coupon credited to funded years 2053–2056

AMD runs settlement→2052. After the 2052 matures (at par), its cost basis is reinvested into the actual
Future-30Y TIPS, which pay coupon. The funded years **2053–2056** (between the upper cover's maturity and the
first Future-30Y year) were not being credited that coupon, so they over-funded. Fix: credit the upper-cover
share, `future30yUpperWeight × future30ySeedLMI` (≈ `$5,104/yr` in the fixture), to each of 2053–2056.
**Non-cascading** (years ≤ 2052 are credited via AMD; cascading below 2053 would double-count) — threaded
exactly like AMD: combined into `calcFuture30yExtraIncome = AMD + rollCoupon` for `fyQty`/`fundedYearAmount`,
shown as its own line item, summed into `preLadderRollCouponPool` for ladders starting after 2053. The lower
cover (2056) needs no analog (no funded year between it and the Future 30Y years). The seamless AMD→roll hand-off is the
"rough equivalence" of the excess TIPS' interest+AMD and the Future-30Y coupon that reinvestment buys.

### Generalized for future accountability

`future30yUpperAmdSchedule` was generalized to **`excessAmdSchedule({ bond, exQty, refCPI, settlementYear })`**
— nothing 2052-specific. `sizeLadder` holds an `amdExcessBonds` list (today the 2052 cover only); adding the
2056 / 2036 / 2040 excess there extends sizing, the cover-Amount net-out, and rebalance automatically.

### Changes Made (Revision 6)

| File | Change |
|------|--------|
| `src/gap-math.js` | `future30yUpperAmdSchedule` → generic `excessAmdSchedule({ bond, exQty, … })` |
| `src/ladder-core.js` | `amdExcessBonds` loop → combined `future30yUpperAnnualAmdByYear` + `amdLifetimeByBracketYear`; `future30yRollCouponByYear` + `calcFuture30yExtraIncome`; `future30yLMITotal`; `fundedYearAmount` gains `rollCoupon`; sweep/PLI use extra income; `preLadderRollCouponPool` |
| `src/build-lib.js` | cover `excessAmt` = P+I − amdLifetime + LMI add-back; thread roll coupon; new detail/summary fields |
| `src/rebalance-lib.js` | `excessAmdSchedule` rename; roll-coupon map + `…ForQty`; target `needed` and ARA Before/After subtract AMD+roll; rebalYearSet incl. roll years; DARA inference + natural-ARA recovery add roll |
| `src/drill.js` | "Future-30Y coupon (2052 roll)" line in build + rebal Amount drills; cover-Amount drill shows P+I − AMD + add-back |
| `knowledge/2.0, 3.0, 4.0` | §Excess Amount rewrite; §Cover-roll coupon; fyQty/pool/inference updates |

---

## Revision 7 — 2056 lower cover AMD flipped on — SHIPPED

Rev 6 built the generic hook but only the 2052 upper cover was wired in, so the 2056 lower cover still
showed full par P+I with no AMD net-out. Reasonableness check (40K DARA, 2057–2066): cover total read
`414,747` vs the correct `400,000` — the entire ~14.7K overage lived in the **2056 cover**, exactly its
un-netted lifetime discount accretion. The 2052 cover already landed dead-on (`159,489 ≈ 4×DARA`). Gap
brackets (2036/2040) were on-target because they are near par (negligible accretion) — that asymmetry
*validated* the formula rather than contradicting it.

Fix: push the 2056 cover onto `amdExcessBonds`. Because the machinery is keyed by bracket year, the build
auto-corrects. The rebalance path needed three matching changes since it carries its own AMD threading:
- **Combined target AMD** across both covers (drives target sizing + gap params).
- **Per-cover Before-state AMD**: rebuilt from each cover's *actual held excess* and summed — not a single
  linear rescale, since held 2052-vs-2056 proportions need not match the target split.
- **Per-cover net-out denominator** in `excessCoverageAmt`: scale each cover's lifetime AMD by
  `exQty / (that cover's own target excess)` (was hardcoded to `future30yUpperExQty`).

Result: cover total `2052 228,641 + 2056 171,372 = 400,013 ≈ 400,000`. 210/210 unit (round-trips ZERO net
cash, rebal After ≡ build) and 46/46 e2e pass. The 2056's AMD runs settlement→2056, so funded years
2053–2056 now carry **both** the 2052 cover-roll coupon and the 2056-cover AMD — distinct income, no
double-count. **Lower-cover Amount can exceed its raw par P+I** (LMI add-back > AMD at weight ≈0.76) — correct.

Remaining: the near-par 2036/2040 gap brackets are the last un-modeled excess; adding them to
`amdExcessBonds` would make the ledger uniform, but the effect is small.

### Changes Made (Revision 7)

| File | Change |
|------|--------|
| `src/ladder-core.js` | push 2056 lower cover onto `amdExcessBonds` |
| `src/rebalance-lib.js` | combined target AMD over both covers; per-cover Before-state AMD from held excess (`calcFuture30yUpperAnnualAmdBefore`); `excessCoverageAmt` scales by each cover's own target excess; DARA-inference guard incl. 2056 held |
| `tests/run.js` | Rev 6 block: assert 2056 net-out applied + AMD present @2053 (from 2056); drop stale "no AMD @2053" |
| `knowledge/2.0` | §Future 30Y Cover AMD generalized to both covers; §Excess Amount example updated to 400,013 |

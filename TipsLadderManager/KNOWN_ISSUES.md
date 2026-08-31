# Known Issues — Production Impact Tracker

Bugs found during development that affect (or affected) the shipped app, independent of whatever
feature branch surfaced them. Not a general dev-branch bug list — only entries with real
production impact go here.

---

## OPEN

### Help text still to be walked, section by section

- **The method, agreed 2026-08-30.** Take one help section at a time, show it, take feedback, and
  let the feedback loop back into the specs and the DD where the language is wrong there too.
  Two sections of the Gap Dur popup have been through it; that pass alone found a wrong maturity
  month on every gap row, an average whose stated arithmetic did not produce the figure beside
  it, a weighting that disagreed with its own spec, and vocabulary two renames out of date.
- **Next in that popup:** the modified duration match line and the degenerate-inputs case.
- **Then:** the Bracket Mode help (`#bracket-mode-help`), which the user rates as well written
  but which describes only the case where the bracket year is also a funded year. A bracket year
  whose DARA is 0 holds excess TIPS alone and is not covered.
- **Everything else with user-facing text:** the Amount, Cost, Quantity and Ref CPI drills, the
  Trade Ticket, the Cash Flow Calendar, the status strip, the top-card controls.

### Hard-coded years still in the specs

- Definitions are clean: no spec definition names a year any more. What remains is illustration,
  mostly inside worked explanations where a concrete year is what makes the passage readable
  (the traced 2034/2036 retained-bracket case, for instance).
- **DD §5.1 permits that** — "a value appears only as illustration, marked with the date it was
  true" — but most of them are not marked. Marking them is the open work, and it is a large
  editing pass with a real readability cost, so it has not been started.
### Only one retained lower bracket maturity is identified from holdings

- **Scope, pinned 2026-08-30.** `bracketWeightsN` (`gap-math.js`) already solves the duration
  match for any number of retained lower brackets — they enter as frozen inputs and only the active lower
  and upper weights are solved. What stops at one generation is the code that works out *which*
  holdings are retained, and the Gap Dur popup, which names a single retained lower bracket.
- **The scenario is realistic, not hypothetical.** A ladder can hold excess at Jan 2034 from when
  that was the active lower bracket, then add excess at Jan 2036 when that became active, and now
  face Jul 2036 as the active lower bracket. Two retained lower maturities, one active.
- **A bracket year is not a maturity.** A bracket year may hold both a January and a July
  maturity, so identifying retained generations means identifying maturities, not years
  (DD §Bracket Maturity). The popup now names every bracket by month and year for the same
  reason.
- **Status:** out of scope for now, deliberately. Nothing is wrong with the arithmetic when one
  retained maturity is held, which is every case seen so far.
### The vocabulary for what a ladder does, and what happens to its cash flows

- **Found:** 2026-08-28, reviewing the Available Cash help and 2.0 §Available Cash. Repeatedly, over
  one session: "spent", "counted over", "retained toward", "the ladder has received", and a stated
  purpose for a ladder that it does not have.
- **The definition, in the user’s own words**, to be applied to the specs and to every user-facing
  string rather than paraphrased:

  > A ladder generates real cash flows, consisting of interest and principal payments. The goal is
  > for the annual real amount of these cash flows (ARA) to be as close to DARA as possible, given
  > that TIPS are issued in par amounts of 1,000.
  >
  > These real cash flows can be consumed (i.e., spent), retained as cash in the account, or
  > reinvested in the ladder. This applies to all cash flows. The underlying assumption of a TIPS
  > ladder is that the cash flows will be consumed, but that may not be the case, so we should
  > account for the other alternatives.

  Three terms for what becomes of a cash flow, and only three: **consumed**, **retained**,
  **reinvested**. Anything that seems to need a fourth is to be raised rather than invented.
- **What this settles.** Available Cash is the *retained* case. The Coupons control is *reinvested*
  versus retained, for the settlement year’s not-yet-paid coupons. *Consumed* is the default
  assumption everywhere else, which is why a matured rung’s principal is not carried forward as
  available funds.
- **Still to do.** §Maturity Proceeds Are Spent (2.0) needs rewriting under this vocabulary,
  heading included. Its second paragraph is currently wrong: "A holder who has **not** applied it"
  describes the holder not having applied money that Available Cash exists to apply, where the
  point is that the money is still on hand rather than drawn down. The first paragraph opens with a
  purpose a ladder does not have. Both were introduced 2026-08-28; the "spent" wording they replaced
  was the pre-existing text.
- **Left alone deliberately:** 2.0 §AMD’s "turns the accrued discount into spendable cash", where
  the word means realizable, not applied toward an Amount.
- **Status:** open, and the next thing to pick up.

### Help text is not covered by any test

- Every wording defect found on 2026-08-28 was found by reading, not by a failing test, and a
  handful of status-strip assertions pin phrases only incidentally. The defects were not stylistic:
  "Includes every settlement-year payment" claimed both of Available Cash’s components when a
  broker file can only ever have one, and "retained toward that year’s Amount rather than
  reinvested or spent" contradicted the definition of the figure three paragraphs above it.
- **Worth knowing** because the natural response is to add tests, and tests are not what would catch
  this. What would: reading each user-facing statement against what the code does, on every pass,
  rather than only the statement that was flagged.
- **Status:** open, no mechanism proposed.

### A broker file cannot name a rung that has already matured

- A file of current positions lists what is held now, so a rung that matured earlier in the
  settlement year is simply absent, and its principal cannot be counted toward that year’s Amount.
- **Handled** by the Available Cash chooser: for a file this app did not save, it says so and the
  holder states the total under **Amount**. Our own CUSIP/Qty export keeps the matured rung, so the
  choices already count it there.
- **Not verified:** a second consequence, raised 2026-08-28 and not measured. For a broker file the
  per-year DARA is mirrored from the holdings, so a missing matured rung does not make the
  settlement year read as underfunded — it makes that year’s *target* read low. The distortion is
  in the ladder’s shape rather than in a spurious purchase, and would only become a purchase if the
  holder then levelled DARA across the years. Measurable against the year-ago all-months fixture.
### Spec/code discrepancy audit (from CLAUDE.md cleanup)

- **Found:** 2026-07-31, during a CLAUDE.md audit that removed content duplicated from specs.
- **Context:** the audit surfaced three pieces of code with no spec coverage, and confirmed one
  real discrepancy elsewhere (`Treasuries/CLAUDE.md`'s stale yield-source list — already fixed).
  These three still need investigation to determine whether they're undocumented-but-correct or
  genuine drift between spec and implementation:
  1. `src/modal.js` (`makeDraggableResizable`) — shared drag/resize frame for every modal (TipsRef,
     maturity picker). No spec documents it.
  2. `inferDARAFromCash()` (`src/rebalance-lib.js`) — binary-searches for the largest DARA where
     `costDeltaSum >= 0`. No spec describes this function; 3.0 instead documents a different
     mechanism (`inferScaledDARAFromPortfolio`'s self-financing scale) for the Run-rebalance path.
     Need to determine whether this is legacy/import-path-only, superseded, or still load-bearing.
  3. `fundedYear`/`runBuild` naming convention (currently in `CLAUDE.md`'s TipsLadderManager
     section) — not stated as a rule in any spec's own naming table (4.0's "Variable Naming
     Harmonization" table covers a different set of variables).
- **Broader ask:** beyond these three, do a fuller pass for other spec/code discrepancies generally
  — not just missing coverage, but places where a spec's claim no longer matches what the code
  actually does.
- **Status:** open, not yet investigated.

### A year-old ladder, reloaded, is not self-financing

- **Found:** 2026-08-26, running the first realistic year-over-year scenario.
- **Scenario:** ladder built on real FedInvest prices for 2025-08-26 (DARA 40,000, first year
  2026, last year 2040), exported, then loaded on live market data for 2026-08-26. A year earlier
  there was no 2036 TIPS at all, so the gap ran 2036–2039 and the lower bracket was Jul 2035;
  today the gap is 2037–2039 and the lower bracket is Jul 2036.
- **Result:** net cash **−12,743**. Every trade reconciles exactly to that figure:

  | trade | qty | cash |
  |---|---|---|
  | 2026 buy (settlement-year rung) | +6 | −7,309 |
  | 2027 | −1 | +1,123 |
  | 2033 | −1 | +1,050 |
  | Jul 2035 excess 77 → 54 | −23 | +23,204 |
  | Jul 2036 new funded rung 0 → 38 | +38 | −38,148 |
  | Feb 2040 excess 45 → 40 | −5 | +7,337 |

  Nothing else moves: 2028–2032, 2034, 2037–2039 and the 2040 funded rung are untouched.
- **The structural trades are correct.** A TIPS that did not exist a year ago now exists and has to
  be bought as a funded rung. The old lower bracket was carrying excess against **four** gap years
  and now covers three, so it needs less; the upper bracket trims for the same reason. The 2035
  position is not dumped — 54 of 77 are retained (2.0 §Retained Bracket Excess).
- **The problem is the funding, not the trades.** Those excess sales happen because the excess is no
  longer needed to duration-match a smaller gap, not in order to pay for the new 10Y. That they
  might cover it was always a hope, never a guarantee. Here they do not: the rebalance ends 12,743
  short, and the app does not say where that money comes from.
- **Spec conflict:** 3.0 §Funding the rebalance states a rebalance must be self-financing, with net
  cash "a small non-negative number". The same section exempts files carrying an explicit
  `#fundedYear,dara` block (our own exports) from the run-time self-financing scale, because the
  build→export→import round trip used to be zero-trade by construction. Once a year of real change
  separates the two ends, that exemption leaves nothing enforcing the funding rule.
- **The shape-preserving fallback still exists, but was switched off here.** 3.0 §Funding the
  rebalance scales the whole per-year shape down to the highest level that funds itself, and it used
  to run only for a file that stated no DARA values of its own — which our own exports always do. So
  the one case that needed the fallback was the one case excluded from it. **Fixed 2026-08-27**, with
  two further defects found on the way: the scale re-derived the shape from holdings instead of
  scaling the plan the file stated, and the search trialled a different ladder from the one it then
  executed. See §FIXED below.
- **Measured, on this scenario:**

- **Measured, on this scenario** (re-measured 2026-08-27 against live prices, so the figures move a
  little from day to day; the shape of the result does not):

  | setting | net cash | resulting DARA |
  |---|---|---|
  | before the fix | −12,745 | 41,454 |
  | shape-preserving scale on | **+757** | 40,446 (−2.4%) |
  | settlement-year coupons counted, scale off | −5,435 | 41,454 |
  | both | **+204** | 40,862 (−1.4%) |

  The scale alone now makes the rebalance self-financing, at a cost of 2.4% of ARA. Counting the
  settlement year's already-paid coupons (6,987 here) removes the 2026 buy outright and brings the
  cost down to 1.4%.
- **Status: fixed 2026-08-27**, in two parts — the self-financing scale runs for these files again,
  and coupons already received are offered as Available Cash. Together they land this scenario at
  **+204** net cash for a 1.4% reduction in ARA. See §FIXED below. Scenario is reproducible — see
  §Reproducing the year-over-year scenario.

### Ref CPI basis change contributes a bond or two of its own

- **Found:** 2026-08-26.
- **Effect:** reloading an export whose Ref CPI date differs from the settlement date moves the
  bracket years by up to about two bonds. Measured across 240 runs (four ladder lengths, twelve
  build dates, five DARA levels) on the prices the app actually uses: 62% exactly zero, worst case
  2,471 (0.24% of the ladder that produced it), never more than four bonds, both directions.
- **Cause:** the synthetic gap rungs are modeled as issued today, so their P+I per bond does not
  accrete while the target does. Their quantity is therefore a genuinely different number, not a
  nudge — e.g. (40,000 − 1,870.04) ÷ 1,012.50 = 37.66 → 38 bonds, against
  (41,458.71 − 1,905.38) ÷ 1,012.50 = 39.07 → 39. A real rung is unaffected because its P+I
  accretes by the same factor as the target, leaving the quotient unchanged. Rounding to whole
  bonds is a second, smaller step on top.
- **Chain to the bracket, verified.** Each cover is sized `round(gap block cost × weight ÷ cover
  cost per bond)` (`gap-math.js`), and the two weights sum to exactly 1, so they split the cost
  between covers without changing its total. The required excess *cost* therefore equals the gap
  block cost, up to the rounding of those two quantities to whole bonds. Measured on the same
  case: that rounding ran +0.7200% at the file basis and −0.5343% at the settlement basis, and

  ```
  gap block growth 1.027024  ×  rounding swing 0.987547  =  1.014235
  required excess growth                              =  1.014235   (residual 0.00000000)
  ```

  So the whole path from Ref CPI date to bracket trade is accounted for, with nothing left over:
  the synthetic quantities round, then the cover quantities round again. Meanwhile the excess
  actually held accretes at the full 3.6468%, and the difference against a requirement that grew
  1.42% is what gets sold.
- **Scale:** negligible next to the structural trades above, which are tens of thousands of dollars.
- **Status:** open, low priority.

### Rising yields compensate: measured

- **The claim:** when yields rise the held bracket excess is worth less and can no longer fund the
  new 10Y, but the synthetic coupons on the remaining gap years are correspondingly higher, which
  lifts the coupon income reaching earlier rungs, so some of those rungs can be sold to make up the
  difference. Long held as logical but never verified.
- **It holds.** Between 2025-08-26 and 2026-08-26 yields rose roughly 50 bp. The synthetic gap
  coupons went from 1.875–2.000% to 2.250–2.500%, and the new Jul 2036 carries 2.375% against the
  1.875% of the Jul 2035 it displaces as lower bracket. Comparing two ladders sized to the **same**
  real target, coupon income reaching each early rung grew:

  | rung | year-ago | today | growth |
  |---|---|---|---|
  | 2027 | 7,118.52 | 8,199.43 | 1.152 |
  | 2029 | 5,794.31 | 6,844.04 | 1.181 |
  | 2031 | 5,709.79 | 6,405.28 | 1.122 |
  | 2033 | 5,013.23 | 5,705.56 | 1.138 |
  | 2035 | 2,250.13 | 4,343.79 | 1.931 |

  Against inflation of 1.0366. Every early rung gains 12–19% of *real* coupon income, so each needs
  fewer bonds to hit the same target. The whole ladder buys the same real income for **0.94% less**
  in real terms than a year earlier. That is the compensation, and it is why the shape-preserving
  reduction needed to close the gap is around 1% rather than something painful.
- **2026 is the exception** (0.149, a sharp fall) purely because it is the settlement year and only
  its remaining coupons count — the artifact described above, not a real loss of income.

### A ladder does not roll forward into newly issued long maturities

- **Checked** 2026-08-26, because a ladder built to 2055 a year ago now sees a Feb 2056 that did not
  exist then. Ladders are consumed, not rolled: no 2056 should be bought.
- **Result: correct as shipped.** Built to 2055 on year-ago data and reloaded today, the rebalance
  resolves last year 2055, engages no Future 30Y years, and proposes no trade in any 2056 or later
  maturity. (It still carries the funding gap above, net cash −17,112.)

### Maturity preference must never cause churn inside a funded year

- **Rule:** a rebalance must not sell one maturity to buy another within the same funded year. The
  maturity preference is a preference, not a dictum: it decides what to buy when something is being
  bought, never a reason to replace a holding that is already doing its job.
- **Not currently violated, as far as this scenario shows.** The year-over-year reload traded only
  2026, 2027, 2033, 2035, 2036 and 2040 — no 2030 trade at all, even though the preferred bond for
  2030 changed during the year.
- **Correction to an earlier note here:** a "2030 rung wanted 7 more bonds" figure recorded on
  2026-08-26 came from comparing two *independent builds*, one in each world, not from a rebalance.
  An Oct 2030 TIPS (91282CPH8) issued in Oct 2025 wins "last to mature" over the Jul 2030
  (912828ZZ6) that a year-ago build picked, and because the new issue has almost no accrued
  inflation — index ratio near 1.0 against roughly 1.3 — each of its bonds carries far less
  principal, so a fresh build needs more of them at proportionally lower cost per bond. That is a
  fact about building from scratch today, and says nothing about what a rebalance does.
- **Still to verify:** whether any path *could* produce within-year churn — the target bond set is
  selected from the preference at Run, so it is worth confirming that a held bond is never displaced
  merely because a newer one now matches the preference better.

### Reproducing the year-over-year scenario

`scripts/getFedInvestPricesForDate.js <YYYY-MM-DD>` writes a `YieldsFromFedInvestPrices.csv` for any
past trading day, in the format `shared/src/market-data.js` parses. Point the app at it (serve it in place of the
live file and flip `YIELD_SOURCE` to `fedinvest`), build and export a ladder, then load that export
against live data. FedInvest is the right source for the historical end: it is the only one with
per-CUSIP prices for a past date (3.1 §4.0).

### The assumed synthetic coupon is not shown anywhere

- **Found:** 2026-08-26.
- **Symptom:** the coupon assumed for a synthetic gap or Future 30Y rung (the eighth at or below the
  anchor yield — 2.0 §Future 30Y Rungs) appears in no popup. The only way to recover it is to back
  it out of the displayed P+I: 1,014.38 implies 2 × 14.38 = 2.876%, against an actual 2.875%.
- **Status:** open.
## FIXED

### Amount After left out the cash credit on the rung the pool ran out in

- **Found:** 2026-08-28, from a report that raising Available Cash *lowered* Amount After.
- **Cause.** Available Cash is consumed earliest rung first. A rung the pool covers in full is
  zeroed and topped up to its DARA, which carries the cash implicitly and was correct. The one rung
  the pool runs out partway through takes what is left as a partial credit, and `runRebalance`
  passed `fundedYearAmount` only the pre-ladder-interest half of that credit
  (`pliCreditByFundedYear`), so the row reported a year delivering less than its target by exactly
  the cash it had just been given. The rung had been sized down for that cash; the cash then went
  unreported.
- **Measured.** 2026–2040 at DARA 40,000 with 60,000 cash: 2027 read **19,349.90** against the
  **40,514.54** a build of the same ladder reports. Now 40,514.54.
- **Why nothing caught it.** `build-lib` passes the whole credit, so Build was right and Rebalance
  wrong, and the test whose stated purpose is "rebal After == build amount per year" ran only at
  zero cash. It now runs with cash, and fails by 16,742 without the fix.
- **Fixed** by passing `creditByFundedYear` (cash + pre-ladder interest). The bracket row’s
  `preLadderCreditForYear` now reads from `postARABreakdown` so the drill’s split matches the total
  it explains.

### The ladder table collapsed whenever a top-card control changed

- **Found:** 2026-08-28. Changing Allocation policy reset every expanded funded year.
- **Why it is backwards:** expanding a year is what you do in order to see what a change does to
  it, so collapsing on the way to showing the effect hides the effect.
- **Cause.** Only Rebalance’s own re-run captured and restored `data-expanded`; Build’s render and
  the pre-Run Before-state preview called `_setDefaultGroupsExpanded`. 6.0 scoped it that way
  explicitly, so the spec was wrong too, and is rewritten as the general rule.
- **Fixed:** all three paths capture and restore. A fresh load renders into an empty table, which
  snapshots nothing, so it opens at the default without a special case. The regression test drives
  the allocation-policy path and fails without the fix; an earlier version of it drove maturity
  preference, passed with the fix reverted, and proved nothing.

### The received-cash window was a free date where only six days differ

- **Found:** 2026-08-28. Applying a Ref CPI date of one year ago changed nothing at all, with no
  indication why.
- **Two causes, both now addressed.** The count covers settlement-year payments, so a date before
  January 1 was clamped away and could not narrow anything; and the strip echoed the entered date,
  naming a window the figure was never counted over.
- **Fixed by removing the date.** Cash reaches a holder only on the 15th of January, February,
  April, July, August and October (verified: all 109 TIPS ever issued mature on the 15th of Jan,
  Feb, Apr, Jul or Oct), so the choices are now the payment dates this portfolio was actually paid
  on, each labelled with the amount it produces, each **exclusive** of the date it names. A file’s
  own recorded Ref CPI date maps onto one of them, and is the earliest offered.
- **And the two dates were separated.** One entry had served both the Ref CPI basis and the cash
  window, so a position file — which carries no per-year amounts to restate — was told its amounts
  would be restated. The Ref CPI entry is now offered only where the file carries amounts.

### Available Cash and the payments behind it were two controls

- **Found:** 2026-08-28. A link beside the box crowded the card row and was too small to read.
- **Fixed:** clicking the box opens a chooser listing every starting point with the amount it
  produces, and last a plain amount to state outright; the box displays the result and takes no
  typing. The payment dates are what make the counted figure, so offering them anywhere other than
  where the figure is set splits one decision across two controls.
- **The help now leads with the figures**: one row per settlement-year payment date already made,
  its coupons and its principal, and the total. Rows before the starting point, and the coupon
  column when the coupon-counting choice excludes it, are struck through rather than dropped.

### Coupon Counting showed in Build, and never mentioned Available Cash

- **Found:** 2026-08-28, from "I still don’t see a linkage between coupon counting and available
  cash, but there should be", and "I’m not sure there’s value at all in having coupon counting in
  Build mode".
- **Build:** the choice divides a settlement year into coupons already paid and coupons still to
  arrive, and a Build has no first half — the ladder is bought on the build date, so every coupon
  from that date forward is its own income. Build now sizes at `all` unconditionally and the control
  is not rendered there.
- **Rebalance:** all three settings kept. The received-cash window cannot express what they express:
  the remaining question is about payments not yet made. Measured 2026–2040 at DARA 40,000, `none`
  costs one more bond in the 2026 rung and $1,218.
- **The linkage** is now stated in the popover, live: which coupons have already been paid, that they
  are counted in Available Cash rather than there, and how many payment dates remain — because that
  is what decides whether the choices still differ. With one date left, `all` and `last` name the
  same coupon, which holds from mid-August until January.
### Available Cash showed in Build, where it has nothing to mean

- **Fixed:** 2026-08-27.
- **Symptom:** the field was never hidden on a mode switch, unlike Brackets and Allocation policy,
  so it showed in both modes and shared one value across them.
- **Why it is wrong:** the figure states what the holder will spend out of a portfolio they already
  hold. A Build starts from cash by definition and reports what the ladder costs, so there is
  nothing there for it to mean. It became actively harmful once the app began offering the figure
  from coupons already received: that is a statement about a held position, and letting it follow
  the user into Build would size a from-scratch ladder down against coupons nobody was paid.
- **Fix:** the control is Rebalance-only, its state is per-mode, and a Build run always sizes at
  zero cash — including when a DARA plan carrying a figure from Rebalance is imported into Build.

### A stated availableCash=0 suppressed the received-coupon offer

- **Fixed:** 2026-08-27, same day it was introduced, before it ever ran on a real file.
- **Symptom:** the offer was skipped whenever the file stated its own Available Cash. The CUSIP/Qty
  export writes `availableCash=0` unconditionally, so every ladder that never had cash entered
  carries a zero — including every aged export the offer exists for. It would have fired only on
  hand-written files.
- **Fix:** only a positive figure counts as the holder having said what they hold. Guarded by the
  aged-plan half of the Available Cash E2E test, which now writes `availableCash=0` on purpose.

### Test ladders built on real year-ago market data

- **Added:** 2026-08-27, in `tests/fixtures/yearago/`.
- **Why:** a ladder stated at an older Ref CPI date cannot be produced in the app from live data,
  and building one against today’s prices with an old Ref CPI would mix two dates. These are built
  entirely on FedInvest prices, yields and Ref CPI for 2025-08-26 — what the app would have
  exported that day — written in the CUSIP/Qty export format, so they load in Rebalance like any
  other export.

  | file | ladder | DARA | maturities | reload today |
  |---|---|---|---|---|
  | `ladder-2026-2040-dara40k.csv` | 2026–2040 | 40,000 | latest | +204, ARA −1.4% |
  | `ladder-2026-2055-dara40k.csv` | 2026–2055 | 40,000 | latest | +95, ARA −0.8% |
  | `ladder-2026-2045-dara100k.csv` | 2026–2045 | 100,000 | latest | +190, ARA −0.9% |
  | `ladder-2027-2050-dara60k.csv` | 2027–2050 | 60,000 | latest | +228, ARA **+0.8%** |
  | `ladder-2026-2040-dara40k-all.csv` | 2026–2040 | 40,000 | all months | +72, ARA −1.3% |
  | `ladder-2026-2055-dara40k-all.csv` | 2026–2055 | 40,000 | all months | +347, ARA −0.8% |
  | `ladder-2026-2045-dara100k-all.csv` | 2026–2045 | 100,000 | all months | +491, ARA −0.7% |
  | `ladder-2026-2040-dara40k-first.csv` | 2026–2040 | 40,000 | earliest | +640, ARA −0.8% |

  The all-months and earliest ladders are the ones that exercise matured rungs: by late August their
  2026 rungs for January, April and July have been paid out. A latest-maturity ladder holds the
  October 2026 TIPS, which has not matured, so it never sees the case at all.

  Every figure here is measured under the **Maturity order** allocation policy, which is what the app
  actually runs. The policy is locked to Maturity order whenever the maturity preference is Last or
  First (`_updateAllocPolicyLock()`), so the Equal split listed first in the dropdown is never in
  force by default. It changes nothing for a funded year holding a single TIPS, and moves net cash
  materially for one holding several — an all-months year, or a bracket year carrying a retained
  older bracket: the 2026–2040 all-months ladder lands at +72 under Maturity order against +1,208 under
  Equal split.

  The last one gains: its first funded year is 2027, so the settlement year is outside the ladder
  and the coupons received during 2026 are pure surplus rather than income the 2026 rung was
  counting on.

### The Build Ref CPI date control mixed two dates, and is gone

- **Removed:** 2026-08-27.
- **What it did:** let a Build price at an older Ref CPI date while still using today’s market
  prices. Index ratios came from one date and prices from another, and the two move independently,
  so the ladder it produced existed on no day.
- **Why it was there:** to simulate a ladder built earlier, so the saved-and-reloaded path could be
  exercised end to end. `tests/fixtures/yearago/` does that properly — one date’s prices, yields and
  Ref CPI throughout — so the control had nothing left to do.
- **The real path is better anyway.** A holder who built a year ago has the holdings. Loading their
  CUSIP/Qty file into Rebalance prices what they actually own at today’s market, which is both more
  accurate and what Rebalance is for.
- **What stays:** the file-side basis machinery. A year-old export legitimately records an older Ref
  CPI date, and both the DARA restatement (3.0 §DARA Reference Date) and the received-cash window read
  it. The date arrives in a file; it is not something the user sets.
- **Spec:** 3.0 §RefCPI Date Override rewritten as §Ref CPI Date; cross-references in 3.1, 5.0 and
  6.0 follow.

### SA yields shifted slightly when the Ref CPI rounding fix landed

- **When:** 2026-08-27. Not a defect in this app; a record of a value change reaching it from
  upstream, so a later "why did this move" has an answer.
- **Cause:** `shared/src/ref-cpi.js` `truncateThenRound()` carried a magnitude-dependent rounding
  bug that mis-rounded 28 dates in the published Ref CPI series by 1e-5 (see that file and
  `shared/tests/ref-cpi.test.js` for the analysis). Fixed, then `TIPS/RefCpiNsaSa.csv` and
  `TIPS/YieldsSaSao.csv` were regenerated. This app reads the latter for its SA yields.
- **Measured impact here:** isolating the SA adjustment itself (SA yield minus ask yield, the part
  the correction touches, as opposed to same-day market movement in the ask), the largest change
  across 53 CUSIPs was **2.38e-5, or 0.238 basis points**.
- **Visible, barely.** SA yield renders as `(x * 100).toFixed(3)`, so the display resolves to 0.1
  basis points and a quarter of a basis point can move the last digit by a unit or two. It cannot
  change a rung or a trade.
- **Correction to an estimate made at the time:** this was first called negligible at any displayed
  precision, reasoning from the relative size of the input error (1e-5 on a Ref CPI near 256 is
  ~4e-8 relative). That understated it. The error reaches the SA yield **amplified**, because the
  adjustment is a ratio of two nearby quantities, so relative error in the inputs does not carry
  through as relative error in the result.
- **Method note:** the first before/after comparison looked alarming (3.85e-3 on every CUSIP) purely
  because it spanned a market move. Ask yields had shifted by the same order over the same window.
  Any comparison of this file across time has to isolate the adjustment from the underlying yield.

### The offered Available Cash ignored the coupon-counting choice

- **Found:** 2026-08-27, first hands-on test of the offer, hours after it shipped.
- **Symptom:** setting Coupons to None left a full year of coupons sitting in the box as spendable
  cash. The figure did not respond to the control at all, and did not respond to anything else
  either — it was computed once at load and never again.
- **Two faults, one appearance:** the offer never consulted the coupon-counting choice, and it had
  no recompute path.
- **Fix:** whether the settlement year’s coupons were kept toward that year or reinvested is one
  decision, already asked by the Coupons control. The box follows it and moves the moment it
  changes: All remaining counts every coupon already paid, Only last and None count none — by that
  setting’s own definition, every already-paid coupon is earlier than the last one still to arrive,
  so it was reinvested.
- **Maturity proceeds deliberately do not follow it.** Returned principal is not coupon income, and
  a rung exists to mature and be spent, so it counts under every setting.
- **Also fixed:** the offer tracked only whether the app had filled the box in, not whether the
  holder had taken it over. A typed figure followed by a Coupons change would have been overwritten.
  And the DARA-plan import restored the coupon choice *after* computing the offer against it, so a
  plan saved with None was credited its coupons anyway.
- **Covered by:** `Available Cash follows the Coupons setting, and stops once the holder sets it`
  (`tests/e2e/app.spec.js`).

### A dateless file’s received-cash window was silent

- **Found:** 2026-08-27, same session: loading a broker file produced a filled-in Available Cash
  figure with no indication of what period it covered and no way to change it.
- **Cause:** with no Ref CPI date in the file the window runs from the start of the year. That is
  right for a broker position, which was held all along, but the holder could not see the assumption
  and it moves trades. The existing "set the file’s date" offer fires only for a file carrying
  per-year amounts, so a broker file never saw it — and the apply handler returned early when there
  were no amounts to restate, so a date set there would have done nothing regardless.
- **Fix:** the strip states the window and offers the date; setting one narrows it and the figure
  recomputes. One control serves both jobs: with per-year amounts the date restates them and bounds
  the window, without them it bounds the window alone.
- **Worth knowing:** maturity proceeds cannot be recovered from a broker file at all. It lists what
  is currently held, and a matured bond is not currently held. Only a file this app saved still
  carries the CUSIP and quantity. From a broker import the offer is coupons only.
- **Covered by:** `a file with no date says which window its received cash was counted over, and the
  date can be set` (`tests/e2e/app.spec.js`).

### A matured rung was bought back, because a matured TIPS is invisible

- **Fixed:** 2026-08-27.
- **Symptom:** a rung that had already matured read as unfunded, and the rebalance bought principal
  to replace cash the holder had been paid and was in the middle of spending.
- **Cause:** a matured TIPS is no longer quoted, so it is absent from the market data the app builds
  its bond map from, and the holding was silently dropped. Nothing then represented the money it had
  paid out. The reference series (`TipsRef.csv`) carries every TIPS ever issued, which is enough to
  value what a matured position paid — maturity, coupon and base CPI — and it was not being
  consulted.
- **Fix:** maturity proceeds join coupons as settlement-year cash already received, over the same
  window (from the date the file states its DARA at, to today). The final coupon date *is* the
  maturity date, so the existing coupon walk finds it; the principal is added there.
- **Why it grows through the year:** the later the rebalance, the more rungs have matured. A ladder
  holding every maturity month has collected its January, April and July 2026 rungs by late August.
- **Measured** on `tests/fixtures/yearago/`, reloading against 2026-08-28:

  | fixture | maturity preference | matured rungs | proceeds | ARA cost without | with |
  |---|---|---|---|---|---|
  | `ladder-2026-2040-dara40k-all` | all months | 3 | 25,246 | −6.1% | **−1.3%** |
  | `ladder-2026-2040-dara40k-first` | earliest | 1 | 32,743 | −7.1% | **−0.8%** |
  | `ladder-2026-2040-dara40k` | latest | 0 | 0 | −1.4% | −1.4% |

  The latest-maturity ladder is unaffected because its 2026 rung is the October TIPS, which has not
  matured. That is why the fixtures now cover all three preferences: the default hides this entirely.
- **Covered by:** `Available Cash counts maturity proceeds from rungs that have already matured`
  (`tests/e2e/app.spec.js`).
- **Spec:** 2.0 §Available Cash.

### The settlement year bought principal against coupons it had already been paid

- **Fixed:** 2026-08-27.
- **Symptom:** on a year-over-year reload the 2026 rung bought 6 bonds, −7,309 — the largest
  non-bracket trade, and nothing to do with duration matching. Amount Before read 34,018 against a
  target of 41,355.
- **Cause:** only a settlement year’s *remaining* coupons counted toward its rung (2.0
  §Settlement-Year Coupon Treatment). By late August most of the year’s coupons have been paid, so
  the rung looked underfunded by exactly the money already sitting in the account, and bought
  principal to replace it.
- **Fix:** Available Cash is now offered from the coupons the loaded ladder has already received
  this year, counted from the date the file states its DARA values at, and marked amber as the
  app’s figure rather than the holder’s.
- **Why the window matters.** Crediting every coupon paid this year regardless would be wrong for a
  ladder built minutes ago: it never owned the bonds in February. Measured on a same-day build →
  export → import, crediting the whole year turned a zero-trade round trip into selling 25 bonds of
  2026 and buying across 24 other rungs. Counting only from the file’s own stated date gives zero
  for a same-day file, so the round trip is untouched, and the full amount for a year-old one.
- **Result:** removes the 2026 buy outright. Combined with the self-financing scale, the
  year-over-year scenario lands at **+204** net cash and a 1.4% reduction in ARA, against 2.4% for
  the scale alone.
- **Also:** Available Cash became per-mode. The offer is a statement about a held portfolio, so it
  must not follow the user into Build, which starts from cash by definition.
- **Covered by:** `Available Cash is offered from coupons already received, and only for a ladder
  stated in the past` (`tests/e2e/app.spec.js`).
- **Spec:** 2.0 §Available Cash gains §Coupons already received; 6.0 §Row 1 records the marker and
  help button.

### Self-financing was switched off for exactly the files that needed it

- **Fixed:** 2026-08-27.
- **Symptom:** a year-old export, reloaded, came back 12,745 short and the app said nothing.
- **Cause 1 — provenance was treated as intent.** The run-time self-financing scale ran only when
  the per-year plan came from nowhere in particular. A file that stated its own DARA values
  disqualified itself, on the reasoning that a stated plan is a stated intent. But our own exports
  are the only files that always carry one, so the exemption applied to precisely the ladders the
  scale exists to protect. A CUSIP/Qty file describes a ladder holding no cash; only values the
  user types after loading are a statement that overrides funding.
- **Cause 2 — the scale threw away the plan it was meant to preserve.** When it did run, it
  discarded the loaded per-year plan and rebuilt the shape from the portfolio’s own ARA. On a
  broker file that is right (there is nothing else to go on); on a stated plan it replaces the
  user’s targets with a mirror. Enabling the scale without fixing this turned a same-day round
  trip from zero trades into trades across the whole ladder, including 25 more bonds at the
  settlement year. The stated plan is now scaled directly, and taken at face value — no
  cover-income correction, which exists only to repair what cannot be recovered from holdings.
- **Cause 3 — the search solved a different ladder than it executed.** Trial runs inside the
  binary search used the default maturity preference and allocation policy rather than the
  caller’s. Those choices decide which CUSIP each year buys and so what each trade costs: the
  level returned satisfied net cash ≥ 0 for a ladder that was never built, then landed at −620
  once executed under the user’s actual settings. Every trial now carries the caller’s own
  settings.
- **Result on the year-over-year scenario:** net cash −12,745 → **+757**, at a DARA of 40,446
  against 41,454 stated (−2.4%). The same-day build → export → import round trip stays exactly
  zero-trade, now because such a plan already funds itself and the search leaves it alone.
- **Covered by:** `runFundedRebalance — stated per-year plan: scaled to self-finance, shape kept`
  (`tests/run.js`), which asserts both halves — an unchanged plan does not move, an aged one is
  scaled until it funds itself.
- **Spec:** 3.0 §Funding the rebalance rewritten (scope, which shape is scaled, and the
  trial-the-caller’s-ladder rule).

### Ref CPI date in Rebalance: stale basis carried in, no re-scale on change, no notice

- **Found:** 2026-08-26, first hands-on review of the DARA reference-date feature. Three reported
  symptoms, one mechanism.
- **Repro:** Build tab, DARA 100,000, Ref CPI overridden to 2025-08-27. Build, export CUSIP/Qty,
  switch to Rebalance, load the exported file.
- **Symptoms:**
  1. Rebalance still showed 2025-08-27 as the Ref CPI date. DARA loaded as 100,000 and no trades
     were reported, but every cost and amount was priced at the 2025 date rather than the
     settlement date any real trade would settle at.
  2. Changing the Ref CPI date to the settlement date afterward left DARA at 100,000 instead of
     scaling it to 103,657, and the rebalance then reported sells.
  3. Nothing on screen said a 2025 date was pricing everything.
- **Root cause:** the override was global and was not reset on a mode switch, so with the same
  date on both sides the scaling factor was 1 and correctly did nothing. The scaling also ran
  once, at import, and nothing re-derived it when the active date changed.
- **Fix:** Rebalance no longer has a Ref CPI date at all — no control, and no display, since the
  date equals the settlement date the info strip already shows. A rebalance settles on the
  settlement date, so its costs and amounts are only meaningful there; holding a saved ladder’s
  real target steady is what the DARA scaling already does, from the date recorded in the file.
  With no way to change the date, none of the three symptoms can occur. Build keeps the control
  (it simulates a ladder built earlier) as Build-mode state: parked on the way into Rebalance,
  handed back on return, so a Build result stays consistent with the date it was computed at.
- **Files:** `index.html`, `knowledge/3.0_TIPS_Ladder_Rebalancing.md`, `tests/e2e/app.spec.js`.
  Commit `36f0cac`.
- **Related, removed in the same pass:** the "use the file’s values as written" control. Reading a
  target stated at an earlier Ref CPI date as though it were stated at the settlement date quietly
  cuts the real target by the inflation in between — the failure the scaling exists to prevent, so
  the control could only ever produce a wrong answer.

### DARA basis notice never appeared on a DARA-plan import

- **Found:** 2026-08-26, writing the E2E test for the no-recorded-date path (which had never been
  exercised).
- **Symptom:** importing a DARA plan showed neither basis message — not the offer to supply a Ref
  CPI date when the file records none, and not the scaling report when it records one.
- **Root cause:** the DARA-plan import handler cleared the status strip as its last act, after the
  notice had been written there. The holdings handler clears at entry instead, which is why the
  message showed up on that path and this went unnoticed.
- **Fix:** clear at entry in both handlers.
- **Files:** `index.html`, `tests/e2e/app.spec.js`. Commit `f5863c0`.

### "Coupon Counting" link widened the settlement-year column

- **Found:** 2026-08-26, same review.
- **Symptom:** the link on the settlement year’s group header row (5.0 §Coupon Counting link) was
  long enough to widen that column in an already very wide rebalance table.
- **Fix:** shortened the label to "Coupons". The popover title and the hover explainer keep the
  full name and carry the detail.
- **Files:** `src/render.js`, `knowledge/5.0_UI_Schema.md`, `tests/e2e/app.spec.js`. Commit `b2293c6`.

### Row 2 overflowed in Rebalance once Available Cash was added

- **Found:** 2026-08-26, same review.
- **Symptom:** the construction/computation policy row (6.0 §Row 2) ran long enough to force the
  form card wider than it needed to be in Rebalance.
- **Fix:** Available cash moved to Row 1. It is a target-side dollar figure, not construction
  policy — the same reasoning 6.0 records for moving Brackets and Pre-ladder int. the other way.
- **Files:** `index.html`, `knowledge/6.0_UI_Layout.md`. Commit `b2293c6`.

### Future 30Y duration match: negative weight/quantity on a short single-year block

- **Found:** 2026-07-31, build mode, `lastYear=2057` (a single-year Future 30Y block).
- **Symptom:** the 2052 upper cover solved to a negative duration-match weight, producing a
  negative excess quantity for it.
- **Root cause:** `bracketWeights()` (`gap-math.js`) solved `lowerWeight`/`upperWeight` from the
  raw two-sided formula with no bound. The deep-discount, near-zero-coupon 2052 cover carries an
  unusually long duration for its maturity, while a higher-coupon single-year block like 2057 can
  have a shorter duration than the 2056 lower cover itself — putting the block's average duration
  below `d_lower`, which the raw formula solves as `lowerWeight > 1`, `upperWeight < 0`. Only the
  opposite corner (`avgDuration > d_upper`) was flagged (`future30yFellBack`), and even that flag
  didn't clamp the weights it flagged.
- **Fix:** `bracketWeights()` now clamps `lowerWeight` to `[0, 1]` before deriving `upperWeight`,
  so the block falls entirely on the nearer cover in either direction instead of solving past it.
  Accepts a larger duration-match delta in that corner case rather than a negative trade.
- **Files:** `src/gap-math.js`, `knowledge/2.0_TIPS_Ladders.md`, `knowledge/4.0_Computation_Modules.md`,
  `tests/run.js`. Commit `768ab98`.
- **Follow-up:** `rebalance-lib.js` had its own inline duplicate of this same duration-match
  formula for Future-30Y target weights (a leftover from before `ladder-core.js`'s `sizeLadder`
  existed) — same bug, unreachable from build but live via rebalance. Extracted the whole
  duration-match → cover-excess-quantity computation out of `sizeLadder` into a standalone
  `sizeFuture30yCover()` (`ladder-core.js`), which both `sizeLadder` and `rebalance-lib.js` now
  call — single source of truth, no separate fix needed on the rebalance side. Commit `bd05a15`.

### 2036 (active lower bracket) excess not previewable before Run

- **Found:** 2026-07-29, branch `before-state-dara-redesign`, real Kevin IRA holdings.
- **Symptom:** the active lower bracket year (2036) can carry substantial excess once duration
  matching actually runs, but the Before-state preview never flagged or previewed it — it rendered
  as an ordinary funded year pre-Run, so the excess only became visible after clicking Run
  Rebalance.
- **Fix:** the active lower bracket year is now its own independent detection candidate, using the
  same median-based heuristic as the upper bracket / Future 30Y years — it flags on its own merits
  and does not compete with the 2032–2035 retained-bracket pool for a single slot, so it can flag
  alongside a genuine retained-bracket flag (e.g. 2034) instead of being excluded outright.
- **Files:** `src/before-state-lib.js`, `knowledge/3.0_TIPS_Ladder_Rebalancing.md`.

### Retained bracket excess: wrong bracket sold (active bracket sold instead of the older retained lower bracket)

- **Found:** 2026-07-29, branch `before-state-dara-redesign`, real Kevin IRA holdings
  (`~/Downloads/SchwabAllAccounts.csv`).
- **Symptom:** loading a lumpy ladder with genuine retained bracket excess (e.g. Jan 2034) alongside
  the active lower bracket (Jan 2036), then running a full rebalance, sold ALL of the active
  bracket's (2036) excess down to zero while leaving the older retained lower bracket (2034) untouched — the
  opposite of the documented rule (2.0 §Retained Bracket Excess: sell the oldest maturity first;
  the active bracket is never sold to make room for an older retained lower bracket).
- **Root cause:** `gap-math.js`'s `bracketWeightsN` only triggered the sell-retained-first logic
  when the active bracket's duration-match weight went negative. A large, short-duration retained
  bracket could squeeze the active bracket's weight toward (but not below) zero without ever going
  negative, so the code never recognized the over-allocation and froze the wrong side.
- **Fix:** added `activeFloorWeight` to `bracketWeightsN` — floors the active bracket at its own
  currently-held excess; selling the retained lower bracket(s) further now triggers off "would this shrink
  active below its floor," not just "did the weight go negative." Default value `0` reproduces the
  exact old behavior for every other caller.
- **Confirmed pre-existing:** verified this reproduces identically with or without any of this
  session's other changes — it was already live in production (`main`) before this feature branch
  started. **Ported to `main` independently** (commit `9bc925b`, 2026-07-30) via a standalone
  cherry-pick of the isolated fix (gap-math.js, rebalance-lib.js, the relevant 2.0/3.0 spec hunks,
  and the regression tests) — ahead of and separate from the rest of this feature branch.
- **Files:** `src/gap-math.js`, `src/rebalance-lib.js`.

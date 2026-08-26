# Known Issues — Production Impact Tracker

Bugs found during development that affect (or affected) the shipped app, independent of whatever
feature branch surfaced them. Not a general dev-branch bug list — only entries with real
production impact go here.

---

## OPEN

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

## FIXED

### Ref CPI date in Rebalance: stale basis carried in, no re-scale on change, no notice

- **Found:** 2026-08-26, first hands-on review of the DARA basis-date feature. Three reported
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
  and does not compete with the 2032–2035 retained-leg pool for a single slot, so it can flag
  alongside a genuine retained-leg flag (e.g. 2034) instead of being excluded outright.
- **Files:** `src/before-state-lib.js`, `knowledge/3.0_TIPS_Ladder_Rebalancing.md`.

### Retained bracket excess: wrong leg sold (active bracket sold instead of the older retained leg)

- **Found:** 2026-07-29, branch `before-state-dara-redesign`, real Kevin IRA holdings
  (`~/Downloads/SchwabAllAccounts.csv`).
- **Symptom:** loading a lumpy ladder with genuine retained bracket excess (e.g. Jan 2034) alongside
  the active lower bracket (Jan 2036), then running a full rebalance, sold ALL of the active
  bracket's (2036) excess down to zero while leaving the older retained leg (2034) untouched — the
  opposite of the documented rule (2.0 §Retained Bracket Excess: sell the oldest maturity first;
  the active bracket is never sold to make room for an older retained leg).
- **Root cause:** `gap-math.js`'s `bracketWeightsN` only triggered the sell-retained-first logic
  when the active bracket's duration-match weight went negative. A large, short-duration retained
  leg could squeeze the active bracket's weight toward (but not below) zero without ever going
  negative, so the code never recognized the over-allocation and froze the wrong side.
- **Fix:** added `activeFloorWeight` to `bracketWeightsN` — floors the active bracket at its own
  currently-held excess; selling the retained leg(s) further now triggers off "would this shrink
  active below its floor," not just "did the weight go negative." Default value `0` reproduces the
  exact old behavior for every other caller.
- **Confirmed pre-existing:** verified this reproduces identically with or without any of this
  session's other changes — it was already live in production (`main`) before this feature branch
  started. **Ported to `main` independently** (commit `9bc925b`, 2026-07-30) via a standalone
  cherry-pick of the isolated fix (gap-math.js, rebalance-lib.js, the relevant 2.0/3.0 spec hunks,
  and the regression tests) — ahead of and separate from the rest of this feature branch.
- **Files:** `src/gap-math.js`, `src/rebalance-lib.js`.

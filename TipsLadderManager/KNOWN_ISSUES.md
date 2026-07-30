# Known Issues — Production Impact Tracker

Bugs found during development that affect (or affected) the shipped app, independent of whatever
feature branch surfaced them. Not a general dev-branch bug list — only entries with real
production impact go here.

---

## FIXED

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

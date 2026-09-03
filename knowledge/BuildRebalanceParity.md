# Build / Rebalance Parity — Known Divergence

## Status
Open — tracked here for a dedicated investigation session.

## Symptom
The Build→Rebalance symmetry test (Gap method, 2036–2065, PLI, DARA=40000) shows a
±1 bond difference on the 2036 lower bracket year after the correct duration algorithm
was introduced (May 2026). Test tolerance was widened to `totalAbsQtyDelta ≤ 2` to
keep the suite green while this is investigated.

## Root Cause (Preliminary)
`calcGapParams` (build-lib.js) and `calculateGapParameters` (rebalance-lib.js) compute
the LMI that feeds synthetic TIPS sizing through different code paths:

| | Build (`calcGapParams`) | Rebalance (`calculateGapParameters`) |
|---|---|---|
| LMI source for years > gap | Preliminary sweep (`calcPrelimFundedYearAmounts`) — funded qty only | Actual holdings passed in — total qty (funded + excess) |
| Accumulation | Single object keyed by year | `gapLaterMaturityInterest` map |

In the normal case (no excess on years > gap) these paths agree. When excess bonds
exist on a year above the gap, the rebalance path may include their interest in LMI
while the build path does not, causing a small difference in `gapParams.totalCost`.
That difference, when multiplied by `lowerWeight` and divided by `costPerBond`, can
cross a `Math.round` boundary — producing a 1-bond discrepancy.

The correct duration fix (fractional first-period Macaulay/Modified, matching Google
Sheets DURATION/MDURATION) changed `lowerWeight` enough to expose the boundary. The
pre-existing LMI divergence is the root cause; duration is computed identically in
both paths via `shared/src/bond-math.js::calculateMDuration`.

## What Needs to Happen
1. **Spec audit**: Confirm that the spec (TipsLadderManager knowledge) states that
   build and rebalance must produce the same bracket excess quantities for the same
   inputs. If the spec is silent, add the invariant.
2. **Align the LMI source**: `calculateGapParameters` should compute LMI from the
   same preliminary sweep logic as `calcGapParams` — not from raw holdings total qty.
   Alternatively, extract a shared `gapParamsCore(gapYears, prelim, ...)` function
   that both orchestrators call.
3. **Restore strict test assertion**: Once aligned, revert the tolerance in
   `tests/run.js` back to `totalAbsQtyDelta === 0` and `costDeltaSum === 0`.

## Files Involved
- `TipsLadderManager/src/build-lib.js` — `calcGapParams`
- `TipsLadderManager/src/rebalance-lib.js` — `calculateGapParameters`
- `TipsLadderManager/src/gap-math.js` — shared `bracketWeights`, `bracketExcessQtys`
- `TipsLadderManager/tests/run.js` — Build→Rebalance symmetry test (lines ~448–502)

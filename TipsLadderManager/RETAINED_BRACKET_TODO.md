# Identifying bracket and cover years from apparent excess holdings

Work started in the `ladder-retained-bracket-id` session and handed to the session holding the specs. The developer's rulings are recorded here so they are not asked again; the code already committed is listed so it is not rewritten; what is left is listed in the order it should be done.

Read first: `knowledge/DATA_DICTIONARY.md`, `knowledge/2.0_TIPS_Ladders.md` (§Retained Bracket Excess), `knowledge/3.0_TIPS_Ladder_Rebalancing.md` (§Bracket Identification Rules, §Before-State Preview and Bracket-Year Excess Detection, §Lower bracket priority rule).

---

## Rulings already given

1. **The Excess-ARA metric is replaced.** A maturity year is identified by a clear deviation from the ladder's shape, not by its ARA standing above a single median. In the developer's words: the plot of DARA against maturity year has relatively smooth humps and dips with some spikes that noticeably deviate from the curve, the spikes are the bracket and cover year candidates, and the algorithm implements that visualization.

2. **The baseline moves with the metric.** A flagged year's DARA becomes the curve value at that year, replacing the median. Detection and sizing then share one baseline, and excess is what stands above the curve.

3. **Identification is per maturity year, not per TIPS.** A year holding both a January and a July maturity is one candidate. This part of the current behaviour was already correct.

4. **Within a bracket or cover year holding more than one maturity**, the funded-year need is met from the earliest maturity first, so the excess sits on the latest maturity, which is also the one entering the duration match. When a sale is required the earliest maturity is sold first: a lower bracket maturity closer to the first gap year gives the better duration match.

5. **Sell order is one rule at maturity granularity** — earliest maturity first across all retained lower bracket maturities, whether they sit in different years or in the same year. It replaces the separate across-years rule rather than sitting beside it.

6. **Every spike is retained, not one.** `bracketWeightsN` already solves for any number.

---

## Committed already

- `5e5a2cb` — `tests/dev/RetainedExcessTwoYears.csv` and `tests/dev/RetainedExcessTwoMaturities.csv`. Each is `data/SampleHoldings.csv` with two or three quantities changed, so every other figure is the one the real portfolio produces. The first puts genuine excess in 2034 and 2035 at once; the second puts one excess year (2035) holding two maturities.
- `4af80d1` — `src/shape-math.js`. `smoothCurve` fits the ladder's shape (repeated running median, one Hann pass). `findSpikes` returns every index standing more than `k` robust scales above it, strongest first, each flattened onto the curve before refitting.
- `57e7368` — tests in `tests/run.js`. 444 pass.
- `c996df3`, `029878b`, `95f2008`, `f15db47`, `5b1d424` — the amber flag on a per-year DARA input. Separate messages for a candidate year and for a maturity year with no issued TIPS, and the flag moved off `title` onto `data-tip-html` so it appears without the browser's own delay.

Nothing in `identifyBrackets` or `detectBracketFlags` has been changed.

---

## Left to do, in order

1. **Wire the curve into `detectBracketFlags`** (`src/before-state-lib.js`) for both detection and the filled-in DARA, replacing `heldYearMedianExcluding` for flagged years.
2. **`identifyBrackets`** (`src/rebalance-lib.js:43`): return every retained maturity rather than one, ordered earliest first. Drop the `(araByYear[y] || 0) - DARA` metric at `~:69` and the hardcoded single-element `retainedList` at `~:128`.
3. **Within-year split and sell order** — rulings 4 and 5.
4. **Specs**: `2.0 §Retained Bracket Excess`, `3.0 §Bracket Identification Rules §Retained Maturities`, `3.0 §Before-State Preview`, `3.0 §Lower bracket priority rule`, and `4.0 §Computation Modules`, where `shape-math.js` is not yet documented.

---

## Spec defects found along the way

- **`2.0` and `3.0` describe a user control that does not exist.** Both call it "Retain lower bracket excess", on by default. No such control is in `index.html` or `src/`. The control is **Brackets**, with values *2-bracket* and *Multi-bracket*.
- **`3.0 §Before-State Preview` is quoted in `before-state-lib.js` as saying "held funded years only".** The population is built by `computePortfolioARAByYear` from holdings alone, with no DARA consulted, so its members are maturity years the portfolio holds TIPS in. A bracket year whose DARA is 0, holding excess TIPS alone, is in that population and is not a funded year (DD §Funded Year). The developer and this session are settling a term for it; until then the user-facing string says "the maturity years that hold TIPS".
- **A gap year's filled-in DARA is inconsistent with itself.** When a bracket year is flagged, a gap year is given the median with that bracket year excluded; when nothing is flagged, the same gap year is given the plain median. The exclusion exists so a candidate is not compared against itself, which cannot apply to a gap year, since a gap year is not in the population at all. Ruling 2 may retire this path; if it does not, it needs deciding.
- **`3.0 §198` propagates the Excess-ARA rule into the preview** and cites it as the engine's established rule. Ruling 1 replaces it in both places.

---

## Evidence, so it does not have to be derived again

Settlement 2026-09-03, market fixtures in `tests/e2e/`.

Identification, where the answer is known by construction:

| file | expected | curve method |
|---|---|---|
| `data/SampleHoldings.csv` | 2034 | 2034 |
| `tests/dev/RetainedExcessTwoYears.csv` | 2034, 2035 | 2034, 2035 |
| `tests/dev/RetainedExcessTwoMaturities.csv` | 2035 | 2035 |

Separation on the real portfolio is wide, so the threshold is not a knife edge: 2034 at 9.0 robust scales, the highest ordinary maturity year at 2.7, and the years at 1.42 to 1.47 times the median that sat just under the old fixed line at 0.5 to 1.4.

What ruling 2 changes, for the years actually flagged on `data/SampleHoldings.csv`:

| flagged year | ARA | median baseline | curve baseline | excess, median | excess, curve |
|---|---|---|---|---|---|
| 2034 | 37,050 | 19,449 | 23,822 | 16 bonds | 12 bonds |
| 2036 (active lower) | 27,197 | 19,449 | 23,615 | 7 bonds | 3 bonds |

The old branch `retained-bracket-work` (`078741f`) claimed 2032 and 2033 were identified while the app displayed their excess as zero. That does not reproduce: only one lower candidate is kept, so 2032, 2033 and 2035 are never flagged and take their own ARA as their DARA. The median baseline *would* assign them 4 bonds each if they were flagged, which is the same defect seen from the other side.

Two production defects reproduce on current `main`, and are what the fixtures are for. With excess in two pre-gap years, the second loses its bracket role, its holding is reported as funded-year quantity, and the sweep sells it: 15 of 30 bonds of Jan 2034, with Multi-bracket selected. With one excess year holding two maturities, the quantity tie-break names the January maturity, reports all 20 of it as excess and none as funded, and sells down the July maturity.

---

## Traps

- `tests/run.js` has mixed line endings in the committed blob. Editing it with a tool that normalizes them floods the diff with whitespace changes. Splice with a Node script writing CRLF.
- A quoted heredoc in this environment still consumes backslashes, so a patch script matching on a string containing one has to build it with `String.fromCharCode(92)`, or anchor on text with no backslash in it.
- Run the suite from `TipsLadderManager/`. From the repository root, sixty tests that look for dev files by relative path skip silently and the count drops without failing.

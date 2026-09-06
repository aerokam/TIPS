# Terminology Worklist

State of the portal-wide terminology work as of 2026-09-06, handed from the session that ran it
(named `terminology`) to `portal-DFD`, which now carries it. The policy itself lives in
`CLAUDE.md` §Help Text Follows the Specs; this file is the work state and the open questions.

## What the work is

User-facing text and specs use the terms `knowledge/DATA_DICTIONARY.md` defines, exactly as code
does. The developer set the method: take one help section at a time, show it, take feedback, and let
the feedback loop back into the specs and the DD where the language is wrong there too.

The test is consistency with the specs, never whether prose reads naturally. A term that was never
defined can read just as well as the one that was, which is why this needs reading rather than
instinct.

## Enforcement

`.githooks/pre-commit` runs `scripts/check-vocabulary.js`. It blocks a commit that introduces a
banned term into prose a reader meets: the `knowledge/` specs, `Primer/content/`, and sentence-like
string literals in each app's `index.html` and `src/`. Only lines a commit adds or changes are
gated, so pre-existing wording never blocks unrelated work.

- `node scripts/check-vocabulary.js --audit` lists everything in the repo. It was at 37 findings and
  is currently clean.
- Adding a rule to `RULES` in that file is how a term the developer rules out stays out for every
  future session. Do that in the same pass as the correction.
- Rules today: `block` standing in for a run of years, `leg`, `print` as a noun, `tenor`,
  possessives on TIPS/Note/Bond, `bracket/cover`, `synthetic gap`, `3-bracket`, `lower-side`,
  `two-sided`.

Two deliberate omissions, recorded in the file itself:

- **`Treasury's`** is not a rule. The institution takes a possessive; only the security type does
  not, and no cheap pattern separates them.
- **The "Expand/Collapse Bracket/Cover Years" button label** is exempted from the `bracket/cover`
  rule. There the slash names two kinds of row rather than one compound term.

## Done

- **TipsLadderManager**: the Gap Dur popup, the Bracket Mode help, the Future 30Y Dur popup, the
  plain-language walkthrough in 2.0, the Amount drill, the Cost drill.
- **Repo-wide sweeps**: `3-bracket` → Multi-bracket; `synthetic gap` → synthetic TIPS;
  `bracket/cover` → the two terms named separately; `leg` → the yield it names; `print` → value,
  release, quote or bar depending on sense; `stamped` → timestamped; `tenor` → term; possessives on
  security types; the retired *base CPI* → dated date Ref CPI.
- **DD entries added or changed**: Same-Year Excess Interest renamed **Same-Maturity Excess
  Interest** (old anchor kept as an alias); **Accrued Market Discount (AMD)** and **Pre-Ladder
  Interest (PLI)** added, both previously used with no entry; a note that **Ref is short for
  Reference**.
- **Canty.md** was reconciled against the paper PDF. Content checks out: the Appendix B factors match
  Table B exactly, the three figure attributions are right, and the §1b blockquote matches verbatim.
  Nine phrasings were ours and appear nowhere in the paper, including *stub*, and are gone.

## Open

### 1. "Held year" — a probable defect, not a naming question

`heldYearMedianExcluding` (`before-state-lib.js`) takes its median over a population that
`computePortfolioARAByYear` (`rebalance-lib.js:354`) builds from holdings alone, keyed by maturity
year, never reading DARA. Three things follow, in dependency order. The first decides the rest.

1. **Should an excess-only bracket year contribute an LMI-only value to the median at all?** In the
   no-range branch, `ara[y] = byYear[y].totalPI + lmi` (`rebalance-lib.js:374`). An excess-only year
   has `totalPI = 0` and so contributes `lmi` alone, which is positive whenever anything is held
   above it. That value is small next to a real funded rung and drags the median down, and the years
   it affects are the ones bracket detection exists to find. `before-state-lib.js:36` claims the
   opposite protection: *"empty LMI-only years never appear in it, so they can never collapse the
   median."* Empty years indeed never appear; excess-only years do.

   Conditional on file format. A `cusip,qty` file (broker exports, and `data/SampleHoldings.csv`,
   the auto-preloaded one) sets no `excessQty`, so `fundedQty` falls back to `h.qty` and no LMI-only
   value arises. Our own export with the `fundedYear` column (`index.html:3202-3203`) does set it,
   which is the export-then-reimport round-trip 3.0 §Per-Year DARA from Portfolio is built around.

2. **Should the population be bounded by `[firstYear, lastYear]`?** Nothing constrains it today, so a
   holding maturing outside the ladder range affects the median. The doc comment at
   `rebalance-lib.js:349` states this outright.

3. **Then the naming.** Neither Funded Year nor Maturity Year covers "the maturity years the
   portfolio holds TIPS in": a bracket year whose DARA is 0 is in the population and is not a funded
   year; Maturity Year is every year outstanding TIPS mature in, not the ones this portfolio holds.
   Either the DD gains a term or 3.0 describes the population instead of naming it.

Still carrying the wrong claim: `3.0_TIPS_Ladder_Rebalancing.md` §Before-State Preview says the
median is over "the **held** funded years" (4 uses), and `before-state-lib.js:33-36` quotes that
back. `render.js` was corrected in `5b1d424`; these were not. The identifiers
(`heldYearMedianExcluding`, `heldARAByYear`, the `heldYears` locals) are untouched on purpose —
question 1 may change the function, and renaming first would bake in the wrong population.

Related, raised with the developer in commit `95f2008` by a third session: whether
`heldYearMedianExcluding` should apply to gap years at all.

### 2. Help text still to be walked

Same method, one section at a time: the Quantity drill, the Ref CPI drill, the Trade Ticket, the
Cash Flow Calendar, the status strip, the top-card controls.

Only TipsLadderManager has been walked deliberately. YieldsMonitor, YieldCurves, Primer,
TipsReference and FundHoldings were swept for specific words as those words came up, never read
through, so they are likely carrying paraphrases nobody has looked at. The hook will not find those:
it knows only words already rejected.

### 3. Smaller items

- **`stub`** was removed from `Canty.md` because the paper never uses it. Whether it belongs in a
  seasonal-adjustment primer is undecided and low priority.
- **The legacy `baseCpi` column header** stays in `shared/src/market-data.js` and
  `Primer/src/primer-data.js`. Both already prefer `datedDateRefCpi` and read `baseCpi` only as a
  fallback for pre-rename R2 files. Retiring it is a data-migration question, not a naming one.

## Distinctions that have already caused errors

- **Nominal/real and adjusted/unadjusted are different axes.** Nominal is the opposite of real
  (TIPS); adjusted is the opposite of unadjusted (inflation). "Price (unadjusted)" in the Cost drill
  is correct and must not become "nominal". Canty's clean and dirty map to the second pair.
- **Verify what the code computes before renaming anything around it.** In the "held year" thread,
  two separate corrections were needed: "held year" is not a synonym for funded year, and the
  excess-only year is not filtered out by the `v > 0` guard. Each wrong reading would have put a
  false statement into 3.0.
- **A schema line can contradict its own prose.** `S12: GswTipsCurve.json` was written
  `{ @date + beta0 ... }`, but DD §0.0 defines `{ x }` as iteration and the file holds a single
  record. The vocabulary gate cannot catch this class of error.
- **DataStores documents the file; the DD documents the entity.** A store entry carries the exact
  header row, including a header like `Coupon` that differs from the DD's normalized `Coupon_Rate`.
  S7 sets that precedent.

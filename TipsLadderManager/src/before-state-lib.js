// before-state-lib.js — Standalone Before-state preview computation
// (3.0 §Before-State Preview and Bracket-Year Excess Detection).
//
// This module is architecturally DECOUPLED from the duration-match / self-financing engine
// (rebalance-lib.js `runRebalance` / `runFundedRebalance`) — it must NEVER import either. It
// answers a genuinely different question than the engine: "what does the portfolio already look
// like" (a plain holdings valuation), not "what should the portfolio become" (the engine's solved
// target). See top-level CLAUDE.md's single-source-of-truth rule for why these stay separate
// modules rather than one wrapping the other — they are two independent computations over the
// same holdings, not one duplicated copy of the other's math.
//
// It DOES reuse a couple of already-general, non-engine holdings-valuation helpers exported by
// rebalance-lib.js (`computePortfolioARAByYear`, `getGapYears`) — those never touch duration
// matching or self-financing, so reusing them is the single-source-of-truth rule working as
// intended, not a boundary violation.

import { bondCalcs } from '../../shared/src/bond-math.js';
import { fmtDate } from './date-util.js';
import { computePortfolioARAByYear, getGapYears } from './rebalance-lib.js';

export const LOWEST_LOWER_BRACKET_YEAR = 2032;
export const UPPER_BRACKET_YEAR = 2040;
export const FUTURE30Y_COVER_YEARS = [2052, 2056];

// Same "middle of the sorted array" median convention used elsewhere in this app
// (rebalance-lib.js `derivePerYearDara`) — not an average-of-two-middles median.
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Held-year median used for bracket-candidate detection: median raw ARA across held funded
// years, EXCLUDING `excludeYear` itself (3.0 §Before-State Preview: "the held-year median ...
// held funded years only, excluding the candidate itself"). `heldARAByYear` is the no-range form
// of computePortfolioARAByYear (held years only — empty LMI-only years never appear in it, so
// they can never collapse the median).
export function heldYearMedianExcluding(heldARAByYear, excludeYear) {
  const vals = Object.entries(heldARAByYear)
    .filter(([y]) => Number(y) !== excludeYear)
    .map(([, v]) => v)
    .filter(v => v > 0);
  return median(vals);
}

// The Active Lower Bracket (DATA_DICTIONARY.md §Active Lower Bracket; 3.0 §Bracket Identification
// Rules): the latest-maturing ladder-eligible TIPS below minGapYear — the most recently issued
// 10-year. Computed from tipsMap only, the same search rebalance-lib.js's
// `identifyBrackets`/`anchorBefore` use — holdings never consulted.
export function getActiveLowerBracketYear(tipsMap) {
  const gapYears = getGapYears(tipsMap);
  if (gapYears.length === 0) return null;
  const minGap = Math.min(...gapYears);
  let activeYear = null;
  for (const b of tipsMap.values()) {
    if (!b.maturity) continue;
    const yr = b.maturity.getFullYear();
    if (yr >= LOWEST_LOWER_BRACKET_YEAR && yr < minGap) {
      if (activeYear == null || yr > activeYear) activeYear = yr;
    }
  }
  return activeYear;
}

// Lower-bracket CANDIDATE years for excess-flagging: every TIPS maturity year in
// [LOWEST_LOWER_BRACKET_YEAR, activeLowerBracketYear) — 2032-2035 today. EXCLUDES the Active Lower
// Bracket year itself (2036) from this specific pool only — 2036 is still detected, just
// independently below (see detectBracketFlags), so it can flag alongside a genuine retained-leg
// flag instead of always winning this pool's "highest excess" tie-break by virtue of usually
// carrying the largest raw ARA (3.0 §Bracket-year excess detection: "Lower bracket candidates:
// 2032–2035").
export function getLowerBracketCandidateYears(tipsMap) {
  const activeYear = getActiveLowerBracketYear(tipsMap);
  if (activeYear == null) return [];
  const years = new Set();
  for (const b of tipsMap.values()) {
    if (!b.maturity) continue;
    const yr = b.maturity.getFullYear();
    if (yr >= LOWEST_LOWER_BRACKET_YEAR && yr < activeYear) years.add(yr);
  }
  return [...years].sort((a, b) => a - b);
}

// Detect bracket-candidate excess flags (3.0 §Before-State Preview and Bracket-Year Excess
// Detection). Returns Map<year, { median, excess }> — one entry per FLAGGED year only.
//
// `heldARAByYear` = computePortfolioARAByYear(holdings, tipsMap, refCPI) (no-range form: held
// years only). `lastYear` gates lower/upper candidates the same way
// rebalance-lib.js's getGapYearBracketCandidates does — a ladder that hasn't reached the
// structural gap yet has no candidates at all.
export function detectBracketFlags({ heldARAByYear, tipsMap, lastYear }) {
  const flags = new Map();
  const heldYears = new Set(Object.keys(heldARAByYear).map(Number));
  const gapYears = getGapYears(tipsMap);
  const minGap = gapYears.length ? Math.min(...gapYears) : null;
  const activeYear = getActiveLowerBracketYear(tipsMap);

  // Lower bracket (2032-2035, i.e. below the Active Lower Bracket year — the active bracket
  // itself, e.g. 2036 today, is never a candidate; see getLowerBracketCandidateYears): evaluate
  // every held candidate independently against its own excluding-self median, then keep only the
  // one with the HIGHEST excess (rawARA − median) when more than one exceeds — the same "Excess
  // ARA Priority" rule the real engine's retained-maturity identification already uses
  // (3.0 §Bracket Identification Rules §Retained Maturities: "the single year with the highest
  // Excess ARA is picked"), not a "latest-maturing wins" rule. (An earlier revision of this
  // module picked the latest-maturing candidate instead; that produced the WRONG year on real
  // holdings — e.g. a 2036-adjacent ladder where 2034 legitimately carries the largest retained
  // excess got 2035 flagged instead, because 2035 merely matures later while carrying far less
  // excess. Fixed to match the engine's own established rule, per CLAUDE.md "foundation wins over
  // a conflicting dependent claim.") Ties (astronomically unlikely with real dollar ARAs) fall
  // back to latest-maturing as a deterministic last resort.
  if (minGap != null && lastYear >= minGap) {
    const lowerCandidates = getLowerBracketCandidateYears(tipsMap).filter(y => heldYears.has(y));
    const exceeding = [];
    for (const y of lowerCandidates) {
      const med = heldYearMedianExcluding(heldARAByYear, y);
      if (med != null && heldARAByYear[y] > med) exceeding.push({ year: y, median: med, excess: heldARAByYear[y] - med });
    }
    if (exceeding.length > 0) {
      const chosen = exceeding.reduce((a, b) =>
        b.excess > a.excess ? b : (b.excess === a.excess && b.year > a.year ? b : a));
      flags.set(chosen.year, { median: chosen.median, excess: chosen.excess });
    }
  }

  // Active Lower Bracket year itself (e.g. 2036), Upper bracket (2040), and each Future 30Y cover
  // (2052, 2056) — each evaluated independently of the lower-candidate pool above and of each
  // other; each may flag on its own. The active bracket year is INTENTIONALLY handled here rather
  // than folded into the lower-candidate pool's "highest excess wins" competition: unlike an older
  // retained leg, it's expected to legitimately carry both real funded income and gap-coverage
  // excess, so it must be able to flag alongside a genuine retained-leg flag, not compete with it
  // for a single slot (3.0 §Before-State Preview and Bracket-Year Excess Detection).
  for (const y of [activeYear, UPPER_BRACKET_YEAR, ...FUTURE30Y_COVER_YEARS]) {
    if (y == null || !heldYears.has(y)) continue;
    if ((y === UPPER_BRACKET_YEAR || y === activeYear) && (minGap == null || lastYear < minGap)) continue;
    const med = heldYearMedianExcluding(heldARAByYear, y);
    if (med != null && heldARAByYear[y] > med) {
      flags.set(y, { median: med, excess: heldARAByYear[y] - med });
    }
  }
  return flags;
}

// Recompute a flagged year's excess against an arbitrary DARA value — the median guess, OR a
// value the user has since typed in. Plain subtraction, never duration-matching, either way
// (3.0 §Before-State Preview, final paragraph).
export function excessAgainstDara(rawARA, daraValue) {
  return rawARA - daraValue;
}

// Held qty/cost per year, straight off current holdings — no DARA, no funded/excess split
// (3.0 §Before-State Preview: "Qty Before / Cost Before are never affected by any of this").
function heldQtyCostByYear(holdings, tipsMap, refCPI) {
  const byYear = {};
  for (const h of holdings) {
    const bond = tipsMap.get(h.cusip);
    if (!bond?.maturity) continue;
    const { costPerBond } = bondCalcs(bond, refCPI);
    const year = bond.maturity.getFullYear();
    if (!byYear[year]) byYear[year] = { qty: 0, cost: 0 };
    byYear[year].qty += h.qty;
    byYear[year].cost += h.qty * costPerBond;
  }
  return byYear;
}

// ─── Standalone before-state row builder ──────────────────────────────────────
// Builds a `details`-shaped rows array directly consumable by render.js's `renderTable`
// (mode: 'rebal') showing ONLY Before-side figures: current holdings valued at market, no DARA,
// no duration matching, no engine call whatsoever. After-side fields (araAfterTotal,
// fundedYearQtyAfter, excessQtyAfter, fundedYearQtyDelta, excessQtyDelta, ...) are simply never
// set, so render.js's existing null-safe formatting renders those columns blank
// (5.0 §COLS Schema, fyLevel/drillCond null handling already supports this — no render.js change
// needed for the "hide After columns pre-Run" behavior itself).
//
// `daraByYear` (optional Map<year, number>) supplies the CURRENT per-year DARA store so a flagged
// year the user has already edited recalculates its excess against the entered value instead of
// the median (3.0: "If the user edits a flagged year's DARA input ... the excess recalculates
// immediately — raw ARA − entered DARA").
export function computeBeforeState({ holdings, tipsMap, refCPI, firstYear, lastYear, daraByYear = null }) {
  const heldARAByYear = computePortfolioARAByYear(holdings, tipsMap, refCPI);
  const rangeARAByYear = computePortfolioARAByYear(holdings, tipsMap, refCPI, { firstYear, lastYear });
  const qtyCostByYear = heldQtyCostByYear(holdings, tipsMap, refCPI);
  const gapYears = getGapYears(tipsMap).filter(y => y >= firstYear && y <= lastYear);
  const tipsYears = [...tipsMap.values()].filter(b => b.maturity).map(b => b.maturity.getFullYear());
  const maxTipsYear = tipsYears.length ? Math.max(...tipsYears) : 0;
  const future30yYears = [];
  for (let y = maxTipsYear + 1; y <= lastYear; y++) future30yYears.push(y);

  const flags = detectBracketFlags({ heldARAByYear, tipsMap, lastYear });

  // Group held CUSIPs by funded year (consolidated qty across accounts/rows sharing a CUSIP).
  const byYearCusip = new Map(); // year -> Map(cusip -> qty)
  for (const h of holdings) {
    const bond = tipsMap.get(h.cusip);
    if (!bond?.maturity) continue;
    const year = bond.maturity.getFullYear();
    if (year < firstYear || year > lastYear) continue;
    if (!byYearCusip.has(year)) byYearCusip.set(year, new Map());
    const m = byYearCusip.get(year);
    m.set(h.cusip, (m.get(h.cusip) ?? 0) + h.qty);
  }

  const rows = [];
  for (let y = firstYear; y <= lastYear; y++) {
    const flag = flags.get(y);
    const enteredDara = daraByYear?.get(y);
    const rawARA = rangeARAByYear[y] ?? 0;
    const cusipMap = byYearCusip.get(y);
    const yearDara = enteredDara ?? (flag ? flag.median : rawARA);

    if (!cusipMap || cusipMap.size === 0) {
      // Informational row — no CUSIP held for this year (ordinary empty year, or a structural
      // gap year that can never be held directly). Gap years show no Amount Before of their own —
      // their coverage lives entirely in an adjacent bracket year's excess.
      rows.push({
        cusip: '', maturityStr: '', fundedYear: y, coupon: 0, yield: null, nPeriods: 2, principalPerBond: 0,
        costPerBond: 0, price: null, refCPI, baseCpi: null, indexRatio: null,
        fundedYearQtyBefore: 0, excessQtyBefore: 0, qtyBefore: 0, isBracketTarget: false,
        araBeforeTotal: gapYears.includes(y) ? null : rawARA,
        araBeforeLaterMatInt: rawARA, araBeforeHoldings: [], excessLMI_Before: 0, DARA: yearDara,
        isGapBracket: false,
      });
      continue;
    }

    // Popup breakdown for the Amount Before drill (5.0 §Popup Routing `amtBefore`; drill.js reads
    // `d.araBeforeHoldings` / `d.araBeforeLaterMatInt` off whichever row the group header's
    // fyLevel aggregation picks — build it once per year and attach to every row in the group so
    // it's there regardless of which row ends up "first").
    //
    // NOTE: `bondCalcs()` (shared/src/bond-math.js) does NOT return `coupon` in its result object
    // (it only returns indexRatio/principalPerBond/costPerBond/nPeriods/couponPerPeriod/ownRungInt/
    // piPerBond/annualInt) — destructuring `coupon` off its return value silently yields `undefined`,
    // which drill.js's popups (bondVarRows' "Coupon per period", buildPIPerBondDrill's coupon
    // interest, the bracketAmtBefore/costBefore P+I-per-TIPS lines) then do arithmetic on, producing
    // NaN throughout those popups even though the OTHER bondCalcs-derived fields (price, indexRatio,
    // costPerBond, principalPerBond) were correct. `coupon` (and `yield`, which bondCalcs never
    // touches at all — drill.js's bondVarRows reads it too) must come from the bond record itself.
    const araBeforeHoldings = [];
    let ownSum = 0;
    for (const [cusip, qty] of cusipMap) {
      const bond = tipsMap.get(cusip);
      const { principalPerBond, nPeriods } = bondCalcs(bond, refCPI);
      const coupon = bond.coupon ?? 0;
      araBeforeHoldings.push({
        cusip, maturityMonth: bond.maturity.getMonth(), maturityYear: y, qty, principalPerBond, nPeriods, coupon,
      });
      ownSum += principalPerBond * (1 + coupon / 2 * nPeriods) * qty;
    }
    const araBeforeLaterMatInt = rawARA - ownSum;

    // Flagged-year funded/excess qty & cost split (3.0 §Before-State Preview "Qty Before / Cost
    // Before split for a flagged year"; 5.0 §Bracket-Year Excess Flag). Only a flagged year's split
    // differs from the plain "full held qty is the funded figure" rule every other year uses — the
    // SAME LMI-based DARA→qty conversion this app already uses for empty rungs (3.0 §Intentional
    // empty rungs: `round((DARA − LMI) / piPerBond)`), applied against the flagged CUSIP's own
    // P+I per bond and this year's own `araBeforeLaterMatInt` (the SAME incoming-LMI figure the raw
    // ARA above is built from — not re-derived). Plain bond arithmetic, never duration-matching.
    let flaggedFundedQty = null;
    if (flag) {
      const daraForSplit = enteredDara ?? flag.median;
      const [firstCusip] = cusipMap.keys();
      const flaggedBond = tipsMap.get(firstCusip);
      const { piPerBond: flaggedPiPerBond } = bondCalcs(flaggedBond, refCPI);
      flaggedFundedQty = flaggedPiPerBond > 0
        ? Math.max(0, Math.round((daraForSplit - araBeforeLaterMatInt) / flaggedPiPerBond))
        : 0;
    }

    let first = true;
    for (const [cusip, qty] of cusipMap) {
      const bond = tipsMap.get(cusip);
      const { costPerBond, piPerBond, principalPerBond, nPeriods, indexRatio } = bondCalcs(bond, refCPI);
      const coupon = bond.coupon ?? 0;
      const row = {
        cusip, maturityStr: fmtDate(bond.maturity), fundedYear: y,
        coupon, yield: bond.yield ?? null, nPeriods, principalPerBond, costPerBond, piPerBond,
        price: bond.price ?? null, refCPI, baseCpi: bond.baseCpi ?? refCPI, indexRatio,
        // Qty/Cost Before are never split by the funded/excess guess for an ORDINARY year (3.0
        // §Before-State Preview) — the full held quantity is the funded-side figure. A FLAGGED
        // year's first row below overrides this with the actual split. `isBracketTarget` is a
        // post-duration-match concept (which CUSIP the engine chose for gap coverage) that doesn't
        // exist yet pre-Run, so it's always false here — the popups render their plain (non-
        // bracket-target) layout, which is fully populated and correct on its own.
        fundedYearQtyBefore: qty, excessQtyBefore: 0, qtyBefore: qty, isBracketTarget: false,
        araBeforeTotal: null, araBeforeLaterMatInt, araBeforeHoldings, excessLMI_Before: 0, DARA: yearDara,
        isGapBracket: false,
      };
      if (flag && first) {
        const daraForExcess = enteredDara ?? flag.median;
        row.araBeforeTotal = daraForExcess;
        row.excessAmtBefore = excessAgainstDara(rawARA, daraForExcess);
        row.isGapBracket = true;
        // Only the flagged CUSIP's own row carries the split — qty is drawn from THIS row's own
        // held quantity, not the year's combined total, so a multi-CUSIP flagged year's split still
        // reconciles per-row (fundedYearQtyBefore + excessQtyBefore === this row's held qty).
        row.fundedYearQtyBefore = Math.min(flaggedFundedQty, qty);
        row.excessQtyBefore = qty - row.fundedYearQtyBefore;
        // costBefore's popup (drill.js) reads d.fundedYearQtyBefore vs. the RAW d.qtyBefore based
        // on d.isBracketTarget — this row now genuinely carries a funded/excess split (unlike an
        // ordinary before-state row, which has none), so the popup must agree with what the Cost
        // Before CELL actually shows (fundedYearQtyBefore × costPerBond, per render.js's COLS),
        // not fall back to the undivided held total. `isBracketTarget` is otherwise a post-Run/
        // duration-match concept, but every other place drill.js reads it is unreachable pre-Run
        // (After-side popups, which have no data yet) — this is the one place it's actually
        // consequential before Run, so it must be true here to keep popup and cell consistent.
        row.isBracketTarget = true;
      } else if (first) {
        row.araBeforeTotal = rawARA;
      }
      rows.push(row);
      first = false;
    }
  }

  return { rows, flags, gapYears, future30yYears, heldARAByYear, rangeARAByYear, qtyCostByYear };
}

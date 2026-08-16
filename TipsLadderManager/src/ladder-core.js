// ladder-core.js — Shared ladder sizing pipeline used by BOTH build and rebalance.
// Spec: 2.0 TIPS Ladders §Algorithm; 3.0 §Phase 4; 4.0 §build-lib.js.
//
// `sizeLadder` is a PURE function: (per-year DARA + bonds + options) → target ladder
// (funded qty + excess per year, plus the params/pool fields callers render). It contains
// the whole pipeline: prelim estimate (PLI bucket + gap LMI), PLI pool, gap/future-30Y
// duration matching + bracket excess, and the corrected funded sweep. Build calls it with
// manual DARA; rebalance calls it with portfolio-derived DARA, then diffs the result into
// trades. Holdings never enter the sizing — only DARA does. This is the single source of
// truth that kills the build↔rebalance duplication.

import { bondCalcs, calculateMDuration, couponSchedule } from '../../shared/src/bond-math.js';
import { actualPaymentDate } from './data.js';
import { indexRatio as calcIndexRatio } from '../../shared/src/ref-cpi.js';
import { bracketWeights, bracketExcessQtys, fyQty as _fyQty, gapParamsWithUpperFeedback, future30yParamsCore, excessAmdSchedule } from './gap-math.js';

// ─── Gap parameters adapter ─────────────────────────────────────────────────────
// Build's "LMI above the gap" = prelim funded-year coupon (effective prelim: zeroed years = 0).
// Sizing (incl. the 2040 upper-excess-coupon fixpoint) lives in the shared gapParamsWithUpperFeedback.
function calcGapParams(gapYears, tipsMap, settlementDate, refCPI, dara, prelim, pliCreditByGapYear = {}, daraByYear = null, amdByYear = null) {
  const lmiAboveByYear = {};
  for (const [y, p] of Object.entries(prelim)) lmiAboveByYear[y] = p.annualInterest;
  return gapParamsWithUpperFeedback({ gapYears, tipsMap, settlementDate, refCPI, dara, daraByYear, lmiAboveByYear, pliCreditByGapYear, amdByYear });
}

// ─── Future 30Y parameters adapter ──────────────────────────────────────────────
function calcFuture30yParams(future30yYears, bond2056, settlementDate, dara, daraByYear = null) {
  return future30yParamsCore({ future30yYears, coverBond2056: bond2056, settlementDate, dara, daraByYear });
}

// ─── Future 30Y cover sizing: duration match → cover excess quantities ─────────
// Spec: 2.0 §Duration Matching (Brackets), §Future 30Y Rungs. Single source of truth for
// build (via sizeLadder below) AND rebalance (rebalance-lib's pre-PLI future-cover pass) —
// both need this BEFORE the rest of sizeLadder runs (rebalance needs future30yUpperExQty for
// the AMD pre-ladder pool; sizeLadder needs it for the corrected sweep), so it is its own
// function rather than inlined once inside sizeLadder.
// Returns { future30yParams, future30yLowerDuration, future30yUpperDuration,
//           future30yLowerWeight, future30yUpperWeight, future30yLowerExQty, future30yUpperExQty,
//           future30yFellBack, future30yTotalExcessCost, future30yLowerMonth, future30yUpperMonth }.
// No-op shape (all zero/null) when future30yYears is empty.
export function sizeFuture30yCover({
  future30yYears, future30yLowerCoverBond, future30yUpperCoverBond,
  settlementDate, dara, daraByYear = null, refCPI,
}) {
  let future30yParams = null;
  let future30yLowerDuration = 0, future30yUpperDuration = 0;
  let future30yUpperWeight = 0, future30yLowerWeight = 0;
  let future30yUpperExQty = 0, future30yLowerExQty = 0;
  let future30yFellBack = false;
  let future30yTotalExcessCost = 0;
  let future30yLowerMonth = null, future30yUpperMonth = null;

  if (future30yYears.length > 0) {
    future30yParams = calcFuture30yParams(future30yYears, future30yLowerCoverBond, settlementDate, dara, daraByYear);
    future30yLowerDuration = calculateMDuration(settlementDate, future30yLowerCoverBond.maturity, future30yLowerCoverBond.coupon ?? 0, future30yLowerCoverBond.yield ?? 0);
    future30yUpperDuration = calculateMDuration(settlementDate, future30yUpperCoverBond.maturity, future30yUpperCoverBond.coupon ?? 0, future30yUpperCoverBond.yield ?? 0);

    ({ lowerWeight: future30yLowerWeight, upperWeight: future30yUpperWeight } = bracketWeights(future30yLowerDuration, future30yUpperDuration, future30yParams.avgDuration));
    if (future30yParams.avgDuration > future30yUpperDuration) future30yFellBack = true;

    const future30yLowerCPB = (future30yLowerCoverBond.price ?? 0) / 100 * calcIndexRatio(refCPI, future30yLowerCoverBond.baseCpi ?? refCPI) * 1000;
    const future30yUpperCPB = (future30yUpperCoverBond.price ?? 0) / 100 * calcIndexRatio(refCPI, future30yUpperCoverBond.baseCpi ?? refCPI) * 1000;
    ({ lowerExQty: future30yLowerExQty, upperExQty: future30yUpperExQty } = bracketExcessQtys(future30yParams.future30yTotalCost, future30yLowerWeight, future30yUpperWeight, future30yLowerCPB, future30yUpperCPB));
    future30yTotalExcessCost = future30yLowerExQty * future30yLowerCPB + future30yUpperExQty * future30yUpperCPB;
    future30yLowerMonth = BL_MONTHS[future30yLowerCoverBond.maturity.getMonth()];
    future30yUpperMonth = BL_MONTHS[future30yUpperCoverBond.maturity.getMonth()];
  }

  return {
    future30yParams, future30yLowerDuration, future30yUpperDuration,
    future30yLowerWeight, future30yUpperWeight, future30yLowerExQty, future30yUpperExQty,
    future30yFellBack, future30yTotalExcessCost, future30yLowerMonth, future30yUpperMonth,
  };
}

// ─── Shared per-year funded Amount (single source of truth for build & rebalance "After") ───
// A funded year's annual Amount = own principal + own coupon + later-maturity interest (LMI)
// + own-year excess coupon + held-2052 AMD, plus a pre-ladder credit. For a PLI-zeroed year
// (funded entirely from the pre-ladder pool, qty 0) the credit is reconciled so the row lands
// exactly on its DARA against the CORRECTED income components; otherwise it is the year's
// non-zeroed pre-ladder credit (the partial-credit year's share, else 0). Build and rebalance
// BOTH call this, so their per-year Amounts are identical by construction — there is no second
// copy of the formula to drift (this replaces the duplicated zeroed-year reconciliation).
// `dara` is the year's resolved DARA. Display-only: trades use sized quantities, not this credit.
// Returns { credit, amount }.
export function fundedYearAmount({
  principal = 0, ownCoupon = 0, laterMatInt = 0, ownExcessCoupon = 0, amd = 0, rollCoupon = 0,
  dara, isZeroed = false, partialCredit = 0,
}) {
  // Income fixed regardless of the pre-ladder credit. For a zeroed year principal & ownCoupon
  // are 0, so this is the LMI + own-excess-coupon + AMD + Future-30Y roll coupon that the credit
  // tops up to DARA. (rollCoupon: Future-30Y cover-roll coupon credited to post-upper-maturity
  // funded years 2053–2056; see sizeLadder. Behaves exactly like AMD — non-cascading per-year credit.)
  const fixedIncome = principal + ownCoupon + laterMatInt + ownExcessCoupon + amd + rollCoupon;
  const credit = isZeroed ? Math.max(0, dara - fixedIncome) : partialCredit;
  return { credit, amount: fixedIncome + credit };
}

const BL_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── Intra-year TIPS selection (maturityPref policy) ────────────────────────────
// A funded year may hold MULTIPLE TIPS (quarterly out to ~5y, Jan/Jul out to ~10y,
// single Feb 2040+). The DARA target stays annual; the year's amount is split across
// the selected maturities (see sizeLadder). This picks which TIPS fill a year:
//   'last'       — one TIPS, latest-maturing              (default; = legacy behavior)
//   'first'      — one TIPS, earliest-maturing            (= legacy 'first')
//   'semiannual' — the Jan TIPS + the Jul TIPS (one each), Jan→Jul order
//   'all'        — one TIPS per distinct maturity MONTH, earliest→latest
// Same-month/same-date collision tie-break (Jan 2027/28/29, Apr 2028/29 — two issues in one
// month, different coupon): `couponPref` ('higher', default, or 'lower') picks the CUSIP that
// wins — including in 'all', which takes one TIPS per month, NOT both same-month issues. CUSIP
// is the final total-order tiebreak so selection is independent of Map iteration order.

// True when `b` should beat `best` for a single-pick slot on a maturity-date tie.
function tieBeats(b, best, couponPref = 'higher') {
  const cb = b.coupon ?? 0, cbest = best.coupon ?? 0;
  if (cb !== cbest) return couponPref === 'lower' ? cb < cbest : cb > cbest;
  return String(b.cusip ?? '') < String(best.cusip ?? '');   // stable final tiebreak
}
// Pick the earliest/latest-maturing TIPS from `cands`, tie-broken by tieBeats.
function pickExtreme(cands, which /* 'first' | 'last' */, couponPref = 'higher') {
  let best = null;
  for (const b of cands) {
    if (!best) { best = b; continue; }
    const d = b.maturity - best.maturity;
    if (which === 'first' ? (d < 0 || (d === 0 && tieBeats(b, best, couponPref)))
                          : (d > 0 || (d === 0 && tieBeats(b, best, couponPref)))) best = b;
  }
  return best;
}
// Ordered list of TIPS that fill one funded year under `pref`. Never empty (callers only
// pass years that have ≥1 candidate).
function selectYearTips(cands, pref, couponPref = 'higher') {
  const byMat = (a, b) => (a.maturity - b.maturity) || (tieBeats(a, b, couponPref) ? -1 : 1);
  if (pref === 'first') return [pickExtreme(cands, 'first', couponPref)];
  if (pref === 'all') {
    // One TIPS per distinct maturity month; couponPref wins when a month has two issues.
    const byMonth = new Map();
    for (const b of cands) {
      const mo = b.maturity.getMonth();
      const cur = byMonth.get(mo);
      if (!cur || tieBeats(b, cur, couponPref)) byMonth.set(mo, b);
    }
    return [...byMonth.values()].sort(byMat);
  }
  if (pref === 'semiannual') {
    const jan = pickExtreme(cands.filter(b => b.maturity.getMonth() + 1 === 1), 'last', couponPref);
    const jul = pickExtreme(cands.filter(b => b.maturity.getMonth() + 1 === 7), 'last', couponPref);
    const picks = [jan, jul].filter(Boolean);
    if (picks.length) return picks.sort(byMat);   // Jan before Jul
    return [pickExtreme(cands, 'last', couponPref)]; // no Jan/Jul (e.g. Feb 2040+): take the one available
  }
  return [pickExtreme(cands, 'last', couponPref)]; // 'last' (default)
}

// ─── Canonical ladder bond selection (shared by build and rebalance) ────────────
// Picks the funded-year TIPS per year, the 2040 upper bracket, the pre-gap lower
// bracket, and the future-30Y cover pair — purely from tipsMap. This is the single
// source of truth for "which TIPS the target ladder holds", so build and rebalance
// size against an identical set. Returns the structures sizeLadder consumes.
//   yearTipsListMap[year] — the ordered funded-year TIPS list (≥1) per maturityPref.
//   yearBondMap[year]     — the single representative (latest of the list); every
//                           bracket/gap/cover path keys off this and is unaffected,
//                           and it equals the legacy pick when the list has length 1.
// `yearOverrides` (prototype, Build only — 2.0 §Picking Maturities for a Funded Year): a
// Map<year, cusip[]> naming an explicit TIPS list for that year, bypassing `maturityPref` for
// just that year. Every other year keeps following `maturityPref` as usual. An override whose
// CUSIPs don't resolve to that year's candidates is ignored (falls back to the policy pick).
export function selectLadderBonds({ tipsMap, firstYear, lastYear, settlementDate, maturityPref = 'last', couponPref = 'higher', yearOverrides = null }) {
  // 1. Gather candidate TIPS per year (maturing after settlement, in range), then apply the policy.
  const candsByYear = {};
  for (const bond of tipsMap.values()) {
    if (!bond.maturity || bond.maturity <= settlementDate) continue;
    const yr = bond.maturity.getFullYear();
    if (yr < firstYear || yr > lastYear) continue;
    (candsByYear[yr] ??= []).push(bond);
  }
  const yearBondMap = {};       // year → representative single TIPS (latest of the funded list)
  const yearTipsListMap = {};   // year → ordered funded-year TIPS list (≥1)
  for (const yr of Object.keys(candsByYear).map(Number)) {
    const overrideCusips = yearOverrides?.get(yr);
    const overrideList = overrideCusips?.length
      ? overrideCusips.map(c => candsByYear[yr].find(b => b.cusip === c)).filter(Boolean)
          .sort((a, b) => a.maturity - b.maturity)
      : null;
    const list = overrideList?.length ? overrideList : selectYearTips(candsByYear[yr], maturityPref, couponPref);
    yearTipsListMap[yr] = list;
    yearBondMap[yr] = pickExtreme(list, 'last', couponPref);
  }

  let rangeYears = Object.keys(yearBondMap).map(Number).sort((a, b) => a - b);

  let maxTipsYear = 0;
  for (const bond of tipsMap.values()) {
    if (bond.maturity) maxTipsYear = Math.max(maxTipsYear, bond.maturity.getFullYear());
  }

  // Gap years: within actual TIPS range but no TIPS issued. Future 30Y: beyond maxTipsYear.
  const gapYears = [], future30yYears = [];
  for (let y = firstYear; y <= lastYear; y++) {
    if (!yearBondMap[y]) {
      if (y > maxTipsYear) future30yYears.push(y);
      else gapYears.push(y);
    }
  }

  // Add 2040 upper bracket if gap years exist and 2040 not already in range.
  if (gapYears.length > 0 && !yearBondMap[2040]) {
    for (const bond of tipsMap.values()) {
      if (!bond.maturity) continue;
      if (bond.maturity.getFullYear() !== 2040) continue;
      if (!yearBondMap[2040] || bond.maturity > yearBondMap[2040].maturity)
        yearBondMap[2040] = bond;
    }
    if (!yearBondMap[2040]) throw new Error('No TIPS available in 2040 for upper bracket');
    yearTipsListMap[2040] = [yearBondMap[2040]];   // 2040 has a single Feb TIPS — always length 1
    rangeYears = [...rangeYears, 2040].sort((a, b) => a - b);
  }

  // Ensure the lower bracket (nearest pre-gap Jan TIPS) is in yearBondMap/rangeYears.
  if (gapYears.length > 0) {
    const minGapYearTmp = Math.min(...gapYears);
    let lbBond = null;
    for (const bond of tipsMap.values()) {
      if (!bond.maturity || !bond.yield) continue;
      const yr = bond.maturity.getFullYear(), mo = bond.maturity.getMonth() + 1;
      if (mo === 1 && yr < minGapYearTmp && (!lbBond || yr > lbBond.maturity.getFullYear()))
        lbBond = bond;
    }
    if (lbBond) {
      const lbYear = lbBond.maturity.getFullYear();
      if (!yearBondMap[lbYear]) {
        yearBondMap[lbYear] = lbBond;
        yearTipsListMap[lbYear] = [lbBond];   // pre-gap lower bracket (Jan 2036) — single TIPS
        rangeYears = [...rangeYears, lbYear].sort((a, b) => a - b);
      }
    }
  }

  // Future 30Y cover pair: lower = 2056 (higher coupon, shorter duration), upper = 2052 (near-zero coupon).
  let future30yLowerYear = null, future30yUpperYear = null;
  let future30yLowerCoverBond = null, future30yUpperCoverBond = null;
  if (future30yYears.length > 0) {
    for (const bond of tipsMap.values()) {
      if (!bond.maturity) continue;
      const yr = bond.maturity.getFullYear();
      if (yr === 2056 && (!future30yLowerCoverBond || bond.maturity > future30yLowerCoverBond.maturity))
        future30yLowerCoverBond = bond;
      if (yr === 2052 && (!future30yUpperCoverBond || bond.maturity > future30yUpperCoverBond.maturity))
        future30yUpperCoverBond = bond;
    }
    if (!future30yLowerCoverBond) throw new Error('No 2056 TIPS found for Future 30Y lower cover');
    if (!future30yUpperCoverBond) throw new Error('No 2052 TIPS found for Future 30Y upper cover');
    future30yLowerYear = 2056;
    future30yUpperYear = 2052;
  }

  return {
    yearBondMap, yearTipsListMap, rangeYears, gapYears, future30yYears,
    future30yLowerYear, future30yUpperYear, future30yLowerCoverBond, future30yUpperCoverBond,
  };
}

// ─── Multi-TIPS funded-year split ───────────────────────────────────────────────
// A funded year's real P+I `need` (yearDARA minus the year-level income offsets — LMI,
// own-excess coupon, future-30Y extra) is spread across its ordered TIPS list so each
// sub-rung delivers an ≈ equal share of that year's maturity cash. Each sub-rung is sized
// from its OWN pi; the LATEST maturity absorbs the rounding remainder so the year lands on
// `need`. Same-year sub-rungs never feed each other's LMI (they mature in-year), so a single
// year-level `need` is the correct thing to split. Returns [{ bond, ir, pi, coupon, qty }]
// earliest→latest (qty ≥ 0). N=1 reproduces the legacy single-TIPS sizing exactly.
function sizeYearRungs(list, need, refCPI) {
  const rungs = list.map(bond => {
    const { indexRatio: ir, piPerBond: pi } = bondCalcs(bond, refCPI);
    return { bond, ir, pi, coupon: bond.coupon ?? 0, qty: 0 };
  });
  const N = rungs.length;
  if (N === 0 || need <= 0) return rungs;
  const share = need / N;
  let deliveredPI = 0;
  for (let i = 0; i < N - 1; i++) {
    rungs[i].qty = Math.max(0, Math.round(share / rungs[i].pi));
    deliveredPI += rungs[i].qty * rungs[i].pi;
  }
  const last = rungs[N - 1];                                   // latest maturity absorbs the remainder
  last.qty = Math.max(0, Math.round((need - deliveredPI) / last.pi));
  return rungs;
}
// Aggregate a sized rung list: total funded qty, total real annual coupon (feeds LMI),
// and total real P+I delivered (the year's own maturity cash).
function aggregateRungs(rungs) {
  let qty = 0, annualInterest = 0, piTotal = 0;
  for (const r of rungs) {
    qty += r.qty;
    annualInterest += r.qty * 1000 * r.ir * r.coupon;
    piTotal += r.qty * r.pi;
  }
  return { qty, annualInterest, piTotal };
}

// ─── Current-year remaining-coupon count ────────────────────────────────────────
// How many of a bond's semiannual coupon dates still fall in settlementDate's own calendar
// year, on or after settlementDate. 0, 1, or 2. Reuses the same coupon-date walk the cash
// flow calendar uses (shared/src/bond-math.js couponSchedule) — single source, no parallel
// date logic. For every year other than the settlement year this is irrelevant (that year's
// coupons haven't happened yet, so the normal full-annual assumption already holds).
export function remainingCouponPaymentsThisYear(maturity, settlementDate, bondHolidays = new Set()) {
  const year = settlementDate.getFullYear();
  // Walk from a few days before settlementDate, not from settlementDate itself: a coupon
  // scheduled just before settlement but rolled past a weekend/holiday hasn't actually been paid
  // yet, and couponSchedule(settlementDate, ...) would otherwise skip its (pre-settlement) raw
  // date entirely. Mirrors index.html's buildCashFlowData() walk-back. 5.0 §Cash Flow Calendar.
  const walkFrom = new Date(settlementDate); walkFrom.setDate(walkFrom.getDate() - 10);
  return couponSchedule(walkFrom, maturity)
    .map(d => actualPaymentDate(d, bondHolidays))
    .filter(actual => actual >= settlementDate && actual.getFullYear() === year)
    .length;
}

// ─── The shared sizing pipeline ─────────────────────────────────────────────────
export function sizeLadder({
  dara, daraByYear = null, firstYear, lastYear, optionalYears = null,
  rangeYears, gapYears, future30yYears,
  yearBondMap, yearTipsListMap = null, tipsMap, refCPI, settlementDate, settlementYear,
  preLadderInterest = false, bondHolidays = new Set(),
  future30yLowerCoverBond = null, future30yUpperCoverBond = null,
  future30yLowerYear = null, future30yUpperYear = null,
}) {
  let lowerYear = null, upperYear = null;
  // Back-compat: a caller that passes only yearBondMap sizes every year as a single TIPS.
  const tipsList = (year) => yearTipsListMap?.[year] ?? [yearBondMap[year]];

  // 3. Preliminary sweep (longest → shortest, no bracket excess). Produces prelim coupons
  //    used by the PLI bucket and gap LMI (the small, shared approximation).
  const prelim = {};
  let laterMatInt = 0;
  for (const year of [...rangeYears].sort((a, b) => b - a)) {
    const bond = yearBondMap[year];                            // representative (bracket/gap/message pi)
    const { piPerBond: pi } = bondCalcs(bond, refCPI);
    const need = (year > lastYear || year < firstYear) ? 0 : Math.max(0, (daraByYear?.get(year) ?? dara) - laterMatInt);
    const rungs = sizeYearRungs(tipsList(year), need, refCPI);
    const { qty, annualInterest: annInt } = aggregateRungs(rungs);
    prelim[year] = { targetFundedYearQty: qty, annualInterest: annInt, laterMatInt, pi, rungs };
    laterMatInt += annInt;
  }

  // 3a. Validate: every funded year must fund at least one bond. EXCEPT optionalYears — in a
  // rebalance these are in-range years the user holds none of (intentional empty rungs). A target
  // that rounds to 0 there is a hole (LMI passthrough), not a too-low-DARA error; if the user raises
  // its per-year DARA enough to fund a bond it fills normally (target ≥ 1, never reaches this throw).
  for (const year of rangeYears) {
    if (year > lastYear || year < firstYear) continue;
    if (optionalYears?.has(year)) continue;
    const { targetFundedYearQty, laterMatInt, pi } = prelim[year];
    const yearDara = daraByYear?.get(year) ?? dara;
    if (targetFundedYearQty === 0 && yearDara > laterMatInt) {
      const minNeeded = Math.ceil(laterMatInt + pi);
      const err = new Error(`DARA too low for ${year}: need at least $${minNeeded.toLocaleString()} to fund one bond (pi/bond = $${Math.round(pi).toLocaleString()}, later-mat interest = $${Math.round(laterMatInt).toLocaleString()})`);
      err.daraTooLowYear = year;  // lets the inference binary search steer around infeasible probes
      throw err;
    }
  }

  // 4a. Future 30Y parameters → duration matching → cover excess quantities.
  const {
    future30yParams, future30yLowerDuration, future30yUpperDuration,
    future30yLowerWeight, future30yUpperWeight, future30yLowerExQty, future30yUpperExQty,
    future30yFellBack, future30yTotalExcessCost, future30yLowerMonth, future30yUpperMonth,
  } = sizeFuture30yCover({ future30yYears, future30yLowerCoverBond, future30yUpperCoverBond, settlementDate, dara, daraByYear, refCPI });

  // ─── Accrued Market Discount on discount excess holdings (generic, multi-bond) ──
  // Each excess holding bought below par accretes AMD that is credited to earlier funded years
  // like coupon interest. `amdByYear` is the COMBINED per-year credit (used in sizing); the
  // per-bracket-year lifetime AMD is tracked separately so the cover/bracket Amount can net it
  // out (its accretion is delivered to the earlier years, not to the block — see build-lib excessAmt).
  // Both Future-30Y covers (2052 upper, 2056 lower) carry a market discount and are modeled; push
  // the gap brackets 2036 / 2040 here too once specced and everything downstream (sizing, display,
  // rebalance) picks them up — they are near par so the effect is small. Spec 2.0 §AMD.
  const amdExcessBonds = [];
  if (future30yUpperExQty > 0 && future30yUpperCoverBond)
    amdExcessBonds.push({ year: future30yUpperYear, bond: future30yUpperCoverBond, exQty: future30yUpperExQty });
  if (future30yLowerExQty > 0 && future30yLowerCoverBond)
    amdExcessBonds.push({ year: future30yLowerYear, bond: future30yLowerCoverBond, exQty: future30yLowerExQty });

  const future30yUpperAnnualAmdByYear = new Map();   // combined AMD income per funded year (sizing)
  const amdLifetimeByBracketYear      = new Map();   // per-bracket-year Σ AMD (display: net out of cover P+I)
  for (const { year, bond, exQty } of amdExcessBonds) {
    const sched = excessAmdSchedule({ bond, exQty, refCPI, settlementYear });
    let lifetime = 0;
    for (const [y, v] of sched) { future30yUpperAnnualAmdByYear.set(y, (future30yUpperAnnualAmdByYear.get(y) ?? 0) + v); lifetime += v; }
    amdLifetimeByBracketYear.set(year, (amdLifetimeByBracketYear.get(year) ?? 0) + lifetime);
  }
  function calcFuture30yUpperAnnualAmd(year) {
    return future30yUpperAnnualAmdByYear.get(year) ?? 0;
  }

  // ─── Future-30Y cover-roll coupon (credited to post-upper-maturity funded years) ─
  // After the upper cover (2052) matures, its cost basis is rolled (via the swaps) into the actual
  // Future-30Y TIPS, which then pay coupon. For funded years strictly between the upper cover's
  // maturity and the first Future-30Y year (i.e. 2053–2056), the upper-cover share of that coupon
  // (future30yUpperWeight × the block's annual coupon) is real income that sizes those years down —
  // the seamless hand-off from the 2052 AMD (which runs settlement→2052). NON-cascading: those dollars
  // are already credited as AMD through 2052, so this must not also flow into runningLMI below 2053.
  // The lower cover (2056) needs no analog — no funded year sits between it and the block. Spec 2.0 §AMD.
  const future30yRollCouponByYear = new Map();
  if (future30yYears.length > 0 && future30yUpperExQty > 0 && future30yUpperCoverBond) {
    const rollAnnual   = future30yUpperWeight * (future30yParams?.future30ySeedLMI ?? 0);
    const upperMatYear = future30yUpperCoverBond.maturity.getFullYear();
    const minFuture30y = Math.min(...future30yYears);
    if (rollAnnual > 0)
      for (let y = upperMatYear + 1; y < minFuture30y; y++) future30yRollCouponByYear.set(y, rollAnnual);
  }
  function calcFuture30yRollCoupon(year) {
    return future30yRollCouponByYear.get(year) ?? 0;
  }
  // Combined non-cascading per-year income credit (AMD + roll coupon) used throughout sizing.
  function calcFuture30yExtraIncome(year) {
    return calcFuture30yUpperAnnualAmd(year) + calcFuture30yRollCoupon(year);
  }

  // Intra-block coupon that sized the synthetic Future-30Y rungs down (Σ laterMatInt across the
  // block) — the analog of gapLMITotal. Added back to the cover Amount so the cover total reads
  // ≈ numFuture30yYears × DARA (the coverage those years receive), consistent with the gap row.
  const future30yLMITotal = (future30yParams?.breakdown ?? []).reduce((s, b) => s + (b.laterMatInt ?? 0), 0);

  // 3b. Pre-ladder interest pool (coupons received before the ladder starts, + pre-ladder AMD).
  const preLadderYears = preLadderInterest ? Math.max(0, firstYear - settlementYear) : 0;
  let preLadderPool = 0;
  let preLadderCouponPool = 0;
  let preLadderAmdPool = 0;
  let preLadderRollCouponPool = 0;
  const zeroedFundedYears = new Set();
  const pliCreditByGapYear = {};
  const pliCreditByFundedYear = {};
  let partialCreditYear = null, partialCredit = 0;

  if (preLadderYears > 0) {
    const totalAnnualInt = Object.values(prelim).reduce((s, p) => s + p.annualInterest, 0);
    preLadderCouponPool = preLadderYears * totalAnnualInt;
    for (let y = settlementYear; y < firstYear; y++) {
      preLadderAmdPool        += calcFuture30yUpperAnnualAmd(y);
      preLadderRollCouponPool += calcFuture30yRollCoupon(y);   // 2053–56 roll coupon if ladder starts after it
    }
    preLadderPool = preLadderCouponPool + preLadderAmdPool + preLadderRollCouponPool;

    const gapYearSet = new Set(gapYears);
    const allYearsSorted = [...new Set([...rangeYears, ...gapYears])].sort((a, b) => a - b);
    let remaining = preLadderPool;

    for (const year of allYearsSorted) {
      if (year < firstYear) continue; // lower bracket year is not a funded year
      if (gapYearSet.has(year)) {
        const actualTIPSLMI = Object.entries(prelim)
          .filter(([y]) => parseInt(y) > year)
          .reduce((s, [, p]) => s + p.annualInterest, 0);
        const need = Math.max(0, (daraByYear?.get(year) ?? dara) - actualTIPSLMI - calcFuture30yUpperAnnualAmd(year));
        if (remaining >= need) {
          pliCreditByGapYear[year] = need;
          remaining -= need;
        } else {
          pliCreditByGapYear[year] = remaining;
          remaining = 0;
          break;
        }
      } else {
        const yearDaraForPLI = daraByYear?.get(year) ?? dara;
        const need = yearDaraForPLI - prelim[year].laterMatInt - calcFuture30yExtraIncome(year);
        if (need <= 0) { zeroedFundedYears.add(year); pliCreditByFundedYear[year] = 0; continue; }
        if (remaining >= need) {
          zeroedFundedYears.add(year);
          pliCreditByFundedYear[year] = need;
          remaining -= need;
        } else {
          pliCreditByFundedYear[year] = remaining;
          partialCreditYear = year;
          partialCredit = remaining;
          break;
        }
      }
    }
  }

  // 3c. Effective prelim for gap calc: zeroed funded years generate no coupon.
  let effectivePrelim = prelim;
  if (zeroedFundedYears.size > 0) {
    effectivePrelim = { ...prelim };
    for (const yr of zeroedFundedYears) {
      if (effectivePrelim[yr]) effectivePrelim[yr] = { ...effectivePrelim[yr], annualInterest: 0 };
    }
  }

  // 4b. Gap parameters → duration matching → bracket weights/excess.
  let gapParams = null;
  let lowerDuration = null, upperDuration = null, lowerWeight = null, upperWeight = null;
  let lowerMonth = null, upperMonth = null;
  let lowerExQty = 0, upperExQty = 0, totalExcessCost = 0;

  if (gapYears.length > 0) {
    const minGapYear = Math.min(...gapYears);
    upperYear = 2040;
    const yearsBeforeGap = rangeYears.filter(y => y < minGapYear);
    lowerYear = Math.max(...yearsBeforeGap);

    // Augment effectivePrelim with future 30Y cover excess interest (2052/2056 are above gap years).
    let augmentedPrelim = effectivePrelim;
    if (future30yYears.length > 0) {
      augmentedPrelim = { ...effectivePrelim };
      if (future30yUpperExQty > 0) {
        const { indexRatio: irU } = bondCalcs(future30yUpperCoverBond, refCPI);
        const extraU = future30yUpperExQty * 1000 * irU * (future30yUpperCoverBond.coupon ?? 0);
        augmentedPrelim[future30yUpperYear] = { ...effectivePrelim[future30yUpperYear], annualInterest: (effectivePrelim[future30yUpperYear]?.annualInterest ?? 0) + extraU };
      }
      if (future30yLowerExQty > 0) {
        const { indexRatio: irL } = bondCalcs(future30yLowerCoverBond, refCPI);
        const extraL = future30yLowerExQty * 1000 * irL * (future30yLowerCoverBond.coupon ?? 0);
        augmentedPrelim[future30yLowerYear] = { ...effectivePrelim[future30yLowerYear], annualInterest: (effectivePrelim[future30yLowerYear]?.annualInterest ?? 0) + extraL };
      }
    }

    gapParams = calcGapParams(gapYears, tipsMap, settlementDate, refCPI, dara, augmentedPrelim, pliCreditByGapYear, daraByYear, future30yUpperAnnualAmdByYear);

    const upperBond = yearBondMap[upperYear];
    upperDuration = calculateMDuration(settlementDate, upperBond.maturity, upperBond.coupon ?? 0, upperBond.yield ?? 0);
    upperMonth = BL_MONTHS[upperBond.maturity.getMonth()];
    const upperCPB = (upperBond.price ?? 0) / 100 * calcIndexRatio(refCPI, upperBond.baseCpi ?? refCPI) * 1000;

    const lowerBond = yearBondMap[lowerYear];
    lowerDuration = calculateMDuration(settlementDate, lowerBond.maturity, lowerBond.coupon ?? 0, lowerBond.yield ?? 0);
    lowerMonth = BL_MONTHS[lowerBond.maturity.getMonth()];
    const lowerCPB = (lowerBond.price ?? 0) / 100 * calcIndexRatio(refCPI, lowerBond.baseCpi ?? refCPI) * 1000;
    ({ lowerWeight, upperWeight } = bracketWeights(lowerDuration, upperDuration, gapParams.avgDuration));
    ({ lowerExQty: lowerExQty, upperExQty: upperExQty } = bracketExcessQtys(gapParams.totalCost, lowerWeight, upperWeight, lowerCPB, upperCPB));
    totalExcessCost = lowerExQty * lowerCPB + upperExQty * upperCPB;
  }

  // 5. Corrected long→short sweep over actual funded years (LMI pool includes bracket excess interest).
  //    corrRungs[year] holds the per-sub-rung breakdown (multi-TIPS years); corrFYQty[year] is the
  //    funded-year total (Σ sub-rung qty) — the value every downstream aggregate consumer reads.
  const corrFYQty = {};
  const corrLMI   = {};
  const corrRungs = {};
  {
    const exByYear = {};
    if (future30yUpperYear != null) exByYear[future30yUpperYear] = (exByYear[future30yUpperYear] ?? 0) + future30yUpperExQty;
    if (future30yLowerYear != null) exByYear[future30yLowerYear] = (exByYear[future30yLowerYear] ?? 0) + future30yLowerExQty;
    if (lowerYear != null) exByYear[lowerYear] = (exByYear[lowerYear] ?? 0) + lowerExQty;
    if (upperYear != null) exByYear[upperYear] = (exByYear[upperYear] ?? 0) + upperExQty;

    let runningLMI = 0;             // full-annual convention — correct for every year but the settlement year
    let runningLMIRemaining = 0;    // same pool, but each holding's coupon capped to dates not yet paid this year
    for (const year of [...rangeYears].sort((a, b) => b - a)) {
      const bond    = yearBondMap[year];                        // representative (excess coupon keys off this)
      const { indexRatio: ir } = bondCalcs(bond, refCPI);
      const yearDara = daraByYear?.get(year) ?? dara;
      const isZrd   = zeroedFundedYears.has(year);
      // The funded year containing settlementDate is already partway through its calendar
      // year: whichever of its incoming coupons already paid have already been received (and,
      // per the RMD/DARA planning use case, already reinvested) — they are not still-forthcoming
      // cash for this year. Every other funded year is entirely in the future, so its incoming
      // coupons haven't happened yet and the full-annual assumption is exactly right there.
      const isSettlementYear = year === settlementYear;
      const incomingLMI = isSettlementYear ? runningLMIRemaining : runningLMI;
      corrLMI[year] = incomingLMI;

      const exQty = exByYear[year] ?? 0;
      const excessLMIFull = exQty * 1000 * ir * (bond.coupon ?? 0);
      const excessLMI = isSettlementYear
        ? exQty * 1000 * ir * (bond.coupon ?? 0) / 2 * remainingCouponPaymentsThisYear(bond.maturity, settlementDate, bondHolidays)
        : excessLMIFull;
      const future30yExtra = calcFuture30yExtraIncome(year);   // AMD (≤2052) + roll coupon (2053–56)

      // Funded-year real P+I need after the year-level income offsets, split across the year's TIPS.
      const need = (isZrd || year > lastYear || year < firstYear) ? 0
        : Math.max(0, yearDara - incomingLMI - excessLMI - future30yExtra - (year === partialCreditYear ? partialCredit : 0));
      const rungs = sizeYearRungs(tipsList(year), need, refCPI);
      const { qty: fyQty, annualInterest: fundedCoupon } = aggregateRungs(rungs);

      corrRungs[year] = rungs;
      corrFYQty[year] = fyQty;
      runningLMI += fundedCoupon + excessLMIFull;
      runningLMIRemaining += rungs.reduce((s, r) => s + r.qty * r.ir * 1000 * r.coupon / 2 * remainingCouponPaymentsThisYear(r.bond.maturity, settlementDate, bondHolidays), 0)
        + exQty * 1000 * ir * (bond.coupon ?? 0) / 2 * remainingCouponPaymentsThisYear(bond.maturity, settlementDate, bondHolidays);
    }
  }

  return {
    prelim, corrFYQty, corrLMI, corrRungs,
    zeroedFundedYears, partialCreditYear, partialCredit, pliCreditByGapYear, pliCreditByFundedYear,
    lowerYear, upperYear, lowerExQty, upperExQty, lowerWeight, upperWeight,
    lowerDuration, upperDuration, lowerMonth, upperMonth, totalExcessCost,
    gapParams, future30yParams,
    future30yLowerDuration, future30yUpperDuration, future30yUpperWeight, future30yLowerWeight,
    future30yLowerExQty, future30yUpperExQty, future30yFellBack, future30yTotalExcessCost,
    future30yLowerMonth, future30yUpperMonth,
    future30yUpperAnnualAmdByYear, calcFuture30yUpperAnnualAmd,
    amdLifetimeByBracketYear, future30yLMITotal,
    future30yRollCouponByYear, calcFuture30yRollCoupon,
    preLadderYears, preLadderPool, preLadderCouponPool, preLadderAmdPool, preLadderRollCouponPool,
  };
}

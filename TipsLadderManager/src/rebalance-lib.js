// rebalance-lib.js -- Core logic for TIPS ladder rebalancing (4.0_TIPS_Ladder_Rebalancing.md)
// Exports: buildTipsMapFromYields, runRebalance, localDate, inferDARAFromCash, inferScaledDARAFromPortfolio

import { bondCalcs, calculateMDuration, yieldFromPrice, calcMktWtdAvg } from '../../shared/src/bond-math.js';
import { indexRatio as calcIndexRatio } from '../../shared/src/ref-cpi.js';
export { yieldFromPrice };
import { interpolateYield, syntheticCoupon, bracketWeights, bracketWeightsN, excessAmdSchedule, gapParamsWithUpperFeedback, future30yParamsCore } from './gap-math.js';
import { sizeLadder, selectLadderBonds, fundedYearAmount, sizeFuture30yCover, rmdCappedRemainingCoupons, latestRemainingCouponDate, maxLastYear } from './ladder-core.js';
import { localDate, fmtDate, fmtDateLong, toDateStr } from './date-util.js';
import { rankForYear, levelValues } from './allocation-policy.js';
import { parseCSVLine } from './broker-import.js';

// Re-export date helpers so existing importers (index.html, tests) keep working.
export { localDate, fmtDate, fmtDateLong };

export function calculatePIPerBond(cusip, maturity, refCPI, tipsMap) {
  const bond = tipsMap.get(cusip);
  if (!bond) return 0;
  const indexRatio = calcIndexRatio(refCPI, bond.datedDateRefCpi || refCPI);
  const adjustedPrincipal = 1000 * indexRatio;
  const annualInterest = adjustedPrincipal * bond.coupon;
  const month = maturity.getMonth() + 1;
  const lastYearInterest = (month < 7) ? annualInterest * 0.5 : annualInterest * 1.0;
  return adjustedPrincipal + lastYearInterest;
}

export function buildTipsMapFromYields(yieldsRows, saYieldByCusip = null) {
  const map = new Map();
  for (const r of yieldsRows) {
    map.set(r.cusip, {
      cusip:    r.cusip,
      maturity: localDate(r.maturity),
      coupon:   r.coupon,
      datedDateRefCpi:  r.datedDateRefCpi,
      price:    r.price  || null,
      yield:    r.yield  || null,
      saYield:  saYieldByCusip?.get(r.cusip) ?? null,
    });
  }
  return map;
}

function identifyBrackets(gapYears, holdings, yearInfo, tipsMap, araByYear, DARA, firstYear = 0) {
  if (gapYears.length === 0) return { lowerCUSIP: null, lowerYear: null, lowerMaturity: null, upperCUSIP: null, upperYear: null, upperMaturity: null };
  const minGapYear = Math.min(...gapYears);
  const upperYear = 2040;
  const upperH = yearInfo[upperYear]?.holdings?.find(h => h.maturity.getMonth() + 1 === 2);
  const upperCUSIP = upperH?.cusip || '912810QF8';
  const upperMaturity = tipsMap.get(upperCUSIP)?.maturity || localDate(`${upperYear}-02-15`);

  const LOWEST_LOWER_BRACKET_YEAR = 2032;

  // Only consider holdings in years >= firstYear as potential lower brackets.
  // Holdings below firstYear are being sold and must not influence bracket selection.
  const cusipTotals = new Map();
  for (const h of holdings) {
    if (h.year < firstYear) continue;
    cusipTotals.set(h.cusip, (cusipTotals.get(h.cusip) ?? 0) + h.qty);
  }

  let maxExcess = -Infinity, lowerCUSIP = null, lowerYear = null, lowerMaturity = null;

  for (const [cusip, totalQty] of cusipTotals.entries()) {
    const bond = tipsMap.get(cusip);
    if (!bond || !bond.maturity) continue;
    const y = bond.maturity.getFullYear();
    if (y >= LOWEST_LOWER_BRACKET_YEAR && y < minGapYear && totalQty > 0) {
      // Metric: Excess ARA. The bracket is the TIPS with the most spare capacity (ARA >> DARA).
      const excess = (araByYear[y] || 0) - DARA;
      if (excess > maxExcess || (excess === maxExcess && totalQty > (cusipTotals.get(lowerCUSIP) || -1))) {
        maxExcess = excess; lowerCUSIP = cusip; lowerYear = y; lowerMaturity = bond.maturity;
      }
    }
  }

  // When firstYear is inside the gap (e.g. 2037–2039), no holdings exist below minGapYear.
  // Fall back to tipsMap to find the latest-maturing pre-gap TIPS.
  // In full rebalance this generates a BUY for 2036 excess bonds (qtyBefore = 0).
  if (lowerCUSIP == null && gapYears.length > 0) {
    for (const bond of tipsMap.values()) {
      if (!bond.maturity || !bond.yield) continue;
      const yr = bond.maturity.getFullYear();
      if (yr < minGapYear) {
        if (!lowerMaturity || bond.maturity > lowerMaturity) {
          lowerCUSIP = bond.cusip; lowerYear = yr; lowerMaturity = bond.maturity;
        }
      }
    }
  }
  return { lowerCUSIP, lowerYear, lowerMaturity, upperCUSIP, upperYear, upperMaturity };
}

function calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings, lastYear, extraLMIByYear = {}, pliCreditByGapYear = {}, daraByYear = null, amdByYear = null) {
  if (gapYears.length === 0) return { avgDuration: 0, totalCost: 0 };
  const holdingsByYear = {};
  for (const h of holdings) {
    if (!holdingsByYear[h.year]) holdingsByYear[h.year] = [];
    holdingsByYear[h.year].push(h);
  }

  // Pre-compute a long→short running-LMI estimate for all 2041+ rungs. Matches build-lib's
  // preliminary sweep (calcPrelimFundedYearAmounts) so that gapParams.totalCost / targetQty2040
  // agree with build-lib despite not using actual holdings.
  const prelimAnnInt = {};
  let runningLMI = 0;
  for (let year = (lastYear || 2040); year >= 2041; year--) {
    const yearBonds = [...tipsMap.values()].filter(b => b.maturity && b.maturity.getFullYear() === year);
    if (yearBonds.length > 0) {
      yearBonds.sort((a, b) => a.maturity - b.maturity);
      const b = yearBonds[yearBonds.length - 1];
      const coupon = b.coupon ?? 0;
      const ir = calcIndexRatio(refCPI, b.datedDateRefCpi || refCPI);
      const piPB = 1000 * ir + (b.maturity.getMonth() + 1 < 7 ? 0.5 : 1.0) * 1000 * ir * coupon;
      const qty = Math.max(0, Math.round(((daraByYear?.get(year) ?? DARA) - runningLMI) / piPB));
      const annInt = qty * 1000 * ir * coupon;
      prelimAnnInt[year] = annInt;
      runningLMI += annInt;
    }
  }

  let laterMaturityFrom2041Plus = 0;
  for (let year = 2041; year <= (lastYear || 2040); year++) {
    laterMaturityFrom2041Plus += prelimAnnInt[year] ?? 0;
  }

  // Resolve 2040 upper bracket: prefer actual holdings, fall back to hardcoded CUSIP if not held
  const _ub2040Holdings = holdingsByYear[2040] ?? [];
  const _ub2040CUSIP = _ub2040Holdings[0]?.cusip || '912810QF8';
  const _ub2040Maturity = _ub2040Holdings[0]?.maturity || localDate('2040-02-15');
  const bond2040 = tipsMap.get(_ub2040CUSIP);
  const coupon2040 = bond2040?.coupon ?? 0;
  const datedDateRefCpi2040 = bond2040?.datedDateRefCpi ?? refCPI;
  const indexRatio2040 = calcIndexRatio(refCPI, datedDateRefCpi2040);
  const piPerBond2040 = calculatePIPerBond(_ub2040CUSIP, _ub2040Maturity, refCPI, tipsMap);
  // When lastYear < 2040, 2040 is purely a bracket (not a funded rung) — use actual holdings qty for LMI
  const targetQty2040 = lastYear < 2040
    ? _ub2040Holdings.reduce((s, h) => s + h.qty, 0)
    : Math.round(((daraByYear?.get(2040) ?? DARA) - laterMaturityFrom2041Plus) / (piPerBond2040 || 1));
  const annualInterest2040 = targetQty2040 * 1000 * indexRatio2040 * coupon2040;

  const gapLaterMaturityInterest = { 2040: annualInterest2040 };
  // Add other years > 2040 to the gap LMI pool (same prelim running-LMI estimate as above)
  for (let year = 2041; year <= (lastYear || 2040); year++) {
    gapLaterMaturityInterest[year] = prelimAnnInt[year] ?? 0;
  }

  // Inject future cover excess LMI (bonds beyond current holdings to be purchased)
  for (const [y, extra] of Object.entries(extraLMIByYear)) {
    if (extra > 0) gapLaterMaturityInterest[y] = (gapLaterMaturityInterest[y] ?? 0) + extra;
  }

  // Shared sweep + 2040 upper-excess-coupon fixpoint. Rebalance's "LMI above the gap" =
  // gapLaterMaturityInterest (holdings/targets + future-cover excess), assembled above.
  // Everything else is identical to build via the shared gapParamsWithUpperFeedback.
  return gapParamsWithUpperFeedback({
    gapYears, tipsMap, settlementDate, refCPI, dara: DARA, daraByYear,
    lmiAboveByYear: gapLaterMaturityInterest, pliCreditByGapYear, amdByYear,
  });
}

// The natural (un-overridden) first/last year of a ladder: the earliest and latest maturity year
// held. Single source for runRebalance and the Rebalance UI's First/Last Year dropdowns
// (3.0 §Ladder Range) — no contiguity requirement, an unheld year in between is just an empty rung.
export function deriveHoldingsYearRange(holdings, tipsMap) {
  const years = [...new Set(holdings.map(h => tipsMap.get(h.cusip)?.maturity?.getFullYear()).filter(y => y != null))];
  if (!years.length) return null;
  return { firstYear: Math.min(...years), lastYear: Math.max(...years) };
}

// Infer the true firstYear when a Format 4/5 CSV is loaded whose derivedFirstYear is a pure bracket
// year below the gap years (e.g. 2036 when the ladder actually started at 2038).
// Returns the inferred gap-year firstYear, or null if the inference does not apply.
export function inferFirstYearFromHoldings({ holdings, tipsMap, refCPI, settlementDate }) {
  const enriched = holdings.map(h => {
    const bond = tipsMap.get(h.cusip);
    return bond?.maturity ? { cusip: h.cusip, qty: h.qty, excessQty: h.excessQty, maturity: bond.maturity, year: bond.maturity.getFullYear() } : null;
  }).filter(Boolean);
  if (!enriched.length) return null;
  enriched.sort((a, b) => a.maturity - b.maturity);

  const derivedFirstYear = enriched[0].year;
  const firstYearH = enriched.filter(h => h.year === derivedFirstYear);

  // Requires Format 4/5: all holdings at derivedFirstYear have excessQty defined and equal qty.
  if (!firstYearH.every(h => h.excessQty != null)) return null;
  const firstYearTotal = firstYearH.reduce((s, h) => s + h.qty, 0);
  const firstYearExcess = firstYearH.reduce((s, h) => s + h.excessQty, 0);
  if (firstYearExcess !== firstYearTotal) return null;

  // derivedFirstYear bond must be a Jan maturity (pre-gap anchor).
  const bond0 = tipsMap.get(firstYearH[0].cusip);
  if (!bond0 || bond0.maturity.getMonth() + 1 !== 1) return null;

  // Build structural gap: consecutive years below 2040 with no TIPS issued.
  const tipsMapYears = new Set([...tipsMap.values()].filter(b => b.maturity).map(b => b.maturity.getFullYear()));
  const structuralGap = [];
  for (let y = 2039; y > derivedFirstYear; y--) {
    if (!tipsMapYears.has(y)) structuralGap.push(y);
    else break;
  }
  if (!structuralGap.length) return null;
  structuralGap.reverse(); // ascending: [2037, 2038, 2039]

  // Total P+I of excess bonds ≈ numGapYears × DARA  (spec §Gap Year Coverage Model).
  // Use this to directly compute numGapYears = round(totalExcessPI / roughDARA).
  const piPerBondFor = (yr) => {
    const h = enriched.find(e => e.year === yr);
    if (!h) return 0;
    const b = tipsMap.get(h.cusip);
    if (!b) return 0;
    const ir = calcIndexRatio(refCPI, b.datedDateRefCpi ?? refCPI);
    const m = b.maturity.getMonth() + 1;
    return 1000 * ir + 1000 * ir * b.coupon * (m < 7 ? 0.5 : 1.0);
  };
  const upper2040Excess = enriched.filter(h => h.year === 2040).reduce((s, h) => s + (h.excessQty ?? 0), 0);
  const totalExcessPI = firstYearExcess * piPerBondFor(derivedFirstYear) + upper2040Excess * piPerBondFor(2040);
  if (totalExcessPI <= 0) return null;

  // Rough DARA: median ARA of the non-bracket, non-gap funded years.
  const hYears = [...new Set(enriched.map(h => h.year))].sort((a, b) => a - b);
  const gapSet = new Set(structuralGap);
  const araLMI = {};
  const araByYear = {};
  for (const year of hYears.slice().sort((a, b) => b - a)) {
    let lmi = 0;
    for (const y in araLMI) if (parseInt(y) > year) lmi += araLMI[y];
    araLMI[year] = 0;
    let p = 0, c = 0;
    for (const h of enriched.filter(e => e.year === year)) {
      const b = tipsMap.get(h.cusip);
      const ir = calcIndexRatio(refCPI, b.datedDateRefCpi ?? refCPI);
      const ap = 1000 * ir, m = h.maturity.getMonth() + 1;
      const fundedQty = h.qty - (h.excessQty ?? 0);
      p += fundedQty * ap; c += fundedQty * ap * b.coupon * (m < 7 ? 0.5 : 1.0);
      araLMI[year] += fundedQty * ap * b.coupon;
    }
    araByYear[year] = p + c + lmi;
  }
  const araVals = [];
  for (let y = derivedFirstYear + 1; y <= (hYears[hYears.length - 1] ?? derivedFirstYear); y++) {
    if (!gapSet.has(y) && y !== derivedFirstYear && araByYear[y] != null) araVals.push(araByYear[y]);
  }
  araVals.sort((a, b) => a - b);
  const midIdx = Math.floor(araVals.length / 2);
  const roughDARA = araVals.length === 0 ? 0
    : araVals.length % 2 === 0 ? (araVals[midIdx - 1] + araVals[midIdx]) / 2
    : araVals[midIdx];
  if (roughDARA <= 0) return null;

  // numGapYears = round(totalExcessPI / roughDARA); firstYear = 2040 - numGapYears.
  const numGapYears = Math.round(totalExcessPI / roughDARA);
  const inferred = 2040 - numGapYears;
  const minGap = structuralGap[0], maxGap = structuralGap[structuralGap.length - 1];
  if (inferred < minGap || inferred > maxGap) return null;
  return inferred;
}

// Symmetric to inferFirstYearFromHoldings, for the OTHER end of the ladder.
// Spec: 2.0 §Future 30Y Rungs. The file's EXCESS column at the Future-30Y cover years (latest 2056
// lower + latest 2052 upper) signals the ladder extends past the last actual TIPS year (2056). The
// number of synthetic rungs — i.e. lastYear — is encoded in the cost-weighted split between the two
// covers, which is DARA-independent (it's a pure duration match). So we forward-reconstruct: for each
// candidate lastYear, predict the upper-cover weight via the SAME future30yParamsCore + bracketWeights
// the build uses, and return the year whose predicted split matches the file. Returns null when there
// is no cover excess (ladder ends at the last actual TIPS) or the covers are missing — leaving the
// derivation from the held maturity years in place. A simple excess/DARA ratio (as the gap uses) does NOT work
// here: the 2052 cover is deep-discount and a long Future-30Y block carries a large LMI cascade.
export function inferLastYearFromHoldings({ holdings, tipsMap, refCPI, settlementDate }) {
  let cover2056 = null, cover2052 = null, maxTipsYear = 0;
  for (const b of tipsMap.values()) {
    if (!b.maturity) continue;
    const yr = b.maturity.getFullYear();
    maxTipsYear = Math.max(maxTipsYear, yr);
    if (yr === 2056 && (!cover2056 || b.maturity > cover2056.maturity)) cover2056 = b;
    if (yr === 2052 && (!cover2052 || b.maturity > cover2052.maturity)) cover2052 = b;
  }
  if (!cover2056 || !cover2052) return null;

  // Observed cover excess from the file (Format 4/5 only — excessQty must be present).
  const coverHoldings = holdings.filter(h => {
    const yr = tipsMap.get(h.cusip)?.maturity?.getFullYear();
    return yr === 2052 || yr === 2056;
  });
  if (!coverHoldings.length || !coverHoldings.every(h => h.excessQty != null)) return null;
  const exAt = (yr) => coverHoldings
    .filter(h => tipsMap.get(h.cusip).maturity.getFullYear() === yr)
    .reduce((s, h) => s + (h.excessQty ?? 0), 0);
  const obsLo = exAt(2056), obsUp = exAt(2052);
  if (obsLo + obsUp <= 0) return null;   // no Future-30Y excess → ladder ends at maxTipsYear

  const irL = calcIndexRatio(refCPI, cover2056.datedDateRefCpi ?? refCPI), irU = calcIndexRatio(refCPI, cover2052.datedDateRefCpi ?? refCPI);
  const cpb2056 = (cover2056.price ?? 0) / 100 * irL * 1000;
  const cpb2052 = (cover2052.price ?? 0) / 100 * irU * 1000;
  if (!(cpb2056 > 0) || !(cpb2052 > 0)) return null;
  const dur2056 = calculateMDuration(settlementDate, cover2056.maturity, cover2056.coupon ?? 0, cover2056.yield ?? 0);
  const dur2052 = calculateMDuration(settlementDate, cover2052.maturity, cover2052.coupon ?? 0, cover2052.yield ?? 0);

  // Cost-weighted observed upper weight, matched against the build's predicted weight per candidate year.
  const obsUW = (obsUp * cpb2052) / ((obsUp * cpb2052) + (obsLo * cpb2056));
  const NOMINAL_DARA = 100000;   // predicted upper weight is scale-invariant; any nominal DARA works
  let best = null;
  for (let L = maxTipsYear + 1, _maxL = maxLastYear(maxTipsYear); L <= _maxL; L++) {
    const years = [];
    for (let y = maxTipsYear + 1; y <= L; y++) years.push(y);
    const fp = future30yParamsCore({ future30yYears: years, coverBond2056: cover2056, settlementDate, dara: NOMINAL_DARA });
    const { upperWeight } = bracketWeights(dur2056, dur2052, fp.avgDuration);
    const err = Math.abs(upperWeight - obsUW);
    if (!best || err < best.err) best = { L, err };
  }
  return best ? best.L : null;
}

export function inferDARAFromCash({ bracketMode = '2bracket', holdings: holdingsRaw, tipsMap, refCPI, settlementDate, lastYearOverride = null, preLadderInterest = false, firstYearOverride = null, bondHolidays = new Set(), availableCash = 0, rmdCouponMode = 'all', tradeDate = settlementDate }) {
  let portfolioCash = 0;
  for (const h of holdingsRaw) {
    const bond = tipsMap.get(h.cusip);
    if (!bond) continue;
    const ir = calcIndexRatio(refCPI, bond.datedDateRefCpi ?? refCPI);
    portfolioCash += h.qty * (bond.price ?? 0) / 100 * ir * 1000;
  }
  let lo = 1000, hi = 1000000, foundDARA = lo;
  // Binary search for the largest INTEGER DARA that results in delta >= 0
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const { summary } = runRebalance({ dara: mid, bracketMode, holdings: holdingsRaw, tipsMap, refCPI, settlementDate, lastYearOverride, preLadderInterest, firstYearOverride, bondHolidays, availableCash, rmdCouponMode, tradeDate });
    if (summary.costDeltaSum >= 0) {
      foundDARA = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { dara: foundDARA, portfolioCash };
}

// ─── Per-year DARA recovery from holdings (import path) ──────────────────────────
// These three are the front half of the import-time DARA reconstruction: recover each
// funded year's ARA from the held quantities, flag gap-bracket years, and turn the ARA
// map into a per-year DARA map. They live here (not in index.html) so the full
// build→export→import→rebalance round-trip is reachable from tests as one chain.

// Recover raw ARA per funded year from holdings: funded-qty P+I plus LMI cascaded from
// later maturities (full held qty, incl. excess, contributes coupon to earlier years).
// NOTE: this is only (P+I)+LMI. The cover-year income terms (own excess coupon + 2052
// AMD) that build also credits are added downstream in inferScaledDARAFromPortfolio,
// which has the settlement/last-year context the AMD schedule needs.
//
// Default form (no `range`): emit ONLY years that hold a TIPS — used for median/bracket detection
// and the segment infer solves. Range form (`{ firstYear, lastYear }`): emit EVERY year in the
// range, including empty ones (a year with no own TIPS gets `ARA = incoming LMI` alone). Holdings
// maturing after `lastYear` are not emitted but still cascade their coupon into earlier years' LMI.
// The range form is the file-load "mirror current holdings" population (3.0 §Per-Year DARA from
// Portfolio) — every rung shows its true current income so the first Rebalance Ladder is a no-op.
export function computePortfolioARAByYear(holdingsArr, tipsMap, refCPI, range = null) {
  const byYear = {};
  for (const h of holdingsArr) {
    const b = tipsMap.get(h.cusip);
    if (!b?.maturity) continue;
    const ir = calcIndexRatio(refCPI, b.datedDateRefCpi ?? refCPI);
    const year = b.maturity.getFullYear();
    const m = b.maturity.getMonth() + 1;
    const nPay = m < 7 ? 1 : 2;  // Jan-Jun: 1 final coupon; Jul-Dec: 2
    const piPB = 1000 * ir * (1 + (b.coupon ?? 0) * 0.5 * nPay);
    // Use funded qty only for this year's P+I — excess bonds' P+I inflates the ARA target.
    // Keep full qty for annual interest (LMI flowing to earlier years remains correct).
    const fundedQty = (h.excessQty != null) ? Math.max(0, h.qty - h.excessQty) : h.qty;
    if (!byYear[year]) byYear[year] = { totalPI: 0, annInt: 0 };
    byYear[year].totalPI += fundedQty * piPB;
    byYear[year].annInt  += h.qty * 1000 * ir * (b.coupon ?? 0);
  }
  const ara = {};
  const heldYears = Object.keys(byYear).map(Number);
  if (!range) {
    let lmi = 0;
    for (const y of heldYears.sort((a, b) => b - a)) { // long to short
      ara[y] = byYear[y].totalPI + lmi;
      lmi += byYear[y].annInt;
    }
    return ara; // { year: rawARA } — held years only
  }
  // Range form: walk top→bottom so the running LMI is correct at each year. Start at the latest of
  // lastYear or the latest holding (so post-range holdings' coupon still cascades down).
  const { firstYear, lastYear } = range;
  const topYear = Math.max(lastYear, ...(heldYears.length ? heldYears : [lastYear]));
  let lmi = 0;
  for (let y = topYear; y >= firstYear; y--) {
    if (y <= lastYear) ara[y] = (byYear[y]?.totalPI ?? 0) + lmi;
    if (byYear[y]) lmi += byYear[y].annInt;
  }
  return ara;
}

// Gap years: the run of years (counting down from 2039) for which NO TIPS
// have been issued (currently 2037-2039). These rungs cannot be held directly; they are funded
// by bracket excess at the adjacent years. Single source for "which years are gap years".
export function getGapYears(tipsMap) {
  if (!tipsMap) return [];
  const tipsYears = new Set();
  for (const b of tipsMap.values()) { if (b.maturity) tipsYears.add(b.maturity.getFullYear()); }
  const gapYears = [];
  for (let y = 2039; y >= 2020; y--) {
    if (!tipsYears.has(y)) gapYears.push(y);
    else break;
  }
  return gapYears;
}

// Years adjacent to the structural gap (2037-2039) that may carry bracket excess: the
// 2040 upper bracket and any TIPS maturity year in [2032, minGap) that could have been an old lower
// bracket. Holdings in these years with ARA > 1.5× median are auto-capped to median.
// `lastYear` is the ladder's selected last funded year — bracket bridging (and so the whole
// candidate concept) only applies once the ladder actually reaches the structural gap. A
// ladder that stops short of it (e.g. lastYear 2036) has no gap to bridge, so a large holding
// at an otherwise-candidate year (e.g. 2034) is just a regular funded year, not bracket excess.
export function getGapYearBracketCandidates(tipsMap, lastYear = Infinity) {
  if (!tipsMap) return new Set();
  const gapYears = getGapYears(tipsMap);
  if (gapYears.length === 0) return new Set();
  const minGap = Math.min(...gapYears);
  if (lastYear < minGap) return new Set();
  const maxGap = Math.max(...gapYears);
  const LOWEST_LOWER = 2032;
  const candidates = new Set([maxGap + 1]);
  for (const b of tipsMap.values()) {
    if (!b.maturity) continue;
    const yr = b.maturity.getFullYear();
    if (yr >= LOWEST_LOWER && yr < minGap) candidates.add(yr);
  }
  return candidates;
}

// Turn the raw ARA map into a per-year DARA map. Only suppress ARA > 1.5× median for
// bracket-candidate years (adjacent to structural gaps); non-bracket years keep full ARA.
export function derivePerYearDara(araByYear, bracketCandidates = new Set()) {
  const vals = Object.values(araByYear).filter(v => v > 0);
  if (vals.length === 0) return { median: 0, daraMap: new Map(), autoCappedYears: new Set() };
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const daraMap = new Map();
  const autoCappedYears = new Set();
  for (const [y, ara] of Object.entries(araByYear)) {
    const year = parseInt(y);
    if (bracketCandidates.has(year) && ara > 1.5 * median) {
      daraMap.set(year, Math.round(median));
      autoCappedYears.add(year);
    } else {
      daraMap.set(year, Math.round(ara));
    }
  }
  return { median: Math.round(median), daraMap, autoCappedYears };
}

// Parse the optional `#fundedYear,dara` metadata block appended to our own export files
// (see 2.1 Broker Import). Returns Map<year, dara> — the durable build intent for EVERY year
// in [firstYear, lastYear], incl. gap + future-30Y — or null if absent. When present, the
// import honors it directly (exact round-trip, no DARA/last-year inference). Backward-compatible:
// the holdings parsers skip these lines (they aren't valid CUSIP rows). Uses the same
// quote-aware line splitter as broker-import.js so amount fields survive a round-trip through
// a spreadsheet (quoted thousands separators, currency symbols).
export function parseFundedYearDaraBlock(rawLines) {
  const map = new Map();
  let inBlock = false;
  for (const line of rawLines) {
    const norm = line.replace(/\s/g, '').toLowerCase();
    if (!inBlock) { if (norm === '#fundedyear,dara') inBlock = true; continue; }
    const parts = parseCSVLine(line.replace(/^#/, ''));
    const yr = parseInt(parts[0], 10), v = parseFloat((parts[1] || '').replace(/[^0-9.-]/g, ''));
    if (parts.length >= 2 && yr >= 2000 && yr <= 2200 && !isNaN(v) && v >= 0) map.set(yr, v);
  }
  return map.size > 0 ? map : null;
}

// Parse the `#params,key=value,...` line our exports append next to the DARA block. Carries the
// construction parameters that per-year DARA does NOT encode but that still change the target
// ladder — chiefly `preLadderInterest` (PLI zeroes early rungs), `maturityPref` (which bond
// per year), and `couponPref` (which issue wins a same-month two-issue tie). On import these set
// the UI controls so a round-trip reconstructs exactly; the user may then override them (see 2.1
// Broker Import). Returns null when absent (broker/legacy files).
export function parseParamsBlock(rawLines) {
  for (const line of rawLines) {
    const norm = line.replace(/\s/g, '').toLowerCase();
    if (!norm.startsWith('#params,')) continue;
    const out = {};
    for (const kv of line.replace(/^#?params,?/i, '').split(',')) {
      const [k, v] = kv.split('=').map(s => s.trim());
      if (!k) continue;
      if (/^preladderinterest$/i.test(k)) out.preLadderInterest = /^(true|1|yes|on)$/i.test(v);
      else if (/^maturitypref$/i.test(k)) out.maturityPref = /^(first|semiannual|all)$/i.test(v) ? v.toLowerCase() : 'last';
      else if (/^couponpref$/i.test(k)) out.couponPref = /^lower$/i.test(v) ? 'lower' : 'higher';
      // `rmdCashOverride` is the superseded key for the same figure, read as an alias so files
      // written before Available Cash went ladder-wide keep working (2.1 §`#params` line).
      else if (/^(availablecash|rmdcashoverride)$/i.test(k)) { const n = parseFloat(v); if (!isNaN(n) && n >= 0) out.availableCash = n; }
      else if (/^rmdcouponmode$/i.test(k)) out.rmdCouponMode = /^(none|last)$/i.test(v) ? v.toLowerCase() : 'all';
      // The Ref CPI date the file's DARA values are denominated at (3.0 §DARA Reference Date).
      else if (/^refcpidate$/i.test(k)) { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) out.refCpiDate = v; }
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  return null;
}

// BEST-EFFORT per-year DARA recovery for files that carry NO explicit DARA (broker imports,
// legacy Format-5 exports, tipsladder Format-4). Our own current exports carry an explicit
// `#fundedYear,dara` block (see 2.1 Broker Import) and bypass this entirely — for those the
// round-trip is exact by construction. This path only estimates a self-financing per-year
// DARA from the held quantities, which is inherently lossy where build hid the DARA (e.g.
// PLI-zeroed years) — hence "best effort".
//
// Recover per-year ARA, correct the cover-year income build credits (own-excess-coupon on the
// 2056 lower cover, AMD on the 2052 upper cover), then PROPORTIONALLY scale the whole map to
// the self-financing level — preserving any genuine per-year shape (user-edited DARA) rather
// than flattening it. preLadderInterest must match the run (the PLI pool shifts the equilibrium).
// `scopeYears` (Set<year>) + `fixedDaraByYear` (Map) make this a SEGMENT-scoped solve (see 3.0 §
// Two-Segment DARA): only in-scope years are scaled by the searched factor; out-of-scope years take
// their value from `fixedDaraByYear` (the other segment's already-decided DARA — the cascade
// boundary); and the self-finance metric becomes the cost delta summed over in-scope funded years
// only, not the whole portfolio. Both default null → identical whole-portfolio behaviour as before.
// `flat = true` makes the in-scope solve target a SINGLE flat DARA across every in-scope rung
// (even real income — the liability-matching use case) instead of the proportionally-scaled
// natural-ARA shape; the binary search then finds the one flat level that self-finances the segment.
export function inferScaledDARAFromPortfolio({ daraMap, median: _median, holdings: holdingsRaw, tipsMap, refCPI, settlementDate, bracketMode = '2bracket', lastYearOverride = null, firstYearOverride = null, preLadderInterest = false, scopeYears = null, fixedDaraByYear = null, pinnedDaraByYear = null, flat = false, bondHolidays = new Set(), availableCash = 0, rmdCouponMode = 'all', tradeDate = settlementDate, maturityPref = 'last', allocationPolicy = 'equal', yearRankOverrides = null, yearOverrides = null, correctCoverIncome = true }) {
  // Cover-year income correction (skipped when the map is already a stated per-year plan rather
  // than one recovered from holdings — `correctCoverIncome: false`; the plan states each year's
  // true DARA, so adding the cover terms to it would count that income twice):
  // build's per-year DARA identity is
  //   DARA_y = (P+I)_y + LMI_y + ownExcessCoupon_y + AMD_y
  // but computePortfolioARAByYear recovers only (P+I)+LMI. Add the two cover terms back so the
  // recovered map matches build at the covers. (Coupon-bearing 2056 earns ownExcessCoupon;
  // near-zero-coupon 2052 earns AMD — complementary.)
  const settlementYear = settlementDate.getFullYear();
  let maxTipsYear = 0;
  for (const bond of tipsMap.values()) if (bond.maturity) maxTipsYear = Math.max(maxTipsYear, bond.maturity.getFullYear());
  const _lastY = (lastYearOverride != null && !isNaN(lastYearOverride)) ? lastYearOverride : maxTipsYear;

  const ownExcessCoupon = {};
  for (const h of holdingsRaw) {
    const ex = h.excessQty ?? 0;
    if (ex <= 0) continue;
    const bond = tipsMap.get(h.cusip);
    if (!bond?.maturity) continue;
    const ir = calcIndexRatio(refCPI, bond.datedDateRefCpi ?? refCPI);
    const yr = bond.maturity.getFullYear();
    ownExcessCoupon[yr] = (ownExcessCoupon[yr] ?? 0) + ex * 1000 * ir * (bond.coupon ?? 0);
  }

  let amdByYear = new Map();
  let rollByYear = new Map();   // Future-30Y cover-roll coupon credited to post-2052-maturity years (2053–56)
  if (_lastY > maxTipsYear) {
    const future30yYears = [];
    for (let y = maxTipsYear + 1; y <= _lastY; y++) future30yYears.push(y);
    let upperCover = null, lowerCover = null;
    for (const bond of tipsMap.values()) {
      if (bond.maturity?.getFullYear() === 2052 && (!upperCover || bond.maturity > upperCover.maturity)) upperCover = bond;
      if (bond.maturity?.getFullYear() === 2056 && (!lowerCover || bond.maturity > lowerCover.maturity)) lowerCover = bond;
    }
    if (upperCover) {
      const heldUpperExcess = holdingsRaw.reduce((s, h) => h.cusip === upperCover.cusip ? s + (h.excessQty ?? 0) : s, 0);
      if (heldUpperExcess > 0) {
        amdByYear = excessAmdSchedule({ bond: upperCover, exQty: heldUpperExcess, refCPI, settlementYear });
        // Roll coupon (held-based): rolled upper-cover dollars × the synthetic Future-30Y coupon rate
        // — algebraically the same as upperWeight × block coupon used in sizeLadder. Spec 2.0 §AMD.
        if (lowerCover) {
          const irU = calcIndexRatio(refCPI, upperCover.datedDateRefCpi ?? refCPI);
          const costUpper = (upperCover.price ?? 0) / 100 * irU * 1000;
          const rollAnnual = heldUpperExcess * costUpper * syntheticCoupon(lowerCover.yield ?? 0);
          const upperMatYear = upperCover.maturity.getFullYear();
          const minFuture30y = Math.min(...future30yYears);
          if (rollAnnual > 0)
            for (let y = upperMatYear + 1; y < minFuture30y; y++) rollByYear.set(y, rollAnnual);
        }
      }
    }
  }

  if (correctCoverIncome) daraMap = new Map([...daraMap.entries()].map(([y, v]) => [y, v + (ownExcessCoupon[y] ?? 0) + (amdByYear.get(y) ?? 0) + (rollByYear.get(y) ?? 0)]));

  const inScope = scopeYears ? (y => scopeYears.has(y)) : (() => true);

  // Cash-scope: like inScope, but ALSO claims trade rows whose year sits beyond the ladder's own
  // lastYear — e.g. the upper gap bracket (2040) when lastYear lands inside the structural gap
  // (3.0 §lastYear as a Gap Year), which produces a trade with no daraByYear target of its own
  // (buildMap never assigns it `level`, so it must stay out of `inScope`) but whose cash delta
  // still has to land in SOME segment's self-finance metric, or the search silently ignores it and
  // converges on a DARA that leaves the reported whole-portfolio net cash far from zero. Attributed
  // to whichever segment reaches the top of the range — mirrors the documented rule that the
  // speculative cover pair / Future-30Y excess belongs to the speculative segment.
  const topYear = scopeYears ? (lastYearOverride ?? Math.max(...scopeYears)) : null;
  const inCashScope = scopeYears
    ? (y => scopeYears.has(y) || (y > topYear && scopeYears.has(topYear)))
    : (() => true);

  // A year the user has hand-typed a value into (`pinnedDaraByYear`) is held at that value even
  // though it sits inside this segment's scope — the segment-flat solve sweeps only the remaining,
  // non-pinned years to find its self-financing level. The pinned year's real cash flow still counts
  // toward the segment's net-cash target (inCashScope/netCash below stay keyed off the full
  // scopeYears), it just isn't itself a candidate for restamping.
  const isPinned = pinnedDaraByYear ? (y => pinnedDaraByYear.has(y)) : (() => false);
  const sweepable = y => inScope(y) && !isPinned(y);

  // Scaling pivots on the IN-SCOPE, non-pinned natural-ARA median, so the returned scaledMedian is
  // the segment's own median over the years it actually solves for (the whole-portfolio median when
  // unscoped and nothing is pinned).
  const _vals = [...daraMap.entries()].filter(([y, v]) => sweepable(y) && v > 0).map(([, v]) => v).sort((a, b) => a - b);
  const median = _median ?? (_vals.length > 0 ? _vals[Math.floor(_vals.length / 2)] : 0);

  // daraByYear fed to each trial at DARA `level`: sweepable years take `level` flat (flat mode) or
  // the natural ARA scaled by level/median; pinned years keep their fixed value; out-of-scope years
  // take the other segment's fixed DARA (else their own natural ARA, so fixed=null ≡ whole-portfolio).
  const buildMap = level => {
    const k = median > 0 ? level / median : 1;
    const m = new Map();
    for (const [y, v] of daraMap) {
      if (sweepable(y)) m.set(y, flat ? level : Math.round(v * k));
      else if (isPinned(y)) m.set(y, pinnedDaraByYear.get(y));
      else m.set(y, fixedDaraByYear?.get(y) ?? Math.round(v));
    }
    if (fixedDaraByYear) for (const [y, v] of fixedDaraByYear) if (!sweepable(y) && !isPinned(y) && !m.has(y)) m.set(y, v);
    if (pinnedDaraByYear) for (const [y, v] of pinnedDaraByYear) if (!m.has(y)) m.set(y, v);
    return m;
  };

  // Self-finance metric: whole costDeltaSum, or — when scoped — cost delta summed over rebalance
  // rows whose funded year is in cash-scope (results[i][11] ↔ details[i].fundedYear, kept index-parallel).
  const netCash = ({ results, details, summary }) => {
    if (!scopeYears) return summary.costDeltaSum;
    let s = 0;
    for (let i = 0; i < results.length; i++) {
      const cd = results[i][11];
      if (inCashScope(details[i]?.fundedYear) && typeof cd === 'number') s += cd;
    }
    return s;
  };

  // Every trial below runs the ladder the CALLER will execute — same maturity preference, same
  // within-year allocation policy, same per-year overrides (3.0 §Target CUSIP resolution). Those
  // choices decide which CUSIP each year buys and therefore what each trade costs, so a search run
  // under the defaults solves for a ladder the caller never builds: the level it returns can be
  // self-financing under 'equal'/'last' and still land thousands of dollars short once executed
  // under the user's actual settings.
  //
  // Binary-search the DARA level at which the per-year map (flat or proportional) is self-financing.
  // A trial may be INFEASIBLE: pushing this segment's DARA high floods later-maturity interest into a
  // downstream (out-of-scope) year until it can't fund one bond → sizeLadder throws (err.daraTooLowYear).
  // Such a throw means this segment's DARA is too high → search lower. A throw on an IN-SCOPE year means
  // this segment's own DARA is too low → search higher. (Without scoping every year is in scope.)
  let lo = 1000, hi = 1000000, foundDARA = lo;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    let result;
    try {
      result = runRebalance({ dara: mid, bracketMode, holdings: holdingsRaw, tipsMap, refCPI, settlementDate, daraByYear: buildMap(mid), lastYearOverride, firstYearOverride, preLadderInterest, bondHolidays, availableCash, rmdCouponMode, tradeDate, maturityPref, allocationPolicy, yearRankOverrides, yearOverrides });
    } catch (e) {
      if (e && e.daraTooLowYear != null && sweepable(e.daraTooLowYear)) lo = mid + 1;
      else hi = mid - 1;
      continue;
    }
    if (netCash(result) >= 0) { foundDARA = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  const scaledMap = buildMap(foundDARA);
  // In-scope gap / future-30Y years have no natural-ARA row — pin them to the segment median
  // (mirrors the scalar fallback runRebalance used for them during the search).
  if (scopeYears) for (const y of scopeYears) if (!scaledMap.has(y)) scaledMap.set(y, foundDARA);
  return { scaledMedian: foundDARA, scaledMap };
}

export function runRebalance({ dara, bracketMode = '2bracket', holdings: holdingsRaw, tipsMap, refCPI, settlementDate, daraByYear = null, lastYearOverride = null, preLadderInterest = false, firstYearOverride = null, maturityPref = 'last', allocationPolicy = 'equal', yearRankOverrides = null, yearOverrides = null, bondHolidays = new Set(), availableCash = 0, rmdCouponMode = 'all', tradeDate = settlementDate }) {
  const settleDateStr  = toDateStr(settlementDate);
  const settleDateDisp = fmtDate(settlementDate);

  const holdings = [];
  for (const h of holdingsRaw) {
    const bond = tipsMap.get(h.cusip);
    if (!bond) continue;
    holdings.push({
      cusip:     h.cusip,
      qty:       h.qty,
      excessQty: h.excessQty,
      maturity:  bond.maturity,
      year:      bond.maturity.getFullYear(),
    });
  }
  holdings.sort((a, b) => a.maturity - b.maturity);

  // Consolidate multiple holdings with same CUSIP/year from different accounts
  const consolidatedMap = new Map();
  for (const h of holdings) {
    const key = h.cusip + '|' + h.year;
    if (consolidatedMap.has(key)) {
      const existing = consolidatedMap.get(key);
      existing.qty += h.qty;
    } else {
      consolidatedMap.set(key, { ...h });
    }
  }
  const consolidatedHoldings = Array.from(consolidatedMap.values()).sort((a, b) => a.maturity - b.maturity);

  const yearInfo = {};
  consolidatedHoldings.forEach((h, idx) => {
    if (!yearInfo[h.year]) yearInfo[h.year] = { firstIdx: idx, lastIdx: idx, holdings: [] };
    yearInfo[h.year].lastIdx = idx;
    yearInfo[h.year].holdings.push(h);
  });

  const holdingsYears = Object.keys(yearInfo).map(Number).sort((a, b) => a - b);
  const derivedFirstYear = holdingsYears[0];
  let firstYear = holdingsYears[0];
  const derivedLastYear = holdingsYears[holdingsYears.length - 1];  // save before override for sell-above-lastYear logic
  let lastYear = derivedLastYear;
  if (lastYearOverride != null && !isNaN(lastYearOverride)) lastYear = lastYearOverride;
  else {
    // No explicit last year: the latest maturity year held can't see Future-30Y rungs, which live
    // as EXCESS at the 2052/2056 covers. Infer lastYear from that excess (symmetric to firstYear
    // inference from gap-bracket excess) so the round-trip preserves the future cover excess
    // instead of selling it to DARA.
    const inferredLast = inferLastYearFromHoldings({ holdings: holdingsRaw, tipsMap, refCPI, settlementDate });
    if (inferredLast != null && inferredLast > lastYear) lastYear = inferredLast;
  }
  if (firstYearOverride != null && !isNaN(firstYearOverride)) firstYear = firstYearOverride;

  const tipsMapYears = new Set();
  let maxTipsYear = 0;
  for (const bond of tipsMap.values()) {
    if (bond.maturity) {
      tipsMapYears.add(bond.maturity.getFullYear());
      maxTipsYear = Math.max(maxTipsYear, bond.maturity.getFullYear());
    }
  }
  // Structural gap: consecutive years immediately before 2040 where no TIPS have been issued.
  // Walk backward from 2039 until hitting a year that has TIPS in market data.
  const UPPER_BRACKET_YEAR = 2040;
  const structuralGapSet = new Set();
  for (let y = UPPER_BRACKET_YEAR - 1; y >= firstYear; y--) {
    if (!tipsMapYears.has(y)) structuralGapSet.add(y);
    else break;
  }
  const gapYears = [], future30yYears = [];
  for (let year = firstYear; year <= lastYear; year++) {
    if (structuralGapSet.has(year) && !yearInfo[year]) {
      gapYears.push(year);
    } else if (!tipsMapYears.has(year) && !yearInfo[year] && year > maxTipsYear) {
      future30yYears.push(year);
    }
  }

  // Rebalance respects existing holes: when the ladder has NO gap / Future-30Y block to
  // duration-match, an in-range year the user holds none of is an INTENTIONAL empty rung. Its
  // per-year target is honored as-is (so an explicitly raised DARA — e.g. from Infer LMP — still
  // fills it), but sizeLadder's "fund at least one bond" validation is WAIVED for it: an empty year
  // whose target rounds to 0 is a hole, not a too-low-DARA error. This is the knife-edge that the
  // load mirror sits on (an empty year's stub DARA ≈ its own incoming LMI). With a gap/Future block
  // present the bracket machinery owns the unheld years. 3.0 §Per-Year DARA from Portfolio / §Funding.
  let optionalRungYears = null;
  if (gapYears.length === 0 && future30yYears.length === 0) {
    const _heldYearSet = new Set(holdingsYears);
    optionalRungYears = new Set();
    for (let year = firstYear; year <= lastYear; year++) {
      if (!_heldYearSet.has(year)) optionalRungYears.add(year);
    }
  }

  const araLaterMaturityInterestByYear = {};
  // Remaining-coupon-only counterpart of the map above, used only when reading INTO the funded
  // year that contains settlementDate: that year is already partway through its calendar year,
  // so coupons already paid by its LMI-donor holdings are no longer forthcoming cash for it.
  // Every other year is entirely in the future and keeps the full-annual figure. 3.0 §Per-Year DARA.
  const araLaterMaturityInterestRemainingByYear = {};
  const araByYear = {};
  const allYearsSorted = Object.keys(yearInfo).map(Number).sort((a, b) => b - a);
  const _settlementYearForARA = settlementDate.getFullYear();

  // RMD Options 'last' mode: the pool-wide latest remaining coupon date, over every CURRENTLY HELD
  // bond above the settlement year — the "Before" state's own pool (ladder-core.js
  // latestRemainingCouponDate; sizeLadder computes an analogous pool for "After").
  const _rmdLastDateBefore = rmdCouponMode === 'last'
    ? latestRemainingCouponDate(
        allYearsSorted.filter(y => y > _settlementYearForARA).flatMap(y => yearInfo[y].holdings.map(h => h.maturity)),
        settlementDate, bondHolidays, tradeDate,
      )
    : null;

  for (const year of allYearsSorted) {
    let laterMatInt = 0;
    const useRemaining = year === _settlementYearForARA;
    for (const y in araLaterMaturityInterestByYear) {
      if (parseInt(y) > year) laterMatInt += useRemaining ? araLaterMaturityInterestRemainingByYear[y] : araLaterMaturityInterestByYear[y];
    }
    let yearPrincipal = 0, yearLastYearInterest = 0;
    araLaterMaturityInterestByYear[year] = 0;
    araLaterMaturityInterestRemainingByYear[year] = 0;
    for (const holding of yearInfo[year].holdings) {
      const b = tipsMap.get(holding.cusip);
      const cp = b?.coupon ?? 0;
      const bc = b?.datedDateRefCpi ?? refCPI;
      const ir = calcIndexRatio(refCPI, bc);
      const ap = 1000 * ir;
      const mF = holding.maturity.getMonth() + 1;
      const lastYI = mF < 7 ? (ap * cp * 0.5) : (ap * cp * 1.0);
      yearPrincipal += holding.qty * ap;
      yearLastYearInterest += holding.qty * lastYI;
      araLaterMaturityInterestByYear[year] += holding.qty * ap * cp;
      araLaterMaturityInterestRemainingByYear[year] += holding.qty * ap * cp / 2 * rmdCappedRemainingCoupons(holding.maturity, settlementDate, bondHolidays, rmdCouponMode, tradeDate, _rmdLastDateBefore);
    }
    araByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
  }

  // Available Cash credits the Before state the way it credits the target: earliest funded year
  // first, spilling up as each year's shortfall is covered (2.0 §Available Cash). The superseded
  // settlement-year-only override is the special case where the figure never exceeds that year's
  // own shortfall. Funded years only — gap years get their ARA below, from bracket coverage.
  const availableCashCreditBefore = {};
  if (availableCash > 0) {
    let remainingBefore = availableCash;
    for (let y = firstYear; y <= lastYear && remainingBefore > 0; y++) {
      if (araByYear[y] == null) continue;
      const shortfall = Math.max(0, (daraByYear?.get(y) ?? DARA) - araByYear[y]);
      const take = Math.min(remainingBefore, shortfall);
      if (take > 0) { availableCashCreditBefore[y] = take; araByYear[y] += take; remainingBefore -= take; }
    }
  }

  for (const gapYear of gapYears) {
    let laterMatInt = 0;
    for (const y in araLaterMaturityInterestByYear) {
      if (parseInt(y) > gapYear) laterMatInt += araLaterMaturityInterestByYear[y];
    }
    araByYear[gapYear] = laterMatInt;
  }

  // inferredDARA: median of all defined araByYear values in [firstYear, lastYear].
  // Bracket years (excess holdings included) skew high; gap years (LMI only) skew low;
  // future30y years are undefined. The median falls on a funded year where total
  // holdings = FY holdings, so araByYear ≈ DARA.
  const definedARAValues = [];
  for (let year = firstYear; year <= lastYear; year++) {
    if (araByYear[year] !== undefined) definedARAValues.push(araByYear[year]);
  }
  definedARAValues.sort((a, b) => a - b);
  const _araMid = Math.floor(definedARAValues.length / 2);
  const medianARA = definedARAValues.length === 0 ? 0
    : definedARAValues.length % 2 === 0
      ? (definedARAValues[_araMid - 1] + definedARAValues[_araMid]) / 2
      : definedARAValues[_araMid];
  const rungCount    = lastYear - firstYear + 1;
  // Provisional inference (AMD-excluded). Corrected below once the AMD schedule exists:
  // build credits each funded year's DARA with held-to-maturity 2052 AMD (Option C), so the
  // raw P+I+LMI median understates DARA by ~one year's AMD. See AMD-inclusive correction.
  let inferredDARA = medianARA;
  let DARA           = dara !== null ? dara : inferredDARA;
  const settlementYear = settlementDate.getFullYear();

  // ── Phase 3.1: Future cover pair identification and params (BEFORE PLI pass and gap params)
  //    Moved before PLI pass so future30yUpperExQty is available for AMD pre-ladder pool.
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
    if (!future30yLowerCoverBond) throw new Error('No 2056 TIPS found for future lower cover');
    if (!future30yUpperCoverBond) throw new Error('No 2052 TIPS found for future upper cover');
    future30yLowerYear = 2056;
    future30yUpperYear = 2052;
  }

  // Duration match + cover excess quantities — single source of truth shared with build
  // (ladder-core.js sizeFuture30yCover, which sizeLadder below also calls).
  const {
    future30yParams, future30yLowerDuration, future30yUpperDuration,
    future30yLowerWeight, future30yUpperWeight, future30yLowerExQty, future30yUpperExQty,
    future30yFellBack, future30yCoverReason, future30yLowerMonth, future30yUpperMonth,
  } = sizeFuture30yCover({ future30yYears, future30yLowerCoverBond, future30yUpperCoverBond, settlementDate, dara: DARA, daraByYear, refCPI });

  // ── Future 30Y cover AMD (spec: 2.0 §Future 30Y Cover AMD) ─────────────────────
  // AMD = interest on the held excess cover TIPS, modeled held-to-maturity, treated exactly like
  // coupon. Both deep-discount covers (2052 upper, 2056 lower) carry AMD. Shared with build via
  // gap-math (single source of truth). AMD is realized only on the EXCESS (cover) TIPS; funded-year
  // TIPS are held to maturity and their discount lands in P+I, never as AMD (AMD_FORMULA_ANALYSIS
  // §"Excess only"). Files carry the funded/excess split (h.excessQty); broker files (no split)
  // fall back to total held — unchanged until broker handling is revisited.
  const future30yAmdExcessBonds = [];
  if (future30yYears.length > 0 && future30yUpperExQty > 0 && future30yUpperCoverBond)
    future30yAmdExcessBonds.push({ year: future30yUpperYear, bond: future30yUpperCoverBond, exQty: future30yUpperExQty });
  if (future30yYears.length > 0 && future30yLowerExQty > 0 && future30yLowerCoverBond)
    future30yAmdExcessBonds.push({ year: future30yLowerYear, bond: future30yLowerCoverBond, exQty: future30yLowerExQty });

  const heldExcessOf = (bond) => bond
    ? (yearInfo[bond.maturity.getFullYear()]?.holdings?.reduce((s, h) => h.cusip === bond.cusip
        ? s + (h.excessQty != null ? h.excessQty : h.qty) : s, 0) ?? 0)
    : 0;

  // Target-state AMD (full target excess), combined across covers — drives target sizing + gap params.
  const future30yUpperAnnualAmdByYear = new Map();
  // Before-state AMD, from ACTUAL held excess per cover (held proportions differ from target).
  const future30yAmdBeforeByYear = new Map();
  for (const { bond, exQty } of future30yAmdExcessBonds) {
    for (const [y, v] of excessAmdSchedule({ bond, exQty, refCPI, settlementYear }))
      future30yUpperAnnualAmdByYear.set(y, (future30yUpperAnnualAmdByYear.get(y) ?? 0) + v);
    const held = heldExcessOf(bond);
    if (held > 0)
      for (const [y, v] of excessAmdSchedule({ bond, exQty: held, refCPI, settlementYear }))
        future30yAmdBeforeByYear.set(y, (future30yAmdBeforeByYear.get(y) ?? 0) + v);
  }
  const future30yUpperQtyBefore = heldExcessOf(future30yUpperCoverBond);
  const future30yLowerQtyBefore = heldExcessOf(future30yLowerCoverBond);
  function calcFuture30yUpperAnnualAmdBefore(year) {
    return future30yAmdBeforeByYear.get(year) ?? 0;
  }
  function calcFuture30yUpperAnnualAmd(year) {
    return future30yUpperAnnualAmdByYear.get(year) ?? 0;
  }

  // ── Future-30Y cover-roll coupon (post-upper-maturity years 2053–56) ───────────
  // Mirrors ladder-core.sizeLadder: after the 2052 matures its cost basis is rolled into the
  // actual Future-30Y TIPS, whose coupon (upper-cover share) sizes 2053–56 down. ForQty scales
  // by held excess for the Before state, exactly like the AMD ForQty above.
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
  function calcFuture30yRollCouponForQty(year, qty) {
    if (future30yUpperExQty <= 0 || qty <= 0) return 0;
    return (future30yRollCouponByYear.get(year) ?? 0) * qty / future30yUpperExQty;
  }

  // ── AMD-inclusive DARA inference correction ───────────────────────────────────
  // Build sizes each funded year so P+I + LMI + held-to-maturity 2052 AMD = DARA (Option C).
  // The provisional median above used only P+I + LMI, understating DARA by one year's AMD.
  // Re-take the median with the AMD the PORTFOLIO actually earns (from held cover excess, both
  // covers), so inferredDARA reflects the true DARA the holdings encode. Only the dara===null path.
  if (dara === null && (future30yUpperQtyBefore > 0 || future30yLowerQtyBefore > 0)) {
    const amdInclusiveARA = [];
    for (let year = firstYear; year <= lastYear; year++) {
      if (araByYear[year] !== undefined)
        amdInclusiveARA.push(araByYear[year]
          + calcFuture30yUpperAnnualAmdBefore(year)
          + calcFuture30yRollCouponForQty(year, future30yUpperQtyBefore));   // 2053–56 roll coupon (2052-only)
    }
    amdInclusiveARA.sort((a, b) => a - b);
    const _mid = Math.floor(amdInclusiveARA.length / 2);
    inferredDARA = amdInclusiveARA.length === 0 ? inferredDARA
      : amdInclusiveARA.length % 2 === 0
        ? (amdInclusiveARA[_mid - 1] + amdInclusiveARA[_mid]) / 2
        : amdInclusiveARA[_mid];
    DARA = inferredDARA;
  }

  // ── Canonical sizing via shared sizeLadder (single source of truth) ───────────
  // Build and rebalance run the IDENTICAL sizing pipeline. We derive the canonical
  // bond set for [firstYear, lastYear] and call sizeLadder to obtain the pre-ladder
  // interest distribution (zeroing + partial credit) and gap parameters. Rebalance's
  // diff machinery below targets these canonical values, so a build→rebalance
  // round-trip produces zero trades. Previously rebalance recomputed the PLI pool from
  // holdings, which drifted from build's at the partial-credit boundary year (e.g. 2040).
  const _canon = selectLadderBonds({ tipsMap, firstYear, lastYear, settlementDate, maturityPref, yearOverrides });
  const _sl = sizeLadder({
    dara: DARA, daraByYear, firstYear, lastYear, optionalYears: optionalRungYears,
    rangeYears: _canon.rangeYears, gapYears: _canon.gapYears, future30yYears: _canon.future30yYears,
    yearBondMap: _canon.yearBondMap, yearTipsListMap: _canon.yearTipsListMap, tipsMap, refCPI, settlementDate, settlementYear,
    preLadderInterest, bondHolidays, availableCash, rmdCouponMode, tradeDate,
    future30yLowerCoverBond: _canon.future30yLowerCoverBond, future30yUpperCoverBond: _canon.future30yUpperCoverBond,
    future30yLowerYear: _canon.future30yLowerYear, future30yUpperYear: _canon.future30yUpperYear,
  });
  const zeroedFundedYears   = _sl.zeroedFundedYears;
  const pliCreditByFundedYear = _sl.pliCreditByFundedYear;
  const pliCreditByGapYear  = _sl.pliCreditByGapYear;
  const partialCreditYear   = _sl.partialCreditYear;
  const partialCredit       = _sl.partialCredit;
  const cashCreditByFundedYear = _sl.cashCreditByFundedYear ?? {};
  const creditByFundedYear  = _sl.creditByFundedYear ?? {};
  const preLadderPool       = _sl.preLadderPool;
  const preLadderCouponPool = _sl.preLadderCouponPool;
  const preLadderAmdPool    = _sl.preLadderAmdPool;
  const preLadderRollCouponPool = _sl.preLadderRollCouponPool;
  const amdLifetimeByBracketYear = _sl.amdLifetimeByBracketYear ?? new Map();  // per-cover Σ AMD (cover-Amount net-out)
  const future30yLMITotal   = _sl.future30yLMITotal ?? 0;                      // intra-block coupon add-back

  // Augment gapLaterMaturityInterest with future cover excess LMI before computing gap params
  const future30yExtraLMI = {};
  if (future30yLowerExQty > 0 && future30yLowerCoverBond) {
    const irL = calcIndexRatio(refCPI, future30yLowerCoverBond.datedDateRefCpi ?? refCPI);
    future30yExtraLMI[future30yLowerYear] = future30yLowerExQty * 1000 * irL * (future30yLowerCoverBond.coupon ?? 0);
  }
  if (future30yUpperExQty > 0 && future30yUpperCoverBond) {
    const irU = calcIndexRatio(refCPI, future30yUpperCoverBond.datedDateRefCpi ?? refCPI);
    future30yExtraLMI[future30yUpperYear] = future30yUpperExQty * 1000 * irU * (future30yUpperCoverBond.coupon ?? 0);
  }

  const gapParams = calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings, lastYear, future30yExtraLMI, pliCreditByGapYear, daraByYear, future30yUpperAnnualAmdByYear);

  const minGapYear = gapYears.length > 0 ? Math.min(...gapYears) : Infinity;
  const brackets  = identifyBrackets(gapYears, holdings, yearInfo, tipsMap, araByYear, DARA, firstYear);

  // 2-bracket: lower bracket is always the canonical tipsMap lower (latest-maturing TIPS below
  // minGapYear). identifyBrackets may return an older year found via excess-ARA.
  // Override it so bracketYearSet uses the active lower bracket; the old year falls into rebalYearSet (Full mode
  // rebuilds it to funded-year qty only, selling any excess).
  if (bracketMode === '2bracket' && gapYears.length > 0) {
    let canonCUSIP = null, canonYear = null, canonMaturity = null;
    for (const bond of tipsMap.values()) {
      if (!bond.maturity || !bond.yield) continue;
      const yr = bond.maturity.getFullYear();
      if (yr < minGapYear && (!canonMaturity || bond.maturity > canonMaturity)) {
        canonCUSIP = bond.cusip; canonYear = yr; canonMaturity = bond.maturity;
      }
    }
    if (canonCUSIP) {
      brackets.lowerCUSIP = canonCUSIP; brackets.lowerYear = canonYear; brackets.lowerMaturity = canonMaturity;
    }
  }

  const lowerBond = brackets.lowerCUSIP ? tipsMap.get(brackets.lowerCUSIP) : null;
  const upperBond = brackets.upperCUSIP ? tipsMap.get(brackets.upperCUSIP) : null;
  const lowerDuration = brackets.lowerMaturity ? calculateMDuration(settlementDate, brackets.lowerMaturity, lowerBond?.coupon ?? 0, lowerBond?.yield ?? 0) : 0;
  const upperDuration = brackets.upperMaturity ? calculateMDuration(settlementDate, brackets.upperMaturity, upperBond?.coupon ?? 0, upperBond?.yield ?? 0) : 0;
  // 3-bracket requires a distinct orig-lower vs new-lower; when firstYear is inside the gap
  // (e.g. 2038/2039), minGapYear = firstYear, so the latest-maturing pre-gap TIPS is the same for
  // both orig-lower (from identifyBrackets fallback) and new-lower → same year → auto-degrades below.
  let is3Bracket = (bracketMode === '3bracket') && brackets.lowerCUSIP != null;
  let newLowerYear = null, newLowerCUSIP = null, newLowerMaturity = null, newLowerDuration = 0;
  if (is3Bracket && gapYears.length > 0) {
    // New lower = latest-maturing TIPS strictly below minGapYear. minGapYear−1 may itself be a gap
    // year (e.g. firstYear=2038 → minGapYear=2038 → 2037 has no TIPS), so walk tipsMap for the
    // longest-dated maturity < minGapYear, same as anchorBefore in calculateGapParameters.
    for (const [_cusip, _bond] of tipsMap.entries()) {
      if (!_bond.maturity || !_bond.yield) continue;
      const _yr = _bond.maturity.getFullYear();
      if (_yr < minGapYear) {
        if (!newLowerMaturity || _bond.maturity > newLowerMaturity) {
          newLowerCUSIP = _cusip; newLowerMaturity = _bond.maturity; newLowerYear = _yr;
        }
      }
    }
    if (!newLowerCUSIP) throw new Error('3-bracket: no outstanding TIPS found before gap year ' + minGapYear);
    const _nlBond = tipsMap.get(newLowerCUSIP);
    newLowerDuration = calculateMDuration(settlementDate, newLowerMaturity, _nlBond?.coupon ?? 0, _nlBond?.yield ?? 0);
    // When orig lower and new lower resolve to the same year, 3-bracket is a no-op:
    // the "new lower" bond is already the orig lower. Fall back to standard 2-bracket.
    if (newLowerYear === brackets.lowerYear) {
      is3Bracket = false;
      newLowerYear = null; newLowerCUSIP = null; newLowerMaturity = null; newLowerDuration = 0;
    }
  }

  const future30yCoverYearSet = future30yYears.length > 0 ? new Set([future30yLowerYear, future30yUpperYear]) : new Set();
  const bracketYearSet = gapYears.length === 0 ? new Set()
    : is3Bracket
      ? new Set([brackets.lowerYear, brackets.upperYear, newLowerYear].filter(y => y != null))
      : new Set([brackets.lowerYear, brackets.upperYear].filter(y => y != null));
  for (const y of future30yCoverYearSet) bracketYearSet.add(y);
  const gapYearSet    = new Set(gapYears);
  const future30yYearSet = new Set(future30yYears);

  // LMI-based FY estimate for ALL standard gap bracket years (funded-year qty, not total).
  // Used for computing current excess = totalQty - fundedYearQty for bracket priority logic.
  // Future30y cover years skipped — they have no funded-year component.
  const bracketTargetFundedYearQtyBefore = {};
  if (gapYears.length > 0) {
    for (const bYear of bracketYearSet) {
      if (future30yCoverYearSet.has(bYear)) continue;
      let bCUSIP = null, bMat = null;
      if (bYear === brackets.lowerYear) { bCUSIP = brackets.lowerCUSIP; bMat = brackets.lowerMaturity; }
      else if (bYear === brackets.upperYear) { bCUSIP = brackets.upperCUSIP; bMat = brackets.upperMaturity; }
      else if (is3Bracket && bYear === newLowerYear) { bCUSIP = newLowerCUSIP; bMat = newLowerMaturity; }
      if (!bCUSIP) continue;
      if (!yearInfo[bYear]) yearInfo[bYear] = { holdings: [] };
      const yh = yearInfo[bYear].holdings;
      let laterMatIntBefore = 0;
      for (const y in araLaterMaturityInterestByYear) {
        if (parseInt(y) > bYear) laterMatIntBefore += araLaterMaturityInterestByYear[y];
      }
      const piB = calculatePIPerBond(bCUSIP, bMat, refCPI, tipsMap);
      let nonPI = 0;
      for (const h of yh) { if (h.cusip !== bCUSIP) nonPI += h.qty * calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap); }
      const bDara = bYear > lastYear ? 0 : (daraByYear?.get(bYear) ?? DARA);
      bracketTargetFundedYearQtyBefore[bYear] = piB > 0 ? Math.max(0, Math.round((bDara - laterMatIntBefore - nonPI) / piB)) : 0;
    }
  }

  // When excessQty is provided by the import (Formats 4 or 5), it encodes the funded/excess split
  // from the prior build/rebalance. Use it for ALL bracket years, overriding the DARA-derived estimate.
  // Broker CSVs (Formats 1–3) have no excessQty: the LMI estimate above is used as the fallback.
  for (const h of holdings) {
    if (h.excessQty != null && bracketYearSet.has(h.year)) {
      bracketTargetFundedYearQtyBefore[h.year] = h.qty - h.excessQty;
    }
  }

  // PLI-zeroed bracket years: funded qty need is 0, so all current holdings are excess
  for (const year of zeroedFundedYears) {
    if (Object.prototype.hasOwnProperty.call(bracketTargetFundedYearQtyBefore, year)) {
      bracketTargetFundedYearQtyBefore[year] = 0;
    }
  }

  let lowerWeight = 0, upperWeight = 0, origLowerWeight = null, newLowerWeight3 = null, upperWeight3 = null;
  let bracketFellBack3to2 = false, bracketSolveReason = null;
  let retainedExcessCostBefore = null, retainedBracketSold = false;
  const bracketExcessTargetCost = {};
  if (gapYears.length > 0) {
    if (is3Bracket) {
      // Retained lower brackets are frozen at the excess already held and enter the
      // duration solve at their OWN duration; only the active lower bracket and the upper
      // bracket are solved. Pricing retained excess at the ACTIVE bracket's duration (as this
      // did from 463b07a) leaves the block under-matched, because an older maturity is shorter.
      // Spec 2.0 §Retained Bracket Excess; 3.0 §Lower bracket priority rule.
      const _excessCostOf = (year, cusip) => {
        const b   = tipsMap.get(cusip);
        const cpb = (b?.price ?? 0) / 100 * calcIndexRatio(refCPI, b?.datedDateRefCpi ?? refCPI) * 1000;
        const h   = yearInfo[year]?.holdings?.find(x => x.cusip === cusip);
        return Math.max(0, (h?.qty ?? 0) - (bracketTargetFundedYearQtyBefore[year] ?? 0)) * cpb;
      };

      // Retained = lower brackets older than the active one, OLDEST FIRST
      // (the order the solver depletes them in when the match is otherwise unsolvable).
      const retainedList = [
        { year: brackets.lowerYear, cusip: brackets.lowerCUSIP, duration: lowerDuration },
      ]
        .filter(r => r.year != null && r.cusip != null && r.year < newLowerYear)
        .sort((a, b) => a.year - b.year)
        .map(r => ({ ...r, excessCost: _excessCostOf(r.year, r.cusip) }));

      // The active lower bracket is "the only lower bracket a rebalance buys"
      // (DATA_DICTIONARY §Active Lower Bracket) — it is never sold to make room for an older,
      // already-retained leg. Floor the duration solve at whatever excess it currently holds, so a
      // retained leg large/short enough to otherwise squeeze the active leg toward (or below) zero
      // gets sold down further instead (3.0 §Lower bracket priority rule; the sell-oldest-first branch
      // now triggers on "would shrink active below its current holding", not just "solves negative").
      const activeFloorCost = _excessCostOf(newLowerYear, newLowerCUSIP);
      const activeFloorWeight = gapParams.totalCost > 0 ? activeFloorCost / gapParams.totalCost : 0;

      const wN = bracketWeightsN({
        retained: retainedList,
        dActive: newLowerDuration,
        dUpper:  upperDuration,
        dGap:    gapParams.avgDuration,
        totalBlockCost: gapParams.totalCost,
        activeFloorWeight,
      });

      // lowerWeight now carries the ACTIVE bracket's own share, not both lower brackets, so
      // retained + active + upper sum to exactly 1 (they previously double-counted the retained
      // share in the gap-LMI allocation below).
      lowerWeight = wN.activeWeight; upperWeight = wN.upperWeight; upperWeight3 = wN.upperWeight;
      retainedExcessCostBefore = retainedList[0]?.excessCost ?? null;
      retainedBracketSold = !!wN.sold;
      bracketFellBack3to2 = !wN.feasible;
      bracketSolveReason  = wN.reason;

      retainedList.forEach((r, i) => {
        bracketExcessTargetCost[r.year] = gapParams.totalCost * wN.retainedWeights[i];
      });
      bracketExcessTargetCost[newLowerYear]       = gapParams.totalCost * wN.activeWeight;
      bracketExcessTargetCost[brackets.upperYear] = gapParams.totalCost * wN.upperWeight;

      // Effective weights for summary reporting.
      origLowerWeight = wN.retainedWeights[0] ?? 0;
      newLowerWeight3 = wN.activeWeight;
    }
    if (!is3Bracket) {
      const weights2Bracket = bracketWeights(lowerDuration, upperDuration, gapParams.avgDuration);
      lowerWeight = weights2Bracket.lowerWeight; upperWeight = weights2Bracket.upperWeight;
      if (brackets.lowerYear != null) bracketExcessTargetCost[brackets.lowerYear] = gapParams.totalCost * lowerWeight;
      bracketExcessTargetCost[brackets.upperYear] = gapParams.totalCost * upperWeight;
    }
  }

  // Bracket/cover Amount = coverage delivered (≈ missing-years × DARA), IDENTICAL rule to build-lib:
  //   excessQty × P+I − amdLifetime(scaled to qty) + weight × blockLMITotal   (gap or future-30Y block)
  // The AMD net-out and intra-block add-back make the cover total read ≈ N×DARA (Rev 6). amdLifetime
  // is keyed by bracket year and scaled by qty over that cover's own target excess (both Future-30Y
  // covers populated; gap brackets are near par). Spec: 2.0 §Excess Amount (Bracket / Cover Display).
  function excessLMIAllocFor(year) {   // weight × block coupon add-back (gap or future-30Y), per bracket year
    if (future30yYears.length > 0 && year === future30yUpperYear)        return future30yUpperWeight * future30yLMITotal;
    if (future30yYears.length > 0 && year === future30yLowerYear)        return future30yLowerWeight * future30yLMITotal;
    if (gapYears.length > 0 && year === brackets.upperYear)              return upperWeight * (gapParams?.gapLMITotal ?? 0);
    if (gapYears.length > 0 && is3Bracket && year === newLowerYear)      return lowerWeight * (gapParams?.gapLMITotal ?? 0);
    if (gapYears.length > 0 && year === brackets.lowerYear)              return (is3Bracket ? (origLowerWeight ?? 0) : lowerWeight) * (gapParams?.gapLMITotal ?? 0);
    return 0;
  }
  function excessCoverageAmt(year, exQty, piPB) {
    if (!(exQty > 0)) return 0;
    const amdFull = amdLifetimeByBracketYear.get(year) ?? 0;   // lifetime AMD at this cover's TARGET excess
    const targetExQty = year === future30yUpperYear ? future30yUpperExQty
                      : year === future30yLowerYear ? future30yLowerExQty : 0;   // own denominator per cover
    const amdScaled = targetExQty > 0 ? amdFull * exQty / targetExQty : 0;
    return exQty * piPB - amdScaled + excessLMIAllocFor(year);
  }

  let rebalYearSet = new Set();
  for (let y = firstYear; y <= lastYear; y++) {
    if (!bracketYearSet.has(y) && !gapYearSet.has(y)) rebalYearSet.add(y);
  }
  // AMD-driven selling: each AMD sale year (rung.year − 30) receives excess AMD income and must
  // be sold to its AMD-adjusted need regardless of mode (Full already includes them; Gap does not).
  // Range follows the actual sale years, not a hardcoded ≤ 2036 cap. Spec: 2.0 §Future 30Y Upper Cover AMD.
  if (future30yUpperExQty > 0) {
    // AMD years (≤2052) AND cover-roll-coupon years (2053–56) both reduce a funded year's need and
    // must be sold to that lower need in any mode (spec: 2.0 §Future 30Y Upper Cover AMD).
    for (const y of [...future30yUpperAnnualAmdByYear.keys(), ...future30yRollCouponByYear.keys()]) {
      if (y >= firstYear && y <= lastYear && !bracketYearSet.has(y) && !gapYearSet.has(y) && !future30yYearSet.has(y))
        rebalYearSet.add(y);
    }
  }

  // Future cover excess target costs (additive in case cover year also has gap bracket role)
  if (future30yYears.length > 0) {
    bracketExcessTargetCost[future30yLowerYear] = (bracketExcessTargetCost[future30yLowerYear] || 0) + future30yParams.future30yTotalCost * future30yLowerWeight;
    bracketExcessTargetCost[future30yUpperYear] = (bracketExcessTargetCost[future30yUpperYear] || 0) + future30yParams.future30yTotalCost * future30yUpperWeight;
  }

  const buySellTargets = {};
  const nonTargetSells = {};
  const postRebalQtyMap = {};
  // RMD Options 'last' mode: the pool-wide latest remaining coupon date, over every bond the
  // canonical TARGET ladder holds above the settlement year — the "After" state's own pool
  // (mirrors sizeLadder's identical computation; ladder-core.js latestRemainingCouponDate). Reuses
  // _canon (selectLadderBonds, computed above) rather than deriving a second bond set here.
  const _rmdLastDateAfter = rmdCouponMode === 'last'
    ? latestRemainingCouponDate(
        _canon.rangeYears.filter(y => y > settlementYear)
          .flatMap(y => (_canon.yearTipsListMap[y] ?? [_canon.yearBondMap[y]]).map(b => b?.maturity)),
        settlementDate, bondHolidays, tradeDate,
      )
    : null;
  let rebuildLaterMatInt = 0;
  let rebuildLaterMatIntRemaining = 0;  // remaining-coupon counterpart, used only at year === settlementYear
  const yearLaterMatIntSnapshot = {};
  const allProcessYears = new Set([...holdingsYears, ...gapYears, ...bracketYearSet]);
  for (let y = firstYear; y <= lastYear; y++) allProcessYears.add(y);
  const sortedToProcess = Array.from(allProcessYears).sort((a, b) => b - a);

  for (const year of sortedToProcess) {
    const isSettlementYear = year === settlementYear;
    yearLaterMatIntSnapshot[year] = isSettlementYear ? rebuildLaterMatIntRemaining : rebuildLaterMatInt;
    if (gapYearSet.has(year) || future30yYearSet.has(year)) continue;

    const yi = yearInfo[year] || { holdings: [] };
    const isBracket = bracketYearSet.has(year);
    const isRebal = rebalYearSet.has(year);

    let targetCUSIP;
    let yearRank = null; // set in the non-bracket branch below; consumed by the sell-order fix further down
    const piMap = {};
    for (const h of yi.holdings) piMap[h.cusip] = calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap);

    if (isBracket) {
      if (gapYears.length > 0 && year === brackets.lowerYear) targetCUSIP = brackets.lowerCUSIP;
      else if (gapYears.length > 0 && year === brackets.upperYear) targetCUSIP = brackets.upperCUSIP;
      else if (is3Bracket && year === newLowerYear) targetCUSIP = newLowerCUSIP;
      else if (future30yYears.length > 0 && year === future30yLowerYear) targetCUSIP = future30yLowerCoverBond.cusip;
      else if (future30yYears.length > 0 && year === future30yUpperYear) targetCUSIP = future30yUpperCoverBond.cusip;
    } else {
      // 2.0 §Within-Year Allocation Policy / 3.0 §Named Quantities (Rebalance): candidates come
      // from the canonical yearTipsListMap (maturityPref/yearOverrides-driven), not re-derived
      // from tipsMap inline -- this is also the fix for the pre-existing bug where a
      // maturityPref='all'/'semiannual' funded year's non-latest holdings were silently
      // collapsed toward the single latest CUSIP on every rebalance.
      yearRank = rankForYear({
        candidates: _canon.yearTipsListMap[year] ?? [],
        held: yi.holdings,
        piMap,
        tipsMap,
        policy: allocationPolicy,
        rankOverride: yearRankOverrides?.get(year) ?? null,
        maturityPref,
      });
      targetCUSIP = yearRank[0]?.cusip;
    }

    // Ensure piMap has the target CUSIP — it may not be in current holdings
    if (targetCUSIP && !piMap[targetCUSIP]) {
      const b = tipsMap.get(targetCUSIP);
      if (b && b.maturity) {
        piMap[targetCUSIP] = calculatePIPerBond(targetCUSIP, b.maturity, refCPI, tipsMap);
      }
    }

    const tBond = tipsMap.get(targetCUSIP);
    const ir = (calcIndexRatio(refCPI, tBond?.datedDateRefCpi ?? refCPI));
    const costPerBond = (tBond?.price ?? 0) / 100 * ir * 1000;
    const targetCurrentQty = yi.holdings.find(h => h.cusip === targetCUSIP)?.qty ?? 0;

    let tFundedYearQty, postQ;
    if (isBracket || isRebal) {
      const yearDara = (year > lastYear || year < firstYear) ? 0 : (daraByYear?.get(year) ?? DARA);
      
      // 1. Determine target excess quantity for this bracket/rebal year
      let excessQtyTarget = 0;
      if (isBracket) {
        if (future30yYears.length > 0 && year === future30yUpperYear) {
          // Use precomputed UNADJ-based excess qty directly (matches build-lib)
          excessQtyTarget = future30yUpperExQty;
        } else if (future30yYears.length > 0 && year === future30yLowerYear) {
          excessQtyTarget = future30yLowerExQty;
        } else {
          excessQtyTarget = costPerBond > 0 ? Math.max(0, Math.round((bracketExcessTargetCost[year] || 0) / costPerBond)) : 0;
        }
      }
      
      // 2. Calculate LMI from this year's own excess bonds
      const excessLMI = isSettlementYear && tBond?.maturity
        ? excessQtyTarget * 1000 * ir * (tBond?.coupon ?? 0) / 2 * rmdCappedRemainingCoupons(tBond.maturity, settlementDate, bondHolidays, rmdCouponMode, tradeDate, _rmdLastDateAfter)
        : excessQtyTarget * 1000 * ir * (tBond?.coupon ?? 0);

      // 3. Calculate needed P+I, subtracting both incoming LMI and current year excess LMI
      const effectivePartialCredit = (year === partialCreditYear) ? partialCredit : 0;
      const future30yExtra = calcFuture30yUpperAnnualAmd(year) + calcFuture30yRollCoupon(year);  // AMD (≤2052) + roll coupon (2053–56)
      const needed = yearDara - (isSettlementYear ? rebuildLaterMatIntRemaining : rebuildLaterMatInt) - excessLMI - effectivePartialCredit - future30yExtra;

      if (zeroedFundedYears.has(year)) {
        // PLI covers this year's funded need — zero funded qty AND sell all non-target holdings
        tFundedYearQty = 0;
        for (const h of yi.holdings) {
          if (h.cusip !== targetCUSIP && h.qty > 0) {
            postRebalQtyMap[h.cusip] = 0;
            const b2 = tipsMap.get(h.cusip);
            const c2 = (b2?.price ?? 0) / 100 * (calcIndexRatio(refCPI, b2?.datedDateRefCpi ?? refCPI)) * 1000;
            nonTargetSells[h.cusip] = { newQty: 0, qtyDelta: -h.qty, costDelta: h.qty * c2, targetCost: 0 };
          }
        }
      } else {
        // Excess already held at this year's bracket maturity is committed to gap duration
        // matching, not available to fund the year's own rung. Its coupon has already reduced
        // `needed` above (excessLMI); counting its PRINCIPAL here as well made the year look
        // over-funded, so the sell-down below dumped a perfectly good funded holding at this
        // year's OTHER maturity, and the bracket maturity was bought back to replace it — a
        // same-year sell of one maturity and buy of another with no net effect. Non-bracket years
        // hold no excess, so this nets to zero for them. 3.0 §Named Quantities (funded-first rule).
        const targetExcessHeld = isBracket
          ? Math.max(0, targetCurrentQty - (bracketTargetFundedYearQtyBefore[year] ?? targetCurrentQty))
          : 0;
        const targetFundedHeld = targetCurrentQty - targetExcessHeld;
        const sortedH = [...yi.holdings].sort((a, b) => b.maturity - a.maturity);
        // Sell order (3.0 §Within-Year Allocation Policy): least-preferred-to-hold first, per the
        // active policy/rank -- yearRank is null for bracket years (untouched, oldest-first as
        // before); for ordinary years it's rank[1..] (everything but the target) reversed, since
        // rank[0] is most-preferred and rank[1..] is already in descending-preference order.
        const nonTarget = yearRank
          ? yearRank.slice(1).filter(r => r.held).reverse().map(r => yi.holdings.find(h => h.cusip === r.cusip))
          : sortedH.filter(h => h.cusip !== targetCUSIP).reverse();
        let curPI = yi.holdings.reduce((s, h) => s + h.qty * piMap[h.cusip], 0)
                  - targetExcessHeld * piMap[targetCUSIP];
        const isEqualLevel = !isBracket && allocationPolicy === 'equal' && nonTarget.length > 0;
        if (isEqualLevel) {
          // Equal split levels rather than drains in fixed order -- see levelValues (3.0 §Within-
          // Year Allocation Policy). Pool is the target plus whatever's currently held besides it;
          // a candidate held by neither stays untouched, same as before.
          const poolValues = new Map([[targetCUSIP, targetFundedHeld * piMap[targetCUSIP]],
            ...nonTarget.map(h => [h.cusip, h.qty * piMap[h.cusip]])]);
          const leveled = levelValues(poolValues, needed);
          for (const h of nonTarget) {
            const newQty = Math.max(0, Math.round(leveled.get(h.cusip) / piMap[h.cusip]));
            curPI -= (h.qty - newQty) * piMap[h.cusip];
            postRebalQtyMap[h.cusip] = newQty;
          }
        } else {
          // Strict fixed-order drain: a CUSIP must be sold down to zero before the next-ranked one
          // (or targetCUSIP) is touched at all. A per-bond value smaller than an earlier-ranked,
          // not-yet-exhausted CUSIP's must never let that later CUSIP sell first just because it
          // happens to divide the remaining residual more evenly -- stop the instant one isn't
          // fully drained, leaving every less-preferred-to-sell CUSIP after it untouched.
          for (const h of nonTarget) {
            const sell = Math.min(h.qty, Math.max(0, Math.floor((curPI - needed) / piMap[h.cusip])));
            postRebalQtyMap[h.cusip] = h.qty - sell;
            curPI -= sell * piMap[h.cusip];
            if (sell < h.qty) break;
          }
          for (const h of nonTarget) if (!(h.cusip in postRebalQtyMap)) postRebalQtyMap[h.cusip] = h.qty;
        }
        const diff = needed - curPI;
        // A CUSIP still holding qty after the drain above is, by definition, less preferred to
        // hold than targetCUSIP -- the fixed sell order must never touch targetCUSIP to close a
        // shrink-side rounding remainder while an earlier-ranked nonTarget CUSIP still has bonds
        // left; the small residual is accepted instead (3.0 §Within-Year Allocation Policy sell
        // order). Growth-side (diff > 0) and the equal-split branch (levelValues) are unaffected.
        const nonTargetStillHeld = !isEqualLevel && nonTarget.some(h => (postRebalQtyMap[h.cusip] ?? h.qty) > 0);
        tFundedYearQty = (diff < 0 && nonTargetStillHeld)
          ? targetFundedHeld
          : Math.max(0, targetFundedHeld + Math.round(diff / piMap[targetCUSIP]));
        for (const h of nonTarget) {
          if (postRebalQtyMap[h.cusip] !== h.qty) {
            const b = tipsMap.get(h.cusip);
            const c = (b?.price ?? 0) / 100 * (calcIndexRatio(refCPI, b?.datedDateRefCpi ?? refCPI)) * 1000;
            nonTargetSells[h.cusip] = { newQty: postRebalQtyMap[h.cusip], qtyDelta: postRebalQtyMap[h.cusip] - h.qty, costDelta: -((postRebalQtyMap[h.cusip] - h.qty) * c), targetCost: postRebalQtyMap[h.cusip] * c };
          }
        }
      }
      postQ = tFundedYearQty + excessQtyTarget;
      buySellTargets[year] = { targetCUSIP, targetFundedYearQty: tFundedYearQty, targetQty: postQ, postRebalQty: postQ, qtyDelta: postQ - targetCurrentQty, targetCost: tFundedYearQty * costPerBond, costDelta: -((postQ - targetCurrentQty) * costPerBond), costPerBond, isBracket };
    } else if (year > lastYear && year <= derivedLastYear && yi.holdings.length > 0) {
      // Year is held but now above lastYearOverride — sell all
      tFundedYearQty = 0; postQ = 0;
      if (targetCUSIP) {
        const tc = costPerBond;
        buySellTargets[year] = {
          targetCUSIP, targetFundedYearQty: 0, targetQty: 0, postRebalQty: 0,
          qtyDelta: -targetCurrentQty, targetCost: 0,
          costDelta: targetCurrentQty * tc, costPerBond: tc, isBracket: false,
        };
      }
      for (const h of yi.holdings) {
        postRebalQtyMap[h.cusip] = 0;
        if (h.cusip !== targetCUSIP) {
          const b2 = tipsMap.get(h.cusip);
          const c2 = (b2?.price ?? 0) / 100 * (calcIndexRatio(refCPI, b2?.datedDateRefCpi ?? refCPI)) * 1000;
          nonTargetSells[h.cusip] = { newQty: 0, qtyDelta: -h.qty, costDelta: h.qty * c2, targetCost: 0 };
        }
      }
    } else if (year < firstYear && year >= derivedFirstYear && yi.holdings.length > 0) {
      // Year is below firstYearOverride — sell all holdings (symmetric to above-lastYear logic)
      tFundedYearQty = 0; postQ = 0;
      if (targetCUSIP) {
        buySellTargets[year] = {
          targetCUSIP, targetFundedYearQty: 0, targetQty: 0, postRebalQty: 0,
          qtyDelta: -targetCurrentQty, targetCost: 0,
          costDelta: targetCurrentQty * costPerBond, costPerBond, isBracket: false,
        };
      }
      for (const h of yi.holdings) {
        postRebalQtyMap[h.cusip] = 0;
        if (h.cusip !== targetCUSIP) {
          const b2 = tipsMap.get(h.cusip);
          const c2 = (b2?.price ?? 0) / 100 * (calcIndexRatio(refCPI, b2?.datedDateRefCpi ?? refCPI)) * 1000;
          nonTargetSells[h.cusip] = { newQty: 0, qtyDelta: -h.qty, costDelta: h.qty * c2, targetCost: 0 };
        }
      }
    } else {
      tFundedYearQty = targetCurrentQty; postQ = targetCurrentQty;
    }

    postRebalQtyMap[targetCUSIP] = postQ;
    for (const h of yi.holdings) {
      const b = tipsMap.get(h.cusip);
      if (b) {
        const qty = postRebalQtyMap[h.cusip] ?? h.qty;
        const ir2 = calcIndexRatio(refCPI, b.datedDateRefCpi || refCPI);
        rebuildLaterMatInt += qty * ir2 * 1000 * b.coupon;
        rebuildLaterMatIntRemaining += qty * ir2 * 1000 * b.coupon / 2 * rmdCappedRemainingCoupons(b.maturity, settlementDate, bondHolidays, rmdCouponMode, tradeDate, _rmdLastDateAfter);
      }
    }
    // Ensure target CUSIP contributes to LMI pool even when it has no prior holdings (new bracket buy)
    if (targetCUSIP && !yi.holdings.some(h => h.cusip === targetCUSIP) && (postRebalQtyMap[targetCUSIP] ?? 0) > 0) {
      const _blmi = tipsMap.get(targetCUSIP);
      if (_blmi) {
        const ir3 = calcIndexRatio(refCPI, _blmi.datedDateRefCpi || refCPI);
        rebuildLaterMatInt += postRebalQtyMap[targetCUSIP] * ir3 * 1000 * _blmi.coupon;
        rebuildLaterMatIntRemaining += postRebalQtyMap[targetCUSIP] * ir3 * 1000 * _blmi.coupon / 2 * rmdCappedRemainingCoupons(_blmi.maturity, settlementDate, bondHolidays, rmdCouponMode, tradeDate, _rmdLastDateAfter);
      }
    }
    if (!isFinite(rebuildLaterMatInt)) rebuildLaterMatInt = 0; // safety guard against NaN/Infinity cascade
    if (!isFinite(rebuildLaterMatIntRemaining)) rebuildLaterMatIntRemaining = 0;
  }

  // Before/After ARA calculations (totals + per-component breakdown for drill popup)
  const beforeARAByYear = {}, postARAByYear = {};
  const beforeARABreakdown = {}, postARABreakdown = {};
  for (const year of sortedToProcess) {
    let lBefore = 0;
    const useRemainingBefore = year === _settlementYearForARA;
    for (const y in araLaterMaturityInterestByYear) if (parseInt(y) > year) lBefore += useRemainingBefore ? araLaterMaturityInterestRemainingByYear[y] : araLaterMaturityInterestByYear[y];
    let pB = 0, cB = 0, exIntB = 0;
    const holdingsBefore = [];
    if (yearInfo[year]) {
      for (const h of yearInfo[year].holdings) {
        const b = tipsMap.get(h.cusip);
        const ir = calcIndexRatio(refCPI, b?.datedDateRefCpi ?? refCPI);
        const ap = 1000 * ir;
        const isBT = (bracketYearSet.has(year) && h.cusip === buySellTargets[year]?.targetCUSIP);
        const qFunded = isBT ? Math.min(bracketTargetFundedYearQtyBefore[year] ?? 0, h.qty) : h.qty;
        const qExcess = Math.max(0, h.qty - qFunded); // held excess (bracket cover) — its coupon is income
        const m = h.maturity.getMonth() + 1;
        pB += qFunded * ap; cB += qFunded * ap * b.coupon * (m < 7 ? 0.5 : 1.0);
        exIntB += qExcess * ap * b.coupon;
        holdingsBefore.push({ cusip: h.cusip, maturityMonth: m - 1, maturityYear: h.maturity.getFullYear(), qty: qFunded, principalPerBond: ap, nPeriods: m < 7 ? 1 : 2, coupon: b?.coupon ?? 0 });
      }
    }
    const amdBefore  = (year >= firstYear && year <= lastYear) ? calcFuture30yUpperAnnualAmdBefore(year) : 0;
    const rollBefore = (year >= firstYear && year <= lastYear) ? calcFuture30yRollCouponForQty(year, future30yUpperQtyBefore) : 0;
    // "Before" = annual real amount from CURRENT holdings, via the SAME shared rule build/After use
    // (one computation, before-qtys), so a no-trade round-trip lands Before ≡ build per year. The
    // zeroed-year pre-ladder credit is applied only for OUR files (explicit per-year DARA block);
    // broker files (inferred DARA) keep their existing Before semantics until broker handling is
    // revisited (decision: honor the file we built; leave broker as-is for now).
    const hasExplicitDara = daraByYear != null;
    const yearDaraBefore = daraByYear?.get(year) ?? DARA;
    const { credit: pliCreditBefore, amount: beforeAmt } = fundedYearAmount({
      principal: pB, ownCoupon: cB, laterMatInt: lBefore, ownExcessCoupon: exIntB, amd: amdBefore, rollCoupon: rollBefore,
      dara: yearDaraBefore,
      isZeroed: hasExplicitDara && zeroedFundedYears.has(year),
      partialCredit: hasExplicitDara ? (pliCreditByFundedYear[year] ?? 0) : 0,
    });
    // Before-state cash is a plain addition, not a zeroing credit: the Before column reports what
    // the holder actually has on hand today, so the cash shows as its own line rather than being
    // reconciled into a rung that was never sized down.
    const cashCreditBefore = availableCashCreditBefore[year] ?? 0;
    beforeARAByYear[year] = beforeAmt + cashCreditBefore;
    beforeARABreakdown[year] = { principal: pB, ownCoupon: cB, laterMatInt: lBefore, ownExcessCoupon: exIntB, pliCredit: pliCreditBefore, holdings: holdingsBefore, future30yUpperAnnualAmd: amdBefore, future30yRollCoupon: rollBefore, availableCashCredit: cashCreditBefore };

    // Years outside [firstYear, lastYear] are not ladder rungs; their "Amount After" is 0.
    // LMI from later bonds flows to firstYear (the shortest rung), not to dropped years.
    const lAfter = (year >= firstYear && year <= lastYear) ? (yearLaterMatIntSnapshot[year] ?? 0) : 0;
    let pA = 0, cA = 0, exIntA = 0;
    const holdingsAfter = [];
    if (yearInfo[year]) {
      for (const h of yearInfo[year].holdings) {
        const b = tipsMap.get(h.cusip);
        const ir = calcIndexRatio(refCPI, b?.datedDateRefCpi ?? refCPI);
        const ap = 1000 * ir;
        const isBT = (bracketYearSet.has(year) && h.cusip === buySellTargets[year]?.targetCUSIP);
        
        const qFunded = isBT ? buySellTargets[year].targetFundedYearQty : (postRebalQtyMap[h.cusip] ?? h.qty);
        const qTotal  = isBT ? buySellTargets[year].targetQty : qFunded;
        const qExcess = qTotal - qFunded;

        const m = h.maturity.getMonth() + 1;
        pA += qFunded * ap; 
        cA += qFunded * ap * b.coupon * (m < 7 ? 0.5 : 1.0);
        exIntA += qExcess * ap * b.coupon;

        holdingsAfter.push({ cusip: h.cusip, maturityMonth: m - 1, maturityYear: h.maturity.getFullYear(), qty: qFunded, principalPerBond: ap, nPeriods: m < 7 ? 1 : 2, coupon: b?.coupon ?? 0 });
      }
    }
    // Include target CUSIP funded-year contribution when it has no current holdings (new bracket buy)
    { const _bst4 = buySellTargets[year];
      if (_bst4 && !yearInfo[year]?.holdings.some(h => h.cusip === _bst4.targetCUSIP)) {
        const _tb4 = tipsMap.get(_bst4.targetCUSIP);
        if (_tb4?.maturity) {
          const _ir4 = calcIndexRatio(refCPI, _tb4.datedDateRefCpi ?? refCPI);
          const _ap4 = 1000 * _ir4;
          const _m4 = _tb4.maturity.getMonth() + 1;
          
          const qF4 = _bst4.targetFundedYearQty;
          const qT4 = _bst4.targetQty;
          const qE4 = qT4 - qF4;

          pA += qF4 * _ap4;
          cA += qF4 * _ap4 * _tb4.coupon * (_m4 < 7 ? 0.5 : 1.0);
          exIntA += qE4 * _ap4 * _tb4.coupon;

          holdingsAfter.push({ cusip: _bst4.targetCUSIP, maturityMonth: _m4 - 1, maturityYear: _tb4.maturity.getFullYear(), qty: qF4, principalPerBond: _ap4, nPeriods: _m4 < 7 ? 1 : 2, coupon: _tb4.coupon ?? 0 });
        }
      }
    }
    const amdAfter  = (year >= firstYear && year <= lastYear) ? calcFuture30yUpperAnnualAmd(year) : 0;
    const rollAfter = (year >= firstYear && year <= lastYear) ? calcFuture30yRollCoupon(year) : 0;
    // "After" ARA via the SAME shared rule build uses (ladder-core.fundedYearAmount), so After ≡
    // build by construction (locked by the "rebal After == build amount per year" test). sizeLadder
    // sizes the PLI pool against the PRELIMINARY later-mat interest (the approximation that decides
    // which years zero), but a row's ARA is built from the CORRECTED components (lAfter + own-year
    // excess coupon exIntA + AMD); for a zeroed year the shared rule reconciles the credit to those.
    const yearDaraDisp = daraByYear?.get(year) ?? DARA;
    const { credit: pliCredit, amount: _postAmt } = fundedYearAmount({
      principal: pA, ownCoupon: cA, laterMatInt: lAfter, ownExcessCoupon: exIntA, amd: amdAfter, rollCoupon: rollAfter,
      dara: yearDaraDisp, isZeroed: zeroedFundedYears.has(year),
      // The WHOLE credit the year took, cash and pre-ladder interest alike. A year the pool
      // covers in full is zeroed and topped up to DARA above, which carries its cash implicitly;
      // the one year the pool runs out partway through takes what is left as a partial credit,
      // and passing only the pre-ladder half there dropped the cash from the year's Amount. The
      // rung was sized down for that cash, so omitting it reported a year delivering less than
      // its target when nothing of the sort had happened. Build passes the whole credit here, so
      // this is also what keeps After identical to a build of the same ladder.
      partialCredit: creditByFundedYear[year] ?? 0,
    });
    postARAByYear[year] = _postAmt;
    postARABreakdown[year] = { principal: pA, ownCoupon: cA, laterMatInt: lAfter, holdings: holdingsAfter, pliCredit, future30yUpperAnnualAmd: amdAfter, future30yRollCoupon: rollAfter, availableCashCredit: cashCreditByFundedYear[year] ?? 0 };
  }

  // Summary Metrics
  const lowerBondS = tipsMap.get(brackets.lowerCUSIP);
  const upperBondS = tipsMap.get(brackets.upperCUSIP);
  const lowerCostPerBond = (lowerBondS?.price ?? 0) / 100 * (calcIndexRatio(refCPI, lowerBondS?.datedDateRefCpi ?? refCPI)) * 1000;
  const upperCostPerBond = (upperBondS?.price ?? 0) / 100 * (calcIndexRatio(refCPI, upperBondS?.datedDateRefCpi ?? refCPI)) * 1000;

  const lowerPreviousExcessCost = Math.max(0, (yearInfo[brackets.lowerYear]?.holdings?.find(h=>h.cusip===brackets.lowerCUSIP)?.qty ?? 0) - (bracketTargetFundedYearQtyBefore[brackets.lowerYear] ?? 0)) * lowerCostPerBond;
  const upperPreviousExcessCost = Math.max(0, (yearInfo[brackets.upperYear]?.holdings?.find(h=>h.cusip===brackets.upperCUSIP)?.qty ?? 0) - (bracketTargetFundedYearQtyBefore[brackets.upperYear] ?? 0)) * upperCostPerBond;
  
  const lowerExcessCost = brackets.lowerYear != null
    ? ((buySellTargets[brackets.lowerYear]?.targetQty ?? 0) - (buySellTargets[brackets.lowerYear]?.targetFundedYearQty ?? 0)) * lowerCostPerBond
    : 0;
  const upperExcessCost = (buySellTargets[brackets.upperYear]?.targetQty - buySellTargets[brackets.upperYear]?.targetFundedYearQty) * upperCostPerBond;

  let newLowerPreviousExcessCost3 = 0, newLowerExcessCost3 = 0;
  let newLowerCostPerBond3 = 0;
  if (is3Bracket) {
    const nlBond = tipsMap.get(newLowerCUSIP);
    newLowerCostPerBond3 = (nlBond?.price ?? 0) / 100 * (calcIndexRatio(refCPI, nlBond?.datedDateRefCpi ?? refCPI)) * 1000;
    newLowerPreviousExcessCost3 = Math.max(0, (yearInfo[newLowerYear]?.holdings?.find(h=>h.cusip===newLowerCUSIP)?.qty ?? 0) - (bracketTargetFundedYearQtyBefore[newLowerYear] ?? 0)) * newLowerCostPerBond3;
    newLowerExcessCost3 = ((buySellTargets[newLowerYear]?.postRebalQty ?? 0) - (buySellTargets[newLowerYear]?.targetFundedYearQty ?? 0)) * newLowerCostPerBond3;
  }
  
  const totalPreviousExcessCost = lowerPreviousExcessCost + upperPreviousExcessCost + newLowerPreviousExcessCost3;
  const totalExcessCost = lowerExcessCost + upperExcessCost + newLowerExcessCost3;

  const beforeLowerWeight = totalPreviousExcessCost > 0 ? lowerPreviousExcessCost / totalPreviousExcessCost : null;
  const beforeUpperWeight = totalPreviousExcessCost > 0 ? upperPreviousExcessCost / totalPreviousExcessCost : null;
  const beforeNewLowerWeight = is3Bracket && totalPreviousExcessCost > 0 ? newLowerPreviousExcessCost3 / totalPreviousExcessCost : null;
  const afterLowerWeight = totalExcessCost > 0 ? lowerExcessCost / totalExcessCost : null;
  const afterUpperWeight = totalExcessCost > 0 ? upperExcessCost / totalExcessCost : null;
  const afterNewLowerWeight = is3Bracket && totalExcessCost > 0 ? newLowerExcessCost3 / totalExcessCost : null;

  const details = [], results = [], outLMI = {};
  for (let i = consolidatedHoldings.length - 1; i >= 0; i--) {
    const h = consolidatedHoldings[i];
    const isLast = (yearInfo[h.year].lastIdx === i);
    let lmi = 0;
    for (const y in outLMI) if (parseInt(y) > h.year) lmi += outLMI[y];

    let fy='', pFY=0, iFY=0, aFY=0, cFY=0, tQ=0, qD=0, tC=0, cD=0, aB=0, aA=0;
    if (isLast) {
      fy = h.year;
      for (const oh of yearInfo[h.year].holdings) {
        const b = tipsMap.get(oh.cusip);
        const ir = calcIndexRatio(refCPI, b?.datedDateRefCpi ?? refCPI);
        const ap = 1000 * ir;
        const m = oh.maturity.getMonth() + 1;
        pFY += oh.qty * ap; iFY += oh.qty * ap * b.coupon * (m < 7 ? 0.5 : 1.0);
        cFY += oh.qty * (b.price / 100 * ir * 1000);
      }
      iFY += lmi; aFY = pFY + iFY; aB = beforeARAByYear[h.year]; aA = postARAByYear[h.year];
      aFY += calcFuture30yUpperAnnualAmdBefore(h.year);
    }

    const b = tipsMap.get(h.cusip);
    const ir = calcIndexRatio(refCPI, b?.datedDateRefCpi ?? refCPI);
    const bst_loop = buySellTargets[h.year];
    let tFundedYearQty = 0;
    if (bst_loop && h.cusip === bst_loop.targetCUSIP) {
      tQ = bst_loop.targetQty; qD = bst_loop.qtyDelta; tC = bst_loop.targetCost; cD = bst_loop.costDelta; tFundedYearQty = bst_loop.targetFundedYearQty;
    } else if (nonTargetSells[h.cusip]) {
      const s = nonTargetSells[h.cusip]; tQ = s.newQty; qD = s.qtyDelta; tC = s.targetCost; cD = s.costDelta; tFundedYearQty = s.newQty;
    } else {
      tQ = h.qty; qD = 0; tC = h.qty * (b.price / 100 * ir * 1000); cD = 0; tFundedYearQty = h.qty;
    }

    if (!outLMI[h.year]) outLMI[h.year] = 0;
    outLMI[h.year] += tQ * 1000 * ir * b.coupon;

    const isBT = !!(bst_loop?.isBracket && h.cusip === bst_loop.targetCUSIP);
    const cpbHere = (b.price ?? 0) / 100 * ir * 1000;
    // Current-holdings split at a bracket year: how much of what's actually held counts as this
    // year's own funded rung vs. extra held for gap coverage. This is a pure holdings-interpretation
    // question — driven only by what the year needs (bracketTargetFundedYearQtyBefore, the funded-
    // first LMI/DARA formula) — and must NEVER reference the after-rebalance trade target. Any
    // "don't recommend a pointless simultaneous buy+sell" concern belongs entirely to the after-side
    // targeting logic (tFundedYearQty / buySellTargets above), not here — it must not leak back into
    // how we read the current holdings (see 3.0 §Named Quantities: the funded-first rule applies to
    // ALL standard bracket years, with no after-side exception).
    // - future30y cover years: cost-based formula (pure excess, no funded component).
    // - Format 4/5 (h.excessQty present): use explicit CSV value directly.
    // - every other bracket year: bracketTargetFundedYearQtyBefore (funded-first LMI/DARA formula).
    const exB = isBT && cpbHere > 0
      ? future30yCoverYearSet.has(h.year)
        ? Math.round((bracketExcessTargetCost[h.year] || 0) / cpbHere)
        : h.excessQty != null
          ? h.excessQty
          : Math.max(0, h.qty - (bracketTargetFundedYearQtyBefore[h.year] ?? 0))
      : 0;
    const exA = isBT ? tQ - tFundedYearQty : 0;

    // Honest current-holdings split — the funded-year side of the Before figures shown in the
    // table (single source, also used below for the `fundedYearQtyBefore` field).
    const fundedYearQtyBeforeHonest = isBT ? Math.max(0, h.qty - exB) : h.qty;

    // The actual trade to place, split between the funded-year and excess buckets. A bracket-target
    // CUSIP's funded and excess portions are the SAME held maturity, so a per-bucket subtraction of
    // Before from After is only a problem when the two buckets' naive deltas point in OPPOSITE
    // directions (one bucket would buy this maturity while the other sells it) — that's the only
    // case that manufactures a nonsensical simultaneous buy+sell of one bond. When both buckets move
    // the same direction (or one doesn't move at all), the honest Before split already reconciles
    // Before + Delta = After per bucket and must pass through unchanged. Before pricing any trade,
    // relabel (at zero cost) only as much as needed to cancel the opposing signs, then trade the
    // remaining shortfall/leftover in a single direction. This reallocation is for trade-sizing only;
    // it never changes the honest Before figures used for display (fundedYearQtyBefore/excessQtyBefore
    // above) — see 3.0 §Named Quantities.
    const naiveFundedDelta = tFundedYearQty - fundedYearQtyBeforeHonest;
    const naiveExcessDelta = exA - exB;
    let reallocFundedBefore = fundedYearQtyBeforeHonest, reallocExcessBefore = exB;
    if (isBT && naiveFundedDelta > 0 && naiveExcessDelta < 0) {
      const realloc = Math.min(naiveFundedDelta, -naiveExcessDelta);
      reallocFundedBefore = fundedYearQtyBeforeHonest + realloc;
      reallocExcessBefore = exB - realloc;
    } else if (isBT && naiveFundedDelta < 0 && naiveExcessDelta > 0) {
      const realloc = Math.min(-naiveFundedDelta, naiveExcessDelta);
      reallocFundedBefore = fundedYearQtyBeforeHonest - realloc;
      reallocExcessBefore = exB + realloc;
    }
    const fundedYearQtyDelta = tFundedYearQty - reallocFundedBefore;
    const excessQtyDelta = exA - reallocExcessBefore;

    const bForLMI = tipsMap.get(h.cusip);
    const irForLMI = calcIndexRatio(refCPI, bForLMI?.datedDateRefCpi ?? refCPI);
    const annIntPerBond = 1000 * irForLMI * (bForLMI?.coupon ?? 0);
    const excessLMI_B = exB * annIntPerBond;
    const excessLMI_A = exA * annIntPerBond;

    const piPB = calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap);
    const mDuration = (b?.yield != null) ? calculateMDuration(settlementDate, h.maturity, b.coupon ?? 0, b.yield) : 0;

    details.unshift({
      cusip: h.cusip, maturityStr: fmtDate(h.maturity), fundedYear: h.year,
      coupon: b.coupon, yield: b.yield, saYield: b.saYield ?? null, price: b.price, datedDateRefCpi: b.datedDateRefCpi, refCPI, indexRatio: ir,
      principalPerBond: 1000 * ir, costPerBond: (b.price / 100 * ir * 1000),
      DARA: daraByYear?.get(h.year) ?? DARA,
      qtyBefore: h.qty, qtyAfter: tQ,
      // Displayed Before is the reallocated split, not the raw honest LMI-formula split
      // (fundedYearQtyBeforeHonest/exB): when the honest before/after per-bucket deltas would
      // otherwise point in opposite directions for this one held CUSIP (one bucket buying, the
      // other selling), that split is relabeled first so the number shown as "before" already
      // matches what the trade is actually computed against — Before + Delta = After always
      // reconciles, and the funded/excess split never implies a same-maturity buy+sell. In the
      // (usual) same-direction case reallocFundedBefore/reallocExcessBefore equal the honest split
      // exactly, so this changes nothing there. See 3.0 §Named Quantities.
      fundedYearQtyBefore: reallocFundedBefore,
      fundedYearQtyAfter: tFundedYearQty,
      isBracketTarget: isBT, isFuture30yCover: isBT && future30yCoverYearSet.has(h.year),
      isGapBracket: gapYears.length > 0 && (h.year === brackets.lowerYear || h.year === brackets.upperYear || (is3Bracket && h.year === newLowerYear)),
      excessQtyBefore: reallocExcessBefore, excessQtyAfter: exA,
      reallocFundedBefore, reallocExcessBefore, fundedYearQtyDelta, excessQtyDelta,
      excessAmtBefore: excessCoverageAmt(h.year, reallocExcessBefore, piPB),
      excessAmtAfter:  excessCoverageAmt(h.year, exA, piPB),
      excessLMIAlloc:  excessLMIAllocFor(h.year),
      excessLMI_Before: excessLMI_B, excessLMI_After: excessLMI_A,
      araBeforeTotal:    isLast ? aB : null, araAfterTotal:    isLast ? aA : null,
      araBeforePrincipal:   isLast ? (beforeARABreakdown[h.year]?.principal   ?? 0) : null,
      araBeforeOwnCoupon:   isLast ? (beforeARABreakdown[h.year]?.ownCoupon   ?? 0) : null,
      araBeforeLaterMatInt: isLast ? (beforeARABreakdown[h.year]?.laterMatInt ?? 0) : null,
      araBeforeHoldings:    isLast ? (beforeARABreakdown[h.year]?.holdings   ?? []) : null,
      araAfterPrincipal:    isLast ? (postARABreakdown[h.year]?.principal    ?? 0) : null,
      araAfterOwnCoupon:    isLast ? (postARABreakdown[h.year]?.ownCoupon    ?? 0) : null,
      araAfterLaterMatInt:  isLast ? (postARABreakdown[h.year]?.laterMatInt  ?? 0) : null,
      araAfterHoldings:     isLast ? (postARABreakdown[h.year]?.holdings     ?? []) : null,
      preLadderCreditForYear:      isLast ? (postARABreakdown[h.year]?.pliCredit   ?? 0) : null,
      preLadderCreditForYearBefore: isLast ? (beforeARABreakdown[h.year]?.pliCredit ?? 0) : null,
      future30yUpperAnnualAmd:       isLast ? (postARABreakdown[h.year]?.future30yUpperAnnualAmd ?? 0) : null,
      future30yUpperAnnualAmdBefore: isLast ? (beforeARABreakdown[h.year]?.future30yUpperAnnualAmd ?? 0) : null,
      future30yRollCoupon:       isLast ? (postARABreakdown[h.year]?.future30yRollCoupon ?? 0) : null,
      future30yRollCouponBefore: isLast ? (beforeARABreakdown[h.year]?.future30yRollCoupon ?? 0) : null,
      availableCashCredit:       isLast ? (postARABreakdown[h.year]?.availableCashCredit ?? 0) : null,
      availableCashCreditBefore: isLast ? (beforeARABreakdown[h.year]?.availableCashCredit ?? 0) : null,
      nPeriods: (h.maturity.getMonth() + 1 < 7 ? 1 : 2),
      mDuration,
    });
    const rowDARA = daraByYear?.get(h.year) ?? DARA;
    const fundedPI_A = tFundedYearQty * piPB;
    results.unshift([
      h.cusip, h.qty, fmtDate(h.maturity), fy, 
      pFY, iFY, aFY, cFY, 
      tQ, qD, tC, cD, 
      aB, aB - rowDARA, aA, aA - rowDARA, 
      exB * piPB, exA * piPB,
      isLast ? (postARABreakdown[h.year]?.laterMatInt ?? 0) : '', // Trace: Incoming LMI
      isBT ? excessLMI_A : '', // Trace: Same-year excess interest
      isLast ? fundedPI_A : ''  // Trace: Funded P+I
    ]);
  }

  // Emit synthetic rows for a buy into targetCUSIP when that CUSIP itself has no current holdings
  // (e.g. 3-bracket newLowerYear, or an ordinary 'all'/saYield year whose top-ranked candidate is a
  // brand-new CUSIP the ladder never held before). Gated on the TARGET CUSIP specifically, not on
  // "this funded year has zero holdings of any kind" -- a year can already have other held CUSIPs
  // (already emitted via the main consolidatedHoldings loop above) while the target itself is still
  // a fresh buy that loop never sees, and that buy would otherwise vanish from the table/Trade
  // Ticket/export while still being counted in the year's Amount After total (3.0 §Named Quantities:
  // same "skipped 2035" vanishing-rung failure mode, at CUSIP granularity instead of year granularity).
  for (const [bYearStr, bst] of Object.entries(buySellTargets)) {
    const bYear = parseInt(bYearStr);
    if ((yearInfo[bYear]?.holdings ?? []).some(h => h.cusip === bst.targetCUSIP)) continue; // target already in main loop
    if (!(bst.qtyDelta > 0)) continue; // no buy
    const tb = tipsMap.get(bst.targetCUSIP);
    if (!tb?.maturity) continue;
    const ir = calcIndexRatio(refCPI, tb.datedDateRefCpi ?? refCPI);
    const cpb = (tb.price ?? 0) / 100 * ir * 1000;
    const piPB = calculatePIPerBond(bst.targetCUSIP, tb.maturity, refCPI, tipsMap);
    const m = tb.maturity.getMonth() + 1;
    let lmiBefore = 0;
    for (const y in araLaterMaturityInterestByYear) if (parseInt(y) > bYear) lmiBefore += araLaterMaturityInterestByYear[y];
    const araB = beforeARAByYear[bYear] ?? lmiBefore;
    const araA = postARAByYear[bYear] ?? 0;
    const rowDARA = daraByYear?.get(bYear) ?? DARA;
    const exA = bst.targetQty - bst.targetFundedYearQty;
    const bondForSyn = tipsMap.get(bst.targetCUSIP);
    const irForSyn = calcIndexRatio(refCPI, bondForSyn?.datedDateRefCpi ?? refCPI);
    const excessLMI = exA * 1000 * irForSyn * (bondForSyn?.coupon ?? 0);
    
    const holdingsAfterSyn = [{ 
      cusip: bst.targetCUSIP, maturityMonth: m - 1, maturityYear: tb.maturity.getFullYear(), 
      qty: bst.targetFundedYearQty, principalPerBond: 1000 * ir, nPeriods: m < 7 ? 1 : 2, coupon: tb.coupon ?? 0 
    }];

    const newDetail = {
      cusip: bst.targetCUSIP, maturityStr: fmtDate(tb.maturity), fundedYear: bYear,
      coupon: tb.coupon, yield: tb.yield, saYield: tb.saYield ?? null, price: tb.price, datedDateRefCpi: tb.datedDateRefCpi, refCPI, indexRatio: ir,
      principalPerBond: 1000 * ir, costPerBond: cpb, DARA: rowDARA,
      qtyBefore: 0, qtyAfter: bst.targetQty,
      fundedYearQtyBefore: 0, fundedYearQtyAfter: bst.targetFundedYearQty,
      isBracketTarget: bst.isBracket, isFuture30yCover: bst.isBracket && future30yCoverYearSet.has(bYear),
      isGapBracket: gapYears.length > 0 && (bYear === brackets.lowerYear || bYear === brackets.upperYear || (is3Bracket && bYear === newLowerYear)),
      excessQtyBefore: 0, excessQtyAfter: exA,
      // Nothing held yet, so there is nothing to reallocate — the whole target is a straight buy.
      reallocFundedBefore: 0, reallocExcessBefore: 0,
      fundedYearQtyDelta: bst.targetFundedYearQty, excessQtyDelta: exA,
      excessAmtBefore: 0,
      excessAmtAfter:  excessCoverageAmt(bYear, exA, piPB),
      excessLMIAlloc:  excessLMIAllocFor(bYear),
      excessLMI_Before: 0, excessLMI_After: excessLMI,
      araBeforeTotal: araB, araAfterTotal: araA,
      araBeforePrincipal: 0, araBeforeOwnCoupon: 0, araBeforeLaterMatInt: lmiBefore,
      araBeforeHoldings: [],
      araAfterPrincipal: bst.targetFundedYearQty * 1000 * ir,
      araAfterOwnCoupon: bst.targetFundedYearQty * 1000 * ir * tb.coupon * (m < 7 ? 0.5 : 1.0),
      araAfterLaterMatInt: yearLaterMatIntSnapshot[bYear] ?? 0,
      araAfterHoldings: holdingsAfterSyn,
      preLadderCreditForYear: postARABreakdown[bYear]?.pliCredit ?? 0,
      preLadderCreditForYearBefore: beforeARABreakdown[bYear]?.pliCredit ?? 0,
      future30yUpperAnnualAmd:       postARABreakdown[bYear]?.future30yUpperAnnualAmd ?? 0,
      future30yUpperAnnualAmdBefore: beforeARABreakdown[bYear]?.future30yUpperAnnualAmd ?? 0,
      future30yRollCoupon:       postARABreakdown[bYear]?.future30yRollCoupon ?? 0,
      future30yRollCouponBefore: beforeARABreakdown[bYear]?.future30yRollCoupon ?? 0,
      availableCashCredit:       postARABreakdown[bYear]?.availableCashCredit ?? 0,
      availableCashCreditBefore: beforeARABreakdown[bYear]?.availableCashCredit ?? 0,
      nPeriods: m < 7 ? 1 : 2,
      mDuration: (tb?.yield != null) ? calculateMDuration(settlementDate, tb.maturity, tb.coupon ?? 0, tb.yield) : 0,
    };
    const fundedPI_A = bst.targetFundedYearQty * piPB;
    const newResult = [
      bst.targetCUSIP, 0, fmtDate(tb.maturity), bYear,
      0, lmiBefore, lmiBefore, 0,
      bst.targetQty, bst.qtyDelta, bst.targetCost, bst.costDelta,
      araB, araB - rowDARA, araA, araA - rowDARA, 0, exA * piPB,
      yearLaterMatIntSnapshot[bYear] ?? 0, // Trace: Incoming LMI
      excessLMI, // Trace: Same-year excess interest
      fundedPI_A  // Trace: Funded P+I
    ];
    const ri = details.findIndex(d => d.fundedYear > bYear);
    if (ri >= 0) { results.splice(ri, 0, newResult); details.splice(ri, 0, newDetail); }
    else { results.push(newResult); details.push(newDetail); }
  }

  // Emit display rows for canonical ladder rungs that are FULLY COVERED — zeroed by PLI, or by
  // later-maturity interest — so they have no holding AND no buy (target qty 0). Build always
  // renders every ladder year; rebalance previously emitted rows only from holdings + buys, so
  // such a rung silently vanished from the table (the "skipped 2035" bug). The row is purely
  // informational: qtyBefore = qtyAfter = 0, and Amount After = the year's DARA (postARAByYear,
  // which is build-consistent). Mirrors build's per-year row for a zeroed funded year.
  {
    const emittedYears = new Set(details.map(d => d.fundedYear));
    for (const year of _canon.rangeYears) {
      if (year < firstYear || year > lastYear || emittedYears.has(year)) continue;
      const bond = _canon.yearBondMap[year];
      if (!bond?.maturity) continue;
      const ir = calcIndexRatio(refCPI, bond.datedDateRefCpi ?? refCPI);
      const cpb = (bond.price ?? 0) / 100 * ir * 1000;
      const m = bond.maturity.getMonth() + 1;
      const araB = beforeARAByYear[year] ?? 0;
      const araA = postARAByYear[year] ?? 0;
      const rowDARA = daraByYear?.get(year) ?? DARA;
      const bd = postARABreakdown[year] || {};
      const bbd = beforeARABreakdown[year] || {};
      const newDetail = {
        cusip: bond.cusip, maturityStr: fmtDate(bond.maturity), fundedYear: year,
        coupon: bond.coupon, yield: bond.yield, saYield: bond.saYield ?? null, price: bond.price, datedDateRefCpi: bond.datedDateRefCpi, refCPI, indexRatio: ir,
        principalPerBond: 1000 * ir, costPerBond: cpb, DARA: rowDARA,
        qtyBefore: 0, qtyAfter: 0, fundedYearQtyBefore: 0, fundedYearQtyAfter: 0,
        isBracketTarget: false, isFuture30yCover: false,
        isGapBracket: gapYears.length > 0 && (year === brackets.lowerYear || year === brackets.upperYear || (is3Bracket && year === newLowerYear)),
        excessQtyBefore: 0, excessQtyAfter: 0,
        reallocFundedBefore: 0, reallocExcessBefore: 0, fundedYearQtyDelta: 0, excessQtyDelta: 0,
        excessAmtBefore: 0, excessAmtAfter: 0,
        excessLMI_Before: 0, excessLMI_After: 0,
        araBeforeTotal: araB, araAfterTotal: araA,
        araBeforePrincipal: bbd.principal ?? 0, araBeforeOwnCoupon: bbd.ownCoupon ?? 0,
        araBeforeLaterMatInt: bbd.laterMatInt ?? 0, araBeforeHoldings: bbd.holdings ?? [],
        araAfterPrincipal: bd.principal ?? 0, araAfterOwnCoupon: bd.ownCoupon ?? 0,
        araAfterLaterMatInt: bd.laterMatInt ?? 0, araAfterHoldings: bd.holdings ?? [],
        preLadderCreditForYear: bd.pliCredit ?? 0,
        preLadderCreditForYearBefore: bbd.pliCredit ?? 0,
        future30yUpperAnnualAmd: bd.future30yUpperAnnualAmd ?? 0,
        future30yUpperAnnualAmdBefore: bbd.future30yUpperAnnualAmd ?? 0,
        future30yRollCoupon: bd.future30yRollCoupon ?? 0,
        future30yRollCouponBefore: bbd.future30yRollCoupon ?? 0,
        availableCashCredit: bd.availableCashCredit ?? 0,
        availableCashCreditBefore: bbd.availableCashCredit ?? 0,
        nPeriods: m < 7 ? 1 : 2,
        mDuration: (bond.yield != null) ? calculateMDuration(settlementDate, bond.maturity, bond.coupon ?? 0, bond.yield) : 0,
      };
      const newResult = [
        bond.cusip, 0, fmtDate(bond.maturity), year,
        0, (bd.laterMatInt ?? 0), araA, 0,
        0, 0, 0, 0,
        araB, araB - rowDARA, araA, araA - rowDARA, 0, 0,
        bd.laterMatInt ?? 0, '', 0,
      ];
      const ri = details.findIndex(d => d.fundedYear > year);
      if (ri >= 0) { results.splice(ri, 0, newResult); details.splice(ri, 0, newDetail); }
      else { results.push(newResult); details.push(newDetail); }
    }
  }

  const costDeltaSum = results.reduce((s, r) => s + (typeof r[11] === 'number' ? r[11] : 0), 0);
  const costForNewRungs = Object.values(buySellTargets).reduce((s, bst) => s + (bst.isBracket ? 0 : Math.max(0, bst.targetCost)), 0);
  const gapCoverageSurplus = totalPreviousExcessCost - costForNewRungs - (gapParams.totalCost || 0);

  details.forEach(d => { d.mktValue = d.qtyAfter * d.costPerBond; });
  const _mktCosts = details.map(d => d.mktValue);
  const weightedAvgDuration = calcMktWtdAvg(details.map(d => d.mDuration), _mktCosts);
  const weightedAvgYield    = calcMktWtdAvg(details.map(d => d.yield),     _mktCosts);
  const weightedAvgSaYield  = calcMktWtdAvg(details.map(d => d.saYield),   _mktCosts);

  const HDR = ['CUSIP','Qty','Maturity','FY','Principal','Interest','ARA','Cost','Target Qty','Qty Delta','Target Cost','Cost Delta','ARA (Before)','ARA-DARA Before','ARA (After)','ARA-DARA After','Excess ARA Before','Excess ARA After','Incoming LMI','Excess Interest','Funded PI'];

  // Resolved per-year DARA for EVERY year in [firstYear, lastYear] (incl. gap + future-30Y).
  // Persisted on export as the `#fundedYear,dara` block so a re-import is exact. See 2.1 Broker Import.
  const daraByYearResolved = new Map();
  for (let y = firstYear; y <= lastYear; y++) daraByYearResolved.set(y, daraByYear?.get(y) ?? DARA);

  return { results, HDR, summary: { settleDateDisp, refCPI, DARA, daraByYearResolved, inferredDARA, daraIsInferred: dara === null, settlementYear, availableCash, rmdCouponMode, firstYear, lastYear, derivedFirstYear, rungCount, gapYears, future30yYears, brackets, lowerWeight, upperWeight, costDeltaSum, costForNewRungs, gapCoverageSurplus, gapParams, bracketMode, lowerDuration, upperDuration, newLowerYear, newLowerCUSIP, newLowerMaturity, newLowerDuration, newLowerWeight3, origLowerWeight, bracketFellBack3to2, bracketSolveReason, retainedExcessCostBefore, retainedBracketSold, beforeLowerWeight, beforeUpperWeight, beforeNewLowerWeight, afterLowerWeight, afterUpperWeight, afterNewLowerWeight, totalPreviousExcessCost, totalExcessCost, araByYear, future30yLowerYear, future30yUpperYear, future30yLowerCoverCUSIP: future30yLowerCoverBond?.cusip, future30yUpperCoverCUSIP: future30yUpperCoverBond?.cusip, future30yParams, future30yLowerDuration, future30yUpperDuration, future30yUpperWeight, future30yLowerWeight, future30yUpperExQty, future30yLowerExQty, future30yFellBack, future30yCoverReason, future30yLowerMonth, future30yUpperMonth, future30yUpperAnnualAmdByYear, future30yLMITotal, preLadderInterest, maturityPref, preLadderPool, preLadderCouponPool, preLadderAmdPool, preLadderRollCouponPool, zeroedFundedYears: [...zeroedFundedYears].sort((a, b) => a - b), weightedAvgDuration, weightedAvgYield, weightedAvgSaYield }, details };
}

// Execute a rebalance with shape-preserving self-financing FUNDING (3.0 §Funding the rebalance).
// This is the orchestration the Run button performs, lifted out of the UI so it has one home and is
// unit-testable:
//   1. Run the rebalance on the given per-year DARA map directly. This honors the map as-is —
//      including intentional empty rungs (a year the user holds none of stays a hole) and any
//      user-reshaped / our-export shape.
//   2. ONLY if that map is still exactly as loaded (`daraPlanUnedited`) AND the ladder actually
//      has a gap-year / Future-30Y block to duration-match (learned from the engine's own
//      `summary.gapYears` / `summary.future30yYears`), re-run with the shape-preserving scaled map so
//      the funded rungs sell down to fund the bracket excess. With no such block there is nothing to
//      buy — the direct run already nets to ≈0 and is returned unchanged (no spurious sell-down).
//
// REGRESSION HISTORY: this scale-application step was accidentally deleted in commit c0d233b
// (2026-07-16, an unrelated Ref CPI/Index Ratio rounding refactor) — the flag kept being
// computed and passed in from index.html, but this function silently stopped acting on it, so every
// default-mirror Run with a gap/Future-30Y block produced large non-self-financing net cash (funded
// years weren't sold down at all). It went undetected for 9 days because the only unit test covering
// this function exercised the gap-free NO-OP path, never the actual scale-application path — see the
// paired test below ("runFundedRebalance — gap/Future-30Y block: scale actually applies").
export function runFundedRebalance({
  dara, bracketMode = '2bracket', holdings, tipsMap, refCPI, settlementDate,
  daraByYear = null, daraPlanUnedited = false, daraPlanIsStated = false,
  lastYearOverride = null, firstYearOverride = null, preLadderInterest = false, maturityPref = 'last',
  allocationPolicy = 'equal', yearRankOverrides = null, yearOverrides = null, bondHolidays = new Set(),
  availableCash = 0, rmdCouponMode = 'all', tradeDate = settlementDate,
}) {
  const base = { dara, bracketMode, holdings, tipsMap, refCPI, settlementDate,
    lastYearOverride, firstYearOverride, preLadderInterest, maturityPref,
    allocationPolicy, yearRankOverrides, yearOverrides, bondHolidays, availableCash, rmdCouponMode, tradeDate };
  let result = runRebalance({ ...base, daraByYear });
  const needsFunding = result.summary.gapYears.length > 0 || result.summary.future30yYears.length > 0;
  if (daraPlanUnedited && needsFunding) {
    // WHICH shape gets scaled depends on where the plan came from. A file that states a per-year
    // DARA for each year IS the shape — scale it directly, and take it at face value (no cover
    // correction). Only when the plan was auto-derived from holdings (broker/legacy file, which
    // states nothing) is the shape recovered from the portfolio's own ARA and corrected.
    // Re-deriving in both cases was the bug behind a same-day reload of our own export proposing
    // trades across the whole ladder: the stated plan was discarded and replaced by a mirror.
    let daraMap, correctCoverIncome;
    if (daraPlanIsStated && daraByYear && daraByYear.size > 0) {
      daraMap = new Map(daraByYear);
      correctCoverIncome = false;
    } else {
      const rawARA = computePortfolioARAByYear(holdings, tipsMap, refCPI);
      ({ daraMap } = derivePerYearDara(rawARA, getGapYearBracketCandidates(tipsMap, result.summary.lastYear)));
      correctCoverIncome = true;
    }
    const { scaledMap, scaledMedian } = inferScaledDARAFromPortfolio({
      daraMap, holdings, tipsMap, refCPI, settlementDate,
      bracketMode, lastYearOverride, firstYearOverride, preLadderInterest, flat: false, bondHolidays,
      availableCash, rmdCouponMode, tradeDate,
      maturityPref, allocationPolicy, yearRankOverrides, yearOverrides, correctCoverIncome,
    });
    result = runRebalance({ ...base, dara: scaledMedian, daraByYear: scaledMap });
  }
  return result;
}

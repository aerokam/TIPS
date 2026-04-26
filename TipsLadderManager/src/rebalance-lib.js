// rebalance-lib.js -- Core logic for TIPS ladder rebalancing (4.0_TIPS_Ladder_Rebalancing.md)
// Exports: buildTipsMapFromYields, runRebalance, localDate, inferDARAFromCash

import { bondCalcs, calculateMDuration, yieldFromPrice } from '../../shared/src/bond-math.js';
export { yieldFromPrice };
import { interpolateYield, syntheticCoupon } from './gap-math.js';

export function localDate(str) {
  if (!str) return null;
  const parts = str.split('-').map(Number);
  if (parts.length !== 3) {
    console.log('localDate invalid format:', str);
    return null;
  }
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt.getTime())) {
    console.log('localDate invalid date:', str);
  }
  return dt;
}

function toDateStr(d) { return d.toISOString().split('T')[0]; }
export function fmtDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function calculatePIPerBond(cusip, maturity, refCPI, tipsMap) {
  const bond = tipsMap.get(cusip);
  if (!bond) return 0;
  const indexRatio = refCPI / (bond.baseCpi || refCPI);
  const adjustedPrincipal = 1000 * indexRatio;
  const annualInterest = adjustedPrincipal * bond.coupon;
  const month = maturity.getMonth() + 1;
  const lastYearInterest = (month < 7) ? annualInterest * 0.5 : annualInterest * 1.0;
  return adjustedPrincipal + lastYearInterest;
}

function laterMatIntContribution(qty, annualInt) {
  return qty * annualInt;
}

export function buildTipsMapFromYields(yieldsRows) {
  const map = new Map();
  for (const r of yieldsRows) {
    map.set(r.cusip, {
      cusip:    r.cusip,
      maturity: localDate(r.maturity),
      coupon:   r.coupon,
      baseCpi:  r.baseCpi,
      price:    r.price  || null,
      yield:    r.yield  || null,
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
  // Fall back to tipsMap to find the nearest pre-gap Jan TIPS (currently Jan 2036).
  // In full rebalance this generates a BUY for 2036 excess bonds (qtyBefore = 0).
  if (lowerCUSIP == null && gapYears.length > 0) {
    for (const bond of tipsMap.values()) {
      if (!bond.maturity || !bond.yield) continue;
      const yr = bond.maturity.getFullYear(), mo = bond.maturity.getMonth() + 1;
      if (mo === 1 && yr < minGapYear) {
        if (!lowerMaturity || yr > lowerMaturity.getFullYear()) {
          lowerCUSIP = bond.cusip; lowerYear = yr; lowerMaturity = bond.maturity;
        }
      }
    }
  }
  return { lowerCUSIP, lowerYear, lowerMaturity, upperCUSIP, upperYear, upperMaturity };
}

function bracketWeights(lowerDur, upperDur, dGap) {
  if (Math.abs(upperDur - lowerDur) < 0.0001) return { lowerWeight: 0.5, upperWeight: 0.5 };
  const lowerWeight = (upperDur - dGap) / (upperDur - lowerDur);
  return { lowerWeight, upperWeight: 1 - lowerWeight };
}

function bracketWeights3(d1, d2, d3, dGap, currentExcessCost1, gapTotalCost) {
  if (gapTotalCost <= 0) return { origLowerWeight: 0, newLowerWeight: 0, upperWeight: 0, feasible: true };
  const w1 = currentExcessCost1 / gapTotalCost;
  const den = d2 - d3;
  if (Math.abs(den) < 0.0001) return { origLowerWeight: w1, newLowerWeight: Math.max(0, 1 - w1) / 2, upperWeight: Math.max(0, 1 - w1) / 2, feasible: true };
  const w2_raw = (dGap - d3 + w1 * (d3 - d1)) / den;
  const w2 = Math.max(0, w2_raw);
  const w3 = Math.max(0, 1 - w1 - w2);
  return { origLowerWeight: w1, newLowerWeight: w2, upperWeight: w3, feasible: w2_raw >= 0 };
}

function calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings, lastYear, isFullMode, extraLMIByYear = {}, pliCreditByGapYear = {}, skipActualHoldingsYears = new Set()) {
  if (gapYears.length === 0) return { avgDuration: 0, totalCost: 0 };
  const holdingsByYear = {};
  for (const h of holdings) {
    if (!holdingsByYear[h.year]) holdingsByYear[h.year] = [];
    holdingsByYear[h.year].push(h);
  }

  // Pre-pass over skip years (long→short): compute funded qty with running LMI.
  // Skip years (e.g. future30y cover 2052/2056) can't use actual holdings (they include excess).
  // Must process long→short so the longer cover year's LMI feeds the shorter one.
  let skipRunningLMI = 0;
  const skipYearFundedAnnInt = {};
  if (skipActualHoldingsYears.size > 0) {
    for (const year of [...skipActualHoldingsYears].sort((a, b) => b - a)) {
      const yearBonds = [...tipsMap.values()].filter(b => b.maturity && b.maturity.getFullYear() === year);
      if (yearBonds.length > 0) {
        yearBonds.sort((a, b) => a.maturity - b.maturity);
        const b = yearBonds[yearBonds.length - 1];
        const ir = refCPI / (b.baseCpi || refCPI);
        const piPB = 1000 * ir + (b.maturity.getMonth() + 1 < 7 ? 0.5 : 1.0) * 1000 * ir * b.coupon;
        const qty = Math.max(0, Math.round((DARA - skipRunningLMI) / piPB));
        skipYearFundedAnnInt[year] = qty * 1000 * ir * b.coupon;
        skipRunningLMI += skipYearFundedAnnInt[year];
      }
    }
  }

  // Full mode: pre-compute a long→short running-LMI estimate for all 2041+ rungs.
  // Matches build-lib's preliminary sweep (calcPrelimFundedYearAmounts) so that
  // gapParams.totalCost / targetQty2040 agree with build-lib despite not using
  // actual holdings. Gap mode can skip this — it uses actual holdings instead.
  const fullModePrelimAnnInt = {};
  if (isFullMode) {
    let runningFullLMI = 0;
    for (let year = (lastYear || 2040); year >= 2041; year--) {
      const yearBonds = [...tipsMap.values()].filter(b => b.maturity && b.maturity.getFullYear() === year);
      if (yearBonds.length > 0) {
        yearBonds.sort((a, b) => a.maturity - b.maturity);
        const b = yearBonds[yearBonds.length - 1];
        const coupon = b.coupon ?? 0;
        const ir = refCPI / (b.baseCpi || refCPI);
        const piPB = 1000 * ir + (b.maturity.getMonth() + 1 < 7 ? 0.5 : 1.0) * 1000 * ir * coupon;
        const qty = Math.max(0, Math.round((DARA - runningFullLMI) / piPB));
        const annInt = qty * 1000 * ir * coupon;
        fullModePrelimAnnInt[year] = annInt;
        runningFullLMI += annInt;
      }
    }
  }

  let laterMaturityFrom2041Plus = 0;
  // Estimate interest from rungs > 2040
  for (let year = 2041; year <= (lastYear || 2040); year++) {
    const yi = holdingsByYear[year] || [];
    if (yi.length > 0 && !isFullMode && !skipActualHoldingsYears.has(year)) {
      // Use current holdings if not rebalancing everything (and not a skip year)
      for (const h of yi) {
        const bond = tipsMap.get(h.cusip);
        const coupon = bond?.coupon ?? 0;
        const baseCpi = bond?.baseCpi ?? refCPI;
        const indexRatio = refCPI / baseCpi;
        laterMaturityFrom2041Plus += h.qty * 1000 * indexRatio * coupon;
      }
    } else if (isFullMode || yi.length > 0 || skipActualHoldingsYears.has(year)) {
      if (isFullMode) {
        laterMaturityFrom2041Plus += fullModePrelimAnnInt[year] ?? 0;
      } else if (skipActualHoldingsYears.has(year) && skipYearFundedAnnInt[year] !== undefined) {
        // Gap mode skip year: use inter-skip running-LMI estimate
        laterMaturityFrom2041Plus += skipYearFundedAnnInt[year];
      } else {
        // Gap mode, year present in holdings but not a skip year — shouldn't reach here normally
        const yearBonds = [...tipsMap.values()].filter(b => b.maturity && b.maturity.getFullYear() === year);
        if (yearBonds.length > 0) {
          yearBonds.sort((a, b) => a.maturity - b.maturity);
          const b = yearBonds[yearBonds.length - 1];
          const coupon = b.coupon;
          const ir = refCPI / (b.baseCpi || refCPI);
          const piPB = 1000 * ir + (b.maturity.getMonth() + 1 < 7 ? 0.5 : 1.0) * 1000 * ir * coupon;
          const qty = Math.round(DARA / piPB);
          laterMaturityFrom2041Plus += qty * 1000 * ir * coupon;
        }
      }
    }
  }

  // Resolve 2040 upper bracket: prefer actual holdings, fall back to hardcoded CUSIP if not held
  const _ub2040Holdings = holdingsByYear[2040] ?? [];
  const _ub2040CUSIP = _ub2040Holdings[0]?.cusip || '912810QF8';
  const _ub2040Maturity = _ub2040Holdings[0]?.maturity || localDate('2040-02-15');
  const bond2040 = tipsMap.get(_ub2040CUSIP);
  const coupon2040 = bond2040?.coupon ?? 0;
  const baseCpi2040 = bond2040?.baseCpi ?? refCPI;
  const indexRatio2040 = refCPI / baseCpi2040;
  const piPerBond2040 = calculatePIPerBond(_ub2040CUSIP, _ub2040Maturity, refCPI, tipsMap);
  // When lastYear < 2040, 2040 is purely a bracket (not a funded rung) — use actual holdings qty for LMI
  const targetQty2040 = lastYear < 2040
    ? _ub2040Holdings.reduce((s, h) => s + h.qty, 0)
    : Math.round((DARA - laterMaturityFrom2041Plus) / (piPerBond2040 || 1));
  const annualInterest2040 = targetQty2040 * 1000 * indexRatio2040 * coupon2040;

  const gapLaterMaturityInterest = { 2040: annualInterest2040 };
  // Add other years > 2040 to the gap LMI pool
  for (let year = 2041; year <= (lastYear || 2040); year++) {
    const yi = holdingsByYear[year] || [];
    if (yi.length > 0 && !isFullMode && !skipActualHoldingsYears.has(year)) {
      gapLaterMaturityInterest[year] = 0;
      for (const h of yi) {
        const bond = tipsMap.get(h.cusip);
        const coupon = bond?.coupon ?? 0;
        const baseCpi = bond?.baseCpi ?? refCPI;
        const indexRatio = refCPI / baseCpi;
        gapLaterMaturityInterest[year] += h.qty * 1000 * indexRatio * coupon;
      }
    } else if (isFullMode || yi.length > 0 || skipActualHoldingsYears.has(year)) {
      if (isFullMode) {
        gapLaterMaturityInterest[year] = fullModePrelimAnnInt[year] ?? 0;
      } else if (skipActualHoldingsYears.has(year) && skipYearFundedAnnInt[year] !== undefined) {
        // Gap mode skip year
        gapLaterMaturityInterest[year] = skipYearFundedAnnInt[year];
      } else {
        const yearBonds = [...tipsMap.values()].filter(b => b.maturity && b.maturity.getFullYear() === year);
        if (yearBonds.length > 0) {
          yearBonds.sort((a, b) => a.maturity - b.maturity);
          const b = yearBonds[yearBonds.length - 1];
          const coupon = b.coupon;
          const ir = refCPI / (b.baseCpi || refCPI);
          const piPB = 1000 * ir + (b.maturity.getMonth() + 1 < 7 ? 0.5 : 1.0) * 1000 * ir * coupon;
          const qty = Math.round(DARA / piPB);
          gapLaterMaturityInterest[year] = qty * 1000 * ir * coupon;
        }
      }
    }
  }

  // Inject future cover excess LMI (bonds beyond current holdings to be purchased)
  for (const [y, extra] of Object.entries(extraLMIByYear)) {
    if (extra > 0) gapLaterMaturityInterest[y] = (gapLaterMaturityInterest[y] ?? 0) + extra;
  }

  const minGapYear = Math.min(...gapYears);
  const maxGapYear = Math.max(...gapYears);
  let anchorBefore = null, anchorAfter = null;

  let anchorAfterYear = Infinity;
  for (const bond of tipsMap.values()) {
    if (!bond.maturity || !bond.yield) continue;
    const year  = bond.maturity.getFullYear();
    const month = bond.maturity.getMonth() + 1;
    // Walk backward: pick the highest Jan TIPS year strictly below minGapYear.
    // When firstYear is inside the gap (e.g. 2038/2039), minGapYear - 1 may itself be a gap
    // year with no TIPS, so we take the nearest Jan TIPS before the structural gap block.
    if (month === 1 && year < minGapYear && (!anchorBefore || year > anchorBefore.maturity.getFullYear())) {
      anchorBefore = { maturity: bond.maturity, yield: bond.yield };
    }
    if (year > maxGapYear && month === 2 && year < anchorAfterYear) {
      anchorAfter = { maturity: bond.maturity, yield: bond.yield };
      anchorAfterYear = year;
    }
  }
  if (!anchorBefore || !anchorAfter) {
    console.log('anchorBefore:', anchorBefore);
    console.log('anchorAfter:', anchorAfter);
    throw new Error('Could not find interpolation anchors for gap years');
  }

  let totalDuration = 0, totalCost = 0, count = 0;
  const breakdown = [];
  // Process longest→shortest so each gap year's synthetic interest feeds the next shorter rung.
  let runningSynLMI = 0;
  for (const year of [...gapYears].sort((a, b) => b - a)) {
    const syntheticMat = new Date(year, 1, 15);
    const syntheticYield = interpolateYield(anchorBefore, { maturity: anchorAfter.maturity, yield: anchorAfter.yield }, syntheticMat);
    const synCpn = syntheticCoupon(syntheticYield);

    const synDur = calculateMDuration(settlementDate, syntheticMat, synCpn, syntheticYield);
    totalDuration += synDur;

    // LMI = actual TIPS interest from funded years above + synthetic interest from longer gap years
    let sumLaterMaturityInterest = runningSynLMI;
    for (const futYear in gapLaterMaturityInterest) {
      if (parseInt(futYear) > year) sumLaterMaturityInterest += gapLaterMaturityInterest[futYear];
    }

    const piPerBond = 1000 + 1000 * synCpn * 0.5;
    // Treat synthetic TIPS like any other rung: subtract LMI and PLI credit before sizing.
    const qty = Math.max(0, Math.round((DARA - sumLaterMaturityInterest - (pliCreditByGapYear[year] ?? 0)) / piPerBond));

    // Gap total cost is the sum of market costs of all gap years.
    // For synthetic TIPS, price is 100 since we're interpolating yields.
    totalCost += qty * 1000;
    breakdown.push({ year, qty, piPerBond, laterMatInt: sumLaterMaturityInterest, pliCredit: pliCreditByGapYear[year] ?? 0, dur: synDur });
    runningSynLMI += qty * 1000 * synCpn; // this gap year's synthetic interest feeds shorter rungs
    count++;
  }

  return { avgDuration: totalDuration / count, totalCost, breakdown };
}

// Infer the true firstYear when a Format 4/5 CSV is loaded whose derivedFirstYear is a pure bracket
// year below the structural gap (e.g. 2036 when the ladder actually started at 2038).
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
    const ir = refCPI / (b.baseCpi ?? refCPI);
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
      const ir = refCPI / (b.baseCpi ?? refCPI);
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

export function inferDARAFromCash({ bracketMode = '2bracket', holdings: holdingsRaw, tipsMap, refCPI, settlementDate, lastYearOverride = null, preLadderInterest = false, firstYearOverride = null }) {
  let portfolioCash = 0;
  for (const h of holdingsRaw) {
    const bond = tipsMap.get(h.cusip);
    if (!bond) continue;
    const ir = refCPI / (bond.baseCpi ?? refCPI);
    portfolioCash += h.qty * (bond.price ?? 0) / 100 * ir * 1000;
  }
  let lo = 1000, hi = 1000000, foundDARA = lo;
  // Binary search for the largest INTEGER DARA that results in delta >= 0
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const { summary } = runRebalance({ dara: mid, method: 'Full', bracketMode, holdings: holdingsRaw, tipsMap, refCPI, settlementDate, lastYearOverride, preLadderInterest, firstYearOverride });
    if (summary.costDeltaSum >= 0) {
      foundDARA = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { dara: foundDARA, portfolioCash };
}

export function runRebalance({ dara, method, bracketMode = '2bracket', holdings: holdingsRaw, tipsMap, refCPI, settlementDate, daraByYear = null, lastYearOverride = null, preLadderInterest = false, firstYearOverride = null }) {
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

  const yearInfo = {};
  holdings.forEach((h, idx) => {
    if (!yearInfo[h.year]) yearInfo[h.year] = { firstIdx: idx, lastIdx: idx, holdings: [] };
    yearInfo[h.year].lastIdx = idx;
    yearInfo[h.year].holdings.push(h);
  });

  const holdingsYears = Object.keys(yearInfo).map(Number).sort((a, b) => a - b);
  const derivedFirstYear = holdingsYears[0];
  let firstYear = holdingsYears[0];
  const has2040 = holdingsYears.includes(2040);
  let lastYear = firstYear;
  for (let i = 0; i < holdingsYears.length; i++) {
    const year = holdingsYears[i];
    if (year <= 2040) { lastYear = year; continue; }
    // year > 2040: only extend if 2040 is held (structural gap doesn't break contiguity)
    if (!has2040) break;
    const nextExpected   = year + 1;
    const nextInHoldings = holdingsYears[i + 1];
    if (nextInHoldings && nextInHoldings === nextExpected) { lastYear = nextInHoldings; }
    else { lastYear = year; break; }
  }
  const derivedLastYear = lastYear;  // save before override for sell-above-lastYear logic
  if (lastYearOverride != null) lastYear = lastYearOverride;
  if (firstYearOverride != null) firstYear = firstYearOverride;

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

  const araLaterMaturityInterestByYear = {};
  const araByYear = {};
  const allYearsSorted = Object.keys(yearInfo).map(Number).sort((a, b) => b - a);

  for (const year of allYearsSorted) {
    let laterMatInt = 0;
    for (const y in araLaterMaturityInterestByYear) {
      if (parseInt(y) > year) laterMatInt += araLaterMaturityInterestByYear[y];
    }
    let yearPrincipal = 0, yearLastYearInterest = 0;
    araLaterMaturityInterestByYear[year] = 0;
    for (const holding of yearInfo[year].holdings) {
      const b = tipsMap.get(holding.cusip);
      const cp = b?.coupon ?? 0;
      const bc = b?.baseCpi ?? refCPI;
      const ir = refCPI / bc;
      const ap = 1000 * ir;
      const mF = holding.maturity.getMonth() + 1;
      const lastYI = mF < 7 ? (ap * cp * 0.5) : (ap * cp * 1.0);
      yearPrincipal += holding.qty * ap;
      yearLastYearInterest += holding.qty * lastYI;
      araLaterMaturityInterestByYear[year] += holding.qty * ap * cp;
    }
    araByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
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
  const inferredDARA = medianARA;
  const isFullMode   = (method === 'Full');
  const DARA         = dara !== null ? dara : inferredDARA;

  // ── PLI zeroing pass (mirrors build-lib §3b) ──────────────────────────────────
  // Single interleaved pass short→long: gap years consume pool before longer funded years.
  const zeroedFundedYears = new Set();
  const pliCreditByFundedYear = {};
  const pliCreditByGapYear = {};
  let preLadderPool = 0;
  let partialCreditYear = null, partialCredit = 0;

  if (preLadderInterest) {
    const preLadderYears = Math.max(0, firstYear - settlementDate.getFullYear());
    if (preLadderYears > 0) {
      // Prelim sweep (long→short) over actual TIPS years: funded-qty-based annual interest only.
      // Mirrors build-lib's prelim phase — must NOT include excess bracket quantities in the pool,
      // otherwise the pool is inflated and too many years get zeroed.
      let runningPrelimLMI = 0;
      const prelimFundedAnnualInt = {};
      const actualYearsLongToShort = Object.keys(yearInfo).map(Number)
        .filter(y => y >= firstYear && y <= lastYear)
        .sort((a, b) => b - a);
      for (const year of actualYearsLongToShort) {
        const sortedH = [...yearInfo[year].holdings].sort((a, b) => b.maturity - a.maturity);
        const targetH = sortedH[0];
        if (!targetH) continue;
        const b = tipsMap.get(targetH.cusip);
        if (!b) continue;
        const ir = refCPI / (b.baseCpi ?? refCPI);
        const piPB = calculatePIPerBond(targetH.cusip, targetH.maturity, refCPI, tipsMap);
        const yearDara = daraByYear?.get(year) ?? DARA;
        const fyQty = Math.max(0, Math.round((yearDara - runningPrelimLMI) / piPB));
        const annInt = fyQty * 1000 * ir * (b.coupon ?? 0);
        prelimFundedAnnualInt[year] = annInt;
        runningPrelimLMI += annInt;
      }

      const totalAnnualInt = Object.values(prelimFundedAnnualInt).reduce((s, v) => s + v, 0);
      preLadderPool = preLadderYears * totalAnnualInt;

      const gapYearSetForPLI = new Set(gapYears);
      const future30yYearSetForPLI = new Set(future30yYears);
      let remaining = preLadderPool;
      for (let year = firstYear; year <= lastYear; year++) {
        if (remaining <= 0) break;
        if (gapYearSetForPLI.has(year)) {
          // Gap year: estimate need using funded-year-based LMI above (matches build-lib)
          const actualTIPSLMI = Object.entries(prelimFundedAnnualInt)
            .filter(([y]) => parseInt(y) > year)
            .reduce((s, [, v]) => s + v, 0);
          const need = Math.max(0, DARA - actualTIPSLMI);
          if (remaining >= need) {
            pliCreditByGapYear[year] = need;
            remaining -= need;
          } else {
            pliCreditByGapYear[year] = remaining;
            remaining = 0;
          }
        } else if (!future30yYearSetForPLI.has(year)) {
          // Funded year (with or without current holdings): need = DARA - funded-LMI-from-above.
          // Must NOT restrict to yearInfo[year] — years zeroed in Build have no holdings when
          // loaded into Rebalance, but the PLI pool should still zero them.
          const laterMatInt = Object.entries(prelimFundedAnnualInt)
            .filter(([y]) => parseInt(y) > year)
            .reduce((s, [, v]) => s + v, 0);
          const need = (daraByYear?.get(year) ?? DARA) - laterMatInt;
          if (need <= 0) { zeroedFundedYears.add(year); pliCreditByFundedYear[year] = 0; continue; }
          if (remaining >= need) {
            zeroedFundedYears.add(year);
            pliCreditByFundedYear[year] = need;
            remaining -= need;
          } else {
            // Pool covers this year partially — reduce its qty but don't zero it
            pliCreditByFundedYear[year] = remaining;
            partialCreditYear = year;
            partialCredit = remaining;
            remaining = 0;
            break;
          }
        }
      }
    }
  }

  // ── Phase 3.1: Future cover pair identification and params (BEFORE gap params)
  //    Future excess at 2056/2052 contributes LMI to gap years, so must be computed first.
  let future30yLowerYear = null, future30yUpperYear = null;
  let future30yLowerCoverBond = null, future30yUpperCoverBond = null;
  let future30yParams = null;
  let future30yLowerDuration = 0, future30yUpperDuration = 0;
  let future30yUpperWeight = 0, future30yLowerWeight = 0;
  let future30yUpperExQty = 0, future30yLowerExQty = 0;
  let future30yFellBack = false;

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

    const coupon2056 = future30yLowerCoverBond.coupon ?? 0;
    const yield2056  = future30yLowerCoverBond.yield  ?? 0;
    const piPerFutureTips = 1000 + 1000 * coupon2056 * 0.5;
    let totalFuture30yDur = 0, future30yTotalCost = 0, runningFuture30yLMI = 0;
    const future30yBreakdown = [];
    for (const year of [...future30yYears].sort((a, b) => b - a)) {
      const futureMat = new Date(year, 1, 15);
      const dur = calculateMDuration(settlementDate, futureMat, coupon2056, yield2056);
      totalFuture30yDur += dur;
      const qty = Math.max(0, Math.round((DARA - runningFuture30yLMI) / piPerFutureTips));
      future30yBreakdown.push({ year, qty, piPerBond: piPerFutureTips, laterMatInt: runningFuture30yLMI, dur });
      runningFuture30yLMI += qty * 1000 * coupon2056;
      future30yTotalCost  += qty * 1000;
    }
    future30yParams = { avgDuration: totalFuture30yDur / future30yYears.length, future30yTotalCost, breakdown: future30yBreakdown, future30ySeedLMI: runningFuture30yLMI };

    future30yLowerDuration = calculateMDuration(settlementDate, future30yLowerCoverBond.maturity, future30yLowerCoverBond.coupon ?? 0, future30yLowerCoverBond.yield ?? 0);
    future30yUpperDuration = calculateMDuration(settlementDate, future30yUpperCoverBond.maturity, future30yUpperCoverBond.coupon ?? 0, future30yUpperCoverBond.yield ?? 0);

    if (future30yParams.avgDuration > future30yUpperDuration) {
      future30yUpperWeight = 1.0; future30yLowerWeight = 0.0; future30yFellBack = true;
    } else {
      const span = future30yUpperDuration - future30yLowerDuration;
      future30yUpperWeight = span > 0 ? (future30yParams.avgDuration - future30yLowerDuration) / span : 0;
      future30yLowerWeight = 1.0 - future30yUpperWeight;
    }

    const future30yUpperCPB = (future30yUpperCoverBond.price ?? 0) / 100 * (refCPI / (future30yUpperCoverBond.baseCpi ?? refCPI)) * 1000;
    const future30yLowerCPB = (future30yLowerCoverBond.price ?? 0) / 100 * (refCPI / (future30yLowerCoverBond.baseCpi ?? refCPI)) * 1000;
    future30yUpperExQty = future30yUpperCPB > 0 ? Math.round(future30yParams.future30yTotalCost * future30yUpperWeight / future30yUpperCPB) : 0;
    future30yLowerExQty = future30yLowerCPB > 0 ? Math.round(future30yParams.future30yTotalCost * future30yLowerWeight / future30yLowerCPB) : 0;
  }

  // Augment gapLaterMaturityInterest with future cover excess LMI before computing gap params
  const future30yExtraLMI = {};
  if (future30yLowerExQty > 0 && future30yLowerCoverBond) {
    const irL = refCPI / (future30yLowerCoverBond.baseCpi ?? refCPI);
    future30yExtraLMI[future30yLowerYear] = future30yLowerExQty * 1000 * irL * (future30yLowerCoverBond.coupon ?? 0);
  }
  if (future30yUpperExQty > 0 && future30yUpperCoverBond) {
    const irU = refCPI / (future30yUpperCoverBond.baseCpi ?? refCPI);
    future30yExtraLMI[future30yUpperYear] = future30yUpperExQty * 1000 * irU * (future30yUpperCoverBond.coupon ?? 0);
  }

  const skipActualHoldingsYearsForGap = future30yYears.length > 0 ? new Set([future30yLowerYear, future30yUpperYear]) : new Set();
  const gapParams = calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings, lastYear, isFullMode, future30yExtraLMI, pliCreditByGapYear, skipActualHoldingsYearsForGap);

  const brackets  = identifyBrackets(gapYears, holdings, yearInfo, tipsMap, araByYear, DARA, firstYear);
  const lowerBond = brackets.lowerCUSIP ? tipsMap.get(brackets.lowerCUSIP) : null;
  const upperBond = brackets.upperCUSIP ? tipsMap.get(brackets.upperCUSIP) : null;
  const lowerDuration = brackets.lowerMaturity ? calculateMDuration(settlementDate, brackets.lowerMaturity, lowerBond?.coupon ?? 0, lowerBond?.yield ?? 0) : 0;
  const upperDuration = brackets.upperMaturity ? calculateMDuration(settlementDate, brackets.upperMaturity, upperBond?.coupon ?? 0, upperBond?.yield ?? 0) : 0;
  
  const minGapYear = gapYears.length > 0 ? Math.min(...gapYears) : Infinity;
  // 3-bracket requires a distinct orig-lower vs new-lower; when firstYear is inside the gap
  // (e.g. 2038/2039), minGapYear = firstYear, so the nearest pre-gap Jan TIPS is Jan 2036 for
  // both orig-lower (from identifyBrackets fallback) and new-lower → same year → auto-degrades below.
  let is3Bracket = (bracketMode === '3bracket') && brackets.lowerCUSIP != null;
  let newLowerYear = null, newLowerCUSIP = null, newLowerMaturity = null, newLowerDuration = 0;
  if (is3Bracket && gapYears.length > 0) {
    // New lower = nearest Jan TIPS strictly below minGapYear. minGapYear−1 may itself be a gap
    // year (e.g. firstYear=2038 → minGapYear=2038 → 2037 has no TIPS), so walk tipsMap for the
    // highest Jan year < minGapYear, same as anchorBefore in calculateGapParameters.
    for (const [_cusip, _bond] of tipsMap.entries()) {
      if (!_bond.maturity || !_bond.yield) continue;
      const _yr = _bond.maturity.getFullYear(), _mo = _bond.maturity.getMonth() + 1;
      if (_mo === 1 && _yr < minGapYear) {
        if (!newLowerMaturity || _yr > newLowerMaturity.getFullYear()) {
          newLowerCUSIP = _cusip; newLowerMaturity = _bond.maturity; newLowerYear = _yr;
        }
      }
    }
    if (!newLowerCUSIP) throw new Error('3-bracket: no Jan TIPS found before gap year ' + minGapYear);
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

  // LMI-based FY estimate for the 3-bracket original lower only.
  // Used exclusively to compute originalLowerExcessCost → w1 below. Not used for Phase 4 display.
  const bracketTargetFundedYearQtyBefore = {};
  if (is3Bracket && gapYears.length > 0) {
    const bYear = brackets.lowerYear, bCUSIP = brackets.lowerCUSIP, bMat = brackets.lowerMaturity;
    if (!yearInfo[bYear]) yearInfo[bYear] = { holdings: [] };
    let laterMatIntBefore = 0;
    for (const y in araLaterMaturityInterestByYear) {
      if (parseInt(y) > bYear) laterMatIntBefore += araLaterMaturityInterestByYear[y];
    }
    const yh = yearInfo[bYear].holdings;
    const piB = calculatePIPerBond(bCUSIP, bMat, refCPI, tipsMap);
    let nonPI = 0;
    for (const h of yh) { if (h.cusip !== bCUSIP) nonPI += h.qty * calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap); }
    const bDara = bYear > lastYear ? 0 : (daraByYear?.get(bYear) ?? DARA);
    bracketTargetFundedYearQtyBefore[bYear] = Math.max(0, Math.round((bDara - laterMatIntBefore - nonPI) / piB));
  }

  // When excessQty is provided by the import (Formats 4 or 5), it encodes the funded/excess split
  // from the prior build/rebalance. Use it for ALL bracket years, overriding the DARA-derived estimate.
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
  let bracketFellBack3to2 = false;
  if (gapYears.length > 0) {
    if (is3Bracket) {
      const originalLowerHolding = yearInfo[brackets.lowerYear]?.holdings?.find(h => h.cusip === brackets.lowerCUSIP);
      const originalLowerBond = tipsMap.get(brackets.lowerCUSIP);
      const ir = refCPI / (originalLowerBond?.baseCpi ?? refCPI);
      const originalLowerCostPerBond = (originalLowerBond?.price ?? 0) / 100 * ir * 1000;
      const originalLowerExcessCost = Math.max(0, (originalLowerHolding?.qty ?? 0) - (bracketTargetFundedYearQtyBefore[brackets.lowerYear] ?? 0)) * originalLowerCostPerBond;

      const weights3Bracket = bracketWeights3(lowerDuration, newLowerDuration, upperDuration, gapParams.avgDuration, originalLowerExcessCost, gapParams.totalCost);
      if (weights3Bracket.origLowerWeight > 1) {
        // Orig lower excess exceeds gap total cost — fall back to 2-bracket using orig lower
        const weightsFallback = bracketWeights(lowerDuration, upperDuration, gapParams.avgDuration);
        origLowerWeight = weightsFallback.lowerWeight; newLowerWeight3 = 0; upperWeight3 = weightsFallback.upperWeight;
        bracketFellBack3to2 = true;
      } else {
        origLowerWeight = weights3Bracket.origLowerWeight; newLowerWeight3 = weights3Bracket.newLowerWeight; upperWeight3 = weights3Bracket.upperWeight;
      }
      lowerWeight = origLowerWeight; upperWeight = upperWeight3;
    } else {
      const weights2Bracket = bracketWeights(lowerDuration, upperDuration, gapParams.avgDuration);
      lowerWeight = weights2Bracket.lowerWeight; upperWeight = weights2Bracket.upperWeight;
    }
  }

  let rebalYearSet = new Set();
  if (isFullMode) {
    for (let y = firstYear; y <= lastYear; y++) {
      if (!bracketYearSet.has(y) && !gapYearSet.has(y)) rebalYearSet.add(y);
    }
  } else {
    if (gapYears.length > 0 && brackets.lowerYear != null) {
      for (let y = firstYear; y <= lastYear; y++) {
        if (y > brackets.lowerYear && y < minGapYear && !bracketYearSet.has(y) && !gapYearSet.has(y)) {
          rebalYearSet.add(y);
        }
      }
    }
  }

  const bracketExcessTargetCost = {};
  if (gapYears.length > 0) {
    if (is3Bracket) {
      const w1 = origLowerWeight ?? 0, w2 = newLowerWeight3 ?? 0, w3 = upperWeight3 ?? 0;
      bracketExcessTargetCost[brackets.lowerYear] = (bracketExcessTargetCost[brackets.lowerYear] || 0) + gapParams.totalCost * w1;
      bracketExcessTargetCost[newLowerYear]       = (bracketExcessTargetCost[newLowerYear] || 0) + gapParams.totalCost * w2;
      bracketExcessTargetCost[brackets.upperYear] = (bracketExcessTargetCost[brackets.upperYear] || 0) + gapParams.totalCost * w3;
      // Update summary weights to reflect the sum if they share a year
      if (brackets.lowerYear === newLowerYear) {
        lowerWeight = w1 + w2;
      }
    } else {
      if (brackets.lowerYear != null) bracketExcessTargetCost[brackets.lowerYear] = gapParams.totalCost * lowerWeight;
      bracketExcessTargetCost[brackets.upperYear] = gapParams.totalCost * upperWeight;
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
  let rebuildLaterMatInt = 0;
  const yearLaterMatIntSnapshot = {};
  const allProcessYears = new Set([...holdingsYears, ...gapYears, ...bracketYearSet]);
  for (let y = firstYear; y <= lastYear; y++) allProcessYears.add(y);
  const sortedToProcess = Array.from(allProcessYears).sort((a, b) => b - a);

  for (const year of sortedToProcess) {
    yearLaterMatIntSnapshot[year] = rebuildLaterMatInt;
    if (gapYearSet.has(year) || future30yYearSet.has(year)) continue;

    const yi = yearInfo[year] || { holdings: [] };
    const isBracket = bracketYearSet.has(year);
    const isRebal = rebalYearSet.has(year);

    let targetCUSIP;
    const piMap = {};
    for (const h of yi.holdings) piMap[h.cusip] = calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap);

    if (isBracket) {
      if (gapYears.length > 0 && year === brackets.lowerYear) targetCUSIP = brackets.lowerCUSIP;
      else if (gapYears.length > 0 && year === brackets.upperYear) targetCUSIP = brackets.upperCUSIP;
      else if (is3Bracket && year === newLowerYear) targetCUSIP = newLowerCUSIP;
      else if (future30yYears.length > 0 && year === future30yLowerYear) targetCUSIP = future30yLowerCoverBond.cusip;
      else if (future30yYears.length > 0 && year === future30yUpperYear) targetCUSIP = future30yUpperCoverBond.cusip;
    } else {
      const sortedH = [...yi.holdings].sort((a, b) => b.maturity - a.maturity);
      targetCUSIP = sortedH[0]?.cusip;
      if (!targetCUSIP && isRebal) {
        // Fallback: pick latest maturity for this year from tipsMap
        const yearBonds = [...tipsMap.values()].filter(b => b.maturity && b.maturity.getFullYear() === year);
        if (yearBonds.length > 0) {
          yearBonds.sort((a, b) => a.maturity - b.maturity);
          targetCUSIP = yearBonds[yearBonds.length - 1].cusip;
        }
      }
    }

    // Ensure piMap has the target CUSIP — it may not be in current holdings
    if (targetCUSIP && !piMap[targetCUSIP]) {
      const b = tipsMap.get(targetCUSIP);
      if (b && b.maturity) {
        piMap[targetCUSIP] = calculatePIPerBond(targetCUSIP, b.maturity, refCPI, tipsMap);
      }
    }

    const tBond = tipsMap.get(targetCUSIP);
    const ir = (refCPI / (tBond?.baseCpi ?? refCPI));
    const costPerBond = (tBond?.price ?? 0) / 100 * ir * 1000;
    const targetCurrentQty = yi.holdings.find(h => h.cusip === targetCUSIP)?.qty ?? 0;

    let tFundedYearQty, postQ;
    if (isBracket || isRebal) {
      const yearDara = (year > lastYear || year < firstYear) ? 0 : (daraByYear?.get(year) ?? DARA);
      
      // 1. Determine target excess quantity for this bracket/rebal year
      let excessQtyTarget = 0;
      if (isBracket) {
        if (is3Bracket && year === brackets.lowerYear) {
          // Special for 3-bracket orig lower: preserve current excess relative to BEFORE state FY target.
          // If DARA has grown such that bracketTargetFundedYearQtyBefore >= current holdings, there is no
          // "preserved" excess — fall through to the standard bracketExcessTargetCost formula so that the
          // new-lower bracket allocation (w2 × totalCost) is correctly applied rather than returning 0.
          const _preservedExcess = Math.max(0, targetCurrentQty - (bracketTargetFundedYearQtyBefore[year] ?? 0));
          excessQtyTarget = _preservedExcess > 0
            ? _preservedExcess
            : costPerBond > 0 ? Math.max(0, Math.round((bracketExcessTargetCost[year] || 0) / costPerBond)) : 0;
        } else if (future30yYears.length > 0 && year === future30yUpperYear) {
          // Use precomputed UNADJ-based excess qty directly (matches build-lib)
          excessQtyTarget = future30yUpperExQty;
        } else if (future30yYears.length > 0 && year === future30yLowerYear) {
          excessQtyTarget = future30yLowerExQty;
        } else {
          excessQtyTarget = costPerBond > 0 ? Math.max(0, Math.round((bracketExcessTargetCost[year] || 0) / costPerBond)) : 0;
        }
      }
      
      // 2. Calculate LMI from this year's own excess bonds
      const excessLMI = excessQtyTarget * 1000 * ir * (tBond?.coupon ?? 0);

      // 3. Calculate needed P+I, subtracting both incoming LMI and current year excess LMI
      const effectivePartialCredit = (year === partialCreditYear) ? partialCredit : 0;
      const needed = yearDara - rebuildLaterMatInt - excessLMI - effectivePartialCredit;

      if (zeroedFundedYears.has(year)) {
        // PLI covers this year's funded need — zero funded qty
        tFundedYearQty = 0;
      } else if (isFullMode) {
        const sortedH = [...yi.holdings].sort((a, b) => b.maturity - a.maturity);
        const nonTarget = sortedH.filter(h => h.cusip !== targetCUSIP);
        let curPI = yi.holdings.reduce((s, h) => s + h.qty * piMap[h.cusip], 0);
        for (const h of nonTarget) {
          const sell = Math.min(h.qty, Math.max(0, Math.floor((curPI - needed) / piMap[h.cusip])));
          postRebalQtyMap[h.cusip] = h.qty - sell;
          curPI -= sell * piMap[h.cusip];
        }
        const diff = needed - curPI;
        tFundedYearQty = Math.max(0, targetCurrentQty + Math.round(diff / piMap[targetCUSIP]));
        for (const h of nonTarget) {
          if (postRebalQtyMap[h.cusip] !== h.qty) {
            const b = tipsMap.get(h.cusip);
            const c = (b?.price ?? 0) / 100 * (refCPI / (b?.baseCpi ?? refCPI)) * 1000;
            nonTargetSells[h.cusip] = { newQty: postRebalQtyMap[h.cusip], qtyDelta: postRebalQtyMap[h.cusip] - h.qty, costDelta: -((postRebalQtyMap[h.cusip] - h.qty) * c), targetCost: postRebalQtyMap[h.cusip] * c };
          }
        }
      } else {
        const nonTarget = yi.holdings.filter(h => h.cusip !== targetCUSIP);
        let ntPI = 0;
        for (const h of nonTarget) ntPI += h.qty * piMap[h.cusip];
        tFundedYearQty = Math.max(0, Math.round((needed - ntPI) / piMap[targetCUSIP]));
      }
      postQ = tFundedYearQty + excessQtyTarget;
      buySellTargets[year] = { targetCUSIP, targetFundedYearQty: tFundedYearQty, targetQty: postQ, postRebalQty: postQ, qtyDelta: postQ - targetCurrentQty, targetCost: tFundedYearQty * costPerBond, costDelta: -((postQ - targetCurrentQty) * costPerBond), costPerBond, isBracket };
    } else if (year > lastYear && year <= derivedLastYear && yi.holdings.length > 0) {
      // Year was contiguous with original ladder but is now above lastYearOverride — sell all
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
          const c2 = (b2?.price ?? 0) / 100 * (refCPI / (b2?.baseCpi ?? refCPI)) * 1000;
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
          const c2 = (b2?.price ?? 0) / 100 * (refCPI / (b2?.baseCpi ?? refCPI)) * 1000;
          nonTargetSells[h.cusip] = { newQty: 0, qtyDelta: -h.qty, costDelta: h.qty * c2, targetCost: 0 };
        }
      }
    } else {
      tFundedYearQty = targetCurrentQty; postQ = targetCurrentQty;
    }

    postRebalQtyMap[targetCUSIP] = postQ;
    for (const h of yi.holdings) {
      const b = tipsMap.get(h.cusip);
      if (b) rebuildLaterMatInt += (postRebalQtyMap[h.cusip] ?? h.qty) * (refCPI / (b.baseCpi || refCPI)) * 1000 * b.coupon;
    }
    // Ensure target CUSIP contributes to LMI pool even when it has no prior holdings (new bracket buy)
    if (targetCUSIP && !yi.holdings.some(h => h.cusip === targetCUSIP) && (postRebalQtyMap[targetCUSIP] ?? 0) > 0) {
      const _blmi = tipsMap.get(targetCUSIP);
      if (_blmi) rebuildLaterMatInt += postRebalQtyMap[targetCUSIP] * (refCPI / (_blmi.baseCpi || refCPI)) * 1000 * _blmi.coupon;
    }
    if (!isFinite(rebuildLaterMatInt)) rebuildLaterMatInt = 0; // safety guard against NaN/Infinity cascade
  }

  // Before/After ARA calculations (totals + per-component breakdown for drill popup)
  const beforeARAByYear = {}, postARAByYear = {};
  const beforeARABreakdown = {}, postARABreakdown = {};
  for (const year of sortedToProcess) {
    let lBefore = 0;
    for (const y in araLaterMaturityInterestByYear) if (parseInt(y) > year) lBefore += araLaterMaturityInterestByYear[y];
    let pB = 0, cB = 0;
    const holdingsBefore = [];
    if (yearInfo[year]) {
      for (const h of yearInfo[year].holdings) {
        const b = tipsMap.get(h.cusip);
        const ir = refCPI / (b?.baseCpi ?? refCPI);
        const ap = 1000 * ir;
        const isBT = (bracketYearSet.has(year) && h.cusip === buySellTargets[year]?.targetCUSIP);
        const q = isBT ? Math.min(bracketTargetFundedYearQtyBefore[year] ?? 0, h.qty) : h.qty;
        const m = h.maturity.getMonth() + 1;
        pB += q * ap; cB += q * ap * b.coupon * (m < 7 ? 0.5 : 1.0);
        holdingsBefore.push({ cusip: h.cusip, maturityMonth: m - 1, maturityYear: h.maturity.getFullYear(), qty: q, principalPerBond: ap, nPeriods: m < 7 ? 1 : 2, coupon: b?.coupon ?? 0 });
      }
    }
    beforeARAByYear[year] = pB + cB + lBefore;
    beforeARABreakdown[year] = { principal: pB, ownCoupon: cB, laterMatInt: lBefore, holdings: holdingsBefore };

    // Years outside [firstYear, lastYear] are not ladder rungs; their "Amount After" is 0.
    // LMI from later bonds flows to firstYear (the shortest rung), not to dropped years.
    const lAfter = (year >= firstYear && year <= lastYear) ? (yearLaterMatIntSnapshot[year] ?? 0) : 0;
    let pA = 0, cA = 0, exIntA = 0;
    const holdingsAfter = [];
    if (yearInfo[year]) {
      for (const h of yearInfo[year].holdings) {
        const b = tipsMap.get(h.cusip);
        const ir = refCPI / (b?.baseCpi ?? refCPI);
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
          const _ir4 = refCPI / (_tb4.baseCpi ?? refCPI);
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
    const pliCredit = pliCreditByFundedYear[year] ?? 0;
    postARAByYear[year] = pA + cA + lAfter + exIntA + pliCredit;
    postARABreakdown[year] = { principal: pA, ownCoupon: cA, laterMatInt: lAfter, holdings: holdingsAfter, pliCredit };
  }

  // Summary Metrics
  const lowerBondS = tipsMap.get(brackets.lowerCUSIP);
  const upperBondS = tipsMap.get(brackets.upperCUSIP);
  const lowerCostPerBond = (lowerBondS?.price ?? 0) / 100 * (refCPI / (lowerBondS?.baseCpi ?? refCPI)) * 1000;
  const upperCostPerBond = (upperBondS?.price ?? 0) / 100 * (refCPI / (upperBondS?.baseCpi ?? refCPI)) * 1000;

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
    newLowerCostPerBond3 = (nlBond?.price ?? 0) / 100 * (refCPI / (nlBond?.baseCpi ?? refCPI)) * 1000;
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
  for (let i = holdings.length - 1; i >= 0; i--) {
    const h = holdings[i];
    const isLast = (yearInfo[h.year].lastIdx === i);
    let lmi = 0;
    for (const y in outLMI) if (parseInt(y) > h.year) lmi += outLMI[y];

    let fy='', pFY=0, iFY=0, aFY=0, cFY=0, tQ=0, qD=0, tC=0, cD=0, aB=0, aA=0;
    if (isLast) {
      fy = h.year;
      for (const oh of yearInfo[h.year].holdings) {
        const b = tipsMap.get(oh.cusip);
        const ir = refCPI / (b?.baseCpi ?? refCPI);
        const ap = 1000 * ir;
        const m = oh.maturity.getMonth() + 1;
        pFY += oh.qty * ap; iFY += oh.qty * ap * b.coupon * (m < 7 ? 0.5 : 1.0);
        cFY += oh.qty * (b.price / 100 * ir * 1000);
      }
      iFY += lmi; aFY = pFY + iFY; aB = beforeARAByYear[h.year]; aA = postARAByYear[h.year];
    }

    const b = tipsMap.get(h.cusip);
    const ir = refCPI / (b?.baseCpi ?? refCPI);
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
    // exB: prior excess at this bracket year.
    // - future30y cover and years > lastYear: cost-based formula (no import data for these).
    // - standard gap brackets ≤ lastYear: use h.excessQty from the import (Format 4/5); 0 if absent.
    const exB = isBT && cpbHere > 0
      ? (h.year > lastYear || future30yCoverYearSet.has(h.year))
        ? Math.round((bracketExcessTargetCost[h.year] || 0) / cpbHere)
        : (h.excessQty ?? 0)
      : 0;
    const exA = isBT ? tQ - tFundedYearQty : 0;
    
    const bForLMI = tipsMap.get(h.cusip);
    const irForLMI = refCPI / (bForLMI?.baseCpi ?? refCPI);
    const annIntPerBond = 1000 * irForLMI * (bForLMI?.coupon ?? 0);
    const excessLMI_B = exB * annIntPerBond;
    const excessLMI_A = exA * annIntPerBond;

    const piPB = calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap);

    details.unshift({
      cusip: h.cusip, maturityStr: fmtDate(h.maturity), fundedYear: h.year,
      coupon: b.coupon, yield: b.yield, price: b.price, baseCpi: b.baseCpi, refCPI, indexRatio: ir,
      principalPerBond: 1000 * ir, costPerBond: (b.price / 100 * ir * 1000),
      DARA: daraByYear?.get(h.year) ?? DARA,
      qtyBefore: h.qty, qtyAfter: tQ,
      fundedYearQtyBefore: isBT ? Math.max(0, h.qty - exB) : h.qty,
      fundedYearQtyAfter: tFundedYearQty,
      isBracketTarget: isBT, isFuture30yCover: isBT && future30yCoverYearSet.has(h.year),
      excessQtyBefore: exB, excessQtyAfter: exA,
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
      preLadderCreditForYear: isLast ? (postARABreakdown[h.year]?.pliCredit ?? 0) : null,
      nPeriods: (h.maturity.getMonth() + 1 < 7 ? 1 : 2)
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

  // Emit synthetic rows for bracket/buy years with no current holdings (e.g. 3-bracket newLowerYear)
  for (const [bYearStr, bst] of Object.entries(buySellTargets)) {
    const bYear = parseInt(bYearStr);
    if ((yearInfo[bYear]?.holdings?.length ?? 0) > 0) continue; // has holdings → already in main loop
    if (!(bst.qtyDelta > 0)) continue; // no buy
    const tb = tipsMap.get(bst.targetCUSIP);
    if (!tb?.maturity) continue;
    const ir = refCPI / (tb.baseCpi ?? refCPI);
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
    const irForSyn = refCPI / (bondForSyn?.baseCpi ?? refCPI);
    const excessLMI = exA * 1000 * irForSyn * (bondForSyn?.coupon ?? 0);
    
    const holdingsAfterSyn = [{ 
      cusip: bst.targetCUSIP, maturityMonth: m - 1, maturityYear: tb.maturity.getFullYear(), 
      qty: bst.targetFundedYearQty, principalPerBond: 1000 * ir, nPeriods: m < 7 ? 1 : 2, coupon: tb.coupon ?? 0 
    }];

    const newDetail = {
      cusip: bst.targetCUSIP, maturityStr: fmtDate(tb.maturity), fundedYear: bYear,
      coupon: tb.coupon, price: tb.price, baseCpi: tb.baseCpi, refCPI, indexRatio: ir,
      principalPerBond: 1000 * ir, costPerBond: cpb, DARA: rowDARA,
      qtyBefore: 0, qtyAfter: bst.targetQty,
      fundedYearQtyBefore: 0, fundedYearQtyAfter: bst.targetFundedYearQty,
      isBracketTarget: bst.isBracket, isFuture30yCover: bst.isBracket && future30yCoverYearSet.has(bYear), excessQtyBefore: 0, excessQtyAfter: exA,
      excessLMI_Before: 0, excessLMI_After: excessLMI,
      araBeforeTotal: araB, araAfterTotal: araA,
      araBeforePrincipal: 0, araBeforeOwnCoupon: 0, araBeforeLaterMatInt: lmiBefore,
      araBeforeHoldings: [],
      araAfterPrincipal: bst.targetFundedYearQty * 1000 * ir,
      araAfterOwnCoupon: bst.targetFundedYearQty * 1000 * ir * tb.coupon * (m < 7 ? 0.5 : 1.0),
      araAfterLaterMatInt: yearLaterMatIntSnapshot[bYear] ?? 0,
      araAfterHoldings: holdingsAfterSyn,
      preLadderCreditForYear: pliCreditByFundedYear[bYear] ?? 0,
      nPeriods: m < 7 ? 1 : 2,
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

  const costDeltaSum = results.reduce((s, r) => s + (typeof r[11] === 'number' ? r[11] : 0), 0);
  const costForNewRungs = Object.values(buySellTargets).reduce((s, bst) => s + (bst.isBracket ? 0 : Math.max(0, bst.targetCost)), 0);
  const gapCoverageSurplus = totalPreviousExcessCost - costForNewRungs - (gapParams.totalCost || 0);

  const HDR = ['CUSIP','Qty','Maturity','FY','Principal','Interest','ARA','Cost','Target Qty','Qty Delta','Target Cost','Cost Delta','ARA (Before)','ARA-DARA Before','ARA (After)','ARA-DARA After','Excess ARA Before','Excess ARA After','Incoming LMI','Excess Interest','Funded PI'];
  
  return { results, HDR, summary: { settleDateDisp, refCPI, DARA, inferredDARA, daraIsInferred: dara === null, method, firstYear, lastYear, derivedFirstYear, rungCount, gapYears, future30yYears, brackets, lowerWeight, upperWeight, costDeltaSum, costForNewRungs, gapCoverageSurplus, gapParams, bracketMode, lowerDuration, upperDuration, newLowerYear, newLowerCUSIP, newLowerDuration, newLowerWeight3, origLowerWeight, bracketFellBack3to2, beforeLowerWeight, beforeUpperWeight, beforeNewLowerWeight, afterLowerWeight, afterUpperWeight, afterNewLowerWeight, totalPreviousExcessCost, totalExcessCost, araByYear, future30yLowerYear, future30yUpperYear, future30yLowerCoverCUSIP: future30yLowerCoverBond?.cusip, future30yUpperCoverCUSIP: future30yUpperCoverBond?.cusip, future30yParams, future30yLowerDuration, future30yUpperDuration, future30yUpperWeight, future30yLowerWeight, future30yUpperExQty, future30yLowerExQty, future30yFellBack, preLadderInterest, preLadderPool, zeroedFundedYears: [...zeroedFundedYears].sort((a, b) => a - b) }, details };
}

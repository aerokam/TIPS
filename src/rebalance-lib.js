// TIPS Ladder Rebalancing — browser-compatible ES module
// Pure computation only — no Node.js I/O, no file system, no CLI.
//
// Entry point:  runRebalance({ dara, method, holdings, tipsMap, refCPI, settlementDate })
// Data loading: buildTipsMapFromYields(rows) — build tipsMap from TipsYields.csv rows
// Spec: knowledge/4.0_TIPS_Ladder_Rebalancing.md

import { bondCalcs, calculateMDuration, rungAmount } from './bond-math.js';
import { interpolateYield, syntheticCoupon, bracketWeights, bracketWeights3, bracketExcessQtys, fyQty as _fyQty, laterMatIntContribution } from './gap-math.js';

// Re-export bond-math functions that external callers depend on
export { calculateDuration, calculateMDuration, getNumPeriods } from './bond-math.js';

// ─── Configuration ────────────────────────────────────────────────────────────
export const LOWEST_LOWER_BRACKET_YEAR = 2032;

// ─── Date helpers ─────────────────────────────────────────────────────────────
export function localDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toDateStr(date) {
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
}

export function fmtDate(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const y = String(date.getFullYear()).slice(2);
  return `${m}/${d}/${y}`;
}

// ─── Build tipsMap from TipsYields.csv rows ───────────────────────────────────
// Each row: { settlementDate, cusip, maturity (string), coupon, baseCpi, price, yield }
// Returns Map keyed by CUSIP.
export function buildTipsMapFromYields(rows) {
  const map = new Map();
  for (const r of rows) {
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

// ─── Yield from price (actual/actual, matches Excel YIELD(...,2,1)) ───────────
export function yieldFromPrice(cleanPrice, coupon, settleDateStr, maturityStr) {
  if (!cleanPrice || cleanPrice <= 0) return null;
  const settle = localDate(settleDateStr);
  const mature = localDate(maturityStr);
  if (settle >= mature) return null;

  const semiCoupon = (coupon / 2) * 100;
  const matMon = mature.getMonth() + 1;
  const cm1 = matMon <= 6 ? matMon : matMon - 6;
  const cm2 = cm1 + 6;

  function nextCouponOnOrAfter(d) {
    const candidates = [];
    for (let y = d.getFullYear() - 1; y <= d.getFullYear() + 1; y++) {
      candidates.push(new Date(y, cm1 - 1, 15));
      candidates.push(new Date(y, cm2 - 1, 15));
    }
    candidates.sort((a, b) => a - b);
    return candidates.find(c => c >= d && c <= mature) || null;
  }

  const nextCoupon = nextCouponOnOrAfter(settle);
  if (!nextCoupon) return null;
  const lastCoupon = new Date(nextCoupon.getFullYear(), nextCoupon.getMonth() - 6, 15);

  const days = (a, b) => (b - a) / 86400000;
  const E = days(lastCoupon, nextCoupon);
  const A = days(lastCoupon, settle);
  const DSC = days(settle, nextCoupon);
  const accrued = semiCoupon * (A / E);
  const dirtyPrice = cleanPrice + accrued;
  const w = DSC / E;

  const coupons = [];
  let d = new Date(nextCoupon);
  while (d <= mature) {
    coupons.push(new Date(d));
    d = new Date(d.getFullYear(), d.getMonth() + 6, 15);
  }
  const N = coupons.length;
  if (N === 0) return null;

  function pv(y) {
    const r = y / 2;
    let s = 0;
    for (let k = 0; k < N; k++) {
      const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
      s += cf / Math.pow(1 + r, w + k);
    }
    return s;
  }
  function dpv(y) {
    const r = y / 2;
    let s = 0;
    for (let k = 0; k < N; k++) {
      const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
      s += (-cf * (w + k)) / (2 * Math.pow(1 + r, w + k + 1));
    }
    return s;
  }

  let y = coupon > 0.005 ? coupon : 0.02;
  for (let i = 0; i < 200; i++) {
    const diff = pv(y) - dirtyPrice;
    if (Math.abs(diff) < 1e-10) break;
    const deriv = dpv(y);
    if (Math.abs(deriv) < 1e-15) break;
    y -= diff / deriv;
  }
  return y;
}

// ─── P+I per bond ─────────────────────────────────────────────────────────────
export function calculatePIPerBond(cusip, maturity, refCPI, tipsMap) {
  const bond = tipsMap.get(cusip);
  if (!bond) {
    // fallback: no bond data, return face value only
    return 1000;
  }
  // Use maturity date from argument (may differ from bond.maturity in edge cases)
  const bondWithMaturity = { ...bond, maturity: new Date(maturity) };
  return bondCalcs(bondWithMaturity, refCPI).piPerBond;
}

// ─── Gap parameters ───────────────────────────────────────────────────────────
export function calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings) {
  const holdingsByYear = {};
  for (const h of holdings) {
    if (!holdingsByYear[h.year]) holdingsByYear[h.year] = [];
    holdingsByYear[h.year].push(h);
  }

  let laterMaturityFrom2041Plus = 0;
  for (const year in holdingsByYear) {
    if (parseInt(year) > 2040) {
      for (const h of holdingsByYear[year]) {
        const bond = tipsMap.get(h.cusip);
        const coupon = bond?.coupon ?? 0;
        const baseCpi = bond?.baseCpi ?? refCPI;
        const indexRatio = refCPI / baseCpi;
        laterMaturityFrom2041Plus += h.qty * 1000 * indexRatio * coupon;
      }
    }
  }

  const tips2040 = holdingsByYear[2040] ? holdingsByYear[2040][0] : null;
  if (!tips2040) throw new Error('No holdings found for 2040');

  const piPerBond2040 = calculatePIPerBond(tips2040.cusip, tips2040.maturity, refCPI, tipsMap);
  const targetQty2040 = Math.round((DARA - laterMaturityFrom2041Plus) / piPerBond2040);

  const bond2040 = tipsMap.get(tips2040.cusip);
  const coupon2040 = bond2040?.coupon ?? 0;
  const baseCpi2040 = bond2040?.baseCpi ?? refCPI;
  const indexRatio2040 = refCPI / baseCpi2040;
  const annualInterest2040 = targetQty2040 * 1000 * indexRatio2040 * coupon2040;

  const gapLaterMaturityInterest = { 2040: annualInterest2040 };
  for (const year in holdingsByYear) {
    if (parseInt(year) > 2040) {
      gapLaterMaturityInterest[year] = 0;
      for (const h of holdingsByYear[year]) {
        const bond = tipsMap.get(h.cusip);
        const coupon = bond?.coupon ?? 0;
        const baseCpi = bond?.baseCpi ?? refCPI;
        const indexRatio = refCPI / baseCpi;
        gapLaterMaturityInterest[year] += h.qty * 1000 * indexRatio * coupon;
      }
    }
  }

  const minGapYear = Math.min(...gapYears);
  const maxGapYear = Math.max(...gapYears);
  let anchorBefore = null, anchorAfter = null;

  for (const bond of tipsMap.values()) {
    if (!bond.maturity || !bond.yield) continue;
    const year  = bond.maturity.getFullYear();
    const month = bond.maturity.getMonth() + 1;
    if (year === minGapYear - 1 && month === 1) {
      anchorBefore = { maturity: bond.maturity, yield: bond.yield };
    }
    if (year === maxGapYear + 1 && month === 2) {
      anchorAfter = { maturity: bond.maturity, yield: bond.yield };
    }
  }
  if (!anchorBefore || !anchorAfter) throw new Error('Could not find interpolation anchors for gap years');

  let totalDuration = 0, totalCost = 0, count = 0;
  for (const year of [...gapYears].sort((a, b) => b - a)) {
    const syntheticMat = new Date(year, 1, 15);
    const syntheticYield = interpolateYield(anchorBefore, { maturity: anchorAfter.maturity, yield: anchorAfter.yield }, syntheticMat);
    const synCpn = syntheticCoupon(syntheticYield);

    totalDuration += calculateMDuration(settlementDate, syntheticMat, synCpn, syntheticYield);

    let sumLaterMaturityInterest = 0;
    for (const futYear in gapLaterMaturityInterest) {
      if (parseInt(futYear) > year) sumLaterMaturityInterest += gapLaterMaturityInterest[futYear];
    }

    const piPerBond = 1000 + 1000 * synCpn * 0.5;
    const qty = Math.round((DARA - sumLaterMaturityInterest) / piPerBond);
    totalCost += qty * 1000;
    count++;
  }

  return { avgDuration: totalDuration / count, totalCost };
}

// ─── Identify brackets ────────────────────────────────────────────────────────
export function identifyBrackets(gapYears, holdings, yearInfo) {
  const upperYear = 2040;
  let upperMaturity = null, upperCUSIP = null, maxQty = 0;
  if (yearInfo[upperYear]) {
    for (const h of yearInfo[upperYear].holdings) {
      if (h.qty > maxQty) { maxQty = h.qty; upperMaturity = h.maturity; upperCUSIP = h.cusip; }
    }
  }

  const minGapYear = Math.min(...gapYears);
  let lowerYear = null, lowerMaturity = null, lowerCUSIP = null;
  maxQty = 0;

  for (const h of holdings) {
    if (h.year >= LOWEST_LOWER_BRACKET_YEAR && h.year < minGapYear && h.qty > maxQty) {
      maxQty = h.qty; lowerYear = h.year; lowerMaturity = h.maturity; lowerCUSIP = h.cusip;
    }
  }

  if (!lowerYear) {
    throw new Error(`Could not find lower bracket between ${LOWEST_LOWER_BRACKET_YEAR} and ${minGapYear - 1}`);
  }

  return { lowerYear, lowerMaturity, lowerCUSIP, upperYear, upperMaturity, upperCUSIP };
}

// ─── Main rebalance engine ────────────────────────────────────────────────────
// Inputs:
//   dara           — number or null (null → infer from holdings)
//   method         — 'Gap' or 'Full'
//   holdings       — [{ cusip, qty }]  (raw from CSV upload)
//   tipsMap        — Map from buildTipsMapFromYields()
//   refCPI         — number (from RefCPI.csv, keyed to settlement date)
//   settlementDate — Date (from TipsYields.csv settlementDate field)
//
// Returns: { results, HDR, summary }
// Binary search DARA such that full rebalance target cost ≈ current portfolio cash.
// Call this before runRebalance when method='Full' and DARA is unknown.
export function inferDARAFromCash({ holdings: holdingsRaw, tipsMap, refCPI, settlementDate }) {
  let portfolioCash = 0;
  for (const h of holdingsRaw) {
    const bond = tipsMap.get(h.cusip);
    if (!bond) continue;
    const ir = refCPI / (bond.baseCpi ?? refCPI);
    portfolioCash += h.qty * (bond.price ?? 0) / 100 * ir * 1000;
  }
  let lo = 1000, hi = 500000, foundDARA = lo;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const { summary } = runRebalance({ dara: mid, method: 'Full', holdings: holdingsRaw, tipsMap, refCPI, settlementDate });
    const delta = summary.costDeltaSum;
    if (Math.abs(delta) < 50) { foundDARA = mid; break; }
    // Only advance foundDARA when net cash is non-negative (feasible side)
    if (delta >= 0) { lo = mid; foundDARA = mid; } else hi = mid;
  }
  return { dara: foundDARA, portfolioCash };
}


// Spec: knowledge/4.0_TIPS_Ladder_Rebalancing.md — Algorithm Flow (Gap-Only) and Full Rebalance
export function runRebalance({ dara, method, bracketMode = '2bracket', holdings: holdingsRaw, tipsMap, refCPI, settlementDate }) {
  const settleDateStr  = toDateStr(settlementDate);
  const settleDateDisp = fmtDate(settlementDate);

  // Enrich holdings with maturity from tipsMap
  const holdings = [];
  for (const h of holdingsRaw) {
    const bond = tipsMap.get(h.cusip);
    if (!bond) {
      console.warn(`Warning: CUSIP ${h.cusip} not found in TIPS data — skipping`);
      continue;
    }
    holdings.push({
      cusip:    h.cusip,
      qty:      h.qty,
      maturity: bond.maturity,
      year:     bond.maturity.getFullYear(),
    });
  }
  holdings.sort((a, b) => a.maturity - b.maturity);

  // Build yearInfo
  const yearInfo = {};
  holdings.forEach((h, idx) => {
    if (!yearInfo[h.year]) yearInfo[h.year] = { firstIdx: idx, lastIdx: idx, holdings: [] };
    yearInfo[h.year].lastIdx = idx;
    yearInfo[h.year].holdings.push(h);
  });

  // Determine firstYear / lastYear
  const holdingsYears = Object.keys(yearInfo).map(Number).sort((a, b) => a - b);
  const firstYear = holdingsYears[0];
  let lastYear = firstYear;
  for (let i = 0; i < holdingsYears.length; i++) {
    const year = holdingsYears[i];
    if (year <= 2040) { lastYear = year; continue; }
    const nextExpected   = year + 1;
    const nextInHoldings = holdingsYears[i + 1];
    if (nextInHoldings && nextInHoldings === nextExpected) { lastYear = nextInHoldings; }
    else { lastYear = year; break; }
  }

  // Gap years: in range, no TIPS in market and no holdings
  const tipsMapYears = new Set();
  for (const bond of tipsMap.values()) {
    if (bond.maturity) tipsMapYears.add(bond.maturity.getFullYear());
  }
  const gapYears = [];
  for (let year = firstYear; year <= lastYear; year++) {
    if (!tipsMapYears.has(year) && !yearInfo[year]) gapYears.push(year);
  }

  // ARA per year (for inferred DARA and before-state display)
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
      const bond = tipsMap.get(holding.cusip);
      const coupon  = bond?.coupon  ?? 0;
      const baseCpi = bond?.baseCpi ?? refCPI;
      const indexRatio = refCPI / baseCpi;
      const adjustedPrincipal = 1000 * indexRatio;
      const adjustedAnnualInterest = adjustedPrincipal * coupon;
      const monthF = holding.maturity.getMonth() + 1;
      const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
      yearPrincipal += holding.qty * adjustedPrincipal;
      yearLastYearInterest += holding.qty * lastYearInterest;
      araLaterMaturityInterestByYear[year] += holding.qty * adjustedAnnualInterest;
    }
    araByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
  }

  // Gap years have no holdings but still receive later maturity interest from longer bonds.
  // Include their ARA in araSum so inferred DARA is not underestimated.
  for (const gapYear of gapYears) {
    let laterMatInt = 0;
    for (const y in araLaterMaturityInterestByYear) {
      if (parseInt(y) > gapYear) laterMatInt += araLaterMaturityInterestByYear[y];
    }
    araByYear[gapYear] = laterMatInt;
  }

  let araSum = 0;
  for (let year = firstYear; year <= lastYear; year++) {
    if (araByYear[year] !== undefined) araSum += araByYear[year];
  }
  const rungCount    = lastYear - firstYear + 1;
  const inferredDARA = araSum / rungCount;
  const isFullMode   = (method === 'Full');
  const DARA         = dara !== null ? dara : inferredDARA;

  // Phase 2: Gap parameters
  const gapParams = calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings);

  // Phase 3a: Brackets + durations + weights
  const brackets      = identifyBrackets(gapYears, holdings, yearInfo);
  const lowerBond     = tipsMap.get(brackets.lowerCUSIP);
  const upperBond     = tipsMap.get(brackets.upperCUSIP);
  const lowerDuration = calculateMDuration(settlementDate, brackets.lowerMaturity,
    lowerBond?.coupon ?? 0, lowerBond?.yield ?? 0);
  const upperDuration = calculateMDuration(settlementDate, brackets.upperMaturity,
    upperBond?.coupon ?? 0, upperBond?.yield ?? 0);
  const minGapYear  = Math.min(...gapYears);
  const is3Bracket = bracketMode === '3bracket';
  let newLowerYear = null, newLowerCUSIP = null, newLowerMaturity = null, newLowerDuration = 0;
  if (is3Bracket) {
    for (const [_cusip, _bond] of tipsMap.entries()) {
      if (!_bond.maturity) continue;
      if (_bond.maturity.getFullYear() === minGapYear - 1 && _bond.maturity.getMonth() + 1 === 1) {
        newLowerCUSIP = _cusip; newLowerMaturity = _bond.maturity; newLowerYear = _bond.maturity.getFullYear(); break;
      }
    }
    if (!newLowerCUSIP) throw new Error('3-bracket: no Jan TIPS for ' + (minGapYear - 1));
    const _nlBond = tipsMap.get(newLowerCUSIP);
    newLowerDuration = calculateMDuration(settlementDate, newLowerMaturity, _nlBond?.coupon ?? 0, _nlBond?.yield ?? 0);
  }
  let lowerWeight, upperWeight, origLowerWeight, newLowerWeight3, upperWeight3;

  // Phase 3b: Before-state bracket excess (display only)
  const bracketYearSet = is3Bracket
    ? new Set([brackets.lowerYear, brackets.upperYear, newLowerYear])
    : new Set([brackets.lowerYear, brackets.upperYear]);
  const gapYearSet = new Set(gapYears);

  const bracketTargetFYQtyBefore = {};
  const _bracketTriplets = [
    [brackets.lowerYear, brackets.lowerCUSIP, brackets.lowerMaturity],
    [brackets.upperYear, brackets.upperCUSIP, brackets.upperMaturity],
    ...(is3Bracket ? [[newLowerYear, newLowerCUSIP, newLowerMaturity]] : []),
  ];
  for (const [bracketYear, bracketCUSIP, bracketMaturity] of _bracketTriplets) {
    let laterMatIntBefore = 0;
    for (const y in araLaterMaturityInterestByYear) {
      if (parseInt(y) > bracketYear) laterMatIntBefore += araLaterMaturityInterestByYear[y];
    }
    const yh = yearInfo[bracketYear].holdings;
    let tFYQty;
    if (yh.length === 1) {
      tFYQty = Math.round((DARA - laterMatIntBefore) / calculatePIPerBond(bracketCUSIP, bracketMaturity, refCPI, tipsMap));
    } else {
      let nonPI = 0;
      for (const h of yh) {
        if (h.cusip !== bracketCUSIP) nonPI += h.qty * calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap);
      }
      tFYQty = Math.round((DARA - laterMatIntBefore - nonPI) / calculatePIPerBond(bracketCUSIP, bracketMaturity, refCPI, tipsMap));
    }
    bracketTargetFYQtyBefore[bracketYear] = tFYQty;
  }

  // Phase 3c: Compute bracket weights
  if (is3Bracket) {
    const _olH   = yearInfo[brackets.lowerYear]?.holdings?.find(h => h.cusip === brackets.lowerCUSIP);
    const _olQty = _olH?.qty ?? 0;
    const _lBond = tipsMap.get(brackets.lowerCUSIP);
    const _olCPB = (_lBond?.price ?? 0) / 100 * (refCPI / (_lBond?.baseCpi ?? refCPI)) * 1000;
    const _currentOrigLowerExcess = Math.max(0, _olQty - (bracketTargetFYQtyBefore[brackets.lowerYear] ?? 0)) * _olCPB;
    const _w3 = bracketWeights3(lowerDuration, newLowerDuration, upperDuration, gapParams.avgDuration, _currentOrigLowerExcess, gapParams.totalCost);
    origLowerWeight = _w3.origLowerWeight;
    newLowerWeight3 = _w3.newLowerWeight;
    upperWeight3    = _w3.upperWeight;
    lowerWeight = origLowerWeight;
    upperWeight = upperWeight3;
  } else {
    const _w2 = bracketWeights(lowerDuration, upperDuration, gapParams.avgDuration);
    lowerWeight = _w2.lowerWeight;
    upperWeight = _w2.upperWeight;
  }

  // Phase 4: Ladder rebuild (longest to shortest)
  let rebalYearSet;
  if (isFullMode) {
    rebalYearSet = new Set(
      Object.keys(yearInfo).map(Number)
        .filter(y => y >= firstYear && y <= lastYear && !bracketYearSet.has(y) && !gapYearSet.has(y))
    );
  } else {
    rebalYearSet = new Set(
      Object.keys(yearInfo).map(Number)
        .filter(y => y > brackets.lowerYear && y < minGapYear && !bracketYearSet.has(y))
    );
  }

  const bracketExcessTarget = is3Bracket ? {
    [brackets.lowerYear]: gapParams.totalCost * origLowerWeight,
    [brackets.upperYear]: gapParams.totalCost * upperWeight3,
    [newLowerYear]:       gapParams.totalCost * newLowerWeight3,
  } : {
    [brackets.lowerYear]: gapParams.totalCost * lowerWeight,
    [brackets.upperYear]: gapParams.totalCost * upperWeight,
  };

  const buySellTargets  = {};
  const nonTargetSells  = {}; // non-latest bonds sold in multi-bond years
  const postRebalQtyMap = {};
  for (const h of holdings) postRebalQtyMap[h.cusip] = h.qty;

  let rebuildLaterMatInt = 0;
  const yearLaterMatIntSnapshot = {};
  let costForNewRungs = 0;

  for (const year of allYearsSorted) {
    if (gapYearSet.has(year)) continue;

    yearLaterMatIntSnapshot[year] = rebuildLaterMatInt;

    const yi        = yearInfo[year];
    const isBracket = bracketYearSet.has(year);
    const isRebal   = rebalYearSet.has(year);

    // Select target CUSIP: bracket years use bracket CUSIP; non-bracket use latest maturity
    let targetCUSIP, targetMaturity;
    if (isBracket) {
      targetCUSIP = year === brackets.lowerYear ? brackets.lowerCUSIP
                  : year === brackets.upperYear ? brackets.upperCUSIP
                  : newLowerCUSIP;
      const _bh = yi.holdings.find(h => h.cusip === targetCUSIP);
      targetMaturity = _bh ? _bh.maturity : null;
    } else {
      targetCUSIP = null; targetMaturity = null;
      for (const h of yi.holdings) {
        if (!targetMaturity || h.maturity > targetMaturity) {
          targetMaturity = h.maturity; targetCUSIP = h.cusip;
        }
      }
    }

    const targetBondR  = tipsMap.get(targetCUSIP);
    const tPrice       = targetBondR?.price ?? 0;
    const tBaseCpi     = targetBondR?.baseCpi ?? refCPI;
    const tIndexRatio  = refCPI / tBaseCpi;
    const costPerBond  = tPrice / 100 * tIndexRatio * 1000;

    const currentHolding = yi.holdings.find(h => h.cusip === targetCUSIP);
    const currentQty     = currentHolding ? currentHolding.qty : 0;

    let targetFYQty, postRebalQty;

    if (isBracket || isRebal) {
      const totalPINeeded = DARA - rebuildLaterMatInt;

      if (yi.holdings.length === 1) {
        // Issue 1: clamp — can't sell more than owned
        targetFYQty = Math.max(0, Math.round(totalPINeeded / calculatePIPerBond(targetCUSIP, targetMaturity, refCPI, tipsMap)));
      } else {
        // Multi-bond year
        const sortedH  = [...yi.holdings].sort((a, b) => a.maturity - b.maturity);
        // nonTarget: all CUSIPs except the target (bracket CUSIP or latest maturity), sorted earliest first
        const nonTarget = sortedH.filter(h => h.cusip !== targetCUSIP);

        const piMap = {};
        for (const h of yi.holdings)
          piMap[h.cusip] = calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap);

        if (isFullMode) {
          // Minimum trades: no selling earlier to fund buying later.
          // Over-funded → sell non-target from earliest, then target as last resort. No buying.
          // Under-funded → buy target only. No selling.
          let totalCurrentOwnPI = 0;
          for (const h of sortedH) totalCurrentOwnPI += h.qty * piMap[h.cusip];
          const diff = totalCurrentOwnPI - totalPINeeded;

          targetFYQty = currentQty; // default: no change to target

          if (diff > 0) {
            // Over-funded: sell non-target from earliest first
            let remaining = diff;
            for (const h of nonTarget) {
              if (remaining <= 0) break;
              const piThis = h.qty * piMap[h.cusip];
              if (piThis <= remaining) {
                postRebalQtyMap[h.cusip] = 0;
                remaining -= piThis;
              } else {
                const sellQty = Math.round(remaining / piMap[h.cusip]);
                postRebalQtyMap[h.cusip] = h.qty - sellQty;
                remaining = 0;
              }
            }
            // Sell target only if still over after all non-target sold
            if (remaining > 0) {
              const sellQty = Math.round(remaining / piMap[targetCUSIP]);
              targetFYQty = Math.max(0, currentQty - sellQty);
            }
          } else if (diff < 0) {
            // Under-funded: buy target only, no selling
            const buyQty = Math.round(-diff / piMap[targetCUSIP]);
            targetFYQty = currentQty + buyQty;
          }
        } else {
          // Gap-only: hold non-target constant, size target CUSIP for residual
          let nonTargetPI = 0;
          for (const h of nonTarget) nonTargetPI += h.qty * piMap[h.cusip];
          targetFYQty = Math.round((totalPINeeded - nonTargetPI) / piMap[targetCUSIP]);
        }

        // Record qty changes for non-target bonds
        for (const h of nonTarget) {
          const newQ = postRebalQtyMap[h.cusip];
          if (newQ !== h.qty) {
            const bond = tipsMap.get(h.cusip);
            const hCPB = (bond?.price ?? 0) / 100 * (refCPI / (bond?.baseCpi ?? refCPI)) * 1000;
            nonTargetSells[h.cusip] = {
              newQty:     newQ,
              qtyDelta:   newQ - h.qty,
              costDelta:  -((newQ - h.qty) * hCPB),
              targetCost: newQ * hCPB,
            };
            if (isRebal) costForNewRungs += -nonTargetSells[h.cusip].costDelta;
          }
        }
      }

      postRebalQty = isBracket
        ? targetFYQty + Math.max(0, Math.round(bracketExcessTarget[year] / costPerBond))
        : targetFYQty;

      buySellTargets[year] = {
        targetCUSIP, targetFYQty,
        targetQty: postRebalQty, postRebalQty, qtyDelta: postRebalQty - currentQty,
        targetCost:        targetFYQty * costPerBond,
        costDelta:         -((postRebalQty - currentQty) * costPerBond),
        costPerBond, isBracket,
        currentExcessCost: isBracket
          ? (currentQty - bracketTargetFYQtyBefore[year]) * costPerBond
          : undefined,
      };
      if (isRebal) costForNewRungs += -buySellTargets[year].costDelta;
    } else {
      targetFYQty  = currentQty;
      postRebalQty = currentQty;
    }

    postRebalQtyMap[targetCUSIP] = postRebalQty;
    for (const h of yi.holdings) {
      const bond = tipsMap.get(h.cusip);
      if (!bond) continue;
      const { annualInt } = bondCalcs(bond, refCPI);
      rebuildLaterMatInt += laterMatIntContribution(postRebalQtyMap[h.cusip], annualInt);
    }
  }

  // Before ARA
  const beforeARAByYear = {};
  const beforeARACompByYear = {};
  for (const year of allYearsSorted) {
    let laterMatInt = 0;
    for (const y in araLaterMaturityInterestByYear) {
      if (parseInt(y) > year) laterMatInt += araLaterMaturityInterestByYear[y];
    }
    let yearPrincipal = 0, yearLastYearInterest = 0;
    for (const holding of yearInfo[year].holdings) {
      const bond = tipsMap.get(holding.cusip);
      const coupon  = bond?.coupon  ?? 0;
      const baseCpi = bond?.baseCpi ?? refCPI;
      const indexRatio = refCPI / baseCpi;
      const adjustedPrincipal = 1000 * indexRatio;
      const adjustedAnnualInterest = adjustedPrincipal * coupon;
      const monthF = holding.maturity.getMonth() + 1;
      const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
      const isBracketTarget = bracketYearSet.has(year) && holding.cusip === buySellTargets[year]?.targetCUSIP;
      const qtyForARA = isBracketTarget ? bracketTargetFYQtyBefore[year] : holding.qty;
      yearPrincipal        += qtyForARA * adjustedPrincipal;
      yearLastYearInterest += qtyForARA * lastYearInterest;
    }
    beforeARAByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
    beforeARACompByYear[year] = { principal: yearPrincipal, ownCoupon: yearLastYearInterest, laterMatInt };
  }

  // After ARA
  const postARAByYear = {};
  const afterARACompByYear = {};
  for (const year of allYearsSorted) {
    const laterMatInt = yearLaterMatIntSnapshot[year] ?? 0;
    let yearPrincipal = 0, yearLastYearInterest = 0;
    for (const holding of yearInfo[year].holdings) {
      const bond = tipsMap.get(holding.cusip);
      const coupon  = bond?.coupon  ?? 0;
      const baseCpi = bond?.baseCpi ?? refCPI;
      const indexRatio = refCPI / baseCpi;
      const adjustedPrincipal = 1000 * indexRatio;
      const adjustedAnnualInterest = adjustedPrincipal * coupon;
      const monthF = holding.maturity.getMonth() + 1;
      const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
      const bt = buySellTargets[year];
      let qtyForARA;
      if (bt && holding.cusip === bt.targetCUSIP) {
        qtyForARA = bt.isBracket ? bt.targetFYQty : bt.postRebalQty;
      } else {
        qtyForARA = postRebalQtyMap[holding.cusip];
      }
      yearPrincipal        += qtyForARA * adjustedPrincipal;
      yearLastYearInterest += qtyForARA * lastYearInterest;
    }
    postARAByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
    afterARACompByYear[year] = { principal: yearPrincipal, ownCoupon: yearLastYearInterest, laterMatInt };
  }

  // Build result rows
  const results = [];
  const details = [];
  const outputLaterMaturityInterest = {};

  for (let i = holdings.length - 1; i >= 0; i--) {
    const h = holdings[i];
    const isLastInYear = (yearInfo[h.year].lastIdx === i);

    let sumLaterMaturityAnnualInterest = 0;
    for (const year in outputLaterMaturityInterest) {
      if (parseInt(year) > h.year) sumLaterMaturityAnnualInterest += outputLaterMaturityInterest[year];
    }

    let fy = '', principalFY = '', interestFY = '', araFY = '', costFY = '';
    let targetQty = '', qtyDelta = '', targetCost = '', costDelta = '';
    let araBeforeFY = '', araMinusDaraBefore = '', araAfterFY = '', araMinusDaraAfter = '';

    if (isLastInYear) {
      let yearPrincipal = 0, yearLastYearInterest = 0, yearCost = 0;
      for (const holding of yearInfo[h.year].holdings) {
        const bond = tipsMap.get(holding.cusip);
        const coupon  = bond?.coupon  ?? 0;
        const price   = bond?.price   ?? 0;
        const baseCpi = bond?.baseCpi ?? refCPI;
        const indexRatio = refCPI / baseCpi;
        const adjustedPrincipal = 1000 * indexRatio;
        yearPrincipal += holding.qty * adjustedPrincipal;
        const adjustedAnnualInterest = adjustedPrincipal * coupon;
        const monthF = holding.maturity.getMonth() + 1;
        const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
        yearLastYearInterest += holding.qty * lastYearInterest;
        yearCost += holding.qty * (price / 100 * indexRatio * 1000);
      }
      fy              = h.year;
      principalFY     = yearPrincipal;
      interestFY      = yearLastYearInterest + sumLaterMaturityAnnualInterest;
      araFY           = principalFY + interestFY;
      costFY          = yearCost;
      araBeforeFY        = beforeARAByYear[h.year];
      araMinusDaraBefore = araBeforeFY - DARA;
      araAfterFY         = postARAByYear[h.year];
      araMinusDaraAfter  = araAfterFY - DARA;
    }

    if (buySellTargets[h.year] && h.cusip === buySellTargets[h.year].targetCUSIP) {
      targetQty  = buySellTargets[h.year].targetQty;
      qtyDelta   = buySellTargets[h.year].qtyDelta;
      targetCost = buySellTargets[h.year].targetCost;
      costDelta  = buySellTargets[h.year].costDelta;
    } else if (nonTargetSells[h.cusip]) {
      const s    = nonTargetSells[h.cusip];
      targetQty  = s.newQty;
      qtyDelta   = s.qtyDelta;
      targetCost = s.targetCost;
      costDelta  = s.costDelta;
    }

    const bond = tipsMap.get(h.cusip);
    const coupon  = bond?.coupon  ?? 0;
    const baseCpi = bond?.baseCpi ?? refCPI;
    const indexRatio = refCPI / baseCpi;
    if (!outputLaterMaturityInterest[h.year]) outputLaterMaturityInterest[h.year] = 0;
    outputLaterMaturityInterest[h.year] += h.qty * 1000 * indexRatio * coupon;

    const monthFX     = h.maturity.getMonth() + 1;
    const nPerFX      = monthFX < 7 ? 1 : 2;
    const piPerBondFX = 1000 * indexRatio * (1 + coupon / 2 * nPerFX);

    let excessBefore = '', excessAfter = '';
    const bt = buySellTargets[h.year];
    if (bt?.isBracket && h.cusip === bt.targetCUSIP) {
      // new lower bracket had no excess designation before → clamp to 0
      const exQtyBef = Math.max(0, h.qty - (bracketTargetFYQtyBefore[h.year] ?? 0));
      const exQtyAft = bt.postRebalQty - bt.targetFYQty;
      excessBefore = exQtyBef * piPerBondFX;
      excessAfter  = exQtyAft * piPerBondFX;
    }

    // ── Detail for drill-down ──────────────────────────────────────────────────
        {
          const dBond    = tipsMap.get(h.cusip);
          const dCoupon  = dBond?.coupon  ?? 0;
          const dPrice   = dBond?.price   ?? 0;
          const dBase    = dBond?.baseCpi ?? refCPI;
          const dIR      = Math.round(refCPI / dBase * 1e5) / 1e5;
          const dPPB     = 1000 * dIR;
          const dCPB     = dPrice / 100 * dIR * 1000;
          const dMonthF  = h.maturity.getMonth() + 1;
          const dNPer    = dMonthF < 7 ? 1 : 2;
          const dPIPB    = dPPB * (1 + dCoupon / 2 * dNPer);
          const dBT      = buySellTargets[h.year];
          const dIsBT    = !!(dBT?.isBracket && h.cusip === dBT.targetCUSIP);
          const dIsTarget= !!(dBT && h.cusip === dBT.targetCUSIP);
          const dIsNTS   = !!nonTargetSells[h.cusip];
          const dQtyAfter   = dIsTarget ? dBT.postRebalQty : dIsNTS ? nonTargetSells[h.cusip].newQty : h.qty;
          const dFYQty      = dIsTarget ? dBT.targetFYQty  : dIsNTS ? nonTargetSells[h.cusip].newQty : h.qty;
          const dExQtyBef   = dIsBT ? Math.max(0, h.qty - bracketTargetFYQtyBefore[h.year]) : 0;
          const dExQtyAft   = dIsBT ? dBT.postRebalQty - dBT.targetFYQty : 0;
          const dLast       = isLastInYear;
          const dBComp      = dLast ? beforeARACompByYear[h.year] : null;
          const dAComp      = dLast ? afterARACompByYear[h.year]  : null;
          details.unshift({
            cusip: h.cusip, maturityStr: fmtDate(h.maturity), fundedYear: h.year,
            nPeriods: dNPer, isLastInYear: dLast, isBracketTarget: dIsBT,
            coupon: dCoupon, price: dPrice, baseCpi: dBase, refCPI, indexRatio: dIR,
            principalPerBond: dPPB, costPerBond: dCPB,
            qtyBefore: h.qty, qtyAfter: dQtyAfter, fundedYearQty: dFYQty,
            excessQtyBefore: dExQtyBef, excessQtyAfter: dExQtyAft,
            excessARABefore: dIsBT ? dExQtyBef * dPIPB : 0,
            excessARAAfter:  dIsBT ? dExQtyAft * dPIPB : 0,
            DARA,
            araBeforePrincipal:   dBComp?.principal   ?? null,
            araBeforeOwnCoupon:   dBComp?.ownCoupon   ?? null,
            araBeforeLaterMatInt: dBComp?.laterMatInt ?? null,
            araBeforeTotal:       dLast ? beforeARAByYear[h.year] : null,
            araAfterPrincipal:    dAComp?.principal   ?? null,
            araAfterOwnCoupon:    dAComp?.ownCoupon   ?? null,
            araAfterLaterMatInt:  dAComp?.laterMatInt ?? null,
            araAfterTotal:        dLast ? postARAByYear[h.year]   : null,
          });
        }
        results.unshift([
          h.cusip, h.qty, fmtDate(h.maturity), fy,
      principalFY, interestFY, araFY, costFY,
      targetQty, qtyDelta, targetCost, costDelta,
      araBeforeFY, araMinusDaraBefore, araAfterFY, araMinusDaraAfter,
      excessBefore, excessAfter,
    ]);
  }

  const costDeltaSum = results.reduce((sum, row) => sum + (typeof row[11] === 'number' ? row[11] : 0), 0);

  // Weight summary
  const lowerBondS = tipsMap.get(brackets.lowerCUSIP);
  const upperBondS = tipsMap.get(brackets.upperCUSIP);
  const lowerCostPerBond = (lowerBondS?.price ?? 0) / 100 * (refCPI / (lowerBondS?.baseCpi ?? refCPI)) * 1000;
  const upperCostPerBond = (upperBondS?.price ?? 0) / 100 * (refCPI / (upperBondS?.baseCpi ?? refCPI)) * 1000;

  const lowerCurrentExcess = buySellTargets[brackets.lowerYear]?.currentExcessCost ?? 0;
  const upperCurrentExcess = buySellTargets[brackets.upperYear]?.currentExcessCost ?? 0;
  const lowerPostQty     = buySellTargets[brackets.lowerYear]?.postRebalQty ?? 0;
  const upperPostQty     = buySellTargets[brackets.upperYear]?.postRebalQty ?? 0;
  const lowerTargetFYQty = buySellTargets[brackets.lowerYear]?.targetFYQty ?? 0;
  const upperTargetFYQty = buySellTargets[brackets.upperYear]?.targetFYQty ?? 0;
  const lowerExcessQty   = lowerPostQty - lowerTargetFYQty;
  const upperExcessQty   = upperPostQty - upperTargetFYQty;
  const lowerExcessCost  = lowerExcessQty * lowerCostPerBond;
  const upperExcessCost  = upperExcessQty * upperCostPerBond;

  let newLowerCPB3 = 0, newLowerCurrentExcess3 = 0, newLowerExcessCost3 = 0;
  if (is3Bracket) {
    const nlBond = tipsMap.get(newLowerCUSIP);
    newLowerCPB3           = (nlBond?.price ?? 0) / 100 * (refCPI / (nlBond?.baseCpi ?? refCPI)) * 1000;
    newLowerCurrentExcess3 = buySellTargets[newLowerYear]?.currentExcessCost ?? 0;
    const nlPostQty        = buySellTargets[newLowerYear]?.postRebalQty ?? 0;
    const nlFYQty          = buySellTargets[newLowerYear]?.targetFYQty ?? 0;
    newLowerExcessCost3    = (nlPostQty - nlFYQty) * newLowerCPB3;
  }
  const totalCurrentExcess = lowerCurrentExcess + upperCurrentExcess + newLowerCurrentExcess3;
  const totalExcessCost    = lowerExcessCost    + upperExcessCost    + newLowerExcessCost3;

  const beforeLowerWeight    = totalCurrentExcess > 0 ? lowerCurrentExcess    / totalCurrentExcess : null;
  const beforeUpperWeight    = totalCurrentExcess > 0 ? upperCurrentExcess    / totalCurrentExcess : null;
  const beforeNewLowerWeight = is3Bracket && totalCurrentExcess > 0 ? newLowerCurrentExcess3 / totalCurrentExcess : null;
  const afterLowerWeight     = totalExcessCost > 0 ? lowerExcessCost  / totalExcessCost : null;
  const afterUpperWeight     = totalExcessCost > 0 ? upperExcessCost  / totalExcessCost : null;
  const afterNewLowerWeight  = is3Bracket && totalExcessCost > 0 ? newLowerExcessCost3 / totalExcessCost : null;
  const gapCoverageSurplus   = totalCurrentExcess - costForNewRungs - gapParams.totalCost;

  const HDR = ['CUSIP','Qty','Maturity','FY','Principal','Interest','ARA','Cost',
               'Target Qty','Qty Delta','Target Cost','Cost Delta',
               'ARA (Before)','ARA-DARA Before','ARA (After)','ARA-DARA After',
               'Excess ARA Before','Excess ARA After'];

  const summary = {
    settleDateDisp, refCPI, DARA, inferredDARA, method,
    firstYear, lastYear, rungCount, gapYears, araByYear,
    gapParams, brackets,
    lowerDuration, upperDuration, lowerWeight, upperWeight,
    bracketMode, newLowerYear, newLowerCUSIP, newLowerDuration, newLowerWeight3, origLowerWeight,
    beforeLowerWeight, beforeUpperWeight, beforeNewLowerWeight,
    afterLowerWeight, afterUpperWeight, afterNewLowerWeight,
    totalCurrentExcess, totalExcessCost,
    costDeltaSum,
    costForNewRungs, gapCoverageSurplus,
  };

  return { results, HDR, summary, details };
}

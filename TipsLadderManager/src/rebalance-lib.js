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

function identifyBrackets(gapYears, holdings, yearInfo, tipsMap, araByYear, DARA) {
  if (gapYears.length === 0) return { lowerCUSIP: null, lowerYear: null, lowerMaturity: null, upperCUSIP: null, upperYear: null, upperMaturity: null };
  const minGapYear = Math.min(...gapYears);
  const upperYear = 2040;
  const upperH = yearInfo[upperYear]?.holdings?.find(h => h.maturity.getMonth() + 1 === 2);
  const upperCUSIP = upperH?.cusip || '912810QF8';
  const upperMaturity = tipsMap.get(upperCUSIP)?.maturity || localDate(`${upperYear}-02-15`);

  const LOWEST_LOWER_BRACKET_YEAR = 2032;
  
  // Aggregate total holdings per CUSIP across all years
  const cusipTotals = new Map();
  for (const h of holdings) {
    cusipTotals.set(h.cusip, (cusipTotals.get(h.cusip) ?? 0) + h.qty);
  }

  let maxExcess = -Infinity, lowerCUSIP = null, lowerYear = null, lowerMaturity = null;

  for (const [cusip, totalQty] of cusipTotals.entries()) {
    const bond = tipsMap.get(cusip);
    if (!bond || !bond.maturity) continue;
    const y = bond.maturity.getFullYear();
    if (y >= LOWEST_LOWER_BRACKET_YEAR && y < minGapYear && totalQty > 0) {
      // Metric: Excess ARA. The bracket is the bond with the most spare capacity (ARA >> DARA).
      const excess = (araByYear[y] || 0) - DARA;
      if (excess > maxExcess || (excess === maxExcess && totalQty > (cusipTotals.get(lowerCUSIP) || -1))) {
        maxExcess = excess; lowerCUSIP = cusip; lowerYear = y; lowerMaturity = bond.maturity;
      }
    }
  }

  if (!lowerCUSIP) {
    lowerYear = minGapYear - 1;
    lowerMaturity = localDate(`${lowerYear}-01-15`);
    lowerCUSIP = '91282CEJ6';
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

function calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings, lastYear, isFullMode) {
  if (gapYears.length === 0) return { avgDuration: 0, totalCost: 0 };
  const holdingsByYear = {};
  for (const h of holdings) {
    if (!holdingsByYear[h.year]) holdingsByYear[h.year] = [];
    holdingsByYear[h.year].push(h);
  }

  let laterMaturityFrom2041Plus = 0;
  // Estimate interest from rungs > 2040
  for (let year = 2041; year <= (lastYear || 2040); year++) {
    const yi = holdingsByYear[year] || [];
    if (yi.length > 0 && !isFullMode) {
      // Use current holdings if not rebalancing everything
      for (const h of yi) {
        const bond = tipsMap.get(h.cusip);
        const coupon = bond?.coupon ?? 0;
        const baseCpi = bond?.baseCpi ?? refCPI;
        const indexRatio = refCPI / baseCpi;
        laterMaturityFrom2041Plus += h.qty * 1000 * indexRatio * coupon;
      }
    } else if (isFullMode || yi.length > 0) {
      // Estimate target rung interest
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
    if (yi.length > 0 && !isFullMode) {
      gapLaterMaturityInterest[year] = 0;
      for (const h of yi) {
        const bond = tipsMap.get(h.cusip);
        const coupon = bond?.coupon ?? 0;
        const baseCpi = bond?.baseCpi ?? refCPI;
        const indexRatio = refCPI / baseCpi;
        gapLaterMaturityInterest[year] += h.qty * 1000 * indexRatio * coupon;
      }
    } else if (isFullMode || yi.length > 0) {
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

  const minGapYear = Math.min(...gapYears);
  const maxGapYear = Math.max(...gapYears);
  let anchorBefore = null, anchorAfter = null;

  let anchorAfterYear = Infinity;
  for (const bond of tipsMap.values()) {
    if (!bond.maturity || !bond.yield) continue;
    const year  = bond.maturity.getFullYear();
    const month = bond.maturity.getMonth() + 1;
    if (year === minGapYear - 1 && month === 1) {
      anchorBefore = { maturity: bond.maturity, yield: bond.yield, baseCpi: bond.baseCpi };
    }
    if (year > maxGapYear && month === 2 && year < anchorAfterYear) {
      anchorAfter = { maturity: bond.maturity, yield: bond.yield, baseCpi: bond.baseCpi };
      anchorAfterYear = year;
    }
  }
  if (!anchorBefore || !anchorAfter) {
    console.log('anchorBefore:', anchorBefore);
    console.log('anchorAfter:', anchorAfter);
    throw new Error('Could not find interpolation anchors for gap years');
  }

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

    // Interpolate Index Ratio for synthetic TIPS based on RefCPI/BaseCPI of anchors
    const irBefore = refCPI / (anchorBefore.baseCpi || refCPI);
    const irAfter  = refCPI / (anchorAfter.baseCpi || refCPI);
    const syntheticIR = irBefore + (syntheticMat - anchorBefore.maturity) * (irAfter - irBefore) / (anchorAfter.maturity - anchorBefore.maturity);

    const piPerBond = 1000 * syntheticIR + 1000 * syntheticIR * synCpn * 0.5;
    const qty = Math.round((DARA - sumLaterMaturityInterest) / piPerBond);
    
    // Gap total cost is the sum of market costs of all gap years.
    // For synthetic TIPS, price is 100 since we're interpolating yields.
    totalCost += qty * 1000; 
    count++;
  }

  return { avgDuration: totalDuration / count, totalCost };
}

export function inferDARAFromCash({ bracketMode = '2bracket', holdings: holdingsRaw, tipsMap, refCPI, settlementDate, lastYearOverride = null }) {
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
    const { summary } = runRebalance({ dara: mid, method: 'Full', bracketMode, holdings: holdingsRaw, tipsMap, refCPI, settlementDate, lastYearOverride });
    if (summary.costDeltaSum >= 0) {
      foundDARA = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { dara: foundDARA, portfolioCash };
}

export function runRebalance({ dara, method, bracketMode = '2bracket', holdings: holdingsRaw, tipsMap, refCPI, settlementDate, daraByYear = null, lastYearOverride = null }) {
  const settleDateStr  = toDateStr(settlementDate);
  const settleDateDisp = fmtDate(settlementDate);

  const holdings = [];
  for (const h of holdingsRaw) {
    const bond = tipsMap.get(h.cusip);
    if (!bond) continue;
    holdings.push({
      cusip:    h.cusip,
      qty:      h.qty,
      maturity: bond.maturity,
      year:     bond.maturity.getFullYear(),
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
  const derivedLastYear = lastYear;  // save before override for sell-above-lastYear logic
  if (lastYearOverride != null) lastYear = lastYearOverride;

  const tipsMapYears = new Set();
  for (const bond of tipsMap.values()) {
    if (bond.maturity) tipsMapYears.add(bond.maturity.getFullYear());
  }
  const gapYears = [];
  for (let year = firstYear; year <= lastYear; year++) {
    if (!tipsMapYears.has(year) && !yearInfo[year]) gapYears.push(year);
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

  let araSum = 0;
  for (let year = firstYear; year <= lastYear; year++) {
    if (araByYear[year] !== undefined) araSum += araByYear[year];
  }
  const rungCount    = lastYear - firstYear + 1;
  const inferredDARA = araSum / rungCount;
  const isFullMode   = (method === 'Full');
  const DARA         = dara !== null ? dara : inferredDARA;

  const gapParams = calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings, lastYear, isFullMode);
  const brackets  = identifyBrackets(gapYears, holdings, yearInfo, tipsMap, araByYear, DARA);
  const lowerBond = brackets.lowerCUSIP ? tipsMap.get(brackets.lowerCUSIP) : null;
  const upperBond = brackets.upperCUSIP ? tipsMap.get(brackets.upperCUSIP) : null;
  const lowerDuration = brackets.lowerMaturity ? calculateMDuration(settlementDate, brackets.lowerMaturity, lowerBond?.coupon ?? 0, lowerBond?.yield ?? 0) : 0;
  const upperDuration = brackets.upperMaturity ? calculateMDuration(settlementDate, brackets.upperMaturity, upperBond?.coupon ?? 0, upperBond?.yield ?? 0) : 0;
  
  const minGapYear = gapYears.length > 0 ? Math.min(...gapYears) : Infinity;
  const is3Bracket = (bracketMode === '3bracket');
  let newLowerYear = null, newLowerCUSIP = null, newLowerMaturity = null, newLowerDuration = 0;
  if (is3Bracket && gapYears.length > 0) {
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

  const bracketYearSet = gapYears.length === 0 ? new Set()
    : is3Bracket ? new Set([brackets.lowerYear, brackets.upperYear, newLowerYear]) : new Set([brackets.lowerYear, brackets.upperYear]);
  const gapYearSet = new Set(gapYears);

  const bracketTargetFundedYearQtyBefore = {};
  const _triplets = gapYears.length === 0 ? []
    : [[brackets.lowerYear, brackets.lowerCUSIP, brackets.lowerMaturity], [brackets.upperYear, brackets.upperCUSIP, brackets.upperMaturity], ...(is3Bracket ? [[newLowerYear, newLowerCUSIP, newLowerMaturity]] : [])];

  for (const [bYear, bCUSIP, bMat] of _triplets) {
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

  let lowerWeight = 0, upperWeight = 0, origLowerWeight = null, newLowerWeight3 = null, upperWeight3 = null;
  let bracketFellBack3to2 = false;
  if (gapYears.length > 0) {
    if (is3Bracket) {
      const _olH = yearInfo[brackets.lowerYear]?.holdings?.find(h => h.cusip === brackets.lowerCUSIP);
      const _olBond = tipsMap.get(brackets.lowerCUSIP);
      const _olCPBReal = (_olBond?.price ?? 0) / 100 * 1000;
      const _curExReal = Math.max(0, (_olH?.qty ?? 0) - (bracketTargetFundedYearQtyBefore[brackets.lowerYear] ?? 0)) * _olCPBReal;
      
      const _w3 = bracketWeights3(lowerDuration, newLowerDuration, upperDuration, gapParams.avgDuration, _curExReal, gapParams.totalCost);
      if (_w3.origLowerWeight > 1) {
        // Orig lower excess exceeds gap total cost — fall back to 2-bracket using orig lower
        const _wFb = bracketWeights(lowerDuration, upperDuration, gapParams.avgDuration);
        origLowerWeight = _wFb.lowerWeight; newLowerWeight3 = 0; upperWeight3 = _wFb.upperWeight;
        bracketFellBack3to2 = true;
      } else {
        origLowerWeight = _w3.origLowerWeight; newLowerWeight3 = _w3.newLowerWeight; upperWeight3 = _w3.upperWeight;
      }
      lowerWeight = origLowerWeight; upperWeight = upperWeight3;
    } else {
      const _w2 = bracketWeights(lowerDuration, upperDuration, gapParams.avgDuration);
      lowerWeight = _w2.lowerWeight; upperWeight = _w2.upperWeight;
    }
  }

  let rebalYearSet = new Set();
  if (isFullMode) {
    for (let y = firstYear; y <= lastYear; y++) {
      if (!bracketYearSet.has(y) && !gapYearSet.has(y)) rebalYearSet.add(y);
    }
  } else {
    if (gapYears.length > 0) {
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
      bracketExcessTargetCost[brackets.lowerYear] = gapParams.totalCost * lowerWeight;
      bracketExcessTargetCost[brackets.upperYear] = gapParams.totalCost * upperWeight;
    }
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
    if (gapYearSet.has(year)) continue;

    const yi = yearInfo[year] || { holdings: [] };
    const isBracket = bracketYearSet.has(year);
    const isRebal = rebalYearSet.has(year);

    let targetCUSIP;
    const piMap = {};
    for (const h of yi.holdings) piMap[h.cusip] = calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap);

    if (isBracket) {
      targetCUSIP = (year === brackets.lowerYear) ? brackets.lowerCUSIP : (year === brackets.upperYear ? brackets.upperCUSIP : newLowerCUSIP);
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
    const costPerBondReal = (tBond?.price ?? 0) / 100 * 1000;
    const targetCurrentQty = yi.holdings.find(h => h.cusip === targetCUSIP)?.qty ?? 0;

    let tFundedYearQty, postQ;
    if (isBracket || isRebal) {
      const yearDara = year > lastYear ? 0 : (daraByYear?.get(year) ?? DARA);
      const needed = yearDara - rebuildLaterMatInt;
      if (isFullMode) {
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
      postQ = isBracket ? tFundedYearQty + Math.max(0, Math.round((bracketExcessTargetCost[year] || 0) / costPerBondReal)) : tFundedYearQty;
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

    const lAfter = yearLaterMatIntSnapshot[year] ?? 0;
    let pA = 0, cA = 0;
    const holdingsAfter = [];
    if (yearInfo[year]) {
      for (const h of yearInfo[year].holdings) {
        const b = tipsMap.get(h.cusip);
        const ir = refCPI / (b?.baseCpi ?? refCPI);
        const ap = 1000 * ir;
        const isBT = (bracketYearSet.has(year) && h.cusip === buySellTargets[year]?.targetCUSIP);
        const q = isBT ? buySellTargets[year].targetFundedYearQty : (postRebalQtyMap[h.cusip] ?? h.qty);
        const m = h.maturity.getMonth() + 1;
        pA += q * ap; cA += q * ap * b.coupon * (m < 7 ? 0.5 : 1.0);
        holdingsAfter.push({ cusip: h.cusip, maturityMonth: m - 1, maturityYear: h.maturity.getFullYear(), qty: q, principalPerBond: ap, nPeriods: m < 7 ? 1 : 2, coupon: b?.coupon ?? 0 });
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
          pA += _bst4.targetFundedYearQty * _ap4;
          cA += _bst4.targetFundedYearQty * _ap4 * _tb4.coupon * (_m4 < 7 ? 0.5 : 1.0);
          holdingsAfter.push({ cusip: _bst4.targetCUSIP, maturityMonth: _m4 - 1, maturityYear: _tb4.maturity.getFullYear(), qty: _bst4.targetFundedYearQty, principalPerBond: _ap4, nPeriods: _m4 < 7 ? 1 : 2, coupon: _tb4.coupon ?? 0 });
        }
      }
    }
    postARAByYear[year] = pA + cA + lAfter;
    postARABreakdown[year] = { principal: pA, ownCoupon: cA, laterMatInt: lAfter, holdings: holdingsAfter };
  }

  // Summary Metrics
  const lowerBondS = tipsMap.get(brackets.lowerCUSIP);
  const upperBondS = tipsMap.get(brackets.upperCUSIP);
  const lowerCPB = (lowerBondS?.price ?? 0) / 100 * (refCPI / (lowerBondS?.baseCpi ?? refCPI)) * 1000;
  const upperCPB = (upperBondS?.price ?? 0) / 100 * (refCPI / (upperBondS?.baseCpi ?? refCPI)) * 1000;
  const lowerCPBReal = (lowerBondS?.price ?? 0) / 100 * 1000;
  const upperCPBReal = (upperBondS?.price ?? 0) / 100 * 1000;

  const lowerCurExReal = Math.max(0, (yearInfo[brackets.lowerYear]?.holdings?.find(h=>h.cusip===brackets.lowerCUSIP)?.qty ?? 0) - (bracketTargetFundedYearQtyBefore[brackets.lowerYear] ?? 0)) * lowerCPBReal;
  const upperCurExReal = Math.max(0, (yearInfo[brackets.upperYear]?.holdings?.find(h=>h.cusip===brackets.upperCUSIP)?.qty ?? 0) - (bracketTargetFundedYearQtyBefore[brackets.upperYear] ?? 0)) * upperCPBReal;
  
  const lowerExCost = (buySellTargets[brackets.lowerYear]?.targetQty - buySellTargets[brackets.lowerYear]?.targetFundedYearQty) * lowerCPB;
  const upperExCost = (buySellTargets[brackets.upperYear]?.targetQty - buySellTargets[brackets.upperYear]?.targetFundedYearQty) * upperCPB;

  let newLowerCurExReal3 = 0, newLowerExCost3 = 0;
  if (is3Bracket) {
    const nlBond = tipsMap.get(newLowerCUSIP);
    const newLowerCPB3 = (nlBond?.price ?? 0) / 100 * (refCPI / (nlBond?.baseCpi ?? refCPI)) * 1000;
    const newLowerCPBReal3 = (nlBond?.price ?? 0) / 100 * 1000;
    newLowerCurExReal3 = Math.max(0, (yearInfo[newLowerYear]?.holdings?.find(h=>h.cusip===newLowerCUSIP)?.qty ?? 0) - (bracketTargetFundedYearQtyBefore[newLowerYear] ?? 0)) * newLowerCPBReal3;
    newLowerExCost3 = ((buySellTargets[newLowerYear]?.postRebalQty ?? 0) - (buySellTargets[newLowerYear]?.targetFundedYearQty ?? 0)) * newLowerCPB3;
  }
  
  const totalCurrentExcessReal = lowerCurExReal + upperCurExReal + newLowerCurExReal3;
  const totalExcessCost = lowerExCost + upperExCost + newLowerExCost3;

  const lowerPostQty = buySellTargets[brackets.lowerYear]?.targetQty ?? 0;
  const lowerTargetFYQty = buySellTargets[brackets.lowerYear]?.targetFundedYearQty ?? 0;
  const upperPostQty = buySellTargets[brackets.upperYear]?.targetQty ?? 0;
  const upperTargetFYQty = buySellTargets[brackets.upperYear]?.targetFundedYearQty ?? 0;

  const totalExcessCostReal = (lowerPostQty - lowerTargetFYQty) * lowerCPBReal
    + (upperPostQty - upperTargetFYQty) * upperCPBReal
    + (is3Bracket ? ((buySellTargets[newLowerYear]?.postRebalQty ?? 0) - (buySellTargets[newLowerYear]?.targetFundedYearQty ?? 0)) * ((tipsMap.get(newLowerCUSIP)?.price ?? 0) / 100 * 1000) : 0);

  const beforeLowerWeight = totalCurrentExcessReal > 0 ? lowerCurExReal / totalCurrentExcessReal : null;
  const beforeUpperWeight = totalCurrentExcessReal > 0 ? upperCurExReal / totalCurrentExcessReal : null;
  const beforeNewLowerWeight = is3Bracket && totalCurrentExcessReal > 0 ? newLowerCurExReal3 / totalCurrentExcessReal : null;
  const afterLowerWeight = totalExcessCost > 0 ? lowerExCost / totalExcessCost : null;
  const afterUpperWeight = totalExcessCost > 0 ? upperExCost / totalExcessCost : null;
  const afterNewLowerWeight = is3Bracket && totalExcessCost > 0 ? newLowerExCost3 / totalExcessCost : null;

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
    const exB = isBT ? Math.max(0, h.qty - (bracketTargetFundedYearQtyBefore[h.year] ?? 0)) : 0;
    const exA = isBT ? tQ - tFundedYearQty : 0;

    details.unshift({
      cusip: h.cusip, maturityStr: fmtDate(h.maturity), fundedYear: h.year,
      coupon: b.coupon, yield: b.yield, price: b.price, baseCpi: b.baseCpi, refCPI, indexRatio: ir,
      principalPerBond: 1000 * ir, costPerBond: (b.price / 100 * ir * 1000),
      DARA: daraByYear?.get(h.year) ?? DARA,
      qtyBefore: h.qty, qtyAfter: tQ,
      fundedYearQtyBefore: isBT ? Math.min(bracketTargetFundedYearQtyBefore[h.year] ?? 0, h.qty) : h.qty,
      fundedYearQtyAfter: tFundedYearQty,
      isBracketTarget: isBT,
      excessQtyBefore: exB, excessQtyAfter: exA,
      araBeforeTotal:    isLast ? aB : null, araAfterTotal:    isLast ? aA : null,
      araBeforePrincipal:   isLast ? (beforeARABreakdown[h.year]?.principal   ?? 0) : null,
      araBeforeOwnCoupon:   isLast ? (beforeARABreakdown[h.year]?.ownCoupon   ?? 0) : null,
      araBeforeLaterMatInt: isLast ? (beforeARABreakdown[h.year]?.laterMatInt ?? 0) : null,
      araBeforeHoldings:    isLast ? (beforeARABreakdown[h.year]?.holdings   ?? []) : null,
      araAfterPrincipal:    isLast ? (postARABreakdown[h.year]?.principal    ?? 0) : null,
      araAfterOwnCoupon:    isLast ? (postARABreakdown[h.year]?.ownCoupon    ?? 0) : null,
      araAfterLaterMatInt:  isLast ? (postARABreakdown[h.year]?.laterMatInt  ?? 0) : null,
      araAfterHoldings:     isLast ? (postARABreakdown[h.year]?.holdings     ?? []) : null,
      nPeriods: (h.maturity.getMonth() + 1 < 7 ? 1 : 2)
    });
    const rowDARA = daraByYear?.get(h.year) ?? DARA;
    results.unshift([h.cusip, h.qty, fmtDate(h.maturity), fy, pFY, iFY, aFY, cFY, tQ, qD, tC, cD, aB, aB - rowDARA, aA, aA - rowDARA, exB * calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap), exA * calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap)]);
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
    const newDetail = {
      cusip: bst.targetCUSIP, maturityStr: fmtDate(tb.maturity), fundedYear: bYear,
      coupon: tb.coupon, price: tb.price, baseCpi: tb.baseCpi, refCPI, indexRatio: ir,
      principalPerBond: 1000 * ir, costPerBond: cpb, DARA: rowDARA,
      qtyBefore: 0, qtyAfter: bst.targetQty,
      fundedYearQtyBefore: 0, fundedYearQtyAfter: bst.targetFundedYearQty,
      isBracketTarget: bst.isBracket, excessQtyBefore: 0, excessQtyAfter: exA,
      araBeforeTotal: araB, araAfterTotal: araA,
      araBeforePrincipal: 0, araBeforeOwnCoupon: 0, araBeforeLaterMatInt: lmiBefore,
      araAfterPrincipal: bst.targetFundedYearQty * 1000 * ir,
      araAfterOwnCoupon: bst.targetFundedYearQty * 1000 * ir * tb.coupon * (m < 7 ? 0.5 : 1.0),
      araAfterLaterMatInt: yearLaterMatIntSnapshot[bYear] ?? 0,
      nPeriods: m < 7 ? 1 : 2,
    };
    const newResult = [
      bst.targetCUSIP, 0, fmtDate(tb.maturity), bYear,
      0, lmiBefore, lmiBefore, 0,
      bst.targetQty, bst.qtyDelta, bst.targetCost, bst.costDelta,
      araB, araB - rowDARA, araA, araA - rowDARA, 0, exA * piPB,
    ];
    const ri = details.findIndex(d => d.fundedYear > bYear);
    if (ri >= 0) { results.splice(ri, 0, newResult); details.splice(ri, 0, newDetail); }
    else { results.push(newResult); details.push(newDetail); }
  }

  const costDeltaSum = results.reduce((s, r) => s + (typeof r[11] === 'number' ? r[11] : 0), 0);
  const costForNewRungs = Object.values(buySellTargets).reduce((s, bst) => s + (bst.isBracket ? 0 : Math.max(0, bst.targetCost)), 0);
  const gapCoverageSurplus = totalCurrentExcessReal - costForNewRungs - (gapParams.totalCost || 0);

  const HDR = ['CUSIP','Qty','Maturity','FY','Principal','Interest','ARA','Cost','Target Qty','Qty Delta','Target Cost','Cost Delta','ARA (Before)','ARA-DARA Before','ARA (After)','ARA-DARA After','Excess ARA Before','Excess ARA After'];
  
  return { results, HDR, summary: { settleDateDisp, refCPI, DARA, inferredDARA, daraIsInferred: dara === null, method, firstYear, lastYear, rungCount, gapYears, brackets, lowerWeight, upperWeight, costDeltaSum, costForNewRungs, gapCoverageSurplus, gapParams, bracketMode, lowerDuration, upperDuration, newLowerYear, newLowerCUSIP, newLowerDuration, newLowerWeight3, origLowerWeight, bracketFellBack3to2, beforeLowerWeight, beforeUpperWeight, beforeNewLowerWeight, afterLowerWeight, afterUpperWeight, afterNewLowerWeight, totalCurrentExcess: totalCurrentExcessReal, totalExcessCost, totalExcessCostReal, araByYear }, details };
}

// rebalance-lib.js -- Core logic for TIPS ladder rebalancing (4.0_TIPS_Ladder_Rebalancing.md)
// Exports: buildTipsMapFromYields, runRebalance, localDate, inferDARAFromCash

import { bondCalcs, calculateMDuration } from './bond-math.js';
import { interpolateYield, syntheticCoupon } from './gap-math.js';

export function localDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
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

function identifyBrackets(gapYears, holdings, yearInfo) {
  const minGapYear = Math.min(...gapYears);
  const upperYear = 2040;
  const upperH = yearInfo[upperYear]?.holdings?.find(h => h.maturity.getMonth() + 1 === 2);
  const upperCUSIP = upperH?.cusip || '912810QF8';
  const upperMaturity = localDate(`${upperYear}-02-15`);

  const LOWEST_LOWER_BRACKET_YEAR = 2032;
  let maxQty = -1, lowerCUSIP = null, lowerYear = null, lowerMaturity = null;

  for (const year in yearInfo) {
    const y = parseInt(year);
    if (y >= LOWEST_LOWER_BRACKET_YEAR && y < minGapYear) {
      for (const h of yearInfo[year].holdings) {
        if (h.qty > maxQty) {
          maxQty = h.qty; lowerCUSIP = h.cusip; lowerYear = y; lowerMaturity = h.maturity;
        }
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
  const lowerWeight = (upperDur - dGap) / (upperDur - lowerDur);
  return { lowerWeight, upperWeight: 1 - lowerWeight };
}

function bracketWeights3(d1, d2, d3, dGap, currentExcessCost1, gapTotalCost) {
  const w1 = currentExcessCost1 / gapTotalCost;
  const w2_raw = (dGap - d3 + w1 * (d3 - d1)) / (d2 - d3);
  const w2 = Math.max(0, w2_raw);
  const w3 = 1 - w1 - w2;
  return { origLowerWeight: w1, newLowerWeight: w2, upperWeight: w3 };
}

function calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings) {
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

export function inferDARAFromCash({ bracketMode = '2bracket', holdings: holdingsRaw, tipsMap, refCPI, settlementDate }) {
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
    const { summary } = runRebalance({ dara: mid, method: 'Full', bracketMode, holdings: holdingsRaw, tipsMap, refCPI, settlementDate });
    const delta = summary.costDeltaSum;
    if (Math.abs(delta) < 50) { foundDARA = mid; break; }
    if (delta >= 0) { lo = mid; foundDARA = mid; } else hi = mid;
  }
  return { dara: foundDARA, portfolioCash };
}

export function runRebalance({ dara, method, bracketMode = '2bracket', holdings: holdingsRaw, tipsMap, refCPI, settlementDate }) {
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

  const gapParams = calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings);
  const brackets  = identifyBrackets(gapYears, holdings, yearInfo);
  const lowerBond = tipsMap.get(brackets.lowerCUSIP);
  const upperBond = tipsMap.get(brackets.upperCUSIP);
  const lowerDuration = calculateMDuration(settlementDate, brackets.lowerMaturity, lowerBond?.coupon ?? 0, lowerBond?.yield ?? 0);
  const upperDuration = calculateMDuration(settlementDate, brackets.upperMaturity, upperBond?.coupon ?? 0, upperBond?.yield ?? 0);
  
  const minGapYear = Math.min(...gapYears);
  const is3Bracket = (bracketMode === '3bracket');
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

  const bracketYearSet = is3Bracket ? new Set([brackets.lowerYear, brackets.upperYear, newLowerYear]) : new Set([brackets.lowerYear, brackets.upperYear]);
  const gapYearSet = new Set(gapYears);

  const bracketTargetFundedYearQtyBefore = {};
  const _triplets = [[brackets.lowerYear, brackets.lowerCUSIP, brackets.lowerMaturity], [brackets.upperYear, brackets.upperCUSIP, brackets.upperMaturity], ...(is3Bracket ? [[newLowerYear, newLowerCUSIP, newLowerMaturity]] : [])];
  
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
    bracketTargetFundedYearQtyBefore[bYear] = Math.round((DARA - laterMatIntBefore - nonPI) / piB);
  }

  let lowerWeight, upperWeight, origLowerWeight, newLowerWeight3, upperWeight3;
  if (is3Bracket) {
    const _olH = yearInfo[brackets.lowerYear]?.holdings?.find(h => h.cusip === brackets.lowerCUSIP);
    const _olBond = tipsMap.get(brackets.lowerCUSIP);
    const _olCPB = (_olBond?.price ?? 0) / 100 * (refCPI / (_olBond?.baseCpi ?? refCPI)) * 1000;
    const _curEx = Math.max(0, (_olH?.qty ?? 0) - (bracketTargetFundedYearQtyBefore[brackets.lowerYear] ?? 0)) * _olCPB;
    const _w3 = bracketWeights3(lowerDuration, newLowerDuration, upperDuration, gapParams.avgDuration, _curEx, gapParams.totalCost);
    origLowerWeight = _w3.origLowerWeight; newLowerWeight3 = _w3.newLowerWeight; upperWeight3 = _w3.upperWeight;
    lowerWeight = origLowerWeight; upperWeight = upperWeight3;
  } else {
    const _w2 = bracketWeights(lowerDuration, upperDuration, gapParams.avgDuration);
    lowerWeight = _w2.lowerWeight; upperWeight = _w2.upperWeight;
  }

  let rebalYearSet;
  if (isFullMode) {
    rebalYearSet = new Set(Object.keys(yearInfo).map(Number).filter(y => y >= firstYear && y <= lastYear && !bracketYearSet.has(y) && !gapYearSet.has(y)));
  } else {
    rebalYearSet = new Set(Object.keys(yearInfo).map(Number).filter(y => y > brackets.lowerYear && y < minGapYear && !bracketYearSet.has(y)));
  }

  const bracketExcessTargetCost = is3Bracket ? { [brackets.lowerYear]: gapParams.totalCost * origLowerWeight, [brackets.upperYear]: gapParams.totalCost * upperWeight3, [newLowerYear]: gapParams.totalCost * newLowerWeight3 } 
                                         : { [brackets.lowerYear]: gapParams.totalCost * lowerWeight, [brackets.upperYear]: gapParams.totalCost * upperWeight };

  const buySellTargets = {};
  const nonTargetSells = {};
  const postRebalQtyMap = {};
  let rebuildLaterMatInt = 0;
  const yearLaterMatIntSnapshot = {};
  const sortedToProcess = Array.from(new Set([...holdingsYears, ...gapYears])).sort((a, b) => b - a);

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
    }

    const tBond = tipsMap.get(targetCUSIP);
    const costPerBond = (tBond?.price ?? 0) / 100 * (refCPI / (tBond?.baseCpi ?? refCPI)) * 1000;
    const targetCurrentQty = yi.holdings.find(h => h.cusip === targetCUSIP)?.qty ?? 0;

    let tFundedYearQty, postQ;
    if (isBracket || isRebal) {
      const needed = DARA - rebuildLaterMatInt;
      if (isFullMode) {
        const sortedH = [...yi.holdings].sort((a, b) => a.maturity - b.maturity);
        const nonTarget = sortedH.filter(h => h.cusip !== targetCUSIP);
        let curPI = yi.holdings.reduce((s, h) => s + h.qty * piMap[h.cusip], 0);
        for (const h of nonTarget) {
          const sell = Math.min(h.qty, Math.max(0, Math.ceil((curPI - needed) / piMap[h.cusip])));
          postRebalQtyMap[h.cusip] = h.qty - sell;
          curPI -= sell * piMap[h.cusip];
        }
        const diff = needed - curPI;
        tFundedYearQty = targetCurrentQty + Math.round(diff / piMap[targetCUSIP]);
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
        tFundedYearQty = Math.round((needed - ntPI) / piMap[targetCUSIP]);
      }
      postQ = isBracket ? tFundedYearQty + Math.max(0, Math.round(bracketExcessTargetCost[year] / costPerBond)) : tFundedYearQty;
      buySellTargets[year] = { targetCUSIP, targetFundedYearQty: tFundedYearQty, targetQty: postQ, postRebalQty: postQ, qtyDelta: postQ - targetCurrentQty, targetCost: tFundedYearQty * costPerBond, costDelta: -((postQ - targetCurrentQty) * costPerBond), costPerBond, isBracket };
    } else {
      tFundedYearQty = targetCurrentQty; postQ = targetCurrentQty;
    }

    postRebalQtyMap[targetCUSIP] = postQ;
    for (const h of yi.holdings) {
      const b = tipsMap.get(h.cusip);
      if (b) rebuildLaterMatInt += (postRebalQtyMap[h.cusip] ?? h.qty) * (refCPI / (b.baseCpi || refCPI)) * 1000 * b.coupon;
    }
  }

  // Before/After ARA calculations
  const beforeARAByYear = {}, postARAByYear = {};
  for (const year of sortedToProcess) {
    let lBefore = 0;
    for (const y in araLaterMaturityInterestByYear) if (parseInt(y) > year) lBefore += araLaterMaturityInterestByYear[y];
    let pB = 0, cB = 0;
    if (yearInfo[year]) {
      for (const h of yearInfo[year].holdings) {
        const b = tipsMap.get(h.cusip);
        const ir = refCPI / (b?.baseCpi ?? refCPI);
        const ap = 1000 * ir;
        const isBT = (bracketYearSet.has(year) && h.cusip === buySellTargets[year]?.targetCUSIP);
        const q = isBT ? bracketTargetFundedYearQtyBefore[year] : h.qty;
        const m = h.maturity.getMonth() + 1;
        pB += q * ap; cB += q * ap * b.coupon * (m < 7 ? 0.5 : 1.0);
      }
    }
    beforeARAByYear[year] = pB + cB + lBefore;

    const lAfter = yearLaterMatIntSnapshot[year] ?? 0;
    let pA = 0, cA = 0;
    if (yearInfo[year]) {
      for (const h of yearInfo[year].holdings) {
        const b = tipsMap.get(h.cusip);
        const ir = refCPI / (b?.baseCpi ?? refCPI);
        const ap = 1000 * ir;
        const isBT = (bracketYearSet.has(year) && h.cusip === buySellTargets[year]?.targetCUSIP);
        const q = isBT ? buySellTargets[year].targetFundedYearQty : (postRebalQtyMap[h.cusip] ?? h.qty);
        const m = h.maturity.getMonth() + 1;
        pA += q * ap; cA += q * ap * b.coupon * (m < 7 ? 0.5 : 1.0);
      }
    }
    postARAByYear[year] = pA + cA + lAfter;
  }

  // Summary Metrics
  const lowerBondS = tipsMap.get(brackets.lowerCUSIP);
  const upperBondS = tipsMap.get(brackets.upperCUSIP);
  const lowerCPB = (lowerBondS?.price ?? 0) / 100 * (refCPI / (lowerBondS?.baseCpi ?? refCPI)) * 1000;
  const upperCPB = (upperBondS?.price ?? 0) / 100 * (refCPI / (upperBondS?.baseCpi ?? refCPI)) * 1000;
  const lowerCurEx = Math.max(0, (yearInfo[brackets.lowerYear]?.holdings?.find(h=>h.cusip===brackets.lowerCUSIP)?.qty ?? 0) - (bracketTargetFundedYearQtyBefore[brackets.lowerYear] ?? 0)) * lowerCPB;
  const upperCurEx = Math.max(0, (yearInfo[brackets.upperYear]?.holdings?.find(h=>h.cusip===brackets.upperCUSIP)?.qty ?? 0) - (bracketTargetFundedYearQtyBefore[brackets.upperYear] ?? 0)) * upperCPB;
  const lowerPostQ = buySellTargets[brackets.lowerYear]?.postRebalQty ?? 0;
  const upperPostQ = buySellTargets[brackets.upperYear]?.postRebalQty ?? 0;
  const lowerTFQ = buySellTargets[brackets.lowerYear]?.targetFundedYearQty ?? 0;
  const upperTFQ = buySellTargets[brackets.upperYear]?.targetFundedYearQty ?? 0;
  const lowerExCost = (lowerPostQ - lowerTFQ) * lowerCPB;
  const upperExCost = (upperPostQ - upperTFQ) * upperCPB;
  let newLowerCPB3 = 0, newLowerCurEx3 = 0, newLowerExCost3 = 0;
  if (is3Bracket) {
    const nlBond = tipsMap.get(newLowerCUSIP);
    newLowerCPB3 = (nlBond?.price ?? 0) / 100 * (refCPI / (nlBond?.baseCpi ?? refCPI)) * 1000;
    newLowerCurEx3 = Math.max(0, (yearInfo[newLowerYear]?.holdings?.find(h=>h.cusip===newLowerCUSIP)?.qty ?? 0) - (bracketTargetFundedYearQtyBefore[newLowerYear] ?? 0)) * newLowerCPB3;
    newLowerExCost3 = ((buySellTargets[newLowerYear]?.postRebalQty ?? 0) - (buySellTargets[newLowerYear]?.targetFundedYearQty ?? 0)) * newLowerCPB3;
  }
  const totalCurrentExcess = lowerCurEx + upperCurEx + newLowerCurEx3;
  const totalExcessCost = lowerExCost + upperExCost + newLowerExCost3;
  const beforeLowerWeight = totalCurrentExcess > 0 ? lowerCurEx / totalCurrentExcess : null;
  const beforeUpperWeight = totalCurrentExcess > 0 ? upperCurEx / totalCurrentExcess : null;
  const beforeNewLowerWeight = is3Bracket && totalCurrentExcess > 0 ? newLowerCurEx3 / totalCurrentExcess : null;
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
    outLMI[h.year] += h.qty * 1000 * ir * b.coupon;

    const isBT = !!(bst_loop?.isBracket && h.cusip === bst_loop.targetCUSIP);
    const exB = isBT ? Math.max(0, h.qty - (bracketTargetFundedYearQtyBefore[h.year] ?? 0)) : 0;
    const exA = isBT ? bst_loop.postRebalQty - bst_loop.targetFundedYearQty : 0;

    details.unshift({
      cusip: h.cusip, maturityStr: fmtDate(h.maturity), fundedYear: h.year,
      coupon: b.coupon, price: b.price, baseCpi: b.baseCpi, refCPI, indexRatio: ir,
      principalPerBond: 1000 * ir, costPerBond: (b.price / 100 * ir * 1000),
      qtyBefore: h.qty, qtyAfter: tQ,
      fundedYearQtyBefore: isBT ? bracketTargetFundedYearQtyBefore[h.year] : h.qty,
      fundedYearQtyAfter: tFundedYearQty,
      excessQtyBefore: exB, excessQtyAfter: exA,
      araBeforeTotal: isLast ? aB : null, araAfterTotal: isLast ? aA : null,
      nPeriods: (h.maturity.getMonth() + 1 < 7 ? 1 : 2)
    });
    results.unshift([h.cusip, h.qty, fmtDate(h.maturity), fy, pFY, iFY, aFY, cFY, tQ, qD, tC, cD, aB, aB - DARA, aA, aA - DARA, exB * calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap), exA * calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap)]);
  }

  const costDeltaSum = results.reduce((s, r) => s + (typeof r[11] === 'number' ? r[11] : 0), 0);
  const HDR = ['CUSIP','Qty','Maturity','FY','Principal','Interest','ARA','Cost','Target Qty','Qty Delta','Target Cost','Cost Delta','ARA (Before)','ARA-DARA Before','ARA (After)','ARA-DARA After','Excess ARA Before','Excess ARA After'];
  
  return { results, HDR, summary: { settleDateDisp, refCPI, DARA, inferredDARA, method, firstYear, lastYear, rungCount, gapYears, brackets, lowerWeight, upperWeight, costDeltaSum, gapParams, bracketMode, lowerDuration, upperDuration, newLowerYear, newLowerCUSIP, newLowerDuration, newLowerWeight3, origLowerWeight, beforeLowerWeight, beforeUpperWeight, beforeNewLowerWeight, afterLowerWeight, afterUpperWeight, afterNewLowerWeight, totalCurrentExcess, totalExcessCost, araByYear }, details };
}

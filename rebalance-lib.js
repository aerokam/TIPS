// TIPS Ladder Rebalancing — browser-compatible ES module
// Pure computation only — no Node.js I/O, no file system, no CLI.
//
// Entry point:  runRebalance({ dara, method, holdings, tipsMap, refCPI, settlementDate })
// Data loading: buildTipsMapFromYields(rows) — build tipsMap from TipsYields.csv rows

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

// ─── Duration calculations ────────────────────────────────────────────────────
export function getNumPeriods(settlement, maturity) {
  const months = (maturity.getFullYear() - settlement.getFullYear()) * 12 +
                 (maturity.getMonth() - settlement.getMonth());
  return Math.ceil(months / 6);
}

export function calculateDuration(settlement, maturity, coupon, yld) {
  const settle = new Date(settlement);
  const mature = new Date(maturity);
  const periods = getNumPeriods(settle, mature);
  let weightedSum = 0, pvSum = 0;
  for (let i = 1; i <= periods; i++) {
    const cashflow = i === periods ? 1000 + coupon * 1000 / 2 : coupon * 1000 / 2;
    const pv = cashflow / Math.pow(1 + yld / 2, i);
    weightedSum += i * pv;
    pvSum += pv;
  }
  return weightedSum / pvSum / 2;
}

export function calculateMDuration(settlement, maturity, coupon, yld) {
  return calculateDuration(settlement, maturity, coupon, yld) / (1 + yld / 2);
}

// ─── P+I per bond ─────────────────────────────────────────────────────────────
export function calculatePIPerBond(cusip, maturity, refCPI, tipsMap) {
  const bond = tipsMap.get(cusip);
  const coupon  = bond?.coupon  ?? 0;
  const baseCpi = bond?.baseCpi ?? refCPI;
  const indexRatio = refCPI / baseCpi;
  const adjustedPrincipal = 1000 * indexRatio;
  const adjustedAnnualInterest = adjustedPrincipal * coupon;
  const monthF = new Date(maturity).getMonth() + 1;
  const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
  return adjustedPrincipal + lastYearInterest;
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
    const syntheticYield = anchorBefore.yield +
      (syntheticMat - anchorBefore.maturity) * (anchorAfter.yield - anchorBefore.yield) /
      (anchorAfter.maturity - anchorBefore.maturity);
    const syntheticCoupon = Math.max(0.00125, Math.floor(syntheticYield * 100 / 0.125) * 0.00125);

    totalDuration += calculateMDuration(settlementDate, syntheticMat, syntheticCoupon, syntheticYield);

    let sumLaterMaturityInterest = 0;
    for (const futYear in gapLaterMaturityInterest) {
      if (parseInt(futYear) > year) sumLaterMaturityInterest += gapLaterMaturityInterest[futYear];
    }

    const piPerBond = 1000 + 1000 * syntheticCoupon * 0.5;
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
  let lo = 1000, hi = 500000, foundDARA = (lo + hi) / 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const { summary } = runRebalance({ dara: mid, method: 'Full', holdings: holdingsRaw, tipsMap, refCPI, settlementDate });
    const targetCost = portfolioCash - summary.costDeltaSum;
    if (Math.abs(targetCost - portfolioCash) < 50) { foundDARA = mid; break; }
    if (targetCost < portfolioCash) lo = mid; else hi = mid;
    foundDARA = mid;
  }
  return { dara: foundDARA, portfolioCash };
}


export function runRebalance({ dara, method, holdings: holdingsRaw, tipsMap, refCPI, settlementDate }) {
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
  const lowerWeight   = (upperDuration - gapParams.avgDuration) / (upperDuration - lowerDuration);
  const upperWeight   = 1 - lowerWeight;

  // Phase 3b: Before-state bracket excess (display only)
  const bracketYearSet = new Set([brackets.lowerYear, brackets.upperYear]);
  const gapYearSet     = new Set(gapYears);
  const minGapYear     = Math.min(...gapYears);

  const bracketTargetFYQtyBefore = {};
  for (const [bracketYear, bracketCUSIP, bracketMaturity] of [
    [brackets.lowerYear, brackets.lowerCUSIP, brackets.lowerMaturity],
    [brackets.upperYear, brackets.upperCUSIP, brackets.upperMaturity],
  ]) {
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
        .filter(y => y > brackets.lowerYear && y < minGapYear)
    );
  }

  const bracketExcessTarget = {
    [brackets.lowerYear]: gapParams.totalCost * lowerWeight,
    [brackets.upperYear]: gapParams.totalCost * upperWeight,
  };

  const buySellTargets  = {};
  const nonTargetSells  = {}; // non-latest bonds sold in multi-bond years
  const postRebalQtyMap = {};
  for (const h of holdings) postRebalQtyMap[h.cusip] = h.qty;

  let rebuildLaterMatInt = 0;
  const yearLaterMatIntSnapshot = {};

  for (const year of allYearsSorted) {
    if (gapYearSet.has(year)) continue;

    yearLaterMatIntSnapshot[year] = rebuildLaterMatInt;

    const yi        = yearInfo[year];
    const isBracket = bracketYearSet.has(year);
    const isRebal   = rebalYearSet.has(year);

    // Select target as latest-maturing bond in year (ensures "sell earliest first" basis)
    let targetCUSIP = null, targetMaturity = null;
    for (const h of yi.holdings) {
      if (!targetMaturity || h.maturity > targetMaturity) {
        targetMaturity = h.maturity; targetCUSIP = h.cusip;
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
        // Multi-bond year: sell earliest-maturing bonds first, then latest
        const sortedH  = [...yi.holdings].sort((a, b) => a.maturity - b.maturity);
        const nonLatest = sortedH.slice(0, -1); // all but the latest-maturing

        // Pre-compute PI per bond for all holdings in this year
        const piMap = {};
        for (const h of yi.holdings)
          piMap[h.cusip] = calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap);

        let nonLatestPI = 0;
        for (const h of nonLatest) nonLatestPI += h.qty * piMap[h.cusip];

        let targetLatestQty = Math.round((totalPINeeded - nonLatestPI) / piMap[targetCUSIP]);

        if (isFullMode && targetLatestQty < currentQty) {
          // Full rebalance only: sell earliest maturities first to avoid selling latest
          let reducedNonLatestPI = nonLatestPI;
          for (const h of nonLatest) {
            reducedNonLatestPI    -= h.qty * piMap[h.cusip];
            postRebalQtyMap[h.cusip] = 0; // tentatively zero this bond
            targetLatestQty = Math.round((totalPINeeded - reducedNonLatestPI) / piMap[targetCUSIP]);
            if (targetLatestQty >= currentQty) break; // enough freed up
          }
          targetLatestQty = Math.max(0, targetLatestQty);
        }

        targetFYQty = targetLatestQty;

        // Record qty changes for non-latest bonds
        for (const h of nonLatest) {
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
          }
        }
      }

      postRebalQty = isBracket
        ? targetFYQty + Math.round(bracketExcessTarget[year] / costPerBond)
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
    } else {
      targetFYQty  = currentQty;
      postRebalQty = currentQty;
    }

    postRebalQtyMap[targetCUSIP] = postRebalQty;
    for (const h of yi.holdings) {
      const bond = tipsMap.get(h.cusip);
      const c  = bond?.coupon  ?? 0;
      const bc = bond?.baseCpi ?? refCPI;
      const ir = refCPI / bc;
      rebuildLaterMatInt += postRebalQtyMap[h.cusip] * 1000 * ir * c;
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
      const exQtyBef = h.qty - (bracketTargetFYQtyBefore[h.year] ?? 0);
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
          const dExQtyBef   = dIsBT ? h.qty - bracketTargetFYQtyBefore[h.year] : 0;
          const dExQtyAft   = dIsBT ? dBT.postRebalQty - dBT.targetFYQty : 0;
          const dLast       = isLastInYear;
          const dBComp      = dLast ? beforeARACompByYear[h.year] : null;
          const dAComp      = dLast ? afterARACompByYear[h.year]  : null;
          details.unshift({
            cusip: h.cusip, maturityStr: fmtDate(h.maturity), fy: h.year,
            nPeriods: dNPer, isLastInYear: dLast, isBracketTarget: dIsBT,
            coupon: dCoupon, price: dPrice, baseCpi: dBase, refCPI, indexRatio: dIR,
            principalPerBond: dPPB, costPerBond: dCPB,
            qtyBefore: h.qty, qtyAfter: dQtyAfter, fyQty: dFYQty,
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
  const lowerBondS       = tipsMap.get(brackets.lowerCUSIP);
  const upperBondS       = tipsMap.get(brackets.upperCUSIP);
  const lowerPrice       = lowerBondS?.price ?? 0;
  const lowerBaseCpi     = lowerBondS?.baseCpi ?? refCPI;
  const lowerCostPerBond = lowerPrice / 100 * (refCPI / lowerBaseCpi) * 1000;
  const upperPrice       = upperBondS?.price ?? 0;
  const upperBaseCpi     = upperBondS?.baseCpi ?? refCPI;
  const upperCostPerBond = upperPrice / 100 * (refCPI / upperBaseCpi) * 1000;

  const lowerCurrentExcess = buySellTargets[brackets.lowerYear].currentExcessCost;
  const upperCurrentExcess = buySellTargets[brackets.upperYear].currentExcessCost;
  const totalCurrentExcess = lowerCurrentExcess + upperCurrentExcess;

  const lowerPostQty     = buySellTargets[brackets.lowerYear].postRebalQty;
  const upperPostQty     = buySellTargets[brackets.upperYear].postRebalQty;
  const lowerTargetFYQty = buySellTargets[brackets.lowerYear].targetFYQty;
  const upperTargetFYQty = buySellTargets[brackets.upperYear].targetFYQty;
  const lowerExcessQty   = lowerPostQty - lowerTargetFYQty;
  const upperExcessQty   = upperPostQty - upperTargetFYQty;
  const lowerExcessCost  = lowerExcessQty * lowerCostPerBond;
  const upperExcessCost  = upperExcessQty * upperCostPerBond;
  const totalExcessCost  = lowerExcessCost + upperExcessCost;

  const beforeLowerWeight = totalCurrentExcess > 0 ? lowerCurrentExcess / totalCurrentExcess : null;
  const beforeUpperWeight = totalCurrentExcess > 0 ? upperCurrentExcess / totalCurrentExcess : null;
  const afterLowerWeight  = totalExcessCost   > 0 ? lowerExcessCost   / totalExcessCost   : null;
  const afterUpperWeight  = totalExcessCost   > 0 ? upperExcessCost   / totalExcessCost   : null;

  const HDR = ['CUSIP','Qty','Maturity','FY','Principal','Interest','ARA','Cost',
               'Target Qty','Qty Delta','Target Cost','Cost Delta',
               'ARA (Before)','ARA-DARA Before','ARA (After)','ARA-DARA After',
               'Excess ARA Before','Excess ARA After'];

  const summary = {
    settleDateDisp, refCPI, DARA, inferredDARA, method,
    firstYear, lastYear, rungCount, gapYears, araByYear,
    gapParams, brackets,
    lowerDuration, upperDuration, lowerWeight, upperWeight,
    beforeLowerWeight, beforeUpperWeight, afterLowerWeight, afterUpperWeight,
    totalCurrentExcess, totalExcessCost,
    costDeltaSum,
  };

  return { results, HDR, summary, details };
}

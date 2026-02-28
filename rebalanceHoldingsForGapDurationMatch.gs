// ─── Configuration ───
const LOWEST_LOWER_BRACKET_YEAR = 2032;

function rebalanceHoldingsForGapDurationMatch() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const outputSheet = ss.getSheetById(352804138);
  
  if (!outputSheet) {
    throw new Error('Output sheet with gid 352804138 not found');
  }
  
  // Get source sheets
  const holdingsSheet = ss.getSheetByName('Holdings');
  const tipssaoSheet = ss.getSheetByName('TIPSSAO');
  const tipsrefSheet = ss.getSheetByName('TIPSref');
  const refCPISheet = ss.getSheetByName('RefCPI');
  const inputsSheet = ss.getSheetById(355247987);
  
  // Get data arrays
  const holdingsData = holdingsSheet.getDataRange().getValues();
  const tipssaoData = tipssaoSheet.getDataRange().getValues();
  const tipsrefData = tipsrefSheet.getDataRange().getValues();
  const refCPIData = refCPISheet.getDataRange().getValues();
  
  // ─── Get settlement date from TIPSSAO!V2 ───
  const settlementDate = new Date(tipssaoSheet.getRange('V2').getValue());
  Logger.log('Settlement date: ' + settlementDate);
  
  // ─── Get DARA from Inputs!B1 ───
  const DARA = inputsSheet.getRange('B1').getValue();
  Logger.log('DARA (from Inputs): ' + DARA);
  
  // ─── Look up refCPI for settlement date ───
  const refCPI = lookupRefCPI(settlementDate, refCPIData);
  Logger.log('RefCPI: ' + refCPI);
  
  // Clear output range
  outputSheet.getRange(1, 1, 50, 22).clearContent();
  
  // ─── Build holdings list ───
  const holdings = [];
  for (let i = 1; i < holdingsData.length; i++) {
    if (holdingsData[i][0]) {
      const maturity = holdingsData[i][3];
      holdings.push({
        cusip: holdingsData[i][0],
        qty: holdingsData[i][1],
        maturity: maturity,
        year: new Date(maturity).getFullYear()
      });
    }
  }
  holdings.sort((a, b) => a.maturity - b.maturity);
  
  // ─── Group by year ───
  const yearInfo = {};
  holdings.forEach((h, idx) => {
    if (!yearInfo[h.year]) {
      yearInfo[h.year] = { firstIdx: idx, lastIdx: idx, holdings: [] };
    }
    yearInfo[h.year].lastIdx = idx;
    yearInfo[h.year].holdings.push(h);
  });
  
  // ─── Identify gap years from TIPSSAO ───
  const tipssaoYears = new Set();
  for (let i = 1; i < tipssaoData.length; i++) {
    if (tipssaoData[i][1]) {
      tipssaoYears.add(new Date(tipssaoData[i][1]).getFullYear());
    }
  }
  
  // ─── Determine firstYear, lastYear, and official ladder range ───
  const holdingsYears = Object.keys(yearInfo).map(Number).sort((a, b) => a - b);
  const firstYear = holdingsYears[0];
  
  // lastYear = last contiguous year before any gap above 2040
  // Known gap years (2037-2039) don't break contiguity
  let lastYear = firstYear;
  for (let i = 0; i < holdingsYears.length; i++) {
    const year = holdingsYears[i];
    if (year <= 2040) {
      lastYear = year;
      continue;
    }
    // Above 2040: check if next expected year exists
    const nextExpected = year + 1;
    const nextInHoldings = holdingsYears[i + 1];
    if (nextInHoldings && nextInHoldings === nextExpected) {
      lastYear = nextInHoldings;
    } else if (nextInHoldings && nextInHoldings > nextExpected) {
      // Gap found above 2040 — stop here
      lastYear = year;
      break;
    } else {
      // Last holding year
      lastYear = year;
    }
  }
  
  Logger.log('firstYear: ' + firstYear + ', lastYear: ' + lastYear);
  
  // Gap years within the official range
  const gapYears = [];
  for (let year = firstYear; year <= lastYear; year++) {
    if (!tipssaoYears.has(year) && !yearInfo[year]) {
      gapYears.push(year);
    }
  }
  Logger.log('Gap years: ' + gapYears.join(', '));
  
  // ─── Calculate ARA for all funded years using standard holdings ladder algorithm ───
  // Process longest to shortest to accumulate future interest
  const araFutureInterestByYear = {};
  const araByYear = {};
  
  const allYearsSorted = Object.keys(yearInfo).map(Number).sort((a, b) => b - a);
  
  for (const year of allYearsSorted) {
    // Future interest from later years
    let futInt = 0;
    for (const y in araFutureInterestByYear) {
      if (parseInt(y) > year) futInt += araFutureInterestByYear[y];
    }
    
    let yearPrincipal = 0, yearLastYearInterest = 0;
    araFutureInterestByYear[year] = 0;
    
    for (const holding of yearInfo[year].holdings) {
      const coupon = lookupValue(holding.cusip, tipssaoData, 0, 2);
      const refCPIOnDated = lookupValue(holding.cusip, tipsrefData, 0, 1, refCPI);
      const indexRatio = refCPI / refCPIOnDated;
      const adjustedPrincipal = 1000 * indexRatio;
      const adjustedAnnualInterest = adjustedPrincipal * coupon;
      const monthF = new Date(holding.maturity).getMonth() + 1;
      const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
      
      yearPrincipal += holding.qty * adjustedPrincipal;
      yearLastYearInterest += holding.qty * lastYearInterest;
      araFutureInterestByYear[year] += holding.qty * adjustedAnnualInterest;
    }
    
    araByYear[year] = yearPrincipal + yearLastYearInterest + futInt;
  }
  
  // ─── Calculate inferred DARA from holdings ───
  // Sum ARA for years in official range (firstYear to lastYear), excluding gap years
  let araSum = 0;
  for (let year = firstYear; year <= lastYear; year++) {
    if (araByYear[year] !== undefined) {
      araSum += araByYear[year];
    }
  }
  const rungCount = lastYear - firstYear + 1;
  
  const inferredDARA = araSum / rungCount;
  
  Logger.log('DARA (from Inputs): ' + DARA);
  Logger.log('Inferred DARA (from holdings): ' + inferredDARA + ' (from ' + rungCount + ' rungs, total ARA: ' + araSum + ')');
  
  // ─── STEP 1: Gap parameters ───
  const gapParams = calculateGapParameters(gapYears, settlementDate, refCPI, tipssaoData, tipsrefData, DARA, holdings);
  Logger.log('Gap avg duration: ' + gapParams.avgDuration);
  Logger.log('Gap total cost: ' + gapParams.totalCost);
  
  // ─── STEP 2: Identify brackets ───
  const brackets = identifyBrackets(gapYears, holdings, yearInfo);
  Logger.log('Lower bracket: ' + brackets.lowerYear + ' CUSIP ' + brackets.lowerCUSIP);
  Logger.log('Upper bracket: ' + brackets.upperYear + ' CUSIP ' + brackets.upperCUSIP);
  
  // ─── STEP 3: Bracket durations ───
  const lowerDuration = calculateMDuration(settlementDate, brackets.lowerMaturity,
    lookupValue(brackets.lowerCUSIP, tipssaoData, 0, 2),
    lookupValue(brackets.lowerCUSIP, tipssaoData, 0, 5));
  const upperDuration = calculateMDuration(settlementDate, brackets.upperMaturity,
    lookupValue(brackets.upperCUSIP, tipssaoData, 0, 2),
    lookupValue(brackets.upperCUSIP, tipssaoData, 0, 5));
  Logger.log('Lower duration: ' + lowerDuration);
  Logger.log('Upper duration: ' + upperDuration);
  
  // ─── STEP 4: Weights ───
  const lowerWeight = (upperDuration - gapParams.avgDuration) / (upperDuration - lowerDuration);
  const upperWeight = 1 - lowerWeight;
  Logger.log('Lower weight: ' + lowerWeight);
  Logger.log('Upper weight: ' + upperWeight);
  
  // ─── Pre-calculate future interest by year ───
  const futureInterestByYear = {};
  for (let i = holdings.length - 1; i >= 0; i--) {
    const h = holdings[i];
    const coupon = lookupValue(h.cusip, tipssaoData, 0, 2);
    const refCPIOnDated = lookupValue(h.cusip, tipsrefData, 0, 1, refCPI);
    const indexRatio = refCPI / refCPIOnDated;
    if (!futureInterestByYear[h.year]) futureInterestByYear[h.year] = 0;
    futureInterestByYear[h.year] += h.qty * 1000 * indexRatio * coupon;
  }
  
  // ─── STEPS 5-6: Bracket targets (sell excess) ───
  const buySellTargets = {};
  
  for (const bracketYear of [brackets.lowerYear, brackets.upperYear]) {
    const isLower = (bracketYear === brackets.lowerYear);
    const bracketCUSIP = isLower ? brackets.lowerCUSIP : brackets.upperCUSIP;
    const bracketMaturity = isLower ? brackets.lowerMaturity : brackets.upperMaturity;
    const weight = isLower ? lowerWeight : upperWeight;
    
    let sumFutureInterest = 0;
    for (const year in futureInterestByYear) {
      if (parseInt(year) > bracketYear) sumFutureInterest += futureInterestByYear[year];
    }
    const targetFYPI = DARA - sumFutureInterest;
    
    let targetFYQty;
    const yearHoldings = yearInfo[bracketYear].holdings;
    
    if (yearHoldings.length === 1) {
      const piPerBond = calculatePIPerBond(bracketCUSIP, bracketMaturity, refCPI, tipssaoData, tipsrefData);
      targetFYQty = Math.round(targetFYPI / piPerBond);
    } else {
      let nonBracketPI = 0;
      for (const holding of yearHoldings) {
        if (holding.cusip !== bracketCUSIP) {
          nonBracketPI += holding.qty * calculatePIPerBond(holding.cusip, holding.maturity, refCPI, tipssaoData, tipsrefData);
        }
      }
      const residualPI = targetFYPI - nonBracketPI;
      const bracketPIPerBond = calculatePIPerBond(bracketCUSIP, bracketMaturity, refCPI, tipssaoData, tipsrefData);
      targetFYQty = Math.round(residualPI / bracketPIPerBond);
    }
    
    const price = lookupValue(bracketCUSIP, tipssaoData, 0, 6);
    const refCPIOnDated = lookupValue(bracketCUSIP, tipsrefData, 0, 1, refCPI);
    const indexRatio = refCPI / refCPIOnDated;
    const costPerBond = price / 100 * indexRatio * 1000;
    
    const targetExcessCost = gapParams.totalCost * weight;
    const targetFYCost = targetFYQty * costPerBond;
    const bracketHolding = yearHoldings.find(h => h.cusip === bracketCUSIP);
    const currentQty = bracketHolding ? bracketHolding.qty : 0;
    const holdingsCost = currentQty * costPerBond;
    const holdingsExcessCost = holdingsCost - targetFYCost;
    const buySellCost = targetExcessCost - holdingsExcessCost;
    const buySellQty = Math.round(buySellCost / costPerBond);
    const postRebalQty = currentQty + buySellQty;
    
    Logger.log('Bracket ' + bracketYear + ': targetFYQty=' + targetFYQty +
               ', buySellQty=' + buySellQty + ', postRebalQty=' + postRebalQty);
    
    buySellTargets[bracketYear] = {
      targetCUSIP: bracketCUSIP,
      targetFYQty: targetFYQty,
      targetQty: postRebalQty,
      qtyDelta: buySellQty,
      targetCost: targetFYCost,
      costDelta: -(buySellCost),
      postRebalQty: postRebalQty,
      currentExcessCost: holdingsExcessCost,
      isBracket: true
    };
  }
  
  // ─── V2: Rebalance years — former gap years between lower bracket and current gap ───
  const minGapYear = Math.min(...gapYears);
  const rebalanceYears = Object.keys(yearInfo)
    .map(Number)
    .filter(y => y > brackets.lowerYear && y < minGapYear)
    .sort((a, b) => b - a); // longest to shortest
  
  Logger.log('Rebalance years: ' + rebalanceYears.join(', '));
  
  const rebalanceAddedInterest = {};
  
  for (const rebalYear of rebalanceYears) {
    if (!yearInfo[rebalYear]) continue;
    
    const yearHoldings = yearInfo[rebalYear].holdings;
    let targetCUSIP = null, targetMaturity = null, maxQty = 0;
    for (const h of yearHoldings) {
      if (h.qty > maxQty) { maxQty = h.qty; targetCUSIP = h.cusip; targetMaturity = h.maturity; }
    }
    
    let sumFutureInterest = 0;
    for (const year in futureInterestByYear) {
      if (parseInt(year) > rebalYear) sumFutureInterest += futureInterestByYear[year];
    }
    for (const year in rebalanceAddedInterest) {
      if (parseInt(year) > rebalYear) sumFutureInterest += rebalanceAddedInterest[year];
    }
    
    const targetFYPI = DARA - sumFutureInterest;
    
    let targetFYQty;
    if (yearHoldings.length === 1) {
      const piPerBond = calculatePIPerBond(targetCUSIP, targetMaturity, refCPI, tipssaoData, tipsrefData);
      targetFYQty = Math.round(targetFYPI / piPerBond);
    } else {
      let nonTargetPI = 0;
      for (const holding of yearHoldings) {
        if (holding.cusip !== targetCUSIP) {
          nonTargetPI += holding.qty * calculatePIPerBond(holding.cusip, holding.maturity, refCPI, tipssaoData, tipsrefData);
        }
      }
      const residualPI = targetFYPI - nonTargetPI;
      const targetPIPerBond = calculatePIPerBond(targetCUSIP, targetMaturity, refCPI, tipssaoData, tipsrefData);
      targetFYQty = Math.round(residualPI / targetPIPerBond);
    }
    
    const currentHolding = yearHoldings.find(h => h.cusip === targetCUSIP);
    const currentQty = currentHolding ? currentHolding.qty : 0;
    const qtyDelta = targetFYQty - currentQty;
    
    const price = lookupValue(targetCUSIP, tipssaoData, 0, 6);
    const refCPIOnDated = lookupValue(targetCUSIP, tipsrefData, 0, 1, refCPI);
    const indexRatio = refCPI / refCPIOnDated;
    const costPerBond = price / 100 * indexRatio * 1000;
    
    Logger.log('Rebalance ' + rebalYear + ': targetFYQty=' + targetFYQty +
               ', currentQty=' + currentQty + ', qtyDelta=' + qtyDelta);
    
    buySellTargets[rebalYear] = {
      targetCUSIP: targetCUSIP,
      targetFYQty: targetFYQty,
      targetQty: targetFYQty,
      qtyDelta: qtyDelta,
      targetCost: targetFYQty * costPerBond,
      costDelta: -(qtyDelta * costPerBond),
      postRebalQty: targetFYQty,
      isBracket: false
    };
    
    const coupon = lookupValue(targetCUSIP, tipssaoData, 0, 2);
    rebalanceAddedInterest[rebalYear] = qtyDelta * 1000 * indexRatio * coupon;
  }
  
  Logger.log('buySellTargets: ' + JSON.stringify(buySellTargets));
  
  // ─── Calculate "before" ARA (FY-only for bracket years) ───
  const beforeFutureInterest = {};
  for (let i = holdings.length - 1; i >= 0; i--) {
    const h = holdings[i];
    const coupon = lookupValue(h.cusip, tipssaoData, 0, 2);
    const refCPIOnDated = lookupValue(h.cusip, tipsrefData, 0, 1, refCPI);
    const indexRatio = refCPI / refCPIOnDated;
    if (!beforeFutureInterest[h.year]) beforeFutureInterest[h.year] = 0;
    beforeFutureInterest[h.year] += h.qty * 1000 * indexRatio * coupon;
  }
  
  const beforeARAByYear = {};
  for (const year of allYearsSorted) {
    let futInt = 0;
    for (const y in beforeFutureInterest) {
      if (parseInt(y) > year) futInt += beforeFutureInterest[y];
    }
    
    let yearPrincipal = 0, yearLastYearInterest = 0;
    for (const holding of yearInfo[year].holdings) {
      const coupon = lookupValue(holding.cusip, tipssaoData, 0, 2);
      const refCPIOnDated = lookupValue(holding.cusip, tipsrefData, 0, 1, refCPI);
      const indexRatio = refCPI / refCPIOnDated;
      const adjustedPrincipal = 1000 * indexRatio;
      const adjustedAnnualInterest = adjustedPrincipal * coupon;
      const monthF = new Date(holding.maturity).getMonth() + 1;
      const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
      
      let qtyForARA;
      if (buySellTargets[year] && buySellTargets[year].isBracket && holding.cusip === buySellTargets[year].targetCUSIP) {
        qtyForARA = buySellTargets[year].targetFYQty;
      } else {
        qtyForARA = holding.qty;
      }
      
      yearPrincipal += qtyForARA * adjustedPrincipal;
      yearLastYearInterest += qtyForARA * lastYearInterest;
    }
    
    beforeARAByYear[year] = yearPrincipal + yearLastYearInterest + futInt;
  }
  
  // ─── Calculate "after" ARA (post-rebalance quantities) ───
  const postRebalQtyMap = {};
  for (const h of holdings) {
    postRebalQtyMap[h.cusip] = h.qty;
  }
  for (const year in buySellTargets) {
    const t = buySellTargets[year];
    postRebalQtyMap[t.targetCUSIP] = t.postRebalQty;
  }
  
  const postFutureInterestByYear = {};
  for (let i = holdings.length - 1; i >= 0; i--) {
    const h = holdings[i];
    const postQty = postRebalQtyMap[h.cusip];
    const coupon = lookupValue(h.cusip, tipssaoData, 0, 2);
    const refCPIOnDated = lookupValue(h.cusip, tipsrefData, 0, 1, refCPI);
    const indexRatio = refCPI / refCPIOnDated;
    if (!postFutureInterestByYear[h.year]) postFutureInterestByYear[h.year] = 0;
    postFutureInterestByYear[h.year] += postQty * 1000 * indexRatio * coupon;
  }
  
  const postARAByYear = {};
  for (const year of allYearsSorted) {
    let futInt = 0;
    for (const y in postFutureInterestByYear) {
      if (parseInt(y) > year) futInt += postFutureInterestByYear[y];
    }
    
    let yearPrincipal = 0, yearLastYearInterest = 0;
    for (const holding of yearInfo[year].holdings) {
      const coupon = lookupValue(holding.cusip, tipssaoData, 0, 2);
      const refCPIOnDated = lookupValue(holding.cusip, tipsrefData, 0, 1, refCPI);
      const indexRatio = refCPI / refCPIOnDated;
      const adjustedPrincipal = 1000 * indexRatio;
      const adjustedAnnualInterest = adjustedPrincipal * coupon;
      const monthF = new Date(holding.maturity).getMonth() + 1;
      const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
      
      let qtyForARA;
      if (buySellTargets[year] && holding.cusip === buySellTargets[year].targetCUSIP) {
        if (buySellTargets[year].isBracket) {
          qtyForARA = buySellTargets[year].targetFYQty;
        } else {
          qtyForARA = buySellTargets[year].postRebalQty;
        }
      } else {
        qtyForARA = postRebalQtyMap[holding.cusip];
      }
      
      yearPrincipal += qtyForARA * adjustedPrincipal;
      yearLastYearInterest += qtyForARA * lastYearInterest;
    }
    
    postARAByYear[year] = yearPrincipal + yearLastYearInterest + futInt;
  }
  
  // ─── Build output rows ───
  const results = [];
  const outputFutureInterest = {};
  
  for (let i = holdings.length - 1; i >= 0; i--) {
    const h = holdings[i];
    const isLastInYear = (yearInfo[h.year].lastIdx === i);
    
    let sumFutureAnnualInterest = 0;
    for (const year in outputFutureInterest) {
      if (parseInt(year) > h.year) sumFutureAnnualInterest += outputFutureInterest[year];
    }
    
    let fy = '', principalFY = '', interestFY = '', araFY = '', costFY = '';
    let targetQty = '', qtyDelta = '', targetCost = '', costDelta = '';
    let araBeforeFY = '', araMinusDaraBefore = '', araAfterFY = '', araMinusDaraAfter = '';
    
    if (isLastInYear) {
      let yearPrincipal = 0, yearLastYearInterest = 0, yearCost = 0;
      
      for (const holding of yearInfo[h.year].holdings) {
        const coupon = lookupValue(holding.cusip, tipssaoData, 0, 2);
        const price = lookupValue(holding.cusip, tipssaoData, 0, 6);
        const refCPIOnDated = lookupValue(holding.cusip, tipsrefData, 0, 1, refCPI);
        const indexRatio = refCPI / refCPIOnDated;
        const adjustedPrincipal = 1000 * indexRatio;
        
        yearPrincipal += holding.qty * adjustedPrincipal;
        
        const adjustedAnnualInterest = adjustedPrincipal * coupon;
        const monthF = new Date(holding.maturity).getMonth() + 1;
        const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
        yearLastYearInterest += holding.qty * lastYearInterest;
        
        yearCost += holding.qty * (price / 100 * indexRatio * 1000);
      }
      
      fy = h.year;
      principalFY = yearPrincipal;
      interestFY = yearLastYearInterest + sumFutureAnnualInterest;
      araFY = principalFY + interestFY;
      costFY = yearCost;
      
      araBeforeFY = beforeARAByYear[h.year];
      araMinusDaraBefore = araBeforeFY - DARA;
      araAfterFY = postARAByYear[h.year];
      araMinusDaraAfter = araAfterFY - DARA;
    }
    
    if (buySellTargets[h.year] && h.cusip === buySellTargets[h.year].targetCUSIP) {
      targetQty = buySellTargets[h.year].targetQty;
      qtyDelta = buySellTargets[h.year].qtyDelta;
      targetCost = buySellTargets[h.year].targetCost;
      costDelta = buySellTargets[h.year].costDelta;
    }
    
    const coupon = lookupValue(h.cusip, tipssaoData, 0, 2);
    const refCPIOnDated = lookupValue(h.cusip, tipsrefData, 0, 1, refCPI);
    const indexRatio = refCPI / refCPIOnDated;
    if (!outputFutureInterest[h.year]) outputFutureInterest[h.year] = 0;
    outputFutureInterest[h.year] += h.qty * 1000 * indexRatio * coupon;
    
    results.unshift([
      h.cusip, h.qty, h.maturity, fy,
      principalFY, interestFY, araFY, costFY,
      targetQty, qtyDelta, targetCost, costDelta,
      araBeforeFY, araMinusDaraBefore, araAfterFY, araMinusDaraAfter
    ]);
  }
  
  // ─── Write output ───
  const headers = [['CUSIP', 'Qty', 'Maturity', 'FY', 'Principal FY', 'Interest FY', 'ARA FY', 'Cost FY',
                    'Target Qty', 'Qty Delta', 'Target Cost', 'Cost Delta',
                    'ARA FY (FY Only)', 'ARA-DARA Before', 'ARA FY Post', 'ARA-DARA After']];
  outputSheet.getRange(1, 1, 1, 16).setValues(headers);
  outputSheet.getRange(2, 1, results.length, 16).setValues(results);
  
  // ─── Summary: Net Cash ───
  const costDeltaSum = results.reduce((sum, row) => sum + (typeof row[11] === 'number' ? row[11] : 0), 0);
  
  // ─── Summary table ───
  const summaryCol = 18; // Column R
  
  const lowerCUSIP = brackets.lowerCUSIP;
  const upperCUSIP = brackets.upperCUSIP;
  
  const lowerPrice = lookupValue(lowerCUSIP, tipssaoData, 0, 6);
  const lowerRefCPIOnDated = lookupValue(lowerCUSIP, tipsrefData, 0, 1, refCPI);
  const lowerIndexRatio = refCPI / lowerRefCPIOnDated;
  const lowerCostPerBond = lowerPrice / 100 * lowerIndexRatio * 1000;
  
  const upperPrice = lookupValue(upperCUSIP, tipssaoData, 0, 6);
  const upperRefCPIOnDated = lookupValue(upperCUSIP, tipsrefData, 0, 1, refCPI);
  const upperIndexRatio = refCPI / upperRefCPIOnDated;
  const upperCostPerBond = upperPrice / 100 * upperIndexRatio * 1000;
  
  // Before rebalancing
  const lowerCurrentExcess = buySellTargets[brackets.lowerYear].currentExcessCost;
  const upperCurrentExcess = buySellTargets[brackets.upperYear].currentExcessCost;
  const totalCurrentExcess = lowerCurrentExcess + upperCurrentExcess;
  const beforeLowerWeight = totalCurrentExcess > 0 ? lowerCurrentExcess / totalCurrentExcess : 'N/A';
  const beforeUpperWeight = totalCurrentExcess > 0 ? upperCurrentExcess / totalCurrentExcess : 'N/A';
  
  // After rebalancing
  const lowerPostQty = buySellTargets[brackets.lowerYear].postRebalQty;
  const upperPostQty = buySellTargets[brackets.upperYear].postRebalQty;
  const lowerTargetFYQty = buySellTargets[brackets.lowerYear].targetFYQty;
  const upperTargetFYQty = buySellTargets[brackets.upperYear].targetFYQty;
  
  const lowerExcessQty = lowerPostQty - lowerTargetFYQty;
  const upperExcessQty = upperPostQty - upperTargetFYQty;
  const lowerExcessCost = lowerExcessQty * lowerCostPerBond;
  const upperExcessCost = upperExcessQty * upperCostPerBond;
  const totalExcessCost = lowerExcessCost + upperExcessCost;
  const afterLowerWeight = totalExcessCost > 0 ? lowerExcessCost / totalExcessCost : 'N/A';
  const afterUpperWeight = totalExcessCost > 0 ? upperExcessCost / totalExcessCost : 'N/A';
  
  const lowerCurrentQty = yearInfo[brackets.lowerYear].holdings.find(h => h.cusip === lowerCUSIP);
  const upperCurrentQty = yearInfo[brackets.upperYear].holdings.find(h => h.cusip === upperCUSIP);
  
  const summaryData = [
    ['Parameters', '', '', ''],
    ['  Settlement Date', settlementDate, '', ''],
    ['  RefCPI', refCPI, '', ''],
    ['  DARA', DARA, '', ''],
    ['  Inferred DARA', inferredDARA, '', ''],
    ['  First Year', firstYear, '', ''],
    ['  Last Year', lastYear, '', ''],
    ['  Rungs', rungCount, '', ''],
    ['', '', '', ''],
    ['Duration Matching Verification', '', '', ''],
    ['', '', '', ''],
    ['Gap Avg Duration', gapParams.avgDuration, '', ''],
    ['Gap Total Cost', gapParams.totalCost, '', ''],
    ['', '', '', ''],
    ['Lower Bracket (' + brackets.lowerYear + ')', '', '', ''],
    ['  Duration', lowerDuration, '', ''],
    ['  Current Qty', lowerCurrentQty ? lowerCurrentQty.qty : 0, '', ''],
    ['  Post-Rebal Qty', lowerPostQty, '', ''],
    ['  Target FY Qty', lowerTargetFYQty, '', ''],
    ['  Excess Qty (before)', totalCurrentExcess > 0 ? Math.round(lowerCurrentExcess / lowerCostPerBond) : 'N/A', '', ''],
    ['  Excess $ (before)', lowerCurrentExcess, '', ''],
    ['  Excess Qty (after)', lowerExcessQty, '', ''],
    ['  Excess $ (after)', lowerExcessCost, '', ''],
    ['', '', '', ''],
    ['Upper Bracket (' + brackets.upperYear + ')', '', '', ''],
    ['  Duration', upperDuration, '', ''],
    ['  Current Qty', upperCurrentQty ? upperCurrentQty.qty : 0, '', ''],
    ['  Post-Rebal Qty', upperPostQty, '', ''],
    ['  Target FY Qty', upperTargetFYQty, '', ''],
    ['  Excess Qty (before)', totalCurrentExcess > 0 ? Math.round(upperCurrentExcess / upperCostPerBond) : 'N/A', '', ''],
    ['  Excess $ (before)', upperCurrentExcess, '', ''],
    ['  Excess Qty (after)', upperExcessQty, '', ''],
    ['  Excess $ (after)', upperExcessCost, '', ''],
    ['', '', '', ''],
    ['Weights', 'Target', 'Before', 'After'],
    ['Lower', lowerWeight, beforeLowerWeight, afterLowerWeight],
    ['Upper', upperWeight, beforeUpperWeight, afterUpperWeight],
    ['', '', '', ''],
    ['Rebalance Years', rebalanceYears.join(', '), '', ''],
    ['Net Cash', costDeltaSum, '', ''],
  ];
  
  outputSheet.getRange(1, summaryCol, summaryData.length, 4).setValues(summaryData);
  
  Logger.log('Before weights: lower=' + beforeLowerWeight + ', upper=' + beforeUpperWeight);
  Logger.log('After weights: lower=' + afterLowerWeight + ', upper=' + afterUpperWeight);
  Logger.log('Target weights: lower=' + lowerWeight + ', upper=' + upperWeight);
  Logger.log('Net Cash: ' + costDeltaSum);
  Logger.log('Output written: ' + results.length + ' rows');
}

// ═══════════════════════════════════════════════════════════════
// RefCPI lookup
// ═══════════════════════════════════════════════════════════════

function lookupRefCPI(settlementDate, refCPIData) {
  // Column A (index 0) = date, Column B (index 1) = refCPI
  // Find closest date match
  const targetTime = new Date(settlementDate).setHours(0, 0, 0, 0);
  
  for (let i = 1; i < refCPIData.length; i++) {
    if (!refCPIData[i][0]) continue;
    const rowDate = new Date(refCPIData[i][0]).setHours(0, 0, 0, 0);
    if (rowDate === targetTime) {
      return refCPIData[i][1];
    }
  }
  
  throw new Error('Could not find refCPI for settlement date: ' + settlementDate);
}

// ═══════════════════════════════════════════════════════════════
// STEP 1: Gap Parameters
// ═══════════════════════════════════════════════════════════════

function calculateGapParameters(gapYears, settlementDate, refCPI, tipssaoData, tipsrefData, DARA, holdings) {
  const holdingsByYear = {};
  for (const h of holdings) {
    if (!holdingsByYear[h.year]) holdingsByYear[h.year] = [];
    holdingsByYear[h.year].push(h);
  }
  
  let futureFrom2041Plus = 0;
  for (const year in holdingsByYear) {
    if (parseInt(year) > 2040) {
      for (const h of holdingsByYear[year]) {
        const coupon = lookupValue(h.cusip, tipssaoData, 0, 2);
        const refCPIOnDated = lookupValue(h.cusip, tipsrefData, 0, 1, refCPI);
        const indexRatio = refCPI / refCPIOnDated;
        futureFrom2041Plus += h.qty * 1000 * indexRatio * coupon;
      }
    }
  }
  
  const tips2040 = holdingsByYear[2040] ? holdingsByYear[2040][0] : null;
  if (!tips2040) throw new Error('No holdings found for 2040');
  
  const piPerBond2040 = calculatePIPerBond(tips2040.cusip, tips2040.maturity, refCPI, tipssaoData, tipsrefData);
  const targetQty2040 = Math.round((DARA - futureFrom2041Plus) / piPerBond2040);
  
  const coupon2040 = lookupValue(tips2040.cusip, tipssaoData, 0, 2);
  const refCPIOnDated2040 = lookupValue(tips2040.cusip, tipsrefData, 0, 1, refCPI);
  const indexRatio2040 = refCPI / refCPIOnDated2040;
  const annualInterest2040 = targetQty2040 * 1000 * indexRatio2040 * coupon2040;
  
  const gapFutureInterest = { 2040: annualInterest2040 };
  for (const year in holdingsByYear) {
    if (parseInt(year) > 2040) {
      gapFutureInterest[year] = 0;
      for (const h of holdingsByYear[year]) {
        const coupon = lookupValue(h.cusip, tipssaoData, 0, 2);
        const refCPIOnDated = lookupValue(h.cusip, tipsrefData, 0, 1, refCPI);
        const indexRatio = refCPI / refCPIOnDated;
        gapFutureInterest[year] += h.qty * 1000 * indexRatio * coupon;
      }
    }
  }
  
  const minGapYear = Math.min(...gapYears);
  const maxGapYear = Math.max(...gapYears);
  let anchorBefore = null, anchorAfter = null;
  
  for (let i = 1; i < tipssaoData.length; i++) {
    if (!tipssaoData[i][1]) continue;
    const mat = new Date(tipssaoData[i][1]);
    const year = mat.getFullYear();
    const month = mat.getMonth() + 1;
    if (year === minGapYear - 1 && month === 1) {
      anchorBefore = { maturity: tipssaoData[i][1], yield: tipssaoData[i][5] };
    }
    if (year === maxGapYear + 1 && month === 2) {
      anchorAfter = { maturity: tipssaoData[i][1], yield: tipssaoData[i][5] };
    }
  }
  if (!anchorBefore || !anchorAfter) throw new Error('Could not find interpolation anchors');
  
  let totalDuration = 0, totalCost = 0, count = 0;
  const sortedGapYears = [...gapYears].sort((a, b) => b - a);
  
  for (const year of sortedGapYears) {
    const syntheticMat = new Date(year, 1, 15);
    const syntheticYield = anchorBefore.yield +
      (syntheticMat - anchorBefore.maturity) * (anchorAfter.yield - anchorBefore.yield) /
      (anchorAfter.maturity - anchorBefore.maturity);
    const syntheticCoupon = Math.max(0.00125, Math.floor(syntheticYield * 100 / 0.125) * 0.00125);
    
    totalDuration += calculateMDuration(settlementDate, syntheticMat, syntheticCoupon, syntheticYield);
    
    let sumFutureInterest = 0;
    for (const futYear in gapFutureInterest) {
      if (parseInt(futYear) > year) sumFutureInterest += gapFutureInterest[futYear];
    }
    
    const piPerBond = 1000 + 1000 * syntheticCoupon * 0.5;
    const qty = Math.round((DARA - sumFutureInterest) / piPerBond);
    totalCost += qty * 1000;
    
    count++;
  }
  
  return { avgDuration: totalDuration / count, totalCost: totalCost };
}

// ═══════════════════════════════════════════════════════════════
// STEP 2: Identify Brackets
// ═══════════════════════════════════════════════════════════════

function identifyBrackets(gapYears, holdings, yearInfo) {
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
      maxQty = h.qty;
      lowerYear = h.year;
      lowerMaturity = h.maturity;
      lowerCUSIP = h.cusip;
    }
  }
  
  if (!lowerYear) {
    throw new Error('Could not find lower bracket maturity between ' + LOWEST_LOWER_BRACKET_YEAR + ' and ' + (minGapYear - 1));
  }
  
  Logger.log('Lower bracket: year=' + lowerYear + ', CUSIP=' + lowerCUSIP + ', qty=' + maxQty);
  
  return { lowerYear, lowerMaturity, lowerCUSIP, upperYear, upperMaturity, upperCUSIP };
}

// ═══════════════════════════════════════════════════════════════
// Helper: P+I per bond (Tier 1b)
// ═══════════════════════════════════════════════════════════════

function calculatePIPerBond(cusip, maturity, refCPI, tipssaoData, tipsrefData) {
  const coupon = lookupValue(cusip, tipssaoData, 0, 2);
  const refCPIOnDated = lookupValue(cusip, tipsrefData, 0, 1, refCPI);
  const indexRatio = refCPI / refCPIOnDated;
  const adjustedPrincipal = 1000 * indexRatio;
  const adjustedAnnualInterest = adjustedPrincipal * coupon;
  const monthF = new Date(maturity).getMonth() + 1;
  const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
  return adjustedPrincipal + lastYearInterest;
}

// ═══════════════════════════════════════════════════════════════
// Duration calculations
// ═══════════════════════════════════════════════════════════════

function calculateMDuration(settlement, maturity, coupon, yld) {
  return calculateDuration(settlement, maturity, coupon, yld) / (1 + yld / 2);
}

function calculateDuration(settlement, maturity, coupon, yld) {
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

function getNumPeriods(settlement, maturity) {
  const months = (maturity.getFullYear() - settlement.getFullYear()) * 12 +
                 (maturity.getMonth() - settlement.getMonth());
  return Math.ceil(months / 6);
}

// ═══════════════════════════════════════════════════════════════
// Lookup helpers
// ═══════════════════════════════════════════════════════════════

function lookupValue(lookupVal, data, keyCol, returnCol, defaultVal = '') {
  for (let i = 1; i < data.length; i++) {
    if (data[i][keyCol] === lookupVal) return data[i][returnCol];
  }
  return defaultVal;
}
function testDurationMatching() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Get source sheets
  const ladderSheet = ss.getSheetByName('LadderBuilder');
  const holdingsSheet = ss.getSheetByName('Holdings');
  const tipssaoSheet = ss.getSheetByName('TIPSSAO');
  const tipsrefSheet = ss.getSheetByName('TIPSref');
  
  // Get parameters
  const DARA = ladderSheet.getRange('B2').getValue();
  const refCPI = ladderSheet.getRange('B29').getValue();
  const settlementDate = ladderSheet.getRange('B28').getValue();
  
  // Get expected values from LadderBuilder
  const expectedLowerMat = ladderSheet.getRange('B16').getValue();
  const expectedUpperMat = ladderSheet.getRange('C16').getValue();
  const expectedLowerDur = ladderSheet.getRange('B17').getValue();
  const expectedUpperDur = ladderSheet.getRange('C17').getValue();
  const expectedLowerWeight = ladderSheet.getRange('B18').getValue();
  const expectedUpperWeight = ladderSheet.getRange('C18').getValue();
  const expectedLowerTargetExcessCost = ladderSheet.getRange('B19').getValue();
  const expectedUpperTargetExcessCost = ladderSheet.getRange('C19').getValue();
  const expectedLowerCostPerBond = ladderSheet.getRange('B20').getValue();
  const expectedUpperCostPerBond = ladderSheet.getRange('C20').getValue();
  const expectedLowerTargetExcessQty = ladderSheet.getRange('B21').getValue();
  const expectedUpperTargetExcessQty = ladderSheet.getRange('C21').getValue();
  const expectedLowerFundedQty = ladderSheet.getRange('B23').getValue();
  const expectedUpperFundedQty = ladderSheet.getRange('C23').getValue();
  const expectedLowerTotalQty = ladderSheet.getRange('B25').getValue();
  const expectedUpperTotalQty = ladderSheet.getRange('C25').getValue();
  const expectedGapAvgDur = ladderSheet.getRange('B12').getValue();
  const expectedGapTotalCost = ladderSheet.getRange('B13').getValue();
  
  // Get data
  const holdingsData = holdingsSheet.getDataRange().getValues();
  const tipssaoData = tipssaoSheet.getDataRange().getValues();
  const tipsrefData = tipsrefSheet.getDataRange().getValues();
  
  // Build holdings list
  const holdings = [];
  for (let i = 1; i < holdingsData.length; i++) {
    if (holdingsData[i][0]) {
      holdings.push({
        cusip: holdingsData[i][0],
        qty: holdingsData[i][1],
        maturity: holdingsData[i][3],
        year: new Date(holdingsData[i][3]).getFullYear()
      });
    }
  }
  
  // Accumulate future interest by year
  holdings.sort((a, b) => b.maturity - a.maturity);
  const futureInterestByYear = {};
  
  for (let h of holdings) {
    const coupon = lookupValue(h.cusip, tipssaoData, 0, 2);
    const refCPIOnDated = lookupValue(h.cusip, tipsrefData, 0, 1, refCPI);
    const indexRatio = refCPI / refCPIOnDated * 1000;
    const annualInterestY = h.qty * coupon * indexRatio;
    
    if (!futureInterestByYear[h.year]) {
      futureInterestByYear[h.year] = 0;
    }
    futureInterestByYear[h.year] += annualInterestY;
  }
  
  Logger.log('=== STEP 1: Gap Parameters ===');
  const gapYears = [2037, 2038, 2039];
  
  // Calculate future interest for gap years:
  // Use actual holdings for years > 2040
  // Use target qty for year 2040 (based on DARA)
  
  // Step 1: Get annual interest from actual holdings 2041-2055
  let futureFrom2041Plus = 0;
  for (let year in futureInterestByYear) {
    if (parseInt(year) > 2040) {
      futureFrom2041Plus += futureInterestByYear[year];
    }
  }
  
  Logger.log('Annual interest from 2041-2055 (actual holdings): ' + Math.round(futureFrom2041Plus));
  
  // Step 2: Calculate target qty for 2040
  const tips2040 = holdings.find(h => h.year === 2040);
  const coupon2040 = lookupValue(tips2040.cusip, tipssaoData, 0, 2);
  const refCPIOnDated2040 = lookupValue(tips2040.cusip, tipsrefData, 0, 1, refCPI);
  const indexRatio2040 = refCPI / refCPIOnDated2040 * 1000;
  const monthF2040 = new Date(tips2040.maturity).getMonth() + 1;
  const janJunAdjust2040 = monthF2040 < 7 ? 0.5 : 0;
  const semiAnnualInterest2040 = coupon2040 * indexRatio2040 * (1 - janJunAdjust2040);
  const piPerBond2040 = indexRatio2040 + semiAnnualInterest2040;
  
  const targetPI2040 = DARA - futureFrom2041Plus;
  const targetQty2040 = Math.round(targetPI2040 / piPerBond2040);
  const annualInterest2040 = targetQty2040 * coupon2040 * indexRatio2040;
  
  Logger.log('Target P+I for 2040: ' + Math.round(targetPI2040));
  Logger.log('P+I per bond 2040: ' + Math.round(piPerBond2040));
  Logger.log('Target qty 2040: ' + targetQty2040);
  Logger.log('Annual interest 2040 (target qty): ' + Math.round(annualInterest2040));
  
  // Step 3: Future interest for gap years = 2041+ actual + 2040 target
  const gapFutureInterestByYear = {
    2040: annualInterest2040
  };
  for (let year in futureInterestByYear) {
    if (parseInt(year) > 2040) {
      gapFutureInterestByYear[year] = futureInterestByYear[year];
    }
  }
  
  const totalFutureFor2039 = futureFrom2041Plus + annualInterest2040;
  Logger.log('Total future interest for 2039: ' + Math.round(totalFutureFor2039));
  
  // Calculate gap parameters using this future interest
  const gapParams = calculateGapParametersTest(gapYears, settlementDate, refCPI, tipssaoData, tipsrefData, DARA, gapFutureInterestByYear);
  
  Logger.log('Calculated gap avg duration: ' + gapParams.avgDuration);
  Logger.log('Expected gap avg duration: ' + expectedGapAvgDur);
  Logger.log('Match: ' + (Math.abs(gapParams.avgDuration - expectedGapAvgDur) < 0.01));
  
  Logger.log('Calculated gap total cost: ' + gapParams.totalCost);
  Logger.log('Expected gap total cost: ' + expectedGapTotalCost);
  Logger.log('Match: ' + (Math.abs(gapParams.totalCost - expectedGapTotalCost) < 100));
  
  Logger.log('\n=== STEP 2: Bracket Identification ===');
  
  // Hard-code for now
  const lowerYear = 2032;
  const upperYear = 2040;
  
  // Find Jul 2032 (maturity with most holdings in 2032)
  let lowerCUSIP = null;
  let lowerMaturity = null;
  for (let h of holdings) {
    if (h.year === lowerYear && new Date(h.maturity).getMonth() === 6) { // July
      lowerCUSIP = h.cusip;
      lowerMaturity = h.maturity;
    }
  }
  
  // Find Feb 2040
  let upperCUSIP = null;
  let upperMaturity = null;
  for (let h of holdings) {
    if (h.year === upperYear) {
      upperCUSIP = h.cusip;
      upperMaturity = h.maturity;
    }
  }
  
  Logger.log('Lower bracket: ' + lowerMaturity + ' (CUSIP: ' + lowerCUSIP + ')');
  Logger.log('Expected: ' + expectedLowerMat);
  Logger.log('Match: ' + (new Date(lowerMaturity).getTime() === new Date(expectedLowerMat).getTime()));
  
  Logger.log('Upper bracket: ' + upperMaturity + ' (CUSIP: ' + upperCUSIP + ')');
  Logger.log('Expected: ' + expectedUpperMat);
  Logger.log('Match: ' + (new Date(upperMaturity).getTime() === new Date(expectedUpperMat).getTime()));
  
  Logger.log('\n=== STEP 3: Duration Calculations ===');
  
  const lowerCoupon = lookupValue(lowerCUSIP, tipssaoData, 0, 2);
  const lowerYield = lookupValue(lowerCUSIP, tipssaoData, 0, 5);
  const lowerDuration = calculateMDuration(settlementDate, lowerMaturity, lowerCoupon, lowerYield);
  
  Logger.log('Calculated lower duration: ' + lowerDuration);
  Logger.log('Expected lower duration: ' + expectedLowerDur);
  Logger.log('Match: ' + (Math.abs(lowerDuration - expectedLowerDur) < 0.01));
  
  const upperCoupon = lookupValue(upperCUSIP, tipssaoData, 0, 2);
  const upperYield = lookupValue(upperCUSIP, tipssaoData, 0, 5);
  const upperDuration = calculateMDuration(settlementDate, upperMaturity, upperCoupon, upperYield);
  
  Logger.log('Calculated upper duration: ' + upperDuration);
  Logger.log('Expected upper duration: ' + expectedUpperDur);
  Logger.log('Match: ' + (Math.abs(upperDuration - expectedUpperDur) < 0.01));
  
  Logger.log('\n=== STEP 4: Weights ===');
  
  const lowerWeight = (upperDuration - gapParams.avgDuration) / (upperDuration - lowerDuration);
  const upperWeight = 1 - lowerWeight;
  
  Logger.log('Calculated lower weight: ' + lowerWeight);
  Logger.log('Expected lower weight: ' + expectedLowerWeight);
  Logger.log('Match: ' + (Math.abs(lowerWeight - expectedLowerWeight) < 0.01));
  
  Logger.log('Calculated upper weight: ' + upperWeight);
  Logger.log('Expected upper weight: ' + expectedUpperWeight);
  Logger.log('Match: ' + (Math.abs(upperWeight - expectedUpperWeight) < 0.01));
  
  Logger.log('\n=== STEP 5: Target Excess ===');
  
  const lowerTargetExcessCost = gapParams.totalCost * lowerWeight;
  const upperTargetExcessCost = gapParams.totalCost * upperWeight;
  
  Logger.log('Calculated lower target excess $: ' + lowerTargetExcessCost);
  Logger.log('Expected lower target excess $: ' + expectedLowerTargetExcessCost);
  Logger.log('Match: ' + (Math.abs(lowerTargetExcessCost - expectedLowerTargetExcessCost) < 100));
  
  Logger.log('Calculated upper target excess $: ' + upperTargetExcessCost);
  Logger.log('Expected upper target excess $: ' + expectedUpperTargetExcessCost);
  Logger.log('Match: ' + (Math.abs(upperTargetExcessCost - expectedUpperTargetExcessCost) < 100));
  
  Logger.log('\n=== STEP 6: Cost Per Bond ===');
  
  const lowerPrice = lookupValue(lowerCUSIP, tipssaoData, 0, 6);
  const lowerRefCPIOnDated = lookupValue(lowerCUSIP, tipsrefData, 0, 1, refCPI);
  const lowerIndexRatio = refCPI / lowerRefCPIOnDated * 1000;
  const lowerCostPerBond = lowerPrice / 100 * lowerIndexRatio;
  
  Logger.log('Calculated lower cost per bond: ' + lowerCostPerBond);
  Logger.log('Expected lower cost per bond: ' + expectedLowerCostPerBond);
  Logger.log('Match: ' + (Math.abs(lowerCostPerBond - expectedLowerCostPerBond) < 1));
  
  const upperPrice = lookupValue(upperCUSIP, tipssaoData, 0, 6);
  const upperRefCPIOnDated = lookupValue(upperCUSIP, tipsrefData, 0, 1, refCPI);
  const upperIndexRatio = refCPI / upperRefCPIOnDated * 1000;
  const upperCostPerBond = upperPrice / 100 * upperIndexRatio;
  
  Logger.log('Calculated upper cost per bond: ' + upperCostPerBond);
  Logger.log('Expected upper cost per bond: ' + expectedUpperCostPerBond);
  Logger.log('Match: ' + (Math.abs(upperCostPerBond - expectedUpperCostPerBond) < 1));
  
  Logger.log('\n=== STEP 7: Target Excess Qty ===');
  
  const lowerTargetExcessQty = Math.round(lowerTargetExcessCost / lowerCostPerBond);
  const upperTargetExcessQty = Math.round(upperTargetExcessCost / upperCostPerBond);
  
  Logger.log('Calculated lower target excess qty: ' + lowerTargetExcessQty);
  Logger.log('Expected lower target excess qty: ' + expectedLowerTargetExcessQty);
  Logger.log('Match: ' + (lowerTargetExcessQty === expectedLowerTargetExcessQty));
  
  Logger.log('Calculated upper target excess qty: ' + upperTargetExcessQty);
  Logger.log('Expected upper target excess qty: ' + expectedUpperTargetExcessQty);
  Logger.log('Match: ' + (upperTargetExcessQty === expectedUpperTargetExcessQty));
  
  Logger.log('\n=== TEST COMPLETE ===');
}

function calculateGapParametersTest(gapYears, settlementDate, refCPI, tipssaoData, tipsrefData, DARA, futureInterestByYear) {
  // Same as main function but for testing
  const minGapYear = Math.min(...gapYears);
  const maxGapYear = Math.max(...gapYears);
  
  let anchorBefore = null;
  let anchorAfter = null;
  
  for (let i = 1; i < tipssaoData.length; i++) {
    if (tipssaoData[i][1]) {
      const mat = new Date(tipssaoData[i][1]);
      const year = mat.getFullYear();
      const month = mat.getMonth() + 1;
      
      if (year === minGapYear - 1 && month === 1) {
        anchorBefore = {
          year: year,
          maturity: tipssaoData[i][1],
          yield: tipssaoData[i][5]
        };
      }
      if (year === maxGapYear + 1 && month === 2) {
        anchorAfter = {
          year: year,
          maturity: tipssaoData[i][1],
          yield: tipssaoData[i][5]
        };
      }
    }
  }
  
  let totalDuration = 0;
  let totalCost = 0;
  let count = 0;
  
  // Process gap years from longest to shortest to accumulate future interest correctly
  const sortedGapYears = [...gapYears].sort((a, b) => b - a);
  
  Logger.log('\n--- Gap Year Calculations (processing ' + sortedGapYears.join(', ') + ') ---');
  
  for (let year of sortedGapYears) {
    const syntheticMat = new Date(year, 0, 15);
    const syntheticYield = anchorBefore.yield + 
      (syntheticMat - anchorBefore.maturity) * (anchorAfter.yield - anchorBefore.yield) / 
      (anchorAfter.maturity - anchorBefore.maturity);
    const syntheticCoupon = Math.max(0.00125, Math.floor(syntheticYield * 100 / 0.125) * 0.00125);
    
    const mdur = calculateMDuration(settlementDate, syntheticMat, syntheticCoupon, syntheticYield);
    totalDuration += mdur;
    
    let sumFutureInterest = 0;
    for (let futYear in futureInterestByYear) {
      if (parseInt(futYear) > year) {
        sumFutureInterest += futureInterestByYear[futYear];
      }
    }
    
    const indexRatio = 1000;
    const monthF = 1;
    const janJunAdjust = 0.5;
    const semiAnnualInterest = syntheticCoupon * indexRatio * (1 - janJunAdjust);
    const piPerBond = indexRatio + semiAnnualInterest;
    
    const qty = Math.round((DARA - sumFutureInterest) / piPerBond);
    const cost = qty * 1000;
    const annualInterest = qty * syntheticCoupon * indexRatio;
    
    Logger.log('Gap year ' + year + ':');
    Logger.log('  Yield: ' + (syntheticYield * 100).toFixed(2) + '%');
    Logger.log('  Coupon: ' + (syntheticCoupon * 100).toFixed(2) + '%');
    Logger.log('  Duration: ' + mdur.toFixed(2));
    Logger.log('  Future interest: ' + sumFutureInterest.toFixed(2));
    Logger.log('  DARA - future: ' + (DARA - sumFutureInterest).toFixed(2));
    Logger.log('  P+I per bond: ' + piPerBond.toFixed(2));
    Logger.log('  Qty: ' + qty);
    Logger.log('  Cost: ' + cost);
    Logger.log('  Annual interest: ' + annualInterest.toFixed(2));
    
    totalCost += cost;
    
    // DON'T add gap year interest to futureInterestByYear
    // Gap years only use future interest from REAL holdings
    count++;
  }
  
  return {
    avgDuration: totalDuration / count,
    totalCost: totalCost
  };
}

function calculateMDuration(settlement, maturity, coupon, yld) {
  const dur = calculateDuration(settlement, maturity, coupon, yld);
  return dur / (1 + yld / 2);
}

function calculateDuration(settlement, maturity, coupon, yld) {
  const settle = new Date(settlement);
  const mature = new Date(maturity);
  const periods = getNumPeriods(settle, mature);
  
  let weightedSum = 0;
  let pvSum = 0;
  
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

function lookupValue(lookupVal, data, keyCol, returnCol, defaultVal = '') {
  for (let i = 1; i < data.length; i++) {
    if (data[i][keyCol] === lookupVal) {
      return data[i][returnCol];
    }
  }
  return defaultVal;
}
function buildHoldingsLadder() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const outputSheet = ss.getSheetById(2101886695);
  
  if (!outputSheet) {
    throw new Error('Output sheet with gid 2101886695 not found');
  }
  
  // Get source sheets
  const ladderSheet = ss.getSheetByName('LadderBuilder');
  const holdingsSheet = ss.getSheetByName('Holdings');
  const tipssaoSheet = ss.getSheetByName('TIPSSAO');
  const tipsrefSheet = ss.getSheetByName('TIPSref');
  
  // Get parameters
  const DARA = ladderSheet.getRange('B2').getValue();
  const firstYear = ladderSheet.getRange('B3').getValue();
  const lastYear = ladderSheet.getRange('B4').getValue();
  
  // Get Holdings data
  const holdingsData = holdingsSheet.getDataRange().getValues();
  
  // Get TIPSSAO data
  const tipssaoData = tipssaoSheet.getDataRange().getValues();
  
  // Get TIPSref data  
  const tipsrefData = tipsrefSheet.getDataRange().getValues();
  
  // Get refCPI and settlement date
  const refCPI = ladderSheet.getRange('B29').getValue();
  const settlementDate = ladderSheet.getRange('B28').getValue();
  
  // Clear output range
  const numRows = 50;
  outputSheet.getRange(1, 1, numRows, 8).clearContent();
  
  // Build list of holdings with their data
  const holdings = [];
  
  for (let i = 1; i < holdingsData.length; i++) {
    if (holdingsData[i][0]) { // Has CUSIP
      const cusip = holdingsData[i][0];
      const qty = holdingsData[i][1];
      const maturity = holdingsData[i][3];
      const maturityYear = new Date(maturity).getFullYear();
      
      holdings.push({
        cusip: cusip,
        qty: qty,
        maturity: maturity,
        year: maturityYear
      });
    }
  }
  
  // Sort by maturity ascending for output order
  holdings.sort((a, b) => a.maturity - b.maturity);
  
  // Group holdings by year and find indices
  const yearInfo = {}; // { year: { firstIdx, lastIdx, holdings: [] } }
  
  holdings.forEach((h, idx) => {
    if (!yearInfo[h.year]) {
      yearInfo[h.year] = {
        firstIdx: idx,
        lastIdx: idx,
        holdings: []
      };
    }
    yearInfo[h.year].lastIdx = idx;
    yearInfo[h.year].holdings.push(h);
  });
  
  // Process holdings in REVERSE order (longest maturity first) to accumulate future interest
  const results = [];
  const futureInterestByYear = {}; // Annual interest aggregated by year
  
  for (let i = holdings.length - 1; i >= 0; i--) {
    const h = holdings[i];
    const isLastInYear = yearInfo[h.year].lastIdx === i;
    
    // Calculate sum of future annual interest (from all later YEARS)
    let sumFutureAnnualInterest = 0;
    for (let year in futureInterestByYear) {
      if (parseInt(year) > h.year) {
        sumFutureAnnualInterest += futureInterestByYear[year];
      }
    }
    
    // Calculate aggregates for this year (sum across all holdings in the year)
    let yearPrincipalFY = 0;
    let yearCostFY = 0;
    let yearSemiAnnualInterestFY = 0;
    
    if (isLastInYear) {
      // Sum up principal, cost, and semi-annual interest for all holdings in this year
      for (let holding of yearInfo[h.year].holdings) {
        // Look up data for each holding
        const coupon = lookupValue(holding.cusip, tipssaoData, 0, 2);
        const price = lookupValue(holding.cusip, tipssaoData, 0, 6);
        const refCPIOnDated = lookupValue(holding.cusip, tipsrefData, 0, 1, refCPI);
        const indexRatio = refCPI / refCPIOnDated * 1000;
        
        // Principal
        yearPrincipalFY += holding.qty * indexRatio;
        
        // Annual interest for this holding
        const annualInterestY = holding.qty * coupon * indexRatio;
        
        // Semi-annual interest for this holding
        const monthF = new Date(holding.maturity).getMonth() + 1;
        const janJunAdjust = monthF < 7 ? 0.5 : 0;
        yearSemiAnnualInterestFY += annualInterestY * (1 - janJunAdjust);
        
        // Cost
        const inflAdjPrice = price / 100 * indexRatio;
        const principalCost = holding.qty * inflAdjPrice;
        /*
        const coupdaybs = getCoupdaybs(settlementDate, holding.maturity);
        const coupdays = getCoupdays(settlementDate, holding.maturity);
        const accruedInterest = coupdaybs / coupdays * coupon / 2 * holding.qty * indexRatio;
        */
        yearCostFY += principalCost // + accruedInterest;
      }
    }
    
    const row = buildHoldingRow(h, {
      DARA, firstYear, lastYear, refCPI, settlementDate,
      tipssaoData, tipsrefData,
      futureInterest: sumFutureAnnualInterest,
      isLastInYear: isLastInYear,
      yearPrincipalFY: yearPrincipalFY,
      yearSemiAnnualInterestFY: yearSemiAnnualInterestFY,
      yearCostFY: yearCostFY
    });
    
    // Accumulate annual interest by year (sum for entire year)
    if (!futureInterestByYear[h.year]) {
      futureInterestByYear[h.year] = 0;
    }
    futureInterestByYear[h.year] += row.annualInterestY;
    
    // Store result at beginning (since we're processing in reverse)
    results.unshift([
      row.cusip,
      row.qty,
      row.maturity,
      row.fy,
      row.principalFY,
      row.interestFY,
      row.araFY,
      row.costFY
    ]);
  }
  
  // Results are now in ascending order by maturity
  // Write headers and data
  const headers = [['CUSIP', 'Qty', 'Maturity', 'FY', 'Principal FY', 'Interest FY', 'ARA FY', 'Cost FY']];
  outputSheet.getRange(1, 1, 1, 8).setValues(headers);
  outputSheet.getRange(2, 1, results.length, 8).setValues(results);
}

function buildHoldingRow(holding, params) {
  const { DARA, firstYear, lastYear, refCPI, settlementDate,
          tipssaoData, tipsrefData, futureInterest, isLastInYear, 
          yearPrincipalFY, yearSemiAnnualInterestFY, yearCostFY } = params;
  
  const row = {};
  
  row.cusip = holding.cusip;
  row.qty = holding.qty;
  row.maturity = holding.maturity;
  
  // Look up TIPS data from TIPSSAO
  const coupon = lookupValue(holding.cusip, tipssaoData, 0, 2);
  const yield_sao = lookupValue(holding.cusip, tipssaoData, 0, 5);
  const price = lookupValue(holding.cusip, tipssaoData, 0, 6);
  
  // Get index ratio
  const refCPIOnDated = lookupValue(holding.cusip, tipsrefData, 0, 1, refCPI);
  const indexRatio = refCPI / refCPIOnDated * 1000;
  
  // Calculate annual interest for this holding (used for accumulation)
  row.annualInterestY = holding.qty * coupon * indexRatio;
  
  // Only populate FY columns if this is the last maturity in the year
  if (isLastInYear) {
    row.fy = holding.year;
    
    // Principal FY (sum for entire year)
    row.principalFY = yearPrincipalFY;
    
    // Total interest = semi-annual interest (for all holdings in year) + future interest
    row.interestFY = yearSemiAnnualInterestFY + futureInterest;
    
    // ARA FY
    row.araFY = row.principalFY + row.interestFY;
    
    // Cost FY (sum for entire year)
    row.costFY = yearCostFY;
    
  } else {
    row.fy = '';
    row.principalFY = '';
    row.interestFY = '';
    row.araFY = '';
    row.costFY = '';
  }
  
  return row;
}

// Helper functions
function lookupValue(lookupVal, data, keyCol, returnCol, defaultVal = '') {
  for (let i = 1; i < data.length; i++) {
    if (data[i][keyCol] === lookupVal) {
      return data[i][returnCol];
    }
  }
  return defaultVal;
}

function getCoupdaybs(settlement, maturity) {
  const lastCoupon = getPreviousCouponDate(settlement, maturity);
  return Math.floor((settlement - lastCoupon) / (1000 * 60 * 60 * 24));
}

function getCoupdays(settlement, maturity) {
  const lastCoupon = getPreviousCouponDate(settlement, maturity);
  const nextCoupon = getNextCouponDate(settlement, maturity);
  return Math.floor((nextCoupon - lastCoupon) / (1000 * 60 * 60 * 24));
}

function getPreviousCouponDate(settlement, maturity) {
  const mat = new Date(maturity);
  let coupon = new Date(mat);
  
  while (coupon > settlement) {
    coupon.setMonth(coupon.getMonth() - 6);
  }
  return coupon;
}

function getNextCouponDate(settlement, maturity) {
  const lastCoupon = getPreviousCouponDate(settlement, maturity);
  const nextCoupon = new Date(lastCoupon);
  nextCoupon.setMonth(nextCoupon.getMonth() + 6);
  return nextCoupon;
}
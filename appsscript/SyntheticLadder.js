function buildTIPSLadder() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const outputSheet = ss.getSheets().find(s => s.getSheetId() === 201966570);
  
  if (!outputSheet) {
    throw new Error('Output sheet with gid 201966570 not found');
  }
  
  // Get source sheets
  const ladderSheet = ss.getSheetByName('LadderBuilder');
  const tipssaoSheet = ss.getSheetByName('TIPSSAO');
  const tipsrefSheet = ss.getSheetByName('TIPSref');
  
  // Get parameters
  const DARA = ladderSheet.getRange('B2').getValue();
  const firstYear = ladderSheet.getRange('B3').getValue();
  const lastYear = ladderSheet.getRange('B4').getValue();
  
  // Get TIPSSAO data
  const tipssaoData = tipssaoSheet.getDataRange().getValues();
  
  // Get TIPSref data  
  const tipsrefData = tipsrefSheet.getDataRange().getValues();
  
  // Get refCPI from B29
  const refCPI = ladderSheet.getRange('B29').getValue();
  
  // Get settlement date from B28
  const settlementDate = ladderSheet.getRange('B28').getValue();
  
  // Clear output range only
  const numRows = 50;
  outputSheet.getRange(1, 1, numRows, 9).clearContent();
  
  // Find last row where maturity year <= lastYear
  let lastTipssaoRow = -1;
  for (let i = tipssaoData.length - 1; i >= 1; i--) {
    if (tipssaoData[i][0]) {
      const maturityYear = new Date(tipssaoData[i][1]).getFullYear();
      if (maturityYear <= lastYear) {
        lastTipssaoRow = i;
        break;
      }
    }
  }
  
  if (lastTipssaoRow < 0) {
    throw new Error('No TIPS found with maturity <= ' + lastYear);
  }
  
  // Find the anchor rows for interpolation (Jan 2036 and Feb 2040)
  let anchor2036Idx = -1;
  let anchor2040Idx = -1;
  
  for (let i = 1; i < tipssaoData.length; i++) {
    if (tipssaoData[i][0]) {
      const mat = new Date(tipssaoData[i][1]);
      const year = mat.getFullYear();
      const month = mat.getMonth() + 1;
      
      if (year === 2036 && month === 1) anchor2036Idx = i;
      if (year === 2040 && month === 2) anchor2040Idx = i;
    }
  }
  
  // Build list of all maturities to process
  const allMaturities = [];
  
  // Add regular TIPS - for years with multiple TIPS, only include the latest maturity
  const yearToLatestIndex = {}; // Track latest (highest index) for each year
  
  for (let i = lastTipssaoRow; i >= 1; i--) {
    const maturityDate = new Date(tipssaoData[i][1]);
    const maturityYear = maturityDate.getFullYear();
    
    // if (maturityYear < 2035) break;
    
    if (maturityYear >= firstYear && maturityYear <= lastYear) {
      // Track the latest maturity for this year (first one encountered going backwards)
      if (!yearToLatestIndex[maturityYear]) {
        yearToLatestIndex[maturityYear] = i;
      }
    }
  }
  
  // Add only the latest maturity for each year
  for (let year in yearToLatestIndex) {
    const i = yearToLatestIndex[year];
    allMaturities.push({
      type: 'regular',
      index: i,
      maturity: new Date(tipssaoData[i][1]),
      year: parseInt(year)
    });
  }
  
  // Add synthetic TIPS for 2037-2039
  if (anchor2036Idx >= 0 && anchor2040Idx >= 0) {
    for (let year = 2037; year <= 2039; year++) {
      allMaturities.push({
        type: 'synthetic',
        year: year,
        maturity: new Date(year, 0, 15)
      });
    }
  }
  
  // Sort by maturity descending (longest to shortest)
  allMaturities.sort((a, b) => b.maturity - a.maturity);
  
  // Process each maturity
  const results = [];
  const futureInterestByRow = {};
  
  for (let m of allMaturities) {
    // Calculate sum of future annual interest (everything processed so far)
    let sumFutureAnnualInterest = 0;
    for (let key in futureInterestByRow) {
      sumFutureAnnualInterest += futureInterestByRow[key];
    }
    
    let row;
    let annualInterestY;
    
    if (m.type === 'regular') {
      row = buildRow(m.index, {
        DARA, firstYear, lastYear, refCPI,
        tipssaoData, tipsrefData, futureInterest: sumFutureAnnualInterest,
        settlementDate: settlementDate
      });
      
      // Calculate and store annual interest (Y)
      if (row.qty !== '') {
        const coupon = tipssaoData[m.index][2];
        const refCPIOnDated = lookupValue(row.cusip, tipsrefData, 0, 1, refCPI);
        const indexRatio = refCPI / refCPIOnDated * 1000;
        annualInterestY = row.qty * coupon * indexRatio;
        futureInterestByRow[m.index] = annualInterestY;
      }
      
    } else {
      // Synthetic TIPS
      const mat2036 = new Date(tipssaoData[anchor2036Idx][1]);
      const yield2036 = tipssaoData[anchor2036Idx][5];
      const mat2040 = new Date(tipssaoData[anchor2040Idx][1]);
      const yield2040 = tipssaoData[anchor2040Idx][5];
      
      const syntheticYield = yield2036 + (m.maturity - mat2036) * (yield2040 - yield2036) / (mat2040 - mat2036);
      const syntheticCoupon = Math.max(0.00125, Math.floor(syntheticYield * 100 / 0.125) * 0.00125);
      
      row = buildSyntheticRow(m.year, m.maturity, syntheticCoupon, {
        DARA, firstYear, lastYear, refCPI,
        futureInterest: sumFutureAnnualInterest,
        settlementDate: settlementDate
      });
      
      // Calculate and store annual interest (Y)
      if (row.qty !== '') {
        const indexRatio = 1000;
        annualInterestY = row.qty * syntheticCoupon * indexRatio;
        futureInterestByRow['synthetic_' + m.year] = annualInterestY;
      }
    }
    
    results.push([row.cusip, row.qty, row.maturity, '', row.fy, row.principalFY, row.interestFY, row.araFY, row.costFY]);
  }
  
  // Sort by maturity ascending for output
  results.sort((a, b) => new Date(a[2]) - new Date(b[2]));
  
  // Write headers and data
  const headers = [['CUSIP', 'Qty', 'Maturity', '', 'FY', 'Principal FY', 'Interest FY', 'ARA FY', 'Cost FY']];
  outputSheet.getRange(1, 1, 1, 9).setValues(headers);
  outputSheet.getRange(2, 1, results.length, 9).setValues(results);
}

function buildRow(tipssaoRowIdx, params) {
  const { DARA, firstYear, lastYear, refCPI, tipssaoData, tipsrefData, futureInterest, settlementDate } = params;
  
  const row = {};
  
  // Get TIPS data from TIPSSAO
  row.cusip = tipssaoData[tipssaoRowIdx][0];
  row.maturity = tipssaoData[tipssaoRowIdx][1];
  const coupon = tipssaoData[tipssaoRowIdx][2];
  const yield_sao = tipssaoData[tipssaoRowIdx][5];
  const price = tipssaoData[tipssaoRowIdx][6];
  
  // Year
  const yearF = new Date(row.maturity).getFullYear();
  
  // Check if this year should be funded
  if (yearF >= firstYear && yearF <= lastYear) {
    row.fy = yearF;
    
    // K: Index ratio
    const refCPIOnDated = lookupValue(row.cusip, tipsrefData, 0, 1, refCPI);
    const indexRatio = refCPI / refCPIOnDated * 1000;
    
    // L: Semi-annual inflation-adjusted coupon
    const monthF = new Date(row.maturity).getMonth() + 1;
    const janJunAdjust = monthF < 7 ? 0.5 : 0;
    const semiAnnualCoupon = coupon * indexRatio * (1 - janJunAdjust);
    
    // M: Inflation-adjusted par + semi-annual coupon
    const inflAdjParPlusCoupon = indexRatio + semiAnnualCoupon;
    
    const sumFutureInterest = futureInterest || 0;
    
    // J: Quantity
    row.qty = Math.round((DARA - sumFutureInterest) / inflAdjParPlusCoupon);
    
    // Y: Annual interest
    const annualInterest = row.qty * coupon * indexRatio;
    
    // T: Semi-annual interest received in FY (formula: =Y * (1 - (MONTH($F) < 7) * 0.5))
    const semiAnnualInterestFY = annualInterest * (1 - janJunAdjust);
    
    // W: Total interest = T + V
    row.interestFY = semiAnnualInterestFY + sumFutureInterest;
    
    // S: Principal FY (par value)
    row.principalFY = row.qty * indexRatio;
    
    // X: ARA FY (Annual Real Amount)
    row.araFY = row.principalFY + row.interestFY;
    
    // O: Inflation-adjusted price
    const inflAdjPrice = price / 100 * indexRatio;
    
    // P: Principal cost
    const principalCost = row.qty * inflAdjPrice;
    
    // Q: Accrued interest
    const coupdaybs = getCoupdaybs(settlementDate, row.maturity);
    const coupdays = getCoupdays(settlementDate, row.maturity);
    const accruedInterest = coupdaybs / coupdays * coupon / 2 * row.qty * indexRatio;
    
    // R: Total cost = Principal + Accrued
    row.costFY = principalCost + accruedInterest;
    
    // Store for later duration matching
    row.principalCostOnly = principalCost;
    
  } else {
    row.fy = '';
    row.qty = '';
    row.principalFY = '';
    row.interestFY = '';
    row.araFY = '';
    row.costFY = '';
  }
  
  return row;
}

function buildSyntheticRow(year, maturityDate, coupon, params) {
  const { DARA, firstYear, lastYear, refCPI, futureInterest, settlementDate } = params;
  
  const row = {};
  row.cusip = 'Synthetic ' + year;
  row.maturity = maturityDate;
  row.fy = year;
  
  // Synthetic TIPS: Principal per bond assumed 1000
  const indexRatio = 1000;
  
  // L: Semi-annual inflation-adjusted coupon
  const monthF = maturityDate.getMonth() + 1;
  const janJunAdjust = monthF < 7 ? 0.5 : 0;
  const semiAnnualCoupon = coupon * indexRatio * (1 - janJunAdjust);
  
  // M: Inflation-adjusted par + semi-annual coupon
  const inflAdjParPlusCoupon = indexRatio + semiAnnualCoupon;
  
  const sumFutureInterest = futureInterest || 0;
  
  // J: Quantity
  row.qty = Math.round((DARA - sumFutureInterest) / inflAdjParPlusCoupon);
  
  // Y: Annual interest
  const annualInterest = row.qty * coupon * indexRatio;
  
  // T: Semi-annual interest received in FY
  const semiAnnualInterestFY = annualInterest * (1 - janJunAdjust);
  
  // W: Total interest
  row.interestFY = semiAnnualInterestFY + sumFutureInterest;
  
  // S: Principal FY (par value)
  row.principalFY = row.qty * indexRatio;
  
  // X: ARA FY
  row.araFY = row.principalFY + row.interestFY;
  
  // Cost: Adjusted ask price assumed 100%, so 1000 per bond
  const principalCost = row.qty * 1000;
  
  // Q: Accrued interest
  const coupdaybs = getCoupdaybs(settlementDate, maturityDate);
  const coupdays = getCoupdays(settlementDate, maturityDate);
  const accruedInterest = coupdaybs / coupdays * coupon / 2 * row.qty * indexRatio;
  
  // R: Total cost = Principal + Accrued
  row.costFY = principalCost + accruedInterest;
  row.principalCostOnly = principalCost;
  
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
/**
 * TIPS Synthetic Ladder Builder - Step 2
 * 
 * Builds theoretical ladder based on DARA inferred from holdings
 * Shows target quantities for all years including synthetic gap bonds
 * Output: LadderSynthetic sheet
 */

function buildSyntheticLadder() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Get sheets
  const holdingsSheet = ss.getSheets().find(s => s.getSheetId() === 162128331);
  const tipssaoSheet = ss.getSheets().find(s => s.getSheetId() === 147571825);
  const tipsrefSheet = ss.getSheets().find(s => s.getSheetId() === 246283495);
  const refCPISheet = ss.getSheets().find(s => s.getSheetId() === 237587759);
  
  if (!holdingsSheet || !tipssaoSheet || !tipsrefSheet || !refCPISheet) {
    throw new Error('One or more required sheets not found');
  }
  
  // Get or create LadderSynthetic sheet
  let syntheticSheet = ss.getSheetByName('LadderSynthetic');
  if (!syntheticSheet) {
    syntheticSheet = ss.insertSheet('LadderSynthetic');
  }
  
  // Get settlement date and CPI
  const settlementDate = tipssaoSheet.getRange('V2').getValue();
  const settlementCPI = tipssaoSheet.getRange('V3').getValue();
  
  console.log('Building synthetic ladder...');
  console.log('Settlement date:', settlementDate);
  console.log('Settlement CPI:', settlementCPI);
  
  // Read all holdings (same as before)
  const bonds = readBonds(holdingsSheet, tipssaoSheet, tipsrefSheet, settlementCPI);
  bonds.sort((a, b) => a.maturityYear - b.maturityYear);
  
  // Identify ladder structure
  const firstYear = bonds[0].maturityYear;
  const lastYear = bonds[bonds.length - 1].maturityYear;
  const fundedYears = new Set(bonds.map(b => b.maturityYear));
  
  // Find gaps
  const gapYears = [];
  for (let year = firstYear; year <= lastYear; year++) {
    if (!fundedYears.has(year)) {
      gapYears.push(year);
    }
  }
  
  // Identify bracket bonds
  const lowerBracketYear = identifyLowerBracket(bonds, gapYears);
  const upperBracketYear = Math.max(...gapYears) + 1;
  
  console.log(`Ladder: ${firstYear}-${lastYear}`);
  console.log(`Gaps: ${gapYears.join(', ')}`);
  console.log(`Lower bracket: ${lowerBracketYear}`);
  console.log(`Upper bracket: ${upperBracketYear}`);
  
  // Calculate DARA
  const totalARA = bonds.reduce((sum, b) => {
    const fullYearInt = b.coupon * b.K;
    const totalInt = b.L + (bonds.filter(later => later.maturityYear > b.maturityYear)
      .reduce((s, lb) => s + lb.qty * lb.coupon * lb.K, 0));
    return sum + (b.qty * b.K) + totalInt;
  }, 0);
  
  const numLadderYears = lastYear - firstYear + 1;
  const DARA = totalARA / numLadderYears;
  
  console.log(`Total ARA: $${totalARA.toFixed(0)}`);
  console.log(`Ladder years: ${numLadderYears}`);
  console.log(`DARA: $${DARA.toFixed(0)}`);
  
  // Get bracket bonds
  const lowerBracketBond = bonds.find(b => b.maturityYear === lowerBracketYear);
  const upperBracketBond = bonds.find(b => b.maturityYear === upperBracketYear);
  
  // Create synthetic gap bonds
  const syntheticGaps = gapYears.map(year =>
    createSyntheticGapBond(year, lowerBracketBond, upperBracketBond, settlementDate)
  );
  
  console.log('Synthetic gaps:', syntheticGaps.map(g => `${g.year}: mdur=${g.mdur.toFixed(3)}`).join(', '));
  
  // Build complete ladder (real + synthetic)
  const allYears = [];
  for (let year = firstYear; year <= lastYear; year++) {
    allYears.push(year);
  }
  
  // Calculate target quantities working backwards
  const targetQty = {};
  const yearData = {};
  
  for (let year = lastYear; year >= firstYear; year--) {
    // Calculate interest from all later years
    let intLater = 0;
    
    for (let laterYear = year + 1; laterYear <= lastYear; laterYear++) {
      if (gapYears.includes(laterYear)) {
        // Synthetic gap bond
        const gapBond = syntheticGaps.find(g => g.year === laterYear);
        const gapFullYearInt = gapBond.coupon * 1000; // K=1000 for synthetic
        intLater += (targetQty[laterYear] || 0) * gapFullYearInt;
      } else {
        // Real bond
        const laterBond = bonds.find(b => b.maturityYear === laterYear);
        if (laterBond) {
          const laterFullYearInt = laterBond.coupon * laterBond.K;
          intLater += (targetQty[laterYear] || 0) * laterFullYearInt;
        }
      }
    }
    
    // Get bond data for this year
    let bond, isGap = false;
    if (gapYears.includes(year)) {
      bond = syntheticGaps.find(g => g.year === year);
      isGap = true;
    } else {
      bond = bonds.find(b => b.maturityYear === year);
    }
    
    if (bond) {
      // Target P+I for this year
      const targetPI = DARA - intLater;
      
      // Calculate target qty
      if (isGap) {
        const M = 1000 + (bond.coupon * 1000 * 0.5); // Synthetic: K=1000, Jan maturity
        targetQty[year] = Math.round(targetPI / M);
      } else {
        const M = bond.K + bond.L;
        targetQty[year] = Math.round(targetPI / M);
      }
      
      // Store year data
      yearData[year] = {
        year,
        qty: targetQty[year],
        isGap,
        bond,
        intLater
      };
    }
  }
  
  // Write to sheet
  writeSyntheticLadder(syntheticSheet, yearData, allYears, DARA, gapYears, 
    lowerBracketYear, upperBracketYear, syntheticGaps);
  
  console.log('Synthetic ladder written');
}

/**
 * Identify lower bracket by finding year with highest quantity before first gap
 */
function identifyLowerBracket(bonds, gapYears) {
  const firstGap = Math.min(...gapYears);
  
  // Group bonds by year before first gap
  const yearQty = {};
  bonds.forEach(b => {
    if (b.maturityYear < firstGap) {
      yearQty[b.maturityYear] = (yearQty[b.maturityYear] || 0) + b.qty;
    }
  });
  
  // Find year with max quantity
  let maxQty = 0;
  let lowerBracket = 0;
  
  Object.entries(yearQty).forEach(([year, qty]) => {
    if (qty > maxQty) {
      maxQty = qty;
      lowerBracket = parseInt(year);
    }
  });
  
  return lowerBracket;
}

/**
 * Read bonds from holdings
 */
function readBonds(holdingsSheet, tipssaoSheet, tipsrefSheet, settlementCPI) {
  const holdingsData = holdingsSheet.getDataRange().getValues();
  const bonds = [];
  
  for (let i = 1; i < holdingsData.length; i++) {
    const cusip = holdingsData[i][0];
    const qty = holdingsData[i][1];
    
    if (!cusip || !qty) continue;
    
    const bondData = getBondData(tipssaoSheet, cusip);
    if (!bondData) continue;
    
    const datedCPI = getDatedCPI(tipsrefSheet, cusip);
    if (!datedCPI) continue;
    
    const maturityYear = bondData.maturity.getFullYear();
    const maturityMonth = bondData.maturity.getMonth() + 1;
    
    const K = (settlementCPI / datedCPI) * 1000;
    const L = bondData.coupon * K * (maturityMonth < 7 ? 0.5 : 1.0);
    const M = K + L;
    const O = (bondData.askPrice / 100) * K;
    
    bonds.push({
      cusip,
      qty,
      maturityYear,
      maturityMonth,
      maturity: bondData.maturity,
      coupon: bondData.coupon,
      yieldValue: bondData.yieldValue,
      askPrice: bondData.askPrice,
      mdur: bondData.mdur,
      datedCPI,
      K, L, M, O
    });
  }
  
  return bonds;
}

/**
 * Create synthetic gap bond
 */
function createSyntheticGapBond(gapYear, lowerBond, upperBond, settlementDate) {
  const gapDate = new Date(gapYear, 0, 15); // January 15
  const lowerDate = lowerBond.maturity;
  const upperDate = upperBond.maturity;
  
  // Linear interpolation factor
  const t = (gapDate - lowerDate) / (upperDate - lowerDate);
  
  // Interpolate yield
  const yieldValue = lowerBond.yieldValue + t * (upperBond.yieldValue - lowerBond.yieldValue);
  
  // Calculate coupon (round down to 0.125%)
  const coupon = Math.max(0.00125, Math.floor(yieldValue / 0.00125) * 0.00125);
  
  // Calculate modified duration
  const mdur = calculateModifiedDuration(settlementDate, gapDate, coupon, yieldValue, 2, 1);
  
  return {
    year: gapYear,
    maturity: gapDate,
    coupon,
    yieldValue,
    mdur,
    K: 1000,  // Par for synthetic
    L: coupon * 1000 * 0.5  // January maturity
  };
}

/**
 * Calculate Modified Duration (from previous script)
 */
function calculateModifiedDuration(settlement, maturity, coupon, yld, frequency, basis) {
  const couponDates = getCouponDates(settlement, maturity, frequency);
  
  if (couponDates.length === 0) {
    return 0;
  }
  
  const couponPayment = (coupon / frequency) * 100;
  const redemption = 100;
  const yieldPerPeriod = yld / frequency;
  
  const nextCouponDate = couponDates[0];
  const prevCouponDate = getPrevCouponDate(settlement, maturity, frequency);
  
  const daysSinceLastCoupon = (settlement - prevCouponDate) / (1000 * 60 * 60 * 24);
  const daysInPeriod = (nextCouponDate - prevCouponDate) / (1000 * 60 * 60 * 24);
  const E = 1 - (daysSinceLastCoupon / daysInPeriod);
  
  let weightedPV = 0;
  let totalPV = 0;
  
  for (let i = 0; i < couponDates.length; i++) {
    const isFinal = (i === couponDates.length - 1);
    const cashFlow = isFinal ? (couponPayment + redemption) : couponPayment;
    const periodsOut = E + i;
    const discountFactor = Math.pow(1 + yieldPerPeriod, -periodsOut);
    const pv = cashFlow * discountFactor;
    const timeInYears = periodsOut / frequency;
    
    weightedPV += timeInYears * pv;
    totalPV += pv;
  }
  
  const macaulayDuration = weightedPV / totalPV;
  const modifiedDuration = macaulayDuration / (1 + yieldPerPeriod);
  
  return modifiedDuration;
}

function getCouponDates(settlement, maturity, frequency) {
  const dates = [];
  const monthsPerPeriod = 12 / frequency;
  let couponDate = new Date(maturity);
  
  while (couponDate > settlement) {
    dates.unshift(couponDate);
    couponDate = new Date(couponDate);
    couponDate.setMonth(couponDate.getMonth() - monthsPerPeriod);
  }
  
  return dates;
}

function getPrevCouponDate(settlement, maturity, frequency) {
  const nextCoupon = getCouponDates(settlement, maturity, frequency)[0];
  const prevCoupon = new Date(nextCoupon);
  const monthsPerPeriod = 12 / frequency;
  prevCoupon.setMonth(prevCoupon.getMonth() - monthsPerPeriod);
  return prevCoupon;
}

function getBondData(tipssaoSheet, cusip) {
  const data = tipssaoSheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === cusip) {
      return {
        maturity: data[i][1],
        coupon: data[i][2],
        yieldValue: data[i][5],
        askPrice: data[i][6],
        mdur: data[i][15]
      };
    }
  }
  
  return null;
}

function getDatedCPI(tipsrefSheet, cusip) {
  const data = tipsrefSheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === cusip) {
      return data[i][1];
    }
  }
  
  return null;
}

/**
 * Write synthetic ladder to sheet
 */
function writeSyntheticLadder(sheet, yearData, allYears, DARA, gapYears, lowerBracket, upperBracket, syntheticGaps) {
  // Only clear output columns
  const lastRow = Math.max(100, sheet.getLastRow());
  if (lastRow > 0) {
    sheet.getRange(`A1:M${lastRow}`).clear();
  }
  
  // Headers
  sheet.getRange('A1:M1').setValues([[
    'FY',
    'Qty',
    'Principal',
    'Interest (last yr)',
    'P+I',
    '',
    'Interest later',
    'Interest total',
    'ARA',
    '',
    'Coupon',
    'Yield',
    'Mdur'
  ]]).setFontWeight('bold');
  
  let row = 2;
  
  // Write each year
  allYears.forEach(year => {
    const yd = yearData[year];
    if (!yd) return;
    
    const bond = yd.bond;
    const qty = yd.qty;
    
    // Calculate values
    const K = yd.isGap ? 1000 : bond.K;
    const L = yd.isGap ? bond.L : bond.L;
    const principal = qty * K;
    const intLastYear = qty * L;
    const PI = principal + intLastYear;
    const intLater = yd.intLater;
    const intTotal = intLastYear + intLater;
    const ARA = principal + intTotal;
    
    sheet.getRange(`A${row}:M${row}`).setValues([[
      year,
      qty,
      Math.round(principal),
      Math.round(intLastYear),
      Math.round(PI),
      '',
      Math.round(intLater),
      Math.round(intTotal),
      Math.round(ARA),
      '',
      bond.coupon,
      bond.yieldValue,
      yd.isGap ? bond.mdur : bond.mdur
    ]]);
    
    // Format numbers
    sheet.getRange(`C${row}:E${row}`).setNumberFormat('#,##0');
    sheet.getRange(`G${row}:I${row}`).setNumberFormat('#,##0');
    
    // Highlight gap years
    if (yd.isGap) {
      sheet.getRange(`A${row}:M${row}`).setBackground('#ffffcc');
    }
    
    row++;
  });
  
  sheet.autoResizeColumns(1, 13);
}
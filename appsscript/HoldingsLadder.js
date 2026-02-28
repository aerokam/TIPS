const SHEET_IDS = {
  HOLDINGS:  162128331,
  TIPSSAO:   147571825,
  TIPSREF:   246283495,
  REFCPI:    237587759,
  OUTPUT:    1607099601
};

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function buildLadderHoldings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Get settlement date and CPI
  const settlementDate = getSettlementDate(ss);
  const settlementCPI  = getSettlementCPI(ss, settlementDate);
  Logger.log(`Settlement: ${settlementDate}, CPI: ${settlementCPI}`);
  
  // Build reference data
  const refCpiMap = buildRefCpiMap(ss);
  const tipsData  = loadTIPSData(ss);
  Logger.log(`Loaded ${Object.keys(tipsData).length} TIPS from TIPSSAO`);
  
  // Load holdings and calculate all bond metrics
  const holdingsRaw = loadHoldingsRaw(ss);
  Logger.log(`Loaded ${holdingsRaw.length} holdings`);
  
  const holdings = calculateHoldingMetrics(holdingsRaw, tipsData, settlementCPI, refCpiMap);
  Logger.log(`Calculated metrics for ${holdings.length} holdings`);
  
  // Aggregate by funded year
  const byYear = aggregateByYear(holdings);
  Logger.log(`Aggregated into ${Object.keys(byYear).length} years`);
  
  // Infer ladder parameters
  const params = inferParameters(byYear, tipsData);
  Logger.log(`DARA: ${params.DARA.toFixed(0)}, Gaps: [${params.gapYears}]`);
  Logger.log(`Lower bracket: ${params.lowerBracket}, Upper: ${params.upperBracket}`);
  
  // Calculate rebalancing
  const rebal = calculateRebalancing(params, byYear, tipsData, settlementDate);
  
  // Write output
  writeOutput(ss, params, rebal, byYear);
}

// ─── DATA LOADING ─────────────────────────────────────────────────────────────

function getSettlementDate(ss) {
  const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_IDS.TIPSSAO);
  return new Date(sheet.getRange("V2").getValue());
}

function getSettlementCPI(ss, settlementDate) {
  const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_IDS.REFCPI);
  const data = sheet.getRange("F:G").getValues();
  const targetTime = settlementDate.getTime();
  
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (new Date(data[i][0]).getTime() === targetTime) {
      return parseFloat(data[i][1]);
    }
  }
  throw new Error(`Settlement CPI not found for ${settlementDate}`);
}

function buildRefCpiMap(ss) {
  const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_IDS.TIPSREF);
  const data = sheet.getRange("A:B").getValues();
  const map = {};
  
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    map[data[i][0].toString().trim()] = parseFloat(data[i][1]);
  }
  return map;
}

function loadTIPSData(ss) {
  const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_IDS.TIPSSAO);
  const data = sheet.getRange("A:Q").getValues();
  const tips = {};
  
  for (let i = 1; i < data.length; i++) {
    const cusip = data[i][0] ? data[i][0].toString().trim() : "";
    if (!cusip) continue;
    
    const maturity  = data[i][1];
    const coupon    = parseFloat(data[i][2]) || 0;
    const yieldSAO  = parseFloat(data[i][5]) || 0;
    const askPrice  = parseFloat(data[i][6]) || 0;
    const mdurSAO   = parseFloat(data[i][15]) || 0;
    
    if (!maturity) continue;
    
    const matDate  = maturity instanceof Date ? maturity : new Date(maturity);
    
    tips[cusip] = {
      cusip,
      matDate,
      matYear: matDate.getFullYear(),
      matMonth: matDate.getMonth() + 1,
      coupon,
      yieldSAO,
      askPrice,
      mdurSAO
    };
  }
  
  return tips;
}

function loadHoldingsRaw(ss) {
  const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_IDS.HOLDINGS);
  const data = sheet.getRange("A:B").getValues();
  const holdings = [];
  
  for (let i = 1; i < data.length; i++) {
    const cusip = data[i][0] ? data[i][0].toString().trim() : "";
    const qty = parseFloat(data[i][1]) || 0;
    if (!cusip || qty === 0) continue;
    holdings.push({ cusip, qty });
  }
  
  return holdings;
}

// ─── CALCULATE BOND METRICS ───────────────────────────────────────────────────

function calculateHoldingMetrics(holdingsRaw, tipsData, settlementCPI, refCpiMap) {
  return holdingsRaw.map(h => {
    const tips = tipsData[h.cusip];
    if (!tips) return null;
    
    // K: Principal per bond (index ratio × 1000)
    const datedCPI = refCpiMap[h.cusip] || settlementCPI;
    const K = (settlementCPI / datedCPI) * 1000;
    
    // L: Interest last year per bond
    const halfYear = tips.matMonth < 7 ? 0.5 : 1.0;
    const L = tips.coupon * K * halfYear;
    
    // M: P+I per bond
    const M = K + L;
    
    // O: Adjusted ask price per bond (cost per bond)
    const O = (tips.askPrice / 100) * K;
    
    return {
      cusip: h.cusip,
      qty: h.qty,
      matYear: tips.matYear,
      matDate: tips.matDate,
      coupon: tips.coupon,
      mdurSAO: tips.mdurSAO,
      yieldSAO: tips.yieldSAO,
      K, L, M, O,
      principal: h.qty * K,
      intLastYr: h.qty * L,
      PI: h.qty * M,
      cost: h.qty * O
    };
  }).filter(h => h !== null).sort((a, b) => a.matYear - b.matYear);
}

// ─── AGGREGATE BY YEAR ────────────────────────────────────────────────────────

function aggregateByYear(holdings) {
  const byYear = {};
  
  holdings.forEach(h => {
    if (!byYear[h.matYear]) {
      byYear[h.matYear] = {
        year: h.matYear,
        bonds: [],
        totalQty: 0,
        totalPI: 0,
        totalCost: 0
      };
    }
    
    const yr = byYear[h.matYear];
    yr.bonds.push(h);
    yr.totalQty += h.qty;
    yr.totalPI += h.PI;
    yr.totalCost += h.cost;
  });
  
  return byYear;
}

// ─── INFER PARAMETERS ─────────────────────────────────────────────────────────

function inferParameters(byYear, tipsData) {
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  const firstYear = years[0];
  const lastYear = years[years.length - 1];
  
  // Gap years: years missing from holdings
  const holdingsYears = new Set(years);
  const gapYears = [];
  for (let y = firstYear; y <= lastYear; y++) {
    if (!holdingsYears.has(y)) {
      gapYears.push(y);
    }
  }
  
  Logger.log(`Holdings years: ${years.join(', ')}`);
  Logger.log(`Gap years: ${gapYears.join(', ')}`);
  
  // DARA calculation - use ladder span (including gaps)
  const numLadderYears = lastYear - firstYear + 1;
  
  Logger.log(`Ladder span: ${firstYear}-${lastYear} = ${numLadderYears} years`);
  
  // Calculate total interest from later maturities for each year
  let totalIntLater = 0;
  for (let i = years.length - 1; i >= 0; i--) {
    const yr = byYear[years[i]];
    yr.totalIntLater = totalIntLater;
    
    // Add this year's annual coupon to the running total
    yr.bonds.forEach(bond => {
      totalIntLater += bond.qty * bond.coupon * bond.K;
    });
  }
  
  // Total ARA across all holdings years
  const totalARA = years.reduce((sum, y) => {
    const yr = byYear[y];
    return sum + yr.totalPI + yr.totalIntLater;
  }, 0);
  
  // DARA = total ARA / ladder span (including gap years)
  const DARA = totalARA / numLadderYears;
  
  Logger.log(`Total ARA: ${totalARA.toFixed(0)}, DARA: ${DARA.toFixed(0)}`);
  
  // Bracket years
  let lowerBracket = null;
  let upperBracket = null;
  
  if (gapYears.length > 0) {
    const firstGap = gapYears[0];
    const lastGap = gapYears[gapYears.length - 1];
    
    // Lower bracket: work backwards from first gap
    for (let y = firstGap - 1; y >= firstYear; y--) {
      if (byYear[y] && byYear[y].totalCost > DARA * 1.2) {
        lowerBracket = y;
        Logger.log(`Lower bracket ${y}: cost=${byYear[y].totalCost.toFixed(0)} > ${(DARA*1.2).toFixed(0)}`);
        break;
      }
    }
    
    // Upper bracket: first year after last gap
    for (let y = lastGap + 1; y <= lastYear; y++) {
      if (byYear[y]) {
        upperBracket = y;
        Logger.log(`Upper bracket: ${y}`);
        break;
      }
    }
  }
  
  // Newly available: years between lower bracket and first gap
  // These are previous-gap years that are now available in TIPSSAO
  const newlyAvailable = [];
  
  if (gapYears.length > 0 && lowerBracket) {
    const firstGap = gapYears[0];
    
    for (let y = lowerBracket + 1; y < firstGap; y++) {
      newlyAvailable.push(y);
    }
  }
  
  Logger.log(`Newly available (between lower bracket and first gap): ${newlyAvailable.join(', ') || 'None'}`);
  
  return {
    firstYear,
    lastYear,
    years,
    DARA,
    gapYears,
    lowerBracket,
    upperBracket,
    newlyAvailable
  };
}

// ─── CALCULATE REBALANCING ────────────────────────────────────────────────────

function calculateRebalancing(params, byYear, tipsData, settlementDate) {
  if (!params.lowerBracket || !params.upperBracket || params.gapYears.length === 0) {
    return { hasGaps: false, message: "No gaps or brackets detected" };
  }
  
  const lowerYear = params.lowerBracket;
  const upperYear = params.upperBracket;
  const lowerBond = byYear[lowerYear].bonds[0];
  const upperBond = byYear[upperYear].bonds[0];
  
  Logger.log(`\n=== Creating Synthetic Gap Bonds ===`);
  
  // Create synthetic gap bonds
  const syntheticGaps = params.gapYears.map(gapYear => {
    const gapDate = new Date(gapYear, 0, 15);
    const t = (gapDate - lowerBond.matDate) / (upperBond.matDate - lowerBond.matDate);
    
    // Linear yield interpolation
    const gapYield = lowerBond.yieldSAO + t * (upperBond.yieldSAO - lowerBond.yieldSAO);
    
    // Coupon: round down to 0.125%
    const gapCoupon = Math.max(0.00125, Math.floor(gapYield / 0.00125) * 0.00125);
    
    // Modified duration using Excel MDURATION formula
    const mdur = mduration(settlementDate, gapDate, gapCoupon, gapYield, 2, 1);
    
    // K value (par for synthetic)
    const K = 1000;
    
    Logger.log(`Gap ${gapYear}: cpn=${(gapCoupon*100).toFixed(3)}%, yld=${(gapYield*100).toFixed(3)}%, mdur=${mdur.toFixed(2)}`);
    
    return {
      year: gapYear,
      coupon: gapCoupon,
      yield: gapYield,
      mdur,
      K,
      matDate: gapDate
    };
  });
  
  const avgGapDuration = syntheticGaps.reduce((s, g) => s + g.mdur, 0) / syntheticGaps.length;
  Logger.log(`Average gap duration: ${avgGapDuration.toFixed(2)}`);
  
  // Duration-matched weights
  const lowerWeight = (upperBond.mdurSAO - avgGapDuration) / (upperBond.mdurSAO - lowerBond.mdurSAO);
  const upperWeight = 1 - lowerWeight;
  Logger.log(`Weights: lower=${(lowerWeight*100).toFixed(1)}%, upper=${(upperWeight*100).toFixed(1)}%`);
  
  // Gap total cost
  const gapTotalCost = params.DARA * params.gapYears.length;
  const targetExcessLower = gapTotalCost * lowerWeight;
  const targetExcessUpper = gapTotalCost * upperWeight;
  
  Logger.log(`\n=== Calculating Target FY P+I (working backwards) ===`);
  
  // Calculate Target FY P+I for each year working backwards
  const targetFY = {};
  
  // Start from end, work backwards
  const allYears = [...params.years].sort((a, b) => b - a);
  
  for (const year of allYears) {
    // Calculate interest from later maturities
    let intLater = 0;
    
    // Add interest from real holdings in later years
    for (const laterYear of params.years) {
      if (laterYear <= year) continue;
      
      const laterYr = byYear[laterYear];
      
      // Use TARGET qty for bracket years, ACTUAL for others
      if (laterYear === upperYear && targetFY[upperYear]) {
        // Use target qty for upper bracket
        const targetQty = targetFY[upperYear].qty;
        intLater += targetQty * upperBond.coupon * upperBond.K;
      } else if (laterYear === lowerYear && targetFY[lowerYear]) {
        // Use target qty for lower bracket
        const targetQty = targetFY[lowerYear].qty;
        intLater += targetQty * lowerBond.coupon * lowerBond.K;
      } else {
        // Use actual qty
        laterYr.bonds.forEach(bond => {
          intLater += bond.qty * bond.coupon * bond.K;
        });
      }
    }
    
    // Add interest from synthetic gap bonds in later years
    for (const gap of syntheticGaps) {
      if (gap.year <= year) continue;
      
      // For synthetic gaps, calculate qty based on DARA
      // Target FY P+I = DARA - interest from even later bonds
      // For now, use DARA as approximation for synthetic qty calculation
      const syntheticQty = params.DARA / 1000; // Rough approximation
      intLater += syntheticQty * gap.coupon * gap.K;
    }
    
    // Target FY P+I = DARA - interest from later
    const targetPI = params.DARA - intLater;
    
    // Target FY qty
    const yr = byYear[year];
    const bond = yr.bonds[0];
    const targetQty = Math.round(targetPI / bond.M);
    
    // Target FY cost
    const targetCost = targetQty * bond.O;
    
    targetFY[year] = {
      PI: targetPI,
      qty: targetQty,
      cost: targetCost,
      intLater
    };
    
    Logger.log(`Year ${year}: intLater=${intLater.toFixed(0)}, targetPI=${targetPI.toFixed(0)}, targetQty=${targetQty}`);
  }
  
  // Calculate excess for brackets
  const lowerHoldingsCost = byYear[lowerYear].totalCost;
  const upperHoldingsCost = byYear[upperYear].totalCost;
  
  const lowerTargetCost = targetFY[lowerYear].cost;
  const upperTargetCost = targetFY[upperYear].cost;
  
  const excessLower = lowerHoldingsCost - lowerTargetCost;
  const excessUpper = upperHoldingsCost - upperTargetCost;
  
  Logger.log(`\n=== Excess Calculation ===`);
  Logger.log(`Lower: holdings=${lowerHoldingsCost.toFixed(0)}, target=${lowerTargetCost.toFixed(0)}, excess=${excessLower.toFixed(0)}`);
  Logger.log(`Upper: holdings=${upperHoldingsCost.toFixed(0)}, target=${upperTargetCost.toFixed(0)}, excess=${excessUpper.toFixed(0)}`);
  
  // Buy/sell = target excess - current excess
  const sellAmtLower = excessLower - targetExcessLower;
  const sellAmtUpper = excessUpper - targetExcessUpper;
  
  const sellQtyLower = Math.round(sellAmtLower / lowerBond.O);
  const sellQtyUpper = Math.round(sellAmtUpper / upperBond.O);
  
  Logger.log(`\n=== Sell Quantities ===`);
  Logger.log(`Lower: sell amt=${sellAmtLower.toFixed(0)}, sell qty=${sellQtyLower}`);
  Logger.log(`Upper: sell amt=${sellAmtUpper.toFixed(0)}, sell qty=${sellQtyUpper}`);
  
  return {
    hasGaps: true,
    lowerYear,
    upperYear,
    lowerCusip: lowerBond.cusip,
    upperCusip: upperBond.cusip,
    avgGapDuration,
    lowerWeight,
    upperWeight,
    targetExcessLower,
    targetExcessUpper,
    excessLower,
    excessUpper,
    sellQtyLower,
    sellQtyUpper,
    targetFY
  };
}

// Modified duration (Excel MDURATION equivalent)
function mduration(settlement, maturity, coupon, yld, freq, basis) {
  // Simplified MDURATION calculation
  const years = (maturity - settlement) / (365.25 * 24 * 60 * 60 * 1000);
  
  if (yld === 0) return years;
  
  const periods = Math.ceil(years * freq);
  const rate = yld / freq;
  const pmt = (coupon / freq) * 100;
  
  // Macaulay duration
  let macDur = 0;
  let pv = 0;
  
  for (let t = 1; t <= periods; t++) {
    const cf = (t === periods) ? pmt + 100 : pmt;
    const discCF = cf / Math.pow(1 + rate, t);
    macDur += (t / freq) * discCF;
    pv += discCF;
  }
  
  macDur = macDur / pv;
  
  // Modified duration
  return macDur / (1 + rate);
}

// ─── WRITE OUTPUT ─────────────────────────────────────────────────────────────

function writeOutput(ss, params, rebal, byYear) {
  const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_IDS.OUTPUT);
  sheet.clear();
  
  let row = 1;
  
  // Title
  sheet.getRange(row, 1, 1, 2).merge();
  sheet.getRange(row, 1).setValue("TIPS Ladder Rebalancing Analysis");
  sheet.getRange(row, 1).setFontWeight("bold").setFontSize(14);
  row += 2;
  
  // Parameters
  const paramData = [
    ["Parameter", "Value"],
    ["DARA", params.DARA],
    ["Gap Years", params.gapYears.join(", ")],
    ["Lower Bracket", params.lowerBracket],
    ["Upper Bracket", params.upperBracket],
    ["Newly Available", params.newlyAvailable.join(", ") || "None"]
  ];
  
  sheet.getRange(row, 1, paramData.length, 2).setValues(paramData);
  sheet.getRange(row, 1, 1, 2).setFontWeight("bold").setBackground("#d9e1f2");
  sheet.getRange(row + 1, 2).setNumberFormat("#,##0");
  row += paramData.length + 1;
  
  if (!rebal.hasGaps) {
    sheet.getRange(row, 1).setValue(rebal.message);
    return;
  }
  
  // Rebalancing results
  const rebalData = [
    ["Rebalancing Analysis", ""],
    ["Average Gap Duration", rebal.avgGapDuration.toFixed(2)],
    ["", ""],
    [`Lower Bracket (${rebal.lowerYear})`, ""],
    ["  Weight", (rebal.lowerWeight * 100).toFixed(1) + "%"],
    ["  Target Excess $", rebal.targetExcessLower],
    ["  Current Excess $", rebal.excessLower],
    ["  SELL Qty", rebal.sellQtyLower],
    ["", ""],
    [`Upper Bracket (${rebal.upperYear})`, ""],
    ["  Weight", (rebal.upperWeight * 100).toFixed(1) + "%"],
    ["  Target Excess $", rebal.targetExcessUpper],
    ["  Current Excess $", rebal.excessUpper],
    ["  SELL Qty", rebal.sellQtyUpper]
  ];
  
  sheet.getRange(row, 1, rebalData.length, 2).setValues(rebalData);
  sheet.getRange(row, 1, 1, 2).setFontWeight("bold").setBackground("#d9e1f2");
  [6, 7, 12, 13].forEach(offset => {
    sheet.getRange(row + offset, 2).setNumberFormat("#,##0");
  });
  
  row += rebalData.length + 1;
  
  // Trade summary
  sheet.getRange(row, 1, 1, 3).setValues([["Action", "CUSIP", "Quantity"]]);
  sheet.getRange(row, 1, 1, 3).setFontWeight("bold").setBackground("#ffe599");
  row++;
  
  const trades = [];
  if (rebal.sellQtyLower !== 0) {
    trades.push([rebal.sellQtyLower > 0 ? "SELL" : "BUY", rebal.lowerCusip, Math.abs(rebal.sellQtyLower)]);
  }
  if (rebal.sellQtyUpper !== 0) {
    trades.push([rebal.sellQtyUpper > 0 ? "SELL" : "BUY", rebal.upperCusip, Math.abs(rebal.sellQtyUpper)]);
  }
  
  if (trades.length > 0) {
    sheet.getRange(row, 1, trades.length, 3).setValues(trades);
  }
  
  sheet.autoResizeColumns(1, 3);
}
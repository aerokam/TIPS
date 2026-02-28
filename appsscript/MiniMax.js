/**
 * TIPS Ladder Builder - Google Apps Script
 * Builds a TIPS bond ladder from longest to shortest maturity,
 * accounting for interest from longer-dated bonds and gap years (2037-2039).
 *
 * Key interest logic:
 * - Interest annual (Y) = Qty × Coupon × Principal per bond (full annual interest)
 * - Interest later maturities (V) = Sum of Y for all bonds maturing AFTER this one
 * - Interest last year (T) = Qty × Int per bond (adjusted for maturity month)
 * - Interest total (W) = T + V (this is Interest FY in output)
 * - ARA (X) = Principal + Interest total
 * - Qty = ROUND((DARA - V) / (Principal + Int_last_year per bond))
 */

// Configuration - Sheet IDs (gid)
const OUTPUT_SHEET_GID = 1634669263;

// Gap years where no TIPS exist
const GAP_YEARS = [2037, 2038, 2039];

/**
 * Main function to build the TIPS ladder
 */
function buildLadder(config) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const outputSheet = getSheetById(ss, OUTPUT_SHEET_GID);

  if (!outputSheet) {
    throw new Error(`Sheet with gid ${OUTPUT_SHEET_GID} not found`);
  }

  const params = config || getParameters(ss);
  const tipsData = getTipsData(ss, params);
  const refCpiMap = getRefCpiMap(ss);
  const ladder = calculateLadder(tipsData, params, refCpiMap);
  writeOutput(outputSheet, ladder);

  return ladder;
}

/**
 * Get sheet by gid (sheet ID)
 */
function getSheetById(spreadsheet, gid) {
  const sheets = spreadsheet.getSheets();
  for (const sheet of sheets) {
    if (sheet.getSheetId() === gid) {
      return sheet;
    }
  }
  return null;
}

/**
 * Get parameters from LadderBuilder sheet
 */
function getParameters(ss) {
  const ladderSheet = ss.getSheetByName('LadderBuilder');
  if (!ladderSheet) {
    return {
      dara: 47000,
      firstYear: 2026,
      lastYear: 2052,
      tipsChoice: 'Latest',
      settleDate: new Date(),
      settleRefCpi: 315
    };
  }

  return {
    dara: ladderSheet.getRange('B2').getValue(),
    firstYear: ladderSheet.getRange('B3').getValue(),
    lastYear: ladderSheet.getRange('B4').getValue(),
    tipsChoice: ladderSheet.getRange('B5').getValue() || 'Latest',
    settleDate: ladderSheet.getRange('B28').getValue() || new Date(),
    settleRefCpi: ladderSheet.getRange('B29').getValue() || 315
  };
}

/**
 * Get TIPS data from TIPSSAO sheet
 */
function getTipsData(ss, params) {
  const tipsSheet = ss.getSheetByName('TIPSSAO');
  if (!tipsSheet) {
    throw new Error('TIPSSAO sheet not found');
  }

  const data = tipsSheet.getDataRange().getValues();
  const tips = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const cusip = row[0];
    const maturity = row[1];

    if (!cusip || !maturity) continue;

    const maturityDate = new Date(maturity);
    const year = maturityDate.getFullYear();

    if (year < params.firstYear || year > params.lastYear) continue;

    tips.push({
      cusip: cusip,
      maturity: maturityDate,
      year: year,
      coupon: parseFloat(row[2]) || 0,
      yield: parseFloat(row[5]) || 0,
      adjAskPct: parseFloat(row[6]) || 100,
      row: i
    });
  }

  tips.sort((a, b) => a.maturity - b.maturity);

  // Handle multiple TIPS in same year
  const tipsByYear = new Map();
  for (const tip of tips) {
    const existing = tipsByYear.get(tip.year);
    if (!existing) {
      tipsByYear.set(tip.year, tip);
    } else {
      if (params.tipsChoice === 'Earliest') {
        if (tip.maturity < existing.maturity) {
          tipsByYear.set(tip.year, tip);
        }
      } else {
        if (tip.maturity > existing.maturity) {
          tipsByYear.set(tip.year, tip);
        }
      }
    }
  }

  return tipsByYear;
}

/**
 * Get Reference CPI map from TIPSref sheet
 */
function getRefCpiMap(ss) {
  const refSheet = ss.getSheetByName('TIPSref');
  if (!refSheet) return new Map();

  const data = refSheet.getDataRange().getValues();
  const cpiMap = new Map();

  for (let i = 1; i < data.length; i++) {
    const cusip = data[i][0];
    const refCpi = data[i][1];
    if (cusip && refCpi) {
      cpiMap.set(cusip, parseFloat(refCpi));
    }
  }

  return cpiMap;
}

/**
 * Calculate principal per bond (inflation adjusted)
 * Formula: settleRefCpi / refCpi * 1000
 */
function calcPrincipalPerBond(cusip, settleRefCpi, refCpiMap) {
  const refCpi = refCpiMap.get(cusip) || settleRefCpi;
  return (settleRefCpi / refCpi) * 1000;
}

/**
 * Calculate interest per bond in LAST YEAR (maturity year)
 * Half interest if matures in first half of year (month < 7)
 * Formula: Coupon × Principal × (1 - 0.5 if month < 7)
 */
function calcInterestPerBondLastYear(coupon, principalPerBond, maturityDate) {
  const month = maturityDate.getMonth(); // 0-based (0=Jan, 6=Jul)
  const multiplier = month < 6 ? 0.5 : 1.0; // H1 = half year interest
  return (coupon / 100) * principalPerBond * multiplier;
}

/**
 * Calculate FULL annual interest per bond
 * Formula: Coupon × Principal (full year)
 */
function calcAnnualInterestPerBond(coupon, principalPerBond) {
  return (coupon / 100) * principalPerBond;
}

/**
 * Calculate adjusted ask price per bond
 */
function calcAdjAskPerBond(adjAskPct, principalPerBond) {
  return (adjAskPct / 100) * principalPerBond;
}

/**
 * Main ladder calculation
 *
 * CRITICAL: Works backwards from longest maturity
 *
 * For each bond:
 * - Y (Interest annual) = Qty × Coupon × Principal (full year)
 * - V (Interest later maturities) = Sum of Y for all LATER bonds
 * - T (Interest last year) = Qty × Int per bond (partial, maturity year)
 * - W (Interest total) = T + V
 * - Qty = ROUND((DARA - V) / (Principal + Int_last_year per bond))
 */
function calculateLadder(tipsByYear, params, refCpiMap) {
  // Create entries for all years including gap years
  const entries = [];

  for (let year = params.firstYear; year <= params.lastYear; year++) {
    const tip = tipsByYear.get(year);
    const isGapYear = GAP_YEARS.includes(year);

    let entry;
    if (tip && !isGapYear) {
      // Real TIPS
      const principalPerBond = calcPrincipalPerBond(tip.cusip, params.settleRefCpi, refCpiMap);
      const interestPerBondLastYear = calcInterestPerBondLastYear(tip.coupon, principalPerBond, tip.maturity);
      const annualInterestPerBond = calcAnnualInterestPerBond(tip.coupon, principalPerBond);
      const piPerBond = principalPerBond + interestPerBondLastYear;
      const adjAskPerBond = calcAdjAskPerBond(tip.adjAskPct, principalPerBond);

      entry = {
        cusip: tip.cusip,
        maturity: tip.maturity,
        year: year,
        coupon: tip.coupon,
        principalPerBond: principalPerBond,
        interestPerBondLastYear: interestPerBondLastYear,
        annualInterestPerBond: annualInterestPerBond,
        piPerBond: piPerBond,
        adjAskPerBond: adjAskPerBond,
        isGapYear: false
      };
    } else {
      // Synthetic TIPS for gap year
      const syntheticMaturity = new Date(year, 0, 15);
      const avgCoupon = 1.75;
      const principalPerBond = 1000;
      const interestPerBondLastYear = (avgCoupon / 100) * principalPerBond;
      const annualInterestPerBond = (avgCoupon / 100) * principalPerBond;
      const piPerBond = principalPerBond + interestPerBondLastYear;

      entry = {
        cusip: `Synthetic ${year}`,
        maturity: syntheticMaturity,
        year: year,
        coupon: avgCoupon,
        principalPerBond: principalPerBond,
        interestPerBondLastYear: interestPerBondLastYear,
        annualInterestPerBond: annualInterestPerBond,
        piPerBond: piPerBond,
        adjAskPerBond: principalPerBond,
        isGapYear: true
      };
    }

    // Initialize calculated fields
    entry.qty = 0;
    entry.principal = 0;
    entry.interestLastYear = 0;
    entry.interestAnnual = 0;
    entry.interestLater = 0;
    entry.interestTotal = 0;
    entry.ara = 0;
    entry.cost = 0;

    entries.push(entry);
  }

  // Sort by year DESCENDING (longest first) for backward calculation
  entries.sort((a, b) => b.year - a.year);

  // Calculate quantities backward from longest maturity
  let cumulativeAnnualInterest = 0;

  for (const entry of entries) {
    // V = cumulative annual interest from all LATER maturing bonds
    entry.interestLater = cumulativeAnnualInterest;

    // Qty = ROUND((DARA - V) / (P + I per bond))
    const targetAmount = params.dara - entry.interestLater;
    entry.qty = Math.round(targetAmount / entry.piPerBond);

    // Calculate derived values
    entry.principal = entry.qty * entry.principalPerBond;
    entry.interestLastYear = entry.qty * entry.interestPerBondLastYear;
    entry.interestAnnual = entry.qty * entry.annualInterestPerBond;
    entry.interestTotal = entry.interestLastYear + entry.interestLater;
    entry.ara = entry.principal + entry.interestTotal;
    entry.cost = entry.qty * entry.adjAskPerBond;

    // Add THIS bond's annual interest to cumulative for shorter maturities
    cumulativeAnnualInterest += entry.interestAnnual;
  }

  // Sort back by year ASCENDING for output
  entries.sort((a, b) => a.year - b.year);

  return entries;
}

/**
 * Write output to sheet with columns A:I
 */
function writeOutput(sheet, ladder) {
  sheet.clear();

  const headers = ['CUSIP', 'Qty', 'Maturity', '', 'FY', 'Principal FY', 'Interest FY', 'ARA FY', 'Cost FY'];
  const output = [headers];

  for (const entry of ladder) {
    output.push([
      entry.cusip,
      entry.qty,
      entry.maturity,
      '',
      entry.year,
      entry.principal,
      entry.interestTotal,
      entry.ara,
      entry.cost
    ]);
  }

  const range = sheet.getRange(1, 1, output.length, output[0].length);
  range.setValues(output);

  // Format
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(2, 3, output.length - 1, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, 6, output.length - 1, 4).setNumberFormat('#,##0.00');

  for (let i = 1; i <= headers.length; i++) {
    sheet.autoResizeColumn(i);
  }
}


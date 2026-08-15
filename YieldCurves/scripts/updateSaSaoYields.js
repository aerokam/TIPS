import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { uploadToR2 } from './r2.js';
import { yieldFromPrice, daysBetween } from '../../shared/src/bond-math.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const R2_BASE_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const FIDELITY_TIPS_URL = `${R2_BASE_URL}/Treasuries/FidelityTreasuriesTips.csv`;
const REF_CPI_URL = `${R2_BASE_URL}/TIPS/RefCpiNsaSa.csv`;
const HOLIDAYS_URL = `${R2_BASE_URL}/misc/BondHolidaysSifma.csv`;

// Helper: parse CSV with quoted fields and header
function parseCsv(text) {
  const result = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return result;

  const parseRow = (line) => {
    const parts = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) {
        parts.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    parts.push(cur.trim());
    return parts.map(p => p.replace(/^"|"$/g, '').trim());
  };

  const headers = parseRow(lines[0]);
  // Fidelity CSV has a trailing comma → empty last header; strip it so row-length
  // validation doesn't reject every data row.
  while (headers.length > 0 && !headers[headers.length - 1]) headers.pop();
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    if (values.length < headers.length) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = values[idx];
    });
    result.push(obj);
  }
  return result;
}

function localDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toIsoDate(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

function parseFidelityDateStr(s) {
  const [mo, dy, yr] = (s || '').split(' ')[0].split('/').map(Number);
  return new Date(yr, mo - 1, dy);
}

function nextBusinessDay(date, holidaySet) {
  if (!date) return new Date();
  const d = new Date(date.getTime());
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6 || holidaySet.has(toIsoDate(d)));
  return d;
}

function calculateSAO(bonds) {
  const n = bonds.length;
  const sao = new Array(n);
  const now = new Date();

  for (let i = n - 1; i >= 0; i--) {
    const bond = bonds[i];
    const yearsToMat = (bond.maturityDate - now) / 31557600000;

    if (yearsToMat > 7 || i > n - 4) {
      sao[i] = bond.saYield;
      continue;
    }

    const windowSize = 4;
    const actualWindow = Math.min(windowSize, n - 1 - i);
    
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 1; j <= actualWindow; j++) {
      const x = daysBetween(bond.maturityDate, bonds[i + j].maturityDate);
      const y = sao[i + j];
      sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x;
    }

    const slope = (actualWindow * sumXY - sumX * sumY) / (actualWindow * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / actualWindow;
    const projected = intercept;

    let trendWeight = 0.2;
    if (yearsToMat < 0.5) trendWeight = 0.9; 
    else if (yearsToMat < 2) trendWeight = 0.15; 
    else if (yearsToMat < 5) trendWeight = 0.25;

    sao[i] = (projected * trendWeight) + (bond.saYield * (1 - trendWeight));
  }
  return sao;
}

async function main() {
  console.log(`Starting Market SA/SAO Yield update at ${new Date().toISOString()}`);

  // Fetch Fidelity TIPS
  console.log(`Fetching market data from ${FIDELITY_TIPS_URL}...`);
  const fidRes = await fetch(FIDELITY_TIPS_URL);
  if (!fidRes.ok) throw new Error(`Failed to fetch Fidelity TIPS: ${fidRes.status}`);
  const fidText = await fidRes.text();
  
  // Extract download date from footer
  const m = fidText.match(/Date downloaded\s+([\d/]+ [\d:]+ [AP]M)/i);
  const downloadDateStr = m ? m[1] : null;
  if (!downloadDateStr) {
    console.log("Warning: Could not find download date in Fidelity TIPS footer. Using today.");
  }
  const downloadDate = downloadDateStr ? parseFidelityDateStr(downloadDateStr) : new Date();
  
  // Fetch Holidays for T+1 settlement
  console.log(`Fetching holidays from ${HOLIDAYS_URL}...`);
  const holidayRes = await fetch(HOLIDAYS_URL);
  const holidaySet = new Set();
  if (holidayRes.ok) {
    const holidayText = await holidayRes.text();
    const holidayRows = holidayText.split(/\r?\n/).filter(l => l.trim());
    holidayRows.slice(1).forEach(line => {
      const parts = line.split(',');
      const datePart = parts.slice(0, 1).join(',').replace(/^"|"$/g, '').trim();
      const d = new Date(datePart);
      if (!isNaN(d.getTime())) holidaySet.add(toIsoDate(d));
    });
  }
  
  const settleDate = nextBusinessDay(downloadDate, holidaySet);
  const settleDateStr = toIsoDate(settleDate);
  console.log(`Market settlement date (T+1): ${settleDateStr}`);

  // Parse RefCPI
  console.log(`Fetching SA factors from ${REF_CPI_URL}...`);
  const refCpiRes = await fetch(REF_CPI_URL);
  const refCpiText = await refCpiRes.text();
  const refCpiData = parseCsv(refCpiText);

  // Parse Bonds
  const rows = parseCsv(fidText);
  const clean = val => (val || '').replace(/^=?["']*/, '').replace(/["']*$/, '').trim();
  
  const processed = rows.map(row => {
    const n = {};
    for (const k in row) n[k.toLowerCase().trim()] = row[k];

    // Combined file: skip Treasury rows
    const product = (n['product'] || '').toLowerCase();
    if (product && product !== 'tips') return null;

    const cusip = clean(n['cusip'] || n['cusip|state']);
    if (!cusip) return null;

    const matStr = clean(n['maturity date']);
    if (!matStr) return null;
    let maturity;
    if (/^\d{4}-\d{2}-\d{2}$/.test(matStr)) {
      maturity = matStr;
    } else {
      const [mo, dy, yr] = matStr.split('/');
      if (!yr) return null;
      maturity = `${yr}-${mo.padStart(2,'0')}-${dy.padStart(2,'0')}`;
    }
    const maturityDate = localDate(maturity);

    const couponStr = clean(n['coupon']);
    const coupon = parseFloat(couponStr) / 100;

    const rawPrice = n['price ask'] || n['ask price'] || n['ask price/quantity (min)'] || n['price'] || '';
    const priceStr = clean(rawPrice).split('/')[0].replace(/,/g, '');
    const price = parseFloat(priceStr);

    if (isNaN(price) || isNaN(coupon) || !maturityDate) return null;

    const mmddSettle = settleDateStr.slice(5, 10);
    const mmddMature = maturity.slice(5, 10);
    
    const rSettle = refCpiData.find(r => r["Ref CPI Date"] && r["Ref CPI Date"].includes(`-${mmddSettle}`));
    const rMature = refCpiData.find(r => r["Ref CPI Date"] && r["Ref CPI Date"].includes(`-${mmddMature}`));
    
    const saS = parseFloat(rSettle?.["SA Factor"]);
    const saM = parseFloat(rMature?.["SA Factor"]);

    if (isNaN(saS) || isNaN(saM)) return null;

    const askYield = yieldFromPrice(price, coupon, settleDate, maturityDate);
    const saPrice = price * (saS / saM);
    const saYield = yieldFromPrice(saPrice, coupon, settleDate, maturityDate);
    
    if (saYield === null) return null;

    return { cusip, maturity, coupon, askYield, saYield, maturityDate };
  }).filter(Boolean).sort((a, b) => a.maturityDate - b.maturityDate);

  console.log(`Processed ${processed.length} market TIPS bonds.`);

  // Apply SAO
  console.log("Applying SAO smoothing...");
  const smoothed = calculateSAO(processed);
  processed.forEach((b, i) => b.saoYield = smoothed[i]);

  // Generate CSV
  // NOTE: Coupon and Yields are written using the project's internal Decimal standard 
  // (e.g., 0.01 = 1%) to ensure compatibility with spreadsheet formulas and core logic.
  const header = "cusip,maturity,coupon,ask_yield,sa_yield,sao_yield";
  const lines = processed.map(b => 
    `${b.cusip},${b.maturity},${b.coupon.toFixed(7)},${b.askYield.toFixed(7)},${b.saYield.toFixed(7)},${b.saoYield.toFixed(7)}`
  );
  const csvContent = [header, ...lines].join('\n') + '\n';

  // Upload to R2. Not read by any app — published as a public resource for
  // folks building their own spreadsheets. (Restored 2026-06-01; the 2026-05-21
  // R2 cleanup wrongly classified it as an orphan write and removed it.)
  console.log("Uploading to R2: TIPS/YieldsSaSao.csv");
  await uploadToR2('TIPS/YieldsSaSao.csv', csvContent);

  console.log("Update complete.");
}

main().catch(err => {
  console.error("Error in SA/SAO update script:", err);
  process.exit(1);
});

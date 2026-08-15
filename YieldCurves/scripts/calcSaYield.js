import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { yieldFromPrice } from '../../shared/src/bond-math.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF_CPI_PATH = path.join(__dirname, '../data/RefCpiNsaSa.csv');

// --- Helper: Parse CSV ---
function loadRefCpi() {
  const content = fs.readFileSync(REF_CPI_PATH, 'utf8');
  const lines = content.trim().split('\n').slice(1);
  return lines.map(line => {
    const [date, nsa, sa, factor] = line.split(',');
    return { date, factor: parseFloat(factor) };
  });
}

// --- Helper: Find most recent SA factor for a given MM-DD ---
function findMostRecentSaFactor(refCpiRows, targetDate) {
  const mmdd = targetDate.toISOString().slice(5, 10); // "MM-DD"
  // Rows are sorted descending (newest first)
  const match = refCpiRows.find(r => r.date.endsWith(mmdd));
  return match ? match.factor : null;
}

// --- Helper: localDate (handles YYYY-MM-DD reliably) ---
function localDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function main() {
  const cleanPrice = parseFloat(process.argv[2]);
  const coupon = parseFloat(process.argv[3]);
  const settleStr = process.argv[4]; // YYYY-MM-DD
  const matureStr = process.argv[5]; // YYYY-MM-DD

  if (!cleanPrice || isNaN(coupon) || !settleStr || !matureStr) {
    console.log("Usage: node calcSaYield.js <cleanPrice> <coupon> <settleDate> <matureDate>");
    console.log("Example: node calcSaYield.js 98.5 0.02375 2026-03-20 2026-04-15");
    return;
  }

  const settleDate = localDate(settleStr);
  const matureDate = localDate(matureStr);
  const refCpiRows = loadRefCpi();

  const saSettle = findMostRecentSaFactor(refCpiRows, settleDate);
  const saMature = findMostRecentSaFactor(refCpiRows, matureDate);

  if (saSettle === null || saMature === null) {
    console.error(`Error: Could not find SA factors for settle MM-DD or mature MM-DD.`);
    return;
  }

  // algo: generator a price sa factor by dividing SA factor ... by the SA factor for settlement date
  // "SA price factor is the ratio of SA fact settlement / sa fact maturity"
  const priceSaFactor = saSettle / saMature;
  const saPrice = cleanPrice * priceSaFactor;

  const realYield = yieldFromPrice(cleanPrice, coupon, settleDate, matureDate);
  const saYield = yieldFromPrice(saPrice, coupon, settleDate, matureDate);

  console.log(`--- Results ---`);
  console.log(`Settle Date:    ${settleStr}`);
  console.log(`Mature Date:    ${matureStr}`);
  console.log(`Clean Price:    ${cleanPrice.toFixed(3)}`);
  console.log(`Coupon:         ${(coupon * 100).toFixed(3)}%`);
  console.log(`Settle SA Fact: ${saSettle.toFixed(5)}`);
  console.log(`Mature SA Fact: ${saMature.toFixed(5)}`);
  console.log(`Price SA Fact:  ${priceSaFactor.toFixed(5)} (Settle / Mature)`);
  console.log(`SA Price:       ${saPrice.toFixed(5)}`);
  console.log(`--- Yields ---`);
  console.log(`Ask Yield:      ${(realYield * 100).toFixed(4)}%`);
  console.log(`SA Yield:       ${(saYield * 100).toFixed(4)}%`);
}

main();

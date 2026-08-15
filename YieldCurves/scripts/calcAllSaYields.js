import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { yieldFromPrice as _yieldFromPrice } from '../../shared/src/bond-math.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF_CPI_PATH = path.join(__dirname, '../data/RefCpiNsaSa.csv');
const YIELDS_PATH = path.join(__dirname, '../data/YieldsFromFedInvestPrices.csv');

// --- Helpers ---
function loadRefCpi() {
  const content = fs.readFileSync(REF_CPI_PATH, 'utf8');
  return content.trim().split('\n').slice(1).map(line => {
    const [date, nsa, sa, factor] = line.split(',');
    return { date, factor: parseFloat(factor) };
  });
}

function loadTipsYields() {
  const content = fs.readFileSync(YIELDS_PATH, 'utf8');
  const lines = content.trim().split('\n');
  const settlementDate = lines[0].trim();
  // lines[1] = header, lines[2+] = data (type,cusip,maturity,coupon,datedDateCpi,price,yield)
  return lines.slice(2).map(line => {
    const [, cusip, maturity, coupon, , price, yieldVal] = line.split(',');
    return {
      settlementDate,
      cusip,
      maturity,
      coupon: parseFloat(coupon),
      price: parseFloat(price),
      marketYield: parseFloat(yieldVal)
    };
  });
}

function findMostRecentSaFactor(refCpiRows, dateStr) {
  const mmdd = dateStr.slice(5, 10); // Works for YYYY-MM-DD
  const match = refCpiRows.find(r => r.date.includes(`-${mmdd}`));
  return match ? match.factor : null;
}

function localDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Thin wrapper over shared/src/bond-math.js's yieldFromPrice (single source of
// truth — see knowledge/Bond_Basics.md §Treasury Bill Yield, knowledge/TIPS_Basics.md
// §Yield Calculation Conventions). Date args here are strings; bond-math.js takes
// Date objects.
function yieldFromPrice(cleanPrice, coupon, settleDateStr, maturityStr) {
  return _yieldFromPrice(cleanPrice, coupon, localDate(settleDateStr), localDate(maturityStr));
}

function main() {
  const refCpiRows = loadRefCpi();
  const tipsBonds = loadTipsYields();

  const results = [];
  const header = [
    "Settlement Date", "CUSIP", "Maturity", "Coupon", "Price", 
    "Settle SA Fact", "Mature SA Fact", "Price SA Factor", "SA Price", 
    "Ask Yield", "SA Yield", "Diff (bps)"
  ];

  tipsBonds.forEach(bond => {
    const saSettle = findMostRecentSaFactor(refCpiRows, bond.settlementDate);
    const saMature = findMostRecentSaFactor(refCpiRows, bond.maturity);

    if (!saSettle || !saMature) return;

    const priceSaFactor = saSettle / saMature;
    const saPrice = bond.price * priceSaFactor;

    const realYield = yieldFromPrice(bond.price, bond.coupon, bond.settlementDate, bond.maturity);
    const saYield = yieldFromPrice(saPrice, bond.coupon, bond.settlementDate, bond.maturity);

    const diffBps = (saYield - realYield) * 10000;

    results.push([
      bond.settlementDate,
      bond.cusip,
      bond.maturity,
      bond.coupon,
      bond.price.toFixed(4),
      saSettle.toFixed(5),
      saMature.toFixed(5),
      priceSaFactor.toFixed(5),
      saPrice.toFixed(5),
      (realYield * 100).toFixed(4),
      (saYield * 100).toFixed(4),
      diffBps.toFixed(2)
    ]);
  });

  const csvContent = [
    header.join(","),
    ...results.map(row => row.join(","))
  ].join("\n");

  const outputPath = path.join(__dirname, '../data/YieldsSa.csv');
  fs.writeFileSync(outputPath, csvContent);
  
  console.log(`Successfully processed ${results.length} bonds.`);
  console.log(`Results written to: ${outputPath}`);
}

main();

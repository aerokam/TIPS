import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF_CPI_PATH = path.join(__dirname, '../data/RefCpiNsaSa.csv');
const YIELDS_PATH = path.join(__dirname, '../data/TipsYields.csv');

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
  return content.trim().split('\n').slice(1).map(line => {
    const [settlementDate, cusip, maturity, coupon, baseCpi, price, yieldVal] = line.split(',');
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

// Yield calculation (actual/actual)
function yieldFromPrice(cleanPrice, coupon, settleDateStr, maturityStr) {
  if (!cleanPrice || cleanPrice <= 0) return null;
  const settle = localDate(settleDateStr);
  const mature = localDate(maturityStr);
  if (settle >= mature) return null;

  const semiCoupon = (coupon / 2) * 100;
  const matMon = mature.getMonth() + 1;
  const cm1 = matMon <= 6 ? matMon : matMon - 6;
  const cm2 = cm1 + 6;

  function nextCouponOnOrAfter(d) {
    const candidates = [];
    for (let y = d.getFullYear() - 1; y <= d.getFullYear() + 1; y++) {
      candidates.push(new Date(y, cm1 - 1, 15));
      candidates.push(new Date(y, cm2 - 1, 15));
    }
    candidates.sort((a, b) => a - b);
    return candidates.find(c => c >= d && c <= mature) || null;
  }

  const nextCoupon = nextCouponOnOrAfter(settle);
  if (!nextCoupon) return null;
  const lastCoupon = new Date(nextCoupon.getFullYear(), nextCoupon.getMonth() - 6, 15);

  const days = (a, b) => (b - a) / 86400000;
  const E = days(lastCoupon, nextCoupon);
  const A = days(lastCoupon, settle);
  const DSC = days(settle, nextCoupon);
  const accrued = semiCoupon * (A / E);
  const dirtyPrice = cleanPrice + accrued;
  const w = DSC / E;

  const coupons = [];
  let d = new Date(nextCoupon);
  while (d <= mature) {
    coupons.push(new Date(d));
    d = new Date(d.getFullYear(), d.getMonth() + 6, 15);
  }
  const N = coupons.length;
  if (N === 0) return null;

  function pv(y) {
    const r = y / 2;
    let s = 0;
    for (let k = 0; k < N; k++) {
      const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
      s += cf / Math.pow(1 + r, w + k);
    }
    return s;
  }
  function dpv(y) {
    const r = y / 2;
    let s = 0;
    for (let k = 0; k < N; k++) {
      const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
      s += (-cf * (w + k)) / (2 * Math.pow(1 + r, w + k + 1));
    }
    return s;
  }

  let y = coupon > 0.005 ? coupon : 0.02;
  for (let i = 0; i < 200; i++) {
    const diff = pv(y) - dirtyPrice;
    if (Math.abs(diff) < 1e-10) break;
    const deriv = dpv(y);
    if (Math.abs(deriv) < 1e-15) break;
    y -= diff / deriv;
  }
  return y;
}

function main() {
  const refCpiRows = loadRefCpi();
  const tipsBonds = loadTipsYields();

  const results = [];
  const header = [
    "Settlement Date", "CUSIP", "Maturity", "Coupon", "Price", 
    "Settle SA Fact", "Mature SA Fact", "Price SA Factor", "SA Price", 
    "Market Yield", "SA Yield", "Diff (bps)"
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

  const outputPath = path.join(__dirname, '../data/TipsSaYields.csv');
  fs.writeFileSync(outputPath, csvContent);
  
  console.log(`Successfully processed ${results.length} bonds.`);
  console.log(`Results written to: ${outputPath}`);
}

main();

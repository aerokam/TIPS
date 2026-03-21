import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

// --- Yield from price (actual/actual, matches Excel YIELD(...,2,1)) ---
// Migrated from getTipsYields.js
function yieldFromPrice(cleanPrice, coupon, settleDate, matureDate) {
  if (!cleanPrice || cleanPrice <= 0) return null;
  const settle = settleDate;
  const mature = matureDate;
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

import { readFileSync } from 'fs';
import { yieldFromPrice } from './shared/src/bond-math.js';

const csv = readFileSync('./Yields/data/PriceYields20260324.csv', 'utf8');
const lines = csv.split(/\r?\n/);

const SETTLE_T0 = new Date(2026, 2, 24);
const SETTLE_T1 = new Date(2026, 2, 25);

function parseDate(s) {
  const [m, d, y] = s.trim().split('/').map(Number);
  return new Date(y < 100 ? 2000 + y : y, m - 1, d);
}
function pct(s) {
  if (!s || !s.trim()) return null;
  const v = parseFloat(s.replace('%', ''));
  return isNaN(v) ? null : v / 100;
}

const rows = [];
for (const line of lines) {
  const c = line.split(',');
  const cusip = c[2]?.trim();
  if (!cusip || cusip.length !== 9 || !/^[A-Z0-9]{9}$/.test(cusip)) continue;
  const typeLabel = c[11]?.trim();
  if (!typeLabel || typeLabel === 'TIPS') continue;
  const coupon = pct(c[4]) ?? 0;
  const matStr = c[5]?.trim();
  if (!matStr) continue;
  const maturity = parseDate(matStr);
  const buy = parseFloat(c[7]) || 0;
  const sell = parseFloat(c[8]) || 0;
  const buyYield = pct(c[12]);
  const sellYield = pct(c[13]);
  if (buy > 0 && buyYield !== null) rows.push({ cusip, typeLabel, coupon, maturity, price: buy, refYield: buyYield });
  else if (sell > 0 && sellYield !== null) rows.push({ cusip, typeLabel, coupon, maturity, price: sell, refYield: sellYield });
}

console.log(`Testing ${rows.length} rows\n`);

for (const settle of [SETTLE_T0, SETTLE_T1]) {
  const label = settle.toLocaleDateString('en-US');
  let totalErr = 0, count = 0, maxErr = 0, bad = [];
  for (const r of rows) {
    const calc = yieldFromPrice(r.price, r.coupon, settle, r.maturity);
    if (calc === null || isNaN(calc)) continue;
    const err = Math.abs(calc - r.refYield) * 10000;
    totalErr += err; count++;
    if (err > maxErr) maxErr = err;
    if (err > 2) bad.push({ ...r, calc, err });
  }
  bad.sort((a, b) => b.err - a.err);
  console.log(`Settle ${label}: avg=${(totalErr/count).toFixed(2)}bp  max=${maxErr.toFixed(2)}bp  >2bp=${bad.length}/${count}`);
  for (const w of bad.slice(0, 10)) {
    const mat = w.maturity.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    console.log(`  ${w.typeLabel.padEnd(4)} ${w.cusip}  ${mat.padEnd(14)}  cpn=${(w.coupon*100).toFixed(3)}%  price=${w.price.toFixed(4)}  ref=${(w.refYield*100).toFixed(3)}%  calc=${(w.calc*100).toFixed(3)}%  err=${w.err.toFixed(1)}bp`);
  }
  console.log();
}

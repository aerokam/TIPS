// Regression tests — must pass after every refactor phase
// Replicates browser data loading + parsing, then runs rebalance and build.
// Any refactor must produce identical output for all assertions here.

import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { buildTipsMapFromYields, localDate, runRebalance, inferDARAFromCash } from '../src/rebalance-lib.js';
import { runBuild } from '../src/build-lib.js';

// ── CSV helpers (match index.html exactly) ────────────────────────────────────
function parseCsv(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(s => s.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(s => s.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
}

function parseHoldings(text) {
  const CUSIP_RE = /^[A-Z0-9]{9}$/i;
  const rawLines = text.trim().split('\n').filter(l => l.trim());
  const startIdx = CUSIP_RE.test(rawLines[0].split(',')[0].trim()) ? 0 : 1;
  const map = new Map();
  for (let i = startIdx; i < rawLines.length; i++) {
    const parts = rawLines[i].split(',').map(s => s.trim());
    const [cusip, qtyStr] = parts;
    if (!CUSIP_RE.test(cusip)) continue;
    const qty = parseInt(qtyStr, 10);
    if (!isNaN(qty) && qty >= 0) map.set(cusip, (map.get(cusip) ?? 0) + qty);
  }
  return Array.from(map, ([cusip, qty]) => ({ cusip, qty }));
}

function lookupRefCpi(refCpiRows, dateStr) {
  const matches = refCpiRows.filter(r => r.date <= dateStr);
  if (!matches.length) throw new Error(`No RefCPI on or before ${dateStr}`);
  return matches[matches.length - 1].refCpi;
}

// ── Load shared data ──────────────────────────────────────────────────────────
const yieldsPath = path.resolve('./tests/e2e/TipsYields.csv');
const refCpiPath = path.resolve('./tests/e2e/RefCPI.csv');

console.log(`[Test Setup] Market Data:   ${yieldsPath}`);
const yieldsRows = parseCsv(readFileSync(yieldsPath, 'utf8')).map(r => ({
  settlementDate: r.settlementDate,
  cusip:    r.cusip,
  maturity: r.maturity,
  coupon:   parseFloat(r.coupon),
  baseCpi:  parseFloat(r.baseCpi),
  price:    parseFloat(r.price)  || null,
  yield:    parseFloat(r.yield)  || null,
}));
console.log(`[Test Setup] Loaded ${yieldsRows.length} bonds from market data.`);

console.log(`[Test Setup] Reference CPI: ${refCpiPath}`);
const refCpiRows = parseCsv(readFileSync(refCpiPath, 'utf8')).map(r => ({
  date:   r.date,
  refCpi: parseFloat(r.refCpi),
}));

const settleDateStr = yieldsRows[0]?.settlementDate;
const settlementDate = localDate(settleDateStr);
const tipsMap = buildTipsMapFromYields(yieldsRows);
const refCPI = lookupRefCpi(refCpiRows, settleDateStr);

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

// Suppress "CUSIP not found" warnings from rebalance-lib during tests
// (Happens when local dev files contain CUSIPs missing from the static mock fixture)
const originalWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('not found in TIPS data')) return;
  originalWarn.apply(console, args);
};

function assert(name, actual, expected, tolerance = 0) {
  const ok = tolerance > 0
    ? Math.abs(actual - expected) <= tolerance
    : actual === expected;
  if (ok) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}`);
    console.error(`        expected: ${expected}`);
    console.error(`        actual:   ${actual}`);
    failed++;
  }
}

// ── Helper: Run Full Rebalance on a holdings file ─────────────────────────────
function runFullRebalanceTest(name, filePath) {
  const fullPath = path.resolve(filePath);
  if (!existsSync(fullPath)) return;

  console.log(`\n${name} — Full rebalance`);
  console.log(`  Input: ${fullPath}`);
  
  const holdings = parseHoldings(readFileSync(fullPath, 'utf8'));
  const { dara, portfolioCash } = inferDARAFromCash({ holdings, tipsMap, refCPI, settlementDate });
  const { summary } = runRebalance({ dara, method: 'Full', holdings, tipsMap, refCPI, settlementDate });
  
  // Net cash should be effectively non-negative (surplus) and < cost of one bond (~$1500).
  // (Allowing > -50 to account for binary search tolerance in inferDARA)
  const netCash = summary.costDeltaSum;
  const ok = netCash > -50 && netCash < 1500;
  
  if (ok) {
    console.log(`  PASS  net cash within (-50, 1500)`);
    passed++;
  } else {
    console.error(`  FAIL  net cash within (-50, 1500)`);
    console.error(`        actual:   ${netCash}`);
    failed++;
  }
  console.log(`        inferred DARA: ${Math.round(dara).toLocaleString()}`);
  console.log(`        net cash:      ${Math.round(netCash).toLocaleString()}`);
  console.log(`        surplus check: ${Math.round(summary.gapCoverageSurplus).toLocaleString()}`);
}

// ── Run tests on known files and local dev files ──────────────────────────────

// 1. Standard public test file
runFullRebalanceTest('CusipQtyTestLumpy', './tests/CusipQtyTestLumpy.csv');

// 2. All local CSVs in tests/dev/
const devDir = './tests/dev';
if (existsSync(devDir)) {
  readdirSync(devDir).forEach(file => {
    if (file.endsWith('.csv')) {
      runFullRebalanceTest(file, path.join(devDir, file));
    }
  });
}

// ── Test: Build from scratch — deterministic output ───────────────────────────
console.log('\nBuild — DARA=50000, lastYear=2040');
{
  const dara = 50000, lastYear = 2040;
  const { summary, results } = runBuild({ dara, lastYear, tipsMap, refCPI, settlementDate });
  assert('totalBuyCost > 0', summary.totalBuyCost > 0, true);
  assert('result rows > 0', results.length > 0, true);
  assert('lowerYear < upperYear', summary.lowerYear < summary.upperYear, true);
  assert('lowerWeight + upperWeight ≈ 1', summary.lowerWeight + summary.upperWeight, 1, 0.0001);
  console.log(`        totalBuyCost:  ${Math.round(summary.totalBuyCost).toLocaleString()}`);
  console.log(`        lowerYear:     ${summary.lowerYear}, upperYear: ${summary.upperYear}`);
  console.log(`        weights:       ${summary.lowerWeight.toFixed(4)} / ${summary.upperWeight.toFixed(4)}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

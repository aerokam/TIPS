#!/usr/bin/env node
// scripts/generate-test-fixtures.js
// Reads data/SchwabAllAccounts.csv and data/FidelityAllAccounts.csv (private, gitignored)
// Writes sanitized/scaled (÷5) versions to tests/ for use in test suite.
// Also writes data/SampleHoldings.csv (Format 3: cusip,qty in bonds) — the app's pre-populate sample.
//
// Sanitization rules:
//   - Bond face values: ÷5, rounded to nearest $1000
//   - ETF/MM share counts: ÷5
//   - Gain/loss, cost basis: zeroed / replaced with "--"
//   - Account numbers (Schwab suffix, Fidelity account#): replaced with sequential fakes
//   - Account NAMES: discarded entirely, replaced with synthetic "Acct<N>" labels that retain ONLY
//     the account-type keyword (IRA / Roth IRA) — the only thing downstream logic needs (see
//     detectAccountType in src/account-allocation.js). No real name can leak: the label is re-derived
//     from the type, never copied, so new or renamed accounts are safe by construction.
//   - Market values: recalculated for bonds, scaled ÷5 for other positions
//   - SampleHoldings.csv: the TIPS of the traditional IRA holding the most TIPS (the richest tIRA).

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT  = path.resolve(__dirname, '..');
const DATA  = path.join(ROOT, 'data');
const TESTS = path.join(ROOT, 'tests');
const E2E   = path.join(TESTS, 'e2e');

function die(msg) { console.error('ERROR:', msg); process.exit(1); }

// Account-type detection mirrors src/account-allocation.js detectAccountType: only the IRA / Roth IRA
// distinction is retained from a real account name; everything else (the names) is discarded.
function detectType(name) {
  const u = (name || '').toUpperCase();
  if (u.includes('ROTH')) return 'roth_ira';
  if (u.includes('IRA'))  return 'traditional_ira';
  return 'taxable';
}
function typeSuffix(t) {
  return t === 'roth_ira' ? ' Roth IRA' : t === 'traditional_ira' ? ' IRA' : '';
}

// ─── Schwab Format 2 ─────────────────────────────────────────────────────────

const SCHWAB_COL_HEADER =
  '"Symbol","Description","Qty (Quantity)","Price","Mkt Val (Market Value)","Gain $ (Gain/Loss $)","Gain % (Gain/Loss %)","Asset Type",';

function parseQuotedRow(line) {
  const cols = [];
  const re = /"([^"]*)"/g;
  let m;
  while ((m = re.exec(line)) !== null) cols.push(m[1]);
  return cols;
}

// Scale a Schwab position and return { row, mktNum, scaledBonds, isTips }
// scaledBonds is non-null only for Fixed Income with INFL IDX in description.
function scaleSchwabPos(cols) {
  const [sym, desc, qty, price, mktVal, , , assetType] = cols;
  if (!sym || sym === 'Symbol' || sym === 'Positions Total') return null;

  if (sym === 'Cash & Cash Investments') {
    return {
      row: '"Cash & Cash Investments","--","--","--","$0.00","--","--","Cash and Money Market",',
      mktNum: 0,
      scaledBonds: null,
    };
  }

  const rawQty = parseFloat(qty.replace(/,/g, ''));
  const isFixed = assetType.includes('Fixed Income');

  let scaledQtyNum, scaledQtyStr;
  if (isFixed) {
    scaledQtyNum = Math.round(rawQty / 5 / 1000) * 1000;
    scaledQtyStr = scaledQtyNum.toLocaleString('en-US');
  } else {
    scaledQtyNum = rawQty / 5;
    const cleanQty = qty.replace(/,/g, '');
    const dotIdx = cleanQty.indexOf('.');
    if (dotIdx >= 0) {
      const dec = cleanQty.length - dotIdx - 1;
      scaledQtyStr = scaledQtyNum.toFixed(dec);
    } else {
      const r = Math.round(scaledQtyNum);
      scaledQtyStr = r >= 1000 ? r.toLocaleString('en-US') : String(r);
    }
  }

  let mktNum;
  if (isFixed) {
    mktNum = scaledQtyNum * parseFloat(price) / 100;
  } else {
    mktNum = parseFloat(mktVal.replace(/[$,]/g, '')) / 5;
  }

  const isTips = isFixed && desc.includes('INFL IDX');
  const scaledBonds = isTips ? scaledQtyNum / 1000 : null;

  return {
    row: `"${sym}","${desc}","${scaledQtyStr}","${price}","$${mktNum.toFixed(2)}","$0.00","0%","${assetType}",`,
    mktNum,
    scaledBonds,
    sym,
    isTips,
  };
}

function sanitizeSchwab(text) {
  const lines = text.split('\n');
  const outLines = [lines[0]]; // date/time header

  // Parse into account sections
  const sections = [];
  let current = null;
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith('"')) {
      // Account header: "Name ...DIGITS"
      current = { rawName: trimmed.split(' ...')[0], positions: [] };
      sections.push(current);
    } else if (current && trimmed !== SCHWAB_COL_HEADER && !trimmed.startsWith('"Symbol"')) {
      const cols = parseQuotedRow(trimmed);
      if (cols.length >= 8) current.positions.push(cols);
    }
  }

  // Emit each section under a synthetic label (real name discarded; only IRA/Roth type retained).
  sections.forEach((section, idx) => {
    section.type      = detectType(section.rawName);
    section.tips      = [];   // "CUSIP,bonds" strings for this account's TIPS
    section.tipsBonds = 0;    // total scaled face (in bonds) — used to pick the richest tIRA

    outLines.push('', '');
    outLines.push(`Acct${idx + 1}${typeSuffix(section.type)} ...${String(idx + 1).padStart(3, '0')}`);
    outLines.push(SCHWAB_COL_HEADER);

    let totalMkt = 0;
    for (const cols of section.positions) {
      const result = scaleSchwabPos(cols);
      if (!result) continue;
      outLines.push(result.row);
      totalMkt += result.mktNum;
      if (result.isTips) {
        section.tips.push(`${result.sym},${result.scaledBonds}`);
        section.tipsBonds += result.scaledBonds;
      }
    }

    outLines.push(`"Positions Total","","--","--","$${totalMkt.toFixed(2)}","--","--","--",`);
  });

  // SampleHoldings source = the traditional IRA holding the most TIPS (by scaled face).
  const richestTIra = sections
    .filter(s => s.type === 'traditional_ira' && s.tips.length)
    .sort((a, b) => b.tipsBonds - a.tipsBonds)[0];
  const sampleTips = richestTIra ? richestTIra.tips : [];

  return { csv: outLines.join('\n') + '\n', sampleTips };
}

// ─── Fidelity Format 1 ───────────────────────────────────────────────────────

const FIDELITY_HEADER =
  'Account Number,Account Name,Symbol,Description,Quantity,Last Price,Last Price Change,' +
  'Current Value,Today\'s Gain/Loss Dollar,Today\'s Gain/Loss Percent,' +
  'Total Gain/Loss Dollar,Total Gain/Loss Percent,Percent Of Account,' +
  'Cost Basis Total,Average Cost Basis,Type';

function isCusip(sym) { return /^[A-Z0-9]{9}$/.test(sym); }

function scaleFidQty(qty, sym) {
  if (!qty || !qty.trim()) return '';
  const raw = parseFloat(qty);
  if (isNaN(raw)) return qty;
  if (isCusip(sym)) {
    // Bond face value: ÷5, round to nearest 1000
    return String(Math.round(raw / 5 / 1000) * 1000);
  }
  // ETF/MM shares: ÷5, same decimal places
  const scaled = raw / 5;
  const dotIdx = qty.indexOf('.');
  if (dotIdx >= 0) {
    const dec = qty.length - dotIdx - 1;
    return scaled.toFixed(dec);
  }
  return String(Math.round(scaled));
}

function scaleDollar(val) {
  if (!val || val === '--') return val ?? '--';
  const sign = val.startsWith('-') ? '-' : '';
  const num = parseFloat(val.replace(/[^0-9.]/g, ''));
  if (isNaN(num)) return val;
  return `${sign}$${(num / 5).toFixed(2)}`;
}

function sanitizeFidelity(text) {
  const lines = text.split('\n');
  const outLines = [FIDELITY_HEADER];

  const acctMap = {};
  const counters = { X: 0, Z: 0, N: 0 };
  function fakeAcct(real) {
    if (acctMap[real]) return acctMap[real];
    let fake;
    if (real.startsWith('X')) fake = `X${String(++counters.X).padStart(8, '0')}`;
    else if (real.startsWith('Z')) fake = `Z${String(++counters.Z).padStart(8, '0')}`;
    else fake = String(200000000 + ++counters.N);
    acctMap[real] = fake;
    return fake;
  }

  // Synthetic account NAME per real account (keyed on the real account number, assigned in
  // encounter order). Real name discarded; only the IRA/Roth type keyword is re-derived and kept.
  const nameMap = {};
  let nameSeq = 0;
  function fakeName(realNum, realName) {
    if (!(realNum in nameMap)) {
      nameSeq++;
      nameMap[realNum] = `Acct${nameSeq}${typeSuffix(detectType(realName))}`;
    }
    return nameMap[realNum];
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Stop at footer
    if (trimmed.startsWith('"The data') || trimmed.startsWith('"Brokerage') || trimmed.startsWith('"Date')) break;

    const cols = trimmed.split(',');
    const acctNum  = cols[0] ?? '';
    const acctName = fakeName(acctNum, cols[1] ?? '');  // synthetic label; real name discarded
    const sym      = cols[2] ?? '';
    const desc     = cols[3] ?? '';
    const qty      = cols[4] ?? '';
    const lastPrice = cols[5] ?? '';
    // col 6: Last Price Change — zero
    const curVal   = cols[7] ?? '';
    // cols 8-11: gain/loss — '--'
    const pctOfAcct = cols[12] || '--';
    // cols 13-14: cost basis — '--'
    const type     = cols[15] ?? '';

    const fakeNum = fakeAcct(acctNum);

    if (sym === 'SPAXX**') {
      const sv = scaleDollar(curVal);
      outLines.push(`${fakeNum},${acctName},SPAXX**,HELD IN MONEY MARKET,,,, ${sv},,,,,${pctOfAcct},,,${type},`);
      continue;
    }

    if (sym === 'Pending activity') {
      const sv = scaleDollar(curVal);
      outLines.push(`${fakeNum},${acctName},Pending activity,,,,,${sv},,,,,,`);
      continue;
    }

    const scaledQty = scaleFidQty(qty, sym);
    const scaledVal = scaleDollar(curVal);

    outLines.push(
      `${fakeNum},${acctName},${sym},${desc},${scaledQty},${lastPrice},$0.00,` +
      `${scaledVal},--,--,--,--,${pctOfAcct},--,--,${type},`
    );
  }

  return outLines.join('\n') + '\n';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const schwabSrc = path.join(DATA, 'SchwabAllAccounts.csv');
const fidelitySrc = path.join(DATA, 'FidelityAllAccounts.csv');

if (!existsSync(schwabSrc))   die(`Missing ${schwabSrc}\n  Copy SchwabAllAccounts.csv from Downloads to data/`);
if (!existsSync(fidelitySrc)) die(`Missing ${fidelitySrc}\n  Copy FidelityAllAccounts.csv from Downloads to data/`);

console.log('Reading', schwabSrc);
const { csv: schwabCsv, sampleTips } = sanitizeSchwab(readFileSync(schwabSrc, 'utf8'));

console.log('Reading', fidelitySrc);
const fidelityCsv = sanitizeFidelity(readFileSync(fidelitySrc, 'utf8'));

const schwabOut   = path.join(TESTS, 'SchwabAllAccounts.csv');
const fidelityOut = path.join(TESTS, 'FidelityAllAccounts.csv');
const holdingsOut = path.join(DATA,  'SampleHoldings.csv'); // single canonical copy: app pre-populate + tests both read here

writeFileSync(schwabOut,   schwabCsv,   'utf8');
writeFileSync(fidelityOut, fidelityCsv, 'utf8');

// Guard: never silently overwrite the canonical holdings file with a header-only stub.
// (A prior regen with no richest-tIRA TIPS flattened it and broke pre-populate + e2e.)
if (sampleTips.length === 0) die(`No traditional-IRA TIPS extracted from ${schwabSrc}; refusing to write an empty ${holdingsOut}`);
const holdingsCsv = ['cusip,qty', ...sampleTips].join('\n') + '\n';
writeFileSync(holdingsOut, holdingsCsv, 'utf8');

console.log(`Wrote ${schwabOut}   (${schwabCsv.split('\n').length} lines)`);
console.log(`Wrote ${fidelityOut}  (${fidelityCsv.split('\n').length} lines)`);
console.log(`Wrote ${holdingsOut} (${sampleTips.length} TIPS)`);

// ─── Auto-commit + push ────────────────────────────────────────────────────
// Regenerated fixtures never sit dirty across sessions (was causing repeated noise in
// `git status`): commit them here immediately, then push -- the repo's pre-push hook
// (.githooks/pre-push -> scripts/pre-push-tests.js) runs TipsLadderManager's test suites
// and blocks the push if anything fails, so a bad regen never reaches the remote.
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();
const fixtureFiles = [schwabOut, fidelityOut, holdingsOut];

const dirty = execFileSync('git', ['status', '--porcelain', '--', ...fixtureFiles], { cwd: REPO_ROOT }).toString().trim();
if (!dirty) {
  console.log('\nFixtures unchanged; nothing to commit.');
} else {
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();

  execFileSync('git', ['add', '--', ...fixtureFiles], { cwd: REPO_ROOT });
  execFileSync('git', ['commit', '-m', 'TipsLadderManager: refresh sample/test holdings fixtures'], { cwd: REPO_ROOT, stdio: 'inherit' });

  if (branch !== 'main') {
    console.log(`\nCommitted on branch "${branch}" (not main) -- not auto-pushing. Merge to main and push manually.`);
  } else {
    try {
      execFileSync('git', ['push'], { cwd: REPO_ROOT, stdio: 'inherit' });
      console.log('\nPushed.');
    } catch {
      console.error('\nPush BLOCKED (pre-push hook failed, likely a broken fixture regen). The commit is local -- fix the failing test, then run `git push` manually.');
      process.exitCode = 1;
    }
  }
}

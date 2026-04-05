import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');

const TIPS_REF_PATH = path.join(ROOT, 'tests/e2e/YieldsDerivedFromFedInvestPrices.csv');
const TARGET_FILES = [
  'tests/dev/FidelityAllAccounts.csv',
  'tests/dev/Schwab all accounts.csv'
];

// ─── Helper: Parse CSV Line (handles quoted values) ───────────────────────────
function parseCSVLine(str) {
  const arr = [];
  let quote = false;
  let col = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '"') {
      // Handle escaped quote "" inside string? Usually rare in these exports, assume simple pairing
      quote = !quote;
    } else if (c === ',' && !quote) {
      arr.push(col.trim());
      col = '';
    } else {
      col += c;
    }
  }
  arr.push(col.trim());
  return arr.map(s => s.replace(/^"|"$/g, '').trim()); // Strip wrapping quotes
}

// ─── Load Known TIPS CUSIPs ───────────────────────────────────────────────────
function getKnownTips() {
  if (!fs.existsSync(TIPS_REF_PATH)) {
    console.error(`Error: Reference file not found at ${TIPS_REF_PATH}`);
    process.exit(1);
  }
  const content = fs.readFileSync(TIPS_REF_PATH, 'utf8');
  const lines = content.trim().split('\n');
  const cusips = new Set();
  // Row 0 = settlement date, row 1 = header (type,cusip,...), rows 2+ = data; col 1 is CUSIP
  for (let i = 2; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length > 1) cusips.add(cols[1].trim());
  }
  console.log(`Loaded ${cusips.size} known TIPS CUSIPs from reference.`);
  return cusips;
}

// ─── Scan Logic ───────────────────────────────────────────────────────────────
function scanFile(filePath, validCusips) {
  const fullPath = path.join(ROOT, filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`\nFile not found: ${filePath}`);
    return;
  }

  console.log(`\nScanning: ${filePath}`);
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

  // State for parsing
  let map = { accountNum: -1, accountName: -1, symbol: -1, quantity: -1 };
  let currentSchwabAccount = null;
  const accounts = {}; // Key: AccountName -> { positions: [] }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Schwab Block Detection: "AccountName ...1234"
    // Regex looks for text followed by "..." and digits
    const schwabMatch = line.match(/^"?([^",\n]+?)\s*\.{3}(\d+)"?/);
    if (schwabMatch) {
      currentSchwabAccount = schwabMatch[1].trim(); // e.g. "Amy_IRA"
      // Schwab export usually repeats the header after the account name
      continue;
    }

    // End of Schwab Block
    if (line.startsWith('"Account Total"') || line.startsWith('Account Total')) {
      currentSchwabAccount = null;
      continue;
    }

    const cols = parseCSVLine(line);
    const lowerCols = cols.map(c => c.toLowerCase());

    // Header Detection (Dynamic - can happen multiple times)
    // Match "Quantity", "Qty", "Qty (Quantity)"
    const qIdx = lowerCols.findIndex(c => c === 'quantity' || c.startsWith('qty'));
    // Match "Symbol", "CUSIP"
    const sIdx = lowerCols.findIndex(c => c === 'symbol' || c === 'cusip');
    
    if (qIdx > -1 && sIdx > -1) {
      map.quantity = qIdx;
      map.symbol = sIdx;
      // Fidelity: "Account Number"
      // Schwab: "Account" (if present in header, though often implied by block)
      map.accountNum = lowerCols.findIndex(c => c.includes('account number') || c === 'account');
      // Fidelity: "Account Name"
      map.accountName = lowerCols.findIndex(c => c.includes('account name'));
      continue; // Skip the header row itself
    }

    // Data Row Processing
    if (map.symbol === -1 || map.quantity === -1) continue; // No header found yet
    if (cols.length <= map.quantity) continue; // Short row (footer/disclaimer)

    const rawSym = cols[map.symbol];
    if (!rawSym || rawSym.includes('Total')) continue;

    // Normalize CUSIP? Some exports might match directly
    if (validCusips.has(rawSym)) {
      const rawQtyStr = cols[map.quantity].replace(/[^0-9.]/g, ''); // Remove non-numeric chars
      // Broker exports usually show Face Value (e.g., 10,000 for 10 bonds).
      // We need bond count (Face Value / 1,000).
      const qty = Math.round(parseFloat(rawQtyStr) / 1000);
      
      if (isNaN(qty)) continue;

      // Identify Account
      let acctKey = 'Unknown';
      if (currentSchwabAccount) {
        acctKey = currentSchwabAccount;
      } else if (map.accountNum > -1 && cols[map.accountNum]) {
        acctKey = cols[map.accountNum];
        if (map.accountName > -1 && cols[map.accountName]) {
          // Combine or prefer name? Fidelity usually has Number. Name is nice for filename.
          // Let's use Name if available, else Number
          const name = cols[map.accountName];
          if (name && name !== 'nan') acctKey = name;
        }
      }

      if (!accounts[acctKey]) accounts[acctKey] = { positions: [] };
      accounts[acctKey].positions.push({ cusip: rawSym, qty });
    }
  }

  // 3. Generate Output Files
  const acctKeys = Object.keys(accounts);
  const userTotals = {}; // username -> Map<cusip, qty>
  const userAccountCounts = {}; // username -> count of accounts found

  if (acctKeys.length === 0) {
    console.log('  No TIPS holdings matched.');
  } else {
    acctKeys.forEach(k => {
      const a = accounts[k];
      console.log(`  Found Account: ${k}`);
      console.log(`    Positions: ${a.positions.length} TIPS`);
      
      const safeName = k.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const outName = `tests/dev/${safeName}.csv`;
      const outPath = path.join(ROOT, outName);
      
      const csvContent = a.positions.map(p => `${p.cusip},${p.qty}`).join('\n');
      fs.writeFileSync(outPath, csvContent);
      console.log(`    -> Wrote ${outName}`);

      // Aggregate by User (prefix before first underscore)
      const userName = safeName.split('_')[0];
      if (!userTotals[userName]) {
        userTotals[userName] = new Map();
        userAccountCounts[userName] = 0;
      }
      userAccountCounts[userName]++;
      a.positions.forEach(p => {
        userTotals[userName].set(p.cusip, (userTotals[userName].get(p.cusip) || 0) + p.qty);
      });
    });

    Object.keys(userTotals).forEach(user => {
      if (userAccountCounts[user] < 2) return; // Only create aggregate file if user has multiple accounts
      const outName = `tests/dev/${user}.csv`;
      const outPath = path.join(ROOT, outName);
      const csvContent = Array.from(userTotals[user]).map(([c, q]) => `${c},${q}`).join('\n');
      fs.writeFileSync(outPath, csvContent);
      console.log(`    -> Wrote Combined User File: ${outName}`);
    });
  }
}

const validCusips = getKnownTips();
TARGET_FILES.forEach(f => scanFile(f, validCusips));
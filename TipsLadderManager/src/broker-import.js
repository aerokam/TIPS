// broker-import.js -- Parses broker export CSVs (Fidelity, Schwab, Vanguard)
// Extracts TIPS holdings and aggregates them into a single list.

export function parseCSVLine(str) {
  const arr = [];
  let quote = false;
  let col = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '"') {
      quote = !quote;
    } else if (c === ',' && !quote) {
      arr.push(col.trim());
      col = '';
    } else {
      col += c;
    }
  }
  arr.push(col.trim());
  return arr.map(s => s.replace(/^"|"$/g, '').trim());
}

export function parseBrokerCSV(csvText, tipsMap) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  let map = { accountNum: -1, accountName: -1, symbol: -1, quantity: -1, currentValue: -1, investmentName: -1 };
  let currentSchwabAccount = null;
  const accounts = {}; // Key: AccountName -> Map<cusip, qty>
  const tipsValues = {}; // Key: AccountName -> sum of current value for TIPS only
  const totalAccountValues = {}; // Key: AccountName -> total current value (all positions)

  // Vanguard reverse lookup: "{couponPct}|{year}-{month}" → cusip
  // tipsMap stores coupon as fraction (0.02125); Vanguard names use percentage (2.125)
  const vanguardLookup = new Map();
  for (const [cusip, bond] of tipsMap) {
    const yr = bond.maturity.getFullYear();
    const mo = String(bond.maturity.getMonth() + 1).padStart(2, '0');
    const cpnPct = parseFloat((bond.coupon * 100).toPrecision(6));
    vanguardLookup.set(`${cpnPct}|${yr}-${mo}`, cusip);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Schwab account header: "Positions for account [Name] ...[Last 4 Digits] as of ..."
    // Extract text before the "...DIGITS" pattern
    const schwabMatch = line.match(/\.\.\.\d+/);
    if (schwabMatch) {
      // Find what comes before the "...DIGITS" part
      const beforeDots = line.substring(0, line.indexOf('...'));
      // Extract account name (remove "Positions for account" prefix and quotes)
      const acctName = beforeDots.replace(/^["']/, '').replace(/^Positions\s+for\s+account\s+/, '').replace(/\s*$/, '').trim();
      if (acctName) {
        currentSchwabAccount = acctName;
        continue;
      }
    }
    if (line.startsWith('"Account Total"') || line.startsWith('Account Total')) {
      currentSchwabAccount = null;
      continue;
    }

    const cols = parseCSVLine(line);
    const lowerCols = cols.map(c => c.toLowerCase());

    const qIdx = lowerCols.findIndex(c => c === 'quantity' || c.startsWith('qty') || c === 'shares');
    const sIdx = lowerCols.findIndex(c => c === 'symbol' || c === 'cusip');

    if (qIdx > -1 && sIdx > -1) {
      map.quantity = qIdx;
      map.symbol = sIdx;
      map.accountNum = lowerCols.findIndex(c => c.includes('account number') || c === 'account');
      map.accountName = lowerCols.findIndex(c => c.includes('account name'));
      map.currentValue = lowerCols.findIndex(c => c.includes('current value') || c.includes('market value') || c.includes('total value'));
      map.investmentName = lowerCols.findIndex(c => c === 'investment name');
      continue;
    }

    if (map.symbol === -1 || map.quantity === -1) continue;
    if (cols.length <= map.quantity) continue; // Short row

    const rawSym = cols[map.symbol];
    if (!rawSym || rawSym.includes('Total')) continue;

    // Determine account key first (needed for both TIPS and all positions)
    let acctKey = 'Unknown Account';
    if (currentSchwabAccount) {
      acctKey = currentSchwabAccount;
    } else if (map.accountNum > -1 && cols[map.accountNum]) {
      acctKey = cols[map.accountNum];
      if (map.accountName > -1 && cols[map.accountName]) {
        const name = cols[map.accountName];
        if (name && name !== 'nan') acctKey = name;
      }
    }

    // Track total account value for ALL positions
    if (map.currentValue > -1 && cols[map.currentValue]) {
      const valueStr = cols[map.currentValue].replace(/[^0-9.-]/g, '');
      const value = parseFloat(valueStr);
      if (!isNaN(value) && value > 0) {
        totalAccountValues[acctKey] = (totalAccountValues[acctKey] || 0) + value;
      }
    }

    // Resolve CUSIP: direct match (Fidelity/Schwab) or name-based match (Vanguard)
    let resolvedCusip = tipsMap.has(rawSym) ? rawSym : null;

    if (!resolvedCusip && map.investmentName > -1 && cols[map.investmentName]) {
      const invName = cols[map.investmentName];
      if (/inflation index/i.test(invName)) {
        const m = invName.match(/(\d*\.?\d+)\s+(\d{2})\/\d{2}\/(\d{2})/);
        if (m) {
          const year4d = 2000 + parseInt(m[3], 10);
          resolvedCusip = vanguardLookup.get(`${parseFloat(m[1])}|${year4d}-${m[2]}`) || null;
        }
      }
    }

    if (resolvedCusip) {
      const rawQtyStr = cols[map.quantity].replace(/[^0-9.-]/g, '');
      const faceValue = parseFloat(rawQtyStr);
      if (isNaN(faceValue) || faceValue <= 0) continue;

      const qty = Math.round(faceValue / 1000);
      if (qty <= 0) continue;

      if (!accounts[acctKey]) accounts[acctKey] = new Map();
      accounts[acctKey].set(resolvedCusip, (accounts[acctKey].get(resolvedCusip) || 0) + qty);

      if (map.currentValue > -1 && cols[map.currentValue]) {
        const valueStr = cols[map.currentValue].replace(/[^0-9.-]/g, '');
        const value = parseFloat(valueStr);
        if (!isNaN(value) && value > 0) {
          tipsValues[acctKey] = (tipsValues[acctKey] || 0) + value;
        }
      }
    }
  }

  const result = {};
  for (const [acct, posMap] of Object.entries(accounts)) {
    result[acct] = Array.from(posMap, ([cusip, qty]) => ({ cusip, qty }));
  }
  return { holdings: result, tipsValues, totalAccountValues };
}
// TIPS Ladder Rebalancing Engine — Node.js port of RebalnceForDurationMatch.js
// Usage: node rebalance.js [--dara AMOUNT] [--method Full|Gap] [holdings.csv]
//
// holdings.csv format: two columns, no header, no quotes
//   912828XX0,50
//   912828YY0,75

// ─── Configuration ───────────────────────────────────────────────────────────
const LOWEST_LOWER_BRACKET_YEAR = 2032;
const REFCPI_CUSIP = '912810FD5'; // matures 04/15/2028 — replace after that

const FEDINVEST_URL = 'https://www.treasurydirect.gov/GA-FI/FedInvest/securityPriceDetail';
const TIPSREF_URL =
  'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query' +
  '?format=json&sort=maturity_date' +
  '&filter=inflation_index_security:eq:Yes,reopening:eq:No' +
  '&fields=cusip,ref_cpi_on_dated_date,dated_date,maturity_date,security_term,int_rate' +
  '&page[number]=1&page[size]=150';

// ─── CLI args ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let dara = null, method = null, holdingsFile = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dara')   { dara = parseFloat(args[++i]); continue; }
    if (args[i] === '--method') { const m = args[++i]; method = m[0].toUpperCase() + m.slice(1).toLowerCase(); continue; }
    holdingsFile = args[i];
  }

  return { dara, method, holdingsFile };
}

// ─── Interactive prompts (simulates web form inputs) ─────────────────────────
// Any parameter not passed on CLI is prompted here.
// In the eventual web UI: holdingsFile → file upload, dara/method → form fields.
async function promptInputs(holdingsFile, dara, method) {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = prompt => new Promise(resolve => rl.question(prompt, resolve));

  if (!holdingsFile) {
    holdingsFile = (await ask('Holdings CSV path [e.g. data/holdings.csv]: ')).trim();
  }
  if (dara === null) {
    const ans = (await ask('DARA (leave blank to infer from holdings): ')).trim();
    dara = ans ? parseFloat(ans) : null;
  }
  if (method === null) {
    const ans = (await ask('Rebalance method — Gap or Full [default: Gap]: ')).trim();
    method = ans.toLowerCase() === 'full' ? 'Full' : 'Gap';
  }

  rl.close();
  return { holdingsFile, dara, method };
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function mostRecentWeekday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2);
  if (day === 6) d.setDate(d.getDate() - 1);
  return d;
}

function localDate(str) {
  // Parse YYYY-MM-DD as local date (not UTC)
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDateStr(date) {
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
}

function fmtDate(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const y = String(date.getFullYear()).slice(2);
  return `${m}/${d}/${y}`;
}

// ─── FedInvest fetch ──────────────────────────────────────────────────────────
async function fetchTipsPrices(date) {
  const day   = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year  = String(date.getFullYear());

  const body = new URLSearchParams({
    priceDateDay: day, priceDateMonth: month, priceDateYear: year,
    fileType: 'csv', csv: 'CSV FORMAT'
  });

  const res = await fetch(FEDINVEST_URL, { method: 'POST', body });
  if (!res.ok) throw new Error(`FedInvest HTTP ${res.status}`);

  const text = await res.text();
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  return lines.slice(1)
    .map(line => {
      const c = line.split(',').map(s => s.trim());
      return {
        cusip:    c[0],
        type:     c[1],
        coupon:   parseFloat(c[2]),   // decimal (e.g. 0.00125)
        maturity: c[3],               // YYYY-MM-DD
        buy:  parseFloat(c[5]) || 0,
        sell: parseFloat(c[6]) || 0,
        eod:  parseFloat(c[7]) || 0,
      };
    })
    .filter(r => r.type === 'TIPS');
}

// ─── Yield from price (actual/actual, matches Excel YIELD(...,2,1)) ───────────
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

  function pv(y)  {
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

// ─── Base CPI / metadata fetch (Treasury FiscalData auctions_query) ───────────
async function fetchBaseCpi() {
  const res = await fetch(TIPSREF_URL);
  if (!res.ok) throw new Error(`FiscalData HTTP ${res.status}`);
  const json = await res.json();
  return json.data.map(r => ({
    cusip:     r.cusip,
    baseCpi:   parseFloat(r.ref_cpi_on_dated_date),
    coupon:    parseFloat(r.int_rate) / 100,
    maturity:  r.maturity_date,
    datedDate: r.dated_date,
  }));
}

// ─── Settlement CPI fetch (TreasuryDirect secindex) ───────────────────────────
async function fetchSettlementCpi(dateStr) {
  const url =
    `https://www.treasurydirect.gov/TA_WS/secindex/search?cusip=${REFCPI_CUSIP}` +
    `&format=jsonp&callback=jQuery_CUSIP_FETCHER&filterscount=0&groupscount=0` +
    `&sortdatafield=indexDate&sortorder=asc&pagenum=0&pagesize=1000` +
    `&recordstartindex=0&recordendindex=1000&_=${Date.now()}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`TreasuryDirect HTTP ${res.status}`);
  const text = await res.text();
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Could not parse refCPI JSONP');

  const rows = JSON.parse(match[0]).map(r => ({
    date:   r.indexDate.split('T')[0],
    refCpi: parseFloat(r.refCpi),
  }));

  // Find exact match or nearest prior date
  const prior = rows.filter(r => r.date <= dateStr);
  if (prior.length === 0) throw new Error(`No settlement CPI data on or before ${dateStr}`);
  const row = prior[prior.length - 1];
  if (row.date !== dateStr) {
    console.error(`No settlement CPI for ${dateStr}, using ${row.date}`);
  }
  return row.refCpi;
}

// ─── Build unified TIPS map (keyed by CUSIP) ─────────────────────────────────
// Merges metadata from auctions_query with price/yield from FedInvest.
// Each entry: { cusip, maturity (Date), coupon, baseCpi, datedDate, price, yield }
//   coupon and maturity: from fetchBaseCpi (auctions_query) — authoritative
//   price: best available price (sell || eod || buy), null if not currently trading
//   yield: calculated from price using actual/actual bond math, null if no price
function buildTipsMap(baseCpiRows, priceRows, settleDateStr) {
  const map = new Map();
  for (const r of baseCpiRows) {
    map.set(r.cusip, {
      cusip:     r.cusip,
      maturity:  localDate(r.maturity),
      coupon:    r.coupon,
      baseCpi:   r.baseCpi,
      datedDate: r.datedDate,
      price:     null,
      yield:     null,
    });
  }
  for (const r of priceRows) {
    const entry = map.get(r.cusip);
    if (!entry) continue;
    const price = r.sell || r.eod || r.buy || null;
    if (price) {
      entry.price = price;
      entry.yield = yieldFromPrice(price, entry.coupon, settleDateStr, toDateStr(entry.maturity));
    }
  }
  return map;
}

// ─── Duration calculations (ported verbatim) ──────────────────────────────────
function getNumPeriods(settlement, maturity) {
  const months = (maturity.getFullYear() - settlement.getFullYear()) * 12 +
                 (maturity.getMonth() - settlement.getMonth());
  return Math.ceil(months / 6);
}

function calculateDuration(settlement, maturity, coupon, yld) {
  const settle = new Date(settlement);
  const mature = new Date(maturity);
  const periods = getNumPeriods(settle, mature);
  let weightedSum = 0, pvSum = 0;
  for (let i = 1; i <= periods; i++) {
    const cashflow = i === periods ? 1000 + coupon * 1000 / 2 : coupon * 1000 / 2;
    const pv = cashflow / Math.pow(1 + yld / 2, i);
    weightedSum += i * pv;
    pvSum += pv;
  }
  return weightedSum / pvSum / 2;
}

function calculateMDuration(settlement, maturity, coupon, yld) {
  return calculateDuration(settlement, maturity, coupon, yld) / (1 + yld / 2);
}

// ─── PI per bond ──────────────────────────────────────────────────────────────
function calculatePIPerBond(cusip, maturity, refCPI, tipsMap) {
  const bond = tipsMap.get(cusip);
  const coupon  = bond?.coupon  ?? 0;
  const baseCpi = bond?.baseCpi ?? refCPI; // default 1:1 index ratio if not found
  const indexRatio = refCPI / baseCpi;
  const adjustedPrincipal = 1000 * indexRatio;
  const adjustedAnnualInterest = adjustedPrincipal * coupon;
  const monthF = new Date(maturity).getMonth() + 1;
  const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
  return adjustedPrincipal + lastYearInterest;
}

// ─── Gap parameters ───────────────────────────────────────────────────────────
function calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings) {
  const holdingsByYear = {};
  for (const h of holdings) {
    if (!holdingsByYear[h.year]) holdingsByYear[h.year] = [];
    holdingsByYear[h.year].push(h);
  }

  let laterMaturityFrom2041Plus = 0;
  for (const year in holdingsByYear) {
    if (parseInt(year) > 2040) {
      for (const h of holdingsByYear[year]) {
        const bond = tipsMap.get(h.cusip);
        const coupon = bond?.coupon ?? 0;
        const baseCpi = bond?.baseCpi ?? refCPI;
        const indexRatio = refCPI / baseCpi;
        laterMaturityFrom2041Plus += h.qty * 1000 * indexRatio * coupon;
      }
    }
  }

  const tips2040 = holdingsByYear[2040] ? holdingsByYear[2040][0] : null;
  if (!tips2040) throw new Error('No holdings found for 2040');

  const piPerBond2040 = calculatePIPerBond(tips2040.cusip, tips2040.maturity, refCPI, tipsMap);
  const targetQty2040 = Math.round((DARA - laterMaturityFrom2041Plus) / piPerBond2040);

  const bond2040 = tipsMap.get(tips2040.cusip);
  const coupon2040 = bond2040?.coupon ?? 0;
  const baseCpi2040 = bond2040?.baseCpi ?? refCPI;
  const indexRatio2040 = refCPI / baseCpi2040;
  const annualInterest2040 = targetQty2040 * 1000 * indexRatio2040 * coupon2040;

  const gapLaterMaturityInterest = { 2040: annualInterest2040 };
  for (const year in holdingsByYear) {
    if (parseInt(year) > 2040) {
      gapLaterMaturityInterest[year] = 0;
      for (const h of holdingsByYear[year]) {
        const bond = tipsMap.get(h.cusip);
        const coupon = bond?.coupon ?? 0;
        const baseCpi = bond?.baseCpi ?? refCPI;
        const indexRatio = refCPI / baseCpi;
        gapLaterMaturityInterest[year] += h.qty * 1000 * indexRatio * coupon;
      }
    }
  }

  const minGapYear = Math.min(...gapYears);
  const maxGapYear = Math.max(...gapYears);
  let anchorBefore = null, anchorAfter = null;

  for (const bond of tipsMap.values()) {
    if (!bond.maturity || !bond.yield) continue;
    const year  = bond.maturity.getFullYear();
    const month = bond.maturity.getMonth() + 1;
    if (year === minGapYear - 1 && month === 1) {
      anchorBefore = { maturity: bond.maturity, yield: bond.yield };
    }
    if (year === maxGapYear + 1 && month === 2) {
      anchorAfter = { maturity: bond.maturity, yield: bond.yield };
    }
  }
  if (!anchorBefore || !anchorAfter) throw new Error('Could not find interpolation anchors for gap years');

  let totalDuration = 0, totalCost = 0, count = 0;
  for (const year of [...gapYears].sort((a, b) => b - a)) {
    const syntheticMat = new Date(year, 1, 15);
    const syntheticYield = anchorBefore.yield +
      (syntheticMat - anchorBefore.maturity) * (anchorAfter.yield - anchorBefore.yield) /
      (anchorAfter.maturity - anchorBefore.maturity);
    const syntheticCoupon = Math.max(0.00125, Math.floor(syntheticYield * 100 / 0.125) * 0.00125);

    totalDuration += calculateMDuration(settlementDate, syntheticMat, syntheticCoupon, syntheticYield);

    let sumLaterMaturityInterest = 0;
    for (const futYear in gapLaterMaturityInterest) {
      if (parseInt(futYear) > year) sumLaterMaturityInterest += gapLaterMaturityInterest[futYear];
    }

    const piPerBond = 1000 + 1000 * syntheticCoupon * 0.5;
    const qty = Math.round((DARA - sumLaterMaturityInterest) / piPerBond);
    totalCost += qty * 1000;
    count++;
  }

  return { avgDuration: totalDuration / count, totalCost };
}

// ─── Identify brackets ────────────────────────────────────────────────────────
function identifyBrackets(gapYears, holdings, yearInfo) {
  const upperYear = 2040;
  let upperMaturity = null, upperCUSIP = null, maxQty = 0;
  if (yearInfo[upperYear]) {
    for (const h of yearInfo[upperYear].holdings) {
      if (h.qty > maxQty) { maxQty = h.qty; upperMaturity = h.maturity; upperCUSIP = h.cusip; }
    }
  }

  const minGapYear = Math.min(...gapYears);
  let lowerYear = null, lowerMaturity = null, lowerCUSIP = null;
  maxQty = 0;

  for (const h of holdings) {
    if (h.year >= LOWEST_LOWER_BRACKET_YEAR && h.year < minGapYear && h.qty > maxQty) {
      maxQty = h.qty; lowerYear = h.year; lowerMaturity = h.maturity; lowerCUSIP = h.cusip;
    }
  }

  if (!lowerYear) {
    throw new Error(`Could not find lower bracket between ${LOWEST_LOWER_BRACKET_YEAR} and ${minGapYear - 1}`);
  }

  return { lowerYear, lowerMaturity, lowerCUSIP, upperYear, upperMaturity, upperCUSIP };
}

// ─── Main engine (ported from rebalanceHoldingsForGapDurationMatch) ───────────
async function main() {
  let { dara, method, holdingsFile } = parseArgs();

  // ── Prompt for any missing inputs (simulates web form) ──
  ({ holdingsFile, dara, method } = await promptInputs(holdingsFile, dara, method));

  // ── Load holdings (CSV: CUSIP,qty — no header, no quotes) ──
  const fs   = await import('fs');
  const path = await import('path');
  const holdingsRaw = fs.readFileSync(holdingsFile, 'utf8')
    .trim().split('\n')
    .filter(l => l.trim())
    .map(line => {
      const [cusip, qty] = line.split(',').map(s => s.trim());
      return { cusip, qty: parseInt(qty, 10) };
    });

  // ── Fetch TIPS prices — walk back from today until data is found ──
  console.error('Fetching TIPS prices from FedInvest...');
  let priceRows = [];
  let priceDate = mostRecentWeekday();
  for (let attempt = 0; attempt < 5; attempt++) {
    priceRows = await fetchTipsPrices(priceDate);
    if (priceRows.length > 0) break;
    console.error(`No data for ${toDateStr(priceDate)}, trying previous weekday...`);
    priceDate.setDate(priceDate.getDate() - 1);
    priceDate = mostRecentWeekday(priceDate);
  }
  if (priceRows.length === 0) throw new Error('No TIPS price data found');

  // Settlement date = whichever day FedInvest returned data for
  const settlementDate = priceDate;
  const settleDateStr  = toDateStr(settlementDate);   // YYYY-MM-DD — used internally
  const settleDateDisp = fmtDate(settlementDate);     // mm/dd/yy — used in output
  console.error(`Settlement date: ${settleDateStr}`);

  console.error('Fetching base CPI from Treasury FiscalData...');
  const baseCpiRows = await fetchBaseCpi();

  console.error('Fetching settlement CPI from TreasuryDirect...');
  const refCPI = await fetchSettlementCpi(settleDateStr);
  console.error(`Settlement CPI: ${refCPI}`);

  // ── Build unified TIPS map ──
  const tipsMap = buildTipsMap(baseCpiRows, priceRows, settleDateStr);

  // ── Build holdings list with maturity from tipsMap ──
  const holdings = [];
  for (const h of holdingsRaw) {
    const bond = tipsMap.get(h.cusip);
    if (!bond) {
      console.error(`Warning: CUSIP ${h.cusip} not found in TIPS data — skipping`);
      continue;
    }
    holdings.push({
      cusip:    h.cusip,
      qty:      h.qty,
      maturity: bond.maturity,
      year:     bond.maturity.getFullYear(),
    });
  }
  holdings.sort((a, b) => a.maturity - b.maturity);

  // ── DARA: use --dara arg or infer from holdings ──
  const yearInfo = {};
  holdings.forEach((h, idx) => {
    if (!yearInfo[h.year]) yearInfo[h.year] = { firstIdx: idx, lastIdx: idx, holdings: [] };
    yearInfo[h.year].lastIdx = idx;
    yearInfo[h.year].holdings.push(h);
  });

  // ── Determine firstYear / lastYear ──
  const holdingsYears = Object.keys(yearInfo).map(Number).sort((a, b) => a - b);
  const firstYear = holdingsYears[0];
  let lastYear = firstYear;
  for (let i = 0; i < holdingsYears.length; i++) {
    const year = holdingsYears[i];
    if (year <= 2040) { lastYear = year; continue; }
    const nextExpected = year + 1;
    const nextInHoldings = holdingsYears[i + 1];
    if (nextInHoldings && nextInHoldings === nextExpected) { lastYear = nextInHoldings; }
    else { lastYear = year; break; }
  }

  // ── Gap years: years in range with no outstanding TIPS and not in holdings ──
  const tipsMapYears = new Set();
  for (const bond of tipsMap.values()) {
    if (bond.maturity) tipsMapYears.add(bond.maturity.getFullYear());
  }
  const gapYears = [];
  for (let year = firstYear; year <= lastYear; year++) {
    if (!tipsMapYears.has(year) && !yearInfo[year]) gapYears.push(year);
  }

  // ── Calculate ARA per year (for inferred DARA) ──
  const araLaterMaturityInterestByYear = {};
  const araByYear = {};
  const allYearsSorted = Object.keys(yearInfo).map(Number).sort((a, b) => b - a);

  for (const year of allYearsSorted) {
    let laterMatInt = 0;
    for (const y in araLaterMaturityInterestByYear) {
      if (parseInt(y) > year) laterMatInt += araLaterMaturityInterestByYear[y];
    }
    let yearPrincipal = 0, yearLastYearInterest = 0;
    araLaterMaturityInterestByYear[year] = 0;
    for (const holding of yearInfo[year].holdings) {
      const bond = tipsMap.get(holding.cusip);
      const coupon = bond?.coupon ?? 0;
      const baseCpi = bond?.baseCpi ?? refCPI;
      const indexRatio = refCPI / baseCpi;
      const adjustedPrincipal = 1000 * indexRatio;
      const adjustedAnnualInterest = adjustedPrincipal * coupon;
      const monthF = holding.maturity.getMonth() + 1;
      const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
      yearPrincipal += holding.qty * adjustedPrincipal;
      yearLastYearInterest += holding.qty * lastYearInterest;
      araLaterMaturityInterestByYear[year] += holding.qty * adjustedAnnualInterest;
    }
    araByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
  }

  let araSum = 0;
  for (let year = firstYear; year <= lastYear; year++) {
    if (araByYear[year] !== undefined) araSum += araByYear[year];
  }
  const rungCount = lastYear - firstYear + 1;
  const inferredDARA = araSum / rungCount;
  const DARA = dara !== null ? dara : inferredDARA;

  const isFullMode = (method === 'Full');

  console.error(`DARA: ${DARA.toFixed(2)}${dara === null ? ' (inferred)' : ''}`);
  console.error(`Method: ${method}`);
  console.error(`First year: ${firstYear}, Last year: ${lastYear}`);
  console.error(`Gap years: ${gapYears.join(', ')}`);

  // ── STEP 1: Gap parameters ──
  const gapParams = calculateGapParameters(gapYears, settlementDate, refCPI, tipsMap, DARA, holdings);

  // ── STEP 2: Brackets ──
  const brackets = identifyBrackets(gapYears, holdings, yearInfo);

  // ── STEP 3: Bracket durations ──
  const lowerBond = tipsMap.get(brackets.lowerCUSIP);
  const upperBond = tipsMap.get(brackets.upperCUSIP);
  const lowerDuration = calculateMDuration(settlementDate, brackets.lowerMaturity,
    lowerBond?.coupon ?? 0, lowerBond?.yield ?? 0);
  const upperDuration = calculateMDuration(settlementDate, brackets.upperMaturity,
    upperBond?.coupon ?? 0, upperBond?.yield ?? 0);

  // ── STEP 4: Weights ──
  const lowerWeight = (upperDuration - gapParams.avgDuration) / (upperDuration - lowerDuration);
  const upperWeight = 1 - lowerWeight;

  // ── Phase 3: Before-state bracket excess (display only) ──
  const bracketYearSet = new Set([brackets.lowerYear, brackets.upperYear]);
  const gapYearSet     = new Set(gapYears);
  const minGapYear     = Math.min(...gapYears);

  // targetFYQty_before: uses current-holdings later maturity interest for before-state display
  const bracketTargetFYQtyBefore = {};
  for (const [bracketYear, bracketCUSIP, bracketMaturity] of [
    [brackets.lowerYear, brackets.lowerCUSIP, brackets.lowerMaturity],
    [brackets.upperYear, brackets.upperCUSIP, brackets.upperMaturity],
  ]) {
    let laterMatIntBefore = 0;
    for (const y in araLaterMaturityInterestByYear) {
      if (parseInt(y) > bracketYear) laterMatIntBefore += araLaterMaturityInterestByYear[y];
    }
    const yh = yearInfo[bracketYear].holdings;
    let tFYQty;
    if (yh.length === 1) {
      tFYQty = Math.round((DARA - laterMatIntBefore) / calculatePIPerBond(bracketCUSIP, bracketMaturity, refCPI, tipsMap));
    } else {
      let nonPI = 0;
      for (const h of yh) {
        if (h.cusip !== bracketCUSIP) nonPI += h.qty * calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap);
      }
      tFYQty = Math.round((DARA - laterMatIntBefore - nonPI) / calculatePIPerBond(bracketCUSIP, bracketMaturity, refCPI, tipsMap));
    }
    bracketTargetFYQtyBefore[bracketYear] = tFYQty;
  }

  // ── Phase 4: Ladder rebuild (longest to shortest) ──
  let rebalYearSet;
  if (isFullMode) {
    rebalYearSet = new Set(
      Object.keys(yearInfo).map(Number)
        .filter(y => y >= firstYear && y <= lastYear && !bracketYearSet.has(y) && !gapYearSet.has(y))
    );
  } else {
    rebalYearSet = new Set(
      Object.keys(yearInfo).map(Number)
        .filter(y => y > brackets.lowerYear && y < minGapYear)
    );
  }

  const bracketExcessTarget = {
    [brackets.lowerYear]: gapParams.totalCost * lowerWeight,
    [brackets.upperYear]: gapParams.totalCost * upperWeight,
  };

  const buySellTargets = {};
  const postRebalQtyMap = {};
  for (const h of holdings) postRebalQtyMap[h.cusip] = h.qty;

  let rebuildLaterMatInt = 0;
  const yearLaterMatIntSnapshot = {}; // laterMatInt from longer years, captured per year

  for (const year of allYearsSorted) { // allYearsSorted is descending
    if (gapYearSet.has(year)) continue;

    yearLaterMatIntSnapshot[year] = rebuildLaterMatInt;

    const yi        = yearInfo[year];
    const isBracket = bracketYearSet.has(year);
    const isRebal   = rebalYearSet.has(year);

    let targetCUSIP = null, targetMaturity = null, maxQty = 0;
    for (const h of yi.holdings) {
      if (h.qty > maxQty) { maxQty = h.qty; targetCUSIP = h.cusip; targetMaturity = h.maturity; }
    }

    const targetBond  = tipsMap.get(targetCUSIP);
    const tPrice      = targetBond?.price ?? 0;
    const tBaseCpi    = targetBond?.baseCpi ?? refCPI;
    const tIndexRatio = refCPI / tBaseCpi;
    const costPerBond = tPrice / 100 * tIndexRatio * 1000;

    const currentHolding = yi.holdings.find(h => h.cusip === targetCUSIP);
    const currentQty     = currentHolding ? currentHolding.qty : 0;

    let targetFYQty, postRebalQty;

    if (isBracket || isRebal) {
      if (yi.holdings.length === 1) {
        targetFYQty = Math.round((DARA - rebuildLaterMatInt) / calculatePIPerBond(targetCUSIP, targetMaturity, refCPI, tipsMap));
      } else {
        let nonTargetPI = 0;
        for (const h of yi.holdings) {
          if (h.cusip !== targetCUSIP) nonTargetPI += h.qty * calculatePIPerBond(h.cusip, h.maturity, refCPI, tipsMap);
        }
        targetFYQty = Math.round((DARA - rebuildLaterMatInt - nonTargetPI) / calculatePIPerBond(targetCUSIP, targetMaturity, refCPI, tipsMap));
      }
      postRebalQty = isBracket
        ? targetFYQty + Math.round(bracketExcessTarget[year] / costPerBond)
        : targetFYQty;
    } else {
      targetFYQty  = currentQty;
      postRebalQty = currentQty;
    }

    if (isBracket || isRebal) {
      buySellTargets[year] = {
        targetCUSIP, targetFYQty,
        targetQty: postRebalQty, postRebalQty, qtyDelta: postRebalQty - currentQty,
        targetCost:        targetFYQty * costPerBond,
        costDelta:         -((postRebalQty - currentQty) * costPerBond),
        costPerBond, isBracket,
        currentExcessCost: isBracket
          ? (currentQty - bracketTargetFYQtyBefore[year]) * costPerBond
          : undefined,
      };
    }

    postRebalQtyMap[targetCUSIP] = postRebalQty;
    for (const h of yi.holdings) {
      const qtyForInt = h.cusip === targetCUSIP ? postRebalQty : h.qty;
      const bond = tipsMap.get(h.cusip);
      const c  = bond?.coupon  ?? 0;
      const bc = bond?.baseCpi ?? refCPI;
      const ir = refCPI / bc;
      rebuildLaterMatInt += qtyForInt * 1000 * ir * c;
    }
  }

  // ── Before ARA (current holdings; brackets use targetFYQty_before for own rung) ──
  const beforeARAByYear = {};
  for (const year of allYearsSorted) {
    let laterMatInt = 0;
    for (const y in araLaterMaturityInterestByYear) {
      if (parseInt(y) > year) laterMatInt += araLaterMaturityInterestByYear[y];
    }
    let yearPrincipal = 0, yearLastYearInterest = 0;
    for (const holding of yearInfo[year].holdings) {
      const bond = tipsMap.get(holding.cusip);
      const coupon  = bond?.coupon  ?? 0;
      const baseCpi = bond?.baseCpi ?? refCPI;
      const indexRatio = refCPI / baseCpi;
      const adjustedPrincipal = 1000 * indexRatio;
      const adjustedAnnualInterest = adjustedPrincipal * coupon;
      const monthF = holding.maturity.getMonth() + 1;
      const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
      const isBracketTarget = bracketYearSet.has(year) && holding.cusip === buySellTargets[year]?.targetCUSIP;
      const qtyForARA = isBracketTarget ? bracketTargetFYQtyBefore[year] : holding.qty;
      yearPrincipal        += qtyForARA * adjustedPrincipal;
      yearLastYearInterest += qtyForARA * lastYearInterest;
    }
    beforeARAByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
  }

  // ── After ARA (post-rebalance; brackets use targetFYQty for own rung P+I) ──
  const postARAByYear = {};
  for (const year of allYearsSorted) {
    const laterMatInt = yearLaterMatIntSnapshot[year] ?? 0;
    let yearPrincipal = 0, yearLastYearInterest = 0;
    for (const holding of yearInfo[year].holdings) {
      const bond = tipsMap.get(holding.cusip);
      const coupon  = bond?.coupon  ?? 0;
      const baseCpi = bond?.baseCpi ?? refCPI;
      const indexRatio = refCPI / baseCpi;
      const adjustedPrincipal = 1000 * indexRatio;
      const adjustedAnnualInterest = adjustedPrincipal * coupon;
      const monthF = holding.maturity.getMonth() + 1;
      const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
      const bt = buySellTargets[year];
      let qtyForARA;
      if (bt && holding.cusip === bt.targetCUSIP) {
        qtyForARA = bt.isBracket ? bt.targetFYQty : bt.postRebalQty;
      } else {
        qtyForARA = postRebalQtyMap[holding.cusip];
      }
      yearPrincipal        += qtyForARA * adjustedPrincipal;
      yearLastYearInterest += qtyForARA * lastYearInterest;
    }
    postARAByYear[year] = yearPrincipal + yearLastYearInterest + laterMatInt;
  }

  // ── Build output rows ──
  const results = [];
  const outputLaterMaturityInterest = {};

  for (let i = holdings.length - 1; i >= 0; i--) {
    const h = holdings[i];
    const isLastInYear = (yearInfo[h.year].lastIdx === i);

    let sumLaterMaturityAnnualInterest = 0;
    for (const year in outputLaterMaturityInterest) {
      if (parseInt(year) > h.year) sumLaterMaturityAnnualInterest += outputLaterMaturityInterest[year];
    }

    let fy = '', principalFY = '', interestFY = '', araFY = '', costFY = '';
    let targetQty = '', qtyDelta = '', targetCost = '', costDelta = '';
    let araBeforeFY = '', araMinusDaraBefore = '', araAfterFY = '', araMinusDaraAfter = '';

    if (isLastInYear) {
      let yearPrincipal = 0, yearLastYearInterest = 0, yearCost = 0;
      for (const holding of yearInfo[h.year].holdings) {
        const bond = tipsMap.get(holding.cusip);
        const coupon = bond?.coupon ?? 0;
        const price  = bond?.price  ?? 0;
        const baseCpi = bond?.baseCpi ?? refCPI;
        const indexRatio = refCPI / baseCpi;
        const adjustedPrincipal = 1000 * indexRatio;
        yearPrincipal += holding.qty * adjustedPrincipal;
        const adjustedAnnualInterest = adjustedPrincipal * coupon;
        const monthF = holding.maturity.getMonth() + 1;
        const lastYearInterest = monthF < 7 ? adjustedAnnualInterest * 0.5 : adjustedAnnualInterest * 1.0;
        yearLastYearInterest += holding.qty * lastYearInterest;
        yearCost += holding.qty * (price / 100 * indexRatio * 1000);
      }
      fy = h.year;
      principalFY = yearPrincipal;
      interestFY  = yearLastYearInterest + sumLaterMaturityAnnualInterest;
      araFY       = principalFY + interestFY;
      costFY      = yearCost;
      araBeforeFY       = beforeARAByYear[h.year];
      araMinusDaraBefore = araBeforeFY - DARA;
      araAfterFY        = postARAByYear[h.year];
      araMinusDaraAfter  = araAfterFY - DARA;
    }

    if (buySellTargets[h.year] && h.cusip === buySellTargets[h.year].targetCUSIP) {
      targetQty  = buySellTargets[h.year].targetQty;
      qtyDelta   = buySellTargets[h.year].qtyDelta;
      targetCost = buySellTargets[h.year].targetCost;
      costDelta  = buySellTargets[h.year].costDelta;
    }

    // Excess held above targetFYQty — only meaningful for bracket years
    let excessBefore = '', excessAfter = '';
    const bt = buySellTargets[h.year];
    if (bt?.isBracket && h.cusip === bt.targetCUSIP) {
      excessBefore = bt.currentExcessCost;
      excessAfter  = (bt.postRebalQty - bt.targetFYQty) * bt.costPerBond;
    }

    const bond = tipsMap.get(h.cusip);
    const coupon = bond?.coupon ?? 0;
    const baseCpi = bond?.baseCpi ?? refCPI;
    const indexRatio = refCPI / baseCpi;
    if (!outputLaterMaturityInterest[h.year]) outputLaterMaturityInterest[h.year] = 0;
    outputLaterMaturityInterest[h.year] += h.qty * 1000 * indexRatio * coupon;

    results.unshift([
      h.cusip, h.qty, fmtDate(h.maturity), fy,
      principalFY, interestFY, araFY, costFY,
      targetQty, qtyDelta, targetCost, costDelta,
      araBeforeFY, araMinusDaraBefore, araAfterFY, araMinusDaraAfter,
      excessBefore, excessAfter,
    ]);
  }

  // ── Net cash ──
  const costDeltaSum = results.reduce((sum, row) => sum + (typeof row[11] === 'number' ? row[11] : 0), 0);

  // ── Summary ──
  const lowerCUSIP = brackets.lowerCUSIP;
  const upperCUSIP = brackets.upperCUSIP;
  const lowerBondS = tipsMap.get(lowerCUSIP);
  const upperBondS = tipsMap.get(upperCUSIP);
  const lowerPrice = lowerBondS?.price ?? 0;
  const lowerBaseCpi = lowerBondS?.baseCpi ?? refCPI;
  const lowerCostPerBond = lowerPrice / 100 * (refCPI / lowerBaseCpi) * 1000;
  const upperPrice = upperBondS?.price ?? 0;
  const upperBaseCpi = upperBondS?.baseCpi ?? refCPI;
  const upperCostPerBond = upperPrice / 100 * (refCPI / upperBaseCpi) * 1000;

  const lowerCurrentExcess = buySellTargets[brackets.lowerYear].currentExcessCost;
  const upperCurrentExcess = buySellTargets[brackets.upperYear].currentExcessCost;
  const totalCurrentExcess = lowerCurrentExcess + upperCurrentExcess;

  const lowerPostQty = buySellTargets[brackets.lowerYear].postRebalQty;
  const upperPostQty = buySellTargets[brackets.upperYear].postRebalQty;
  const lowerTargetFYQty = buySellTargets[brackets.lowerYear].targetFYQty;
  const upperTargetFYQty = buySellTargets[brackets.upperYear].targetFYQty;
  const lowerExcessQty = lowerPostQty - lowerTargetFYQty;
  const upperExcessQty = upperPostQty - upperTargetFYQty;
  const lowerExcessCost = lowerExcessQty * lowerCostPerBond;
  const upperExcessCost = upperExcessQty * upperCostPerBond;
  const totalExcessCost = lowerExcessCost + upperExcessCost;

  const beforeLowerWeight = totalCurrentExcess > 0 ? lowerCurrentExcess / totalCurrentExcess : null;
  const beforeUpperWeight = totalCurrentExcess > 0 ? upperCurrentExcess / totalCurrentExcess : null;
  const afterLowerWeight  = totalExcessCost > 0 ? lowerExcessCost / totalExcessCost : null;
  const afterUpperWeight  = totalExcessCost > 0 ? upperExcessCost / totalExcessCost : null;

  // ── Shared formatters ──
  const fmt2  = n => typeof n === 'number' ? n.toFixed(2) : String(n);
  const fmtI  = n => typeof n === 'number' ? Math.round(n).toLocaleString() : String(n);
  const pct   = n => typeof n === 'number' ? (n * 100).toFixed(1) + '%' : 'N/A';
  const sign  = n => typeof n === 'number' && n > 0 ? '+' + Math.round(n) : String(Math.round(n) || n);

  const HDR = ['CUSIP','Qty','Maturity','FY','Principal','Interest','ARA','Cost',
               'Target Qty','Qty Delta','Target Cost','Cost Delta',
               'ARA (Before)','ARA-DARA Before','ARA (After)','ARA-DARA After',
               'Excess $ Before','Excess $ After'];

  // ── 1. Console output ──────────────────────────────────────────────────────
  console.log('\n═══ TIPS Ladder Rebalance ════════════════════════════════════════════');
  console.log(`Settlement: ${settleDateDisp}  |  RefCPI: ${refCPI}  |  DARA: ${fmtI(DARA)}  |  Method: ${method}`);
  console.log(`Inferred DARA: ${fmtI(inferredDARA)}  |  Rungs: ${rungCount}  |  Gap years: ${gapYears.join(', ')}`);

  // Trades-only console view (the 16-col table is too wide — show just the actionable columns)
  console.log('\n─── Trades ───────────────────────────────────────────────────────────');
  const tradeCols = [0, 1, 2, 3, 8, 9, 11]; // CUSIP, Qty, Mat, FY, TgtQty, QtyΔ, CostΔ
  const tradeHdr  = ['CUSIP','Cur Qty','Maturity','FY','Tgt Qty','Qty Δ','Cost Δ'];
  const tradeData = results.map(r => tradeCols.map((ci, ti) => {
    if (ci === 11) return r[ci] !== '' ? sign(r[ci]) : '';
    if (ci === 9)  return r[ci] !== '' ? sign(r[ci]) : '';
    return r[ci] !== '' ? String(r[ci]) : '';
  }));
  const tW = tradeHdr.map((h, ti) => Math.max(h.length, ...tradeData.map(r => r[ti].length)));
  const fmtTrade = row => row.map((v, ti) => v.padStart(tW[ti])).join('  ');
  console.log(fmtTrade(tradeHdr));
  console.log(tW.map(w => '-'.repeat(w)).join('  '));
  tradeData.forEach(r => console.log(fmtTrade(r)));

  console.log('\n─── ARA vs DARA ──────────────────────────────────────────────────────');
  const araHdr = ['FY','ARA Before','Δ-DARA Bef','ARA After','Δ-DARA Aft'];
  const araData = results.filter(r => r[3] !== '').map(r =>
    [String(r[3]), fmtI(r[12]), fmtI(r[13]), fmtI(r[14]), fmtI(r[15])]
  );
  const aW = araHdr.map((h, i) => Math.max(h.length, ...araData.map(r => r[i].length)));
  const fmtAra = row => row.map((v, i) => v.padStart(aW[i])).join('  ');
  console.log(fmtAra(araHdr));
  console.log(aW.map(w => '-'.repeat(w)).join('  '));
  araData.forEach(r => console.log(fmtAra(r)));

  console.log('\n─── Duration Matching ────────────────────────────────────────────────');
  console.log(`Gap avg duration:  ${gapParams.avgDuration.toFixed(4)}`);
  console.log(`Lower bracket:     ${brackets.lowerYear} (${lowerCUSIP})  duration=${lowerDuration.toFixed(4)}`);
  console.log(`Upper bracket:     ${brackets.upperYear} (${upperCUSIP})  duration=${upperDuration.toFixed(4)}`);
  console.log(`Weights (target):  lower=${pct(lowerWeight)}  upper=${pct(upperWeight)}`);
  console.log(`Weights (before):  lower=${pct(beforeLowerWeight)}  upper=${pct(beforeUpperWeight)}`);
  console.log(`Weights (after):   lower=${pct(afterLowerWeight)}  upper=${pct(afterUpperWeight)}`);
  console.log(`Net cash:          ${sign(costDeltaSum)}`);

  // ── 2. CSV output ──────────────────────────────────────────────────────────
  const outDir = path.dirname(holdingsFile);

  // Dollar column indices (cols 4-7 and 10-17); qty/FY cols excluded from totals
  const DOLLAR_COLS = new Set([4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17]);

  // Format a single value for CSV: all numbers except FY get comma thousands separator
  const csvVal = (v, ci) => {
    if (typeof v !== 'number') return String(v);
    if (ci === 3) return String(v); // FY — plain integer year
    const s = Math.round(v).toLocaleString('en-US');
    return s.includes(',') ? `"${s}"` : s;
  };

  // Total row: label in CUSIP col, sum dollar cols, blank elsewhere
  const totalRow = HDR.map((_, ci) => {
    if (ci === 0) return 'TOTAL';
    if (!DOLLAR_COLS.has(ci)) return '';
    const sum = results.reduce((acc, r) => acc + (typeof r[ci] === 'number' ? r[ci] : 0), 0);
    const s = Math.round(sum).toLocaleString('en-US');
    return s.includes(',') ? `"${s}"` : s;
  }).join(',');

  const csvCombined = [
    HDR.join(','),
    ...results.map(r => r.map((v, ci) => csvVal(v, ci)).join(',')),
    totalRow,
    '',
    'Parameter,Value',
    `Settlement Date,${settleDateDisp}`,
    `RefCPI,${refCPI}`,
    `DARA,"${Math.round(DARA).toLocaleString('en-US')}"`,
    `Inferred DARA,"${Math.round(inferredDARA).toLocaleString('en-US')}"`,
    `Method,${method}`,
    `First Year,${firstYear}`,
    `Last Year,${lastYear}`,
    `Rungs,${rungCount}`,
    `Gap Years,"${gapYears.join(', ')}"`,
    `Net Cash,"${Math.round(costDeltaSum).toLocaleString('en-US')}"`,
    '',
    'Duration Matching,Value',
    `Gap Avg Duration,${gapParams.avgDuration.toFixed(4)}`,
    `Gap Total Cost,"${Math.round(gapParams.totalCost).toLocaleString('en-US')}"`,
    `Lower Bracket Year,${brackets.lowerYear}`,
    `Lower Bracket CUSIP,${lowerCUSIP}`,
    `Lower Duration,${lowerDuration.toFixed(4)}`,
    `Upper Bracket Year,${brackets.upperYear}`,
    `Upper Bracket CUSIP,${upperCUSIP}`,
    `Upper Duration,${upperDuration.toFixed(4)}`,
    '',
    'Weights,Target,Before,After',
    `Lower,${lowerWeight.toFixed(4)},${beforeLowerWeight !== null ? beforeLowerWeight.toFixed(4) : 'N/A'},${afterLowerWeight !== null ? afterLowerWeight.toFixed(4) : 'N/A'}`,
    `Upper,${upperWeight.toFixed(4)},${beforeUpperWeight !== null ? beforeUpperWeight.toFixed(4) : 'N/A'},${afterUpperWeight !== null ? afterUpperWeight.toFixed(4) : 'N/A'}`,
  ].join('\n');
  const csvMainPath = path.join(outDir, 'output_main.csv');
  fs.writeFileSync(csvMainPath, csvCombined);

  // ── 3. HTML output ─────────────────────────────────────────────────────────
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // ci 1=Qty, 3=FY: plain integer; ci 4+: comma-formatted integer (dollar columns)
  const cell = (v, ci) => {
    let s;
    if (typeof v !== 'number') {
      s = String(v);
    } else if (ci === 1 || ci === 3) {
      s = String(Math.round(v));
    } else {
      s = Math.round(v).toLocaleString('en-US');
    }
    return `<td class="${ci >= 4 ? 'num' : ''}">${esc(s)}</td>`;
  };

  const mainTableRows = results.map(r =>
    '<tr>' + r.map((v, ci) => cell(v, ci)).join('') + '</tr>'
  ).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>TIPS Ladder Rebalance — ${settleDateDisp}</title>
<style>
  body { font-family: system-ui, sans-serif; font-size: 13px; margin: 20px; color: #222; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .meta { color: #555; margin-bottom: 16px; }
  .sections { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 20px; }
  .box { background: #f7f7f7; border: 1px solid #ddd; border-radius: 6px; padding: 12px 16px; min-width: 220px; }
  .box h2 { font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: .05em; color: #555; }
  .box table { border-collapse: collapse; }
  .box td { padding: 2px 8px 2px 0; }
  .box td:last-child { font-weight: 600; text-align: right; padding-right: 0; }
  table.main { border-collapse: collapse; width: 100%; }
  table.main th { background: #222; color: #fff; padding: 5px 8px; text-align: right; font-weight: 600; white-space: nowrap; }
  table.main th:first-child, table.main th:nth-child(3), table.main th:nth-child(4) { text-align: left; }
  table.main td { padding: 4px 8px; border-bottom: 1px solid #eee; white-space: nowrap; }
  table.main td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.main tr:hover { background: #fffde7; }
  .pos { color: #2a7a2a; } .neg { color: #c0392b; }
  .net { font-weight: 700; font-size: 15px; margin-top: 8px; }
</style>
</head>
<body>
<h1>TIPS Ladder Rebalance</h1>
<p class="meta">Settlement: <b>${settleDateDisp}</b> &nbsp;|&nbsp; RefCPI: <b>${refCPI}</b> &nbsp;|&nbsp; DARA: <b>${fmtI(DARA)}</b> &nbsp;|&nbsp; Method: <b>${method}</b></p>

<div class="sections">
  <div class="box"><h2>Parameters</h2><table>
    <tr><td>Inferred DARA</td><td>${fmtI(inferredDARA)}</td></tr>
    <tr><td>First Year</td><td>${firstYear}</td></tr>
    <tr><td>Last Year</td><td>${lastYear}</td></tr>
    <tr><td>Rungs</td><td>${rungCount}</td></tr>
    <tr><td>Gap Years</td><td>${gapYears.join(', ')}</td></tr>
  </table></div>

  <div class="box"><h2>Duration Matching</h2><table>
    <tr><td>Gap Avg Duration</td><td>${gapParams.avgDuration.toFixed(4)}</td></tr>
    <tr><td>Lower (${brackets.lowerYear})</td><td>${lowerDuration.toFixed(4)}</td></tr>
    <tr><td>Upper (${brackets.upperYear})</td><td>${upperDuration.toFixed(4)}</td></tr>
  </table></div>

  <div class="box"><h2>Weights</h2><table>
    <tr><th></th><th>Target</th><th>Before</th><th>After</th></tr>
    <tr><td>Lower</td><td>${pct(lowerWeight)}</td><td>${pct(beforeLowerWeight)}</td><td>${pct(afterLowerWeight)}</td></tr>
    <tr><td>Upper</td><td>${pct(upperWeight)}</td><td>${pct(beforeUpperWeight)}</td><td>${pct(afterUpperWeight)}</td></tr>
  </table></div>

  <div class="box"><h2>Net Cash</h2>
    <p class="net ${costDeltaSum >= 0 ? 'pos' : 'neg'}">${sign(costDeltaSum)}</p>
  </div>
</div>

<table class="main">
<thead><tr>${HDR.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${mainTableRows}</tbody>
</table>

<script>
// Colour Qty Delta and Cost Delta cells
document.querySelectorAll('table.main tbody tr').forEach(tr => {
  [9, 11].forEach(ci => {
    const td = tr.cells[ci];
    if (!td) return;
    const v = parseFloat(td.textContent);
    if (!isNaN(v)) td.classList.add(v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  });
});
</script>
</body></html>`;

  const htmlPath = path.join(outDir, 'output.html');
  fs.writeFileSync(htmlPath, html);

  console.log(`\nOutput written to:`);
  console.log(`  ${csvMainPath}`);
  console.log(`  ${htmlPath}`);
  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });

// Load .env from repo root if present (local dev); does not override GH Actions env vars
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { yieldFromPrice as _yieldFromPrice } from '../shared/src/bond-math.js';
const _envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(_envPath)) {
  readFileSync(_envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

// Fetch Treasury prices from FedInvest, merge TIPS with TipsRef.csv metadata, calculate yields.
// Types written: TIPS, MARKET BASED BILL, MARKET BASED NOTE, MARKET BASED BOND (excludes FRN).
// Writes YieldsFromFedInvestPrices.csv to R2: row 1 = settlement date, row 2 = header, rows 3+ = data.
//
// Usage: node getYieldsFedInvest.js
// Prices published once daily at ~1pm ET on FedInvest; scheduled job runs at 1:05pm ET,
// retrying every 10 min for 2h (setup-windows-tasks.ps1) if today's prices aren't posted
// yet. Skips cleanly (exit 0, no retry) on bond market holidays.

const FEDINVEST_URL = 'https://www.treasurydirect.gov/GA-FI/FedInvest/todaySecurityPriceDetail';

const INCLUDE_TYPES = new Set(['TIPS', 'MARKET BASED BILL', 'MARKET BASED NOTE', 'MARKET BASED BOND']);

async function uploadToR2(key, body) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const {
    CLOUDFLARE_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET,
  } = process.env;

  if (!CLOUDFLARE_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error('Cloudflare R2 credentials not found in environment variables (CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).');
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });

  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: 'text/csv' }));
  console.error(`Wrote ${body.trim().split('\n').length - 1} rows → R2 bucket "${R2_BUCKET}", key "${key}"`);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
// Today's date in ET (handles EDT/EST automatically)
function todayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
}

function localDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// FedInvest maturity dates are MM/DD/YYYY → convert to YYYY-MM-DD
function parseFedInvestDate(str) {
  const [m, d, y] = str.split('/').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ─── FedInvest price fetch ────────────────────────────────────────────────────
async function fetchPrices() {
  const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};

  // GET HTML for settlement date + POST for CSV — run in parallel
  const [htmlRes, csvRes] = await Promise.all([
    fetch(FEDINVEST_URL),
    fetch(FEDINVEST_URL, { method: 'POST', body: new URLSearchParams({ fileType: 'csv', csv: 'CSV FORMAT' }) }),
  ]);
  if (!htmlRes.ok) throw new Error(`FedInvest HTML HTTP ${htmlRes.status}`);
  if (!csvRes.ok)  throw new Error(`FedInvest CSV HTTP ${csvRes.status}`);
  const [html, text] = await Promise.all([htmlRes.text(), csvRes.text()]);

  // No "Prices For:" in the page means prices aren't published yet (weekend, holiday, before 1 PM ET)
  if (!html.includes('Prices For:')) {
    console.error('FedInvest: prices not available.');
    return null;
  }

  // Handle both "2026 Mar 23" and "Mar 23, 2026" formats
  const m1 = html.match(/Prices For:\s+(\d{4})\s+(\w{3})\s+(\d+)/);
  const m2 = html.match(/Prices For:\s+(\w{3})\s+(\d+),\s+(\d{4})/);

  let y, mon, d;
  if (m1) {
    [ , y, mon, d] = m1;
  } else if (m2) {
    [ , mon, d, y] = m2;
  } else {
    throw new Error('Could not parse settlement date from FedInvest response');
  }
  const settleDateStr = `${y}-${String(months[mon] + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const rows = text.trim().split('\n')
    .filter(l => /^[A-Z0-9]{9},/.test(l))   // CUSIP data rows only
    .map(line => {
      const c = line.split(',').map(s => s.trim());
      return {
        cusip:    c[0],
        type:     c[1],
        coupon:   parseFloat(c[2]),
        maturity: c[3],
        buy:  parseFloat(c[5]) || 0,
        sell: parseFloat(c[6]) || 0,
        eod:  parseFloat(c[7]) || 0,
      };
    })
    .filter(r => INCLUDE_TYPES.has(r.type));

  return { rows, settleDateStr };
}

// ─── Yield from price ─────────────────────────────────────────────────────────
// Thin wrapper over shared/src/bond-math.js's yieldFromPrice (single source of
// truth — see knowledge/Bond_Basics.md §Treasury Bill Yield, knowledge/TIPS_Basics.md
// §Yield Calculation Conventions): always frequency=2 for coupon-bearing securities;
// zero-coupon bills use Treasury's own investment-rate/CEY convention. Date args
// here are strings (YYYY-MM-DD or FedInvest's MM/DD/YYYY-derived form); bond-math.js
// takes Date objects.
function yieldFromPrice(cleanPrice, coupon, settleDateStr, maturityStr) {
  return _yieldFromPrice(cleanPrice, coupon, localDate(settleDateStr), localDate(maturityStr));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const R2_BASE = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
  const R2_BASE_URL = `${R2_BASE}/TIPS`;

  // Check bond market holidays — skip cleanly on non-trading days
  const today = todayET();
  const holidayRes = await fetch(`${R2_BASE}/misc/BondHolidaysSifma.csv`);
  if (holidayRes.ok) {
    const holidayText = await holidayRes.text();
    // CSV format: "Day, Month DD, YYYY",Holiday Name — parse ISO date from full date string
    const holidays = new Set(
      holidayText.trim().split('\n')
        .map(line => {
          const m = line.match(/"[^,]+,\s+(\w+ \d+, \d{4})"/);
          if (!m) return null;
          const d = new Date(m[1]);
          return isNaN(d) ? null : d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        })
        .filter(Boolean)
    );
    if (holidays.has(today)) {
      console.error(`Bond market holiday (${today}) — no FedInvest prices today.`);
      return;
    }
  }

  // Read TipsRef.csv for TIPS dated-date CPI / coupon / maturity metadata
  console.error('Fetching TipsRef.csv from R2...');
  const refRes = await fetch(`${R2_BASE_URL}/TipsRef.csv`);
  if (!refRes.ok) throw new Error(`Failed to fetch TipsRef.csv from R2: ${refRes.status}`);
  const refText = await refRes.text();
  const refRows = refText
    .trim().split('\n').slice(1)               // skip header
    .filter(l => l.trim())
    .map(line => {
      const [cusip, maturity, datedDate, coupon, baseCpi, term] = line.split(',');
      return { cusip, maturity, datedDate, coupon: parseFloat(coupon), baseCpi: parseFloat(baseCpi), term };
    });

  const refMap = new Map(refRows.map(r => [r.cusip, r]));

  // Fetch FedInvest prices (today's latest available)
  console.error('Fetching prices from FedInvest...');
  const priceResult = await fetchPrices();
  if (priceResult === null) return; // weekend/holiday — clean exit
  const { rows: priceRows, settleDateStr } = priceResult;
  if (priceRows.length === 0) throw new Error('No price data found from FedInvest');
  console.error(`Settlement date: ${settleDateStr}`);

  // Guard: if FedInvest hasn't updated yet (still showing yesterday), exit non-zero so
  // the scheduled task's retry-on-failure setting (see setup-windows-tasks.ps1) tries
  // again later instead of silently leaving yesterday's data live.
  if (settleDateStr !== today) {
    console.error(`FedInvest still showing ${settleDateStr} (today is ${today} ET) — not ready yet.`);
    process.exitCode = 1;
    return;
  }

  // Merge prices with metadata and calculate yields
  const rows = [];
  for (const p of priceRows) {
    const price = p.buy || p.sell || p.eod || null;
    let maturity, coupon, datedDateCpi;

    if (p.type === 'TIPS') {
      const ref = refMap.get(p.cusip);
      if (!ref) continue; // no TipsRef metadata — skip
      maturity = ref.maturity;
      coupon = ref.coupon;
      datedDateCpi = ref.baseCpi;
    } else {
      maturity = parseFedInvestDate(p.maturity);
      coupon = p.coupon;
      datedDateCpi = '';
    }

    const yld = price ? yieldFromPrice(price, coupon, settleDateStr, maturity) : null;

    rows.push({
      type:         p.type,
      cusip:        p.cusip,
      maturity,
      coupon,
      datedDateCpi,
      price:        price ?? '',
      yield:        yld != null ? yld.toFixed(8) : '',
    });
  }

  // Write standardized and legacy keys to R2
  const header = 'type,cusip,maturity,coupon,datedDateCpi,price,yield';
  const lines = rows.map(r =>
    `${r.type},${r.cusip},${r.maturity},${r.coupon},${r.datedDateCpi},${r.price},${r.yield}`
  );
  const content = [settleDateStr, header, ...lines].join('\n') + '\n';
  
  await uploadToR2('Treasuries/YieldsFromFedInvestPrices.csv', content);

  const typeCounts = rows.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {});
  for (const [type, count] of Object.entries(typeCounts)) console.error(`  ${type}: ${count}`);
}

main().catch(err => { console.error(err); process.exit(1); });

// Load .env from repo root if present (local dev); does not override GH Actions env vars
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const _envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(_envPath)) {
  readFileSync(_envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

// Fetch Treasury prices from FedInvest, merge TIPS with TipsRef.csv metadata, calculate yields.
// Types written: TIPS, MARKET BASED BILL, MARKET BASED NOTE, MARKET BASED BOND (excludes FRN).
// Writes YieldsDerivedFromFedInvestPrices.csv to R2: row 1 = settlement date, row 2 = header, rows 3+ = data.
//
// Usage: node getYieldsFedInvest.js
// Prices published once daily at ~1pm ET on FedInvest; scheduled job runs at 18:05 UTC
// (1:05 PM EST / 2:05 PM EDT). Skips cleanly on bond market holidays and when prices
// are not yet available.

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
// Actual/actual day count. Freq auto-detected: 1 if days(settle,mature) < half-year, else 2.
// Freq=1: single-period annual discounting (bills, and any security within ~6 months of maturity).
// Freq=2: standard semi-annual BEY (matches Excel YIELD(...,2,1)).
function yieldFromPrice(cleanPrice, coupon, settleDateStr, maturityStr) {
  if (!cleanPrice || cleanPrice <= 0) return null;
  const settle = localDate(settleDateStr);
  const mature = localDate(maturityStr);
  if (settle >= mature) return null;

  const days = (a, b) => (b - a) / 86400000;
  const daysToMat = days(settle, mature);

  function hasLeapDayBetween(d1, d2) {
    for (let yr = d1.getFullYear(); yr <= d2.getFullYear(); yr++) {
      const feb29 = new Date(yr, 1, 29);
      if (feb29.getMonth() === 1 && feb29 > d1 && feb29 <= d2) return true;
    }
    return false;
  }
  const leapSpan = hasLeapDayBetween(settle, mature);
  const freq = daysToMat < (leapSpan ? 183 : 182.5) ? 1 : 2;

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

  // ── Freq=1: single-period annual yield ──
  if (freq === 1) {
    const daysInYear = leapSpan ? 366 : 365;
    const w = daysToMat / daysInYear;
    let dirtyPrice = cleanPrice;
    if (semiCoupon > 0) {
      const nextCoupon = nextCouponOnOrAfter(settle);
      if (nextCoupon) {
        const lastCoupon = new Date(nextCoupon.getFullYear(), nextCoupon.getMonth() - 6, 15);
        const E = days(lastCoupon, nextCoupon);
        const A = days(lastCoupon, settle);
        dirtyPrice = cleanPrice + semiCoupon * (A / E);
      }
    }
    const lastCF = semiCoupon + 100;
    let y = coupon > 0.005 ? coupon : 0.02;
    for (let i = 0; i < 200; i++) {
      const pv = lastCF / Math.pow(1 + y, w);
      const diff = pv - dirtyPrice;
      if (Math.abs(diff) < 1e-10) break;
      const dpv = -lastCF * w / Math.pow(1 + y, w + 1);
      if (Math.abs(dpv) < 1e-15) break;
      y -= diff / dpv;
    }
    return y;
  }

  // ── Freq=2: semi-annual BEY ──
  const nextCoupon = nextCouponOnOrAfter(settle);
  if (!nextCoupon) return null;
  const lastCoupon = new Date(nextCoupon.getFullYear(), nextCoupon.getMonth() - 6, 15);

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

  // Guard: if FedInvest hasn't updated yet (still showing yesterday), skip upload.
  if (settleDateStr !== today) {
    console.error(`FedInvest still showing ${settleDateStr} (today is ${today} ET) — skipping upload.`);
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
  
  await uploadToR2('Treasuries/Yields.csv', content);
  await uploadToR2('Treasuries/YieldsDerivedFromFedInvestPrices.csv', content);
  await uploadToR2('TIPS/YieldsDerivedFromFedInvestPrices.csv', content);

  const typeCounts = rows.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {});
  for (const [type, count] of Object.entries(typeCounts)) console.error(`  ${type}: ${count}`);
}

main().catch(err => { console.error(err); process.exit(1); });

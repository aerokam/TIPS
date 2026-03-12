// Fetch TIPS prices from FedInvest, merge with TipsRef.csv metadata, calculate yields.
// Reads data/TipsRef.csv for base CPI / coupon metadata.
// Writes data/TipsYields.csv with settlement date, price, and yield per CUSIP.
//
// Usage: node getTipsYields.js
// Prices published once daily at ~1pm ET on FedInvest; scheduled job runs at 1:00 and 1:05 PM ET.

const FEDINVEST_URL = 'https://www.treasurydirect.gov/GA-FI/FedInvest/todaySecurityPriceDetail';

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

// ─── Date helper (used by yieldFromPrice) ────────────────────────────────────
function localDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ─── FedInvest price fetch ────────────────────────────────────────────────────
async function fetchTipsPrices() {
  const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};

  // GET HTML for settlement date + POST for CSV — run in parallel
  const [htmlRes, csvRes] = await Promise.all([
    fetch(FEDINVEST_URL),
    fetch(FEDINVEST_URL, { method: 'POST', body: new URLSearchParams({ fileType: 'csv', csv: 'CSV FORMAT' }) }),
  ]);
  if (!htmlRes.ok) throw new Error(`FedInvest HTML HTTP ${htmlRes.status}`);
  if (!csvRes.ok)  throw new Error(`FedInvest CSV HTTP ${csvRes.status}`);
  const [html, text] = await Promise.all([htmlRes.text(), csvRes.text()]);

  // "Prices For: 2026 Mar 3" → YYYY-MM-DD
  const m = html.match(/Prices For:\s+(\d{4})\s+(\w{3})\s+(\d+)/);
  if (!m) throw new Error('Could not parse settlement date from FedInvest response');
  const settleDateStr = new Date(+m[1], months[m[2]], +m[3]).toLocaleDateString('en-CA');

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
    .filter(r => r.type === 'TIPS');

  return { rows, settleDateStr };
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
  const R2_BASE_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS';

  // Read TipsRef.csv for base CPI / coupon / maturity metadata
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
  console.error('Fetching TIPS prices from FedInvest...');
  const { rows: priceRows, settleDateStr } = await fetchTipsPrices();
  if (priceRows.length === 0) throw new Error('No TIPS price data found from FedInvest');
  console.error(`Settlement date: ${settleDateStr}`);

  // Merge prices with metadata and calculate yields
  const rows = [];
  for (const p of priceRows) {
    const ref = refMap.get(p.cusip);
    if (!ref) continue; // no metadata for this CUSIP — skip

    const price = p.sell || p.eod || p.buy || null;
    const yld   = price ? yieldFromPrice(price, ref.coupon, settleDateStr, ref.maturity) : null;

    rows.push({
      settlementDate: settleDateStr,
      cusip:    p.cusip,
      maturity: ref.maturity,
      coupon:   ref.coupon,
      baseCpi:  ref.baseCpi,
      price:    price ?? '',
      yield:    yld != null ? yld.toFixed(8) : '',
    });
  }

  // Write TipsYields.csv to R2
  const header = 'settlementDate,cusip,maturity,coupon,baseCpi,price,yield';
  const lines = rows.map(r =>
    `${r.settlementDate},${r.cusip},${r.maturity},${r.coupon},${r.baseCpi},${r.price},${r.yield}`
  );
  await uploadToR2('TIPS/TipsYields.csv', [header, ...lines].join('\n') + '\n');
}

main().catch(err => { console.error(err); process.exit(1); });

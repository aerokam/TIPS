// Fetch daily reference CPI (NSA) from TreasuryDirect
// Usage: node fetchRefCpi.js [YYYY-MM-DD]
//   No date → prints last 30 days
//   With date → prints refCpi for that date (or nearest prior date)
//
// Uses CUSIP 912810FD5 (3.625% TIPS, matures 04/15/2028).
// !! Replace with a longer-dated CUSIP after April 2028 !!
// Any active TIPS CUSIP works — refCpi is market-wide (same for all on a given date).
// Pick the one with the longest history from: https://www.treasurydirect.gov/TA_WS/secindex/search?cusip=<CUSIP>
// Good candidates: longest-dated 30-yr TIPS on-the-run at the time.

const CUSIP = '912810FD5';

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

async function fetchRefCpi() {
  const url = 'https://www.treasurydirect.gov/TA_WS/secindex/search' +
    `?cusip=${CUSIP}&format=jsonp&callback=jQuery_CUSIP_FETCHER` +
    `&filterscount=0&groupscount=0` +
    `&sortdatafield=indexDate&sortorder=asc` +
    `&pagenum=0&pagesize=1000&recordstartindex=0&recordendindex=1000` +
    `&_=${Date.now()}`;

  console.error(`Fetching reference CPI (CUSIP ${CUSIP})...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();

  // Strip JSONP wrapper: _([...]) or jQuery_...([...])
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Could not parse JSONP response');

  return JSON.parse(match[0]).map(r => ({
    date:   r.indexDate.split('T')[0],
    refCpi: parseFloat(r.refCpi)
  }));
}

async function main() {
  const arg = process.argv[2];
  const rows = await fetchRefCpi();

  if (rows.length === 0) {
    console.error('No data returned.');
    process.exit(1);
  }

  if (arg === '--write') {
    // Write all rows to RefCPI.csv in R2
    const header = 'date,refCpi';
    const lines = rows.map(r => `${r.date},${r.refCpi}`);
    const body = [header, ...lines].join('\n') + '\n';
    await uploadToR2('TIPS/RefCPI.csv', body);
  } else if (arg) {
    // Find exact match or nearest prior date
    const matches = rows.filter(r => r.date <= arg);
    if (matches.length === 0) {
      console.error(`No data on or before ${arg}.`);
      process.exit(1);
    }
    const row = matches[matches.length - 1]; // already sorted asc
    if (row.date !== arg) {
      console.error(`No data for ${arg}, using nearest prior date.`);
    }
    console.log(`${row.date}  ${row.refCpi.toFixed(5)}`);
  } else {
    // Print last 30 days
    const recent = rows.slice(-30);
    console.log(`\nReference CPI (NSA) — ${rows.length} total dates, showing last ${recent.length}\n`);
    console.log('Date          RefCPI');
    console.log('----------  --------');
    recent.forEach(r => console.log(`${r.date}  ${r.refCpi.toFixed(5)}`));
  }
}

main().catch(err => { console.error(err); process.exit(1); });

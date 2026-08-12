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

// Load .env from repo root if present (local dev); does not override real env vars
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

const CUSIP = '912810FD5';
const R2_PUBLIC_BASE = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';

// Ref CPI for the 1st of month M = CPI-U NSA for month M-3; interpolation across month M
// needs the month-M and month-(M+1) anchors, so a value published through month M+2 the CPI
// for month M is known covers all of month M+2. Used to detect whether TreasuryDirect has
// caught up to today's BLS release yet (TreasuryDirect lags BLS by an unknown amount).
async function expectedMinRefCpiDate() {
  const res = await fetch(`${R2_PUBLIC_BASE}/bls/CPI_history.csv`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`CPI_history.csv fetch failed: ${res.status}`);
  const lines = (await res.text()).trim().split('\n');
  const [lastYear, lastPeriod] = lines[lines.length - 1].split(',');
  const year = parseInt(lastYear, 10);
  const month = parseInt(lastPeriod.slice(1), 10); // "M07" -> 7
  // Last day of (month+2), computed as day-before-1st-of-(month+3), pure integer math (no Date/TZ).
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let targetMonth = month + 2; // last day of month+2 = target month whose length we need
  let targetYear = year;
  while (targetMonth > 12) { targetMonth -= 12; targetYear += 1; }
  let lastDay = daysInMonth[targetMonth - 1];
  const isLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || targetYear % 400 === 0;
  if (targetMonth === 2 && isLeap) lastDay = 29;
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

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
    // TreasuryDirect lags BLS by an unknown amount; verify it has actually caught up to the
    // latest BLS CPI month before publishing, so a same-day chained run doesn't overwrite
    // R2 with data that looks "successful" but is still missing the newest month.
    const latestDate = rows[rows.length - 1].date;
    try {
      const expected = await expectedMinRefCpiDate();
      if (latestDate < expected) {
        console.error(`TreasuryDirect not yet caught up: latest date ${latestDate}, expected through ${expected}. Not writing — will retry.`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`Freshness check skipped (${err.message}) — writing anyway.`);
    }

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

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

// Fetch full BLS CPI-U history (1913–present) and upload to R2 as bls/CPI_history.csv.
//
// BLS free tier: max 10 years per request → batches in 10-year windows.
// Series fetched: CUUR0000SA0 (NSA) and CUSR0000SA0 (SA).
// SA is only available from January 1947; earlier SA fields will be blank.
//
// Usage:
//   node scripts/fetchCpiHistory.js          → dry run (prints row count + first/last rows)
//   node scripts/fetchCpiHistory.js --write  → uploads to R2

const R2_KEY = 'bls/CPI_history.csv';
const BLS_API = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const SERIES = ['CUUR0000SA0', 'CUSR0000SA0'];
const FIRST_YEAR = 1913;
const BATCH_YEARS = 10; // BLS free-tier limit per request

async function uploadToR2(key, body) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!CLOUDFLARE_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error('R2 credentials not set (CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).');
  }
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: 'text/csv' }));
  console.log(`Uploaded ${body.trim().split('\n').length - 1} rows → R2 "${R2_BUCKET}/${key}"`);
}

async function fetchBatch(startYear, endYear) {
  const payload = JSON.stringify({ seriesid: SERIES, startyear: String(startYear), endyear: String(endYear) });
  const res = await fetch(BLS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  if (!res.ok) throw new Error(`BLS API HTTP ${res.status} for ${startYear}–${endYear}`);
  const data = await res.json();
  if (data.status !== 'REQUEST_SUCCEEDED') {
    // BLS sometimes returns partial data with warnings; log but continue
    console.warn(`BLS warning for ${startYear}–${endYear}:`, (data.message || []).join('; '));
  }
  return data.Results?.series || [];
}

async function fetchAllCpiHistory() {
  const currentYear = new Date().getFullYear();
  const lookup = {}; // key: "YYYY-Mnn" → { year, period, periodName, nsa, sa }

  let batchStart = FIRST_YEAR;
  let batchNum = 0;
  while (batchStart <= currentYear) {
    const batchEnd = Math.min(batchStart + BATCH_YEARS - 1, currentYear);
    console.log(`Fetching ${batchStart}–${batchEnd}...`);
    const series = await fetchBatch(batchStart, batchEnd);

    series.forEach(s => {
      const isNSA = s.seriesID === 'CUUR0000SA0';
      const isSA  = s.seriesID === 'CUSR0000SA0';
      s.data.forEach(item => {
        // Skip annual averages (M13) and any non-monthly codes
        if (!/^M\d{2}$/.test(item.period) || item.period === 'M13') return;
        const key = `${item.year}-${item.period}`;
        if (!lookup[key]) {
          lookup[key] = { year: item.year, period: item.period, periodName: item.periodName, nsa: '', sa: '' };
        }
        const val = (item.value === '-' || item.value === undefined) ? '' : item.value;
        if (isNSA) lookup[key].nsa = val;
        if (isSA)  lookup[key].sa  = val;
      });
    });

    batchStart += BATCH_YEARS;
    batchNum++;

    // Polite delay between requests (BLS asks for reasonable rate limiting)
    if (batchStart <= currentYear) await new Promise(r => setTimeout(r, 500));
  }

  console.log(`Fetched ${batchNum} batches from BLS.`);

  // Sort ascending: year ASC, period ASC (M01 < M02 ... < M12)
  const rows = Object.values(lookup).sort((a, b) => {
    if (a.year !== b.year) return parseInt(a.year) - parseInt(b.year);
    return a.period.localeCompare(b.period);
  });

  return rows;
}

async function main() {
  const doWrite = process.argv.includes('--write');

  console.log(`fetchCpiHistory — fetching BLS CPI-U from ${FIRST_YEAR} to present`);
  const rows = await fetchAllCpiHistory();

  if (rows.length === 0) {
    console.error('No data returned from BLS.');
    process.exit(1);
  }

  const csv = [
    'Year,Period,PeriodName,NSA,SA',
    ...rows.map(r => [r.year, r.period, r.periodName, r.nsa, r.sa].join(',')),
  ].join('\n') + '\n';

  console.log(`\nTotal rows: ${rows.length}`);
  console.log('First row:', rows[0]);
  console.log('Last row: ', rows[rows.length - 1]);

  if (doWrite) {
    await uploadToR2(R2_KEY, csv);
  } else {
    console.log('\nDry run — pass --write to upload to R2.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });

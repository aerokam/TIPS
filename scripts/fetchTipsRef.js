// Fetch per-bond base CPI (ref_cpi_on_dated_date) for all TIPS from Treasury FiscalData
// Usage: node fetchTipsRef.js [CUSIP]
//   No arg  → prints all TIPS sorted by maturity
//   CUSIP   → prints just that bond's base CPI

// auctions_query with reopening:eq:No gives one row per unique TIPS (~107 bonds).
// Excludes reopenings so each CUSIP appears once with its original ref_cpi_on_dated_date.
const URL = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query' +
  '?format=json&sort=maturity_date' +
  '&filter=inflation_index_security:eq:Yes,reopening:eq:No' +
  '&fields=cusip,ref_cpi_on_dated_date,dated_date,maturity_date,security_term,int_rate' +
  '&page[number]=1&page[size]=150';

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

async function fetchTipsRef() {
  console.error('Fetching TIPS base CPI from Treasury FiscalData...');
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();

  return json.data.map(r => ({
    cusip:       r.cusip,
    maturity:    r.maturity_date,
    datedDate:   r.dated_date,
    coupon:      parseFloat(r.int_rate) / 100, // decimal (e.g. 0.00125)
    baseCpi:     parseFloat(r.ref_cpi_on_dated_date),
    term:        r.security_term,
  }));
}

async function main() {
  const arg = process.argv[2];
  const rows = await fetchTipsRef();

  if (arg) {
    // Diagnostic lookup for a single CUSIP
    const row = rows.find(r => r.cusip === arg.toUpperCase());
    if (!row) {
      console.error(`CUSIP ${arg} not found.`);
      process.exit(1);
    }
    console.log(`CUSIP:      ${row.cusip}`);
    console.log(`Maturity:   ${row.maturity}`);
    console.log(`Dated date: ${row.datedDate}`);
    console.log(`Coupon:     ${(row.coupon * 100).toFixed(3)}%`);
    console.log(`Base CPI:   ${row.baseCpi.toFixed(5)}`);
  } else {
    // Write TipsRef.csv to R2
    const header = 'cusip,maturity,datedDate,coupon,baseCpi,term';
    const lines = rows.map(r =>
      `${r.cusip},${r.maturity},${r.datedDate},${r.coupon},${r.baseCpi},${r.term}`
    );
    const body = [header, ...lines].join('\n') + '\n';
    await uploadToR2('TIPS/TipsRef.csv', body);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

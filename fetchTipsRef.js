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
    // Write data/TipsRef.csv
    const fs = await import('fs');
    const path = await import('path');
    const outPath = path.join(__dirname, 'data', 'TipsRef.csv');
    const header = 'cusip,maturity,datedDate,coupon,baseCpi,term';
    const lines = rows.map(r =>
      `${r.cusip},${r.maturity},${r.datedDate},${r.coupon},${r.baseCpi},${r.term}`
    );
    fs.writeFileSync(outPath, [header, ...lines].join('\n') + '\n');
    console.error(`Wrote ${rows.length} rows → ${outPath}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

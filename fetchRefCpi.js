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
    // Write all rows to data/RefCPI.csv
    const fs   = await import('fs');
    const path = await import('path');
    const outPath = path.join(__dirname, 'data', 'RefCPI.csv');
    const header = 'date,refCpi';
    const lines = rows.map(r => `${r.date},${r.refCpi}`);
    fs.writeFileSync(outPath, [header, ...lines].join('\n') + '\n');
    console.error(`Wrote ${rows.length} rows → ${outPath}`);
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

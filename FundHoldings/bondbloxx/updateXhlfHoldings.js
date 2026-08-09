import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { upload } from "../../shared/upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

// BondBloxx product pages server-render the full "All Holdings" table as
// static HTML rather than exposing a JSON API — the page's own "Download
// CSV" button just re-serializes this same table client-side via JS, so
// parsing the table directly from the fetched page is equivalent and avoids
// needing a headless browser. Fund URL is hardcoded per ticker since there's
// no public ticker->URL lookup.
const FUND_URLS = {
  XHLF: "https://bondbloxxetf.com/bondbloxx-bloomberg-six-month-target-duration-us-treasury-etf/"
};

const FUND_NAMES = {
  XHLF: "BondBloxx Bloomberg Six Month Target Duration US Treasury ETF"
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/118.0.5993.117 Safari/537.36";

// Bond rows read e.g. "US T BILL ZCP 06/10/27" (ZCP = zero coupon); the
// CASHUSD and NET OTHER ASSETS balancing rows don't match and are left with
// a blank Coupon/Maturity Date, naturally excluded downstream (no CUSIP
// match in the yield files).
const ZCP_NAME_RE = /^US T BILL ZCP\s+(\d{2})\/(\d{2})\/(\d{2})$/;

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").trim();
}

function parseNumber(s) {
  return s.replace(/[$,\s%]/g, "");
}

function mmddyyToIso(mm, dd, yy) {
  return `20${yy}-${mm}-${dd}`;
}

async function fetchHoldingsPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Holdings page fetch failed for ${url}: HTTP ${res.status}`);
  return res.text();
}

function parseAsOfDate(html) {
  const match = html.match(/class="asOfDate">(\d{2})\/(\d{2})\/(\d{4})</);
  if (!match) throw new Error("Could not find asOfDate on holdings page");
  const [, mm, dd, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

// Both figures are rendered directly into the page (no separate API call),
// as percent-scale numbers (e.g. "0.03%"), matching the project's
// Coupon-field convention.
function parseExpenseRatioAndSecYield(html) {
  const erMatch = html.match(/<h4>EXPENSE RATIO<\/h4>\s*<strong>([\d.]+)%<\/strong>/);
  const secMatch = html.match(/<h4>30-Day Sec Yield<\/h4>\s*<strong>([\d.]+)%<\/strong>/i);
  return {
    expenseRatio: erMatch ? Number(erMatch[1]) : null,
    secYield: secMatch ? Number(secMatch[1]) : null
  };
}

// The "All Holdings" table is the only <table border="1"> on the page (every
// other table on BondBloxx product pages omits the border attribute).
function parseHoldingsTable(html) {
  const tableMatch = html.match(/<table border="1">([\s\S]*?)<\/table>/);
  if (!tableMatch) throw new Error('Could not find holdings table (<table border="1">) on page');

  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  const rows = [];
  let rowMatch;
  let isHeader = true;
  while ((rowMatch = rowRe.exec(tableMatch[1])) !== null) {
    if (isHeader) {
      isHeader = false; // first <tr> holds <th> column headers, not data
      continue;
    }
    const cellRe = /<td>([\s\S]*?)<\/td>/g;
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(decodeEntities(cellMatch[1]));
    }
    if (cells.length !== 4) throw new Error(`Expected 4 cells (Name, CUSIP, Market Value, % of Net Assets) in holdings row, got ${cells.length}`);
    rows.push(cells);
  }
  if (rows.length === 0) throw new Error("Holdings table had no data rows");
  return rows;
}

const CSV_HEADERS = [
  "CUSIP",
  "Holding Name",
  "Ticker",
  "Category",
  "Quantity",
  "Coupon",
  "% of Fund",
  "Market Value",
  "Maturity Date",
  "ISIN",
  "SEDOL",
  "As of"
];

function toCsv(rows, asOf) {
  const lines = [CSV_HEADERS.join(",")];
  for (const [name, cusip, marketValue, pctOfAssets] of rows) {
    const zcpMatch = name.match(ZCP_NAME_RE);
    const fields = [
      cusip,
      name,
      "",
      "",
      "",
      zcpMatch ? "0" : "",
      parseNumber(pctOfAssets),
      parseNumber(marketValue),
      zcpMatch ? mmddyyToIso(zcpMatch[1], zcpMatch[2], zcpMatch[3]) : "",
      "",
      "",
      asOf
    ];
    lines.push(fields.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n") + "\n";
}

const FUND_META_PATH = path.join(DATA_DIR, "FundMeta.json");

function saveFundMeta(ticker, meta) {
  let all = {};
  if (fs.existsSync(FUND_META_PATH)) {
    all = JSON.parse(fs.readFileSync(FUND_META_PATH, "utf8"));
  }
  all[ticker] = meta;
  fs.writeFileSync(FUND_META_PATH, JSON.stringify(all, null, 2) + "\n", "utf8");
}

export async function updateBondbloxxHoldings(tickers) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const ticker of tickers) {
    const url = FUND_URLS[ticker];
    if (!url) throw new Error(`Unknown BondBloxx ticker ${ticker} — add it to FUND_URLS`);

    console.log(`\n=== Fetching ${ticker} ===`);
    const html = await fetchHoldingsPage(url);
    const rows = parseHoldingsTable(html);
    const asOf = parseAsOfDate(html);
    console.log(`${ticker}: ${rows.length} holdings as of ${asOf}`);
    const { expenseRatio, secYield } = parseExpenseRatioAndSecYield(html);

    const csv = toCsv(rows, asOf);
    const filename = path.join(DATA_DIR, `Holdings-${ticker}.csv`);
    fs.writeFileSync(filename, csv, "utf8");
    await upload(filename, "FundHoldings");

    saveFundMeta(ticker, { fundName: FUND_NAMES[ticker] || "", expenseRatio, secYield });
  }

  await upload(FUND_META_PATH, "FundHoldings", "application/json");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tickers = process.argv.slice(2);
  updateBondbloxxHoldings(tickers.length ? tickers : ["XHLF"]).catch(err => {
    console.error("updateBondbloxxHoldings failed:", err);
    process.exitCode = 1;
  });
}

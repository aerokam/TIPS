import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

// fminvest.com's holdings API is keyed by an internal numeric ETF id, not the
// ticker, and there's no public ticker->id lookup endpoint — so the mapping
// is hardcoded here as funds are added.
const FUND_IDS = { RBIL: 11 };

const FUND_NAMES = { RBIL: "F/m Ultrashort Treasury Inflation-Protected Security (TIPS) ETF" };

// A bond row's field_name ends in "<coupon>% <mm>/<dd>/<yyyy>" (e.g.
// "United States Treasury Inflation Indexed Bonds 0.125% 10/15/2026"); the
// cash/sweep row ("Cash & Other") has no such suffix and no real CUSIP in
// field_symbol, so it's left with a blank Coupon/Maturity Date and is
// naturally excluded downstream (no CUSIP match in the yield files).
const NAME_SUFFIX_RE = /(\d+(?:\.\d+)?)%\s+(\d{2})\/(\d{2})\/(\d{4})\s*$/;

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").trim();
}

function parseAsOfDate(html) {
  const match = html.match(/datetime="([^"]+)"/);
  if (!match) throw new Error(`Could not parse field_as_of_date from: ${html}`);
  return match[1].slice(0, 10);
}

// fminvest's JSON values carry stray trailing whitespace/newlines (e.g.
// field_weightings comes back as "25.71%\n"), so strip all whitespace along
// with the currency/comma formatting.
function parseNumber(s) {
  return s.replace(/[$,\s]/g, "");
}

async function getHoldings(etfId) {
  const url = `https://www.fminvest.com/api/v1/etfs/${etfId}/holdings`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Holdings fetch failed for etf ${etfId}: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error(`No holdings data for etf ${etfId}`);
  return data;
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

function toCsv(data) {
  const asOf = parseAsOfDate(data[0].field_as_of_date);
  const lines = [CSV_HEADERS.join(",")];
  for (const item of data) {
    const name = decodeEntities(item.field_name);
    const suffixMatch = name.match(NAME_SUFFIX_RE);
    const fields = [
      decodeEntities(item.field_symbol),
      name,
      "",
      "",
      parseNumber(item.field_par_value),
      suffixMatch ? suffixMatch[1] : "",
      parseNumber(item.field_weightings.replace("%", "").trim()),
      parseNumber(item.field_market_value),
      suffixMatch ? `${suffixMatch[4]}-${suffixMatch[2]}-${suffixMatch[3]}` : "",
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

export async function updateFminvestHoldings(tickers) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const ticker of tickers) {
    const etfId = FUND_IDS[ticker];
    if (!etfId) throw new Error(`Unknown fminvest ticker ${ticker} — add it to FUND_IDS`);

    console.log(`\n=== Fetching ${ticker} ===`);
    const data = await getHoldings(etfId);
    console.log(`${ticker}: ${data.length} holdings`);

    const csv = toCsv(data);
    const filename = path.join(DATA_DIR, `Holdings-${ticker}.csv`);
    fs.writeFileSync(filename, csv, "utf8");
    console.log(`Wrote ${filename}`);

    saveFundMeta(ticker, { fundName: FUND_NAMES[ticker] || "", etfId });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tickers = process.argv.slice(2);
  updateFminvestHoldings(tickers.length ? tickers : ["RBIL"]).catch(err => {
    console.error("updateFminvestHoldings failed:", err);
    process.exitCode = 1;
  });
}

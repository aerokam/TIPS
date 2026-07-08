import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/118.0.5993.117 Safari/537.36";

// Categories that hold real positions. allocationToUnderlyingFunds is a
// look-through view that duplicates equity/fixedIncome/shortTermReserves
// for single-layer funds, so it is intentionally excluded here.
const HOLDING_CATEGORIES = ["equity", "fixedIncome", "shortTermReserves", "derivatives"];

async function getPortId(ticker) {
  const url = `https://advisors.vanguard.com/investments/products/${ticker.toLowerCase()}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Product page fetch failed for ${ticker}: HTTP ${res.status}`);

  const html = await res.text();
  const match = html.match(/__INITIAL_FUND_DATA__\s*=\s*(\{.*?\})\s*;?\s*<\/script>/s);
  if (!match) throw new Error(`Could not find __INITIAL_FUND_DATA__ for ${ticker}`);

  const fundData = JSON.parse(match[1]);
  if (!fundData.portId) throw new Error(`No portId in fund data for ${ticker}`);
  return { portId: fundData.portId, fundName: fundData.fundName || "" };
}

// Not every fund publishes a "daily" snapshot (money-market-like funds such as
// VBIL do; standard index funds like VTIP 404 on it and only have "latest",
// which for those funds is the last monthly/quarterly holdings disclosure).
// Try daily first since it's fresher when available, then fall back.
const HOLDINGS_ENDPOINTS = [
  { path: "holdings/daily", dateKeyField: "dailyEffectiveDate" },
  { path: "holdings/latest", dateKeyField: "latestEffectiveDate" }
];

async function getHoldings(portId) {
  let lastErr;
  for (const { path: endpointPath, dateKeyField } of HOLDINGS_ENDPOINTS) {
    const url = `https://advisors.vanguard.com/investments/products/api/funds/${portId}/${endpointPath}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (res.status === 404) {
      lastErr = new Error(`${endpointPath} not available for portId ${portId}`);
      continue;
    }
    if (!res.ok) throw new Error(`Holdings API fetch failed for portId ${portId}: HTTP ${res.status}`);

    const body = await res.json();
    const asOf = body[dateKeyField];
    const categories = body[asOf];
    if (!categories) throw new Error(`No holdings payload for date ${asOf}`);
    return buildRows(categories, asOf);
  }
  throw lastErr;
}

function buildRows(categories, asOf) {

  const seen = new Set();
  const rows = [];
  for (const category of HOLDING_CATEGORIES) {
    for (const h of categories[category] || []) {
      const key = h.cusip || `${category}:${h.holdingName}:${h.finalMaturityDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...h, category });
    }
  }
  return { asOf, rows };
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
  for (const r of rows) {
    // TIPS holdings report "faceAmount" instead of "quantity" (par value held).
    const fields = [
      r.cusip || "",
      r.holdingName || "",
      r.ticker || "",
      r.category || "",
      r.quantity ?? r.faceAmount ?? "",
      r.couponRate ?? "",
      r.percentOfFunds ?? "",
      r.marketValue ?? "",
      r.finalMaturityDate || "",
      r.isin || "",
      r.sedol || "",
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

export async function updateVanguardHoldings(tickers) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const ticker of tickers) {
    console.log(`\n=== Fetching ${ticker} ===`);
    const { portId, fundName } = await getPortId(ticker);
    console.log(`${ticker} -> portId ${portId} (${fundName})`);

    const { asOf, rows } = await getHoldings(portId);
    console.log(`${ticker}: ${rows.length} holdings as of ${asOf}`);

    const csv = toCsv(rows, asOf);
    const filename = path.join(DATA_DIR, `VanguardHoldings-${ticker}.csv`);
    fs.writeFileSync(filename, csv, "utf8");
    console.log(`Wrote ${filename}`);

    saveFundMeta(ticker, { fundName, portId });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tickers = process.argv.slice(2);
  updateVanguardHoldings(tickers.length ? tickers : ["VBIL"]).catch(err => {
    console.error("updateVanguardHoldings failed:", err);
    process.exitCode = 1;
  });
}

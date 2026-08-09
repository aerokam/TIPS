import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { upload } from "../../shared/upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

// PIMCO's fund-detail API is keyed by the fund's CUSIP, not the ticker, and
// there's no public ticker->CUSIP lookup endpoint — so the mapping is
// hardcoded here as funds are added.
const FUND_CUSIPS = { LTPZ: "72201R304" };

const FUND_NAMES = { LTPZ: "PIMCO 15+ Year US TIPS Index ETF" };

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0";

// Every fund-detail-api endpoint (not just topTenHoldings/export) requires
// asOfDate — confirmed from the product page's own JS bundle, which calls
// each of these with an asOfDate param unconditionally. 9999-12-31 returns
// the current/latest value, same trick as the holdings export.
const PIMCO_API_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  CountryCode: "US",
  UserRole: "IND",
  Client: "WEB",
  LangCode: "en",
  Origin: "https://www.pimco.com",
  Referer: "https://www.pimco.com/"
};

function fundDetailUrl(cusip, endpoint, asOfDate = "9999-12-31") {
  return `https://fund-ui.pimco.com/fund-detail-api/api/funds/${cusip}/${endpoint}?asOfDate=${asOfDate}`;
}

// The endpoint is named topTenHoldings but with asOfDate=9999-12-31 returns
// the full current holdings list, not just the top ten.
function holdingsUrl(cusip) {
  return fundDetailUrl(cusip, "topTenHoldings/export");
}

async function fetchWorkbook(cusip) {
  const res = await fetch(holdingsUrl(cusip), { headers: PIMCO_API_HEADERS });
  if (!res.ok) throw new Error(`Holdings export fetch failed for CUSIP ${cusip}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return XLSX.read(buf, { type: "array" });
}

// key-information carries the expense ratio (percent-scale already, e.g.
// 0.200 = 0.20%; not date-sensitive, so "latest" is fine). The product
// page's own "30-Day SEC Yield" figure binds to fund-stats'
// unsubsidized30SecYield with an explicit multiplyByOneHundred (confirmed
// by grepping PIMCO's Angular bundle for the label's data binding, at two
// separate places on the page that both use this exact field) — unlike
// every other PIMCO field used here, this one is a true fraction, not
// already percent-scale. key-statistics' similarly-named subsidizedSecYield
// is a different (month-end, not live-daily) figure and is NOT what the
// page displays under this label — do not use it here.
//
// Unlike expense ratio, fund-stats' "latest" (asOfDate=9999-12-31) does NOT
// match the page's displayed SEC yield — PIMCO's backend already has a
// business day's worth of unsubsidized30SecYield the page hasn't published
// yet (confirmed by direct testing: the page kept showing a stale value
// even after a hard refresh, i.e. a real backend lag, not caching). Since
// the SEC yield must be for the same date as the holdings themselves
// (already the as-of date shown in the app's banner), query fund-stats at
// that exact date rather than guessing an offset.
async function fetchExpenseRatioAndSecYield(cusip, holdingsAsOfDate) {
  const isoDate = toIsoDate(holdingsAsOfDate);
  const [keyInfoRes, fundStatsRes] = await Promise.all([
    fetch(fundDetailUrl(cusip, "key-information"), { headers: PIMCO_API_HEADERS }),
    fetch(fundDetailUrl(cusip, "fund-stats", isoDate || undefined), { headers: PIMCO_API_HEADERS })
  ]);
  if (!keyInfoRes.ok) throw new Error(`key-information fetch failed for CUSIP ${cusip}: HTTP ${keyInfoRes.status}`);
  if (!fundStatsRes.ok) throw new Error(`fund-stats fetch failed for CUSIP ${cusip} at ${isoDate}: HTTP ${fundStatsRes.status}`);

  const keyInfo = await keyInfoRes.json();
  const fundStats = await fundStatsRes.json();
  const expenseRatio = keyInfo.netExpenseRatio != null ? Number(keyInfo.netExpenseRatio) : null;
  const secYield = fundStats.unsubsidized30SecYield != null ? Number(fundStats.unsubsidized30SecYield) * 100 : null;
  return { expenseRatio, secYield };
}

const REQUIRED_COLS = ["CUSIP", "Description", "% of Net Assets"];
const OPTIONAL_COLS = ["Market Value (USD)", "Notional/Par Value Quantity/Units", "Maturity Date", "Coupon Rate"];

function extractRows(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const firstCell = rows[0]?.[0] ? String(rows[0][0]) : "";
  const asOfDate = firstCell.startsWith("AsOfDate: ") ? firstCell.replace("AsOfDate: ", "") : "";

  const headerIndex = rows.findIndex(r => Array.isArray(r) && REQUIRED_COLS.every(c => r.includes(c)));
  if (headerIndex < 0) throw new Error("Header row not found in PIMCO holdings export");

  const header = rows[headerIndex];
  const colIndex = Object.fromEntries([...REQUIRED_COLS, ...OPTIONAL_COLS].map(c => [c, header.indexOf(c)]));

  const body = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r) || r.length === 0) continue;
    // The export ends with a disclosure paragraph starting with this text.
    if (typeof r[0] === "string" && r[0].startsWith("Investors should consider")) break;
    body.push(r);
  }

  return { asOfDate, colIndex, body };
}

// PIMCO's export gives Maturity Date as an "MM/DD/YYYY" string.
function toIsoDate(mmddyyyy) {
  const m = String(mmddyyyy || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
}

// The Description embeds the coupon at full precision (e.g. "...1.375" for a
// 1 3/8% bond); the structured "Coupon Rate" column is rounded to 2 decimals
// (1.375 -> "1.38"), which is lossy for TIPS's eighth-of-a-percent coupons.
// Prefer the Description-derived value and fall back to Coupon Rate only if
// the Description doesn't end in a parseable number (e.g. cash/sweep lines).
const COUPON_SUFFIX_RE = /(\d+(?:\.\d+)?)\s*$/;
function extractCoupon(description, couponRateField) {
  const m = String(description || "").match(COUPON_SUFFIX_RE);
  if (m) return m[1];
  return couponRateField || "";
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

// PIMCO uses "—" as its N/A marker (also seen in Underlying CUSIP/Ticker);
// normalize it to blank like every other unavailable field (ISIN, SEDOL, ...).
function naToBlank(v) {
  return v === "—" ? "" : (v ?? "");
}

// PIMCO's numeric columns come back as formatted display text ("10.22%",
// "74,554,532.23") rather than plain numbers — strip the thousands commas
// and trailing "%" so downstream Number() parsing (index.html, enrichHoldings.js) works.
function parseNumber(v) {
  return naToBlank(v).replace(/,/g, "").replace(/%$/, "");
}

function toCsv(body, colIndex, asOfDate) {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of body) {
    const description = r[colIndex.Description] || "";
    const fields = [
      naToBlank(r[colIndex.CUSIP]),
      description,
      "",
      "",
      parseNumber(r[colIndex["Notional/Par Value Quantity/Units"]]),
      extractCoupon(description, r[colIndex["Coupon Rate"]]),
      parseNumber(r[colIndex["% of Net Assets"]]),
      parseNumber(r[colIndex["Market Value (USD)"]]),
      toIsoDate(r[colIndex["Maturity Date"]]),
      "",
      "",
      asOfDate
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

export async function updatePimcoHoldings(tickers) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const ticker of tickers) {
    const cusip = FUND_CUSIPS[ticker];
    if (!cusip) throw new Error(`Unknown PIMCO ticker ${ticker} — add it to FUND_CUSIPS`);

    console.log(`\n=== Fetching ${ticker} ===`);
    const workbook = await fetchWorkbook(cusip);
    const { asOfDate, colIndex, body } = extractRows(workbook);
    console.log(`${ticker}: ${body.length} holdings as of ${asOfDate}`);
    const { expenseRatio, secYield } = await fetchExpenseRatioAndSecYield(cusip, asOfDate);

    const csv = toCsv(body, colIndex, asOfDate);
    const filename = path.join(DATA_DIR, `Holdings-${ticker}.csv`);
    fs.writeFileSync(filename, csv, "utf8");
    await upload(filename, "FundHoldings");

    saveFundMeta(ticker, { fundName: FUND_NAMES[ticker] || "", cusip, expenseRatio, secYield });
  }

  await upload(FUND_META_PATH, "FundHoldings", "application/json");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tickers = process.argv.slice(2);
  updatePimcoHoldings(tickers.length ? tickers : ["LTPZ"]).catch(err => {
    console.error("updatePimcoHoldings failed:", err);
    process.exitCode = 1;
  });
}

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseCsv } from "../../shared/src/csv.js";
import { upload } from "../../shared/upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

// BlackRock's holdings export is keyed by the fund's numeric portfolioId, not
// the ticker, and there's no public ticker->portfolioId lookup endpoint — so
// the mapping is hardcoded here as funds are added (id is visible in the
// product page URL, e.g. .../products/347171/ishares-0-1-year-tips-bond-etf).
const FUND_PORTFOLIO_IDS = { ICPI: "347171" };

// Product page (separate from the holdings CSV export above), where expense
// ratio and SEC yield are rendered — no further hardcoded id needed since the
// full URL (including the fund's name-slug) is required to load it.
const FUND_PRODUCT_PAGES = { ICPI: "https://www.blackrock.com/us/individual/products/347171/ishares-0-1-year-tips-bond-etf" };

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/118.0.5993.117 Safari/537.36";

// asOfDate is accepted but not required — passing a stale/mismatched date
// returns an empty body, while omitting it entirely returns the latest
// holdings (confirmed by direct testing), which avoids needing to know the
// fund's current as-of date before making the request.
function holdingsUrl(portfolioId) {
  return "https://www.blackrock.com/varnish-api/blk-one01-product-data/product-data/api/v1/get-fund-document" +
    `?appType=PRODUCT_PAGE&appSubType=ISHARES&targetSite=us-ishares&locale=en_US&portfolioId=${portfolioId}&userType=individual&component=holdings`;
}

async function fetchHoldingsCsv(portfolioId) {
  const res = await fetch(holdingsUrl(portfolioId), { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Holdings export fetch failed for portfolioId ${portfolioId}: HTTP ${res.status}`);
  return res.text();
}

// Expense ratio and SEC yield are embedded in the product page's own
// schema.org JSON-LD block (a "KeyDataPointsV3" node in its @graph), as
// clean structured data rather than needing HTML-scraping — percent-scale
// numbers (e.g. "0.09"), matching the project's Coupon-field convention.
async function fetchExpenseRatioAndSecYield(ticker) {
  const url = FUND_PRODUCT_PAGES[ticker];
  if (!url) throw new Error(`Unknown iShares ticker ${ticker} — add it to FUND_PRODUCT_PAGES`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Product page fetch failed for ${ticker}: HTTP ${res.status}`);
  const html = await res.text();

  const ldMatch = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!ldMatch) throw new Error(`Could not find JSON-LD block on product page for ${ticker}`);
  const data = JSON.parse(ldMatch[1]);
  const keyDataPoints = (data["@graph"] || []).find(n => String(n["@id"] || "").endsWith("#key-datapoints"));
  const props = keyDataPoints?.additionalProperty || [];

  const er = props.find(p => p.name === "Expense Ratio:");
  const sec = props.find(p => p.name === "30 Day SEC Yield as of");
  return {
    expenseRatio: er ? Number(er.value) : null,
    secYield: sec ? Number(String(sec.value).replace("%", "")) : null
  };
}

const REQUIRED_COLS = ["Name", "CUSIP", "Market Value", "Weight (%)"];
const OPTIONAL_COLS = ["Par Value", "Coupon (%)", "Maturity", "ISIN", "SEDOL"];

// The export is a preamble (fund name, as-of date, inception date, ...) above
// the actual holdings table, not a plain header-first CSV — locate the real
// header row rather than assuming line 0.
function extractRows(text) {
  const rawRows = parseCsv(text, false);

  const fundName = rawRows[0]?.[0] || "";
  const asOfRow = rawRows.find(r => r[0] === "Fund Holdings as of");
  const asOf = asOfRow ? toIsoDate(asOfRow[1]) : "";

  const headerIndex = rawRows.findIndex(r => REQUIRED_COLS.every(c => r.includes(c)));
  if (headerIndex < 0) throw new Error("Header row not found in iShares holdings export");

  const header = rawRows[headerIndex];
  const colIndex = Object.fromEntries([...REQUIRED_COLS, ...OPTIONAL_COLS].map(c => [c, header.indexOf(c)]));

  const body = rawRows.slice(headerIndex + 1);
  return { fundName, asOf, colIndex, body };
}

const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

// BlackRock dates read "Aug 07, 2026" / "Apr 15, 2027"; cash/sweep rows (e.g.
// the BLACKROCK LIQ FUND sweep vehicle) report "-" for Maturity.
const DATE_RE = /^([A-Za-z]{3})\s+(\d{2}),\s+(\d{4})$/;
function toIsoDate(s) {
  const m = String(s || "").match(DATE_RE);
  if (!m) return "";
  const [, mon, dd, yyyy] = m;
  const mm = MONTHS[mon];
  return mm ? `${yyyy}-${mm}-${dd}` : "";
}

function parseNumber(v) {
  return (v ?? "").replace(/,/g, "");
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

function toCsv(body, colIndex, asOf) {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of body) {
    const fields = [
      r[colIndex.CUSIP] || "",
      r[colIndex.Name] || "",
      "",
      "",
      parseNumber(r[colIndex["Par Value"]]),
      r[colIndex["Coupon (%)"]] || "",
      parseNumber(r[colIndex["Weight (%)"]]),
      parseNumber(r[colIndex["Market Value"]]),
      toIsoDate(r[colIndex.Maturity]),
      r[colIndex.ISIN] || "",
      r[colIndex.SEDOL] || "",
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

export async function updateIsharesHoldings(tickers) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const ticker of tickers) {
    const portfolioId = FUND_PORTFOLIO_IDS[ticker];
    if (!portfolioId) throw new Error(`Unknown iShares ticker ${ticker} — add it to FUND_PORTFOLIO_IDS`);

    console.log(`\n=== Fetching ${ticker} ===`);
    const text = await fetchHoldingsCsv(portfolioId);
    const { fundName, asOf, colIndex, body } = extractRows(text);
    console.log(`${ticker}: ${body.length} holdings as of ${asOf}`);
    const { expenseRatio, secYield } = await fetchExpenseRatioAndSecYield(ticker);

    const csv = toCsv(body, colIndex, asOf);
    const filename = path.join(DATA_DIR, `Holdings-${ticker}.csv`);
    fs.writeFileSync(filename, csv, "utf8");
    await upload(filename, "FundHoldings");

    saveFundMeta(ticker, { fundName, portfolioId, expenseRatio, secYield });
  }

  await upload(FUND_META_PATH, "FundHoldings", "application/json");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tickers = process.argv.slice(2);
  updateIsharesHoldings(tickers.length ? tickers : ["ICPI"]).catch(err => {
    console.error("updateIsharesHoldings failed:", err);
    process.exitCode = 1;
  });
}

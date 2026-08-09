import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import { parseCsv } from "../../shared/src/csv.js";
import { upload } from "../../shared/upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

// Schwab's product pages (schwabassetmanagement.com) sit behind Akamai bot
// protection that 403s plain fetch/curl requests — confirmed necessary via
// direct testing, not assumed. A real (headless) browser is required both to
// load the product page and to download the holdings export linked from it.
const PRODUCT_PAGE_URL = "https://www.schwabassetmanagement.com/products/schp";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/118.0.5993.117 Safari/537.36";

const FUND_NAMES = { SCHP: "Schwab U.S. TIPS ETF" };

const FIDELITY_URL = "https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/FidelityTreasuriesTips.csv";

// Schwab's cash-sweep vehicle for SCHP is the same State Street "SSC
// GOVERNMENT MM GVMXX" fund PIMCO sweeps LTPZ's cash into — its file gives a
// Bloomberg FIGI (BBG000BQBCL7) instead of a CUSIP, but PIMCO's own export
// (which does report CUSIP directly) already told us the real one.
const GVMXX_NAME = "SSC GOVERNMENT MM GVMXX";
const GVMXX_CUSIP = "7839989D1";

// Both figures are rendered directly into the product page's key-stats
// table (no separate API call), as percent-scale numbers (e.g. "0.030%"),
// matching the project's Coupon-field convention. The page also repeats
// Total Expense Ratio in a simpler summary-band span earlier in the page;
// anchoring on the <th>...</th> table-row markup picks the detailed table
// row specifically, avoiding ambiguity (both report the same value anyway).
function parseExpenseRatioAndSecYield(html) {
  const erMatch = html.match(/Total Expense Ratio<\/span><\/strong>[\s\S]{0,20}?<\/th>[\s\S]{0,100}?<td>([\d.]+)%<\/td>/);
  const secMatch = html.match(/SEC Yield \(30 Day\)<\/span><\/strong>[\s\S]{0,300}?<td>([\d.]+)%<\/td>/);
  return {
    expenseRatio: erMatch ? Number(erMatch[1]) : null,
    secYield: secMatch ? Number(secMatch[1]) : null
  };
}

async function fetchHoldingsCsvText() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(PRODUCT_PAGE_URL, { waitUntil: "networkidle2", timeout: 60000 });

    const html = await page.content();
    // The holdings export filename is date-stamped (e.g. SCHP_FundHoldings_2026-07-31.CSV)
    // and changes each time holdings are refreshed, so it must be discovered
    // from the page rather than guessed.
    const hrefMatch = html.match(/href="([^"]*SCHP_FundHoldings_[^"]*\.CSV)"/i);
    if (!hrefMatch) throw new Error("Could not find SCHP_FundHoldings CSV link on product page");
    const csvUrl = new URL(hrefMatch[1], PRODUCT_PAGE_URL).href;

    // Navigating directly to the CSV URL gets treated as a file download and
    // aborts the Puppeteer navigation (net::ERR_ABORTED); fetching it from
    // within the already-loaded page carries the same session and works.
    const text = await page.evaluate(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    }, csvUrl);

    return { csvText: text, html };
  } finally {
    await browser.close();
  }
}

// The export ends with a blank line followed by quoted disclaimer paragraphs
// with no leading date, e.g. "Holdings may include collateral...". Keep only
// the header and rows that actually start with an ISO date.
function extractDataLines(csvText) {
  const lines = csvText.split(/\r?\n/);
  const header = lines[0];
  const dataLines = lines.slice(1).filter(l => /^\d{4}-\d{2}-\d{2},/.test(l));
  return [header, ...dataLines].join("\n");
}

function mmddyyyyToIso(mmddyyyy) {
  const m = String(mmddyyyy || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
}

async function loadFidelityTipsPriceMap() {
  const res = await fetch(FIDELITY_URL);
  if (!res.ok) throw new Error(`Failed to fetch ${FIDELITY_URL}: HTTP ${res.status}`);
  const rows = parseCsv(await res.text());
  const map = new Map();
  for (const r of rows) {
    if ((r.Product || "").toLowerCase() !== "tips") continue;
    const maturity = r["Maturity date"];
    const coupon = Number(r.Coupon);
    const adjustedAskPrice = Number(r["Adjusted ask price"]);
    const inflationFactor = Number(r["Inflation factor"]);
    if (!maturity || Number.isNaN(coupon) || !adjustedAskPrice || !inflationFactor) continue;
    // SCHP's Quantity is already inflation-adjusted (current) face value, not
    // original par (confirmed by cross-checking against the fund's own
    // abbreviated Market Value display) — so Market Value uses the raw price,
    // not the inflation-adjusted price, or the inflation factor would be
    // double-counted.
    const rawAskPrice = adjustedAskPrice / inflationFactor;
    map.set(`${maturity}|${coupon}`, { cusip: r.Cusip, rawAskPrice });
  }
  return map;
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

function buildRows(rawRows, priceMap) {
  const rows = [];
  for (const r of rawRows) {
    const name = r.Name || "";
    const quantity = Number(r.Quantity);
    const percentOfAssets = r["Percent of Assets"] || "";
    const asOf = r["As-Of-Date"] || "";

    if (name === GVMXX_NAME) {
      // Money-market sweep vehicle: NAV is ~$1/share, so Quantity is already
      // dollar-denominated — no price adjustment applies (and none is
      // available; it isn't a Treasury/TIPS security in the Fidelity source).
      rows.push({
        CUSIP: GVMXX_CUSIP,
        "Holding Name": name,
        Ticker: "",
        Category: "",
        Quantity: quantity,
        Coupon: "",
        "% of Fund": percentOfAssets,
        "Market Value": quantity,
        "Maturity Date": mmddyyyyToIso(r["Maturity Date"]),
        ISIN: "",
        SEDOL: "",
        "As of": asOf
      });
      continue;
    }

    const isoMaturity = mmddyyyyToIso(r["Maturity Date"]);
    const coupon = Number(r["Coupon Rate"]);
    const match = priceMap.get(`${isoMaturity}|${coupon}`);
    if (!match) {
      console.warn(`No Fidelity price match for ${name} maturing ${isoMaturity} @ ${coupon}% — CUSIP/Market Value left blank`);
    }

    rows.push({
      CUSIP: match?.cusip || "",
      "Holding Name": name,
      Ticker: "",
      Category: "",
      Quantity: quantity,
      Coupon: coupon,
      "% of Fund": percentOfAssets,
      "Market Value": match ? quantity * match.rawAskPrice / 100 : "",
      "Maturity Date": isoMaturity,
      ISIN: "",
      SEDOL: "",
      "As of": asOf
    });
  }
  return rows;
}

function toCsv(rows) {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(CSV_HEADERS.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","));
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

export async function updateSchwabHoldings(tickers) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const ticker of tickers) {
    if (ticker !== "SCHP") throw new Error(`Unknown Schwab ticker ${ticker}`);

    console.log(`\n=== Fetching ${ticker} ===`);
    const [{ csvText, html }, priceMap] = await Promise.all([fetchHoldingsCsvText(), loadFidelityTipsPriceMap()]);
    const rawRows = parseCsv(extractDataLines(csvText));
    const rows = buildRows(rawRows, priceMap);
    console.log(`${ticker}: ${rows.length} holdings`);
    const { expenseRatio, secYield } = parseExpenseRatioAndSecYield(html);

    const csv = toCsv(rows);
    const filename = path.join(DATA_DIR, `Holdings-${ticker}.csv`);
    fs.writeFileSync(filename, csv, "utf8");
    await upload(filename, "FundHoldings");

    saveFundMeta(ticker, { fundName: FUND_NAMES[ticker] || "", expenseRatio, secYield });
  }

  await upload(FUND_META_PATH, "FundHoldings", "application/json");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tickers = process.argv.slice(2);
  updateSchwabHoldings(tickers.length ? tickers : ["SCHP"]).catch(err => {
    console.error("updateSchwabHoldings failed:", err);
    process.exitCode = 1;
  });
}

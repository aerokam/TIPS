import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { calculateDuration, termYears } from "../shared/src/bond-math.js";
import { parseCsv } from "../shared/src/csv.js";
import { upload } from "../shared/upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

const YIELDS_SA_SAO_URL = "https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/YieldsSaSao.csv";
const FIDELITY_URL = "https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/FidelityTreasuriesTips.csv";

async function fetchCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

function parseDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

async function loadYieldSources() {
  const [tipsRows, fidRows] = await Promise.all([
    fetchCsv(YIELDS_SA_SAO_URL),
    fetchCsv(FIDELITY_URL)
  ]);

  const tipsByCusip = new Map(tipsRows.map(r => [r.cusip, r]));
  // FIDELITY_URL is a combined file (Treasury + TIPS rows); nominals are the non-TIPS rows.
  const nominalByCusip = new Map(
    fidRows.filter(r => (r.Product || "").toLowerCase() !== "tips").map(r => [r.Cusip, r])
  );
  return { tipsByCusip, nominalByCusip };
}

// CUSIP presence in the TIPS SA/SAO file is the source of truth for "is this a
// TIPS holding" — more reliable than the holding name text or a per-fund flag,
// and correctly handles a fund that mixes TIPS and nominal holdings.
function enrichRow(row, settle, { tipsByCusip, nominalByCusip }) {
  const cusip = row.CUSIP;

  // MKTLIQ (Vanguard) and SSC GOVERNMENT MM GVMXX (PIMCO and Schwab share the
  // same State Street sweep vehicle) are cash-sweep vehicles, not bonds — all
  // providers report a placeholder far-future maturity for them. Treat as
  // maturing tomorrow so Term reads as ~overnight instead of a meaningless
  // multi-year figure.
  const isCashSweep = row["Holding Name"] === "MKTLIQ" || row["Holding Name"] === "SSC GOVERNMENT MM GVMXX";
  const maturity = isCashSweep
    ? new Date(settle.getTime() + 86400000)
    : row["Maturity Date"] ? parseDate(row["Maturity Date"]) : null;

  const enriched = {
    ...row,
    // Blank out the bogus placeholder date rather than displaying/sorting on it.
    "Maturity Date": isCashSweep ? "" : row["Maturity Date"],
    "Ask Yield": "",
    "SA Yield": "",
    "SAO Yield": "",
    Term: "",
    Duration: ""
  };

  if (maturity && maturity > settle) {
    enriched.Term = termYears(settle, maturity);
  }

  const tips = cusip && tipsByCusip.get(cusip);
  const nominal = cusip && nominalByCusip.get(cusip);

  let askYield = null;
  let coupon = null;

  if (tips) {
    askYield = Number(tips.ask_yield);
    coupon = Number(tips.coupon);
    enriched["Ask Yield"] = askYield;
    enriched["SA Yield"] = Number(tips.sa_yield);
    enriched["SAO Yield"] = Number(tips.sao_yield);
  } else if (nominal) {
    askYield = Number(nominal["Ask yield to maturity"]) / 100;
    coupon = Number(nominal.Coupon) / 100;
    enriched["Ask Yield"] = askYield;
  }

  // Coupon (display, percent-scale, matching the raw fetchers' convention)
  // always comes from the matched S10/S7 row, overwriting whatever the
  // fund's own raw export reported: some providers round it in their export
  // (e.g. BlackRock/ICPI reports "0.13" for TIPS's actual 0.125% coupon).
  // `coupon` above is a true fraction in both branches, so *100 recovers the
  // display value uniformly.
  if (coupon != null) enriched.Coupon = coupon * 100;

  if (maturity && maturity > settle && askYield != null && coupon != null && !Number.isNaN(askYield)) {
    const duration = calculateDuration(settle, maturity, coupon, askYield);
    if (duration != null) enriched.Duration = duration;
  }

  return enriched;
}

export async function enrichHoldingsFile(ticker) {
  const filename = path.join(DATA_DIR, `Holdings-${ticker}.csv`);
  const rows = parseCsv(fs.readFileSync(filename, "utf8"));
  const sources = await loadYieldSources();
  const settle = new Date();
  settle.setHours(0, 0, 0, 0);

  const enriched = rows.map(r => enrichRow(r, settle, sources));

  const headers = Object.keys(enriched[0]);
  const lines = [headers.join(",")];
  for (const r of enriched) {
    lines.push(headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","));
  }

  const outFilename = path.join(DATA_DIR, `Holdings-${ticker}-Enriched.csv`);
  fs.writeFileSync(outFilename, lines.join("\n") + "\n", "utf8");
  await upload(outFilename, "FundHoldings");
  return enriched;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tickers = process.argv.slice(2);
  for (const ticker of tickers.length ? tickers : ["VBIL"]) {
    await enrichHoldingsFile(ticker);
  }
}

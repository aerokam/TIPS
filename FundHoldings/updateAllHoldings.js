// Load .env from repo root if present (local dev); does not override Task Scheduler env vars
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const _envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
if (existsSync(_envPath)) {
  readFileSync(_envPath, "utf8").split("\n").forEach(line => {
    const m = line.match(/^\s*([^#\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
}

import { updateVanguardHoldings } from "./vanguard/updateVanguardHoldings.js";
import { updateFminvestHoldings } from "./fminvest/updateFminvestHoldings.js";
import { updatePimcoHoldings } from "./pimco/updateLtpzHoldings.js";
import { updateSchwabHoldings } from "./schwab/updateSchpHoldings.js";
import { updateBondbloxxHoldings } from "./bondbloxx/updateXhlfHoldings.js";
import { updateIsharesHoldings } from "./ishares/updateIcpiHoldings.js";
import { enrichHoldingsFile } from "./enrichHoldings.js";

const VANGUARD_TICKERS = ["VBIL", "VTIP", "VTP"];
const FMINVEST_TICKERS = ["RBIL"];
const PIMCO_TICKERS = ["LTPZ"];
const SCHWAB_TICKERS = ["SCHP"];
const BONDBLOXX_TICKERS = ["XHLF"];
const ISHARES_TICKERS = ["ICPI"];
const ALL_TICKERS = [...VANGUARD_TICKERS, ...FMINVEST_TICKERS, ...PIMCO_TICKERS, ...SCHWAB_TICKERS, ...BONDBLOXX_TICKERS, ...ISHARES_TICKERS];

// Each provider's fetch is isolated: one provider breaking (e.g. a site
// markup change) must not block enrichment/upload for the others, since
// their raw holdings CSVs may have fetched successfully.
const FETCHERS = [
  ["Vanguard", () => updateVanguardHoldings(VANGUARD_TICKERS)],
  ["fminvest", () => updateFminvestHoldings(FMINVEST_TICKERS)],
  ["PIMCO", () => updatePimcoHoldings(PIMCO_TICKERS)],
  ["Schwab", () => updateSchwabHoldings(SCHWAB_TICKERS)],
  ["BondBloxx", () => updateBondbloxxHoldings(BONDBLOXX_TICKERS)],
  ["iShares", () => updateIsharesHoldings(ISHARES_TICKERS)]
];

async function main() {
  const failures = [];
  for (const [name, fetchFn] of FETCHERS) {
    try {
      await fetchFn();
    } catch (err) {
      console.error(`${name} fetch failed:`, err);
      failures.push(name);
    }
  }

  for (const ticker of ALL_TICKERS) {
    await enrichHoldingsFile(ticker);
  }

  if (failures.length) throw new Error(`Fetch failed for: ${failures.join(", ")} (holdings for other funds still enriched/uploaded)`);
}

main().catch(err => {
  console.error("updateAllHoldings failed:", err);
  process.exitCode = 1;
});

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
import { enrichHoldingsFile } from "./enrichHoldings.js";

const VANGUARD_TICKERS = ["VBIL", "VTIP", "VTP"];
const FMINVEST_TICKERS = ["RBIL"];
const ALL_TICKERS = [...VANGUARD_TICKERS, ...FMINVEST_TICKERS];

async function main() {
  await updateVanguardHoldings(VANGUARD_TICKERS);
  await updateFminvestHoldings(FMINVEST_TICKERS);

  for (const ticker of ALL_TICKERS) {
    await enrichHoldingsFile(ticker);
  }
}

main().catch(err => {
  console.error("updateAllHoldings failed:", err);
  process.exitCode = 1;
});

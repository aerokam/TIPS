// Serves the tests/e2e/*.csv fixtures to the app's own data loader.
//
// Tests must not re-implement the market-data load: which source is live is decided inside
// shared/src/market-data.js's loadMarketData() (3.1 §4.0 Yield Sources), and a test that parses a CSV itself has to
// pick a source, which is the one thing it cannot get right by construction. Installing this shim
// and calling loadMarketData() gives a test exactly the rows, dates, and source the app gets.
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'e2e');

// The Fidelity download date drives the settlement date, so it is rewritten to today: fixtures
// carry a fixed historical footer, and tests assert against a settlement date derived from now
// (so excluded-bond behavior matches reality). Same rewrite the E2E suite performs.
export function fidelityWithTodayDownloadDate(raw) {
  const now = new Date();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const dy = String(now.getDate()).padStart(2, '0');
  return raw.replace(/Date downloaded.*$/m, `Date downloaded   ${mo}/${dy}/${now.getFullYear()} 12:00 PM`);
}

// FedInvest's fixture carries its own settlement date on line 1; keep it in step with today too,
// so the dormant cross-check path behaves the same way when it is switched on.
export function fedInvestWithTodaySettlement(raw, settleDateStr) {
  const lines = raw.split('\n');
  lines[0] = settleDateStr;
  return lines.join('\n');
}

// Replaces global fetch with a reader over the fixture directory, matched on the URL's basename.
export function installFixtureFetch({ settleDateStr } = {}) {
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop().split('?')[0];
    let body;
    try { body = readFileSync(path.join(FIXTURES, name), 'utf8'); }
    catch {
      return { ok: false, status: 404, async text() { return ''; } };
    }
    if (name === 'FidelityTreasuriesTips.csv') body = fidelityWithTodayDownloadDate(body);
    if (name === 'YieldsFromFedInvestPrices.csv' && settleDateStr) {
      body = fedInvestWithTodaySettlement(body, settleDateStr);
    }
    return { ok: true, status: 200, async text() { return body; } };
  };
}

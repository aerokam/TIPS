// fidelity-parse.js -- shared parser for Fidelity's combined Treasury+TIPS CSV export
// (R2 key Treasuries/FidelityTreasuriesTips.csv). Pure, source-format-only helpers;
// business logic (which fields to trust, gating against FedInvest CUSIPs, yield
// recomputation) stays in each consuming app.
import { parseCsv } from './csv.js';

// Strips Excel `="..."` literal-string wrapping Fidelity applies to some fields.
export function cleanFidelityField(val) {
  return (val || '').replace(/^=?["']*/, '').replace(/["']*$/, '').trim();
}

// Extract price from "price/qty(min)" (new format) or plain "price" (old format).
export function fidPriceField(raw) {
  return (raw || '').split('/')[0].replace(/,/g, '').trim();
}

// Parse maturity from YYYY-MM-DD (new format) or MM/DD/YYYY (old format) -> ISO string.
export function fidParseMaturity(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [mo, dy, yr] = (s || '').split('/');
  return yr ? `${yr}-${mo.padStart(2, '0')}-${dy.padStart(2, '0')}` : null;
}

// Footer line "Date downloaded MM/DD/YYYY HH:MM AM/PM" -> that string, or null.
export function parseFidelityDownloadDate(text) {
  const m = text.match(/Date downloaded\s+([\d/]+ [\d:]+ [AP]M)/i);
  return m ? m[1] : null;
}

// "MM/DD/YYYY HH:MM AM/PM" (the download-date footer) -> "YYYY-MM-DD" (date part only), or null.
export function fidelityDownloadDateIso(dateStr) {
  const [mo, dy, yr] = (dateStr || '').split(' ')[0].split('/').map(Number);
  if (!yr) return null;
  return `${yr}-${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')}`;
}

// Parses TIPS rows (Product === 'TIPS') from the combined Fidelity CSV. One row per CUSIP
// (first occurrence wins on duplicates). Yield fields are Fidelity's own quoted values,
// decimal form (e.g. -0.02 = -2%) -- callers decide whether to trust them directly or
// recompute from price via shared/src/bond-math.js's yieldFromPrice.
// Returns: [{ cusip, coupon, maturity (ISO or null), askPrice, bidPrice, adjAskPrice,
//   adjBidPrice, inflationFactor, askYield, bidYield }]
export function parseFidelityTipsRows(text) {
  const rows = parseCsv(text);
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const n = {};
    for (const k in row) n[k.toLowerCase().trim()] = row[k];
    if ((n['product'] || '').toLowerCase() !== 'tips') continue;
    const cusip = cleanFidelityField(n['cusip'] || n['cusip|state']);
    if (!cusip || seen.has(cusip)) continue;
    seen.add(cusip);
    out.push({
      cusip,
      coupon: parseFloat(cleanFidelityField(n['coupon'])) / 100 || 0,
      maturity: fidParseMaturity(cleanFidelityField(n['maturity date'])),
      askPrice: parseFloat(fidPriceField(n['price ask'] || n['ask price/quantity (min)'] || '')),
      bidPrice: parseFloat(fidPriceField(n['price bid'] || n['bid price/quantity (min)'] || '')),
      adjAskPrice: parseFloat(cleanFidelityField(n['adjusted price ask'] || n['adjusted ask price'] || '').replace(/,/g, '')),
      adjBidPrice: parseFloat(cleanFidelityField(n['adjusted price bid'] || n['adjusted bid price'] || '').replace(/,/g, '')),
      inflationFactor: parseFloat(cleanFidelityField(n['inflation factor'] || '')),
      askYield: parseFloat(cleanFidelityField(n['ask yield to maturity'] || '')) / 100,
      bidYield: parseFloat(cleanFidelityField(n['yield bid'] || n['yield'] || '')) / 100,
    });
  }
  return out;
}

// updateSpotYieldCurves.js — persists the values the YieldCurves app computes but never
// writes to R2: the fitted zero-coupon (spot) curves, per-TIPS breakeven inflation, and
// broker bid/ask spreads. See YieldCurves/knowledge/4.0_Spot_Yield_Curves.md.
//
// Loads the same R2 inputs the browser app loads (YieldsFromFedInvestPrices.csv,
// RefCpiNsaSa.csv, BondHolidaysSifma.csv, FidelityTreasuriesTips.csv) and reuses the same
// fitting math the app uses — shared/src/spot-curve.js — rather than a second copy
// (Single Source of Truth, projects/CLAUDE.md §2a).
//
// Writes three files under Treasuries/ (spot curves cover nominals AND TIPS, so they are
// not TIPS-specific — see knowledge/DataStores.md):
//   Treasuries/SpotYieldCurves.json   — fitted Svensson params, one row per (curve, source)
//   Treasuries/BreakevenInflation.csv — per-TIPS Ask/SA/SAO breakeven vs. nearest nominal
//   Treasuries/BidAskSpreads.csv      — per-security broker bid/ask yield & price spread
//
// Run: node YieldCurves/scripts/updateSpotYieldCurves.js  [--dry]

import { uploadToR2 } from './r2.js';
import { yieldFromPrice } from '../../shared/src/bond-math.js';
import { saFactorForDate } from '../../shared/src/ref-cpi.js';
import { parseCsv } from '../../shared/src/csv.js';
import { localDate, toIsoDate, nextBusinessDay, parseHolidaySet } from '../../shared/src/settlement.js';
import { classifyByCusipRoot, isStrip } from '../../shared/src/treasury-cusip.js';
import {
  cleanFidelityField as clean, fidPriceField, fidParseMaturity,
  parseFidelityDownloadDate, fidelityDownloadDateIso, parseFidelityTipsRows,
} from '../../shared/src/fidelity-parse.js';
import { spotCurveFit, calculateSAO } from '../../shared/src/spot-curve.js';

const R2_BASE_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const YIELDS_CSV_URL = `${R2_BASE_URL}/Treasuries/YieldsFromFedInvestPrices.csv`;
const REF_CPI_CSV_URL = `${R2_BASE_URL}/TIPS/RefCpiNsaSa.csv`;
const HOLIDAYS_CSV_URL = `${R2_BASE_URL}/misc/BondHolidaysSifma.csv`;
const FIDELITY_URL = `${R2_BASE_URL}/Treasuries/FidelityTreasuriesTips.csv`;

const DRY = process.argv.includes('--dry');

// ─── Fidelity Treasury (nominal) row parsing — glue specific to this pipeline, same
// shape as src/app.js's parseFidelityNominals but without the DOM/module-state ties.
// Business logic (which fields to trust, gating against FedInvest CUSIPs) intentionally
// stays here rather than in the shared fidelity-parse.js primitives — see that module's
// own header comment.
function parseFidelityNominalRows(text, tipsCusips) {
  const rows = parseCsv(text);
  const bonds = [];
  const seen = new Set();
  for (const row of rows) {
    const n = {};
    for (const k in row) n[k.toLowerCase().trim()] = row[k];

    if ((n['product'] || '').toLowerCase() === 'tips') continue;

    const cusip = clean(n['cusip'] || n['cusip|state']);
    const desc = (n['description'] || '').toUpperCase();
    if (!cusip || seen.has(cusip)) continue;
    if (tipsCusips.has(cusip) || /\bTIPS\b/.test(desc)) continue;
    if (!classifyByCusipRoot(cusip)) continue;

    const matStr = clean(n['maturity date']);
    const maturity = fidParseMaturity(matStr);
    if (!maturity) continue;
    const maturityDate = localDate(maturity);

    const yld = parseFloat(clean(n['ask yield to maturity'])) / 100;
    if (!maturityDate || isNaN(yld)) continue;

    seen.add(cusip);
    bonds.push({
      cusip,
      coupon: parseFloat(clean(n['coupon'])) / 100 || 0,
      price: parseFloat(fidPriceField(n['price ask'] || n['ask price/quantity (min)'])) || NaN,
      yield: yld,
      bidPrice: parseFloat(fidPriceField(n['price bid'] || n['bid price/quantity (min)'])),
      bidYield: parseFloat(clean(n['yield bid'] || n['yield'])) / 100,
      maturity, maturityDate,
    });
  }
  return bonds;
}

// ─── TIPS row processing — mirrors src/app.js's buildProcessedTipsBonds.
function buildProcessedTipsBonds(rawTipsData, refCpiData, priceMap, isBroker, brokerSettleStr) {
  return rawTipsData.map(bond => {
    const coupon = parseFloat(bond.coupon);
    let price = parseFloat(bond.price);
    let settleDateStr = bond.settlementDate;
    let quote = null;

    if (isBroker) {
      if (!priceMap.has(bond.cusip)) return null;
      quote = priceMap.get(bond.cusip);
      if (isNaN(quote.askPrice)) return null;
      price = quote.askPrice;
      settleDateStr = brokerSettleStr;
    }

    const saSettle = saFactorForDate(refCpiData, settleDateStr);
    const saMature = saFactorForDate(refCpiData, bond.maturity);
    if (saSettle == null || isNaN(saSettle) || saMature == null || isNaN(saMature)) return null;

    const settleDate = localDate(settleDateStr);
    const matureDate = localDate(bond.maturity);
    const saRatio = saSettle / saMature;
    const askYield = yieldFromPrice(price, coupon, settleDate, matureDate);
    const saYield = yieldFromPrice(price * saRatio, coupon, settleDate, matureDate);
    if (askYield == null || isNaN(askYield) || saYield == null || isNaN(saYield)) return null;

    let bidPrice = NaN, bidYield = NaN, adjAskPrice = NaN, adjBidPrice = NaN;
    let inflationFactor = NaN, yieldSpreadBps = NaN, priceSpreadPct = NaN;
    if (isBroker && quote) {
      bidPrice = quote.bidPrice;
      adjAskPrice = quote.adjAskPrice;
      adjBidPrice = quote.adjBidPrice;
      inflationFactor = quote.inflationFactor;
      bidYield = yieldFromPrice(bidPrice, coupon, settleDate, matureDate);
      if (!isNaN(bidYield) && !isNaN(askYield)) yieldSpreadBps = (bidYield - askYield) * 10000;
      if (!isNaN(adjAskPrice) && !isNaN(adjBidPrice) && adjAskPrice > 0)
        priceSpreadPct = (adjAskPrice - adjBidPrice) / adjAskPrice * 100;
    }

    return {
      ...bond, coupon, price, saRatio, askYield, saYield, bidPrice, bidYield,
      adjAskPrice, adjBidPrice, inflationFactor, yieldSpreadBps, priceSpreadPct,
      maturityDate: matureDate, settlementDate: settleDateStr, isBroker,
    };
  }).filter(Boolean).sort((a, b) => a.maturityDate - b.maturityDate);
}

function findClosestNominal(nominals, maturityDate) {
  let best = null, bestDiff = Infinity;
  for (const n of nominals) {
    const diff = Math.abs(n.maturityDate.getTime() - maturityDate.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = n; }
  }
  return best;
}

// spotCurveFit's z(t) carries the fitted Svensson params on ._params ({ l1, l2, beta, ssr })
// — pull them out into the flat row this store publishes.
function curveRow(curve, source, fit, settlementDate, asOf) {
  if (!fit) { console.warn(`  (skipped ${curve}/${source}: fit did not converge)`); return null; }
  const p = fit.z._params;
  return {
    curve, source, settlementDate, asOf,
    beta0: +p.beta[0].toFixed(6), beta1: +p.beta[1].toFixed(6),
    beta2: +p.beta[2].toFixed(6), beta3: +p.beta[3].toFixed(6),
    tau1: +p.l1.toFixed(6), tau2: +p.l2.toFixed(6),
    tMin: +fit.tMin.toFixed(3), tMax: +fit.tMax.toFixed(3),
  };
}

async function main() {
  console.log(`Starting Spot Yield Curves update at ${new Date().toISOString()}`);

  const [yieldsText, refCpiText, holidayText, fidRes] = await Promise.all([
    fetch(YIELDS_CSV_URL, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`Yields fetch failed: ${r.status}`); return r.text(); }),
    fetch(REF_CPI_CSV_URL, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`RefCPI fetch failed: ${r.status}`); return r.text(); }),
    fetch(HOLIDAYS_CSV_URL, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`Holidays fetch failed: ${r.status}`); return r.text(); }),
    fetch(FIDELITY_URL, { cache: 'no-cache' }),
  ]);
  if (!fidRes.ok) throw new Error(`Fidelity fetch failed: ${fidRes.status}`);
  const fidText = await fidRes.text();

  // YieldsFromFedInvestPrices.csv: row 1 = settlement date, row 2 = header, rows 3+ = data.
  const yieldsLines = yieldsText.split(/\r?\n/).filter(l => l.trim());
  const fedSettleStr = yieldsLines[0].trim();
  const allYieldsRows = parseCsv(yieldsLines.slice(1).join('\n')).map(r => ({ ...r, settlementDate: fedSettleStr }));
  const rawTipsData = allYieldsRows.filter(r => r.type === 'TIPS');
  const rawNominalsData = allYieldsRows.filter(r => r.type !== 'TIPS');
  const refCpiData = parseCsv(refCpiText);
  const holidaySet = parseHolidaySet(parseCsv(holidayText, false));
  console.log(`FedInvest settlement ${fedSettleStr}: ${rawTipsData.length} TIPS, ${rawNominalsData.length} nominal rows.`);

  // Market (Fidelity) settlement — trade date in the file + T+1, same as the app's marketSettleIso().
  const downloadDateStr = parseFidelityDownloadDate(fidText);
  if (!downloadDateStr) throw new Error('Fidelity file has no "Date downloaded" footer.');
  const downloadIso = fidelityDownloadDateIso(downloadDateStr);
  const brokerSettleStr = toIsoDate(nextBusinessDay(localDate(downloadIso), holidaySet));
  console.log(`Market settlement (T+1): ${brokerSettleStr}`);

  const tipsCusips = new Set(rawTipsData.map(r => r.cusip));
  const priceMap = new Map();
  for (const r of parseFidelityTipsRows(fidText)) {
    if (isNaN(r.askPrice) || !tipsCusips.has(r.cusip)) continue;
    priceMap.set(r.cusip, r);
  }
  const fidNominalBonds = parseFidelityNominalRows(fidText, tipsCusips).filter(b => !isStrip(b.cusip));
  console.log(`Market: ${priceMap.size} TIPS quotes, ${fidNominalBonds.length} nominal quotes.`);

  // ── Processed bonds, per source ──────────────────────────────────────────────
  const fedTipsBonds = buildProcessedTipsBonds(rawTipsData, refCpiData, priceMap, false, fedSettleStr);
  const mktTipsBonds = buildProcessedTipsBonds(rawTipsData, refCpiData, priceMap, true, brokerSettleStr);
  if (fedTipsBonds.length) { const s = calculateSAO(fedTipsBonds); fedTipsBonds.forEach((b, i) => b.saoYield = s[i]); }
  if (mktTipsBonds.length) { const s = calculateSAO(mktTipsBonds); mktTipsBonds.forEach((b, i) => b.saoYield = s[i]); }

  const fedNominalBonds = rawNominalsData.filter(r => !isStrip(r.cusip)).map(r => {
    const coupon = parseFloat(r.coupon), price = parseFloat(r.price);
    const maturityDate = localDate(r.maturity);
    const yld = yieldFromPrice(price, coupon, localDate(r.settlementDate), maturityDate);
    if (yld == null || isNaN(yld)) return null;
    return { ...r, coupon, price, yield: yld, maturityDate };
  }).filter(Boolean);
  const mktNominalBonds = fidNominalBonds.map(b => ({ ...b, settlementDate: brokerSettleStr }));

  // ── Spot curves: nominal fit uses minT 0.25y (Bills anchor the short end), TIPS fits use
  // the shared default (SAO_NOISE_YRS = 0.5y) — same as src/app.js's chart calls. ─────────
  const asOf = new Date().toISOString();
  const curves = [
    curveRow('nominal', 'FedInvest', spotCurveFit(fedNominalBonds, { priceOf: b => b.price, yieldOf: b => b.yield, minT: 0.25 }), fedSettleStr, asOf),
    curveRow('nominal', 'Market', spotCurveFit(mktNominalBonds, { priceOf: b => b.price, yieldOf: b => b.yield, minT: 0.25 }), brokerSettleStr, asOf),
    curveRow('tips_ask', 'FedInvest', spotCurveFit(fedTipsBonds, { priceOf: b => b.price, yieldOf: b => b.askYield }), fedSettleStr, asOf),
    curveRow('tips_ask', 'Market', spotCurveFit(mktTipsBonds, { priceOf: b => b.price, yieldOf: b => b.askYield }), brokerSettleStr, asOf),
    curveRow('tips_sa', 'FedInvest', spotCurveFit(fedTipsBonds, { priceOf: b => b.price * b.saRatio, yieldOf: b => b.saYield }), fedSettleStr, asOf),
    curveRow('tips_sa', 'Market', spotCurveFit(mktTipsBonds, { priceOf: b => b.price * b.saRatio, yieldOf: b => b.saYield }), brokerSettleStr, asOf),
  ].filter(Boolean);
  console.log(`Fitted ${curves.length}/6 spot curves.`);

  // ── Breakeven inflation (Market only — BEI needs both legs quoted the same way; see
  // src/app.js processAndRenderBei). Per-TIPS Ask/SA/SAO BEI vs. the nearest-maturity
  // nominal (spot BEI itself is not persisted — it is fully re-derivable from the
  // nominal/Market and tips_sa/Market rows above, so storing it separately would be
  // redundant duplication rather than verifying redundancy). ─────────────────────
  const beiRows = [];
  for (const b of mktTipsBonds) {
    const nom = findClosestNominal(mktNominalBonds, b.maturityDate);
    if (!nom) continue;
    beiRows.push({
      cusip: b.cusip, maturity: b.maturity, coupon: b.coupon,
      ask_yield: b.askYield, sa_yield: b.saYield, sao_yield: b.saoYield,
      nominal_cusip: nom.cusip, nominal_maturity: nom.maturity, nominal_yield: nom.yield,
      ask_bei: nom.yield - b.askYield, sa_bei: nom.yield - b.saYield, sao_bei: nom.yield - b.saoYield,
    });
  }
  console.log(`Computed breakeven inflation for ${beiRows.length} TIPS.`);

  // ── Bid/ask spreads (Market only — FedInvest has no two-sided quote). TIPS and nominal
  // Treasuries combined, one row per security, discriminated by security_type like S7. ──
  const spreadRows = [];
  for (const b of mktTipsBonds) {
    spreadRows.push({
      security_type: 'TIPS', cusip: b.cusip, maturity: b.maturity, coupon: b.coupon,
      ask_yield: b.askYield, bid_yield: b.bidYield, yield_spread_bps: b.yieldSpreadBps,
      ask_price: b.price, bid_price: b.bidPrice, price_spread_pct: b.priceSpreadPct,
    });
  }
  for (const b of mktNominalBonds) {
    const yieldSpreadBps = (!isNaN(b.bidYield) && !isNaN(b.yield)) ? (b.bidYield - b.yield) * 10000 : NaN;
    const priceSpreadPct = (!isNaN(b.bidPrice) && !isNaN(b.price) && b.price > 0) ? (b.price - b.bidPrice) / b.price * 100 : NaN;
    spreadRows.push({
      security_type: 'Treasury', cusip: b.cusip, maturity: b.maturity, coupon: b.coupon,
      ask_yield: b.yield, bid_yield: b.bidYield, yield_spread_bps: yieldSpreadBps,
      ask_price: b.price, bid_price: b.bidPrice, price_spread_pct: priceSpreadPct,
    });
  }
  console.log(`Computed bid/ask spreads for ${spreadRows.length} securities.`);

  // ── Write files ──────────────────────────────────────────────────────────────
  const curvesJson = JSON.stringify(curves, null, 2) + '\n';

  const beiHeader = 'cusip,maturity,coupon,ask_yield,sa_yield,sao_yield,nominal_cusip,nominal_maturity,nominal_yield,ask_bei,sa_bei,sao_bei';
  const beiLines = beiRows.map(r => [
    r.cusip, r.maturity, r.coupon.toFixed(7), r.ask_yield.toFixed(7), r.sa_yield.toFixed(7), r.sao_yield.toFixed(7),
    r.nominal_cusip, r.nominal_maturity, r.nominal_yield.toFixed(7),
    r.ask_bei.toFixed(7), r.sa_bei.toFixed(7), r.sao_bei.toFixed(7),
  ].join(','));
  const beiCsv = [beiHeader, ...beiLines].join('\n') + '\n';

  const fmtNum = v => (v == null || isNaN(v)) ? '' : v.toFixed(v > 10 || v < -10 ? 4 : 7);
  const spreadHeader = 'security_type,cusip,maturity,coupon,ask_yield,bid_yield,yield_spread_bps,ask_price,bid_price,price_spread_pct';
  const spreadLines = spreadRows.map(r => [
    r.security_type, r.cusip, r.maturity, r.coupon.toFixed(7),
    fmtNum(r.ask_yield), fmtNum(r.bid_yield), fmtNum(r.yield_spread_bps),
    fmtNum(r.ask_price), fmtNum(r.bid_price), fmtNum(r.price_spread_pct),
  ].join(','));
  const spreadCsv = [spreadHeader, ...spreadLines].join('\n') + '\n';

  if (DRY) {
    console.log('--dry: not uploading. Sample output:');
    console.log(curvesJson.slice(0, 800));
    console.log(beiCsv.split('\n').slice(0, 4).join('\n'));
    console.log(spreadCsv.split('\n').slice(0, 4).join('\n'));
    return;
  }

  await uploadToR2('Treasuries/SpotYieldCurves.json', curvesJson, 'application/json');
  await uploadToR2('Treasuries/BreakevenInflation.csv', beiCsv);
  await uploadToR2('Treasuries/BidAskSpreads.csv', spreadCsv);
  console.log('Update complete.');
}

main().catch(err => {
  console.error('Error in Spot Yield Curves update:', err);
  process.exit(1);
});

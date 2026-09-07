// updateSpotYieldCurves.js — persists the values the YieldCurves app computes but never
// writes to R2: evaluated spot (zero-coupon) yields, per-TIPS breakeven inflation, and
// broker bid/ask spreads. See YieldCurves/knowledge/4.0_Spot_Yield_Curves.md.
//
// Loads the same R2 inputs the browser app loads (YieldsFromFedInvestPrices.csv,
// RefCpiNsaSa.csv, BondHolidaysSifma.csv, FidelityTreasuriesTips.csv) and reuses the same
// fitting math the app uses — shared/src/spot-curve.js — rather than a second copy
// (Single Source of Truth, projects/CLAUDE.md §2a).
//
// Writes three files under Treasuries/ (spot curves cover nominals AND TIPS, so they are
// not TIPS-specific — see knowledge/DataStores.md):
//   Treasuries/SpotYieldCurves.csv    — per-security ask/SA/SAO yields plus evaluated
//                                        nominal/TIPS-SA spot yields and spot BEI on a
//                                        term grid — one spreadsheet-ready file, not
//                                        Svensson parameters (see S13)
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
import { spotCurveFit, calculateSAO, zToSA } from '../../shared/src/spot-curve.js';

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

// Years from settlement to maturity (decimal), for the term_years column.
function termYears(maturityStr, settlementStr) {
  const settle = localDate(settlementStr);
  const mature = localDate(maturityStr);
  return (mature.getTime() - settle.getTime()) / (365.25 * 86400000);
}

const GRID_STEP_YRS = 0.5; // half-year grid — matches the chart's own spotCurveGrid convention

// Evaluated nominal + TIPS-SA spot yields (and spot BEI = nominal − TIPS SA, per
// 4.0_Spot_Yield_Curves.md §Spot BEI) on a half-year term grid, clipped to the range where
// BOTH fits are valid so BEI is always defined at every grid row. Uses the fit objects'
// own z(t)/sane() — no refitting, just evaluating the shared module's already-fitted curve.
function buildGridRows(fits, source) {
  const { nominal: nomFit, tips_sa: saFit } = fits;
  if (!nomFit || !saFit) { console.warn(`  (skipped ${source} grid: nominal or tips_sa fit missing)`); return []; }
  const tMin = Math.max(nomFit.tMin, saFit.tMin);
  const tMax = Math.min(nomFit.tMax, saFit.tMax);
  const rows = [];
  for (let t = Math.ceil(tMin / GRID_STEP_YRS) * GRID_STEP_YRS; t <= tMax + 1e-9; t += GRID_STEP_YRS) {
    const nomPct = zToSA(nomFit.z(t)), saPct = zToSA(saFit.z(t));
    if (!nomFit.sane(nomPct) || !saFit.sane(saPct)) continue; // blown-up fit at this horizon — skip
    const spotYield = nomPct / 100, spotSaYield = saPct / 100;
    rows.push({
      term_years: t, maturity_date: '', cusip: '', security_type: '', source,
      ask_yield: '', sa_yield: '', sao_yield: '',
      spot_yield: spotYield, spot_sa_yield: spotSaYield, bei: spotYield - spotSaYield,
    });
  }
  return rows;
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

  // ── Spot curves: nominal fit uses minT 0.25y (Bills anchor the short end), TIPS SA fit
  // uses the shared default (SAO_NOISE_YRS = 0.5y) — same as src/app.js's chart calls. Only
  // nominal and TIPS-SA are fit here: the quoted (non-SA) TIPS spot curve isn't part of the
  // evaluated-CSV schema (see knowledge/DataStores.md#s13) — the app still fits it live for
  // its own chart, independent of this pipeline. ──────────────────────────────────────
  const fits = {
    FedInvest: {
      nominal: spotCurveFit(fedNominalBonds, { priceOf: b => b.price, yieldOf: b => b.yield, minT: 0.25 }),
      tips_sa: spotCurveFit(fedTipsBonds, { priceOf: b => b.price * b.saRatio, yieldOf: b => b.saYield }),
    },
    Market: {
      nominal: spotCurveFit(mktNominalBonds, { priceOf: b => b.price, yieldOf: b => b.yield, minT: 0.25 }),
      tips_sa: spotCurveFit(mktTipsBonds, { priceOf: b => b.price * b.saRatio, yieldOf: b => b.saYield }),
    },
  };
  console.log(`Fitted spot curves — FedInvest: nominal=${!!fits.FedInvest.nominal} tips_sa=${!!fits.FedInvest.tips_sa}; `
    + `Market: nominal=${!!fits.Market.nominal} tips_sa=${!!fits.Market.tips_sa}`);

  // ── SpotYieldCurves.csv rows: one row per actual security (ask/SA/SAO populated where
  // they exist) plus one row per fitted grid point (spot_yield/spot_sa_yield/bei populated).
  // See knowledge/DataStores.md#s13 for the column list and rationale. ──────────────────
  const evalRows = [];
  for (const b of fedNominalBonds) evalRows.push({
    term_years: termYears(b.maturity, fedSettleStr), maturity_date: b.maturity, cusip: b.cusip,
    security_type: classifyByCusipRoot(b.cusip) || '', source: 'FedInvest',
    ask_yield: b.yield, sa_yield: '', sao_yield: '', spot_yield: '', spot_sa_yield: '', bei: '',
  });
  for (const b of mktNominalBonds) evalRows.push({
    term_years: termYears(b.maturity, brokerSettleStr), maturity_date: b.maturity, cusip: b.cusip,
    security_type: classifyByCusipRoot(b.cusip) || '', source: 'Market',
    ask_yield: b.yield, sa_yield: '', sao_yield: '', spot_yield: '', spot_sa_yield: '', bei: '',
  });
  for (const b of fedTipsBonds) evalRows.push({
    term_years: termYears(b.maturity, fedSettleStr), maturity_date: b.maturity, cusip: b.cusip,
    security_type: 'TIPS', source: 'FedInvest',
    ask_yield: b.askYield, sa_yield: b.saYield, sao_yield: b.saoYield, spot_yield: '', spot_sa_yield: '', bei: '',
  });
  for (const b of mktTipsBonds) evalRows.push({
    term_years: termYears(b.maturity, brokerSettleStr), maturity_date: b.maturity, cusip: b.cusip,
    security_type: 'TIPS', source: 'Market',
    ask_yield: b.askYield, sa_yield: b.saYield, sao_yield: b.saoYield, spot_yield: '', spot_sa_yield: '', bei: '',
  });
  evalRows.push(...buildGridRows(fits.FedInvest, 'FedInvest'));
  evalRows.push(...buildGridRows(fits.Market, 'Market'));
  evalRows.sort((a, b) => a.term_years - b.term_years
    || a.source.localeCompare(b.source)
    || (a.security_type || 'zzz').localeCompare(b.security_type || 'zzz'));
  console.log(`SpotYieldCurves.csv: ${evalRows.length} rows (securities + grid points).`);

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
  const fmtYield = v => (v === '' || v == null || isNaN(v)) ? '' : Number(v).toFixed(7);
  const fmtTerm = v => (v === '' || v == null || isNaN(v)) ? '' : Number(v).toFixed(3);
  const spotHeader = 'term_years,maturity_date,cusip,security_type,source,ask_yield,sa_yield,sao_yield,spot_yield,spot_sa_yield,bei';
  const spotLines = evalRows.map(r => [
    fmtTerm(r.term_years), r.maturity_date, r.cusip, r.security_type, r.source,
    fmtYield(r.ask_yield), fmtYield(r.sa_yield), fmtYield(r.sao_yield),
    fmtYield(r.spot_yield), fmtYield(r.spot_sa_yield), fmtYield(r.bei),
  ].join(','));
  const spotCsv = [spotHeader, ...spotLines].join('\n') + '\n';

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
    console.log(spotCsv.split('\n').slice(0, 6).join('\n'));
    console.log(beiCsv.split('\n').slice(0, 4).join('\n'));
    console.log(spreadCsv.split('\n').slice(0, 4).join('\n'));
    return;
  }

  await uploadToR2('Treasuries/SpotYieldCurves.csv', spotCsv);
  await uploadToR2('Treasuries/BreakevenInflation.csv', beiCsv);
  await uploadToR2('Treasuries/BidAskSpreads.csv', spreadCsv);
  console.log('Update complete.');
}

main().catch(err => {
  console.error('Error in Spot Yield Curves update:', err);
  process.exit(1);
});

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
//   Treasuries/YieldCurves.csv        — per-security Ask/SA/SAO yields plus evaluated
//                                        nominal/TIPS-quoted/TIPS-SA spot yields and
//                                        spot BEI on a term grid — one spreadsheet-ready,
//                                        general-purpose file (see S13)
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
//
// Returns EVERY nominal Treasury row, STRIPS included (Product = Treasury covers both —
// see knowledge/DATA_DICTIONARY.md#s7/#e6, which describe Product as Treasury/TIPS but
// don't call out that STRIPS rows sit inside the Treasury rows, identified only by CUSIP
// root — see this script's STRIPS handling below and the task report). Callers filter
// STRIPS out where a coupon-bond price-space curve fit needs them excluded; the raw
// per-security rows keep them, tagged Type = STRIPS via classifyByCusipRoot.
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

const GRID_STEP_YRS = 0.5; // half-year grid — matches the chart's own spotCurveGrid convention.
// 0.5 is exactly representable in IEEE754 binary floating point, so repeated += 0.5 never
// drifts off an integer — every whole year in range lands on the grid automatically as
// every other step (1.0, 2.0, 3.0, …), alongside the half-year points. Kept for the finer
// resolution; the developer's stated use (a discount rate per annual term) is a subset of
// what this grid already produces.

// Evaluate one fit's z(t) at a term, honoring its own valid range and sanity check.
// Returns a decimal yield, or null if the fit is missing, out of range, or blown up there.
function evalFitAt(fit, t) {
  if (!fit || t < fit.tMin - 1e-9 || t > fit.tMax + 1e-9) return null;
  const pct = zToSA(fit.z(t));
  return fit.sane(pct) ? pct / 100 : null;
}

// Fitted grid rows: THREE Type rows per term (Treasury / TIPS / BEI), one row per source.
// A grid row carries CUSIP = "Spot" (not blank) so it reads consistently with security
// rows — see knowledge/DataStores.md#s13. The three underlying curves (nominal, TIPS
// quoted, TIPS SA) may each have a different valid range, so the grid spans their union
// and a cell is left blank at any term/fit combination where that particular curve isn't
// valid, rather than truncating the whole grid to the narrowest curve's range.
function buildGridRows(fits, source) {
  const { nominal: nomFit, tips: tipsFit, tips_sa: saFit } = fits;
  const present = [nomFit, tipsFit, saFit].filter(Boolean);
  if (!present.length) { console.warn(`  (skipped ${source} grid: no fits available)`); return []; }
  const tMin = Math.min(...present.map(f => f.tMin));
  const tMax = Math.max(...present.map(f => f.tMax));
  const rows = [];
  for (let t = Math.ceil(tMin / GRID_STEP_YRS) * GRID_STEP_YRS; t <= tMax + 1e-9; t += GRID_STEP_YRS) {
    const nomVal = evalFitAt(nomFit, t);
    const tipsVal = evalFitAt(tipsFit, t);
    const saVal = evalFitAt(saFit, t);
    if (nomVal == null && tipsVal == null && saVal == null) continue; // nothing valid at this term

    rows.push({
      term_years: t, maturity_date: '', cusip: 'Spot', type: 'Treasury', source,
      ask_yield: '', sa_yield: '', sao_yield: '',
      spot_yield: nomVal == null ? '' : nomVal, spot_sa_yield: '',
    });
    rows.push({
      term_years: t, maturity_date: '', cusip: 'Spot', type: 'TIPS', source,
      ask_yield: '', sa_yield: '', sao_yield: '',
      spot_yield: tipsVal == null ? '' : tipsVal, spot_sa_yield: saVal == null ? '' : saVal,
    });
    rows.push({
      term_years: t, maturity_date: '', cusip: 'Spot', type: 'BEI', source,
      ask_yield: '', sa_yield: '', sao_yield: '',
      spot_yield: (nomVal != null && tipsVal != null) ? nomVal - tipsVal : '',
      spot_sa_yield: (nomVal != null && saVal != null) ? nomVal - saVal : '',
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
  // Unfiltered: every nominal Treasury row, STRIPS included, for the per-security rows.
  const fidNominalBondsAll = parseFidelityNominalRows(fidText, tipsCusips);
  // Filtered: STRIPS excluded, for the coupon-bond price-space curve fit only — a STRIP's
  // price/yield relationship is already a pure zero-coupon discount, but the *nominal fit*
  // is a coupon-bond price-space fit (cashflowSchedule) and STRIPS aren't part of its
  // fitting universe here, same as S1's fitting inputs (knowledge/DataStores.md#s13).
  const fidNominalBonds = fidNominalBondsAll.filter(b => !isStrip(b.cusip));
  console.log(`Market: ${priceMap.size} TIPS quotes, ${fidNominalBondsAll.length} nominal quotes `
    + `(${fidNominalBondsAll.length - fidNominalBonds.length} STRIPS).`);

  // ── Processed bonds, per source ──────────────────────────────────────────────
  const fedTipsBonds = buildProcessedTipsBonds(rawTipsData, refCpiData, priceMap, false, fedSettleStr);
  const mktTipsBonds = buildProcessedTipsBonds(rawTipsData, refCpiData, priceMap, true, brokerSettleStr);
  if (fedTipsBonds.length) { const s = calculateSAO(fedTipsBonds); fedTipsBonds.forEach((b, i) => b.saoYield = s[i]); }
  if (mktTipsBonds.length) { const s = calculateSAO(mktTipsBonds); mktTipsBonds.forEach((b, i) => b.saoYield = s[i]); }

  // FedInvest nominals: STRIPS aren't currently present in YieldsFromFedInvestPrices.csv
  // (verified empty at time of writing), but the same all/fit split is applied for symmetry
  // and in case that ever changes — classifyByCusipRoot tags STRIPS Type correctly either way.
  const fedNominalBondsAll = rawNominalsData.map(r => {
    const coupon = parseFloat(r.coupon), price = parseFloat(r.price);
    const maturityDate = localDate(r.maturity);
    const yld = yieldFromPrice(price, coupon, localDate(r.settlementDate), maturityDate);
    if (yld == null || isNaN(yld)) return null;
    return { ...r, coupon, price, yield: yld, maturityDate };
  }).filter(Boolean);
  const fedNominalBonds = fedNominalBondsAll.filter(b => !isStrip(b.cusip));
  const mktNominalBondsAll = fidNominalBondsAll.map(b => ({ ...b, settlementDate: brokerSettleStr }));
  const mktNominalBonds = fidNominalBonds.map(b => ({ ...b, settlementDate: brokerSettleStr }));

  // ── Spot curves: nominal fit uses minT 0.25y (Bills anchor the short end), TIPS quoted
  // and TIPS SA fits use the shared default (SAO_NOISE_YRS = 0.5y) — same as src/app.js's
  // chart calls (the quoted-TIPS fit matches src/app.js's TIPS-tab "Spot" call exactly:
  // priceOf b.price, yieldOf b.askYield, no minT override). ──────────────────────────
  const fits = {
    FedInvest: {
      nominal: spotCurveFit(fedNominalBonds, { priceOf: b => b.price, yieldOf: b => b.yield, minT: 0.25 }),
      tips: spotCurveFit(fedTipsBonds, { priceOf: b => b.price, yieldOf: b => b.askYield }),
      tips_sa: spotCurveFit(fedTipsBonds, { priceOf: b => b.price * b.saRatio, yieldOf: b => b.saYield }),
    },
    Market: {
      nominal: spotCurveFit(mktNominalBonds, { priceOf: b => b.price, yieldOf: b => b.yield, minT: 0.25 }),
      tips: spotCurveFit(mktTipsBonds, { priceOf: b => b.price, yieldOf: b => b.askYield }),
      tips_sa: spotCurveFit(mktTipsBonds, { priceOf: b => b.price * b.saRatio, yieldOf: b => b.saYield }),
    },
  };
  console.log(`Fitted spot curves — FedInvest: nominal=${!!fits.FedInvest.nominal} tips=${!!fits.FedInvest.tips} tips_sa=${!!fits.FedInvest.tips_sa}; `
    + `Market: nominal=${!!fits.Market.nominal} tips=${!!fits.Market.tips} tips_sa=${!!fits.Market.tips_sa}`);

  // ── YieldCurves.csv rows: one row per actual security (Ask/SA/SAO populated where they
  // exist) plus rows per fitted grid point (Spot/Spot SA populated, Type = Treasury/TIPS/BEI).
  // See knowledge/DataStores.md#s13 for the column list and rationale. ──────────────────
  const evalRows = [];
  for (const b of fedNominalBondsAll) evalRows.push({
    term_years: termYears(b.maturity, fedSettleStr), maturity_date: b.maturity, cusip: b.cusip,
    type: classifyByCusipRoot(b.cusip) || '', source: 'FedInvest',
    ask_yield: b.yield, sa_yield: '', sao_yield: '', spot_yield: '', spot_sa_yield: '',
  });
  for (const b of mktNominalBondsAll) evalRows.push({
    term_years: termYears(b.maturity, brokerSettleStr), maturity_date: b.maturity, cusip: b.cusip,
    type: classifyByCusipRoot(b.cusip) || '', source: 'Market',
    ask_yield: b.yield, sa_yield: '', sao_yield: '', spot_yield: '', spot_sa_yield: '',
  });
  for (const b of fedTipsBonds) evalRows.push({
    term_years: termYears(b.maturity, fedSettleStr), maturity_date: b.maturity, cusip: b.cusip,
    type: 'TIPS', source: 'FedInvest',
    ask_yield: b.askYield, sa_yield: b.saYield, sao_yield: b.saoYield, spot_yield: '', spot_sa_yield: '',
  });
  for (const b of mktTipsBonds) evalRows.push({
    term_years: termYears(b.maturity, brokerSettleStr), maturity_date: b.maturity, cusip: b.cusip,
    type: 'TIPS', source: 'Market',
    ask_yield: b.askYield, sa_yield: b.saYield, sao_yield: b.saoYield, spot_yield: '', spot_sa_yield: '',
  });
  evalRows.push(...buildGridRows(fits.FedInvest, 'FedInvest'));
  evalRows.push(...buildGridRows(fits.Market, 'Market'));
  evalRows.sort((a, b) => a.term_years - b.term_years
    || a.source.localeCompare(b.source)
    || (a.type || 'zzz').localeCompare(b.type || 'zzz'));
  console.log(`YieldCurves.csv: ${evalRows.length} rows (securities + grid points).`);

  // ── Breakeven inflation (Market only — BEI needs both legs quoted the same way; see
  // src/app.js processAndRenderBei). Per-TIPS Ask/SA/SAO BEI vs. the nearest-maturity
  // nominal (spot BEI itself is not persisted here — it is fully re-derivable from the
  // Treasury/TIPS grid rows above, so storing it separately would be redundant duplication
  // rather than verifying redundancy). Matched against STRIPS-excluded nominals, same as
  // before — a STRIP is not a sensible "nearest nominal" reference for a coupon TIPS. ───
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
  // Treasuries combined, one row per security, discriminated by security_type like S7.
  // STRIPS excluded, same as the BEI match above and unchanged from before — not in scope
  // for this task's STRIPS addition (see task report). ──────────────────────────────
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
  const spotHeader = 'Term (y),Maturity,CUSIP,Type,Source,Ask,SA,SAO,Spot,Spot SA';
  const spotLines = evalRows.map(r => [
    fmtTerm(r.term_years), r.maturity_date, r.cusip, r.type, r.source,
    fmtYield(r.ask_yield), fmtYield(r.sa_yield), fmtYield(r.sao_yield),
    fmtYield(r.spot_yield), fmtYield(r.spot_sa_yield),
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

  await uploadToR2('Treasuries/YieldCurves.csv', spotCsv);
  await uploadToR2('Treasuries/BreakevenInflation.csv', beiCsv);
  await uploadToR2('Treasuries/BidAskSpreads.csv', spreadCsv);
  console.log('Update complete.');
}

main().catch(err => {
  console.error('Error in Spot Yield Curves update:', err);
  process.exit(1);
});

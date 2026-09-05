// snap-data.js — Frozen-snapshot data layer for the TIPS Seasonality guide.
// Everything the slides draw comes from two CSVs checked into ./data/, captured
// once so the lesson is fixed and reproducible (and works with no network):
//   YieldsSaSao.snapshot.csv  — 53 outstanding TIPS: quoted / SA / SAO yield
//   RefCpiNsaSa.snapshot.csv  — daily NSA & SA Ref CPI + the seasonal factor
// Spec: knowledge/1.0_SeasonalAdjustments_Explorer.md
//
// Snapshot provenance: vendor quote file downloaded 2026-08-31 09:37 ET;
// market settlement (T+1) 2026-09-01. This particular day was kept because the
// gap between quoted and SA yield at the front of the curve is near its
// seasonal maximum — the clearest teaching case.

import { parseCsv } from '../../shared/src/csv.js';

const YSAO_URL = './data/YieldsSaSao.snapshot.csv';
const REFCPI_URL = './data/RefCpiNsaSa.snapshot.csv';

export const SNAPSHOT_DATE = '2026-08-31';   // market quote date
export const SETTLE_DATE = '2026-09-01';     // T+1 market settlement
export const SNAPSHOT_LABEL = 'Aug 31, 2026';
export const SETTLE_LABEL = 'Sep 1, 2026';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const cum = [0]; for (const d of DIM) cum.push(cum[cum.length - 1] + d);
// The four calendar days every outstanding TIPS matures on.
export const MATS = [{ m: 0, label: 'Jan 15' }, { m: 3, label: 'Apr 15' }, { m: 6, label: 'Jul 15' }, { m: 9, label: 'Oct 15' }];

// BLS revised seasonal factors for the CPI-U, item SA0 ("All items"), series
// CUSR0000SA0 (the CPI-U series; CWSR0000SA0 is the CPI-W counterpart). From the
// "revised seasonally adjusted indexes and factors, last five years" file at
// bls.gov/cpi/seasonal-adjustment/, DATA_TYPE = SEASONAL FACTOR (shown ×100).
// SEASONAL FACTOR = UNADJUSTED INDEX / SEASONALLY ADJUSTED INDEX. BLS recomputes
// the factors each year with the January release, covering the prior five years
// (X-13ARIMA-SEATS). Oct 2025: no CPI published that month. Verified 2026-09-05:
// the monthly Ref CPI NSA / SA from bls/CPI.csv reproduces every value here to 3 dp.
export const BLS_SEASONAL_FACTOR = {
  2021: [99.579, 99.786, 99.968, 100.165, 100.303, 100.385, 100.405, 100.327, 100.146, 100.014, 99.652, 99.273],
  2022: [99.506, 99.724, 99.941, 100.190, 100.343, 100.459, 100.462, 100.364, 100.155, 100.002, 99.640, 99.319],
  2023: [99.584, 99.798, 100.005, 100.171, 100.261, 100.360, 100.355, 100.308, 100.167, 99.992, 99.644, 99.354],
  2024: [99.586, 99.794, 99.996, 100.168, 100.285, 100.361, 100.310, 100.234, 100.181, 100.010, 99.673, 99.371],
  2025: [99.596, 99.813, 100.004, 100.154, 100.264, 100.350, 100.273, 100.212, 100.171, null, 99.711, 99.394],
};

export function localDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function doy(month, day) { return cum[month] + (day - 1); }
export function dateLabel(doyVal) {
  let d = ((doyVal % 365) + 365) % 365;
  for (let m = 0; m < 12; m++) { if (d < DIM[m]) return MONTHS[m] + ' ' + (d + 1); d -= DIM[m]; }
  return '';
}

// years between two YYYY-MM-DD dates (365.25-day years — display precision only)
export function yearsBetween(aStr, bStr) {
  return (localDate(bStr) - localDate(aStr)) / (365.25 * 86400000);
}

// ── Loaded snapshot ─────────────────────────────────────────────────────────
// bonds:   [{ cusip, mat:'YYYY-MM-DD', matDate, matMonth, coupon, ask, sa, sao, ytm }]
//          sorted by maturity, yields as decimals (0.02556 = 2.556%).
// wave:    365-element daily seasonal factor, most recent year in the
//          snapshot — S = RefCPI_NSA / RefCPI_SA. 1.0 = no seasonal effect.
// refRows: [{ date:'YYYY-MM-DD', nsa, sa, factor }] ascending by date — the raw
//          daily NSA / SA Ref CPI series, for the trend-vs-seasonal decomposition.
export const SNAP = { bonds: null, wave: null, waveYears: '', refRows: null, loaded: false };

function buildWave(refRows) {
  // One single year's real SA Factors, one value per calendar day — matches the
  // maturity-factor rule in YieldCurves/knowledge/1.0_Seasonal_Adjustments.md
  // §The Transformation (one year's value, not a multi-year average).
  //
  // The frozen snapshot ends in the autumn, so its most recent *calendar* year
  // is only partial; picking the latest year per calendar day then splices two
  // years together and leaves a step in the wave at the boundary. Use the most
  // recent COMPLETE year instead — one clean annual cycle, no seam.
  const perYear = {};                     // 'YYYY' -> { 'mm-dd' -> S }
  for (const r of refRows) {
    if (!r.date || isNaN(r.factor)) continue;
    (perYear[r.date.slice(0, 4)] ||= {})[r.date.slice(5, 10)] = r.factor;
  }
  const useYear = Object.keys(perYear)
    .filter(y => Object.keys(perYear[y]).length >= 360)
    .sort().pop();
  const src = perYear[useYear] || {};
  const out = new Array(365);
  for (let m = 0; m < 12; m++) for (let d = 0; d < DIM[m]; d++) {
    const key = String(m + 1).padStart(2, '0') + '-' + String(d + 1).padStart(2, '0');
    out[cum[m] + d] = src[key] != null ? src[key] : null;
  }
  for (let i = 0; i < 365; i++) if (out[i] == null) out[i] = out[(i - 1 + 365) % 365];
  return { wave: out, waveYears: useYear || '' };
}

export async function loadSnapshot() {
  if (SNAP.loaded) return SNAP;

  const [ysaoText, refText] = await Promise.all([
    fetch(YSAO_URL).then(r => r.text()),
    fetch(REFCPI_URL).then(r => r.text()),
  ]);

  const bonds = parseCsv(ysaoText).map(r => {
    const mat = r.maturity;
    return {
      cusip: r.cusip,
      mat,
      matDate: localDate(mat),
      matMonth: +mat.slice(5, 7) - 1,
      coupon: parseFloat(r.coupon),
      ask: parseFloat(r.ask_yield),
      sa: parseFloat(r.sa_yield),
      sao: parseFloat(r.sao_yield),
      ytm: yearsBetween(SETTLE_DATE, mat),
    };
  }).filter(b => b.mat && !isNaN(b.ask)).sort((a, b) => a.matDate - b.matDate);

  const refRows = parseCsv(refText).map(r => ({
    date: r['Ref CPI Date'], nsa: parseFloat(r['Ref CPI NSA']),
    sa: parseFloat(r['Ref CPI SA']), factor: parseFloat(r['SA Factor']),
  })).filter(r => r.date && !isNaN(r.nsa)).sort((a, b) => (a.date < b.date ? -1 : 1));

  const { wave, waveYears } = buildWave(refRows);
  Object.assign(SNAP, { bonds, wave, waveYears, refRows, loaded: true });
  return SNAP;
}

// Seasonal factor on day-of-year d (wraps).
export function Sat(d) { return SNAP.wave[((Math.round(d) % 365) + 365) % 365]; }
export const waveMin = () => Math.min(...SNAP.wave);
export const waveMax = () => Math.max(...SNAP.wave);

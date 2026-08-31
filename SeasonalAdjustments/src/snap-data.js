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

export const SNAPSHOT_DATE = '2026-08-31';   // vendor quote download date
export const SETTLE_DATE = '2026-09-01';     // T+1 market settlement

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const cum = [0]; for (const d of DIM) cum.push(cum[cum.length - 1] + d);
// The four calendar days every outstanding TIPS matures on.
export const MATS = [{ m: 0, label: 'Jan 15' }, { m: 3, label: 'Apr 15' }, { m: 6, label: 'Jul 15' }, { m: 9, label: 'Oct 15' }];

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
// bonds: [{ cusip, mat:'YYYY-MM-DD', matDate, matMonth, coupon, ask, sa, sao, ytm }]
//        sorted by maturity, yields as decimals (0.02556 = 2.556%).
// wave:  365-element daily seasonal factor, 5-year average ending at the
//        snapshot year — S = RefCPI_NSA / RefCPI_SA. 1.0 = no seasonal push.
export const SNAP = { bonds: null, wave: null, waveYears: '', loaded: false };

function buildWave(refRows) {
  // refRows: [{date:'YYYY-MM-DD', factor:Number}], any order.
  let latest = '';
  const byKey = {};                       // 'mm-dd' -> [{year, S}]
  for (const r of refRows) {
    if (!r.date || isNaN(r.factor)) continue;
    if (r.date > latest) latest = r.date;
    (byKey[r.date.slice(5, 10)] ||= []).push({ year: +r.date.slice(0, 4), S: r.factor });
  }
  const maxY = +latest.slice(0, 4), minY = maxY - 4;
  const out = new Array(365);
  for (let m = 0; m < 12; m++) for (let d = 0; d < DIM[m]; d++) {
    const key = String(m + 1).padStart(2, '0') + '-' + String(d + 1).padStart(2, '0');
    const vals = (byKey[key] || []).filter(v => v.year >= minY && v.year <= maxY).map(v => v.S);
    out[cum[m] + d] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  for (let i = 0; i < 365; i++) if (out[i] == null) out[i] = out[(i - 1 + 365) % 365];
  return { wave: out, waveYears: `${minY}–${maxY}` };
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
  }));

  const { wave, waveYears } = buildWave(refRows);
  Object.assign(SNAP, { bonds, wave, waveYears, loaded: true });
  return SNAP;
}

// Seasonal factor on day-of-year d (wraps).
export function Sat(d) { return SNAP.wave[((Math.round(d) % 365) + 365) % 365]; }
export const waveMin = () => Math.min(...SNAP.wave);
export const waveMax = () => Math.max(...SNAP.wave);

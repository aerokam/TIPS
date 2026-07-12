// sa-data.js — Data layer for the TIPS Seasonality visual guide.
// Loads the daily SA Factor series from R2, exposes S(t) lookups, the
// illustrative bond's cash-flow schedule, and shared interactive state.
// Spec: knowledge/1.0_SeasonalAdjustments_Explorer.md §Data Source

import { nextBusinessDay, parseHolidaySet } from '../../shared/src/settlement.js';
import { parseCsv } from '../../shared/src/csv.js';

const R2ROOT = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const R2 = R2ROOT + '/TIPS/RefCpiNsaSa.csv';
const HOLIDAYS_URL = R2ROOT + '/misc/BondHolidaysSifma.csv';

// Offline-fallback monthly anchors for the SA Factor (5-yr avg shape).
const MONTHLY_S = [1.00010, 0.99673, 0.99371, 0.99596, 0.99813, 1.00004, 1.00154, 1.00264, 1.00350, 1.00273, 1.00212, 1.00171];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const cum = [0]; for (const d of DIM) cum.push(cum[cum.length - 1] + d);
export const MATS = [{ m: 0, label: 'Jan 15' }, { m: 3, label: 'Apr 15' }, { m: 6, label: 'Jul 15' }, { m: 9, label: 'Oct 15' }];

// Illustrative bond — a stand-in, not a live calculator.
// Coupon: average across all outstanding TIPS (TipsRef.csv, checked 2026-07-11).
// Yield curve: FedInvest real yields by years-to-maturity (2026-07-10 snapshot).
// Payments simplified to one ANNUAL coupon (Canty's base case): every payment
// then falls on the maturity month/day, so all payments share one S value.
export const ILLUS_COUPON = 0.0125;
export const ILLUS_YIELD_CURVE = [[1, 0.0207], [2, 0.0188], [3, 0.0186], [5, 0.019], [7, 0.0205], [10, 0.0215]];
export const YEARS_OPTS = [1, 2, 3, 5, 7, 10];

export function yieldForYears(y) {
  const c = ILLUS_YIELD_CURVE;
  if (y <= c[0][0]) return c[0][1];
  if (y >= c[c.length - 1][0]) return c[c.length - 1][1];
  for (let i = 0; i < c.length - 1; i++) {
    const [y0, r0] = c[i], [y1, r1] = c[i + 1];
    if (y >= y0 && y <= y1) return r0 + (r1 - r0) * (y - y0) / (y1 - y0);
  }
  return c[c.length - 1][1];
}

// Shared interactive state, mutated by page controls, read by page renderers.
export const state = { settleDoy: 135, matIdx: 6, yearsToMat: 3 };

// Loaded data: daily = 365-element 5-yr-avg S array; series = ~10y of
// {date,nsa,sa,factor} rows; srcNote = footer text describing the source.
export const D = { daily: null, series: null, srcNote: 'Loading…' };

export function doy(month, day) { return cum[month] + (day - 1); }

export function dateLabel(doyVal) {
  let d = ((doyVal % 365) + 365) % 365;
  for (let m = 0; m < 12; m++) { if (d < DIM[m]) return MONTHS[m] + ' ' + (d + 1); d -= DIM[m]; }
  return '';
}

export function Sat(d) { return D.daily[Math.round(((d % 365) + 365) % 365) % 365]; }
export const Smin = () => Math.min(...D.daily);
export const Smax = () => Math.max(...D.daily);

// Default settlement = next bond trading day after today (T+1, skipping
// weekends and SIFMA holidays). Holiday fetch optional (3s timeout).
export async function defaultSettleDoy() {
  let holidays = new Set();
  try {
    const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(HOLIDAYS_URL, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(to);
    if (r.ok) holidays = parseHolidaySet(parseCsv(await r.text(), false));
  } catch (e) { /* unavailable — weekend-skip only */ }
  const settleDate = nextBusinessDay(new Date(), holidays);
  return doy(settleDate.getMonth(), settleDate.getDate());
}

function buildDailyFromMonthly() {
  const out = new Array(365);
  for (let m = 0; m < 12; m++) {
    const a = MONTHLY_S[m], b = MONTHLY_S[(m + 1) % 12], len = DIM[m];
    for (let d = 0; d < len; d++) out[cum[m] + d] = a + (b - a) * (d / len);
  }
  return out;
}

export async function loadData() {
  try {
    const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(R2, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(to);
    if (!r.ok) throw 0;
    const rows = (await r.text()).trim().split('\n').slice(1).map(l => l.split(','));

    let latestDate = '';
    const byKey = {};      // mm-dd -> [{year,S}]
    const allRows = [];

    for (const c of rows) {
      const date = c[0], nsa = parseFloat(c[1]), sa = parseFloat(c[2]), factor = parseFloat(c[3]);
      if (!date || isNaN(factor)) continue;
      if (date > latestDate) latestDate = date;
      allRows.push({ date, nsa, sa, factor });
      const year = parseInt(date.slice(0, 4)), key = date.slice(5, 10);
      (byKey[key] ||= []).push({ year, S: factor });
    }

    // 5-year average per mm-dd
    const maxYear = parseInt(latestDate.slice(0, 4)), minYear = maxYear - 4;
    const out = new Array(365);
    for (let m = 0; m < 12; m++) for (let d = 0; d < DIM[m]; d++) {
      const key = String(m + 1).padStart(2, '0') + '-' + String(d + 1).padStart(2, '0');
      const vals = (byKey[key] || []).filter(v => v.year >= minYear && v.year <= maxYear).map(v => v.S);
      out[cum[m] + d] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    for (let i = 0; i < 365; i++) if (out[i] == null) out[i] = out[(i - 1 + 365) % 365];
    D.daily = out;

    // Chronological series: 11 years back gives 10 full years of MoM data
    const cutoff = `${maxYear - 11}-01-01`;
    D.series = allRows.filter(d => d.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
    D.srcNote = `5-year average (${minYear}–${maxYear}) of daily SA Factor = RefCPI_NSA / RefCPI_SA from R2 (latest data: ${latestDate}).`;
  } catch (e) {
    D.daily = buildDailyFromMonthly();
    D.series = [];
    D.srcNote = 'Offline fallback: monthly anchors, interpolated to daily.';
  }
}

// ── Cash-flow schedule for the illustrative bond ────────────────────────────
// "elapsed" = days from settlement. Annual payments, so every payment date is
// the maturity month/day, one year apart; the final payment is the anniversary
// closest to `years` out. Simplified (no stub day-count precision) — shows
// relative weight, not a trade ticket. Real semiannual/Actual-Actual math
// lives in shared/src/bond-math.js.
export function finalElapsed(settleDoy, matIdx = state.matIdx, years = state.yearsToMat) {
  const matDoy = doy(matIdx, 15);
  const stub = ((matDoy - settleDoy) % 365 + 365) % 365;
  const candA = stub + 365 * (years - 1), candB = stub + 365 * years;
  const target = years * 365;
  return (candA > 0 && Math.abs(candA - target) <= Math.abs(candB - target)) ? candA : candB;
}

export function cashFlowSchedule(settleDoy, matIdx = state.matIdx, years = state.yearsToMat) {
  const ef = finalElapsed(settleDoy, matIdx, years);
  const periods = Math.max(1, Math.round(ef / 365));
  const yld = yieldForYears(years);
  const cpn = ILLUS_COUPON * 1000;
  const flows = [];
  for (let i = 1; i <= periods; i++) {
    const elapsed = ef - (periods - i) * 365;
    const principal = i === periods;
    const yearsElapsed = elapsed / 365;
    const cf = principal ? cpn + 1000 : cpn;
    const pv = cf / Math.pow(1 + yld, yearsElapsed);
    flows.push({ elapsed, yearsElapsed, principal, cf, pv });
  }
  return flows;
}

// Macaulay/modified duration from the schedule itself (annual payments, n=1
// compounding) — deliberately consistent with the annual-coupon simplification;
// not a duplicate of shared/src/bond-math.js's semiannual calculateMDuration.
export function modifiedDuration(flows, yld) {
  let macNum = 0, macDen = 0;
  for (const f of flows) { macNum += f.yearsElapsed * f.pv; macDen += f.pv; }
  return macNum / macDen / (1 + yld);
}

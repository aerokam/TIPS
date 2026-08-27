// ref-cpi.js — Single canonical home for Reference CPI logic.
// Spec: knowledge/DATA_DICTIONARY.md#ref-cpi, knowledge/TIPS_Basics.md,
//       YieldCurves/knowledge/1.0_Seasonal_Adjustments.md
//
// Per the project-wide no-redundancy directive (projects/CLAUDE.md §2a), all
// Ref CPI logic lives here and is imported — never copied inline.
//
// Two derivations of the daily Ref CPI:
//   • RETRIEVED (authoritative): TreasuryDirect daily NSA series (RefCPI.csv).
//     All apps consume this via lookupRefCpi().
//   • CALCULATED: 31 CFR §356 App. B interpolation of a monthly CPI series
//     (refCpiFromMonthly()). For NSA it is a FALLBACK + educational; for the
//     seasonally-adjusted series it is the SOLE source (no official daily SA
//     Ref CPI exists), so SA production always uses it.
// The retrieved and calculated NSA series must agree (see shared/tests/ref-cpi.test.js).

// ─── Retrieved lookup ────────────────────────────────────────────────────────
// Ref CPI is defined per SPECIFIC calendar day. Returns the exact entry for
// dateStr, or null if dateStr is outside the published range (before the first
// row or after the last). There is NO "snap" to an earlier date.
// `rows` must be ascending by date: [{ date:'YYYY-MM-DD', refCpi:Number }, ...].
export function lookupRefCpi(rows, dateStr) {
  if (!rows || rows.length === 0) return null;
  if (dateStr < rows[0].date || dateStr > rows[rows.length - 1].date) return null;
  let lo = 0, hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const rd = rows[mid].date;
    if (rd === dateStr) return rows[mid].refCpi;
    if (rd < dateStr) lo = mid + 1; else hi = mid - 1;
  }
  return null; // within range but no exact entry (data gap)
}

// ─── Truncate-then-round (31 CFR §356 App. B §I.B.3) ─────────────────────────
// "Interpolation calculations are truncated to six decimal places, then
// rounded to five decimal places — so Ref CPI and Index Ratio are always
// expressed to five decimal places." Applied at both computation points below.
function truncateThenRound(x, truncDp = 6, roundDp = 5) {
  if (x == null) return x;
  // IEEE754 doubles can represent an exact n-decimal value as e.g.
  // 1.1500349999999999 instead of 1.150035, which silently truncates/rounds
  // one digit low. Nudge by an epsilon far smaller than the 6th/5th decimal
  // place (1e-6/1e-5) but far larger than double representation error
  // (~1e-13 relative) so exact boundary values land on their true value.
  const eps = 1e-9;
  const sign = x < 0 ? -1 : 1;
  const truncFactor = 10 ** truncDp;
  const truncated = Math.trunc(x * truncFactor + sign * eps) / truncFactor;
  const roundFactor = 10 ** roundDp;
  return Math.round(truncated * roundFactor + sign * eps) / roundFactor;
}

// ─── Calculated (31 CFR §356 Appendix B) ─────────────────────────────────────
// Ref CPI for a date by linear interpolation of a monthly CPI-U series.
//   Ref CPI(month, 1)   = CPI-U(month − 3)
//   Ref CPI(month, day) = Ref CPI(month,1) + (Ref CPI(month+1,1) − Ref CPI(month,1)) · (day−1)/daysInMonth
// `monthly` is an object keyed `${year}-${month}` (month 1–12, NOT zero-padded)
// → CPI value. Pass the NSA series for Ref CPI NSA, the SA series for SA.
// Returns null if a required monthly value is unavailable.
export function refCpiFromMonthly(dateStr, monthly) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const get = (yr, m) => {
    while (m < 1) { m += 12; yr--; }
    while (m > 12) { m -= 12; yr++; }
    const v = monthly[`${yr}-${m}`];
    return v == null ? null : v;
  };
  const v1 = get(y, mo - 3);            // Ref CPI for the 1st of this month
  if (v1 == null) return null;
  if (d === 1) return truncateThenRound(v1);
  const v2 = get(y, mo - 2);            // Ref CPI for the 1st of next month
  if (v2 == null) return null;
  const daysInMonth = new Date(y, mo, 0).getDate();
  return truncateThenRound(v1 + (d - 1) / daysInMonth * (v2 - v1));
}

// Build the `monthly` map refCpiFromMonthly() expects from CPI rows.
// rows: [{ year, period:'M01'..'M12', value }]. Returns { `${y}-${m}`: value }.
export function monthlyCpiMap(rows, valueKey = 'value') {
  const m = {};
  for (const r of rows) {
    if (!r.period || r.period[0] !== 'M') continue;
    const mo = parseInt(r.period.slice(1), 10);
    if (mo < 1 || mo > 12) continue;
    const v = typeof r[valueKey] === 'number' ? r[valueKey] : parseFloat(r[valueKey]);
    if (!isNaN(v)) m[`${parseInt(r.year, 10)}-${mo}`] = v;
  }
  return m;
}

// ─── Index ratio ─────────────────────────────────────────────────────────────
export function indexRatio(refCpi, baseCpi) {
  return (refCpi != null && baseCpi) ? truncateThenRound(refCpi / baseCpi) : null;
}

// ─── SA Factor lookup (RefCpiNsaSa.csv rows) ─────────────────────────────────
// `rows` = TIPS/RefCpiNsaSa.csv parsed via shared/src/csv.js (any order):
//   [{ "Ref CPI Date": 'YYYY-MM-DD', "SA Factor": '1.00343', ... }, ...]
//
// For a date inside the published series, returns that exact day's SA Factor.
// For a date beyond the series (e.g. a synthetic maturity years in the future —
// the SA factor has no future value to look up), falls back to the most recent
// past occurrence of the same calendar month/day: the daily SA factor is a
// slowly-drifting, annually-repeating seasonal pattern, so a recent same-
// month/day reading is the best available proxy (see YieldCurves knowledge/
// 1.0_Seasonal_Adjustments.md and 2.1_SA_Intuition.md).
// Returns null if that month/day never appears in the series.
export function saFactorForDate(rows, dateStr) {
  const exact = rows.find(r => r['Ref CPI Date'] === dateStr);
  if (exact) return parseFloat(exact['SA Factor']);
  const mmdd = dateStr.slice(5, 10);
  let best = null;
  for (const r of rows) {
    const d = r['Ref CPI Date'];
    if (!d || !d.endsWith(`-${mmdd}`)) continue;
    if (!best || d > best['Ref CPI Date']) best = r;
  }
  return best ? parseFloat(best['SA Factor']) : null;
}

// date-util.js — Neutral date helpers shared across the app.
// Lives here (not in rebalance-lib) so build-lib and ladder-core can use fmtDate
// without importing from rebalance — keeping the dependency graph one-directional:
// build-lib / rebalance-lib → ladder-core / date-util (neither core imports a sibling lib).

export function localDate(str) {
  if (!str) return null;
  const parts = str.split('-').map(Number);
  if (parts.length !== 3) {
    console.log('localDate invalid format:', str);
    return null;
  }
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt.getTime())) {
    console.log('localDate invalid date:', str);
  }
  return dt;
}

export function toDateStr(d) { return d.toISOString().split('T')[0]; }

export function fmtDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Day-precise variant of fmtDate, for contexts that need to name an exact date (e.g. "has this
// coupon been paid as of Aug 17, 2026" — RMD Options, Cash Flow Calendar) rather than just a month.
export function fmtDateLong(d) {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

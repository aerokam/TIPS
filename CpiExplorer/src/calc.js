// CpiExplorer — calc.js
// Pure, synchronous CPI transformation functions.
// All series functions return { labels: string[], values: number[] } for Chart.js.
// labels are ISO date strings (YYYY-MM-DD).

/** Format a Date as YYYY-MM-DD */
export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Get value from a row by field name ('nsa' | 'sa' | 'value') */
function getVal(row, field) {
  return row[field] ?? null;
}

/** Filter rows to [startDate, endDate] (inclusive). Pass null to skip either bound. */
export function filterRows(rows, startDate, endDate) {
  return rows.filter(r => {
    if (startDate && r.date < startDate) return false;
    if (endDate   && r.date > endDate)   return false;
    return true;
  });
}

/**
 * Raw index level.
 * @param {Array} rows - CpiRow[] or RefCpiRow[]
 * @param {string} field - 'nsa' | 'sa' | 'value'
 * @returns {{ labels: string[], values: number[] }}
 */
export function calcIndex(rows, field) {
  const labels = [], values = [];
  for (const row of rows) {
    const v = getVal(row, field);
    if (v === null) continue;
    labels.push(isoDate(row.date));
    values.push(v);
  }
  return { labels, values };
}

/**
 * Year-over-Year % change.
 * Monthly: compare row[t] vs row[t-12].
 * Daily (Ref CPI): compare vs same calendar date 1 year prior (binary search).
 * @param {Array} rows
 * @param {string} field
 * @param {boolean} isDaily - true for RefCPI rows
 * @returns {{ labels: string[], values: number[] }}
 */
export function calcYoY(rows, field, isDaily = false) {
  const labels = [], values = [];
  if (!isDaily) {
    for (let i = 12; i < rows.length; i++) {
      const v     = getVal(rows[i], field);
      const vPrev = getVal(rows[i - 12], field);
      if (v === null || vPrev === null || vPrev === 0) continue;
      labels.push(isoDate(rows[i].date));
      values.push((v / vPrev - 1) * 100);
    }
  } else {
    for (let i = 0; i < rows.length; i++) {
      const v = getVal(rows[i], field);
      if (v === null) continue;
      const targetDate = new Date(rows[i].date);
      targetDate.setFullYear(targetDate.getFullYear() - 1);
      const prior = findClosestOnOrBefore(rows, field, targetDate);
      if (prior === null) continue;
      labels.push(isoDate(rows[i].date));
      values.push((v / prior - 1) * 100);
    }
  }
  return { labels, values };
}

/**
 * Month-over-Month % change.
 * Monthly: row[t] vs row[t-1].
 * Daily: row[t] vs same calendar date 1 month prior.
 * @param {Array} rows
 * @param {string} field
 * @param {boolean} isDaily
 * @returns {{ labels: string[], values: number[] }}
 */
export function calcMoM(rows, field, isDaily = false) {
  const labels = [], values = [];
  if (!isDaily) {
    for (let i = 1; i < rows.length; i++) {
      const v     = getVal(rows[i], field);
      const vPrev = getVal(rows[i - 1], field);
      if (v === null || vPrev === null || vPrev === 0) continue;
      labels.push(isoDate(rows[i].date));
      values.push((v / vPrev - 1) * 100);
    }
  } else {
    for (let i = 0; i < rows.length; i++) {
      const v = getVal(rows[i], field);
      if (v === null) continue;
      const targetDate = new Date(rows[i].date);
      targetDate.setMonth(targetDate.getMonth() - 1);
      const prior = findClosestOnOrBefore(rows, field, targetDate);
      if (prior === null) continue;
      labels.push(isoDate(rows[i].date));
      values.push((v / prior - 1) * 100);
    }
  }
  return { labels, values };
}

/**
 * Trailing N-month rolling change.
 * Monthly: look back windowMonths rows.
 * Daily: approximate as windowMonths calendar months back.
 * @param {Array} rows
 * @param {string} field
 * @param {number} windowMonths
 * @param {boolean} isDaily
 * @returns {{ labels: string[], values: number[] }}
 */
export function calcRolling(rows, field, windowMonths, isDaily = false) {
  const labels = [], values = [];
  if (!isDaily) {
    for (let i = windowMonths; i < rows.length; i++) {
      const v     = getVal(rows[i], field);
      const vPrev = getVal(rows[i - windowMonths], field);
      if (v === null || vPrev === null || vPrev === 0) continue;
      labels.push(isoDate(rows[i].date));
      values.push((v / vPrev - 1) * 100);
    }
  } else {
    for (let i = 0; i < rows.length; i++) {
      const v = getVal(rows[i], field);
      if (v === null) continue;
      const targetDate = new Date(rows[i].date);
      targetDate.setMonth(targetDate.getMonth() - windowMonths);
      const prior = findClosestOnOrBefore(rows, field, targetDate);
      if (prior === null) continue;
      labels.push(isoDate(rows[i].date));
      values.push((v / prior - 1) * 100);
    }
  }
  return { labels, values };
}

/**
 * Point-to-point: scalar result + full index series between start and end.
 * @param {Array} rows
 * @param {string} field
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {{ changePct: number, annualized: number, months: number, startVal: number, endVal: number,
 *             startLabel: string, endLabel: string, series: { labels: string[], values: number[] } }}
 */
export function calcP2P(rows, field, startDate, endDate) {
  const inRange = filterRows(rows, startDate, endDate);
  const series = calcIndex(inRange, field);

  // Find the closest valid rows on or before each boundary
  const startVal = findClosestOnOrBefore(rows, field, startDate);
  const endVal   = findClosestOnOrBefore(rows, field, endDate);

  if (startVal === null || endVal === null || startVal === 0) {
    return { changePct: null, annualized: null, months: null, startVal, endVal,
             startLabel: '', endLabel: '', series };
  }

  // Compute month count between boundary dates
  const startRow = rows.find(r => r.date <= startDate && getVal(r, field) !== null);
  const endRow   = [...rows].reverse().find(r => r.date <= endDate && getVal(r, field) !== null);
  const months = startRow && endRow
    ? (endRow.date.getFullYear()   - startRow.date.getFullYear())   * 12
    + (endRow.date.getMonth()      - startRow.date.getMonth())
    : 0;

  const changePct = (endVal / startVal - 1) * 100;
  const annualized = months > 0 ? (Math.pow(endVal / startVal, 12 / months) - 1) * 100 : null;

  return {
    changePct, annualized, months,
    startVal, endVal,
    startLabel: startRow ? isoDate(startRow.date) : '',
    endLabel:   endRow   ? isoDate(endRow.date)   : '',
    series,
  };
}

/**
 * Summary stats for the currently rendered series.
 * @param {string[]} labels
 * @param {number[]} values
 * @param {string} mode - 'index' | 'yoy' | 'mom' | 'rolling' | 'p2p'
 * @returns {{ current: number, start: number, changePct: number|null, annualized: number|null,
 *             peak: number, peakLabel: string, trough: number, troughLabel: string }}
 */
export function calcStats(labels, values, mode) {
  if (!values.length) return null;

  const current = values[values.length - 1];
  const start   = values[0];

  let changePct = null, annualized = null;
  if (mode === 'index' || mode === 'p2p') {
    changePct = start !== 0 ? (current / start - 1) * 100 : null;
    // Month count from labels
    if (labels.length >= 2) {
      const d0 = new Date(labels[0]);
      const d1 = new Date(labels[labels.length - 1]);
      const months = (d1.getFullYear() - d0.getFullYear()) * 12 + (d1.getMonth() - d0.getMonth());
      if (months > 0 && start !== 0) {
        annualized = (Math.pow(current / start, 12 / months) - 1) * 100;
      }
    }
  }

  let peakIdx = 0, troughIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[peakIdx])   peakIdx   = i;
    if (values[i] < values[troughIdx]) troughIdx = i;
  }

  return {
    current,
    start,
    changePct,
    annualized,
    peak: values[peakIdx],
    peakLabel: labels[peakIdx],
    trough: values[troughIdx],
    troughLabel: labels[troughIdx],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Binary search: find the value of `field` for the last row with date <= targetDate. */
function findClosestOnOrBefore(rows, field, targetDate) {
  let lo = 0, hi = rows.length - 1, result = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].date <= targetDate) {
      const v = getVal(rows[mid], field);
      if (v !== null) result = v;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

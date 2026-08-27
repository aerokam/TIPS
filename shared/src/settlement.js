// settlement.js — Settlement-date arithmetic shared across apps.
// Spec: knowledge/DATA_DICTIONARY.md#settlement-date (Trade_Date + 1 Bond Trading Day,
// excluding weekends and SIFMA bond-market holidays).
// Per the project-wide no-redundancy directive (projects/CLAUDE.md §2a), this is the
// one implementation; apps import it instead of keeping their own copy.

// Parses a 'YYYY-MM-DD' string into a local-time Date (midnight local).
export function localDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Formats a Date as 'YYYY-MM-DD' using its local-time components.
export function toIsoDate(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

// T+1 bond trading day: the next day that is not a weekend or a SIFMA bond-market holiday.
export function nextBusinessDay(date, holidaySet) {
  if (!date) return new Date();
  const d = new Date(date.getTime());
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6 || holidaySet.has(toIsoDate(d)));
  return d;
}

// Deterministic month-name table for parseHolidaySet — avoids `new Date("April 3, 2026")`,
// which is implementation-defined string parsing per spec (V8 handles it today, but nothing
// guarantees it stays that way or matches across engines).
const MONTH_NUMBER = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

// Builds a Set of ISO holiday dates from misc/BondHolidaysSifma.csv rows, parsed via
// shared/src/csv.js's parseCsv(text, false) (no header — one array of cells per row).
// Row format: ["Weekday, Month DD, YYYY", "Holiday Name"] — the weekday prefix is
// stripped before parsing. Handles both zero-padded ("April 03, 2026") and unpadded
// ("April 3, 2026") day values, since the source file uses the latter.
export function parseHolidaySet(rows) {
  const holidaySet = new Set();
  (rows || []).forEach(row => {
    if (!row || !row[0]) return;
    const datePart = row[0].split(',').slice(1).join(',').trim();
    const m = datePart.match(/^(\w+)\s+(\d{1,2}),\s*(\d{4})$/);
    if (!m) return;
    const mo = MONTH_NUMBER[m[1]];
    if (!mo) return;
    holidaySet.add(`${m[3]}-${String(mo).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`);
  });
  return holidaySet;
}

// A coupon/principal dated on a weekend or bond holiday is actually paid the next bond trading
// day — the cash isn't in hand until then. Returns `d` unchanged when it is already a trading day
// (on-or-after semantics); this is NOT the same as nextBusinessDay(d, holidaySet), which always
// advances at least one day. Conflating the two shifts every on-time payment forward by one
// business day — every coupon/principal payment date, the Cash Flow Calendar, and settlement-year
// LMI depend on getting this guard right (TipsLadderManager knowledge/2.0_TIPS_Ladders.md).
export function actualPaymentDate(d, holidaySet = new Set()) {
  const isTradingDay = d.getDay() !== 0 && d.getDay() !== 6 && !holidaySet.has(toIsoDate(d));
  return isTradingDay ? d : nextBusinessDay(d, holidaySet);
}

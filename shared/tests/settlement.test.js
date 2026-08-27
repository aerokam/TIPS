// settlement.test.js — Regression coverage for shared/src/settlement.js.
// Run: node shared/tests/settlement.test.js
//
// Added when TipsLadderManager/src/data.js's nextBondTradingDay/parseBondHolidays/
// actualPaymentDate were consolidated onto this module's nextBusinessDay/parseHolidaySet
// (projects/CLAUDE.md §2a no-redundancy directive). Existing coverage of these primitives
// was thin and partly self-referential (TipsLadderManager's E2E helper computed its expected
// value with the same functions the app uses, so a shared regression couldn't be caught there) —
// see handoff-shared-data-js.md. These tests pin the one behavior that fails silently if it
// regresses: actualPaymentDate is "on or after" (returns d unchanged if d already IS a trading
// day), not "strictly after" like nextBusinessDay.

import { localDate, toIsoDate, nextBusinessDay, parseHolidaySet, actualPaymentDate } from '../src/settlement.js';
import { parseCsv } from '../src/csv.js';

const R2 = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const HOLIDAYS_URL = `${R2}/misc/BondHolidaysSifma.csv`;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };

async function main() {
  console.log('Fetching live misc/BondHolidaysSifma.csv ...');
  const res = await fetch(HOLIDAYS_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${HOLIDAYS_URL}: HTTP ${res.status}`);
  const text = await res.text();
  const holidays = parseHolidaySet(parseCsv(text, false));

  // ── parseHolidaySet: real file uses unpadded days ("Friday, April 3, 2026") ──
  ok(holidays.has('2026-04-03'), 'parseHolidaySet picks up single-digit-day "Friday, April 3, 2026" (Good Friday)');
  ok(holidays.has('2026-01-19'), 'parseHolidaySet picks up double-digit-day "Monday, January 19, 2026" (MLK Day)');

  // ── The landmine: Good Friday 2026-04-03 (a Friday) pins all three behaviors at once ──
  const apr2 = localDate('2026-04-02');  // Thursday, before the holiday
  const apr3 = localDate('2026-04-03');  // Friday, IS the holiday
  const apr6 = localDate('2026-04-06');  // Monday, next trading day after the holiday weekend

  ok(toIsoDate(nextBusinessDay(apr2, holidays)) === '2026-04-06',
    'nextBusinessDay(Thu Apr 2) skips Good Friday + weekend -> Mon Apr 6');

  ok(toIsoDate(actualPaymentDate(apr3, holidays)) === '2026-04-06',
    'actualPaymentDate(Fri Apr 3, a holiday) rolls forward -> Mon Apr 6');

  // This is the one that catches a regression to nextBusinessDay(d) (strictly-after):
  // a date that is ALREADY a trading day must come back unchanged, not advance another day.
  ok(toIsoDate(actualPaymentDate(apr6, holidays)) === '2026-04-06',
    'actualPaymentDate(Mon Apr 6, already a trading day) is UNCHANGED, not advanced to Apr 7');

  // ── actualPaymentDate default holiday set (weekend-only rolling for callers with no data) ──
  const sat = localDate('2026-04-04'); // Saturday
  ok(toIsoDate(actualPaymentDate(sat)) === '2026-04-06', 'actualPaymentDate weekend-only rolling works with default empty holiday set');
  const wed = localDate('2026-04-01'); // ordinary Wednesday
  ok(toIsoDate(actualPaymentDate(wed)) === '2026-04-01', 'actualPaymentDate leaves an ordinary weekday unchanged');

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });

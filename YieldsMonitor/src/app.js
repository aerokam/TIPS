// Treasury Yields Monitor - app.js
import { handleChartKeydown, setupAxisWheelZoom, snapYBounds, snapYAfterZoom, applyLockRight } from '../../shared/src/chart-keys.js';
import { applyXTimeUnit, getXTimeUnit } from '../../shared/src/chart-time-axis.js';
import { priceFromYield, yieldFromPrice } from '../../shared/src/bond-math.js';
import { saFactorForDate } from '../../shared/src/ref-cpi.js';
import { parseCsv } from '../../shared/src/csv.js';
import { localDate, toIsoDate, nextBusinessDay, parseHolidaySet } from '../../shared/src/settlement.js';

const AVAILABLE_SYMBOLS = {
  // TIPS
  'US1YTIPS': '1-Year TIPS',
  'US2YTIPS': '2-Year TIPS',
  'US5YTIPS': '5-Year TIPS',
  'US10YTIPS': '10-Year TIPS',
  'US30YTIPS': '30-Year TIPS',
  // Nominal Treasuries
  'US1M': '1-Month',
  'US2M': '2-Month',
  'US3M': '3-Month', 'US6M': '6-Month', 'US1Y': '1-Year', 'US2Y': '2-Year', 'US5Y': '5-Year', 'US10Y': '10-Year', 'US30Y': '30-Year'
};

const MATURITY_ORDER = {
  'US1M': 1, 'US2M': 2, 'US3M': 3, 'US6M': 4, 'US1Y': 5, 'US2Y': 6, 'US5Y': 7, 'US10Y': 8, 'US30Y': 9,
  'US1YTIPS': 5, 'US2YTIPS': 6, 'US5YTIPS': 7, 'US10YTIPS': 8, 'US30YTIPS': 9
};

const COLORS = [
  '#1a56db', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#be123c',
  '#4f46e5', '#db2777', '#059669', '#ea580c', '#7c3aed', '#0284c7', '#e11d48'
];

const SA_COLOR = '#f59e0b'; // fixed accent for the SA overlay line, distinct from every raw-line color

// Yield Curves / BEI charts plot by maturity (a categorical axis, not time), so a missing
// maturity (e.g. 5Y unresolved on a historical date) reads better as a lighter connector
// between its neighbors than as a hard break — that's a real reader aid for the past-date
// case this is meant for, not a claim that the missing maturity's own value is known. Segment
// styling only lightens the segment(s) touching a skipped (null) point; spanGaps: true is
// required alongside it or Chart.js won't draw a segment across a null point at all.
function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
function gapSegmentStyle(hex) {
  const lightened = hexToRgba(hex, 0.35);
  return { borderColor: ctx => (ctx.p0.skip || ctx.p1.skip) ? lightened : undefined };
}

const TIME_RANGE_MAP = {
  '2D': '1D',
  '10D': '5D',
  '1Y': '1M',
  '2Y': '3M',
  '3Y': '6M',
  '10Y': '5Y',
  'ALL': 'ALL'
};

const TIME_RANGES = Object.keys(TIME_RANGE_MAP);

const charts = {};
const liveCache = {};
const historyCache = {};
const rangeData = {};
let latestDataTime = null; 
const yieldCurveCharts = {}; 
let activeSymbols = new Set(['US10YTIPS', 'US30YTIPS', 'US10Y', 'US30Y']);
let activeRange = '2D';
let activeTab = 'timeseries';
let syncXAxis = true;
let lockRight = false;
let customStartDate = null; // Date (ET midnight of start day) | null — exclusive lower bound for Custom range
let customEndDate = null;   // Date (ET midnight of day after end day) | null — exclusive upper bound for Custom range
const xMaxAnchors = {}; // sym -> pinned xMax timestamp (set when data loads)
let isSyncing = false;
let isUpdatingData = false;
const yOverrideSyms = new Set();
const panStartY = {}; // sym -> {min, max} at pan gesture start; cleared on pan end

// Seasonal Adjustment (SA) — see YieldCurves/knowledge/1.0_Seasonal_Adjustments.md.
// CNBC's TIPS symbols (e.g. US2YTIPS) are the bid yield of one specific, real TIPS —
// CNBC's own quote page shows which one (e.g. US2YTIPS = the Jan 2028 0.50% TIPS).
// So this is the exact same transform YieldCurves applies to actual TIPS: derive the
// clean price from the quoted yield via standard bond math using the bond's REAL
// coupon and maturity date, apply the Price -> SA Price -> SA Yield ratio, and derive
// the SA yield back from the adjusted price.
// The seasonal effect amortizes with maturity (see YieldCurves/knowledge/
// 2.2_SAO_Residual_Analysis.md) — by 10Y/30Y it's at or below noise level, so the SA
// line there will sit almost on top of the raw line. It's still offered at all five
// TIPS maturities for curve completeness (the Yield Curves/BEI tabs otherwise show a
// visibly incomplete curve past 5Y).
//
// Bond identity — today vs. history:
// CNBC's restQuote endpoint (fetchTipsBondMeta) only exposes each symbol's CURRENT
// underlying bond, not a historical CUSIP-per-date mapping — so it's used as the
// authoritative source for TODAY's point only. For every other (historical) point,
// the bond identity comes from SA_ROLLOVER_LOG below: an empirically OBSERVED record
// of which maturity each symbol actually quoted, not a predicted one. A calendar rule
// ("rolls every 6 months, on the 15th of the origin-auction month, always the same
// family") was tried and falsified twice: not just a variable lag after the checkpoint,
// but sometimes a different origin-auction family altogether (US1YTIPS/US2YTIPS have
// matched 5-year-origin Apr15/Oct15 bonds at some points, not just the 10-year-origin
// Jan15/Jul15 family) — no fixed rule reproduces this. Rollover dates are instead pinned
// individually by cross-checking CNBC's own historical yield against real FedInvest
// settlement prices (TreasuryDirect's historical price tool) for every plausible
// candidate bond (any TIPS maturity in the plausible tenor range, any family), computing
// each candidate's implied yield via bond-math.js and taking whichever bond's implied
// yield is closest to CNBC's reported yield that day. FedInvest's `sell` price (what a
// holder receives — the bid) is used, falling back to `buy` (the ask) when a candidate
// has no active bid that day (`sell=0`) — CNBC's own quotes are bid-side, so `sell` is
// the correct proxy, not `buy`. (An earlier version of this had the two backwards —
// `buy`-primary — which silently corrupted several pinned dates below: it manufactured
// a brief intermediate cohort in Feb 2025 that doesn't survive the corrected price, and
// shifted two other boundary dates by a few days.) The raw `eod` evaluated price is not
// used at all: it was found to produce a stale, misleading price on at least one no-bid
// day. Some transitions resolve to more than one intermediate cohort in quick succession
// rather than a single clean flip; each is recorded as its own entry rather than picked
// as one "the" transition date. Not every period resolves: when candidate bonds' implied
// yields are too close together to disambiguate reliably (a flat 1-2yr TIPS curve), that
// stretch is left as an explicit gap rather than guessed — including gaps *between* two
// resolved cohorts, recorded as a `{ from, maturity: null }` entry (no TipsRef.csv row
// has a null maturity, so resolveTipsBond() naturally returns "no match" for that span).
const SA_SYMBOLS = new Set(['US1YTIPS', 'US2YTIPS', 'US5YTIPS', 'US10YTIPS', 'US30YTIPS']);
// Ascending by `from` (ET date, 'YYYY-MM-DD') — the maturity in effect FROM that date
// until the next entry (or indefinitely, for the last one). A trade date before the
// first entry has no observed bond identity and is left as a gap — not guessed.
const SA_ROLLOVER_LOG = {
  US1YTIPS: [
    // FALLBACK-DERIVED (2014-04-01 .. 2024-02-29): the empirical CNBC-vs-FedInvest cross-check
    // can't disambiguate candidates this far back (same "too close together" problem as the
    // 2023-08-19..2024-02 stretch previously left as a gap) — but per explicit direction, a
    // quoted yield with no SA counterpart at all is worse than a lower-confidence SA value, so
    // this range is filled instead of left empty. Method: for each date, pick whichever real
    // TIPS in TipsRef.csv (already issued, not yet matured) has a maturity closest to date+1yr;
    // walk forward and emit an entry each time that pick changes (script: see git history of
    // this file's PR, not checked in). This is NOT a claim that CNBC's US1YTIPS quote actually
    // tracked this exact CUSIP on these dates — see Known limitations. Sanity check: the last
    // entry here (maturity 2025-01-15) lands exactly on the first cross-checked entry below, so
    // the two methods agree at the boundary.
    { from: '2014-04-01', maturity: '2015-04-15' },
    { from: '2014-06-02', maturity: '2015-07-15' },
    { from: '2014-10-16', maturity: '2016-01-15' },
    { from: '2015-03-02', maturity: '2016-04-15' },
    { from: '2015-06-01', maturity: '2016-07-15' },
    { from: '2015-10-16', maturity: '2017-01-15' },
    { from: '2016-03-02', maturity: '2017-04-15' },
    { from: '2016-05-31', maturity: '2017-07-15' },
    { from: '2016-10-17', maturity: '2018-01-15' },
    { from: '2017-03-02', maturity: '2018-04-15' },
    { from: '2017-05-31', maturity: '2018-07-15' },
    { from: '2017-10-16', maturity: '2019-01-15' },
    { from: '2018-03-02', maturity: '2019-04-15' },
    { from: '2018-05-31', maturity: '2019-07-15' },
    { from: '2018-10-16', maturity: '2020-01-15' },
    { from: '2019-03-01', maturity: '2020-04-15' },
    { from: '2019-05-31', maturity: '2020-07-15' },
    { from: '2019-10-16', maturity: '2021-01-15' },
    { from: '2020-03-02', maturity: '2021-04-15' },
    { from: '2020-06-01', maturity: '2021-07-15' },
    { from: '2020-10-16', maturity: '2022-01-15' },
    { from: '2021-03-02', maturity: '2022-04-15' },
    { from: '2021-05-31', maturity: '2022-07-15' },
    { from: '2021-10-18', maturity: '2023-01-15' },
    { from: '2022-03-02', maturity: '2023-04-15' },
    { from: '2022-05-31', maturity: '2023-07-15' },
    { from: '2022-10-17', maturity: '2024-01-15' },
    { from: '2023-03-01', maturity: '2024-04-15' },
    { from: '2023-05-31', maturity: '2024-07-15' },
    { from: '2023-08-31', maturity: '2024-10-15' },
    { from: '2023-12-01', maturity: '2025-01-15' },
    // CROSS-CHECKED (empirical CNBC-vs-FedInvest match) from here on.
    { from: '2024-03-01', maturity: '2025-01-15' },
    { from: '2024-06-10', maturity: '2025-04-15' },
    { from: '2024-07-22', maturity: '2025-07-15' },
    { from: '2025-01-17', maturity: '2025-10-15' },
    // 2025-02-15..2025-02-25: previously a `maturity: null` gap (candidates within a few bp,
    // flipping non-monotonically day to day) — per the same fill-don't-gap direction, the prior
    // cohort (2025-10-15) is just left in effect through this narrow window instead; the SA
    // error from picking either side is bounded by that same sub-few-bp closeness.
    { from: '2025-02-26', maturity: '2026-01-15' },
    { from: '2025-07-10', maturity: '2026-04-15' }, // corrected from 2025-07-14 — re-bisected under sell-primary price
    { from: '2025-08-01', maturity: '2026-07-15' }, // corrected from 2025-08-04 — re-bisected under sell-primary price
    { from: '2026-02-10', maturity: '2027-01-15' },
  ],
  US2YTIPS: [
    // FALLBACK-DERIVED (2014-04-01 .. 2024-02-29) — same method as US1YTIPS above, target
    // maturity closest to date+2yr instead of date+1yr. Sanity check: the last entry here
    // (2026-01-15) lands exactly on the first cross-checked entry below.
    { from: '2014-04-01', maturity: '2016-04-15' },
    { from: '2014-06-02', maturity: '2016-07-15' },
    { from: '2014-10-16', maturity: '2017-01-15' },
    { from: '2015-03-02', maturity: '2017-04-15' },
    { from: '2015-06-01', maturity: '2017-07-15' },
    { from: '2015-10-16', maturity: '2018-01-15' },
    { from: '2016-03-02', maturity: '2018-04-15' },
    { from: '2016-05-31', maturity: '2018-07-15' },
    { from: '2016-10-17', maturity: '2019-01-15' },
    { from: '2017-03-02', maturity: '2019-04-15' },
    { from: '2017-05-31', maturity: '2019-07-15' },
    { from: '2017-10-16', maturity: '2020-01-15' },
    { from: '2018-03-01', maturity: '2020-04-15' },
    { from: '2018-05-31', maturity: '2020-07-15' },
    { from: '2018-10-16', maturity: '2021-01-15' },
    { from: '2019-03-04', maturity: '2021-04-15' },
    { from: '2019-05-31', maturity: '2021-07-15' },
    { from: '2019-10-16', maturity: '2022-01-15' },
    { from: '2020-03-02', maturity: '2022-04-15' },
    { from: '2020-06-01', maturity: '2022-07-15' },
    { from: '2020-10-16', maturity: '2023-01-15' },
    { from: '2021-03-02', maturity: '2023-04-15' },
    { from: '2021-05-31', maturity: '2023-07-15' },
    { from: '2021-10-18', maturity: '2024-01-15' },
    { from: '2022-03-01', maturity: '2024-04-15' },
    { from: '2022-05-31', maturity: '2024-07-15' },
    { from: '2022-08-31', maturity: '2024-10-15' },
    { from: '2022-12-01', maturity: '2025-01-15' },
    { from: '2023-03-02', maturity: '2025-04-15' },
    { from: '2023-05-31', maturity: '2025-07-15' },
    { from: '2023-08-31', maturity: '2025-10-15' },
    { from: '2023-12-01', maturity: '2026-01-15' },
    // CROSS-CHECKED (empirical CNBC-vs-FedInvest match) from here on — same rollover events as
    // US1YTIPS above; 1Y/2Y roll together.
    { from: '2024-03-01', maturity: '2026-01-15' },
    { from: '2024-06-10', maturity: '2026-04-15' },
    { from: '2024-07-22', maturity: '2026-07-15' },
    { from: '2025-01-17', maturity: '2026-10-15' },
    // 2025-02-15..2025-02-25: see US1YTIPS above — filled by carrying the prior cohort forward
    // rather than left as a gap.
    { from: '2025-02-26', maturity: '2027-01-15' },
    { from: '2025-07-10', maturity: '2027-04-15' },
    { from: '2025-08-01', maturity: '2027-07-15' },
    { from: '2026-02-10', maturity: '2028-01-15' },
  ],
  // US5YTIPS: the empirical cross-check is unresolvable here too (candidate 5-Year cohorts'
  // yields sit too close together to disambiguate, same as US10YTIPS below), so the issue-date
  // fallback (see the ISSUE-DATE FALLBACK note above US10YTIPS further down) applies here as
  // well: flip = first trading day strictly after the last business day of the month containing
  // the new cohort's TipsRef.csv datedDate (5-Year: Apr/Oct — annual Apr-only through 2019,
  // semiannual Apr+Oct from Oct 2019).
  // Not extended earlier than the 2006-04-15-dated cohort: 5-Year TIPS had their own issuance
  // hiatus (last pre-2004 cohort dated 1997-07-15, maturing 2002-07-15; no cohort again until
  // 2006-04-15), so CNBC's US5YTIPS quotes during that dead stretch (history exists back to
  // 2004) aren't a real on-the-run 5-Year TIPS and are left an explicit gap, same reasoning as
  // US30YTIPS's 2001-2010 hiatus below.
  US5YTIPS: [
    { from: '2006-05-01', maturity: '2011-04-15' },
    { from: '2007-05-01', maturity: '2012-04-15' },
    { from: '2008-05-01', maturity: '2013-04-15' },
    { from: '2009-05-01', maturity: '2014-04-15' },
    { from: '2010-05-03', maturity: '2015-04-15' },
    { from: '2011-05-02', maturity: '2016-04-15' },
    { from: '2012-05-01', maturity: '2017-04-15' },
    { from: '2013-05-01', maturity: '2018-04-15' },
    { from: '2014-05-01', maturity: '2019-04-15' },
    { from: '2015-05-01', maturity: '2020-04-15' },
    { from: '2016-05-02', maturity: '2021-04-15' },
    { from: '2017-05-01', maturity: '2022-04-15' },
    { from: '2018-05-01', maturity: '2023-04-15' },
    { from: '2019-05-01', maturity: '2024-04-15' },
    { from: '2019-11-01', maturity: '2024-10-15' },
    { from: '2020-05-01', maturity: '2025-04-15' },
    { from: '2020-11-02', maturity: '2025-10-15' },
    { from: '2021-05-03', maturity: '2026-04-15' },
    { from: '2021-11-01', maturity: '2026-10-15' },
    { from: '2022-05-02', maturity: '2027-04-15' },
    { from: '2022-11-01', maturity: '2027-10-15' },
    { from: '2023-05-01', maturity: '2028-04-15' },
    { from: '2023-11-01', maturity: '2028-10-15' },
    { from: '2024-05-01', maturity: '2029-04-15' },
    { from: '2024-11-01', maturity: '2029-10-15' },
    { from: '2025-05-01', maturity: '2030-04-15' },
    { from: '2025-11-03', maturity: '2030-10-15' }, // issue-date fallback extends earlier than the previously cross-checked 2026-03-20 for this same maturity — superseded, dropped
    { from: '2026-06-01', maturity: '2031-04-15' }, // cross-checked (kept as-is over the derived 2026-05-01 — moot either way, CNBC has no raw data in that gap; see rollover log narrative)
  ],
  // US10YTIPS: genuinely unresolvable by the empirical cross-check above, not merely
  // unattempted. Consecutive 10-Year TIPS cohorts (issued every Jan/Jul) mature only
  // ~6 months apart, and at that curve region (~9-10yr) real-yield differences between
  // adjacent cohorts are consistently sub-1.5bp — smaller than the noise floor of the
  // CNBC/FedInvest comparison itself (confirmed against 8 dates spanning the most
  // recent, otherwise-cleanest rollover window, Aug 2026; a sanity check against a
  // deliberately-wrong ~1.5yr-off candidate the same day showed an 8.5bp gap, so the
  // method itself works — the two adjacent 10Y candidates are just too close on the
  // curve to tell apart). Matches the front-end-only seasonal-residual finding in
  // YieldCurves/knowledge/2.2_SAO_Residual_Analysis.md.
  //
  // ISSUE-DATE FALLBACK (a second, lower-confidence pinning method, used only where the
  // empirical cross-check above is provably unresolvable — this is NOT a reversion to the
  // falsified "assume a calendar rule" approach; it's the opposite conclusion from the same
  // evidence. The cross-check fails here *because* adjacent cohorts' yields are too close to
  // tell apart, which is exactly the situation where the flip date barely matters: the SA
  // error from picking the "wrong" day is bounded by that same sub-1.5bp gap, not by tens of
  // bp like the falsified calendar rules were. Rule (empirically validated against the one
  // cross-checked US30YTIPS transition below: last business day of Feb 2026 was Fri 2026-02-27,
  // still the prior cohort; the new cohort was first seen 2026-03-02, the next trading day —
  // exact match): flip = the first trading day strictly after the last business day of the
  // month containing the new cohort's TipsRef.csv `datedDate` (10-Year: Jan/Jul; 30-Year: Feb).
  // Applied here to every US10YTIPS cohort back through TipsRef.csv (all 54 10-Year rows,
  // 1997 through today — including through the 2002-2003 issuance hiatus, which the rule
  // handles automatically: the 2012-07-15 cohort's `from` just spans the ~13 months until
  // the next actual cohort, no special-casing needed), and to every US30YTIPS cohort before
  // the one cross-checked entry below (which is left untouched — more precise than the
  // derived rule for that one case, even though the rule reproduces it exactly). US30YTIPS
  // is NOT extended earlier than 2023-03-01: 30-Year TIPS issuance itself had a ~9-year dead
  // stretch (2001-2010) where no 30-Year TIPS existed at all, so a mechanically-derived
  // "current cohort" for that gap wouldn't correspond to a real, actively-issued bond.
  US10YTIPS: [
    { from: '1997-02-03', maturity: '2007-01-15' },
    { from: '1998-02-02', maturity: '2008-01-15' },
    { from: '1999-02-01', maturity: '2009-01-15' },
    { from: '2000-02-01', maturity: '2010-01-15' },
    { from: '2001-02-01', maturity: '2011-01-15' },
    { from: '2002-02-01', maturity: '2012-01-15' },
    { from: '2002-08-01', maturity: '2012-07-15' }, // issuance hiatus follows — no 2013-01-15 cohort; this entry spans until the next real cohort below
    { from: '2003-08-01', maturity: '2013-07-15' },
    { from: '2004-02-02', maturity: '2014-01-15' },
    { from: '2004-08-02', maturity: '2014-07-15' },
    { from: '2005-02-01', maturity: '2015-01-15' },
    { from: '2005-08-01', maturity: '2015-07-15' },
    { from: '2006-02-01', maturity: '2016-01-15' },
    { from: '2006-08-01', maturity: '2016-07-15' },
    { from: '2007-02-01', maturity: '2017-01-15' },
    { from: '2007-08-01', maturity: '2017-07-15' },
    { from: '2008-02-01', maturity: '2018-01-15' },
    { from: '2008-08-01', maturity: '2018-07-15' },
    { from: '2009-02-02', maturity: '2019-01-15' },
    { from: '2009-08-03', maturity: '2019-07-15' },
    { from: '2010-02-01', maturity: '2020-01-15' },
    { from: '2010-08-02', maturity: '2020-07-15' },
    { from: '2011-02-01', maturity: '2021-01-15' },
    { from: '2011-08-01', maturity: '2021-07-15' },
    { from: '2012-02-01', maturity: '2022-01-15' },
    { from: '2012-08-01', maturity: '2022-07-15' },
    { from: '2013-02-01', maturity: '2023-01-15' },
    { from: '2013-08-01', maturity: '2023-07-15' },
    { from: '2014-02-03', maturity: '2024-01-15' },
    { from: '2014-08-01', maturity: '2024-07-15' },
    { from: '2015-02-02', maturity: '2025-01-15' },
    { from: '2015-08-03', maturity: '2025-07-15' },
    { from: '2016-02-01', maturity: '2026-01-15' },
    { from: '2016-08-01', maturity: '2026-07-15' },
    { from: '2017-02-01', maturity: '2027-01-15' },
    { from: '2017-08-01', maturity: '2027-07-15' },
    { from: '2018-02-01', maturity: '2028-01-15' },
    { from: '2018-08-01', maturity: '2028-07-15' },
    { from: '2019-02-01', maturity: '2029-01-15' },
    { from: '2019-08-01', maturity: '2029-07-15' },
    { from: '2020-02-03', maturity: '2030-01-15' },
    { from: '2020-08-03', maturity: '2030-07-15' },
    { from: '2021-02-01', maturity: '2031-01-15' },
    { from: '2021-08-02', maturity: '2031-07-15' },
    { from: '2022-02-01', maturity: '2032-01-15' },
    { from: '2022-08-01', maturity: '2032-07-15' },
    { from: '2023-02-01', maturity: '2033-01-15' },
    { from: '2023-08-01', maturity: '2033-07-15' },
    { from: '2024-02-01', maturity: '2034-01-15' },
    { from: '2024-08-01', maturity: '2034-07-15' },
    { from: '2025-02-03', maturity: '2035-01-15' },
    { from: '2025-08-01', maturity: '2035-07-15' }, // same computed flip date as US1YTIPS/US2YTIPS's cross-checked 2025-08-01 entries above — independent confirmation the issue-date rule is right, since that entry was pinned by yield cross-check, not this rule
    { from: '2026-02-02', maturity: '2036-01-15' },
    { from: '2026-08-03', maturity: '2036-07-15' }, // current cohort
  ],
  US30YTIPS: [
    { from: '2023-03-01', maturity: '2053-02-15' }, // issue-date fallback (see note above)
    { from: '2024-03-01', maturity: '2054-02-15' }, // issue-date fallback
    { from: '2025-03-03', maturity: '2055-02-15' }, // issue-date fallback — this transition was ambiguous under the empirical cross-check (same pattern as the Feb 2025 US1YTIPS gap) and wasn't cross-checkable
    { from: '2026-03-02', maturity: '2056-02-15' }, // cross-checked (see method above): bisected between 2026-02-27 (still prior cohort, 2055-02-15) and 2026-03-02 (next trading day)
  ],
};
const REF_CPI_SA_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/RefCpiNsaSa.csv';
const HOLIDAYS_CSV_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/misc/BondHolidaysSifma.csv';
const TIPS_REF_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/TIPS/TipsRef.csv';
const CNBC_QUOTE_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';
let showSaYield = true;
let showQuotedYield = true;
let refCpiSaRows = null;
let refCpiSaPromise = null;
let tipsBondMeta = null; // { [symbol]: { maturity: Date, coupon: number(decimal) } } — TODAY's bond, from CNBC live
let tipsBondMetaPromise = null;
let tipsRefRows = null; // TipsRef.csv rows — used to resolve HISTORICAL bond identity
let tipsRefPromise = null;
let saHolidaySet = new Set();
let saHolidaySetPromise = null;

const ET_YMD_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const ET_FULL_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
const ET_HM_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric' });
const ET_WDAY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });
const ET_TICK_DAY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
const ET_TICK_MON_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', year: 'numeric' });

let lastDayCache = { start: 0, end: 0, str: "" };

const SYMBOL_LABELS = {
  'US1M': '1-Mth', 'US2M': '2-Mth', 'US3M': '3-Mth', 'US6M': '6-Mth', 'US1Y': '1-Year', 'US2Y': '2-Year', 'US5Y': '5-Year', 'US10Y': '10-Year', 'US30Y': '30-Year',
  'US1YTIPS': '1-Year', 'US2YTIPS': '2-Year', 'US5YTIPS': '5-Year', 'US10YTIPS': '10-Year', 'US30YTIPS': '30-Year'
};

async function init() {
  setupUI();
  setupTabs();
  setupSidebarResize();
  syncChartContainers();
  const saReady = showSaYield ? ensureSaDataLoaded() : Promise.resolve();
  await updateAllData();
  await saReady;
  refreshSaOverlays(true);
  if (activeTab === 'yieldcurves' || activeTab === 'breakeven') updateYieldCurves();
  window.addEventListener('resize', () => Object.values(charts).forEach(c => c.resize()));
  window.addEventListener('keydown', (e) => {
    Object.entries(charts).forEach(([sym, chart]) => handleChartKeydown(e, chart, {
      lockRight,
      xMaxAnchor: lockRight ? xMaxAnchors[sym] : null,
      onAction: ({chart}) => {
        if (syncXAxis) syncAllChartsX(chart);
        else rescaleYToVisible(chart, sym);
      }
    }));
  });
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === activeTab) return;
      activeTab = tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
      if (tab === 'yieldcurves' || tab === 'breakeven') {
        updateYieldCurves();
        setTimeout(() => Object.values(yieldCurveCharts).forEach(c => c && c.resize()), 50);
      }
    });
  });
}

const SIDEBAR_WIDTH_KEY = 'ymSidebarWidthPx';

function setupSidebarResize() {
  const resizer = document.getElementById('sidebarResizer');
  const sidebar = document.getElementById('sidebar');
  if (!resizer || !sidebar) return;
  const saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
  if (saved) sidebar.style.width = `${saved}px`;
  let dragging = false;
  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const containerLeft = sidebar.parentElement.getBoundingClientRect().left;
    const width = Math.min(Math.max(e.clientX - containerLeft, 220), 560);
    sidebar.style.width = `${width}px`;
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.userSelect = '';
    localStorage.setItem(SIDEBAR_WIDTH_KEY, parseInt(sidebar.style.width, 10));
    Object.values(charts).forEach(c => c.resize());
    Object.values(yieldCurveCharts).forEach(c => c && c.resize());
  });
}

function syncAllChartsX(sourceChart) {
  if (!syncXAxis || isSyncing || isUpdatingData) return;
  isSyncing = true;
  const xMin = sourceChart.options.scales.x.min ?? sourceChart.scales.x.min;
  const xMax = sourceChart.options.scales.x.max ?? sourceChart.scales.x.max;
  Object.entries(charts).forEach(([sym, chart]) => {
    if (chart === sourceChart) return;
    chart.options.scales.x.min = xMin;
    chart.options.scales.x.max = xMax;
    if (activeRange !== '2D' && activeRange !== '10D') applyXTimeUnit(chart);
    if (!yOverrideSyms.has(sym)) rescaleYToVisible(chart, sym);
    else chart.update('none');
  });
  isSyncing = false;
}

function syncAllCharts(sourceChart) {
  if (!syncXAxis || isSyncing || isUpdatingData) return;
  isSyncing = true;
  const xMin = sourceChart.options.scales.x.min ?? sourceChart.scales.x.min;
  const xMax = sourceChart.options.scales.x.max ?? sourceChart.scales.x.max;
  const srcSym = Object.keys(charts).find(k => charts[k] === sourceChart);
  const srcStart = srcSym ? panStartY[srcSym] : null;
  const srcYCurrent = sourceChart.options.scales.y.min ?? sourceChart.scales.y.min;
  const yDelta = (srcStart != null && srcYCurrent != null) ? srcYCurrent - srcStart.min : 0;
  if (Math.abs(yDelta) > 1e-9 && srcSym) yOverrideSyms.add(srcSym);
  Object.entries(charts).forEach(([sym, chart]) => {
    if (chart === sourceChart) return;
    chart.options.scales.x.min = xMin;
    chart.options.scales.x.max = xMax;
    if (Math.abs(yDelta) > 1e-9 && panStartY[sym]) {
      yOverrideSyms.add(sym);
      chart.options.scales.y.min = panStartY[sym].min + yDelta;
      chart.options.scales.y.max = panStartY[sym].max + yDelta;
      chart.update('none');
    } else {
      chart.update('none');
    }
  });
  isSyncing = false;
}

function syncAllChartsYZoom(sourceChart, factor) {
  if (!syncXAxis || isSyncing || isUpdatingData) return;
  isSyncing = true;
  Object.entries(charts).forEach(([sym, chart]) => {
    if (chart === sourceChart) return;
    yOverrideSyms.add(sym);
    chart.zoom({ y: factor });
    snapYAfterZoom(chart, factor);
  });
  isSyncing = false;
}

function setupUI() {
  const root = document.getElementById('controls-root');
  const rangeHtml = TIME_RANGES.map(r => `<button class="range-btn ${r === activeRange ? 'active' : ''}" data-range="${r}">${r}</button>`).join('') + `<button class="range-btn ${activeRange === 'Custom' ? 'active' : ''}" data-range="Custom">Custom</button>`;
  const tips = Object.keys(AVAILABLE_SYMBOLS).filter(s => s.endsWith('TIPS')).sort((a,b) => MATURITY_ORDER[a] - MATURITY_ORDER[b]);
  const nominals = Object.keys(AVAILABLE_SYMBOLS).filter(s => !s.endsWith('TIPS')).sort((a,b) => MATURITY_ORDER[a] - MATURITY_ORDER[b]);
  const createGrid = (syms) => syms.map(sym => {
    const idx = Object.keys(AVAILABLE_SYMBOLS).indexOf(sym);
    const color = COLORS[idx % COLORS.length];
    // Always reserve the SA column (even empty) so TIPS/Treasury rows stay column-aligned
    // whether or not that row has an SA reading.
    return `<label class="sym-item-check" id="label-${sym}"><input type="checkbox" value="${sym}" ${activeSymbols.has(sym) ? 'checked' : ''}><span class="color-dot" style="background:${color}"></span><span class="sym-code">${SYMBOL_LABELS[sym] || sym}</span><span class="sym-yield" id="yield-${sym}">---</span><span class="sym-change" id="change-${sym}"></span><span class="sym-sa-yield" id="sa-yield-${sym}"></span></label>`;
  }).join('');

  root.innerHTML = `<style>.range-picker { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 20px; } .range-btn { flex: 1; min-width: 45px; padding: 6px 0; border: none; background: var(--tab-inactive-bg); border-radius: 4px; cursor: pointer; font-weight: 700; font-size: 13px; color: var(--tab-inactive-text); text-transform: uppercase; letter-spacing: 0.04em; transition: background 0.1s; } .range-btn:hover:not(.active) { background: var(--btn-hover-bg); } .range-btn.active { background: var(--tab-active-bg); color: var(--tab-inactive-text); border-top: 3px solid var(--tab-active-accent); } .sym-group h4 { display: flex; justify-content: space-between; align-items: center; margin: 12px 0 6px; font-size: 13px; text-transform: uppercase; color: #000; font-weight: 800; letter-spacing: 0.05em; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; } .clear-btn { font-size: 11px; color: #64748b; cursor: pointer; text-transform: none; font-weight: 600; } .sym-item-check { display: flex; align-items: center; gap: 4px; padding: 4px 0; font-size: 15px; cursor: pointer; color: #000; } .color-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; } .sym-code { font-weight: 600; color: #000; width: 62px; flex-shrink: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .sym-yield { font-family: monospace; font-weight: 700; font-size: 15px; color: #000; width: 54px; flex-shrink: 0; text-align: right; } .sym-change { font-family: monospace; font-weight: 700; font-size: 13px; width: 50px; flex-shrink: 0; text-align: right; } .sym-change.up { color: #16a34a; } .sym-change.down { color: #dc2626; } .sym-sa-yield { font-family: monospace; font-weight: 700; font-size: 12px; color: #f59e0b; width: 48px; flex-shrink: 0; text-align: right; } .yield-toggle-group { margin-top: 15px; font-size: 14px; font-weight: 700; color: #334155; background: #f8fafc; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; } .yield-toggle-title { margin-bottom: 4px; } .yield-toggle-option { display: flex; align-items: center; gap: 6px; padding: 2px 0; cursor: pointer; font-weight: 600; } #fetchStatus { font-size: 13px; color: #000; margin-top: 20px; font-weight: 700; display: grid; grid-template-columns: auto auto; column-gap: 4px; row-gap: 2px; } #fetchStatus .fs-label { text-align: right; } #fetchStatus .fs-val { text-align: left; } .no-data-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #000; background: rgba(255,255,255,0.9); pointer-events: none; z-index: 10; } .sync-zoom-label { display: flex; align-items: center; gap: 6px; margin-top: 15px; font-size: 14px; font-weight: 700; color: #334155; cursor: pointer; background: #f8fafc; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; } .custom-date-range { display: none; flex-direction: column; gap: 6px; padding: 10px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 4px; } .custom-date-label { font-size: 12px; font-weight: 800; color: #334155; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.04em; } .custom-date-inputs { display: flex; flex-direction: column; gap: 6px; } .custom-date-inputs label { font-size: 12px; font-weight: 700; color: #334155; display: flex; flex-direction: column; gap: 2px; } .custom-date-inputs .date-picker { width: 100%; font-size: 13px; } .custom-date-apply { margin-top: 4px; padding: 6px; background: var(--tab-active-bg); color: var(--tab-inactive-text); border: none; border-top: 3px solid var(--tab-active-accent); border-radius: 4px; font-size: 13px; font-weight: 700; cursor: pointer; width: 100%; } .custom-date-apply:hover { opacity: 0.85; }</style><div class="range-picker">${rangeHtml}</div><div class="custom-date-range" id="custom-date-range"><div class="custom-date-label">Custom Date Range</div><div class="custom-date-inputs"><label>Start Date<input type="date" id="customStart" class="date-picker"></label><label>End Date<input type="date" id="customEnd" class="date-picker"></label></div><button class="custom-date-apply" id="applyCustomRange">Apply</button></div><div class="sym-group"><h4>TIPS <span class="clear-btn" data-type="TIPS">Clear All</span></h4>${createGrid(tips)}<h4>Treasuries <span class="clear-btn" data-type="Nominal">Clear All</span></h4>${createGrid(nominals)}</div><label class="sync-zoom-label"><input type="checkbox" id="syncXAxis" ${syncXAxis ? 'checked' : ''}> Sync Zoom & Pan</label><label class="sync-zoom-label"><input type="checkbox" id="lockRight"> Lock Right</label><div class="yield-toggle-group"><div class="yield-toggle-title">Show TIPS yields:</div><label class="yield-toggle-option"><input type="checkbox" id="showQuotedYield" ${showQuotedYield ? 'checked' : ''}> Quoted</label><label class="yield-toggle-option"><input type="checkbox" id="showSaYield" ${showSaYield ? 'checked' : ''}> Seasonally Adjusted (SA)</label></div><div id="fetchStatus">Ready</div>`;

  document.getElementById('syncXAxis').addEventListener('change', (e) => {
    syncXAxis = e.target.checked;
    if (syncXAxis) {
      const first = Object.values(charts)[0];
      if (first) syncAllChartsX(first);
    }
  });
  document.getElementById('lockRight').addEventListener('change', (e) => { lockRight = e.target.checked; });
  document.getElementById('showQuotedYield').addEventListener('change', (e) => {
    if (!e.target.checked && !showSaYield) { e.target.checked = true; return; } // never let both go off
    showQuotedYield = e.target.checked;
    refreshQuotedOverlays(true);
    updateYieldCurves();
  });
  document.getElementById('showSaYield').addEventListener('change', async (e) => {
    if (!e.target.checked && !showQuotedYield) { e.target.checked = true; return; } // never let both go off
    showSaYield = e.target.checked;
    if (showSaYield) await ensureSaDataLoaded();
    refreshSaOverlays(true);
    updateYieldCurves();
  });

  document.querySelectorAll('.clear-btn').forEach(btn => btn.addEventListener('click', (e) => {
    const isTips = e.target.dataset.type === 'TIPS';
    Object.keys(AVAILABLE_SYMBOLS).forEach(sym => { if (isTips && sym.endsWith('TIPS')) activeSymbols.delete(sym); else if (!isTips && !sym.endsWith('TIPS')) activeSymbols.delete(sym); });
    document.querySelectorAll('.sym-item-check input').forEach(cb => cb.checked = activeSymbols.has(cb.value));
    syncChartContainers(); updateAllData();
  }));
  document.querySelectorAll('.range-btn').forEach(btn => btn.addEventListener('click', (e) => {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    activeRange = e.target.dataset.range;
    const cdr = document.getElementById('custom-date-range');
    if (activeRange === 'Custom') {
      cdr.style.display = 'flex';
      if (!customStartDate || !customEndDate) {
        const today = new Date().toISOString().slice(0, 10);
        const y1 = new Date(); y1.setFullYear(y1.getFullYear() - 1);
        const y1str = y1.toISOString().slice(0, 10);
        document.getElementById('customStart').value = y1str;
        document.getElementById('customEnd').value = today;
        customStartDate = dateInputToEtStart(y1str);
        customEndDate = dateInputToEtEnd(today);
      }
    } else {
      cdr.style.display = 'none';
    }
    updateAllData();
  }));
  document.getElementById('applyCustomRange').addEventListener('click', () => {
    const startVal = document.getElementById('customStart').value;
    const endVal = document.getElementById('customEnd').value;
    if (!startVal || !endVal) return;
    customStartDate = dateInputToEtStart(startVal);
    customEndDate = dateInputToEtEnd(endVal);
    if (activeRange === 'Custom') updateAllData();
  });
  document.querySelectorAll('.sym-item-check input').forEach(cb => cb.addEventListener('change', (e) => {
    if (e.target.checked) activeSymbols.add(e.target.value); else activeSymbols.delete(e.target.value);
    syncChartContainers(); updateAllData();
  }));
  document.getElementById('refreshAll').addEventListener('click', async () => {
    updateAllData(true);
    if (showSaYield) { tipsBondMeta = await fetchTipsBondMeta(true); refreshSaOverlays(); updateYieldCurves(); }
  });
  document.getElementById('resetAllZoom').addEventListener('click', () => { yOverrideSyms.clear(); isUpdatingData = true; Object.entries(charts).forEach(([sym, chart]) => applyDefaultBounds(sym, chart, rangeData[sym])); isUpdatingData = false; });
}

function syncChartContainers() {
  const tipsRow = document.getElementById('tips-row'), nominalsRow = document.getElementById('nominals-row');
  Object.keys(charts).forEach(sym => { if (!activeSymbols.has(sym)) { charts[sym].destroy(); delete charts[sym]; const card = document.getElementById(`card-${sym}`); if (card) card.remove(); } });
  activeSymbols.forEach(sym => {
    if (!charts[sym]) {
      const card = document.createElement('div'); card.className = 'chart-card'; card.id = `card-${sym}`;
      const groupLabel = sym.endsWith('TIPS') ? 'TIPS' : 'Treasury';
      card.innerHTML = `<div class="chart-header"><span class="chart-title">${SYMBOL_LABELS[sym] || sym} ${groupLabel} Yield</span></div><div class="chart-container"><canvas id="chart-${sym}"></canvas></div>`;
      (sym.endsWith('TIPS') ? tipsRow : nominalsRow).appendChild(card); createChartInstance(sym);
    }
  });
  const sortRow = (row, isTips) => {
    const syms = Array.from(activeSymbols).filter(s => isTips ? s.endsWith('TIPS') : !s.endsWith('TIPS')).sort((a,b) => MATURITY_ORDER[a] - MATURITY_ORDER[b]);
    syms.forEach(sym => { const card = document.getElementById(`card-${sym}`); if (card) row.appendChild(card); });
    row.parentElement.style.display = syms.length > 0 ? 'flex' : 'none';
  };
  sortRow(tipsRow, true); sortRow(nominalsRow, false);
  setTimeout(() => Object.values(charts).forEach(c => c.resize()), 0);
}

function createChartInstance(sym) {
  const ctx = document.getElementById(`chart-${sym}`).getContext('2d');
  const color = COLORS[Object.keys(AVAILABLE_SYMBOLS).indexOf(sym) % COLORS.length];
  const saDataset = SA_SYMBOLS.has(sym) ? [{ label: `${sym} SA`, data: [], borderColor: SA_COLOR, backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, fill: false, tension: 0.1 }] : [];
  charts[sym] = new Chart(ctx, {
    type: 'line',
    data: { datasets: [{ label: sym, data: [], borderColor: color, backgroundColor: color + '1A', borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, fill: false, tension: 0.1, segment: { borderColor: ctx => { if (activeRange !== '2D' && activeRange !== '10D') return color; const mid = (ctx.p0.parsed.x + ctx.p1.parsed.x) / 2; return (isAfterHoursEt(mid) || isWeekendEt(new Date(mid))) ? color + '55' : color; } } }, ...saDataset] },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'time', time: { tooltipFormat: 'MM/dd/yy HH:mm:ss', displayFormats: { hour: 'MM/dd HH:mm', day: 'MMM dd', month: 'MMM yyyy', year: 'yyyy' } }, grid: { color: '#f1f5f9' }, ticks: { autoSkip: true, font: { size: 9, weight: 'bold' }, color: '#000', callback(value, index, ticks) { const d = new Date(value); if (activeRange === '2D') { const p = ET_HM_FMT.formatToParts(d).reduce((a, pt) => ({...a, [pt.type]: pt.value}), {}); return `${p.month}/${p.day} ${p.hour}:${p.minute}`; } if (activeRange === '10D') return ET_TICK_DAY_FMT.format(d); if ((this.max - this.min) < 90 * 86400000) { const label = ET_TICK_DAY_FMT.format(d); if (index > 0 && ET_TICK_DAY_FMT.format(new Date(ticks[index - 1].value)) === label) return ''; return label; } const label = ET_TICK_MON_FMT.format(d); if (index > 0 && ET_TICK_MON_FMT.format(new Date(ticks[index - 1].value)) === label) return ''; return label; } } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 9, family: 'monospace', weight: 'bold' }, color: '#000', callback: v => v.toFixed(3) + '%' } }
      },
      plugins: { legend: { display: false }, zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy', onZoom: ({chart}) => { if (lockRight) applyLockRight(chart, xMaxAnchors[sym]); if (syncXAxis) syncAllChartsX(chart); }, onZoomComplete: ({chart}) => { if (lockRight) applyLockRight(chart, xMaxAnchors[sym]); if (activeRange !== '2D' && activeRange !== '10D') applyXTimeUnit(chart); rescaleYToVisible(chart, sym); if (syncXAxis) syncAllChartsX(chart); } }, pan: { enabled: true, mode: 'xy', onPanStart: ({chart}) => { Object.entries(charts).forEach(([s, c]) => { panStartY[s] = { min: c.scales.y.min, max: c.scales.y.max }; }); }, onPan: ({chart}) => { if (syncXAxis) syncAllCharts(chart); }, onPanComplete: ({chart}) => { if (activeRange !== '2D' && activeRange !== '10D') applyXTimeUnit(chart); rescaleYToVisible(chart, sym); if (syncXAxis) syncAllCharts(chart); Object.keys(panStartY).forEach(k => delete panStartY[k]); } } }, annotation: { annotations: {} }, tooltip: { backgroundColor: 'rgba(255, 255, 255, 0.95)', titleColor: '#64748b', titleFont: { size: 11, weight: 'bold' }, bodyColor: '#000', borderColor: '#cbd5e1', borderWidth: 1, padding: 8, bodyFont: { size: 12, weight: 'bold' }, cornerRadius: 6, displayColors: false, callbacks: { title: (items) => { if (!items.length) return ''; const date = new Date(items[0].parsed.x); return date.toLocaleString('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', month: '2-digit', day: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ET'; }, label: ctx => `${ctx.datasetIndex === 1 ? 'SA Yield' : 'Yield'}: ${ctx.parsed.y.toFixed(3)}%` } } }
    }
  });
  setupAxisWheelZoom(ctx.canvas, ({chart}) => {
    if (lockRight) applyLockRight(chart, xMaxAnchors[sym]);
    if (activeRange !== '2D' && activeRange !== '10D') applyXTimeUnit(chart);
    rescaleYToVisible(chart, sym);
    if (syncXAxis) syncAllChartsX(chart);
  }, ({chart, factor}) => { snapYAfterZoom(chart, factor); yOverrideSyms.add(sym); if (syncXAxis) syncAllChartsYZoom(chart, factor); });
  new ResizeObserver(() => { if (charts[sym]) charts[sym].resize(); }).observe(document.getElementById(`card-${sym}`));
}

function buildUrl(symbol, range) {
  const providerRange = TIME_RANGE_MAP[range] || range || '1D';
  const vars = { symbol, timeRange: providerRange };
  if (providerRange === '5D') vars.interval = "10";
  const params = { operationName: "getQuoteChartData", variables: JSON.stringify(vars), extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: "9e1670c29a10707c417a1efd327d4b2b1d456b77f1426e7e84fb7d399416bb6b" } }), _cb: Date.now() };
  return "https://webql-redesign.cnbcfm.com/graphql?" + Object.entries(params).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
}

function parseSourceTime(tt) {
  if (!tt) return null; const s = String(tt); if (s.length < 8) return null;
  const year = parseInt(s.substring(0, 4), 10), month = parseInt(s.substring(4, 6), 10) - 1, day = parseInt(s.substring(6, 8), 10);
  let hour = 0, minute = 0, second = 0; if (s.length >= 10) hour = parseInt(s.substring(8, 10), 10); if (s.length >= 12) minute = parseInt(s.substring(10, 12), 10); if (s.length >= 14) second = parseInt(s.substring(12, 14), 10);
  let d = new Date(Date.UTC(year, month, day, hour, minute, second));
  for (let i = 0; i < 2; i++) { const p = ET_FULL_FMT.formatToParts(d).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {}); const diff = Date.UTC(year, month, day, hour, minute, second) - Date.UTC(parseInt(p.year, 10), parseInt(p.month, 10) - 1, parseInt(p.day, 10), parseInt(p.hour, 10), parseInt(p.minute, 10), parseInt(p.second, 10)); if (diff === 0) break; d = new Date(d.getTime() + diff); }
  return d;
}

function getEtDateStr(date) {
  const ts = date instanceof Date ? date.getTime() : +date; if (ts >= lastDayCache.start && ts < lastDayCache.end) return lastDayCache.str;
  const parts = ET_YMD_FMT.formatToParts(date).reduce((a, pt) => ({ ...a, [pt.type]: pt.value }), {});
  const str = `${parts.month}/${parts.day}/${parts.year}`, y = +parts.year, m = +parts.month - 1, d = +parts.day;
  lastDayCache = { start: makeEtMoment(y, m, d, 0).getTime(), end: makeEtMoment(y, m, d + 1, 0).getTime(), str };
  return str;
}

function makeEtMoment(year, month0, day, hour) {
  let d = new Date(Date.UTC(year, month0, day, hour, 0, 0));
  for (let i = 0; i < 2; i++) { const p = ET_FULL_FMT.formatToParts(d).reduce((a, pt) => ({ ...a, [pt.type]: pt.value }), {}); const diff = Date.UTC(year, month0, day, hour, 0, 0) - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second); if (diff === 0) break; d = new Date(d.getTime() + diff); }
  return d;
}

function dateInputToEtStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return makeEtMoment(y, m - 1, d, 0);
}

function dateInputToEtEnd(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return makeEtMoment(y, m - 1, d + 1, 0); // exclusive: midnight of next day
}

function isAfterHoursEt(tsMs) { const parts = ET_FULL_FMT.formatToParts(new Date(tsMs)).reduce((a, p) => ({ ...a, [p.type]: +p.value }), {}); const mins = parts.hour * 60 + parts.minute; return mins < 8 * 60 || mins >= 17 * 60; }
function isWeekendEt(date) { return ET_WDAY_FMT.format(date).match(/Sat|Sun/); }

async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController(), id = setTimeout(() => controller.abort(), timeout);
  try { const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-cache' }); clearTimeout(id); return response; } catch (e) { clearTimeout(id); throw e; }
}

// Single consolidated, symbol-nested history file: { "US10Y": [{x,y}, ...], ... }
const R2_HISTORY_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/yields-history/history.json';

let allHistoryPromise = null;
async function fetchAllHistory() {
  if (!allHistoryPromise) {
    allHistoryPromise = (async () => {
      const response = await fetchWithTimeout(R2_HISTORY_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    })();
  }
  return allHistoryPromise;
}

async function fetchHistory(symbol) {
  if (!historyCache[symbol]) {
    historyCache[symbol] = (async () => {
      try {
        const all = await fetchAllHistory();
        return (all[symbol] || []).map(p => ({ x: parseSourceTime(p.x), y: p.y }));
      } catch (err) {
        console.error(`R2 history fetch failed for ${symbol}:`, err);
        delete historyCache[symbol];
        allHistoryPromise = null; // allow retry on next call
        return null;
      }
    })();
  }
  return await historyCache[symbol];
}

async function fetchRefCpiSaRows() {
  if (!refCpiSaPromise) {
    refCpiSaPromise = (async () => {
      try {
        const response = await fetchWithTimeout(REF_CPI_SA_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseCsv(await response.text());
      } catch (err) {
        console.error('RefCpiNsaSa fetch failed:', err);
        refCpiSaPromise = null; // allow retry
        return null;
      }
    })();
  }
  return refCpiSaPromise;
}

async function fetchSaHolidaySet() {
  if (!saHolidaySetPromise) {
    saHolidaySetPromise = (async () => {
      try {
        const response = await fetchWithTimeout(HOLIDAYS_CSV_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseHolidaySet(parseCsv(await response.text(), false));
      } catch (err) {
        console.error('Bond holidays fetch failed:', err);
        saHolidaySetPromise = null; // allow retry
        return new Set();
      }
    })();
  }
  return saHolidaySetPromise;
}

// CNBC's own quote page for each SA-eligible symbol identifies the real, specific TIPS
// it quotes (e.g. US2YTIPS = the Jan 2028 0.50% TIPS) via this REST endpoint, which
// returns maturity_date + coupon alongside the price/yield fields already used elsewhere.
async function fetchTipsBondMeta(force = false) {
  if (!tipsBondMetaPromise || force) {
    tipsBondMetaPromise = (async () => {
      try {
        const syms = Array.from(SA_SYMBOLS);
        const url = `${CNBC_QUOTE_URL}?symbols=${syms.join('%7C')}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`;
        const response = await fetchWithTimeout(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        const quotes = json?.FormattedQuoteResult?.FormattedQuote || [];
        const meta = {};
        quotes.forEach(q => {
          if (!q.symbol || !q.maturity_date || !q.coupon) return;
          meta[q.symbol] = { maturity: localDate(q.maturity_date), coupon: parseFloat(q.coupon) / 100 };
        });
        return meta;
      } catch (err) {
        console.error('CNBC TIPS bond metadata fetch failed:', err);
        tipsBondMetaPromise = null; // allow retry
        return null;
      }
    })();
  }
  return tipsBondMetaPromise;
}

// TipsRef.csv: { cusip, maturity, datedDate, coupon, baseCpi, term } for every TIPS ever
// auctioned — used to reconstruct which bond was actually behind a symbol on a past date.
async function fetchTipsRefRows() {
  if (!tipsRefPromise) {
    tipsRefPromise = (async () => {
      try {
        const response = await fetchWithTimeout(TIPS_REF_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseCsv(await response.text());
      } catch (err) {
        console.error('TipsRef fetch failed:', err);
        tipsRefPromise = null; // allow retry
        return null;
      }
    })();
  }
  return tipsRefPromise;
}

// Lazily fetches every prerequisite the SA overlay needs, skipping anything already cached.
// Shared by the "Show SA" checkbox handler and initial page load (SA is on by default).
async function ensureSaDataLoaded() {
  if (!refCpiSaRows) refCpiSaRows = await fetchRefCpiSaRows();
  if (!tipsBondMeta) tipsBondMeta = await fetchTipsBondMeta();
  if (!tipsRefRows) tipsRefRows = await fetchTipsRefRows();
  if (saHolidaySet.size === 0) saHolidaySet = await fetchSaHolidaySet();
}

// Resolves the TIPS bond (maturity + coupon) actually behind `sym` on tradeDate, per the
// observed rollover history in SA_ROLLOVER_LOG above. Returns null (a gap, not a guess)
// when tradeDate predates the earliest entry we've cross-checked, or TipsRef.csv doesn't
// have a matching maturity.
function resolveTipsBond(tradeDate, sym, refRows) {
  const log = SA_ROLLOVER_LOG[sym];
  if (!log || !refRows) return null;
  const tradeDateStr = toIsoDate(tradeDate);
  let entry = null;
  for (const e of log) { if (e.from <= tradeDateStr) entry = e; else break; }
  if (!entry) return null;
  const candidates = refRows.filter(r => r.maturity === entry.maturity);
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.datedDate < b.datedDate ? 1 : -1)); // most recently dated first
  const chosen = candidates[0];
  return { maturity: localDate(chosen.maturity), coupon: parseFloat(chosen.coupon) };
}

// Seasonally-adjusted yield for a single quote, using the real bond's coupon/maturity
// (bondMeta, from fetchTipsBondMeta). tradeDateStr is "MM/DD/YYYY" (getEtDateStr format);
// settlement is T+1 bond trading day from the trade date (see knowledge/DATA_DICTIONARY.md
// #settlement-date). Returns null if any required input isn't available yet.
function saYieldForQuote(yieldPct, tradeDateStr, bondMeta, holidaySet, saRows) {
  if (!saRows || !bondMeta) return null;
  const [mm, dd, yyyy] = tradeDateStr.split('/').map(Number);
  const tradeDate = new Date(yyyy, mm - 1, dd);
  const settle = nextBusinessDay(tradeDate, holidaySet);
  const mature = bondMeta.maturity;
  if (!mature || settle >= mature) return null;
  const saSettle = saFactorForDate(saRows, toIsoDate(settle));
  const saMature = saFactorForDate(saRows, toIsoDate(mature));
  if (saSettle == null || saMature == null || isNaN(saSettle) || isNaN(saMature)) return null;
  const yld = yieldPct / 100;
  const price = priceFromYield(yld, bondMeta.coupon, settle, mature);
  if (price == null) return null;
  const saPrice = price * (saSettle / saMature);
  const saYield = yieldFromPrice(saPrice, bondMeta.coupon, settle, mature);
  return saYield == null ? null : saYield * 100;
}

// Bond identity per point: today's point uses CNBC's live-fetched bond (empirically
// confirmed); every other point resolves the bond that was actually in effect on that
// trade date via TipsRef.csv + the observed rollover log (see SA_ROLLOVER_LOG above). Cached
// per unique trade date since many intraday points share the same date.
function computeSaSeries(sym, data) {
  const liveMeta = tipsBondMeta && tipsBondMeta[sym];
  if (!SA_SYMBOLS.has(sym) || !data || !refCpiSaRows || (!liveMeta && !tipsRefRows)) return [];
  const todayStr = getEtDateStr(new Date());
  const metaByDate = new Map();
  return data.map(p => {
    const tradeDateStr = getEtDateStr(p.x);
    let bondMeta = metaByDate.get(tradeDateStr);
    if (bondMeta === undefined) {
      if (tradeDateStr === todayStr && liveMeta) {
        bondMeta = liveMeta;
      } else {
        const [mm, dd, yyyy] = tradeDateStr.split('/').map(Number);
        bondMeta = resolveTipsBond(new Date(yyyy, mm - 1, dd), sym, tipsRefRows);
      }
      metaByDate.set(tradeDateStr, bondMeta);
    }
    const saY = saYieldForQuote(p.y, tradeDateStr, bondMeta, saHolidaySet, refCpiSaRows);
    return saY == null ? null : { x: p.x, y: saY };
  }).filter(Boolean);
}

// Refreshes the SA overlay line + sidebar reading on every SA-eligible chart from the
// currently loaded rangeData. Called after data updates and on toggle change. forceRescale
// bypasses yOverrideSyms (a prior manual Y-zoom) — used when the toggle itself changes what's
// displayed, per the "checkbox that changes displayed data always auto-fits Y" convention.
function refreshSaOverlays(forceRescale = false) {
  SA_SYMBOLS.forEach(sym => {
    const chart = charts[sym];
    if (chart && chart.data.datasets[1]) {
      chart.data.datasets[1].data = showSaYield ? computeSaSeries(sym, rangeData[sym]) : [];
      if (forceRescale || !yOverrideSyms.has(sym)) rescaleYToVisible(chart, sym);
      else chart.update('none');
    }
    const el = document.getElementById(`sa-yield-${sym}`);
    if (!el) return;
    const data = rangeData[sym];
    const latest = data && data.length ? data[data.length - 1] : null;
    const bondMeta = tipsBondMeta && tipsBondMeta[sym];
    const saY = (showSaYield && latest) ? saYieldForQuote(latest.y, getEtDateStr(latest.x), bondMeta, saHolidaySet, refCpiSaRows) : null;
    el.textContent = saY == null ? '' : `${saY.toFixed(3)}%`;
  });
}

// Refreshes the raw (quoted) line on every SA-eligible (TIPS) chart per the "Show TIPS
// yields: Quoted" toggle. Nominal Treasury charts have no SA counterpart and are never
// gated by this — their raw line is always shown, set directly in updateCharts.
function refreshQuotedOverlays(forceRescale = false) {
  SA_SYMBOLS.forEach(sym => {
    const chart = charts[sym];
    if (!chart || !chart.data.datasets[0]) return;
    chart.data.datasets[0].data = showQuotedYield ? (rangeData[sym] || []) : [];
    if (forceRescale || !yOverrideSyms.has(sym)) rescaleYToVisible(chart, sym);
    else chart.update('none');
  });
}

// ET midnight, `adjust`ed from today's ET calendar date (e.g. N years/days back) — DST-aware
// via makeEtMoment. A plain `new Date(); setHours(0,0,0,0)` anchors to the BROWSER's local
// midnight instead, which is wrong here: feed timestamps are ET wall-clock (some stamped
// 00:00 ET, some 15:00 ET), and a browser west of Eastern (Mountain, Pacific) has its own
// local midnight fall AFTER ET midnight of the same calendar day — excluding that ET day's
// 00:00-stamped point and landing the cutoff one day late.
function etCutoff(adjust) {
  const [m, d, y] = getEtDateStr(new Date()).split('/').map(Number);
  const t = new Date(y, m - 1, d);
  adjust(t);
  return makeEtMoment(t.getFullYear(), t.getMonth(), t.getDate(), 0);
}

async function fetchOne(symbol, range, force = false) {
  if (range === 'Custom') {
    const history = await fetchHistory(symbol);
    const startMs = customStartDate ? customStartDate.getTime() : 0;
    const endMs = customEndDate ? customEndDate.getTime() : Date.now();
    let combined = (history || []).filter(p => p.x.getTime() >= startMs && p.x.getTime() < endMs && !isWeekendEt(p.x));
    if (endMs > Date.now() - 5 * 86400000) {
      const tipKey = `${symbol}_5D`;
      let liveTip = liveCache[tipKey];
      if (!liveTip || force) {
        console.log(`%c[CNBC] %cFetching 5D tip for ${symbol}...`, "color: #2563eb; font-weight: bold", "color: inherit");
        liveTip = await fetchLive(symbol, '5D');
        if (liveTip) liveCache[tipKey] = liveTip;
      }
      if (liveTip) {
        const lastHistTime = combined.length > 0 ? combined[combined.length - 1].x.getTime() : 0;
        // Live points must respect the chosen start date too — not just the last stored
        // history point. Without the startMs floor, a symbol whose history has no point
        // inside the window (e.g. the sparse US5YTIPS) would let pre-start live bars leak in.
        const newPoints = liveTip.filter(p => p.x.getTime() > lastHistTime && p.x.getTime() >= startMs && p.x.getTime() < endMs && !isWeekendEt(p.x));
        combined = [...combined, ...newPoints];
      }
    }
    return combined;
  }
  const is2D = range === '2D', is10D = range === '10D';
  if (is2D || is10D) {
    const providerRange = is2D ? '1D' : '5D', cacheKey = `${symbol}_${providerRange}`;
    const tipKey = `${symbol}_5D`;
    const fetchTasks = [];
    if (!force && liveCache[cacheKey]) {
      // Use cache
    } else {
      console.log(`%c[CNBC] %cFetching ${providerRange} for ${symbol}`, "color: #2563eb; font-weight: bold", "color: inherit");
      // Only cache a non-empty result — a transient CNBC hiccup that returns 0 bars
      // would otherwise get stuck cached for the rest of the session (every later
      // range switch reads the same empty cache entry instead of retrying).
      fetchTasks.push(fetchLive(symbol, providerRange).then(live => { if (live && live.length > 0) liveCache[cacheKey] = live; }));
    }
    if (is2D && (force || !liveCache[tipKey])) {
      console.log(`%c[CNBC] %cFetching 5D tip for metrics: ${symbol}`, "color: #2563eb; font-weight: bold", "color: inherit");
      fetchTasks.push(fetchLive(symbol, '5D').then(live => { if (live && live.length > 0) liveCache[tipKey] = live; }));
    }
    if (fetchTasks.length > 0) await Promise.all(fetchTasks);
    const data = liveCache[cacheKey] || [];
    const cutoff = etCutoff(t => t.setDate(t.getDate() - (is2D ? 2 : 10)));
    return data.filter(p => p.x >= cutoff && !isWeekendEt(p.x));
  } else {
    const cutoff = etCutoff(t => {
      if (range === '1Y') t.setFullYear(t.getFullYear() - 1); else if (range === '2Y') t.setFullYear(t.getFullYear() - 2); else if (range === '3Y') t.setFullYear(t.getFullYear() - 3); else if (range === '10Y') t.setFullYear(t.getFullYear() - 10); else if (range === 'ALL') t.setFullYear(t.getFullYear() - 50);
    });
    if (range === '1Y' || range === '2Y' || range === '3Y') {
      // Reread provider 6M (daily ~3Y) fresh each load — same feed cnbc.com uses; no history.json, no 5D tip.
      // CNBC's 6M timeRange is unreliable per-symbol: it returns a fully-null payload (not an
      // empty array) for some symbols regardless of retry (observed 2026-08-20: US2YTIPS and
      // US10YTIPS, consistently, while every other symbol's 6M feed works). Since the shorter
      // tiers return the same daily-resolution data just shallower (3M ~2yr, 1M ~1yr — not
      // literally "3 months"/"1 month" despite the name), fall back through them rather than
      // showing no data at all for an affected symbol. The cache is keyed per-symbol (not per-
      // range), so it must be depth-checked against the current cutoff on every use — otherwise
      // a shallow fallback cached while on 1Y/2Y silently starves 3Y of its extra year forever.
      const cacheKey = `${symbol}_6Mdaily`;
      let daily = liveCache[cacheKey];
      // A prior call may have cached a shallow fallback (3M/1M) because 6M failed at the time.
      // That cache is valid for a shorter range but not for a longer one needing more look-back
      // (e.g. cached via 3M's ~2yr reach, then the user switches to 3Y) — reusing it as-is would
      // silently truncate history instead of showing the requested range. Retry the deeper tiers
      // whenever the cached data doesn't already reach back past the current cutoff.
      const needsDeeper = !daily || daily.length === 0 || daily[0].x > cutoff;
      if (needsDeeper || force) {
        console.log(`%c[CNBC] %cFetching 6M daily for ${symbol}...`, "color: #2563eb; font-weight: bold", "color: inherit");
        let fresh = await fetchLive(symbol, '6M');
        if (!fresh || fresh.length === 0) fresh = await fetchLive(symbol, '3M');
        if (!fresh || fresh.length === 0) fresh = await fetchLive(symbol, '1M');
        // Only replace the cache with a result that's at least as deep as what's already there —
        // never let a shallower retry regress an already-cached deeper series.
        if (fresh && fresh.length > 0 && (!daily || daily.length === 0 || fresh[0].x <= daily[0].x)) {
          daily = fresh;
          liveCache[cacheKey] = fresh;
        }
      }
      const livePortion = (daily || []).filter(p => p.x >= cutoff && !isWeekendEt(p.x));
      // CNBC's daily tiers can be non-empty overall yet still miss the most recent day
      // specifically (observed 2026-08-22: US5YTIPS's 6M tier had bars through 2025-08-13,
      // then jumped straight to today, skipping 8/21 entirely — while its own 3M tier did
      // have 8/21). The waterfall above only retries a shallower tier when the deeper one
      // comes back completely empty, not when it's merely missing its tail, so it wouldn't
      // have caught this. Appending the latest live 5D point directly — same "baseline +
      // live tip" pattern used for Custom range and 10Y/ALL — sidesteps needing to detect
      // that tier-by-tier and keeps the latest available point consistent across every range.
      const tipKey = `${symbol}_5D`;
      let liveTip = liveCache[tipKey];
      if (!liveTip || force) {
        liveTip = await fetchLive(symbol, '5D');
        if (liveTip) liveCache[tipKey] = liveTip;
      }
      let withTip = livePortion;
      if (liveTip) {
        const lastTime = livePortion.length > 0 ? livePortion[livePortion.length - 1].x.getTime() : 0;
        const newPoints = liveTip.filter(p => p.x.getTime() > lastTime && p.x >= cutoff && !isWeekendEt(p.x));
        withTip = livePortion.concat(newPoints);
      }
      // Even after all three CNBC tiers, a symbol-specific outage can leave `daily` capped
      // well short of the requested range (e.g. 6M down, 3M's ~2yr reach doesn't cover 3Y).
      // Fill the gap older than CNBC's earliest bar from the same R2 history store the
      // 10Y/ALL branch below uses — reliable, but weekly/quarterly resolution, so the line
      // goes coarser before that point rather than showing a truncated range.
      if (!daily || daily.length === 0 || daily[0].x > cutoff) {
        const dailyFloor = daily && daily.length ? daily[0].x.getTime() : Infinity;
        const history = await fetchHistory(symbol);
        const historyPortion = (history || []).filter(p => p.x >= cutoff && p.x.getTime() < dailyFloor);
        return historyPortion.concat(withTip);
      }
      return withTip;
    } else {
      // 10Y, ALL: history.json (accumulated daily-resolution store; coarser CNBC feeds supplemented by past daily captures)
      // plus the latest live points appended from CNBC's 5D feed — same "baseline + live tip"
      // pattern as Custom range. The once-daily R2 baseline (refreshed by updateYieldsHistory.js
      // at 17:00 ET weekdays) can lag behind what other ranges already show live — if that
      // scheduled job hasn't run yet today, or failed for a symbol, the baseline's last point
      // can be a day or more stale even though 1Y/2Y/3Y/2D/10D already have it. Appending here
      // means the latest available point is consistent across every range rather than only
      // some of them; a genuinely long-stale symbol still shows a real gap between its last
      // baseline point and the live tip's own ~5-day reach, rather than a fabricated bridge.
      console.log(`%c[R2] %cLoading history for ${symbol}...`, "color: #ea580c; font-weight: bold", "color: inherit");
      const history = await fetchHistory(symbol);
      const base = (history || []).filter(p => p.x >= cutoff);
      const tipKey = `${symbol}_5D`;
      let liveTip = liveCache[tipKey];
      if (!liveTip || force) {
        liveTip = await fetchLive(symbol, '5D');
        if (liveTip) liveCache[tipKey] = liveTip;
      }
      if (liveTip) {
        const lastBaseTime = base.length > 0 ? base[base.length - 1].x.getTime() : 0;
        const newPoints = liveTip.filter(p => p.x.getTime() > lastBaseTime && p.x >= cutoff && !isWeekendEt(p.x));
        return base.concat(newPoints);
      }
      return base;
    }
  }
}

async function fetchLive(symbol, range) {
  try {
    const response = await fetchWithTimeout(buildUrl(symbol, range));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const priceBars = json?.data?.chartData?.priceBars || [];
    const parsed = priceBars.map(bar => { let v = bar.close; if (typeof v === "string" && v.endsWith("%")) v = v.slice(0, -1); return { x: parseSourceTime(bar.tradeTime), y: parseFloat(v) }; });
    // isNaN(p.x) coerces the Date via valueOf — catches an Invalid Date (e.g. a broken
    // Intl/timezone environment feeding parseSourceTime a value it can't converge on),
    // which a bare `p.x` truthiness check misses since a Date object is always truthy
    // even when its internal time value is NaN.
    const valid = parsed.filter(p => p.x && !isNaN(p.x) && !isNaN(p.y));
    if (valid.length < parsed.length) console.warn(`${symbol} ${range}: dropped ${parsed.length - valid.length} bar(s) with an invalid date — check Intl/timezone support in this browser environment`);
    return valid;
  } catch (err) {
    console.warn(`Live fetch failed for ${symbol}:`, err);
    return null;
  }
}

function snapXMax(date) {
  const d = new Date(date);
  if (activeRange === '2D') { d.setTime(d.getTime() + 15 * 60 * 1000); }
  else if (activeRange === '10D') { d.setTime(d.getTime() + 15 * 60 * 1000); }
  else { d.setDate(d.getDate() + 3); }
  return d;
}

function applyDefaultBounds(sym, chart, data) {
  if (!data || data.length === 0) {
    if (activeRange === 'Custom' && customStartDate && customEndDate) {
      chart.options.scales.x.min = customStartDate.getTime();
      chart.options.scales.x.max = customEndDate.getTime();
      chart.update('none');
    }
    return;
  }
  if (activeRange === '2D') {
    const lastDayStr = getEtDateStr(data[data.length-1].x), dayP = data.filter(p => getEtDateStr(p.x) === lastDayStr);
    if (dayP.length > 0) {
      const dayStart = dayP[0].x.getTime(); let prevDayP = [];
      for (let i = data.length-1; i >= 0; i--) { if (getEtDateStr(data[i].x) !== lastDayStr) { prevDayP = data.filter(p => getEtDateStr(p.x) === getEtDateStr(data[i].x)); break; } }
      if (prevDayP.length > 0) { if (dayStart - prevDayP[prevDayP.length-1].x.getTime() > 24*3600*1000) chart.options.scales.x.min = dayStart - 3600*1000; else chart.options.scales.x.min = prevDayP[0].x.getTime(); }
      else chart.options.scales.x.min = dayStart - 3600*1000;
    }
  } else if (activeRange === '10D') {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 10);
    chart.options.scales.x.min = cutoff.getTime();
  } else {
    chart.options.scales.x.min = (activeRange === 'Custom' && customStartDate) ? customStartDate.getTime() : data[0].x.getTime();
  }
  chart.options.scales.x.max = xMaxAnchors[sym] ?? snapXMax(data[data.length-1].x).getTime();
  if (activeRange !== '2D' && activeRange !== '10D') {
    // Use data bounds directly — chart.scales.x.min may be uninitialized on first load
    chart.options.scales.x.time.unit = getXTimeUnit(chart.options.scales.x.max - data[0].x.getTime());
  }
  chart.update('none');
  rescaleYToVisible(chart, sym);
}

function rescaleYToVisible(chart, sym) {
  const raw = rangeData[sym]; if (!raw || raw.length === 0) return;
  const xMin = chart.options.scales.x.min ?? chart.scales.x.min, xMax = chart.options.scales.x.max ?? chart.scales.x.max;
  // Bounds are fit only to whichever line(s) are actually shown — the "Show TIPS yields"
  // toggles (Quoted/SA) hide a line's chart.data but rangeData[sym] always has the raw
  // series, so gate it here too or the Y-axis would still fit hidden quoted data.
  const data = (SA_SYMBOLS.has(sym) && !showQuotedYield) ? [] : raw;
  const saData = (showSaYield && chart.data.datasets[1]) ? chart.data.datasets[1].data : [];
  const allPoints = data.concat(saData);
  const visible = allPoints.filter(p => { const t = +p.x; return t >= xMin && t <= xMax; }); if (visible.length === 0) return;
  const bounds = snapYBounds(Math.min(...visible.map(p=>p.y)), Math.max(...visible.map(p=>p.y)));
  chart.options.scales.y.min = bounds.min; chart.options.scales.y.max = bounds.max; chart.options.scales.y.ticks.stepSize = bounds.step; chart.update('none');
}

function updateDynamicTicks(chart, data) {
  if (!data || data.length === 0) return;
  const bounds = snapYBounds(Math.min(...data.map(p=>p.y)), Math.max(...data.map(p=>p.y)));
  chart.options.scales.y.min = bounds.min; chart.options.scales.y.max = bounds.max; chart.options.scales.y.ticks.stepSize = bounds.step;
  if (activeRange === '2D' || activeRange === '10D') {
    const annotations = {}, nowTs = Date.now(), [fm, fd, fy] = getEtDateStr(data[0].x).split('/').map(Number);
    let current = makeEtMoment(fy, fm - 1, fd, 0), dayIdx = 0, AH_BG = 'rgba(148, 163, 184, 0.13)';
    while (current.getTime() <= nowTs) {
      const etStr = getEtDateStr(current), [m, d, y] = etStr.split('/').map(Number), mid = makeEtMoment(y, m - 1, d, 0), am8 = makeEtMoment(y, m - 1, d, 8), pm5 = makeEtMoment(y, m - 1, d, 17), next = makeEtMoment(y, m - 1, d + 1, 0);
      if (isWeekendEt(current)) { annotations[`weekend-${dayIdx}`] = { type: 'box', xMin: mid, xMax: next, backgroundColor: AH_BG, borderWidth: 0, drawTime: 'beforeDatasetsDraw' }; }
      else { annotations[`pre-${dayIdx}`] = { type: 'box', xMin: mid, xMax: am8, backgroundColor: AH_BG, borderWidth: 0, drawTime: 'beforeDatasetsDraw' }; annotations[`aft-${dayIdx}`] = { type: 'box', xMin: pm5, xMax: next, backgroundColor: AH_BG, borderWidth: 0, drawTime: 'beforeDatasetsDraw' }; const dayD = data.filter(p => getEtDateStr(p.x) === etStr); if (dayD.length > 0) { const dMin = dayD[0].x, dMax = dayD[dayD.length-1].x; if (am8 >= dMin && am8 <= dMax) annotations[`am8-${dayIdx}`] = { type: 'line', xMin: am8, xMax: am8, borderColor: 'rgba(15,23,42,0.4)', borderWidth: 1.5, borderDash: [4,4] }; if (pm5 >= dMin && pm5 <= dMax) annotations[`pm5-${dayIdx}`] = { type: 'line', xMin: pm5, xMax: pm5, borderColor: 'rgba(15,23,42,0.4)', borderWidth: 1.5, borderDash: [4,4] }; } }
      current = next; dayIdx++;
    }
    chart.options.plugins.annotation.annotations = annotations;
  } else { chart.options.plugins.annotation.annotations = {}; }
}

async function fetchAllData(force = false) {
  const statusEl = document.getElementById('fetchStatus');
  statusEl.textContent = `Updating...`;
  const allSyms = Object.keys(AVAILABLE_SYMBOLS);
  const tsList = [];

  const [, quoteTime] = await Promise.all([
    Promise.all(allSyms.map(async sym => {
      const data = await fetchOne(sym, activeRange, force);
      rangeData[sym] = data;
      if (data && data.length > 0) {
        tsList.push(data[data.length - 1].x);
      }
    })),
    fetchLatestQuoteTime('US10YTIPS')
  ]);

  // The chart-bar feed's own per-bar tradeTime can lag real time by hours (a CNBC feed
  // quirk, not ours — see knowledge/1.0_Operation.md). The quote-service last_time field
  // doesn't have that problem, so it's authoritative for this label when available;
  // fall back to the chart feed's own last-bar time only if the quote fetch fails.
  latestDataTime = quoteTime || (tsList.length > 0 ? new Date(Math.max(...tsList.map(d => d.getTime()))) : null);
  updateStatusMessage();
}

async function fetchLatestQuoteTime(symbol) {
  try {
    const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${symbol}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const lastTime = json?.FormattedQuoteResult?.FormattedQuote?.[0]?.last_time;
    const t = lastTime ? new Date(lastTime) : null;
    return t && !isNaN(t) ? t : null;
  } catch (err) {
    console.warn(`Quote time fetch failed for ${symbol}:`, err);
    return null;
  }
}

function updateStatusMessage() {
  const statusEl = document.getElementById('fetchStatus');
  const fmt = d => d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' ET';
  let statusHtml = `<span class="fs-label">Latest data:</span><span class="fs-val">${latestDataTime ? fmt(latestDataTime) : 'No data'}</span>`;
  statusEl.innerHTML = statusHtml;
}

function updateCharts() {
  yOverrideSyms.clear();
  isUpdatingData = true;

  Object.keys(charts).forEach(sym => {
    const data = rangeData[sym], chart = charts[sym], card = document.getElementById(`card-${sym}`);
    if (!data || data.length === 0) {
      if (chart) { chart.data.datasets[0].data = []; chart.update(); }
      if (card && !card.querySelector('.no-data-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'no-data-overlay';
        overlay.textContent = 'No data available for this range';
        card.querySelector('.chart-container').appendChild(overlay);
      }
      return;
    }

    if (card) { const ov = card.querySelector('.no-data-overlay'); if (ov) ov.remove(); }

    if (chart) {
      chart.data.datasets[0].data = (SA_SYMBOLS.has(sym) && !showQuotedYield) ? [] : data;
      if (activeRange === '2D') {
        chart.options.scales.x.time.unit = 'hour';
        chart.options.scales.x.time.tooltipFormat = 'MM/dd/yy HH:mm:ss';
        chart.options.scales.x.time.displayFormats = { hour: 'MM/dd HH:mm', minute: 'HH:mm:ss', day: 'MMM dd' };
      } else if (activeRange === '10D') {
        chart.options.scales.x.time.unit = 'day';
        chart.options.scales.x.time.tooltipFormat = 'MM/dd/yy HH:mm:ss';
        chart.options.scales.x.time.displayFormats = { day: 'MMM dd' };
      } else {
        chart.options.scales.x.time.unit = undefined;
        chart.options.scales.x.time.tooltipFormat = 'MM/dd/yy';
        chart.options.scales.x.time.displayFormats = { month: 'MMM yyyy', year: 'yyyy' };
      }
      updateDynamicTicks(chart, data);
      chart.resetZoom();
      xMaxAnchors[sym] = (activeRange === 'Custom' && customEndDate) ? customEndDate.getTime() : snapXMax(data[data.length - 1].x).getTime();
      applyDefaultBounds(sym, chart, data);
    }

  });

  Object.keys(AVAILABLE_SYMBOLS).forEach(sym => {
    const data = rangeData[sym];
    if (!data || data.length === 0) return;
    const calculationData = (liveCache[`${sym}_5D`] || liveCache[`${sym}_1D`] || data), latest = calculationData[calculationData.length - 1];
    let closeP = null;
    const latestDayET = getEtDateStr(latest.x);
    for (let i = calculationData.length - 1; i >= 0; i--) {
      const p = calculationData[i], etStr = getEtDateStr(p.x);
      if (etStr !== latestDayET) {
        const pts = ET_FULL_FMT.formatToParts(p.x).reduce((a, pt) => ({ ...a, [pt.type]: pt.value }), {}), ph = +pts.hour;
        if (ph < 17 || (ph === 17 && +pts.minute === 0)) { closeP = p; break; }
      }
    }
    const changeEl = document.getElementById(`change-${sym}`), yieldEl = document.getElementById(`yield-${sym}`);
    if (yieldEl) yieldEl.textContent = `${latest.y.toFixed(3)}%`;
    if (changeEl) {
      if (closeP) {
        const diff = latest.y - closeP.y;
        changeEl.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(3)}%`;
        changeEl.className = `sym-change ${diff >= 0 ? 'up' : 'down'}`;
        changeEl.title = `Since ${ET_HM_FMT.format(closeP.x)} ET close (${closeP.y.toFixed(3)}%)`;
      } else {
        changeEl.textContent = '---';
      }
    }
  });

  if (activeTab === 'yieldcurves' || activeTab === 'breakeven') updateYieldCurves();
  refreshSaOverlays();
  isUpdatingData = false;
}

async function updateAllData(force = false) {
  await fetchAllData(force);
  updateCharts();
}

const TIPS_SYMBOLS = Object.keys(AVAILABLE_SYMBOLS).filter(s => s.endsWith('TIPS')).sort((a, b) => MATURITY_ORDER[a] - MATURITY_ORDER[b]);
const NOMINAL_SYMBOLS = Object.keys(AVAILABLE_SYMBOLS).filter(s => !s.endsWith('TIPS')).sort((a, b) => MATURITY_ORDER[a] - MATURITY_ORDER[b]);
const BEI_PAIRS = [
  { n: 'US1Y', t: 'US1YTIPS', label: '1Y' },
  { n: 'US2Y', t: 'US2YTIPS', label: '2Y' },
  { n: 'US5Y', t: 'US5YTIPS', label: '5Y' },
  { n: 'US10Y', t: 'US10YTIPS', label: '10Y' },
  { n: 'US30Y', t: 'US30YTIPS', label: '30Y' }
];

function adjustFirstPointToClosingTime(firstPoint) {
  const parts = ET_FULL_FMT.formatToParts(firstPoint).reduce((a, pt) => ({ ...a, [pt.type]: pt.value }), {});
  const y = +parts.year, m = +parts.month - 1, d = +parts.day;
  const hour = +parts.hour, minute = +parts.minute;
  if (hour === 0 && minute === 0) {
    return makeEtMoment(y, m, d, 17);
  }
  return firstPoint;
}

// Read one maturity's yield on a specific ET calendar date, from an arbitrary {x,y} series.
// pickLast=false returns that day's first print (the close, for a historical day); pickLast=true
// returns the last print (the latest reading on the end day). Returns null when the series has
// no print that day, so the curve shows a gap rather than borrowing a value from another date.
function valueFromSeriesOnDate(data, dateStr, pickLast) {
  if (!data || !data.length || !dateStr) return null;
  const pts = data.filter(p => getEtDateStr(p.x) === dateStr);
  if (!pts.length) return null;
  return (pickLast ? pts[pts.length - 1] : pts[0]).y;
}

function valueOnDate(sym, dateStr, pickLast) {
  return valueFromSeriesOnDate(rangeData[sym], dateStr, pickLast);
}

function updateYieldCurves() {
  // The displayed Start/End dates are decided once, from the 10Y TIPS — the one reliable
  // feed. The 5Y TIPS feed is too sparse to drive dates (see knowledge/1.0_Operation.md).
  // Start = the chosen start date (or, for preset ranges, the first 10Y-TIPS trading day in
  // range); End = the chosen end date. fetchOne already clamps the 10Y-TIPS series to the
  // active window, so its first/last points ARE those dates (and snap past non-trading days).
  // Every maturity on every curve is then read on those exact dates; a maturity with no print
  // that day is left as a gap.
  // Falls back through this priority list if the primary anchor has no data for the active
  // range (CNBC's per-symbol feed reliability can vary by range — see fetchOne's 1Y/2Y/3Y
  // fallback comment — and a single missing anchor symbol previously blanked every curve,
  // TIPS and Nominal alike, rather than just the anchor's own line).
  const ANCHOR_PRIORITY = ['US10YTIPS', 'US1YTIPS', 'US30YTIPS', 'US2YTIPS'];
  const anchorSym = ANCHOR_PRIORITY.find(s => rangeData[s] && rangeData[s].length) || 'US10YTIPS';
  const refData = rangeData[anchorSym];
  const refStart = refData && refData.length ? refData[0] : null;
  const refEnd = refData && refData.length ? refData[refData.length - 1] : null;
  const startDateStr = refStart ? getEtDateStr(refStart.x) : null;
  const endDateStr = refEnd ? getEtDateStr(refEnd.x) : null;
  const sT = refStart ? adjustFirstPointToClosingTime(refStart.x) : null, eT = refEnd ? refEnd.x : null;
  const sL = sT ? ET_HM_FMT.format(sT) + ' ET' : '—', eL = eT ? ET_HM_FMT.format(eT) + ' ET' : '—';

  // SA overlay data, per SA-eligible symbol, for the active range — reused by both the TIPS
  // curve (direct SA yield) and the BEI curve (Nominal - SA yield). Same "overlay, don't
  // replace" convention as the Time Series SA line (see 2.4_Seasonal_Adjustment.md).
  const saSeriesBySym = {};
  if (showSaYield) SA_SYMBOLS.forEach(sym => { saSeriesBySym[sym] = computeSaSeries(sym, rangeData[sym]); });

  // Legend entries labeled "(SA)" are gated on showSaYield, same as before. Non-"(SA)" (raw/
  // quoted) entries are gated on showQuotedYield too, but only on charts that actually carry
  // an SA counterpart (TIPS curve, BEI) — the Nominal curve has no SA datasets at all and its
  // Start/End legend entries must always show regardless of the TIPS-scoped Quoted toggle.
  const curveOptions = { animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 10, weight: 'bold' }, color: '#000' } }, y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 9, family: 'monospace', weight: 'bold' }, color: '#000', callback: v => v.toFixed(3) + '%' } } }, plugins: { legend: { display: true, labels: { font: { size: 10, weight: 'bold' }, filter: (item, data) => {
    const label = String(data.datasets[item.datasetIndex].label);
    if (label.includes('(SA)')) return showSaYield;
    const chartHasSa = data.datasets.some(d => String(d.label).includes('(SA)'));
    return !chartHasSa || showQuotedYield;
  } } }, zoom: { zoom: { wheel: { enabled: true }, mode: 'xy' }, pan: { enabled: true, mode: 'xy' } } } };

  // saEligible charts always reserve dataset slots 2/3 for the SA overlay (empty when SA is
  // off), so toggling SA doesn't need to recreate the chart — same pattern as the Time Series
  // charts reserving their SA dataset slot. Raw Start/End (dataset 0/1) are gated on
  // showQuotedYield only when saEligible — the Nominal curve has no SA counterpart, so the
  // TIPS-scoped Quoted toggle never hides it.
  const buildYield = (id, key, syms, saEligible) => {
    const rawGap = saEligible && !showQuotedYield;
    const sD = rawGap ? syms.map(() => null) : syms.map(s => valueOnDate(s, startDateStr, false));
    const eD = rawGap ? syms.map(() => null) : syms.map(s => valueOnDate(s, endDateStr, true));
    const saSD = saEligible ? syms.map(s => showSaYield ? valueFromSeriesOnDate(saSeriesBySym[s], startDateStr, false) : null) : null;
    const saED = saEligible ? syms.map(s => showSaYield ? valueFromSeriesOnDate(saSeriesBySym[s], endDateStr, true) : null) : null;
    if (yieldCurveCharts[key]) {
      const c = yieldCurveCharts[key];
      c.data.datasets[0].data = sD; c.data.datasets[0].label = sL;
      c.data.datasets[1].data = eD; c.data.datasets[1].label = eL;
      if (saEligible) { c.data.datasets[2].data = saSD; c.data.datasets[2].label = `${sL} (SA)`; c.data.datasets[3].data = saED; c.data.datasets[3].label = `${eL} (SA)`; }
      c.update();
      return;
    }
    const datasets = [
      { label: sL, data: sD, borderColor: '#1a56db', borderDash: [6,3], fill: false, tension: 0.3, spanGaps: true, segment: gapSegmentStyle('#1a56db') },
      { label: eL, data: eD, borderColor: '#dc2626', fill: false, tension: 0.3, spanGaps: true, segment: gapSegmentStyle('#dc2626') }
    ];
    if (saEligible) {
      datasets.push({ label: `${sL} (SA)`, data: saSD, borderColor: SA_COLOR, borderDash: [6,3], fill: false, tension: 0.3, spanGaps: true, segment: gapSegmentStyle(SA_COLOR) });
      datasets.push({ label: `${eL} (SA)`, data: saED, borderColor: SA_COLOR, fill: false, tension: 0.3, spanGaps: true, segment: gapSegmentStyle(SA_COLOR) });
    }
    const ctx = document.getElementById(id).getContext('2d');
    yieldCurveCharts[key] = new Chart(ctx, { type: 'line', data: { labels: syms.map(s => SYMBOL_LABELS[s]), datasets }, options: curveOptions });
  };

  const buildBei = (id, key, pairs) => {
    const sD = !showQuotedYield ? pairs.map(() => null) : pairs.map(p => { const n = valueOnDate(p.n, startDateStr, false), t = valueOnDate(p.t, startDateStr, false); return (n == null || t == null) ? null : n - t; });
    const eD = !showQuotedYield ? pairs.map(() => null) : pairs.map(p => { const n = valueOnDate(p.n, endDateStr, true), t = valueOnDate(p.t, endDateStr, true); return (n == null || t == null) ? null : n - t; });
    const saBei = (p, dateStr, pickLast) => {
      if (!showSaYield || !SA_SYMBOLS.has(p.t)) return null;
      const n = valueOnDate(p.n, dateStr, pickLast), t = valueFromSeriesOnDate(saSeriesBySym[p.t], dateStr, pickLast);
      return (n == null || t == null) ? null : n - t;
    };
    const saSD = pairs.map(p => saBei(p, startDateStr, false));
    const saED = pairs.map(p => saBei(p, endDateStr, true));
    if (yieldCurveCharts[key]) {
      const c = yieldCurveCharts[key];
      c.data.datasets[0].data = sD; c.data.datasets[0].label = sL;
      c.data.datasets[1].data = eD; c.data.datasets[1].label = eL;
      c.data.datasets[2].data = saSD; c.data.datasets[2].label = `${sL} (SA)`;
      c.data.datasets[3].data = saED; c.data.datasets[3].label = `${eL} (SA)`;
      c.update();
      return;
    }
    const ctx = document.getElementById(id).getContext('2d');
    yieldCurveCharts[key] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: pairs.map(p => p.label),
        datasets: [
          { label: sL, data: sD, borderColor: '#1a56db', borderDash: [6,3], fill: false, tension: 0.3, spanGaps: true, segment: gapSegmentStyle('#1a56db') },
          { label: eL, data: eD, borderColor: '#dc2626', fill: false, tension: 0.3, spanGaps: true, segment: gapSegmentStyle('#dc2626') },
          { label: `${sL} (SA)`, data: saSD, borderColor: SA_COLOR, borderDash: [6,3], fill: false, tension: 0.3, spanGaps: true, segment: gapSegmentStyle(SA_COLOR) },
          { label: `${eL} (SA)`, data: saED, borderColor: SA_COLOR, fill: false, tension: 0.3, spanGaps: true, segment: gapSegmentStyle(SA_COLOR) }
        ]
      },
      options: curveOptions
    });
  };

  buildYield('yield-curve-tips', 'tips', TIPS_SYMBOLS, true);
  buildYield('yield-curve-nominal', 'nominal', NOMINAL_SYMBOLS, false);
  buildBei('yield-curve-breakeven', 'breakeven', BEI_PAIRS);
}

window.addEventListener('DOMContentLoaded', init);

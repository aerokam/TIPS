// Yield Curves — Frontend Logic
import { yieldFromPrice, cashflowSchedule } from '../../shared/src/bond-math.js';
import { saFactorForDate } from '../../shared/src/ref-cpi.js';
import { parseCsv } from '../../shared/src/csv.js';
import { localDate, toIsoDate, nextBusinessDay, parseHolidaySet } from '../../shared/src/settlement.js';
import { handleChartKeydown, setupAxisWheelZoom, snapYBounds, snapYAfterZoom } from '../../shared/src/chart-keys.js';
import { initDatePicker } from '../../shared/src/date-picker.js';
import { calendarTimeAxis } from '../../shared/src/chart-time-axis.js';
import { classifyByCusipRoot, isStrip } from '../../shared/src/treasury-cusip.js';
import { cleanFidelityField as clean, fidPriceField, fidParseMaturity, parseFidelityDownloadDate, parseFidelityTipsRows } from '../../shared/src/fidelity-parse.js';

console.log("YieldCurves app.js loading...");

const R2_BASE_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const YIELDS_CSV_URL = `${R2_BASE_URL}/Treasuries/YieldsFromFedInvestPrices.csv`;
const REF_CPI_CSV_URL = `${R2_BASE_URL}/TIPS/RefCpiNsaSa.csv`;
const HOLIDAYS_CSV_URL = `${R2_BASE_URL}/misc/BondHolidaysSifma.csv`;
const FIDELITY_URL = `${R2_BASE_URL}/Treasuries/FidelityTreasuriesTips.csv`;
const GSW_TIPS_CURVE_URL = `${R2_BASE_URL}/TIPS/GswTipsCurve.json`;   // { date, beta0..beta3, tau1, tau2 } — updateGswTipsCurve.js

// The GSW reference line is an analysis aid, not an end-user feature — the published curve
// is only weekly (Tuesdays, through the prior Friday) so it goes stale fast. Hidden unless
// the page is opened with ?gsw; the curve data is always fetched so it's there when needed.
const SHOW_GSW = new URLSearchParams(location.search).has('gsw');

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// GSW (Gürkaynak-Sack-Wright, FEDS 2008-05) fitted TIPS zero-coupon curve — a snapshot for
// visual comparison against our own spot fit. GSW publishes weekly (Tuesdays, covering
// through the prior Friday); this is the latest row as of this commit. [maturity years,
// zero yield %], converted from GSW's continuously-compounded TIPSY to a semi-annual
// bond-equivalent basis so it sits on the same axis as our Spot line and the Ask/SA yields.
// TODO: replace with a weekly R2 pull from feds200805_1.html + show the GSW data date.
const GSW_TIPS_ZERO_SNAPSHOT = {
  date: '2026-08-28',
  points: [[2,2.1922],[3,2.1071],[4,2.0853],[5,2.1065],[6,2.1559],[7,2.2229],[8,2.2994],[9,2.3799],[10,2.4607],[11,2.5388],[12,2.6125],[13,2.6808],[14,2.7430],[15,2.7990],[16,2.8486],[17,2.8920],[18,2.9295],[19,2.9615],[20,2.9884]],
};

// Compute IQR-based clip bounds from a yield array.
// minFence: minimum fence size (default 0.5 for yield % data; pass 0 for spread data
// where values are small and the hard floor would swallow real outliers).
function iqrClipBounds(source, minFence = 0.5) {
  const sorted = [...source].sort((a, b) => a - b);
  if (sorted.length < 4) return null;
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const fence = Math.max(1.0 * iqr, minFence);
  return { lo: q1 - fence, hi: q3 + fence };
}

// --- State ---
let rawYieldsData = null;
let rawNominalsData = null;
let rawRefCpiData = null;
let holidaySet = new Set();
let brokerPrices = null;
let brokerDownloadDate = null;    // download date string from Fidelity TIPS CSV footer
let fidelityNominalsData = null;  // processed bond objects from Fidelity CSV
let fidelityNominalsDate = null;  // download date string extracted from CSV footer
let gswTipsCurve = null;          // { date, beta0..beta3, tau1, tau2 } — GSW fitted TIPS curve, R2 (weekly)
let nominalsShowStrips = false;
let nominalsClipOutliers = true;
let beiClipOutliers = true;
let chart = null;
let chartTab = null;
let spreadChart1 = null, spreadChart2 = null;
let spreadModeActive = false;
const savedZoom = { tips: null, treasuries: null, bei: null };
const savedDateRange = { tips: null, treasuries: null, bei: null };

// classifyByCusipRoot() returns 'Bill'/'Note'/'Bond'/'STRIPS'; map to the
// app's internal type strings (which mirror FedInvest's own Type column).
const CUSIP_TYPE_TO_MARKET_BASED = { Bill: 'MARKET BASED BILL', Note: 'MARKET BASED NOTE', Bond: 'MARKET BASED BOND', STRIPS: 'MARKET BASED STRIP' };

let activeTab = 'tips';
let nominalsTypeFilters = new Set(['MARKET BASED BILL', 'MARKET BASED NOTE', 'MARKET BASED BOND']);
let nominalsSort = { col: 'maturity', dir: 'asc' };
let xAxisMode = 'maturity';
window._currentBonds = [];

// --- Helpers ---
// Parse "MM/DD/YYYY HH:MM AM/PM" (Fidelity footer) → Date (date part only)
function parseFidelityDateStr(s) {
  const [mo, dy, yr] = (s || '').split(' ')[0].split('/').map(Number);
  return new Date(yr, mo - 1, dy);
}

// ── Date range input helpers ──────────────────────────────────────────────────
// Convert YYYY-MM-DD → MM/DD/YYYY for display in text inputs
function isoToMDY(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

// Convert YYYY-MM-DD → MM/DD/YY (2-digit year) for compact table display
function isoToMDY2(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y.slice(2)}`;
}

// Format a Date object → MM/DD/YYYY
function fmtDateMDY(date) {
  return String(date.getMonth() + 1).padStart(2, '0') + '/' +
         String(date.getDate()).padStart(2, '0') + '/' +
         date.getFullYear();
}

// Term axis constants for Bills chart (0–52w, linear, proportional)
const TERM_TICK_VALUES = [0,2,4,6,8,10,12,13,14,16,17,18,20,22,24,26,28,30,32,34,36,38,40,42,44,46,48,50,52];
const TERM_LABEL_4W   = new Set([0,4,8,12,16,20,24,28,32,36,40,44,48,52]);
const TERM_LABEL_MINOR = new Set([6,13,17,26]);

// Format a ms timestamp as a term label (used by TIPS/spread chart tooltips).
function ttmLabel(ms) {
  const days = (ms - Date.now()) / 86400000;
  if (days < 365.25) return `${(days / 7).toFixed(1)}w`;
  return `${Math.round(days / 365.25)}y`;
}

// Broker timestamp "MM/DD/YYYY HH:MM AM/PM" is Fidelity's stamp of the local
// system clock, which on this machine is Pacific. Convert to Eastern (+3h,
// always exact since PT/ET share the same US DST schedule) and drop the year.
function fmtBrokerTime(s) {
  if (!s) return s;
  const [datePart, timePart, ampm] = s.split(' ');
  const [mo, dy, yr] = datePart.split('/').map(Number);
  let [hh, mm] = timePart.split(':').map(Number);
  if (ampm === 'PM' && hh !== 12) hh += 12;
  if (ampm === 'AM' && hh === 12) hh = 0;
  const dt = new Date(yr, mo - 1, dy, hh, mm);
  dt.setHours(dt.getHours() + 3);
  let h2 = dt.getHours();
  const ap2 = h2 >= 12 ? 'PM' : 'AM';
  h2 = h2 % 12; if (h2 === 0) h2 = 12;
  const min2 = String(dt.getMinutes()).padStart(2, '0');
  return `${dt.getMonth() + 1}/${dt.getDate()} ${h2}:${min2} ${ap2}`;
}
// Parse a native date input's ISO value (YYYY-MM-DD) → Date (or null if empty/invalid)
function parseIsoInput(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return isNaN(dt) ? null : dt;
}

function fmtMMM(dateStr) {
  if (!dateStr) return "";
  return isoToMDY(dateStr);
}

// ─── Lightweight Popup Logic ──────────────────────────────────────────────────
function _showDrillPopup(title, html) {
  let ov = document.getElementById('drill-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'drill-overlay';
    ov.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;';
    ov.innerHTML = `
      <div id="drill-modal" style="background:#fff;width:100%;max-width:600px;max-height:90vh;border-radius:8px;display:flex;flex-direction:column;box-shadow:0 10px 25px rgba(0,0,0,0.2);position:relative;overflow:hidden;">
        <button id="drill-close" style="position:absolute;top:12px;right:12px;background:none;border:none;font-size:24px;color:#94a3b8;cursor:pointer;line-height:1;">\u00d7</button>
        <div id="drill-title" style="padding:16px 20px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#1e293b;font-size:14px;flex-shrink:0;"></div>
        <div id="drill-content" style="padding:20px;overflow-y:auto;font-size:13px;line-height:1.6;color:#334155;flex:1;"></div>
      </div>
    `;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.style.display = 'none'; });
    ov.querySelector('#drill-close').onclick = () => ov.style.display = 'none';
  }
  ov.querySelector('#drill-title').textContent = title;
  ov.querySelector('#drill-content').innerHTML = html;
  ov.style.display = 'flex';
}

const COL_HELP = {
  'maturity': {
    title: 'Maturity',
    html: `<p>The maturity date of the TIPS — the date on which the Treasury repays principal.</p>
<p>Most TIPS mature in <strong>January/February</strong> or <strong>July/October</strong>, which places them on opposite sides of the seasonal inflation cycle.</p>`
  },
  'cusip': {
    title: 'CUSIP',
    html: `<p>A 9-character identifier assigned by DTCC that uniquely identifies this Treasury security.</p>
<p>The first 6 digits identify the issuer (Treasury), the next 2 identify the specific issue, and the last digit is a check digit.</p>`
  },
  'coupon': {
    title: 'Coupon',
    html: `<p>The annual interest rate paid by the TIPS, expressed as a percentage of <strong>face value</strong>.</p>
<p>TIPS coupons are paid semi-annually. Because the principal is inflation-adjusted, the actual dollar coupon payment grows (or shrinks) with CPI even though the coupon rate is fixed.</p>`
  },
  'price': {
    title: 'Price',
    html: `<p>The market price per <strong>$100 face value</strong>, sourced from FedInvest mid-market data or uploaded broker ask quotes.</p>
<p><strong>FedInvest Note:</strong> FedInvest prices represent the midpoint of market bid and ask. This is typically lower than a broker's Ask Price, meaning the resulting yield is higher than a commercial Ask Yield.</p>
<p>TIPS prices are quoted on the <em>real</em> (inflation-adjusted) principal. The actual dollar amount paid at settlement is: <code>Price / 100 × Index Ratio × Face Value</code>.</p>`
  },
  'ask-yield': {
    title: 'Ask Yield',
    html: `<p>Yield to maturity (YTM) calculated directly from the market price using standard Treasury bond math (semi-annual compounding).</p>
<p>For broker quotes (solid lines), this is the yield from the <strong>Ask Price</strong>. For FedInvest data (dotted lines), the price is the <strong>midpoint of bid and ask</strong>, so the yield will be higher than a true market ask yield. This is especially evident for short-dated Bills.</p>
<p>This is the <strong>quoted real yield</strong> — it includes any distortion from seasonal inflation patterns baked into the TIPS price.</p>`
  },
  'sa-yield': {
    title: 'SA Yield — Seasonal Adjustment',
    html: `<p>The market price is first multiplied by the ratio <code>S(settle) / S(maturity)</code> — the BLS seasonal factors at the settlement date and maturity date — before computing YTM.</p>
<p>This strips out the predictable seasonal inflation carry so TIPS can be compared across different maturity months on equal footing.</p>
<ul style="margin:0;padding-left:20px;font-size:13px;color:#475569;">
  <li style="margin-bottom:6px;"><strong>Ratio &lt; 1.0</strong> (settling in a low-factor month, maturing in a high-factor month): price is reduced → yield rises. The TIPS had a seasonal premium; adjustment removes it.</li>
  <li style="margin-bottom:6px;"><strong>Ratio &gt; 1.0</strong> (settling in a high-factor month, maturing in a low-factor month): price is increased → yield falls. The TIPS had a seasonal discount; adjustment compensates for it.</li>
</ul>
<p style="margin-top:12px;font-size:11px;color:#94a3b8;">Authority: 31 CFR § 356 Appendix B; Canty (1998)</p>`
  },
  'sao-yield': {
    title: 'SAO Yield — Smooth Curve Fit',
    html: `<p>SAO fits a <strong>Nelson-Siegel-Svensson</strong> curve (the Fed/GSW real-yield-curve standard) through all SA yields, then snaps each TIPS to that curve — treating any deviation as noise not explained by a value-relevant factor (coupon, index ratio — both empirically immaterial).</p>
<p>The deseasonalization residual this corrects is a <strong>front-end phenomenon</strong> that amortizes with maturity, so the snap-to-curve weight fades out rather than applying uniformly:</p>
<ul style="margin:12px 0 0;padding-left:18px;">
  <li style="margin-bottom:6px;"><strong>Under 0.5 years:</strong> price-noise-dominated, excluded from the fit, still read off the curve</li>
  <li style="margin-bottom:6px;"><strong>0.5 – 5 years:</strong> full snap to curve</li>
  <li style="margin-bottom:6px;"><strong>5 – 6 years:</strong> weight fades linearly from 100% curve to 0%</li>
  <li style="margin-bottom:6px;"><strong>Beyond 6 years:</strong> equals raw SA yield (no smoothing) — the curve is already smooth here on its own</li>
</ul>
<p>The result is a <strong>smoothed yield curve</strong> where it matters (the front end, where seasonal residual is largest) without flattening genuine long-end structure.</p>`
  },
  'diff': {
    title: 'Diff (bps)',
    html: `<p>The difference between <strong>SA Yield</strong> and <strong>Ask Yield</strong>, expressed in basis points (1 bp = 0.01 percentage point).</p>
<p>A positive value means the seasonal adjustment raised the yield (the TIPS had a seasonal price premium that was stripped out). A negative value means the adjustment lowered the yield (the TIPS had a seasonal penalty that was compensated).</p>`
  },
  'spot': {
    title: 'Spot — Zero-Coupon Yield Curve',
    html: `<p>Ask, SA and SAO are one point per bond. <strong>Spot</strong> is a single smooth curve fitted through the TIPS — one line per price source (FedInvest dotted, Market solid).</p>
<p>It is a <strong>zero-coupon</strong> curve: the rate for a single payment at each horizon. The fit chooses the curve so that discounting every TIPS's own cash flows along it reproduces that bond's price. Because a bond's yield-to-maturity blends together many different-dated payments, two TIPS of the same maturity but different coupons have slightly different yields to maturity — the spot curve removes that coupon effect.</p>
<p>Same curve family (Nelson-Siegel-Svensson) the Federal Reserve uses for its published TIPS curve. <strong>Spot</strong> is fitted to the <strong>quoted ask</strong> yields, so it tracks the Ask points.</p>`
  },
  'spot-tsy': {
    title: 'Spot — Zero-Coupon Yield Curve',
    html: `<p>Bills, Notes and Bonds are one point per security. <strong>Spot</strong> is a single smooth curve fitted through the coupon Treasuries (Notes and Bonds), one line per price source (FedInvest dotted, Market solid).</p>
<p>It is a <strong>zero-coupon</strong> curve: the rate for a single payment at each horizon. The fit chooses the curve so that discounting each security's own cash flows along it reproduces its price. Because a yield to maturity blends together many different-dated payments, two Treasuries of the same maturity but different coupons have slightly different yields to maturity — the spot curve removes that coupon effect.</p>
<p>Same curve family (Nelson-Siegel-Svensson) the Federal Reserve uses for its published curves.</p>`
  },
  'spot-sa': {
    title: 'Spot SA — Seasonally Adjusted Zero-Coupon Curve',
    html: `<p>The same zero-coupon fit as <strong>Spot</strong>, but fitted to the <strong>seasonally adjusted</strong> yields (the SA transform applied to the ask price) instead of the quoted ask yields.</p>
<p>The gap between <strong>Spot</strong> and <strong>Spot SA</strong> is the seasonal adjustment's effect on the whole curve, in one line. This is the real-yield curve used for spot breakeven inflation on the BEI tab.</p>`
  },
  'spot-bei': {
    title: 'Spot BEI — Curve-Based Breakeven Inflation',
    html: `<p>Ask / SA / SAO BEI are per-TIPS: each subtracts a single closest-maturity nominal yield from that one bond's real yield.</p>
<p><strong>Spot BEI</strong> is instead the <strong>nominal zero-coupon curve minus the seasonally adjusted real zero-coupon curve</strong>, read off at each horizon. Both curves are fitted to the Market (Fidelity) securities. Every point is a genuine same-horizon breakeven — a 10-year point compares a 10-year nominal rate with a 10-year real rate — rather than a comparison of two bonds that only roughly line up in maturity.</p>`
  },
  'gsw': {
    title: 'GSW — Federal Reserve TIPS Curve',
    html: `<p>The Federal Reserve's own fitted TIPS yield curve (Gürkaynak-Sack-Wright, FEDS 2008-05), shown here as a benchmark for the Spot fit.</p>
<p>The Fed publishes it <strong>weekly, on Tuesdays, covering data through the prior Friday</strong>, so it can be several days stale. For that reason it is hidden by default and only appears when the page is opened with <code>?gsw</code>; the curve data is fetched every load so it is available for analysis at any time.</p>`
  }
};

function _showColHelp(colKey) {
  const entry = COL_HELP[colKey];
  if (!entry) return;
  _showDrillPopup(entry.title, entry.html);
}

function _showSaDrill(cusip) {
  const bond = window._currentBonds.find(b => b.cusip === cusip);
  if (!bond) return;

  const mmddSettle = bond.settlementDate.slice(5, 10);
  const mmddMature = bond.maturity.slice(5, 10);
  const saS = saFactorForDate(rawRefCpiData, bond.settlementDate);
  const saM = saFactorForDate(rawRefCpiData, bond.maturity);
  const ratio = saS / saM;

  const html = `
    <div style="background:#f8fafc;padding:12px;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Market Price</span> <strong>${bond.price.toFixed(3)}</strong></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>S-Factor (Settle ${mmddSettle})</span> <strong>${saS.toFixed(4)}</strong></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>S-Factor (Maturity ${mmddMature})</span> <strong>${saM.toFixed(4)}</strong></div>
      <div style="border-top:1px dashed #cbd5e1;margin:8px 0;padding-top:8px;display:flex;justify-content:space-between;">
        <span>Adjustment Ratio (S_s / S_m)</span> <strong>${ratio.toFixed(4)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;color:#1a56db;font-weight:700;">
        <span>Adjusted Price</span> <span>${(bond.price * ratio).toFixed(3)}</span>
      </div>
    </div>
    <div style="font-size:12px;color:#64748b;">
      <p>The <strong>SA Yield</strong> is calculated by finding the internal rate of return (IRR) of the TIPS using the <strong>Adjusted Price</strong> instead of the market price.</p>
      <p>A ratio &lt; 1.0 reduces the price (increasing yield), while a ratio &gt; 1.0 increases the price (decreasing yield).</p>
    </div>
  `;
  _showDrillPopup(`SA Drill-down: ${bond.cusip} (${fmtMMM(bond.maturity)})`, html);
}

function _showSaoDrill(cusip) {
  const bond = window._currentBonds.find(b => b.cusip === cusip);
  if (!bond) return;

  const now = new Date();
  const yearsToMat = (bond.maturityDate - now) / 31557600000;
  const dev = bond._saoDevBps || 0;
  const richCheap = dev > 0 ? 'cheap (yield above curve)' : 'rich (yield below curve)';

  let logicHtml = '';

  if (bond._saoMode === 'noise') {
    logicHtml = `
      <div style="background:#fef3f2;padding:12px;border-radius:6px;border:1px solid #fecdca;margin-bottom:16px;">
        <p style="margin:0;color:#b42318;font-weight:600;">Near-Maturity (excluded from fit)</p>
        <p style="margin:8px 0 0;font-size:12px;">Maturity ${yearsToMat.toFixed(2)}y &lt; ${SAO_NOISE_YRS}y: the SA yield is dominated by price noise on a tiny remaining duration, so this point does not drive the curve fit. Its SAO is read off the smooth curve.</p>
        <div style="margin-top:8px;display:flex;justify-content:space-between;color:#1a56db;font-weight:700;"><span>SAO (on curve)</span><span>${(bond.saoYield * 100).toFixed(3)}%</span></div>
      </div>
    `;
  } else if (bond._saoMode === 'raw') {
    logicHtml = `
      <div style="background:#f0fdf4;padding:12px;border-radius:6px;border:1px solid #bbf7d0;margin-bottom:16px;">
        <p style="margin:0;color:#166534;font-weight:600;">Beyond fade range — no smoothing applied</p>
        <p style="margin:8px 0 0;font-size:12px;">Maturity ${yearsToMat.toFixed(2)}y &ge; ${SAO_FADE_END_YRS}y: the deseasonalization residual that motivates smoothing amortizes away by the long end (see 2.2 §6), so SAO reports the raw SA yield unchanged.</p>
        <div style="margin-top:8px;display:flex;justify-content:space-between;color:#1a56db;font-weight:700;"><span>SAO (= SA, unsmoothed)</span><span>${(bond.saoYield * 100).toFixed(3)}%</span></div>
      </div>
    `;
  } else {
    const weight = bond._saoWeight != null ? bond._saoWeight : 1;
    const fadeNote = bond._saoMode === 'fade'
      ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Curve weight (fading ${SAO_FADE_START_YRS}y&rarr;${SAO_FADE_END_YRS}y)</span><span>${(weight * 100).toFixed(0)}%</span></div>`
      : '';
    logicHtml = `
      <div style="background:#f8fafc;padding:12px;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:16px;">
        <div style="font-size:12px;color:#64748b;margin-bottom:12px;">
          The <strong>SAO</strong> is a <strong>smooth fair-value curve</strong> (Nelson-Siegel-Svensson) fitted through the SA real yields.
          Each TIPS is snapped to the curve: for a buy-and-hold holder, any deviation not explained by a value-relevant
          factor (coupon, index ratio — both immaterial here) is treated as not particularly relevant and smoothed away.
          Inspired by Canty's outlier-factor analysis, but — lacking identifiable outlier factors — operationally a curve fit (see <em>2.0 / 2.2</em>).
          Since the residual this corrects amortizes with maturity, the snap weight fades out between ${SAO_FADE_START_YRS}y and ${SAO_FADE_END_YRS}y (see <em>2.2 §6</em>).
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Raw SA Yield</span><span>${(bond.saYield * 100).toFixed(3)}%</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Deviation from curve</span><span>${dev >= 0 ? '+' : ''}${dev.toFixed(1)} bp — ${richCheap}</span></div>
        ${fadeNote}
        <div style="border-top:1px dashed #cbd5e1;margin:8px 0;padding-top:8px;display:flex;justify-content:space-between;color:#1a56db;font-weight:700;">
          <span>SAO Yield${bond._saoMode === 'fade' ? ' (blended)' : ' (smooth curve)'}</span><span>${(bond.saoYield * 100).toFixed(3)}%</span>
        </div>
      </div>
      <p style="font-size:11px;color:#94a3b8;margin:0;">* The deviation is a rich/cheap relative-value signal — informative, but smoothed out of the SAO fair-value curve.</p>
    `;
  }

  _showDrillPopup(`SAO Drill-down: ${bond.cusip} (Smooth Curve Fit)`, logicHtml);
}

// ─── Main Logic ──────────────────────────────────────────────────────────────

Chart.defaults.font.size = 13;
Chart.defaults.color = '#334155';

async function init() {
  const statusEl = document.getElementById('status');
  console.log("init() started");
  
  try {
    console.log("Fetching market data...");
    const [yieldsRes, refCpiRes, holidayRes, fidRes, gswRes] = await Promise.all([
      fetch(YIELDS_CSV_URL, { cache: 'no-cache' }).then(r => { console.log("Yields fetched"); return r; }).catch(e => ({ ok: false, error: e })),
      fetch(REF_CPI_CSV_URL, { cache: 'no-cache' }).then(r => { console.log("RefCPI fetched"); return r; }).catch(e => ({ ok: false, error: e })),
      fetch(HOLIDAYS_CSV_URL, { cache: 'no-cache' }).then(r => { console.log("Holidays fetched"); return r; }).catch(e => ({ ok: false, error: e })),
      fetch(FIDELITY_URL, { cache: 'no-cache' }).then(r => { console.log("Fidelity fetched"); return r; }).catch(e => ({ ok: false, error: e })),
      fetch(GSW_TIPS_CURVE_URL, { cache: 'no-cache' }).then(r => { console.log("GSW curve fetched"); return r; }).catch(e => ({ ok: false, error: e })),
    ]);

    if (gswRes.ok) {
      try { gswTipsCurve = await gswRes.json(); } catch { gswTipsCurve = null; }
    }

    if (!yieldsRes.ok) throw new Error(`Failed to fetch yields: ${yieldsRes.status || yieldsRes.error}`);
    if (!refCpiRes.ok) throw new Error(`Failed to fetch Ref CPI: ${refCpiRes.status || refCpiRes.error}`);
    if (!holidayRes.ok) throw new Error(`Failed to fetch bond holidays: ${holidayRes.status || holidayRes.error}`);

    console.log("Fetches complete, parsing text...");
    const [yieldsText, refCpiText, holidayText] = await Promise.all([
      yieldsRes.text(),
      refCpiRes.text(),
      holidayRes.text(),
    ]);

    console.log("Parsing CSVs...");
    // YieldsFromFedInvestPrices.csv: row 1 = settlement date, row 2 = header, rows 3+ = data
    const yieldsLines = yieldsText.split(/\r?\n/).filter(l => l.trim());
    const yieldsSettleDate = yieldsLines[0].trim();
    const allYieldsRows = parseCsv(yieldsLines.slice(1).join('\n'))
      .map(r => ({ ...r, settlementDate: yieldsSettleDate }));
    rawYieldsData = allYieldsRows.filter(r => r.type === 'TIPS');
    rawNominalsData = allYieldsRows.filter(r => r.type !== 'TIPS');
    rawRefCpiData = parseCsv(refCpiText);
    
    console.log(`Parsed ${rawYieldsData.length} yield rows and ${rawRefCpiData.length} RefCPI rows.`);

    holidaySet = parseHolidaySet(parseCsv(holidayText, false));
    console.log(`Holiday set populated with ${holidaySet.size} dates.`);

    if (fidRes.ok) {
      const fidText = await fidRes.text();

      // Nominals (Treasuries)
      const { bonds, downloadDate } = parseFidelityNominals(fidText);
      if (bonds.length > 0) {
        fidelityNominalsData = bonds;
        fidelityNominalsDate = downloadDate;
        const chkFid = document.getElementById('chkFidelity');
        chkFid.disabled = false;
        chkFid.checked = true;
        console.log(`Loaded ${bonds.length} Fidelity Treasuries (${downloadDate})`);
        updateModeToggle();
      }

      // TIPS prices
      const priceMap = new Map();
      parseFidelityTipsRows(fidText).forEach(r => {
        if (isNaN(r.askPrice)) return;
        if (!rawYieldsData || !rawYieldsData.some(y => y.cusip === r.cusip)) return;
        priceMap.set(r.cusip, {
          ask: r.askPrice,
          bid: r.bidPrice,
          adjAsk: r.adjAskPrice,
          adjBid: r.adjBidPrice,
          inflationFactor: r.inflationFactor,
        });
      });
      if (priceMap.size > 0) {
        brokerPrices = priceMap;
        brokerDownloadDate = parseFidelityDownloadDate(fidText);
        const chkBroker = document.getElementById('chkTipsBroker');
        chkBroker.disabled = false;
        chkBroker.checked = true;
        console.log(`Loaded ${priceMap.size} Fidelity TIPS prices (${brokerDownloadDate})`);
        updateModeToggle();
      }
    } else {
      console.warn('Fidelity data not available on R2');
    }

    const onRangeChange = () => { savedZoom[activeTab] = null; processAndRender(); };
    [document.getElementById('startMaturity'), document.getElementById('endMaturity')].forEach(el => {
      initDatePicker(el);
      el.addEventListener('change', onRangeChange); // fires on pick and on clear
    });

    document.querySelectorAll('input[name="xAxisMode"]').forEach(r => {
      r.addEventListener('change', () => { xAxisMode = r.value; savedZoom[activeTab] = null; processAndRender(); });
    });

    document.getElementById('resetZoom').onclick = () => {
      if (spreadModeActive) {
        if (spreadChart1) { spreadChart1.resetZoom('none'); _rescaleSpread(spreadChart1); }
        if (spreadChart2) { spreadChart2.resetZoom('none'); _rescaleSpread(spreadChart2); }
      } else {
        savedZoom[activeTab] = null;
        document.getElementById('startMaturity').value = '';
        document.getElementById('endMaturity').value = '';
        processAndRender();
      }
    };

    processAndRender();

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const ov = document.getElementById('drill-overlay');
        if (ov) ov.style.display = 'none';
      }
      if (chart) handleChartKeydown(e, chart, { onAction: ({chart}) => updateDynamicTicks(chart) });
    });

  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = 'error';
    console.error('Initialization failed:', err);
  }
}

// SAO "O" step — a SMOOTH-CURVE FIT, not Canty's inflation-shock outlier factor.
// See knowledge/2.0_SAO_Adjustment.md and 2.2_SAO_Residual_Analysis.md.
//
// Canty's O_t (Eq 20–21) adjusts for *known, non-seasonal* inflation shocks not yet
// in the CPI (VAT hike, a gasoline move since the last print) — determined analytically
// per event. We do NOT compute that. Our "O" step instead snaps each SA real-yield
// point to a smooth fair-value curve: for a buy-and-hold holder, indifferent to
// liquidity/relative-value, any deviation from a smooth curve that ISN'T explained by
// a value-relevant factor (coupon, index ratio — both empirically immaterial here)
// is noise to be removed. So SAO_i = smoothCurve(maturity_i) for every TIPS.
//
// The smooth curve is Nelson-Siegel-Svensson (the Fed/GSW real-yield-curve standard).
const SAO_NOISE_YRS = 0.5;  // exclude < this from the FIT (near-maturity SA is price-noise-dominated)

// The deseasonalization residual that motivates smoothing is a front-end phenomenon that
// amortizes with maturity (see 2.2 §2, extended full-curve analysis in 2.2 §6): beyond
// ~5-6yrs the SA curve is already smooth on its own, so snapping it to NSS there would
// smooth away genuine coupon/relative-value structure instead of seasonal residual.
// So the curve-fit weight fades from 1 (full snap) to 0 (report raw SA) over this band.
const SAO_FADE_START_YRS = 5.0;
const SAO_FADE_END_YRS = 6.0;

// NSS basis at maturity τ for decay params λ1, λ2: [level, slope, curv1, curv2].
function _nssBasis(tau, l1, l2) {
  const a = tau / l1, b = tau / l2;
  const f1 = a > 1e-6 ? (1 - Math.exp(-a)) / a : 1;
  const fb = b > 1e-6 ? (1 - Math.exp(-b)) / b : 1;
  return [1, f1, f1 - Math.exp(-a), fb - Math.exp(-b)];
}
// OLS for the 4 linear betas (given λ's) via 4×4 normal equations + Gaussian elimination.
function _ols4(X, y) {
  const A = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]], bv = [0,0,0,0];
  for (let k = 0; k < X.length; k++) {
    const xi = X[k];
    for (let i = 0; i < 4; i++) { bv[i] += xi[i] * y[k]; for (let j = 0; j < 4; j++) A[i][j] += xi[i] * xi[j]; }
  }
  const M = A.map((r, i) => [...r, bv[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 4; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k]; }
  }
  return [M[0][4]/M[0][0], M[1][4]/M[1][1], M[2][4]/M[2][2], M[3][4]/M[3][3]];
}
// Fit NSS: grid-search the two decay params (betas are linear given λ's), keep best SSR.
// Returns an evaluator τ → yield, or null if degenerate.
function fitNSS(taus, ys) {
  if (taus.length < 4) return null;
  const grid = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 15, 20, 30];
  let best = null;
  for (const l1 of grid) for (const l2 of grid) {
    if (l2 <= l1) continue;
    const X = taus.map(t => _nssBasis(t, l1, l2));
    const beta = _ols4(X, ys);
    if (!beta) continue;
    let ssr = 0;
    for (let k = 0; k < taus.length; k++) {
      const xb = _nssBasis(taus[k], l1, l2);
      const yh = xb[0]*beta[0] + xb[1]*beta[1] + xb[2]*beta[2] + xb[3]*beta[3];
      ssr += (ys[k] - yh) ** 2;
    }
    if (!best || ssr < best.ssr) best = { l1, l2, beta, ssr };
  }
  if (!best) return null;
  const fn = tau => {
    const xb = _nssBasis(tau, best.l1, best.l2);
    return xb[0]*best.beta[0] + xb[1]*best.beta[1] + xb[2]*best.beta[2] + xb[3]*best.beta[3];
  };
  fn._params = best;
  return fn;
}

// True zero-coupon (spot) curve: fit Svensson so the model price of each bond — its cash
// flows discounted with z(t) — matches the observed dirty price, weighted 1/√duration so
// long bonds don't dominate. Grid-search the two decay params; for each, Gauss-Newton on
// the four (nonlinear) betas from the YTM-fit start. Returns z(t) in %, CONTINUOUSLY
// COMPOUNDED (matches GSW's TIPSY convention), or null.
// specs: [{ t, ytm, dirty, times:[yrs], cf:[per100], wt }]
function fitSpotNSS(specs) {
  if (specs.length < 5) return null;
  const evalZ = (beta, l1, l2, t) => {
    const p = _nssBasis(t, l1, l2);
    return (p[0]*beta[0] + p[1]*beta[1] + p[2]*beta[2] + p[3]*beta[3]) / 100; // decimal
  };
  const modelPrice = (beta, l1, l2, s) => {
    let P = 0;
    for (let k = 0; k < s.times.length; k++) P += s.cf[k] * Math.exp(-evalZ(beta, l1, l2, s.times[k]) * s.times[k]);
    return P;
  };
  const grid = [1, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 15, 20, 30];
  let best = null;
  for (const l1 of grid) for (const l2 of grid) {
    if (l2 <= l1) continue;
    let beta = _ols4(specs.map(s => _nssBasis(s.t, l1, l2)), specs.map(s => s.ytm));
    if (!beta) continue;
    for (let iter = 0; iter < 8; iter++) {
      const J = [], resid = [];
      for (const s of specs) {
        const sw = Math.sqrt(s.wt);
        const dP = [0, 0, 0, 0];
        let P = 0;
        for (let k = 0; k < s.times.length; k++) {
          const tk = s.times[k], phi = _nssBasis(tk, l1, l2);
          const pv = s.cf[k] * Math.exp(-evalZ(beta, l1, l2, tk) * tk);
          P += pv;
          for (let j = 0; j < 4; j++) dP[j] += pv * (-tk * phi[j] / 100);
        }
        resid.push((s.dirty - P) * sw);
        J.push(dP.map(d => d * sw));
      }
      const db = _ols4(J, resid);
      if (!db) break;
      beta = beta.map((b, j) => b + db[j]);
      if (Math.max(...db.map(Math.abs)) < 1e-7) break;
    }
    let ssr = 0;
    for (const s of specs) ssr += s.wt * (s.dirty - modelPrice(beta, l1, l2, s)) ** 2;
    if (isFinite(ssr) && (!best || ssr < best.ssr)) best = { l1, l2, beta: [...beta], ssr };
  }
  if (!best) return null;
  const fn = t => evalZ(best.beta, best.l1, best.l2, t) * 100; // % continuous
  fn._params = best;
  return fn;
}

// % continuous → % semi-annual bond-equivalent (so a spot line sits on the same axis as the
// Ask/SA yield scatter).
const zToSA = zc => 200 * (Math.exp(zc / 200) - 1);

// Fit a zero curve to a set of bonds. Returns { z, tMin, tMax, sane(fn) } or null.
// `z(t)` is the zero yield in % continuous; `sane` reports whether a value stays within
// 2 percentage points of the observed yields (Svensson blows up on a set with a large
// maturity-to-maturity discontinuity — a real curve stays inside the scatter). `priceOf` /
// `yieldOf` pick which price / YTM to fit; bonds under `minT` years are left out.
function spotCurveFit(bonds, { priceOf, yieldOf, minT = SAO_NOISE_YRS }) {
  const now = Date.now();
  const specs = [];
  for (const b of bonds) {
    const settle = localDate(b.settlementDate);
    const t = (b.maturityDate.getTime() - now) / (365.25 * 86400000);
    const px = priceOf(b), y = yieldOf(b);
    if (!settle || isNaN(settle) || t < minT || !(px > 0) || y == null || isNaN(y)) continue;
    const sch = cashflowSchedule(settle, b.maturityDate, b.coupon);
    if (!sch || !sch.times.length || sch.times.some(isNaN) || sch.amounts.some(isNaN) || isNaN(sch.accrued)) continue;
    specs.push({ t, ytm: y * 100, dirty: px + sch.accrued, times: sch.times, cf: sch.amounts, wt: 1 / Math.max(1, t) });
  }
  if (specs.length < 5) return null;
  const z = fitSpotNSS(specs);
  if (!z) return null;
  const yLo = Math.min(...specs.map(s => s.ytm)) - 2, yHi = Math.max(...specs.map(s => s.ytm)) + 2;
  return {
    z,
    tMin: Math.min(...specs.map(s => s.t)),
    tMax: Math.max(...specs.map(s => s.t)),
    sane: v => Number.isFinite(v) && v >= yLo && v <= yHi,
  };
}

// spotCurveFit → a half-year { x, y } grid (y in semi-annual %) for a chart line, or null.
// `yToX` maps years-to-maturity to the current x-axis unit; drawn from the shortest fitted bond.
function spotCurveGrid(bonds, opts) {
  const fit = spotCurveFit(bonds, opts);
  if (!fit) return null;
  const grid = [];
  for (let t = Math.ceil(fit.tMin * 2) / 2; t <= fit.tMax + 1e-9; t += 0.5) {
    const y = parseFloat(zToSA(fit.z(t)).toFixed(3));
    if (!fit.sane(y)) return null;   // blown-up fit — drop the whole line
    grid.push({ x: opts.yToX(t), y });
  }
  return grid.length >= 3 ? grid : null;
}

// years-to-maturity → current x-axis unit (calendar ms in Maturity mode, weeks in Term mode).
function yearsToX(now) {
  return xAxisMode === 'ttm' ? y => y * (365.25 / 7) : y => now + y * 365.25 * 86400000;
}

function calculateSAO(bonds) {
  const n = bonds.length;
  const sao = new Array(n);
  if (n === 0) return sao;

  const settle = localDate(bonds[0].settlementDate) || new Date();
  const yrs = bonds.map(b => (b.maturityDate - settle) / 31557600000);

  // Fit on reliable points only; near-maturity SA yields are price-noise-dominated.
  const fitIdx = [];
  for (let i = 0; i < n; i++) if (yrs[i] >= SAO_NOISE_YRS) fitIdx.push(i);
  const curve = fitNSS(fitIdx.map(i => yrs[i]), fitIdx.map(i => bonds[i].saYield));

  for (let i = 0; i < n; i++) {
    const b = bonds[i];
    const fit = curve ? curve(yrs[i]) : b.saYield;
    const weight = yrs[i] < SAO_NOISE_YRS
      ? 1
      : Math.min(1, Math.max(0, (SAO_FADE_END_YRS - yrs[i]) / (SAO_FADE_END_YRS - SAO_FADE_START_YRS)));
    b._saoFit = fit;
    b._saoWeight = weight;
    b._saoDevBps = (b.saYield - fit) * 10000;   // how far the SA point sat off the smooth curve (rich/cheap)
    b._saoMode = yrs[i] < SAO_NOISE_YRS ? 'noise' : weight >= 1 ? 'smooth' : weight <= 0 ? 'raw' : 'fade';
    sao[i] = fit * weight + b.saYield * (1 - weight);
  }
  return sao;
}

function processAndRender() {
  if (activeTab === 'treasuries') {
    processAndRenderNominals();
  } else if (activeTab === 'bei') {
    processAndRenderBei();
  } else {
    processAndRenderTips();
  }
}

function switchTab(tab) {
  // Save date range for the tab we're leaving
  savedDateRange[activeTab] = {
    start: document.getElementById('startMaturity').value,
    end: document.getElementById('endMaturity').value,
  };

  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Show/Hide Source UI groups (BEI reuses the TIPS strip — it's Market-only, see switchChartMode)
  document.getElementById('tipsSourceUI').style.display = (tab === 'tips' || tab === 'bei') ? 'flex' : 'none';
  document.getElementById('treasuriesSourceUI').style.display = tab === 'treasuries' ? 'flex' : 'none';

  // Table visibility
  document.getElementById('saTable').style.display = tab === 'tips' ? '' : 'none';
  document.getElementById('nominalsTable').style.display = tab === 'treasuries' ? '' : 'none';
  document.getElementById('beiTable').style.display = tab === 'bei' ? '' : 'none';

  // BEI has no spread concept — never enter the tab already in spread mode
  if (tab === 'bei') spreadModeActive = false;

  // Sync chart mode + controls visibility for the new tab
  switchChartMode(spreadModeActive ? 'spread' : 'yield');
  updateModeToggle();

  // Restore date range for the tab we're switching to (clear if never set so render can auto-populate)
  const dr = savedDateRange[tab];
  document.getElementById('startMaturity').value = dr ? dr.start : '';
  document.getElementById('endMaturity').value = dr ? dr.end : '';

  processAndRender();
}

// Pure parser — works with text from file upload or R2 fetch
function parseFidelityNominals(text) {
  const downloadDate = parseFidelityDownloadDate(text);
  const rows = parseCsv(text);
  const bonds = [];
  const seen = new Set();

  for (const row of rows) {
    const n = {};
    for (const k in row) n[k.toLowerCase().trim()] = row[k];

    // Combined file: skip TIPS rows — handled by broker price parser
    const product = (n['product'] || '').toLowerCase();
    if (product === 'tips') continue;

    const cusip = clean(n['cusip'] || n['cusip|state']);
    const desc  = (n['description'] || '').toUpperCase();

    if (!cusip || seen.has(cusip)) continue;

    // Old-format fallback: reject anything FedInvest knows as TIPS
    if (rawYieldsData.some(r => r.cusip === cusip) || /\bTIPS\b/.test(desc)) continue;

    const cusipType = classifyByCusipRoot(cusip);
    if (!cusipType) { console.warn(`Unrecognized CUSIP root, skipping: ${cusip}`); continue; }

    const matStr    = clean(n['maturity date']);
    const maturity  = fidParseMaturity(matStr);
    if (!maturity) continue;
    const maturityDate = localDate(maturity);

    const yldStr     = clean(n['ask yield to maturity']);
    const couponStr  = clean(n['coupon']);
    const priceStr   = fidPriceField(n['price ask'] || n['ask price/quantity (min)']);
    const bidPriceStr = fidPriceField(n['price bid'] || n['bid price/quantity (min)']);
    const bidYldStr  = clean(n['yield bid'] || n['yield']);

    const yld = parseFloat(yldStr) / 100;
    if (!maturityDate || isNaN(yld)) continue;

    const type = CUSIP_TYPE_TO_MARKET_BASED[cusipType];

    seen.add(cusip);
    bonds.push({
      cusip, type,
      coupon: parseFloat(couponStr) / 100 || 0,
      price: parseFloat(priceStr) || NaN,
      yield: yld,
      bidPrice: parseFloat(bidPriceStr),
      bidYield: parseFloat(bidYldStr) / 100,
      maturity, maturityDate,
    });
  }
  bonds.sort((a, b) => a.maturityDate - b.maturityDate);
  return { bonds, downloadDate };
}

function processAndRenderNominals() {
  const statusEl = document.getElementById('status');
  const showFed = document.getElementById('chkFedInvest').checked;
  const showFid = document.getElementById('chkFidelity').checked && !!fidelityNominalsData;

  if (!showFed && !showFid) { statusEl.textContent = ''; if (chart) { chart.destroy(); chart = null; } return; }

  try {
    let fedProcessed = null;
    if (showFed) {
      if (!rawNominalsData || rawNominalsData.length === 0) { statusEl.textContent = 'No FedInvest data available.'; return; }
      fedProcessed = rawNominalsData.filter(r => nominalsTypeFilters.has(r.type) || (nominalsShowStrips && isStrip(r.cusip))).map(r => {
        const price = parseFloat(r.price);
        const coupon = parseFloat(r.coupon);
        const maturityDate = localDate(r.maturity);
        const yld = yieldFromPrice(price, coupon, localDate(r.settlementDate), maturityDate);
        if (yld === null || isNaN(yld)) return null;
        return { ...r, coupon, price, yield: yld, maturityDate };
      }).filter(Boolean).sort((a, b) => a.maturityDate - b.maturityDate);
    }

    let fidProcessed = null;
    if (showFid) {
      fidProcessed = fidelityNominalsData.filter(r => nominalsTypeFilters.has(r.type) || (nominalsShowStrips && isStrip(r.cusip)));
    }

    // Filter STRIPS unless user opts in (already handled by the initial filter above for performance, but we keep the fidProcessed part consistent)
    if (!nominalsShowStrips) {
      if (fedProcessed) fedProcessed = fedProcessed.filter(b => !isStrip(b.cusip));
      if (fidProcessed) fidProcessed = fidProcessed.filter(b => !isStrip(b.cusip));
    }

    const allBonds = [...(fedProcessed || []), ...(fidProcessed || [])].sort((a, b) => a.maturityDate - b.maturityDate);
    const startEl = document.getElementById('startMaturity');
    const endEl = document.getElementById('endMaturity');
    if (!startEl.value && allBonds.length > 0) {
      startEl.value = allBonds[0].maturity;
      endEl.value = allBonds[allBonds.length - 1].maturity;
    }

    const startDate = parseIsoInput(startEl.value) || new Date(0);
    const endDate = parseIsoInput(endEl.value) || new Date(9999, 0);
    const inRange = b => b.maturityDate >= startDate && b.maturityDate <= endDate;
    const fedFiltered = fedProcessed ? fedProcessed.filter(inRange) : null;
    const fidFiltered = fidProcessed ? fidProcessed.filter(inRange) : null;

    if (fidFiltered) {
      fidFiltered.forEach(b => {
        b.yieldSpreadBps = (!isNaN(b.bidYield) && !isNaN(b.yield)) ? (b.bidYield - b.yield) * 10000 : NaN;
        b.priceSpreadPct = (!isNaN(b.bidPrice) && !isNaN(b.price) && b.price > 0) ? (b.price - b.bidPrice) / b.price * 100 : NaN;
      });
    }

    if (spreadModeActive && fidFiltered) {
      renderSpreadCharts(fidFiltered, 'treasuries');
      renderSpreadTable(fidFiltered, 'treasuries');
    } else {
      renderNominalsTable(fedFiltered, fidFiltered);
      renderNominalsChart(fedFiltered, fidFiltered);
    }

    const treaFedSettle = rawNominalsData?.[0]?.settlementDate;
    document.getElementById('treaFedMeta').textContent = showFed && treaFedSettle ? `settle ${isoToMDY(treaFedSettle)} (T)` : '';
    if (showFid && fidelityNominalsDate) {
      const loadDate = parseFidelityDateStr(fidelityNominalsDate);
      const t1 = nextBusinessDay(loadDate, holidaySet);
      document.getElementById('treaMktMeta').textContent = `${fmtBrokerTime(fidelityNominalsDate)} ET · settle ${isoToMDY(toIsoDate(t1))} (T+1)`;
    } else {
      document.getElementById('treaMktMeta').textContent = '';
    }
    document.getElementById('treaFedCount').textContent = showFed ? (fedFiltered?.length || 0) : '';
    document.getElementById('treaMktCount').textContent = showFid ? (fidFiltered?.length || 0) : '';
    statusEl.textContent = '';
    statusEl.className = '';
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = 'error';
    console.error('processAndRenderNominals failed:', err);
  }
}

function renderNominalsTable(fedBonds, fidBonds) {
  const theadRow = document.querySelector('#nominalsTable thead tr');
  const tbody = document.getElementById('nominalsTableBody');
  const bothActive = fedBonds && fidBonds;
  const shortType = t => t === 'MARKET BASED BILL' ? 'Bill' : t === 'MARKET BASED NOTE' ? 'Note' : t === 'MARKET BASED BOND' ? 'Bond' : 'STRIP';
  const fmtMat = s => isoToMDY(s);
  const fmtYld = y => (y != null && !isNaN(y)) ? (y * 100).toFixed(3) + '%' : '—';
  const sortCls = col => nominalsSort.col === col ? ` class="sort-${nominalsSort.dir}"` : '';
  const makeCmp = getV => (a, b) => { const va = getV(a), vb = getV(b); return (va < vb ? -1 : va > vb ? 1 : 0) * (nominalsSort.dir === 'asc' ? 1 : -1); };

  if (bothActive) {
    theadRow.innerHTML = `
      <th data-sort="maturity"${sortCls('maturity')}>Maturity</th>
      <th data-sort="cusip"${sortCls('cusip')}>CUSIP</th>
      <th>Type</th>
      <th data-sort="coupon"${sortCls('coupon')}>Coupon</th>
      <th>Price (Fed/Mkt)</th>
      <th>Yield (Fed/Mkt)</th>
`;
    const fedMap = new Map(fedBonds.map(b => [b.cusip, b]));
    const fidMap = new Map(fidBonds.map(b => [b.cusip, b]));
    const getV = b => nominalsSort.col === 'cusip' ? b.cusip : nominalsSort.col === 'coupon' ? b.coupon : b.maturityDate;
    const merged = [...new Set([...fedMap.keys(), ...fidMap.keys()])].map(cusip => {
      const fed = fedMap.get(cusip), fid = fidMap.get(cusip), ref = fed || fid;
      return { ...ref, fedPrice: fed?.price ?? NaN, fidPrice: fid?.price ?? NaN, fedYield: fed?.yield ?? null, fidYield: fid?.yield ?? null };
    }).sort(makeCmp(getV));
    tbody.innerHTML = merged.map(b => `
      <tr>
        <td>${fmtMat(b.maturity)}</td>
        <td>${b.cusip}</td>
        <td>${shortType(b.type)}</td>
        <td>${((b.coupon || 0) * 100).toFixed(3)}%</td>
        <td>${isNaN(b.fedPrice) ? '—' : b.fedPrice.toFixed(3)} / ${isNaN(b.fidPrice) ? '—' : b.fidPrice.toFixed(3)}</td>
        <td>${fmtYld(b.fedYield)} / ${fmtYld(b.fidYield)}</td>
      </tr>`).join('');
  } else {
    const bonds = fedBonds || fidBonds;
    theadRow.innerHTML = `
      <th data-sort="maturity"${sortCls('maturity')}>Maturity</th>
      <th data-sort="cusip"${sortCls('cusip')}>CUSIP</th>
      <th>Type</th>
      <th data-sort="coupon"${sortCls('coupon')}>Coupon</th>
      <th data-sort="price"${sortCls('price')}>Price</th>
      <th data-sort="yield"${sortCls('yield')}>Yield</th>`;
    const getV = b => nominalsSort.col === 'maturity' ? b.maturityDate : nominalsSort.col === 'cusip' ? b.cusip : nominalsSort.col === 'coupon' ? b.coupon : nominalsSort.col === 'price' ? b.price : b.yield;
    const sorted = [...bonds].sort(makeCmp(getV));
    tbody.innerHTML = sorted.map(b => `
      <tr>
        <td>${fmtMat(b.maturity)}</td>
        <td>${b.cusip}</td>
        <td>${shortType(b.type)}</td>
        <td>${(b.coupon * 100).toFixed(3)}%</td>
        <td>${isNaN(b.price) ? '—' : b.price.toFixed(3)}</td>
        <td>${(b.yield * 100).toFixed(3)}%</td>
      </tr>`).join('');
  }
}

function renderNominalsChart(fedBonds, fidBonds) {
  const ctx = document.getElementById('yieldChart').getContext('2d');
  const allBonds = [...(fedBonds || []), ...(fidBonds || [])];
  if (allBonds.length === 0) { if (chart) { chart.destroy(); chart = null; } return; }

  const now = Date.now();
  const toPoint = xAxisMode === 'ttm'
    ? b => ({ x: (b.maturityDate.getTime() - now) / (7 * 86400000), y: parseFloat((b.yield * 100).toFixed(3)) })
    : b => ({ x: b.maturityDate.getTime(), y: parseFloat((b.yield * 100).toFixed(3)) });
  const bothShown = fedBonds && fidBonds;

  // FedInvest: cool blues/purple (dotted) — Fidelity: warm orange/red/teal (solid)
  const seriesDef = [];
  if (fedBonds) {
    const sfx = bothShown ? ' (FedInvest)' : '';
    seriesDef.push(
      { label: `Bills${sfx}`,  data: fedBonds.filter(b => b.type === 'MARKET BASED BILL' && !isStrip(b.cusip)).map(toPoint), color: '#0ea5e9', r: 1, w: 1.5, dash: [4, 4] },
      { label: `Notes${sfx}`,  data: fedBonds.filter(b => b.type === 'MARKET BASED NOTE' && !isStrip(b.cusip)).map(toPoint), color: '#1a56db', r: 1, w: 2.5, dash: [4, 4] },
      { label: `Bonds${sfx}`,  data: fedBonds.filter(b => b.type === 'MARKET BASED BOND' && !isStrip(b.cusip)).map(toPoint), color: '#7c3aed', r: 1, w: 2.5, dash: [4, 4] },
      { label: `STRIPS${sfx}`, data: fedBonds.filter(b => isStrip(b.cusip)).map(toPoint), color: '#64748b', r: 1, w: 2.2, dash: [4, 4] }
    );
  }
  if (fidBonds) {
    const sfx = bothShown ? ' (Market)' : '';
    seriesDef.push(
      { label: `Bills${sfx}`,  data: fidBonds.filter(b => b.type === 'MARKET BASED BILL' && !isStrip(b.cusip)).map(toPoint), color: '#f97316', r: 1, w: 1.5, dash: [] },
      { label: `Notes${sfx}`,  data: fidBonds.filter(b => b.type === 'MARKET BASED NOTE' && !isStrip(b.cusip)).map(toPoint), color: '#dc2626', r: 1, w: 2.5, dash: [] },
      { label: `Bonds${sfx}`,  data: fidBonds.filter(b => b.type === 'MARKET BASED BOND' && !isStrip(b.cusip)).map(toPoint), color: '#059669', r: 1, w: 2.5, dash: [] },
      { label: `STRIPS${sfx}`, data: fidBonds.filter(b => isStrip(b.cusip)).map(toPoint), color: '#78350f', r: 1, w: 2.2, dash: [] }
    );
  }

  // Zero-coupon (spot) curve, per source — fitted in price space to the coupon Treasuries
  // (Notes + Bonds; Bills and STRIPS left out, same as the TIPS fit drops the very short end).
  const yToX = yearsToX(now);
  const nomCurveSrc = [];
  if (fedBonds) nomCurveSrc.push({ bonds: fedBonds, sfx: bothShown ? ' (FedInvest)' : '', color: '#1a56db', dash: [4, 4] });
  if (fidBonds) nomCurveSrc.push({ bonds: fidBonds, sfx: bothShown ? ' (Market)' : '',    color: '#b45309', dash: [] });
  for (const { bonds, sfx, color, dash } of nomCurveSrc) {
    const coupons = bonds.filter(b => (b.type === 'MARKET BASED NOTE' || b.type === 'MARKET BASED BOND') && !isStrip(b.cusip));
    const grid = spotCurveGrid(coupons, { priceOf: b => b.price, yieldOf: b => b.yield, yToX, minT: 1 });
    if (grid) seriesDef.push({ label: `Spot${sfx}`, data: grid, color, w: 2.25, dash, curve: true, r: 0, markerR: 2 });
  }

  // Filter series with no data points
  const activeSeries = seriesDef.filter(s => s.data.length > 0);
  const allPoints = activeSeries.flatMap(s => s.data);
  if (allPoints.length === 0) { if (chart) { chart.destroy(); chart = null; } return; }

  // X axis: linear term scale in Term mode; time scale in Maturity mode
  let xScale;
  if (xAxisMode === 'ttm') {
    const rawMaxW = Math.max(...allPoints.map(d => d.x));
    const isBillsOnly = rawMaxW <= 52;
    const maxW = isBillsOnly ? 52 : Math.ceil(rawMaxW / 52) * 52;
    let tickVals, tickCb, tickFont;
    if (isBillsOnly) {
      tickVals = TERM_TICK_VALUES;
      tickCb = val => (TERM_LABEL_4W.has(val) || TERM_LABEL_MINOR.has(val)) ? `${val}w` : '';
      tickFont = ctx => TERM_LABEL_MINOR.has(ctx.tick?.value) ? { size: 9 } : { size: 11 };
    } else {
      tickCb = (val) => {
        if (val < 0) return '';
        if (val >= 52) {
          const wy = Math.floor(val / 52);
          const rm = Math.round((val / 52 - wy) * 12);
          if (rm === 0) return `${wy}y`;
          if (rm === 12) return `${wy + 1}y`;
          return `${wy}y ${rm}m`;
        }
        if (val >= 4) return `${Math.round(val / 4.348)}m`;
        return `${Math.round(val)}w`;
      };
      tickFont = () => ({ size: 11 });
    }
    xScale = {
      type: 'linear',
      min: 0, max: maxW,
      afterBuildTicks: scale => {
        if (isBillsOnly) {
          scale.ticks = tickVals.filter(v => v >= scale.min && v <= scale.max).map(v => ({ value: v }));
        } else {
          const span = scale.max - scale.min;
          const ticks = [];
          if (span > 260) {
            const start = Math.ceil(Math.max(scale.min, 0) / 52) * 52;
            for (let v = start; v <= scale.max; v += 52) ticks.push({ value: v });
          } else if (span > 104) {
            const start = Math.ceil(Math.max(scale.min, 0) / 26) * 26;
            for (let v = start; v <= scale.max; v += 26) ticks.push({ value: v });
          } else if (span > 52) {
            const start = Math.ceil(Math.max(scale.min, 0) / 13) * 13;
            for (let v = start; v <= scale.max; v += 13) ticks.push({ value: v });
          } else if (span > 12) {
            const start = Math.ceil(Math.max(scale.min, 0) / 4) * 4;
            for (let v = start; v <= scale.max; v += 4) ticks.push({ value: v });
          } else {
            const start = Math.ceil(Math.max(scale.min, 0));
            for (let v = start; v <= scale.max; v += 1) ticks.push({ value: v });
          }
          scale.ticks = ticks;
        }
      },
      grid: { color: 'rgba(0,0,0,0.05)' },
      ticks: { maxRotation: 0, callback: tickCb, font: tickFont }
    };
  } else {
    const minDate = new Date(Math.min(...allPoints.map(d => d.x)));
    const maxDate = new Date(Math.max(...allPoints.map(d => d.x)));
    const _startDtN = parseIsoInput(document.getElementById('startMaturity').value);
    const _endDtN   = parseIsoInput(document.getElementById('endMaturity').value);
    const minX = _startDtN
      ? new Date(_startDtN.getFullYear(), _startDtN.getMonth(), 1).getTime()
      : new Date(minDate.getFullYear(), minDate.getMonth(), 1).getTime();
    const maxX = _endDtN
      ? new Date(_endDtN.getFullYear(), _endDtN.getMonth() + 1, 1).getTime()
      : new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1).getTime();
    xScale = {
      type: 'time',
      min: minX, max: maxX,
      time: { displayFormats: { year: 'yyyy', month: 'MMM yyyy' } },
      ...calendarTimeAxis({ gridColor: 'rgba(0,0,0,0.05)' }),
    };
  }

  const allY = allPoints.map(d => d.y);
  let scaleY = allY;
  if (nominalsClipOutliers && allY.length >= 4) {
    // Use Bills/Notes yields for IQR (outliers live in short-dated issues; bonds widen IQR too much).
    // Filter IQR source to positive yields only — near-maturity Bills/Notes can show extreme
    // negative YTM (e.g. -5%) when trading at a tiny premium with days to expiry.
    // Only clip when Bills or Notes are visible — near-maturity Bills/Notes are the sole source of
    // extreme negative YTM garbage. Without either, there's nothing to clip.
    const nearMaturityY = activeSeries.filter(s => s.label.includes('Notes') || s.label.includes('Bills')).flatMap(s => s.data).map(d => d.y);
    const nearMaturityYPos = nearMaturityY.filter(y => y > 0);
    if (nearMaturityYPos.length >= 4) {
      const bounds = iqrClipBounds(nearMaturityYPos);
      if (bounds) {
        const clipped = allY.filter(y => y >= bounds.lo);
        if (clipped.length > 0) scaleY = clipped;
      }
    }
  }
  const minYRaw = Math.min(...scaleY), maxYRaw = Math.max(...scaleY);
  const minY = Math.floor(minYRaw * 20) / 20;
  const maxY = Math.ceil(maxYRaw * 20) / 20;
  const dataRange = maxY - minY;
  const step = dataRange <= 0.5 ? 0.05 : dataRange <= 1.0 ? 0.1 : 0.25;

  const zoomToRestore = savedZoom['treasuries'];
  if (chart && chartTab && savedZoom[chartTab] !== null) savedZoom[chartTab] = {
    xMin: chart.scales.x.min, xMax: chart.scales.x.max,
    yMin: chart.scales.y.min, yMax: chart.scales.y.max
  };
  if (chart) chart.destroy();
  chartTab = 'treasuries';
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: activeSeries.map(s => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: s.w,
        borderDash: s.dash,
        pointRadius: s.curve ? (s.markerR ?? 0) : s.r,
        pointHoverRadius: s.curve ? 5 : (s.r > 0 ? s.r + 2 : 3),
        tension: s.curve ? 0.3 : 0.1,
        hidden: s.curve ? !document.getElementById('showTsySpot').checked : false
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: xScale,
        y: {
          type: 'linear',
          title: { display: true, text: 'Yield (%)' },
          min: minY, max: maxY,
          ticks: { stepSize: step, callback: (val) => val.toFixed(2) }
        }
      },
      plugins: {
        legend: {
          labels: { usePointStyle: true, boxWidth: 8, padding: 15, font: { size: 13, weight: '500' } },
          onClick: (e, legendItem, legend) => { Chart.defaults.plugins.legend.onClick(e, legendItem, legend); rescaleToVisible(legend.chart); }
        },
        zoom: {
          pan: { enabled: true, mode: 'xy' },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy', onZoomComplete: ({chart}) => rescaleToVisible(chart) }
        },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.95)', titleColor: '#1e293b', bodyColor: '#475569',
          borderColor: '#e2e8f0', borderWidth: 1, padding: 8,
          titleFont: { size: 11, weight: '700' }, bodyFont: { size: 11 },
          cornerRadius: 6, displayColors: false,
          callbacks: {
            title: items => {
              if (xAxisMode === 'ttm') {
                const w = items[0].parsed.x;
                const termLabel = w < 52 ? `${w.toFixed(1)}w` : `${(w / 52).toFixed(1)}y`;
                return `${fmtDateMDY(new Date(now + w * 7 * 86400000))} (${termLabel})`;
              }
              return fmtDateMDY(new Date(items[0].parsed.x));
            },
            label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(3)}%`
          }
        }
      }
    }
  });

  if (zoomToRestore) {
    chart.options.scales.x.min = zoomToRestore.xMin;
    chart.options.scales.x.max = zoomToRestore.xMax;
    chart.options.scales.y.min = zoomToRestore.yMin;
    chart.options.scales.y.max = zoomToRestore.yMax;
    chart.update('none');
  }

  setupAxisWheelZoom(chart.canvas, ({chart}) => rescaleToVisible(chart), ({chart, factor}) => snapYAfterZoom(chart, factor));

}

// Build the processed TIPS bond set for one source (FedInvest or broker/Market).
// Shared by the TIPS tab (both sources side-by-side) and the BEI tab (Market only).
function buildProcessedTipsBonds(sourceMap, isBroker) {
  return rawYieldsData.map(bond => {
    const coupon = parseFloat(bond.coupon);
    let price = parseFloat(bond.price);
    let settleDateStr = bond.settlementDate;

    let quote = null;
    if (isBroker) {
      if (!sourceMap.has(bond.cusip)) return null;
      quote = sourceMap.get(bond.cusip);
      price = quote.ask;
      const fedSettleDate = localDate(bond.settlementDate);
      const tPlus1 = nextBusinessDay(fedSettleDate, holidaySet);
      settleDateStr = toIsoDate(tPlus1);
    }

    const saSettle = saFactorForDate(rawRefCpiData, settleDateStr);
    const saMature = saFactorForDate(rawRefCpiData, bond.maturity);

    if (saSettle == null || isNaN(saSettle) || saMature == null || isNaN(saMature)) return null;

    const settleDate = localDate(settleDateStr);
    const matureDate = localDate(bond.maturity);
    const saRatio = saSettle / saMature;   // SA clean price = price × saRatio (1.0_Seasonal_Adjustments)
    const askYield = yieldFromPrice(price, coupon, settleDate, matureDate);
    const saYield = yieldFromPrice(price * saRatio, coupon, settleDate, matureDate);

    let bidPrice = NaN, bidYield = NaN, adjAskPrice = NaN, adjBidPrice = NaN;
    let inflationFactor = NaN, yieldSpreadBps = NaN, priceSpreadPct = NaN;
    if (isBroker && quote) {
      bidPrice = quote.bid;
      adjAskPrice = quote.adjAsk;
      adjBidPrice = quote.adjBid;
      inflationFactor = quote.inflationFactor;
      bidYield = yieldFromPrice(bidPrice, coupon, settleDate, matureDate);
      if (!isNaN(bidYield) && !isNaN(askYield)) yieldSpreadBps = (bidYield - askYield) * 10000;
      if (!isNaN(adjAskPrice) && !isNaN(adjBidPrice) && adjAskPrice > 0)
        priceSpreadPct = (adjAskPrice - adjBidPrice) / adjAskPrice * 100;
    }

    return { ...bond, coupon, price, saRatio, askYield, saYield, bidPrice, bidYield, adjAskPrice, adjBidPrice, inflationFactor, yieldSpreadBps, priceSpreadPct, maturityDate: matureDate, settlementDate: settleDateStr, isBroker };
  }).filter(Boolean).sort((a, b) => a.maturityDate - b.maturityDate);
}

function processAndRenderTips() {
  const statusEl = document.getElementById('status');
  const showFed = document.getElementById('chkTipsFed').checked;
  const showBroker = document.getElementById('chkTipsBroker').checked && !!brokerPrices;

  if (!showFed && !showBroker) { statusEl.textContent = ''; if (chart) { chart.destroy(); chart = null; } return; }
  if (!rawYieldsData || rawYieldsData.length === 0 || !rawRefCpiData) return;

  try {
    const fedSettleStr = rawYieldsData[0]?.settlementDate;

    let fedBonds = showFed ? buildProcessedTipsBonds(null, false) : null;
    let brokerBonds = showBroker ? buildProcessedTipsBonds(brokerPrices, true) : null;

    // Apply SAO to each set
    if (fedBonds) {
      const smoothed = calculateSAO(fedBonds);
      fedBonds.forEach((b, i) => { b.saoYield = smoothed[i]; b.diffBps = (b.saYield - b.askYield) * 10000; });
    }
    if (brokerBonds) {
      const smoothed = calculateSAO(brokerBonds);
      brokerBonds.forEach((b, i) => { b.saoYield = smoothed[i]; b.diffBps = (b.saYield - b.askYield) * 10000; });
    }

    const startEl = document.getElementById('startMaturity');
    const endEl = document.getElementById('endMaturity');

    const allCurrent = [...(fedBonds || []), ...(brokerBonds || [])].sort((a, b) => a.maturityDate - b.maturityDate);
    if (!startEl.value && allCurrent.length > 0) {
      startEl.value = allCurrent[0].maturity;
      endEl.value = allCurrent[allCurrent.length - 1].maturity;
    }

    const startDate = parseIsoInput(startEl.value) || new Date(0);
    const endDate = parseIsoInput(endEl.value) || new Date(9999, 0);
    const inRange = b => b.maturityDate >= startDate && b.maturityDate <= endDate;
    const fedFiltered = fedBonds ? fedBonds.filter(inRange) : null;
    const brokerFiltered = brokerBonds ? brokerBonds.filter(inRange) : null;

    if (spreadModeActive && brokerFiltered) {
      renderSpreadCharts(brokerFiltered, 'tips');
      renderSpreadTable(brokerFiltered, 'tips');
    } else {
      renderTable(fedFiltered, brokerFiltered);
      renderChart(fedFiltered, brokerFiltered);
    }

    document.getElementById('tipsFedMeta').textContent = showFed && fedSettleStr ? `settle ${isoToMDY(fedSettleStr)} (T)` : '';
    if (showBroker && brokerDownloadDate) {
      const loadDate = parseFidelityDateStr(brokerDownloadDate);
      const t1 = nextBusinessDay(loadDate, holidaySet);
      document.getElementById('tipsMktMeta').textContent = `${fmtBrokerTime(brokerDownloadDate)} ET · settle ${isoToMDY(toIsoDate(t1))} (T+1)`;
    } else {
      document.getElementById('tipsMktMeta').textContent = '';
    }
    document.getElementById('tipsFedCount').textContent = showFed ? (fedFiltered?.length || 0) : '';
    document.getElementById('tipsBrokerCount').textContent = showBroker ? (brokerFiltered?.length || 0) : '';
    statusEl.textContent = '';
    statusEl.className = '';
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = 'error';
    console.error('processAndRenderTips failed:', err);
  }
}

function renderTable(fedBonds, brokerBonds) {
  const tbody = document.getElementById('tableBody');
  const thead = document.querySelector('#saTable thead tr');
  const both = fedBonds && brokerBonds;
  const allBonds = [...(fedBonds || []), ...(brokerBonds || [])].sort((a, b) => a.maturityDate - b.maturityDate);
  window._currentBonds = allBonds;

  if (both) {
    thead.innerHTML = `
      <th><a class="col-help" href="#" data-col="maturity">Maturity</a></th>
      <th><a class="col-help" href="#" data-col="cusip">CUSIP</a></th>
      <th><a class="col-help" href="#" data-col="coupon">Coupon</a></th>
      <th>Price (Fed/Mkt)</th>
      <th>Ask Yield (Fed/Mkt)</th>
      <th>SA Yield (Fed/Mkt)</th>
      <th>SAO Yield (Fed/Mkt)</th>`;
    
    const fedMap = new Map(fedBonds.map(b => [b.cusip, b]));
    const brokerMap = new Map(brokerBonds.map(b => [b.cusip, b]));
    const uniqueCusips = [...new Set([...fedMap.keys(), ...brokerMap.keys()])].sort((a, b) => {
      const ma = fedMap.get(a)?.maturityDate || brokerMap.get(a)?.maturityDate;
      const mb = fedMap.get(b)?.maturityDate || brokerMap.get(b)?.maturityDate;
      return ma - mb;
    });
    
    tbody.innerHTML = uniqueCusips.map(cusip => {
      const f = fedMap.get(cusip), b = brokerMap.get(cusip);
      const ref = f || b;
      const fmtY = y => (y != null && !isNaN(y)) ? (y * 100).toFixed(3) + '%' : '—';
      return `
        <tr>
          <td>${fmtMMM(ref.maturity)}</td>
          <td>${cusip}</td>
          <td>${(ref.coupon * 100).toFixed(3)}%</td>
          <td>${f ? f.price.toFixed(3) : '—'} / ${b ? b.price.toFixed(3) : '—'}</td>
          <td>${fmtY(f?.askYield)} / ${fmtY(b?.askYield)}</td>
          <td class="drillable" data-cusip="${cusip}">${fmtY(f?.saYield)} / ${fmtY(b?.saYield)}</td>
          <td style="font-weight:700; color:#1a56db;" class="drillable" data-cusip="${cusip}">${fmtY(f?.saoYield)} / ${fmtY(b?.saoYield)}</td>
        </tr>`;
    }).join('');
  } else {
    thead.innerHTML = `
      <th><a class="col-help" href="#" data-col="maturity">Maturity</a></th>
      <th><a class="col-help" href="#" data-col="cusip">CUSIP</a></th>
      <th><a class="col-help" href="#" data-col="coupon">Coupon</a></th>
      <th><a class="col-help" href="#" data-col="price">Price</a></th>
      <th><a class="col-help" href="#" data-col="ask-yield">Ask Yield</a></th>
      <th><a class="col-help" href="#" data-col="sa-yield">SA Yield</a></th>
      <th><a class="col-help" href="#" data-col="sao-yield">SAO Yield</a></th>
      <th><a class="col-help" href="#" data-col="diff">Diff (bps)</a></th>`;
    const bonds = fedBonds || brokerBonds;
    tbody.innerHTML = bonds.map(b => `
      <tr>
        <td>${fmtMMM(b.maturity)}</td>
        <td>${b.cusip}</td>
        <td>${(b.coupon * 100).toFixed(3)}%</td>
        <td>${b.price.toFixed(3)}</td>
        <td>${(b.askYield * 100).toFixed(3)}%</td>
        <td class="drillable" data-cusip="${b.cusip}">${(b.saYield * 100).toFixed(3)}%</td>
        <td style="font-weight:700; color:#1a56db;" class="drillable" data-cusip="${b.cusip}">${(b.saoYield * 100).toFixed(3)}%</td>
        <td class="${b.diffBps >= 0 ? 'pos' : 'neg'}">${b.diffBps.toFixed(1)}</td>
      </tr>`).join('');
  }
}

// A dataset's SHOW-row key, from its legend label. "Spot SA (Fed)" → SpotSA before the
// generic first-word split so it doesn't read as "Spot".
function tipsSeriesKey(label) {
  if (label.startsWith('Spot SA')) return 'SpotSA';
  if (label.startsWith('Spot')) return 'Spot';
  if (label.startsWith('GSW')) return 'GSW';
  return label.split(' ')[0];   // Ask, SA, SAO
}
const TIPS_SHOW_EL = { Ask: 'showTipsAsk', SA: 'showTipsSa', SAO: 'showTipsSao', Spot: 'showTipsSpot', SpotSA: 'showTipsSpotSa', GSW: 'showTipsGsw' };
function getTipsSeriesVisibility(label) {
  const el = TIPS_SHOW_EL[tipsSeriesKey(label)];
  return el ? document.getElementById(el).checked : true;
}

// Shared x-scale builder for TIPS-maturity-keyed yield charts (TIPS tab, BEI tab):
// linear term (weeks) scale in Term mode, calendar time scale in Maturity mode.
function buildYieldXScale(allPoints) {
  if (xAxisMode === 'ttm') {
    const rawMaxW = Math.max(...allPoints.map(d => d.x));
    const maxW = Math.ceil(rawMaxW / 52) * 52;
    const ttmTickCb = (val) => {
      if (val < 0) return '';
      if (val >= 52) {
        const wy = Math.floor(val / 52);
        const rm = Math.round((val / 52 - wy) * 12);
        if (rm === 0) return `${wy}y`;
        if (rm === 12) return `${wy + 1}y`;
        return `${wy}y ${rm}m`;
      }
      if (val >= 4) return `${Math.round(val / 4.348)}m`;
      return `${Math.round(val)}w`;
    };
    return {
      type: 'linear',
      min: 0, max: maxW,
      afterBuildTicks: scale => {
        const span = scale.max - scale.min;
        const ticks = [];
        if (span > 260) {
          const start = Math.ceil(Math.max(scale.min, 0) / 52) * 52;
          for (let v = start; v <= scale.max; v += 52) ticks.push({ value: v });
        } else if (span > 104) {
          const start = Math.ceil(Math.max(scale.min, 0) / 26) * 26;
          for (let v = start; v <= scale.max; v += 26) ticks.push({ value: v });
        } else if (span > 52) {
          const start = Math.ceil(Math.max(scale.min, 0) / 13) * 13;
          for (let v = start; v <= scale.max; v += 13) ticks.push({ value: v });
        } else if (span > 12) {
          const start = Math.ceil(Math.max(scale.min, 0) / 4) * 4;
          for (let v = start; v <= scale.max; v += 4) ticks.push({ value: v });
        } else {
          const start = Math.ceil(Math.max(scale.min, 0));
          for (let v = start; v <= scale.max; v += 1) ticks.push({ value: v });
        }
        scale.ticks = ticks;
      },
      grid: { color: 'rgba(0,0,0,0.05)' },
      ticks: { maxRotation: 0, callback: ttmTickCb }
    };
  }
  const minDate = new Date(Math.min(...allPoints.map(d => d.x)));
  const maxDate = new Date(Math.max(...allPoints.map(d => d.x)));
  const _startDt = parseIsoInput(document.getElementById('startMaturity').value);
  const _endDt   = parseIsoInput(document.getElementById('endMaturity').value);
  const minX = _startDt
    ? new Date(_startDt.getFullYear(), _startDt.getMonth(), 1).getTime()
    : new Date(minDate.getFullYear(), 0, 1).getTime();
  const maxX = _endDt
    ? new Date(_endDt.getFullYear(), _endDt.getMonth() + 1, 1).getTime()
    : new Date(maxDate.getFullYear() + 1, 0, 1).getTime();
  return {
    type: 'time',
    min: minX, max: maxX,
    time: { displayFormats: { year: 'yyyy', month: 'MMM yyyy' } },
    ...calendarTimeAxis({ gridColor: 'rgba(0,0,0,0.05)' }),
  };
}

// Nearest-maturity nominal (Bills/Notes/Bonds, no STRIPS) for a TIPS maturity date — the BEI tab's "closest maturity nominal".
function findClosestNominal(nominals, maturityDate) {
  let best = null, bestDiff = Infinity;
  for (const n of nominals) {
    const diff = Math.abs(n.maturityDate.getTime() - maturityDate.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = n; }
  }
  return best;
}

function renderChart(fedBonds, brokerBonds) {
  const ctx = document.getElementById('yieldChart').getContext('2d');
  const allBonds = [...(fedBonds || []), ...(brokerBonds || [])];
  if (allBonds.length === 0) { if (chart) { chart.destroy(); chart = null; } return; }

  const now = Date.now();
  const toPt = xAxisMode === 'ttm'
    ? (b, key) => ({ x: (b.maturityDate.getTime() - now) / (7 * 86400000), y: parseFloat((b[key] * 100).toFixed(3)) })
    : (b, key) => ({ x: b.maturityDate.getTime(), y: parseFloat((b[key] * 100).toFixed(3)) });
  const both = fedBonds && brokerBonds;
  const seriesDef = [];

  if (fedBonds) {
    const sfx = both ? ' (Fed)' : '';
    seriesDef.push(
      { label: `Ask${sfx}`, data: fedBonds.map(b => toPt(b, 'askYield')), color: '#94a3b8', style: 'circle', w: 1.5, r: 1.25, dash: [4, 4] },
      { label: `SA${sfx}`,  data: fedBonds.map(b => toPt(b, 'saYield')),  color: '#475569', style: 'circle', w: 1.8, r: 1.25, dash: [4, 4] },
      { label: `SAO${sfx}`, data: fedBonds.map(b => toPt(b, 'saoYield')), color: '#1a56db', style: 'circle', w: 2.2, r: 1.25, dash: [4, 4] }
    );
  }
  if (brokerBonds) {
    const sfx = both ? ' (Market)' : '';
    seriesDef.push(
      { label: `Ask${sfx}`, data: brokerBonds.map(b => toPt(b, 'askYield')), color: '#f97316', style: 'circle', w: 1.5, r: 1.25, dash: [] },
      { label: `SA${sfx}`,  data: brokerBonds.map(b => toPt(b, 'saYield')),  color: '#dc2626', style: 'circle', w: 1.8, r: 1.25, dash: [] },
      { label: `SAO${sfx}`, data: brokerBonds.map(b => toPt(b, 'saoYield')), color: '#059669', style: 'circle', w: 2.2, r: 1.25, dash: [] }
    );
  }

  // Zero-coupon (spot) curves, per source: one fitted to the quoted ask yields, one to the
  // seasonally adjusted yields (spotCurveGrid → fitSpotNSS in price space). Plus the GSW
  // reference (?gsw only).
  const yToX = yearsToX(now);
  const curveSrc = [];
  if (fedBonds)    curveSrc.push({ bonds: fedBonds,    sfx: both ? ' (Fed)' : '',    color: '#1a56db' });
  if (brokerBonds) curveSrc.push({ bonds: brokerBonds, sfx: both ? ' (Market)' : '', color: '#b45309' });
  for (const { bonds, sfx, color } of curveSrc) {
    const ask = spotCurveGrid(bonds, { priceOf: b => b.price, yieldOf: b => b.askYield, yToX });
    if (ask) seriesDef.push({ label: `Spot${sfx}`, data: ask, color, curve: true, w: 2.25, dash: [], style: 'circle', r: 0, markerR: 2 });
    const sa = spotCurveGrid(bonds, { priceOf: b => b.price * b.saRatio, yieldOf: b => b.saYield, yToX });
    if (sa) seriesDef.push({ label: `Spot SA${sfx}`, data: sa, color, curve: true, w: 2.25, dash: [2, 3], style: 'circle', r: 0, markerR: 2 });
  }
  // GSW zero reference (analysis aid, ?gsw only): evaluate its published Svensson parameters
  // (weekly R2 pull) on the same half-year grid, converted to the semi-annual basis. Falls
  // back to a baked-in snapshot if the R2 file is unavailable.
  if (SHOW_GSW) {
  let gswData, gswDate;
  if (gswTipsCurve) {
    gswDate = gswTipsCurve.date;
    const { beta0, beta1, beta2, beta3, tau1, tau2 } = gswTipsCurve;
    gswData = [];
    for (let t = 2; t <= 20 + 1e-9; t += 0.5) {   // GSW fits to 20y — don't extrapolate past it
      const p = _nssBasis(t, tau1, tau2);
      const zc = beta0 * p[0] + beta1 * p[1] + beta2 * p[2] + beta3 * p[3];   // % continuous
      gswData.push({ x: yToX(t), y: parseFloat(zToSA(zc).toFixed(3)) });
    }
  } else {
    gswDate = GSW_TIPS_ZERO_SNAPSHOT.date;
    gswData = GSW_TIPS_ZERO_SNAPSHOT.points.map(([t, y]) => ({ x: yToX(t), y }));
  }
  seriesDef.push({
    label: `GSW zero ${gswDate}`,
    data: gswData,
    color: '#111827', curve: true, w: 1.5, dash: [6, 4], style: 'circle', r: 0, markerR: 3,
  });
  }

  const activeSeries = seriesDef.filter(s => s.data.length > 0);
  const allPoints = activeSeries.flatMap(s => s.data);
  const xScale = buildYieldXScale(allPoints);
  const allY = allPoints.map(d => d.y);
  const minY = Math.floor(Math.min(...allY) * 4) / 4;
  const maxY = Math.ceil(Math.max(...allY) * 4) / 4;

  const zoomToRestore = savedZoom['tips'];
  if (chart && chartTab && savedZoom[chartTab] !== null) savedZoom[chartTab] = {
    xMin: chart.scales.x.min, xMax: chart.scales.x.max,
    yMin: chart.scales.y.min, yMax: chart.scales.y.max
  };
  if (chart) chart.destroy();
  chartTab = 'tips';
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: activeSeries.map(s => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: s.w,
        borderDash: s.dash,
        pointRadius: s.curve ? (s.markerR ?? 0) : s.r,
        pointHoverRadius: s.curve ? 5 : undefined,
        pointStyle: s.style,
        tension: s.curve ? 0.3 : 0.1,
        hidden: !getTipsSeriesVisibility(s.label)
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: xScale,
        y: { type: 'linear', title: { display: true, text: 'Yield (%)' }, min: minY, max: maxY, ticks: { stepSize: 0.25, callback: (v) => v.toFixed(2) } }
      },
      plugins: {
        legend: {
          labels: { filter: (item) => !item.hidden, usePointStyle: true, boxWidth: 8, padding: 15, font: { size: 13, weight: '500' } },
          onClick: null
        },
        zoom: {
          pan: { enabled: true, mode: 'xy' },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy', onZoomComplete: ({chart}) => rescaleToVisible(chart) }
        },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.95)', titleColor: '#1e293b', bodyColor: '#475569', borderColor: '#e2e8f0', borderWidth: 1, padding: 8, cornerRadius: 6, displayColors: false,
          callbacks: {
            title: (items) => {
              const ms = xAxisMode === 'ttm'
                ? now + items[0].parsed.x * 7 * 86400000
                : items[0].parsed.x;
              const yrs = (ms - now) / (365.25 * 86400000);
              return `${fmtDateMDY(new Date(ms))} · ${yrs.toFixed(1)}y`;
            },
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`
          }
        }
      }
    }
  });

  if (zoomToRestore) {
    chart.options.scales.x.min = zoomToRestore.xMin;
    chart.options.scales.x.max = zoomToRestore.xMax;
    chart.options.scales.y.min = zoomToRestore.yMin;
    chart.options.scales.y.max = zoomToRestore.yMax;
    chart.update('none');
  } else {
    rescaleToVisible(chart);
  }

  setupAxisWheelZoom(chart.canvas, ({chart}) => rescaleToVisible(chart), ({chart, factor}) => snapYAfterZoom(chart, factor));

}

function rescaleToVisible(chart) {
  const xMin = chart.scales.x.min;
  const xMax = chart.scales.x.max;
  let allVisibleY = [];

  chart.data.datasets.forEach((dataset, i) => {
    if (!chart.isDatasetVisible(i)) return;
    dataset.data.forEach(p => { if (p.x >= xMin && p.x <= xMax) allVisibleY.push(p.y); });
  });

  if (allVisibleY.length === 0) return;

  if (nominalsClipOutliers && chartTab === 'treasuries' && allVisibleY.length >= 4) {
    // Use Bills/Notes yields for IQR (outliers live in short-dated issues; bonds widen IQR too much)
    const nearMaturityVisibleY = [];
    chart.data.datasets.forEach((dataset, i) => {
      if (!chart.isDatasetVisible(i) || !(dataset.label.includes('Notes') || dataset.label.includes('Bills'))) return;
      dataset.data.forEach(p => { if (p.x >= xMin && p.x <= xMax) nearMaturityVisibleY.push(p.y); });
    });
    const nearMaturityVisibleYPos = nearMaturityVisibleY.filter(y => y > 0);
    if (nearMaturityVisibleYPos.length >= 4) {
      const bounds = iqrClipBounds(nearMaturityVisibleYPos);
      if (bounds) {
        const clipped = allVisibleY.filter(y => y >= bounds.lo && y <= bounds.hi);
        if (clipped.length > 0) allVisibleY = clipped;
      }
    }
  }

  if (beiClipOutliers && chartTab === 'bei' && allVisibleY.length >= 4) {
    const bounds = iqrClipBounds(allVisibleY);
    if (bounds) {
      const clipped = allVisibleY.filter(y => y >= bounds.lo && y <= bounds.hi);
      if (clipped.length > 0) allVisibleY = clipped;
    }
  }

  const visibleMinY = Math.min(...allVisibleY);
  const visibleMaxY = Math.max(...allVisibleY);
  const bounds = snapYBounds(visibleMinY, visibleMaxY);
  chart.options.scales.y.min = bounds.min;
  chart.options.scales.y.max = bounds.max;
  chart.options.scales.y.ticks.stepSize = bounds.step;
  chart.update('none');
}


// ─── BEI (Breakeven Inflation) ───────────────────────────────────────────────
// BEI = closest-maturity nominal yield (Market, no STRIPS) − TIPS yield, for each of the
// TIPS Ask/SA/SAO variants. Market-only: BEI needs both legs quoted the same way (broker
// ask), so it doesn't mix in FedInvest's bid/ask-midpoint pricing the way the TIPS tab does.

function processAndRenderBei() {
  const statusEl = document.getElementById('status');

  if (!brokerPrices || !fidelityNominalsData) {
    statusEl.textContent = 'BEI requires Market (Fidelity) TIPS and nominal data.';
    statusEl.className = '';
    if (chart) { chart.destroy(); chart = null; }
    document.getElementById('beiTableBody').innerHTML = '';
    return;
  }
  if (!rawYieldsData || rawYieldsData.length === 0 || !rawRefCpiData) return;

  try {
    const tipsBonds = buildProcessedTipsBonds(brokerPrices, true);
    const smoothed = calculateSAO(tipsBonds);
    tipsBonds.forEach((b, i) => { b.saoYield = smoothed[i]; });

    const nominalCandidates = fidelityNominalsData.filter(b => b.type !== 'MARKET BASED STRIP');
    if (nominalCandidates.length === 0) {
      statusEl.textContent = 'No market nominal data available for BEI.';
      if (chart) { chart.destroy(); chart = null; }
      document.getElementById('beiTableBody').innerHTML = '';
      return;
    }

    tipsBonds.forEach(b => {
      const nom = findClosestNominal(nominalCandidates, b.maturityDate);
      b.nominalCusip = nom.cusip;
      b.nominalMaturity = nom.maturity;
      b.nominalCoupon = nom.coupon;
      b.nominalYield = nom.yield;
      b.beiAsk = nom.yield - b.askYield;
      b.beiSa = nom.yield - b.saYield;
      b.beiSao = nom.yield - b.saoYield;
    });

    // Spot BEI: the nominal zero curve minus the seasonally adjusted real zero curve, on a
    // horizon grid — a true same-horizon breakeven at every point, unlike the per-bond
    // closest-maturity match above.
    const yToX = yearsToX(Date.now());
    const nomFit = spotCurveFit(
      nominalCandidates.filter(n => n.type === 'MARKET BASED NOTE' || n.type === 'MARKET BASED BOND'),
      { priceOf: n => n.price, yieldOf: n => n.yield, minT: 1 });
    const saFit = spotCurveFit(tipsBonds, { priceOf: b => b.price * b.saRatio, yieldOf: b => b.saYield });
    let spotBeiGrid = null;
    if (nomFit && saFit) {
      spotBeiGrid = [];
      const t0 = Math.max(2, Math.ceil(Math.max(nomFit.tMin, saFit.tMin) * 2) / 2);
      const t1 = Math.min(nomFit.tMax, saFit.tMax);
      for (let t = t0; t <= t1 + 1e-9; t += 0.5) {
        const zn = zToSA(nomFit.z(t)), zr = zToSA(saFit.z(t));
        if (nomFit.sane(zn) && saFit.sane(zr)) spotBeiGrid.push({ x: yToX(t), y: parseFloat((zn - zr).toFixed(3)) });
      }
      if (spotBeiGrid.length < 3) spotBeiGrid = null;
    }

    const startEl = document.getElementById('startMaturity');
    const endEl = document.getElementById('endMaturity');
    if (!startEl.value && tipsBonds.length > 0) {
      startEl.value = tipsBonds[0].maturity;
      endEl.value = tipsBonds[tipsBonds.length - 1].maturity;
    }
    const startDate = parseIsoInput(startEl.value) || new Date(0);
    const endDate = parseIsoInput(endEl.value) || new Date(9999, 0);
    const filtered = tipsBonds.filter(b => b.maturityDate >= startDate && b.maturityDate <= endDate);

    renderBeiTable(filtered);
    renderBeiChart(filtered, spotBeiGrid);

    if (brokerDownloadDate) {
      const loadDate = parseFidelityDateStr(brokerDownloadDate);
      const t1 = nextBusinessDay(loadDate, holidaySet);
      document.getElementById('tipsMktMeta').textContent = `${fmtBrokerTime(brokerDownloadDate)} ET · settle ${isoToMDY(toIsoDate(t1))} (T+1)`;
    } else {
      document.getElementById('tipsMktMeta').textContent = '';
    }
    document.getElementById('tipsBrokerCount').textContent = filtered.length;
    document.getElementById('tipsFedMeta').textContent = '';
    document.getElementById('tipsFedCount').textContent = '';
    statusEl.textContent = '';
    statusEl.className = '';
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = 'error';
    console.error('processAndRenderBei failed:', err);
  }
}

function getBeiSeriesVisibility(label) {
  if (label === 'Ask BEI') return document.getElementById('showBeiAsk').checked;
  if (label === 'SA BEI') return document.getElementById('showBeiSa').checked;
  if (label === 'SAO BEI') return document.getElementById('showBeiSao').checked;
  if (label === 'Spot BEI') return document.getElementById('showBeiSpot').checked;
  return true;
}

function renderBeiChart(bonds, spotBeiGrid) {
  const ctx = document.getElementById('yieldChart').getContext('2d');
  if (!bonds || bonds.length === 0) { if (chart) { chart.destroy(); chart = null; } return; }

  const now = Date.now();
  const toPt = xAxisMode === 'ttm'
    ? (b, key) => ({ x: (b.maturityDate.getTime() - now) / (7 * 86400000), y: parseFloat((b[key] * 100).toFixed(3)) })
    : (b, key) => ({ x: b.maturityDate.getTime(), y: parseFloat((b[key] * 100).toFixed(3)) });

  const seriesDef = [
    { label: 'Ask BEI', data: bonds.map(b => toPt(b, 'beiAsk')), color: '#f97316', style: 'circle', w: 1.5, r: 1.25 },
    { label: 'SA BEI',  data: bonds.map(b => toPt(b, 'beiSa')),  color: '#dc2626', style: 'circle', w: 1.8, r: 1.25 },
    { label: 'SAO BEI', data: bonds.map(b => toPt(b, 'beiSao')), color: '#059669', style: 'circle', w: 2.2, r: 1.25 },
  ];
  if (spotBeiGrid) seriesDef.push({ label: 'Spot BEI', data: spotBeiGrid, color: '#1a56db', style: 'circle', w: 2.5, r: 0, markerR: 2, curve: true });

  const activeSeries = seriesDef.filter(s => s.data.length > 0);
  const allPoints = activeSeries.flatMap(s => s.data);
  const xScale = buildYieldXScale(allPoints);
  const allY = allPoints.map(d => d.y);
  let scaleY = allY;
  if (beiClipOutliers && allY.length >= 4) {
    const bounds = iqrClipBounds(allY);
    if (bounds) {
      const clipped = allY.filter(y => y >= bounds.lo && y <= bounds.hi);
      if (clipped.length > 0) scaleY = clipped;
    }
  }
  const minY = Math.floor(Math.min(...scaleY) * 4) / 4;
  const maxY = Math.ceil(Math.max(...scaleY) * 4) / 4;

  const zoomToRestore = savedZoom['bei'];
  if (chart && chartTab && savedZoom[chartTab] !== null) savedZoom[chartTab] = {
    xMin: chart.scales.x.min, xMax: chart.scales.x.max,
    yMin: chart.scales.y.min, yMax: chart.scales.y.max
  };
  if (chart) chart.destroy();
  chartTab = 'bei';
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: activeSeries.map(s => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: s.w,
        pointRadius: s.curve ? (s.markerR ?? 0) : s.r,
        pointHoverRadius: s.curve ? 5 : undefined,
        pointStyle: s.style,
        tension: s.curve ? 0.3 : 0.1,
        hidden: !getBeiSeriesVisibility(s.label)
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: xScale,
        y: { type: 'linear', title: { display: true, text: 'Breakeven Inflation (%)' }, min: minY, max: maxY, ticks: { stepSize: 0.25, callback: (v) => v.toFixed(2) } }
      },
      plugins: {
        legend: {
          labels: { filter: (item) => !item.hidden, usePointStyle: true, boxWidth: 8, padding: 15, font: { size: 13, weight: '500' } },
          onClick: null
        },
        zoom: {
          pan: { enabled: true, mode: 'xy' },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy', onZoomComplete: ({chart}) => rescaleToVisible(chart) }
        },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.95)', titleColor: '#1e293b', bodyColor: '#475569', borderColor: '#e2e8f0', borderWidth: 1, padding: 8, cornerRadius: 6, displayColors: false,
          callbacks: {
            title: (items) => {
              const ms = xAxisMode === 'ttm'
                ? now + items[0].parsed.x * 7 * 86400000
                : items[0].parsed.x;
              const yrs = (ms - now) / (365.25 * 86400000);
              return `${fmtDateMDY(new Date(ms))} · ${yrs.toFixed(1)}y`;
            },
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`
          }
        }
      }
    }
  });

  if (zoomToRestore) {
    chart.options.scales.x.min = zoomToRestore.xMin;
    chart.options.scales.x.max = zoomToRestore.xMax;
    chart.options.scales.y.min = zoomToRestore.yMin;
    chart.options.scales.y.max = zoomToRestore.yMax;
    chart.update('none');
  } else {
    rescaleToVisible(chart);
  }

  setupAxisWheelZoom(chart.canvas, ({chart}) => rescaleToVisible(chart), ({chart, factor}) => snapYAfterZoom(chart, factor));
}

function renderBeiTable(bonds) {
  const tbody = document.getElementById('beiTableBody');
  const fmtY = y => (y != null && !isNaN(y)) ? (y * 100).toFixed(3) + '%' : '—';
  tbody.innerHTML = bonds.map(b => `
    <tr>
      <td>${isoToMDY2(b.maturity)}</td>
      <td>${(b.coupon * 100).toFixed(3)}%</td>
      <td>${fmtY(b.askYield)}</td>
      <td>${fmtY(b.saYield)}</td>
      <td>${fmtY(b.saoYield)}</td>
      <td>${isoToMDY2(b.nominalMaturity)}</td>
      <td>${(b.nominalCoupon * 100).toFixed(3)}%</td>
      <td>${fmtY(b.nominalYield)}</td>
      <td>${fmtY(b.beiAsk)}</td>
      <td>${fmtY(b.beiSa)}</td>
      <td style="font-weight:700; color:#1a56db;">${fmtY(b.beiSao)}</td>
    </tr>`).join('');
}


// ─── Spread Mode ─────────────────────────────────────────────────────────────

function updateModeToggle() {
  const isBei = activeTab === 'bei';
  const hasMarket = activeTab === 'tips' ? !!brokerPrices : !!fidelityNominalsData;
  const spreadBtn = document.querySelector('#chart-mode-tabs .tab-btn[data-mode="spread"]');
  if (!spreadBtn) return;
  // BEI has no bid/ask-spread concept — always disabled there, regardless of Market data.
  spreadBtn.disabled = isBei || !hasMarket;
  if ((isBei || !hasMarket) && spreadModeActive) {
    spreadModeActive = false;
    switchChartMode('yield');
  }
  const currentMode = spreadModeActive ? 'spread' : 'yield';
  document.querySelectorAll('#chart-mode-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === currentMode));
}

function switchChartMode(mode) {
  const isSpread = mode === 'spread';
  document.getElementById('yieldChartWrap').style.display = isSpread ? 'none' : '';
  const sw = document.getElementById('spreadChartWrap');
  sw.style.display = isSpread ? 'flex' : 'none';
  // Force synchronous reflow so Chart.js measures correct container size on next render
  if (isSpread) void sw.offsetWidth;
  if (!isSpread) {
    if (spreadChart1) { spreadChart1.destroy(); spreadChart1 = null; }
    if (spreadChart2) { spreadChart2.destroy(); spreadChart2 = null; }
  }
  const isBei = activeTab === 'bei';
  document.getElementById('tipsControls').style.display     = (activeTab === 'tips' && !isSpread) ? 'flex' : 'none';
  document.getElementById('nominalsControls').style.display = (activeTab === 'treasuries') ? 'flex' : 'none';
  document.getElementById('beiControls').style.display      = isBei ? 'flex' : 'none';

  // FedInvest is irrelevant in spread mode AND on the BEI tab (both use Market data only)
  const fedId = activeTab === 'treasuries' ? 'chkFedInvest' : 'chkTipsFed';
  const chkFed = document.getElementById(fedId);
  const lockFed = isSpread || isBei;
  if (chkFed) {
    const fedLabel = chkFed.closest('label');
    if (lockFed) {
      // Only save the original checked state when first entering a locked mode.
      // switchChartMode() is re-called on every tab switch while spread/BEI is
      // active, so we must not overwrite _savedChecked with the already-forced-false
      // value, or restoration on exit will incorrectly leave FedInvest unchecked.
      if (!chkFed.disabled) {
        chkFed._savedChecked = chkFed.checked;
      }
      chkFed.checked = false;
      chkFed.disabled = true;
      if (fedLabel) fedLabel.style.opacity = '0.4';
    } else {
      // Only restore checked state when actually leaving a locked mode (chkFed.disabled
      // means spread/BEI had forced it off). A plain tab switch must never touch checked —
      // that's how the user's FedInvest/Market selection carries over between tabs.
      if (chkFed.disabled) {
        chkFed.checked = chkFed._savedChecked !== undefined ? chkFed._savedChecked : false;
        chkFed._savedChecked = undefined;
      }
      chkFed.disabled = false;
      if (fedLabel) fedLabel.style.opacity = '';
    }
  }

  // BEI's Market/broker checkbox is locked ON too — it's the tab's sole data source
  // (both TIPS and nominal legs), not a toggle. Spread mode never touches this checkbox,
  // so any disabled state found here on entry/exit is BEI's own lock.
  const chkBroker = document.getElementById('chkTipsBroker');
  if (chkBroker) {
    const brokerLabel = chkBroker.closest('label');
    if (isBei) {
      if (!chkBroker.disabled) chkBroker._savedChecked = chkBroker.checked;
      chkBroker.checked = !!brokerPrices;
      chkBroker.disabled = true;
      if (brokerLabel) brokerLabel.style.opacity = '0.4';
    } else if (chkBroker._savedChecked !== undefined) {
      chkBroker.checked = chkBroker._savedChecked;
      chkBroker.disabled = !brokerPrices;
      if (brokerLabel) brokerLabel.style.opacity = brokerPrices ? '' : '0.4';
      chkBroker._savedChecked = undefined;
    }
  }
}

// A point counts as an outlier for axis-bounds purposes only if it falls
// outside the IQR fence computed from its own nearby-maturity neighbors —
// the same "local fence" idea _kernelAverageTrend uses so an isolated spike
// doesn't skew its own local average. A single fence over the *whole* series
// doesn't work for either chart here: it's too loose to catch a spike that's
// only extreme relative to its tight neighborhood (a lone near-maturity
// blip), and it's too tight when most of the series sits in one dense low
// cluster and a real, gradual trend (e.g. price spread widening through the
// long end) is high only relative to that unrelated cluster, not to its own
// neighbors — a whole-series fence wrongly hides that entire genuine rise.
function _localOutlierMask(points, bandwidthYears = 1.5, minPoints = 4) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const bandwidth = bandwidthYears * _YEAR_MS;
  return points.map((p, i) => {
    const dists = xs.map(x => Math.abs(x - p.x));
    let idxs = dists.reduce((acc, d, j) => { if (d <= bandwidth && j !== i) acc.push(j); return acc; }, []);
    if (idxs.length < minPoints) {
      idxs = dists.map((d, j) => j).filter(j => j !== i).sort((a, b) => dists[a] - dists[b]).slice(0, minPoints);
    }
    if (idxs.length < 4) return false;
    const fence = iqrClipBounds(idxs.map(j => ys[j]), 0);  // no minimum fence — spread values are small-magnitude
    return fence ? (p.y < fence.lo || p.y > fence.hi) : false;
  });
}
// Shared by initial chart creation and every rescale (zoom/pan/reset/legend
// toggle) so "clip outliers" means the same thing everywhere, not just on
// first load — mirrors the pattern rescaleToVisible() uses for the Yield
// Curves chart.
function _clippedYRange(points, shouldClip) {
  const ys = points.map(p => p.y);
  if (!shouldClip || points.length < 4) return { min: Math.min(...ys), max: Math.max(...ys) };
  const mask = _localOutlierMask(points);
  const kept = points.filter((p, i) => !mask[i]).map(p => p.y);
  const yForScale = kept.length > 0 ? kept : ys;
  return { min: Math.min(...yForScale), max: Math.max(...yForScale) };
}
function _rescaleSpread(chartInst) {
  const xMin = chartInst.scales.x.min, xMax = chartInst.scales.x.max;
  const visPts = [];
  chartInst.data.datasets.forEach((ds, i) => {
    if (!chartInst.isDatasetVisible(i)) return;
    if (ds.type === 'line') return; // trend line, not raw data — exclude from outlier fence
    ds.data.forEach(p => { if (p.x >= xMin && p.x <= xMax) visPts.push(p); });
  });
  if (visPts.length === 0) return;
  const range = _clippedYRange(visPts, chartInst._clipOutliers);
  const bounds = snapYBounds(range.min, range.max);
  chartInst.options.scales.y.min = bounds.min;
  chartInst.options.scales.y.max = bounds.max;
  chartInst.options.scales.y.ticks.stepSize = bounds.step;
  chartInst.update('none');
}

// Kernel-weighted local average (Nadaraya-Watson) over a series sorted by
// maturity date — draws a smooth trend line giving a visual impression of the
// average spread by maturity. Evaluated on an evenly-spaced grid (not at the
// original, unevenly-spaced data points) so the curve itself renders smoothly
// regardless of how clustered the underlying data is (e.g. Bills bunching at
// the short end vs. Bonds spread thinly across decades). Unlike a locally
// weighted *regression* (LOESS), a weighted average can never overshoot the
// data in its window, so it stays visually calm even where a series has few,
// noisy points (e.g. Bills/Notes at the short end) instead of zigzagging.
//
// Bandwidth is a fixed, *absolute* maturity distance (years), not a fraction
// of the series' own x-range and not a fixed point count. A fraction of the
// full range (e.g. 20% of a ~30yr curve ≈ 6yrs) is wide enough to smooth the
// densely-packed short end, but on the same series it is still far wider than
// the ~1-2yr spacing of the sparse long end — so it washes out real swings
// that happen point-to-point out there (e.g. a rise into 2052 followed by a
// sharp drop by 2053). A small fixed point count (k-nearest) overcorrects the
// other way: in a dense cluster the k nearest points span too short a
// distance, so it starts chasing per-bond noise instead of the local average.
// A fixed absolute-distance window adapts the way both those failed to: at a
// ~1-2yr bandwidth, a densely-packed region (many points per year) still
// pulls in a wide, smoothing set of neighbors, while a sparse tail (~1 point
// per year) pulls in only the couple of points actually nearby, so the curve
// tracks them almost point-for-point.
//
// Yields on soon-to-mature TIPS are notoriously erratic (thin liquidity right
// before maturity) — most often the very first bond to mature, since it's the
// one furthest into that illiquid window. A *global* IQR fence over the whole
// series can't catch this reliably: it's too loose to flag a spike that's
// only extreme relative to its own tight neighborhood (a single spike inside
// a dense cluster), and it can wrongly suppress two genuinely close, mutually
// -corroborating points whose *level* just happens to be extreme relative to
// the rest of the series (e.g. a real local peak at the sparse long end).
// So the fence is computed fresh per grid point, from just the points inside
// that point's own window — using the same `iqrClipBounds` helper the Y-axis
// "Clip Outliers" scaling already uses, so there's one definition of "outlier
// fence" for the whole app. This only reshapes the fitted line; the raw
// scatter points are never altered.
const _YEAR_MS = 365.25 * 24 * 3600 * 1000;
function _kernelAverageTrend(points, bandwidthYears = 1.5, gridSize = 200, minPoints = 3) {
  const n = points.length;
  if (n < 5) return null;
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const xs = sorted.map(p => p.x), ys = sorted.map(p => p.y);
  const xMin = xs[0], xMax = xs[n - 1];
  if (xMax === xMin) return null;
  const bandwidth = bandwidthYears * _YEAR_MS;

  const trend = [];
  for (let g = 0; g < gridSize; g++) {
    const gx = xMin + (xMax - xMin) * g / (gridSize - 1);
    const dists = xs.map(x => Math.abs(x - gx));

    // All points within the fixed bandwidth; if too few (sparse tail), fall
    // back to the nearest `minPoints` regardless of distance.
    let idxs = dists.reduce((acc, d, i) => { if (d <= bandwidth) acc.push(i); return acc; }, []);
    let h = bandwidth;
    if (idxs.length < Math.min(minPoints, n)) {
      idxs = dists.map((d, i) => i).sort((a, b) => dists[a] - dists[b]).slice(0, minPoints);
      h = Math.max(...idxs.map(i => dists[i])) || 1;
    }

    // Clip this window's y-values to their own local IQR fence before
    // averaging — an outlier only relative to its immediate neighbors still
    // gets tamed, without touching a level that's normal for its own window.
    const windowYs = idxs.map(i => ys[i]);
    const fence = idxs.length >= 4 ? iqrClipBounds(windowYs, 0) : null;

    // Tricube-weighted average of y within the local window.
    let sumW = 0, sumWY = 0;
    for (const i of idxs) {
      const u = Math.min(dists[i] / h, 1);
      const w = (1 - u * u * u) ** 3;
      const y = fence ? Math.min(fence.hi, Math.max(fence.lo, ys[i])) : ys[i];
      sumW += w; sumWY += w * y;
    }
    trend.push({ x: gx, y: sumWY / sumW });
  }
  return trend;
}

function _makeSpreadChart(ctx, seriesDef, yAxisLabel, yUnit, shouldClip) {
  const allPoints = seriesDef.flatMap(s => s.data);
  if (allPoints.length === 0) return null;
  const _startDt = parseIsoInput(document.getElementById('startMaturity').value);
  const _endDt   = parseIsoInput(document.getElementById('endMaturity').value);
  const allX = allPoints.map(d => d.x);
  const minDate = new Date(Math.min(...allX));
  const maxDate = new Date(Math.max(...allX));
  const minX = _startDt
    ? new Date(_startDt.getFullYear(), _startDt.getMonth(), 1).getTime()
    : new Date(minDate.getFullYear(), 0, 1).getTime();
  const maxX = _endDt
    ? new Date(_endDt.getFullYear(), _endDt.getMonth() + 1, 1).getTime()
    : new Date(maxDate.getFullYear() + 1, 0, 1).getTime();
  // IQR-clip Y axis to suppress near-maturity outliers (respects Clip Outliers checkbox)
  const initRange = _clippedYRange(allPoints, shouldClip);
  const initBounds = snapYBounds(initRange.min, initRange.max);

  const newChart = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        ...seriesDef.map(s => ({
          label: s.label, data: s.data,
          backgroundColor: s.color, borderColor: s.color, borderWidth: 1.5,
          pointStyle: 'crossRot',
          pointRadius: s.r + 1.5, pointHoverRadius: s.r + 3,
        })),
        ...seriesDef.filter(s => s.trend).map(s => ({
          type: 'line',
          label: `${s.label} (Avg)`,
          data: s.trend,
          borderColor: s.color,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0, pointHoverRadius: 0,
          tension: 0.15,
          order: -1,
        })),
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', axis: 'xy', intersect: false },
      scales: {
        x: {
          type: 'time', min: minX, max: maxX,
          time: xAxisMode === 'ttm' ? { displayFormats: {} } : { displayFormats: { year: 'yyyy', month: 'MMM yyyy' } },
          grid: { color: 'rgba(0,0,0,0.05)' },
          ...(xAxisMode === 'ttm'
            ? { ticks: { autoSkip: true, maxRotation: 0, callback: (val, idx, ticks) => { if (!ticks || ticks.length < 2) return ttmLabel(val); const spanDays = (ticks[ticks.length-1].value - ticks[0].value) / 86400000; const days = (val - Date.now()) / 86400000; if (days <= 0) return ''; if (spanDays <= 91) return `${Math.round(days / 7)}w`; if (spanDays <= 365) return `${Math.round(days / 30.44)}m`; const yrs = days / 365.25; const wy = Math.floor(yrs); const rm = Math.round((yrs - wy) * 12); if (rm === 0) return `${wy}y`; if (rm === 12) return `${wy + 1}y`; if (wy === 0) return `${rm}m`; return `${wy}y ${rm}m`; } } }
            : calendarTimeAxis()
          ),
        },
        y: {
          type: 'linear', title: { display: true, text: yAxisLabel },
          min: initBounds.min, max: initBounds.max,
          ticks: { stepSize: initBounds.step, callback: v => v.toFixed(2) }
        }
      },
      plugins: {
        legend: {
          labels: { usePointStyle: true, boxWidth: 8, padding: 12, font: { size: 11, weight: '500' } },
          onClick: (e, legendItem, legend) => { Chart.defaults.plugins.legend.onClick(e, legendItem, legend); _rescaleSpread(legend.chart); }
        },
        zoom: {
          pan: { enabled: true, mode: 'xy' },
          zoom: {
            wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy',
            onZoomComplete: ({ chart }) => _rescaleSpread(chart)
          }
        },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.95)', titleColor: '#1e293b', bodyColor: '#475569',
          borderColor: '#e2e8f0', borderWidth: 1, padding: 8, cornerRadius: 6, displayColors: false,
          callbacks: {
            title: items => {
              const ms = items[0].parsed.x;
              return `${fmtDateMDY(new Date(ms))} (${ttmLabel(ms)})`;
            },
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(3)}${yUnit}`
          }
        }
      }
    }
  });
  newChart._clipOutliers = shouldClip;
  return newChart;
}

function renderSpreadCharts(bonds, tab) {
  if (spreadChart1) { spreadChart1.destroy(); spreadChart1 = null; }
  if (spreadChart2) { spreadChart2.destroy(); spreadChart2 = null; }
  const ctx1 = document.getElementById('spreadYieldChart').getContext('2d');
  const ctx2 = document.getElementById('spreadPriceChart').getContext('2d');
  const toPt = (b, key) => ({ x: b.maturityDate.getTime(), y: parseFloat(b[key].toFixed(4)) });

  const pushSeries = (arr, label, data, color, r) => {
    if (data.length) arr.push({ label, data, color, r, trend: _kernelAverageTrend(data) });
  };

  const yieldSeries = [], priceSeries = [];
  if (tab === 'tips') {
    const valid = bonds.filter(b => !isNaN(b.yieldSpreadBps));
    const validP = bonds.filter(b => !isNaN(b.priceSpreadPct));
    pushSeries(yieldSeries, 'Yield Spread', valid.map(b => toPt(b, 'yieldSpreadBps')), '#1a56db', 1.5);
    pushSeries(priceSeries, 'Price Spread', validP.map(b => toPt(b, 'priceSpreadPct')), '#059669', 1.5);
  } else {
    const types = [
      { type: 'MARKET BASED BILL',  label: 'Bills',  yc: '#0ea5e9', pc: '#38bdf8', r: 1.25 },
      { type: 'MARKET BASED NOTE',  label: 'Notes',  yc: '#1a56db', pc: '#60a5fa', r: 1.25 },
      { type: 'MARKET BASED BOND',  label: 'Bonds',  yc: '#7c3aed', pc: '#a78bfa', r: 1.25 },
      { type: 'MARKET BASED STRIP', label: 'STRIPS', yc: '#64748b', pc: '#94a3b8', r: 1   },
    ];
    for (const { type, label, yc, pc, r } of types) {
      const yb = bonds.filter(b => b.type === type && !isNaN(b.yieldSpreadBps));
      const pb = bonds.filter(b => b.type === type && !isNaN(b.priceSpreadPct));
      pushSeries(yieldSeries, label, yb.map(b => toPt(b, 'yieldSpreadBps')), yc, r);
      pushSeries(priceSeries, label, pb.map(b => toPt(b, 'priceSpreadPct')), pc, r);
    }
  }

  const shouldClip = tab === 'tips' ? true : nominalsClipOutliers;
  spreadChart1 = _makeSpreadChart(ctx1, yieldSeries, 'Yield Spread (bps)', ' bps', shouldClip);
  spreadChart2 = _makeSpreadChart(ctx2, priceSeries, 'Price Spread (%)', '%', shouldClip);

  // Wire axis-aware wheel zoom (mirrors yield curve chart behaviour)
  if (spreadChart1) setupAxisWheelZoom(document.getElementById('spreadYieldChart'), ({ chart }) => _rescaleSpread(chart), ({ chart, factor }) => snapYAfterZoom(chart, factor));
  if (spreadChart2) setupAxisWheelZoom(document.getElementById('spreadPriceChart'), ({ chart }) => _rescaleSpread(chart), ({ chart, factor }) => snapYAfterZoom(chart, factor));

  // Ensure correct sizing if container was hidden during chart creation
  requestAnimationFrame(() => {
    if (spreadChart1) spreadChart1.resize();
    if (spreadChart2) spreadChart2.resize();
  });

}

function renderSpreadTable(bonds, tab) {
  const fmtP  = v => isNaN(v) ? '—' : v.toFixed(3);
  const fmtY  = v => (v != null && !isNaN(v)) ? (v * 100).toFixed(3) + '%' : '—';
  const fmtBps = v => isNaN(v) ? '—' : v.toFixed(1);
  const fmtPct = v => isNaN(v) ? '—' : v.toFixed(4) + '%';

  if (tab === 'tips') {
    const tbody = document.getElementById('tableBody');
    const thead = document.querySelector('#saTable thead tr');
    window._currentBonds = bonds;
    thead.innerHTML = `
      <th>Maturity</th><th>CUSIP</th><th>Coupon</th><th>Infl. Factor</th>
      <th>Bid Price (Adj)</th><th>Ask Price (Adj)</th><th>Price Spread %</th>
      <th>Bid Yield</th><th>Ask Yield</th><th>Yield Spread (bps)</th>`;
    tbody.innerHTML = bonds.map(b => `
      <tr>
        <td>${fmtMMM(b.maturity)}</td>
        <td>${b.cusip}</td>
        <td>${(b.coupon * 100).toFixed(3)}%</td>
        <td>${isNaN(b.inflationFactor) ? '—' : b.inflationFactor.toFixed(5)}</td>
        <td>${fmtP(b.adjBidPrice)}</td>
        <td>${fmtP(b.adjAskPrice)}</td>
        <td>${fmtPct(b.priceSpreadPct)}</td>
        <td>${fmtY(b.bidYield)}</td>
        <td>${fmtY(b.askYield)}</td>
        <td>${fmtBps(b.yieldSpreadBps)}</td>
      </tr>`).join('');
  } else {
    const tbody = document.getElementById('nominalsTableBody');
    const thead = document.querySelector('#nominalsTable thead tr');
    const shortType = t => t === 'MARKET BASED BILL' ? 'Bill' : t === 'MARKET BASED NOTE' ? 'Note' : t === 'MARKET BASED BOND' ? 'Bond' : 'STRIP';
    thead.innerHTML = `
      <th>Maturity</th><th>CUSIP</th><th>Type</th><th>Coupon</th>
      <th>Bid Price</th><th>Ask Price</th><th>Price Spread %</th>
      <th>Bid Yield</th><th>Ask Yield</th><th>Yield Spread (bps)</th>`;
    tbody.innerHTML = bonds.map(b => `
      <tr>
        <td>${isoToMDY(b.maturity)}</td>
        <td>${b.cusip}</td>
        <td>${shortType(b.type)}</td>
        <td>${(b.coupon * 100).toFixed(3)}%</td>
        <td>${fmtP(b.bidPrice)}</td>
        <td>${fmtP(b.price)}</td>
        <td>${fmtPct(b.priceSpreadPct)}</td>
        <td>${fmtY(b.bidYield)}</td>
        <td>${fmtY(b.yield)}</td>
        <td>${fmtBps(b.yieldSpreadBps)}</td>
      </tr>`).join('');
  }
}

// ─── Interaction Handlers ────────────────────────────────────────────────────

// TIPS 'Show' Checkboxes & Links
const TIPS_SHOW = { showTipsAsk: 'Ask', showTipsSa: 'SA', showTipsSao: 'SAO', showTipsSpot: 'Spot', showTipsSpotSa: 'SpotSA', showTipsGsw: 'GSW' };
if (SHOW_GSW) document.getElementById('tipsGswShow').style.display = 'flex';
Object.keys(TIPS_SHOW).forEach((id) => {
  document.getElementById(id).addEventListener('change', (e) => {
    if (!chart || activeTab !== 'tips') return;
    const seriesKey = TIPS_SHOW[id];
    chart.data.datasets.forEach((ds, i) => {
      if (tipsSeriesKey(ds.label) === seriesKey) chart.setDatasetVisibility(i, e.target.checked);
    });
    chart.update('none');
    rescaleToVisible(chart);
  });
});

document.getElementById('tipsShowAll').onclick = (e) => {
  e.preventDefault();
  Object.keys(TIPS_SHOW).forEach(id => {
    const el = document.getElementById(id);
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
document.getElementById('tipsShowNone').onclick = (e) => {
  e.preventDefault();
  Object.keys(TIPS_SHOW).forEach(id => {
    const el = document.getElementById(id);
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

// BEI 'Show' Checkboxes & Links
const BEI_SHOW = { showBeiAsk: 'Ask BEI', showBeiSa: 'SA BEI', showBeiSao: 'SAO BEI', showBeiSpot: 'Spot BEI' };
Object.keys(BEI_SHOW).forEach((id) => {
  document.getElementById(id).addEventListener('change', (e) => {
    if (!chart || activeTab !== 'bei') return;
    const seriesKey = BEI_SHOW[id];
    chart.data.datasets.forEach((ds, i) => {
      if (ds.label === seriesKey) chart.setDatasetVisibility(i, e.target.checked);
    });
    chart.update('none');
    rescaleToVisible(chart);
  });
});

document.getElementById('beiShowAll').onclick = (e) => {
  e.preventDefault();
  ['showBeiAsk', 'showBeiSa', 'showBeiSao', 'showBeiSpot'].forEach(id => {
    const el = document.getElementById(id);
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
document.getElementById('beiShowNone').onclick = (e) => {
  e.preventDefault();
  ['showBeiAsk', 'showBeiSa', 'showBeiSao', 'showBeiSpot'].forEach(id => {
    const el = document.getElementById(id);
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

// Nominals 'All/None' Links
document.getElementById('nominalsShowAll').onclick = (e) => {
  e.preventDefault();
  ['filterBills', 'filterNotes', 'filterBonds', 'showTsySpot'].forEach(id => {
    const el = document.getElementById(id);
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
document.getElementById('nominalsShowNone').onclick = (e) => {
  e.preventDefault();
  ['filterBills', 'filterNotes', 'filterBonds', 'showTsySpot'].forEach(id => {
    const el = document.getElementById(id);
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};



// Snapshot the current view so the next processAndRender() restores it instead of
// auto-fitting. Used by source toggles: adding/removing a source rebuilds the chart,
// but should not change the scale — same as showing/hiding a series.
function preserveZoom() {
  if (chart && chartTab) {
    savedZoom[chartTab] = {
      xMin: chart.scales.x.min, xMax: chart.scales.x.max,
      yMin: chart.scales.y.min, yMax: chart.scales.y.max,
    };
  }
}

// Unified Source Change Handlers
// FedInvest/Market selections are shared concepts across tabs (TIPS vs Treasuries),
// so toggling one tab's checkbox mirrors the same on/off state onto the other tab's
// corresponding checkbox (only if that counterpart's data has loaded).
const CHECKBOX_MIRROR = {
  chkTipsFed: 'chkFedInvest', chkFedInvest: 'chkTipsFed',
  chkTipsBroker: 'chkFidelity', chkFidelity: 'chkTipsBroker',
};
function mirrorCheckbox(id) {
  const counterpart = document.getElementById(CHECKBOX_MIRROR[id]);
  if (!counterpart.disabled) counterpart.checked = document.getElementById(id).checked;
}
['chkTipsFed', 'chkTipsBroker', 'chkFedInvest', 'chkFidelity'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    mirrorCheckbox(id);
    preserveZoom();
    updateModeToggle();
    processAndRender();
  });
});

// Chart Mode Toggle
document.getElementById('chart-mode-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn[data-mode]');
  if (!btn || btn.disabled) return;
  const mode = btn.dataset.mode;
  if (spreadModeActive === (mode === 'spread')) return;
  spreadModeActive = (mode === 'spread');
  document.querySelectorAll('#chart-mode-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  switchChartMode(mode);
  processAndRender();
});

document.getElementById('tableBody').addEventListener('click', (e) => {
  const td = e.target.closest('td.drillable');
  if (!td) return;
  
  // Use cellIndex to distinguish columns (SA is 5, SAO is 6)
  if (td.cellIndex === 5) {
    _showSaDrill(td.dataset.cusip);
  } else if (td.cellIndex === 6) {
    _showSaoDrill(td.dataset.cusip);
  }
});

document.addEventListener('click', (e) => {
  const link = e.target.closest('a.col-help');
  if (link) {
    e.preventDefault();
    _showColHelp(link.dataset.col);
  }
});

document.getElementById('tab-bar').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (btn) switchTab(btn.dataset.tab);
});

const typeCheckboxMap = {
  'filterBills': 'MARKET BASED BILL',
  'filterNotes': 'MARKET BASED NOTE',
  'filterBonds': 'MARKET BASED BOND',
};
document.getElementById('nominalsTable').querySelector('thead').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const col = th.dataset.sort;
  if (nominalsSort.col === col) {
    nominalsSort.dir = nominalsSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    nominalsSort.col = col;
    nominalsSort.dir = col === 'yield' ? 'desc' : 'asc';
  }
  processAndRenderNominals();
});

document.getElementById('nominalsControls').addEventListener('change', (e) => {
  if (e.target.id === 'showTsySpot') {
    if (chart && activeTab === 'treasuries') {
      chart.data.datasets.forEach((ds, i) => {
        if (ds.label.startsWith('Spot')) chart.setDatasetVisibility(i, e.target.checked);
      });
      chart.update('none');
      rescaleToVisible(chart);
    }
    return;
  }
  if (e.target.id === 'clipOutliers') {
    nominalsClipOutliers = e.target.checked;
    savedZoom['treasuries'] = null;
    processAndRenderNominals();
    return;
  }
  if (e.target.id === 'filterStrips') {
    nominalsShowStrips = e.target.checked;
    savedZoom['treasuries'] = null;
    document.getElementById('startMaturity').value = '';
    document.getElementById('endMaturity').value = '';
    processAndRenderNominals();
    return;
  }
  const type = typeCheckboxMap[e.target.id];
  if (!type) return;
  if (e.target.checked) nominalsTypeFilters.add(type);
  else nominalsTypeFilters.delete(type);
  savedZoom['treasuries'] = null;
  document.getElementById('startMaturity').value = '';
  document.getElementById('endMaturity').value = '';
  processAndRenderNominals();
});

document.getElementById('beiClipOutliers').addEventListener('change', (e) => {
  beiClipOutliers = e.target.checked;
  savedZoom['bei'] = null;
  processAndRenderBei();
});

init();

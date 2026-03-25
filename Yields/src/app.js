// Yield Curves — Frontend Logic
import { yieldFromPrice } from '../../shared/src/bond-math.js';
import { handleChartKeydown } from '../../shared/src/chart-keys.js';

console.log("Yields app.js loading...");

const R2_BASE_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const YIELDS_CSV_URL = `${R2_BASE_URL}/Treasuries/Yields.csv`;
const REF_CPI_CSV_URL = `${R2_BASE_URL}/Treasuries/RefCpiNsaSa.csv`;
const HOLIDAYS_CSV_URL = `${R2_BASE_URL}/misc/BondHolidaysSifma.csv`;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// --- State ---
let rawYieldsData = null;
let rawNominalsData = null;
let rawRefCpiData = null;
let holidaySet = new Set();
let brokerPrices = null;
let chart = null;
let activeTab = 'tips';
let nominalsTypeFilters = new Set(['MARKET BASED BILL', 'MARKET BASED NOTE', 'MARKET BASED BOND']);
let nominalsSort = { col: 'maturity', dir: 'asc' };
window._currentBonds = [];

// --- Helpers ---
function parseCsv(text, hasHeader = true) {
  const result = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return result;

  const parseRow = (line) => {
    const parts = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) {
        parts.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    parts.push(cur.trim());
    return parts.map(p => p.replace(/^"|"$/g, '').trim());
  };

  if (hasHeader) {
    const headers = parseRow(lines[0]);
    for (let i = 1; i < lines.length; i++) {
      const values = parseRow(lines[i]);
      const obj = {};
      headers.forEach((h, idx) => {
        if (h) obj[h] = values[idx];
      });
      result.push(obj);
    }
  } else {
    return lines.map(parseRow);
  }
  return result;
}

function localDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toIsoDate(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

function nextBusinessDay(date, holidaySet) {
  if (!date) return new Date();
  const d = new Date(date.getTime());
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6 || holidaySet.has(toIsoDate(d)));
  return d;
}

// ── Date range input helpers ──────────────────────────────────────────────────
// Convert YYYY-MM-DD → MM/DD/YYYY for display in text inputs
function isoToMDY(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}
// Parse MM/DD/YYYY text input → Date (or null if incomplete/invalid)
function parseDateInput(s) {
  const digits = (s || '').replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const dt = new Date(+digits.slice(4), +digits.slice(0, 2) - 1, +digits.slice(2, 4));
  return isNaN(dt) ? null : dt;
}
// Wire up auto-slash formatting + calendar sync for a text/date input pair
function setupDateInput(textEl, calEl, onChange) {
  textEl.addEventListener('input', () => {
    const raw = textEl.value;
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    let fmt = digits;
    if (digits.length >= 3) fmt = digits.slice(0, 2) + '/' + digits.slice(2);
    if (digits.length >= 5) fmt = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
    const isNaturalSlash = raw === digits.slice(0, 2) + '/' || raw === digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/';
    if (raw !== fmt && !isNaturalSlash) textEl.value = fmt;
    const dt = parseDateInput(fmt);
    textEl.classList.toggle('invalid', fmt.length === 10 && !dt);
    if (dt) { calEl.value = toIsoDate(dt); onChange(); }
  });
  calEl.addEventListener('change', () => {
    if (calEl.value) { textEl.value = isoToMDY(calEl.value); textEl.classList.remove('invalid'); onChange(); }
  });
}

function fmtMMM(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
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
<p>TIPS prices are quoted on the <em>real</em> (inflation-adjusted) principal. The actual dollar amount paid at settlement is: <code>Price / 100 × Index Ratio × Face Value</code>.</p>`
  },
  'ask-yield': {
    title: 'Ask Yield',
    html: `<p>Yield to maturity (YTM) calculated directly from the market price using standard Treasury bond math (semi-annual compounding).</p>
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
    title: 'SAO Yield — SA Ordinal (Trend-Fitted)',
    html: `<p>SAO applies a backwards-anchored linear regression to the SA yields of the <strong>next 4 longer-maturity TIPS</strong>, then blends the projected value with the TIPS's own SA yield.</p>
<p>The blend weight tilts heavily toward the trend for short-maturity TIPS, where residual seasonal distortions are largest, and tapers off for longer maturities.</p>
<ul style="margin:12px 0 0;padding-left:18px;">
  <li style="margin-bottom:6px;"><strong>Under 6 months:</strong> 90% trend projection, 10% raw SA yield</li>
  <li style="margin-bottom:6px;"><strong>6 months – 2 years:</strong> 15% trend</li>
  <li style="margin-bottom:6px;"><strong>2 – 5 years:</strong> 25% trend</li>
  <li style="margin-bottom:6px;"><strong>Over 7 years:</strong> equals SA yield (no adjustment)</li>
</ul>
<p>The result is a <strong>smoothed yield curve</strong> that reveals where the short end should price relative to the longer end, independent of residual seasonal noise.</p>`
  },
  'diff': {
    title: 'Diff (bps)',
    html: `<p>The difference between <strong>SA Yield</strong> and <strong>Ask Yield</strong>, expressed in basis points (1 bp = 0.01%).</p>
<p>A positive value means the seasonal adjustment raised the yield (the TIPS had a seasonal price premium that was stripped out). A negative value means the adjustment lowered the yield (the TIPS had a seasonal penalty that was compensated).</p>`
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

  const mmddSettle = toIsoDate(localDate(bond.settlementDate)).slice(5, 10);
  const mmddMature = bond.maturity.slice(5, 10);
  const saS = parseFloat(rawRefCpiData.find(r => r["Ref CPI Date"].includes(`-${mmddSettle}`))?.["SA Factor"]);
  const saM = parseFloat(rawRefCpiData.find(r => r["Ref CPI Date"].includes(`-${mmddMature}`))?.["SA Factor"]);
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
  
  // Find the index in the sorted array to show the window
  const idx = window._currentBonds.indexOf(bond);
  const n = window._currentBonds.length;
  
  let logicHtml = '';
  let trendWeight = 0.2;
  if (yearsToMat < 0.5) trendWeight = 0.9; 
  else if (yearsToMat < 2) trendWeight = 0.15; 
  else if (yearsToMat < 5) trendWeight = 0.25;

  if (yearsToMat > 7 || idx > n - 4) {
    logicHtml = `
      <div style="background:#f0f9ff;padding:12px;border-radius:6px;border:1px solid #bae6fd;margin-bottom:16px;">
        <p style="margin:0;color:#0369a1;font-weight:600;">Anchor Region (Long End)</p>
        <p style="margin:8px 0 0;font-size:12px;">This TIPS matures in > 7 years (or is among the last 4). At this maturity, the curve is considered stable enough that the <strong>SAO Yield equals the SA Yield</strong>.</p>
      </div>
    `;
  } else {
    logicHtml = `
      <div style="background:#f8fafc;padding:12px;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span>Trend Weight (Maturity ${yearsToMat.toFixed(1)}y)</span>
          <strong>${(trendWeight * 100).toFixed(0)}%</strong>
        </div>
        <div style="font-size:12px;color:#64748b;margin-bottom:12px;">
          The <strong>Outlier (O)</strong> factor is approximated by established institutional smoothing. 
          We use a sliding window of the <strong>next 4 longer-dated TIPS</strong> to establish a linear trend.
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span>Raw SA Yield</span>
          <span>${(bond.saYield * 100).toFixed(3)}%</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span>Projected Trend Yield</span>
          <span>${(((bond.saoYield - bond.saYield * (1 - trendWeight)) / trendWeight) * 100).toFixed(3)}%</span>
        </div>
        <div style="border-top:1px dashed #cbd5e1;margin:8px 0;padding-top:8px;display:flex;justify-content:space-between;color:#1a56db;font-weight:700;">
          <span>Blended SAO Yield</span>
          <span>${(bond.saoYield * 100).toFixed(3)}%</span>
        </div>
      </div>
      <p style="font-size:11px;color:#94a3b8;margin:0;">* Projecting a smooth curve removes residual "wiggles" caused by specific maturity-month anomalies that standard SA factors may miss.</p>
    `;
  }

  _showDrillPopup(`SAO Drill-down: ${bond.cusip} (Outlier Adjustment)`, logicHtml);
}

// ─── Main Logic ──────────────────────────────────────────────────────────────

async function init() {
  const statusEl = document.getElementById('status');
  console.log("init() started");
  
  try {
    console.log("Fetching market data...");
    const [yieldsRes, refCpiRes, holidayRes] = await Promise.all([
      fetch(YIELDS_CSV_URL).then(r => { console.log("Yields fetched"); return r; }).catch(e => ({ ok: false, error: e })),
      fetch(REF_CPI_CSV_URL).then(r => { console.log("RefCPI fetched"); return r; }).catch(e => ({ ok: false, error: e })),
      fetch(HOLIDAYS_CSV_URL).then(r => { console.log("Holidays fetched"); return r; }).catch(e => ({ ok: false, error: e }))
    ]);

    if (!yieldsRes.ok) throw new Error(`Failed to fetch yields: ${yieldsRes.status || yieldsRes.error}`);
    if (!refCpiRes.ok) throw new Error(`Failed to fetch Ref CPI: ${refCpiRes.status || refCpiRes.error}`);
    if (!holidayRes.ok) throw new Error(`Failed to fetch bond holidays: ${holidayRes.status || holidayRes.error}`);

    console.log("Fetches complete, parsing text...");
    const [yieldsText, refCpiText, holidayText] = await Promise.all([
      yieldsRes.text(),
      refCpiRes.text(),
      holidayRes.text()
    ]);

    console.log("Parsing CSVs...");
    // Yields.csv: row 1 = settlement date, row 2 = header, rows 3+ = data
    const yieldsLines = yieldsText.split(/\r?\n/).filter(l => l.trim());
    const yieldsSettleDate = yieldsLines[0].trim();
    const allYieldsRows = parseCsv(yieldsLines.slice(1).join('\n'))
      .map(r => ({ ...r, settlementDate: yieldsSettleDate }));
    rawYieldsData = allYieldsRows.filter(r => r.type === 'TIPS');
    rawNominalsData = allYieldsRows.filter(r => r.type !== 'TIPS');
    rawRefCpiData = parseCsv(refCpiText);
    
    console.log(`Parsed ${rawYieldsData.length} yield rows and ${rawRefCpiData.length} RefCPI rows.`);

    const holidayRows = parseCsv(holidayText, false);
    holidaySet = new Set();
    holidayRows.forEach((row, i) => {
      if (!row || !row[0]) return;
      const datePart = row[0].split(',').slice(1).join(',').trim(); 
      const d = new Date(datePart);
      if (!isNaN(d.getTime())) holidaySet.add(toIsoDate(d));
    });
    console.log(`Holiday set populated with ${holidaySet.size} dates.`);

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

function calculateSAO(bonds) {
  const n = bonds.length;
  const sao = new Array(n);
  const now = new Date();

  for (let i = n - 1; i >= 0; i--) {
    const bond = bonds[i];
    const yearsToMat = (bond.maturityDate - now) / 31557600000;

    if (yearsToMat > 7 || i > n - 4) {
      sao[i] = bond.saYield;
      continue;
    }

    const windowSize = 4;
    const actualWindow = Math.min(windowSize, n - 1 - i);
    
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 1; j <= actualWindow; j++) {
      const x = (bonds[i + j].maturityDate - bond.maturityDate) / 86400000;
      const y = sao[i + j];
      sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x;
    }

    const slope = (actualWindow * sumXY - sumX * sumY) / (actualWindow * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / actualWindow;
    const projected = intercept;

    let trendWeight = 0.2;
    if (yearsToMat < 0.5) trendWeight = 0.9; 
    else if (yearsToMat < 2) trendWeight = 0.15; 
    else if (yearsToMat < 5) trendWeight = 0.25;

    sao[i] = (projected * trendWeight) + (bond.saYield * (1 - trendWeight));
  }
  return sao;
}

function processAndRender() {
  if (activeTab === 'treasuries') {
    processAndRenderNominals();
  } else {
    processAndRenderTips();
  }
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.getElementById('saTable').style.display = tab === 'tips' ? '' : 'none';
  document.getElementById('nominalsTable').style.display = tab === 'treasuries' ? '' : 'none';
  document.getElementById('brokerFileRow').style.display = tab === 'tips' ? '' : 'none';
  const ctrl = document.getElementById('nominalsControls');
  ctrl.style.display = tab === 'treasuries' ? 'flex' : 'none';
  document.getElementById('startMaturity').value = '';
  document.getElementById('endMaturity').value = '';
  document.getElementById('startMaturityCal').value = '';
  document.getElementById('endMaturityCal').value = '';
  processAndRender();
}

function processAndRenderNominals() {
  const statusEl = document.getElementById('status');
  if (!rawNominalsData || rawNominalsData.length === 0) {
    statusEl.textContent = 'No nominal Treasury data available.';
    return;
  }
  try {
    const source = rawNominalsData.filter(r => nominalsTypeFilters.has(r.type));

    const processed = source.map(r => {
      const price = parseFloat(r.price);
      const coupon = parseFloat(r.coupon);
      const maturityDate = localDate(r.maturity);
      const yld = yieldFromPrice(price, coupon, localDate(r.settlementDate), maturityDate);
      if (yld === null || isNaN(yld)) return null;
      return { ...r, coupon, price, yield: yld, maturityDate };
    }).filter(b => b !== null).sort((a, b) => a.maturityDate - b.maturityDate);

    const startEl = document.getElementById('startMaturity');
    const endEl = document.getElementById('endMaturity');
    const startCalEl = document.getElementById('startMaturityCal');
    const endCalEl = document.getElementById('endMaturityCal');
    if (!startEl.value && processed.length > 0) {
      startEl.value = isoToMDY(processed[0].maturity);
      endEl.value = isoToMDY(processed[processed.length - 1].maturity);
      startCalEl.value = processed[0].maturity;
      endCalEl.value = processed[processed.length - 1].maturity;
      setupDateInput(startEl, startCalEl, () => processAndRender());
      setupDateInput(endEl, endCalEl, () => processAndRender());
    }

    const startDate = parseDateInput(startEl.value) || new Date(0);
    const endDate = parseDateInput(endEl.value) || new Date(9999, 0);
    const filtered = processed.filter(b => b.maturityDate >= startDate && b.maturityDate <= endDate);

    renderNominalsTable(filtered);
    renderNominalsChart(filtered);

    const infoEl = document.getElementById('info-strip');
    infoEl.textContent = `FedInvest market data \xb7 Settlement Date: ${rawNominalsData[0]?.settlementDate} (T)`;
    statusEl.textContent = `Loaded ${filtered.length} Treasury securities.`;
    statusEl.className = '';
  } catch (err) {
    statusEl.textContent = `Error in processing: ${err.message}`;
    statusEl.className = 'error';
    console.error('processAndRenderNominals failed:', err);
  }
}

function renderNominalsTable(bonds) {
  // Apply sort
  const sorted = [...bonds].sort((a, b) => {
    const va = nominalsSort.col === 'maturity' ? a.maturityDate
             : nominalsSort.col === 'cusip'    ? a.cusip
             : nominalsSort.col === 'coupon'   ? a.coupon
             : nominalsSort.col === 'price'    ? a.price
             :                                   a.yield;
    const vb = nominalsSort.col === 'maturity' ? b.maturityDate
             : nominalsSort.col === 'cusip'    ? b.cusip
             : nominalsSort.col === 'coupon'   ? b.coupon
             : nominalsSort.col === 'price'    ? b.price
             :                                   b.yield;
    if (va < vb) return nominalsSort.dir === 'asc' ? -1 : 1;
    if (va > vb) return nominalsSort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  // Update sort indicators on headers
  document.querySelectorAll('#nominalsTable th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === nominalsSort.col) th.classList.add(`sort-${nominalsSort.dir}`);
  });

  const shortType = (t) => t === 'MARKET BASED BILL' ? 'Bill' : t === 'MARKET BASED NOTE' ? 'Note' : t === 'MARKET BASED BOND' ? 'Bond' : t;
  const fmtFull = (s) => {
    if (!s) return '';
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  document.getElementById('nominalsTableBody').innerHTML = sorted.map(b => `
    <tr>
      <td>${fmtFull(b.maturity)}</td>
      <td>${b.cusip}</td>
      <td>${shortType(b.type)}</td>
      <td>${(b.coupon * 100).toFixed(3)}%</td>
      <td>${isNaN(b.price) ? '—' : b.price.toFixed(3)}</td>
      <td>${(b.yield * 100).toFixed(3)}%</td>
    </tr>
  `).join('');
}

function renderNominalsChart(bonds) {
  const ctx = document.getElementById('yieldChart').getContext('2d');
  if (bonds.length === 0) { if (chart) { chart.destroy(); chart = null; } return; }

  const toPoint = b => ({ x: b.maturityDate.getTime(), y: parseFloat((b.yield * 100).toFixed(3)) });
  const billData  = bonds.filter(b => b.type === 'MARKET BASED BILL').map(toPoint);
  const noteData  = bonds.filter(b => b.type === 'MARKET BASED NOTE').map(toPoint);
  const bondData  = bonds.filter(b => b.type === 'MARKET BASED BOND').map(toPoint);
  const allPoints = [...billData, ...noteData, ...bondData];
  const minDate = new Date(Math.min(...allPoints.map(d => d.x)));
  const maxDate = new Date(Math.max(...allPoints.map(d => d.x)));
  const minX = new Date(minDate.getFullYear(), minDate.getMonth(), 1).getTime();
  const maxX = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1).getTime();
  const spanMonths = (maxDate.getFullYear() - minDate.getFullYear()) * 12 + (maxDate.getMonth() - minDate.getMonth());
  const timeUnit = spanMonths <= 18 ? 'month' : 'year';
  const allY = allPoints.map(d => d.y);
  const minYRaw = Math.min(...allY), maxYRaw = Math.max(...allY);
  const minY = Math.floor(minYRaw * 20) / 20;   // nearest 0.05 below
  const maxY = Math.ceil(maxYRaw * 20) / 20;    // nearest 0.05 above
  const dataRange = maxY - minY;
  const step = dataRange <= 0.5 ? 0.05 : dataRange <= 1.0 ? 0.1 : 0.25;

  const seriesDef = [
    { label: 'Bills',  data: billData,  color: '#0ea5e9', pointRadius: 2, width: 1.5 },
    { label: 'Notes',  data: noteData,  color: '#1a56db', pointRadius: 0, width: 2.5 },
    { label: 'Bonds',  data: bondData,  color: '#7c3aed', pointRadius: 0, width: 2.5 },
  ];

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: seriesDef.map(s => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: s.width,
        pointRadius: s.pointRadius,
        pointHoverRadius: s.pointRadius > 0 ? s.pointRadius + 2 : 3,
        tension: 0.1
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          min: minX, max: maxX,
          time: { unit: timeUnit, displayFormats: { year: 'MMM yyyy', month: 'MMM yyyy' } },
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { autoSkip: true, maxRotation: 0 }
        },
        y: {
          type: 'linear',
          title: { display: true, text: 'Yield (%)' },
          min: minY, max: maxY,
          ticks: { stepSize: step, callback: (val) => val.toFixed(2) }
        }
      },
      plugins: {
        legend: {
          labels: { usePointStyle: true, boxWidth: 8, padding: 15, font: { size: 12, weight: '500' } },
          onClick: (e, legendItem, legend) => { Chart.defaults.plugins.legend.onClick(e, legendItem, legend); rescaleToVisible(legend.chart); }
        },
        zoom: {
          pan: { enabled: true, mode: 'xy', onPanComplete: ({chart}) => updateDynamicTicks(chart) },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy', onZoomComplete: ({chart}) => updateDynamicTicks(chart) }
        },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.95)', titleColor: '#1e293b', bodyColor: '#475569',
          borderColor: '#e2e8f0', borderWidth: 1, padding: 8,
          titleFont: { size: 11, weight: '700' }, bodyFont: { size: 11 },
          cornerRadius: 6, displayColors: false,
          callbacks: {
            title: (items) => new Date(items[0].parsed.x).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(3)}%`
          }
        }
      }
    }
  });

  document.getElementById('resetZoom').onclick = () => {
    chart.options.scales.x.min = minX;
    chart.options.scales.x.max = maxX;
    chart.update('none');
    rescaleToVisible(chart);
  };
}

function processAndRenderTips() {
  console.log("processAndRenderTips() started");
  const statusEl = document.getElementById('status');
  if (!rawYieldsData || rawYieldsData.length === 0 || !rawRefCpiData) {
    console.warn("No data to process. rawYieldsData:", rawYieldsData, "rawRefCpiData:", rawRefCpiData);
    return;
  }

  try {
    const infoEl = document.getElementById('info-strip');
    const priceSourceEl = document.getElementById('priceSource');
    const sourceLabelEl = document.getElementById('priceSourceLabel');

    const fedSettleStr = rawYieldsData[0]?.settlementDate;
    
    if (brokerPrices) {
      const uploadTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      sourceLabelEl.textContent = `Using Broker Ask Prices (Uploaded at ${uploadTime})`;
      priceSourceEl.style.display = 'flex';
      const fedSettleDate = localDate(fedSettleStr);
      const tPlus1 = nextBusinessDay(fedSettleDate, holidaySet);
      const displaySettle = toIsoDate(tPlus1);
      infoEl.textContent = `Broker Prices \xb7 Settlement Date: ${displaySettle} (T+1)`;
    } else {
      priceSourceEl.style.display = 'none';
      infoEl.textContent = `FedInvest market data \xb7 Settlement Date: ${fedSettleStr} (T)`;
    }

    console.log("Processing bonds...");
    const allProcessed = rawYieldsData.map(bond => {
      const coupon = parseFloat(bond.coupon);
      let price = parseFloat(bond.price);
      let settleDateStr = bond.settlementDate;

      if (brokerPrices && brokerPrices.has(bond.cusip)) {
        price = brokerPrices.get(bond.cusip);
        const fedSettleDate = localDate(bond.settlementDate);
        const tPlus1 = nextBusinessDay(fedSettleDate, holidaySet);
        settleDateStr = toIsoDate(tPlus1);
      }

      const mmddSettle = settleDateStr.slice(5, 10);
      const mmddMature = bond.maturity.slice(5, 10);

      const rSettle = rawRefCpiData.find(r => r["Ref CPI Date"] && r["Ref CPI Date"].includes(`-${mmddSettle}`));
      const rMature = rawRefCpiData.find(r => r["Ref CPI Date"] && r["Ref CPI Date"].includes(`-${mmddMature}`));
      const saSettle = parseFloat(rSettle?.["SA Factor"]);
      const saMature = parseFloat(rMature?.["SA Factor"]);

      if (isNaN(saSettle) || isNaN(saMature)) {
        console.warn(`Missing SA factor for bond ${bond.cusip}: settle ${mmddSettle} (${saSettle}), mature ${mmddMature} (${saMature})`);
        return null;
      }

      const askYield = yieldFromPrice(price, coupon, localDate(settleDateStr), localDate(bond.maturity));
      const saYield = yieldFromPrice(price * (saSettle / saMature), coupon, localDate(settleDateStr), localDate(bond.maturity));

      return { ...bond, coupon, price, askYield, saYield, maturityDate: localDate(bond.maturity), settlementDate: settleDateStr };
    }).filter(b => b !== null).sort((a, b) => a.maturityDate - b.maturityDate);

    console.log(`Processed ${allProcessed.length} bonds.`);

    const smoothed = calculateSAO(allProcessed);
    allProcessed.forEach((b, i) => {
      b.saoYield = smoothed[i];
      b.diffBps = (b.saYield - b.askYield) * 10000;
    });

    const startEl = document.getElementById('startMaturity');
    const endEl = document.getElementById('endMaturity');
    const startCalEl = document.getElementById('startMaturityCal');
    const endCalEl = document.getElementById('endMaturityCal');
    if (!startEl.value && allProcessed.length > 0) {
      startEl.value = isoToMDY(allProcessed[0].maturity);
      endEl.value = isoToMDY(allProcessed[allProcessed.length - 1].maturity);
      startCalEl.value = allProcessed[0].maturity;
      endCalEl.value = allProcessed[allProcessed.length - 1].maturity;
      setupDateInput(startEl, startCalEl, () => processAndRender());
      setupDateInput(endEl, endCalEl, () => processAndRender());
    }

    const startDate = parseDateInput(startEl.value) || new Date(0);
    const endDate = parseDateInput(endEl.value) || new Date(9999, 0);
    const filteredBonds = allProcessed.filter(b => b.maturityDate >= startDate && b.maturityDate <= endDate);

    renderTable(filteredBonds);
    renderChart(filteredBonds);
    statusEl.textContent = `Successfully loaded ${filteredBonds.length} TIPS.`;
    statusEl.className = '';
  } catch (err) {
    statusEl.textContent = `Error in processing: ${err.message}`;
    statusEl.className = 'error';
    console.error('processAndRenderTips failed:', err);
  }
}

function renderTable(bonds) {
  window._currentBonds = bonds;
  const tbody = document.getElementById('tableBody');
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
    </tr>
  `).join('');
}

function renderChart(bonds) {
  const ctx = document.getElementById('yieldChart').getContext('2d');
  if (bonds.length === 0) return;

  const askData = bonds.map(b => ({ x: b.maturityDate.getTime(), y: parseFloat((b.askYield * 100).toFixed(3)) }));
  const saData = bonds.map(b => ({ x: b.maturityDate.getTime(), y: parseFloat((b.saYield * 100).toFixed(3)) }));
  const saoData = bonds.map(b => ({ x: b.maturityDate.getTime(), y: parseFloat((b.saoYield * 100).toFixed(3)) }));

  const firstBondDate = new Date(Math.min(...askData.map(d => d.x)));
  const lastBondDate = new Date(Math.max(...askData.map(d => d.x)));
  const minX = new Date(firstBondDate.getFullYear(), 0, 1).getTime();
  const maxX = new Date(lastBondDate.getFullYear() + 1, 0, 1).getTime();

  const allY = [...askData, ...saData, ...saoData].map(d => d.y);
  const minYRaw = Math.min(...allY);
  const maxYRaw = Math.max(...allY);
  const minY = Math.floor(minYRaw * 4) / 4;
  const maxY = Math.ceil(maxYRaw * 4) / 4;

  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Ask',
          data: askData,
          borderColor: '#94a3b8',
          backgroundColor: '#94a3b8',
          borderWidth: 1.5,
          pointRadius: 3.5, 
          pointStyle: 'rect',
          tension: 0.1
        },
        {
          label: 'Seasonally Adjusted (SA)',
          data: saData,
          borderColor: '#475569',
          backgroundColor: '#475569',
          borderWidth: 1.8,
          pointRadius: 4, 
          pointStyle: 'crossRot',
          tension: 0.1
        },
        {
          label: 'SA with outlier adjustment (SAO)',
          data: saoData,
          borderColor: '#1a56db',
          backgroundColor: '#1a56db',
          borderWidth: 2.2,
          pointRadius: 2.5,
          pointStyle: 'circle',
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { 
          type: 'time',
          min: minX,
          max: maxX,
          time: {
            unit: 'year',
            displayFormats: { year: 'MMM yyyy', month: 'MMM yyyy' }
          },
          grid: { color: 'rgba(0, 0, 0, 0.05)' },
          ticks: { autoSkip: true, maxRotation: 0 }
        },
        y: { 
          type: 'linear',
          title: { display: true, text: 'Yield (%)' },
          min: minY,
          max: maxY,
          ticks: { stepSize: 0.25, callback: (val) => val.toFixed(2) }
        }
      },
      plugins: {
        legend: {
          labels: { usePointStyle: true, boxWidth: 8, padding: 15, font: { size: 12, weight: '500' } },
          onClick: (e, legendItem, legend) => {
            Chart.defaults.plugins.legend.onClick(e, legendItem, legend);
            rescaleToVisible(legend.chart);
          }
        },
        zoom: {
          pan: { enabled: true, mode: 'xy', onPanComplete: ({chart}) => updateDynamicTicks(chart) },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy', onZoomComplete: ({chart}) => updateDynamicTicks(chart) }
        },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          titleColor: '#1e293b',
          bodyColor: '#475569',
          borderColor: '#e2e8f0',
          borderWidth: 1,
          padding: 8,
          titleFont: { size: 11, weight: '700' },
          bodyFont: { size: 11 },
          cornerRadius: 6,
          displayColors: false,
          callbacks: {
            title: (items) => {
              const date = new Date(items[0].parsed.x);
              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            },
            label: (context) => `${context.dataset.label}: ${context.parsed.y}%`
          }
        }
      }
    }
  });

  document.getElementById('resetZoom').onclick = () => {
    chart.options.scales.x.min = minX;
    chart.options.scales.x.max = maxX;
    chart.update('none');
    rescaleToVisible(chart);
  };
}

function rescaleToVisible(chart) {
  let visibleMinY = Infinity;
  let visibleMaxY = -Infinity;

  chart.data.datasets.forEach((dataset, i) => {
    if (!chart.isDatasetVisible(i)) return;
    dataset.data.forEach(p => {
      if (p.y < visibleMinY) visibleMinY = p.y;
      if (p.y > visibleMaxY) visibleMaxY = p.y;
    });
  });

  if (visibleMinY === Infinity) return;

  const range = visibleMaxY - visibleMinY;
  let newStep = 0.25;
  if (range > 3) newStep = 0.50;
  if (range > 7) newStep = 1.00;
  if (range < 0.6) newStep = 0.05;

  chart.options.scales.y.min = Math.floor((visibleMinY - 0.01) / newStep) * newStep;
  chart.options.scales.y.max = Math.ceil((visibleMaxY + 0.01) / newStep) * newStep;
  chart.options.scales.y.ticks.stepSize = newStep;
  chart.update('none');
}

function updateDynamicTicks(chart) {
  const yMin = chart.scales.y.min;
  const yMax = chart.scales.y.max;
  const range = yMax - yMin;

  let newStep = 0.25;
  if (range > 3) newStep = 0.50;
  if (range > 7) newStep = 1.00;
  if (range < 0.6) newStep = 0.05;

  chart.options.scales.y.ticks.stepSize = newStep;
  chart.update('none');
}

// ─── Interaction Handlers ────────────────────────────────────────────────────

document.getElementById('brokerFile').addEventListener('change', async (e) => {
  if (!e.target.files.length) return;
  try {
    const text = await e.target.files[0].text();
    const rows = parseCsv(text);
    const priceMap = new Map();
    const seenCusips = new Set();
    
    // Robust cleaner for ="TEXT", "TEXT", =TEXT, or TEXT
    const clean = (val) => (val || "").replace(/^=?["']*/, '').replace(/["']*$/, '').trim();

    rows.forEach(row => {
      // Normalize row keys to lowercase/trimmed
      const normalizedRow = {};
      for (const key in row) {
        normalizedRow[key.toLowerCase().trim()] = row[key];
      }

      let cusip = null;
      let priceStr = null;

      // 1. Identify CUSIP
      if (normalizedRow["cusip"]) {
        cusip = clean(normalizedRow["cusip"]);
      } else if (normalizedRow["description"]) {
        const desc = normalizedRow["description"];
        const match = desc.match(/[A-Z0-9]{9}/);
        if (match) cusip = match[0];
      }

      // 2. Identify Price (Prefer Ask for yield curve, fallback to generic or Bid)
      priceStr = normalizedRow["price ask"] || normalizedRow["ask price"] || 
                 normalizedRow["price"] || 
                 normalizedRow["price bid"] || normalizedRow["bid price"];

      if (cusip && priceStr && !seenCusips.has(cusip)) {
        const price = parseFloat(clean(priceStr).replace(/,/g, ''));
        if (!isNaN(price)) {
          priceMap.set(cusip, price);
        }
        seenCusips.add(cusip);
      }
    });

    console.log(`Broker CSV: Found ${priceMap.size} valid prices.`);

    if (priceMap.size === 0) {
      alert("No valid prices found in the CSV. (Supported: Schwab Brokerage, Fidelity Quotes)");
      e.target.value = '';
      return;
    }
    brokerPrices = priceMap;
    processAndRender();
  } catch (err) {
    alert("Error parsing CSV: " + err.message);
  }
});

document.getElementById('resetFedInvest').onclick = () => {
  brokerPrices = null;
  document.getElementById('brokerFile').value = '';
  processAndRender();
};

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
  const type = typeCheckboxMap[e.target.id];
  if (!type) return;
  if (e.target.checked) nominalsTypeFilters.add(type);
  else nominalsTypeFilters.delete(type);
  processAndRenderNominals();
});

init();

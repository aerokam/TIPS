// Yield Curves — Frontend Logic
import { yieldFromPrice } from '../../shared/src/bond-math.js';
import { handleChartKeydown } from '../../shared/src/chart-keys.js';

console.log("Yields app.js loading...");

const R2_BASE_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const YIELDS_CSV_URL = `${R2_BASE_URL}/Treasuries/Yields.csv`;
const REF_CPI_CSV_URL = `${R2_BASE_URL}/Treasuries/RefCpiNsaSa.csv`;
const HOLIDAYS_CSV_URL = `${R2_BASE_URL}/misc/BondHolidaysSifma.csv`;
const FIDELITY_TREASURIES_URL = `${R2_BASE_URL}/Treasuries/FidelityTreasuries.csv`;
const FIDELITY_TIPS_URL = `${R2_BASE_URL}/Treasuries/FidelityTips.csv`;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// --- State ---
let rawYieldsData = null;
let rawNominalsData = null;
let rawRefCpiData = null;
let holidaySet = new Set();
let brokerPrices = null;
let brokerDownloadDate = null;    // download date string from Fidelity TIPS CSV footer
let fidelityNominalsData = null;  // processed bond objects from Fidelity CSV
let fidelityNominalsDate = null;  // download date string extracted from CSV footer
let nominalsShowStrips = false;
let nominalsClipOutliers = true;
let chart = null;
let chartTab = null;
const savedZoom = { tips: null, treasuries: null };
const savedDateRange = { tips: null, treasuries: null };

// CUSIP 6-char prefixes that identify STRIPS instruments
const STRIPS_PREFIXES = new Set(['912803','912820','912821','912833','912834']);
const isStrip = cusip => STRIPS_PREFIXES.has((cusip || '').slice(0, 6));
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


// Parse "MM/DD/YYYY HH:MM AM/PM" (Fidelity footer) → Date (date part only)
function parseFidelityDateStr(s) {
  const [mo, dy, yr] = (s || '').split(' ')[0].split('/').map(Number);
  return new Date(yr, mo - 1, dy);
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

// Format a Date object → MM/DD/YYYY
function fmtDateMDY(date) {
  return String(date.getMonth() + 1).padStart(2, '0') + '/' +
         String(date.getDate()).padStart(2, '0') + '/' +
         date.getFullYear();
}

// Broker timestamp "MM/DD/YYYY HH:MM AM/PM" → "MM/DD HH:MM AM/PM" (drop year)
function fmtBrokerTime(s) {
  if (!s) return s;
  const [datePart, ...rest] = s.split(' ');
  const [m, d] = datePart.split('/');
  return `${m}/${d} ${rest.join(' ')}`;
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
    const [yieldsRes, refCpiRes, holidayRes, fidTreasuriesRes, fidTipsRes] = await Promise.all([
      fetch(YIELDS_CSV_URL).then(r => { console.log("Yields fetched"); return r; }).catch(e => ({ ok: false, error: e })),
      fetch(REF_CPI_CSV_URL).then(r => { console.log("RefCPI fetched"); return r; }).catch(e => ({ ok: false, error: e })),
      fetch(HOLIDAYS_CSV_URL).then(r => { console.log("Holidays fetched"); return r; }).catch(e => ({ ok: false, error: e })),
      fetch(FIDELITY_TREASURIES_URL).then(r => { console.log("Fidelity Treasuries fetched"); return r; }).catch(e => ({ ok: false, error: e })),
      fetch(FIDELITY_TIPS_URL).then(r => { console.log("Fidelity TIPS fetched"); return r; }).catch(e => ({ ok: false, error: e })),
    ]);

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

    if (fidTreasuriesRes.ok) {
      const fidText = await fidTreasuriesRes.text();
      const { bonds, downloadDate } = parseFidelityNominals(fidText);
      if (bonds.length > 0) {
        fidelityNominalsData = bonds;
        fidelityNominalsDate = downloadDate;
        const chkFid = document.getElementById('chkFidelity');
        chkFid.disabled = false;
        chkFid.checked = true;
        document.getElementById('fidelityDateLabel').textContent = downloadDate ? ` (${fmtBrokerTime(downloadDate)} ET)` : '';
        console.log(`Loaded ${bonds.length} Fidelity Treasuries (${downloadDate})`);
      }
    } else {
      console.warn('Fidelity Treasuries not available on R2');
    }

    if (fidTipsRes.ok) {
      const fidTipsText = await fidTipsRes.text();
      const rows = parseCsv(fidTipsText);
      const clean = val => (val || '').replace(/^=?["']*/, '').replace(/["']*$/, '').trim();
      const priceMap = new Map();
      const seenCusips = new Set();
      rows.forEach(row => {
        const n = {};
        for (const k in row) n[k.toLowerCase().trim()] = row[k];
        const cusip = clean(n['cusip']);
        const priceStr = n['price ask'] || n['ask price'] || n['price'] || n['price bid'];
        if (!cusip || seenCusips.has(cusip)) return;
        if (!rawYieldsData || !rawYieldsData.some(r => r.cusip === cusip)) return;
        const price = parseFloat(clean(priceStr || '').replace(/,/g, ''));
        if (!isNaN(price)) priceMap.set(cusip, price);
        seenCusips.add(cusip);
      });
      if (priceMap.size > 0) {
        brokerPrices = priceMap;
        const m = fidTipsText.match(/Date downloaded\s+([\d/]+ [\d:]+ [AP]M)/i);
        const downloadDate = m ? m[1] : null;
        brokerDownloadDate = downloadDate;
        const chkBroker = document.getElementById('chkTipsBroker');
        chkBroker.disabled = false;
        chkBroker.checked = true;
        document.getElementById('tipsBrokerDateLabel').textContent = downloadDate ? ` (${fmtBrokerTime(downloadDate)} ET)` : '';
        console.log(`Loaded ${priceMap.size} Fidelity TIPS prices (${downloadDate})`);
      }
    } else {
      console.warn('Fidelity TIPS not available on R2');
    }

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
  // Save date range for the tab we're leaving
  savedDateRange[activeTab] = {
    start: document.getElementById('startMaturity').value,
    end: document.getElementById('endMaturity').value,
    startCal: document.getElementById('startMaturityCal').value,
    endCal: document.getElementById('endMaturityCal').value,
  };

  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Show/Hide Source UI groups
  document.getElementById('tipsSourceUI').style.display = tab === 'tips' ? 'flex' : 'none';
  document.getElementById('treasuriesSourceUI').style.display = tab === 'treasuries' ? 'flex' : 'none';

  // Table visibility
  document.getElementById('saTable').style.display = tab === 'tips' ? '' : 'none';
  document.getElementById('nominalsTable').style.display = tab === 'treasuries' ? '' : 'none';

  // Controls visibility
  document.getElementById('tipsControls').style.display = tab === 'tips' ? 'flex' : 'none';
  document.getElementById('nominalsControls').style.display = tab === 'treasuries' ? 'flex' : 'none';

  // Restore date range for the tab we're switching to (clear if never set so render can auto-populate)
  const dr = savedDateRange[tab];
  document.getElementById('startMaturity').value = dr ? dr.start : '';
  document.getElementById('endMaturity').value = dr ? dr.end : '';
  document.getElementById('startMaturityCal').value = dr ? dr.startCal : '';
  document.getElementById('endMaturityCal').value = dr ? dr.endCal : '';

  processAndRender();
}

// Pure parser — works with text from file upload or R2 fetch
function parseFidelityNominals(text) {
  const clean = val => (val || '').replace(/^=?["']*/, '').replace(/["']*$/, '').trim();
  const m = text.match(/Date downloaded\s+([\d/]+ [\d:]+ [AP]M)/i);
  const downloadDate = m ? m[1] : null;
  const rows = parseCsv(text);
  const bonds = [];
  const seen = new Set();
  
  // Create lookup for valid nominal CUSIPs from our FedInvest data
  const validNominalCusips = new Set(rawNominalsData.map(r => r.cusip));

  for (const row of rows) {
    const n = {};
    for (const k in row) n[k.toLowerCase().trim()] = row[k];
    const cusip   = clean(n['cusip']);
    const desc    = (n['description'] || '').toUpperCase();
    
    if (!cusip || seen.has(cusip)) continue;
    
    // Explicitly reject if it's a known TIPS CUSIP or described as such
    if (rawYieldsData.some(r => r.cusip === cusip) || /\bTIPS\b/.test(desc)) {
      continue;
    }

    // Only accept if it's a known nominal Treasury CUSIP or a recognized STRIP
    const isActuallyStrip = isStrip(cusip);
    if (!validNominalCusips.has(cusip) && !isActuallyStrip) {
      continue;
    }

    const matStr  = clean(n['maturity date']);        // MM/DD/YYYY
    const yldStr  = clean(n['ask yield to maturity']);
    const couponStr = clean(n['coupon']);
    const priceStr  = clean(n['price ask']);
    if (!matStr) continue;
    const [mo, dy, yr] = matStr.split('/');
    if (!yr) continue;
    const maturity = `${yr}-${mo.padStart(2,'0')}-${dy.padStart(2,'0')}`;
    const maturityDate = localDate(maturity);
    const yld = parseFloat(yldStr) / 100;
    if (!maturityDate || isNaN(yld)) continue;
    
    let type = /BILL/.test(desc) ? 'MARKET BASED BILL'
             : /\bNOTE\b/.test(desc) ? 'MARKET BASED NOTE'
             : 'MARKET BASED BOND';
    if (isActuallyStrip) type = 'MARKET BASED STRIP';

    seen.add(cusip);
    bonds.push({ cusip, type, coupon: parseFloat(couponStr) || 0, price: parseFloat(priceStr.replace(/,/g,'')) || NaN, yield: yld, maturity, maturityDate });
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
    const startCalEl = document.getElementById('startMaturityCal');
    const endCalEl = document.getElementById('endMaturityCal');
    if (!startEl.value && allBonds.length > 0) {
      startEl.value = isoToMDY(allBonds[0].maturity);
      endEl.value = isoToMDY(allBonds[allBonds.length - 1].maturity);
      startCalEl.value = allBonds[0].maturity;
      endCalEl.value = allBonds[allBonds.length - 1].maturity;
      setupDateInput(startEl, startCalEl, () => processAndRender());
      setupDateInput(endEl, endCalEl, () => processAndRender());
    }

    const startDate = parseDateInput(startEl.value) || new Date(0);
    const endDate = parseDateInput(endEl.value) || new Date(9999, 0);
    const inRange = b => b.maturityDate >= startDate && b.maturityDate <= endDate;
    const fedFiltered = fedProcessed ? fedProcessed.filter(inRange) : null;
    const fidFiltered = fidProcessed ? fidProcessed.filter(inRange) : null;

    renderNominalsTable(fedFiltered, fidFiltered);
    renderNominalsChart(fedFiltered, fidFiltered);

    const infoEl = document.getElementById('info-strip');
    const parts = [];
    if (showFed) parts.push(`FedInvest settle ${isoToMDY(rawNominalsData[0]?.settlementDate)} (T)`);
    if (showFid && fidelityNominalsDate) {
      const loadDate = parseFidelityDateStr(fidelityNominalsDate);
      const t1 = nextBusinessDay(loadDate, holidaySet);
      parts.push(`Market ${fmtBrokerTime(fidelityNominalsDate)} ET · settle ${isoToMDY(toIsoDate(t1))} (T+1)`);
    }
    infoEl.textContent = parts.join(' \xb7 ');
    const fedCount = fedFiltered?.length || 0;
    const fidCount = fidFiltered?.length || 0;
    const parts2 = [];
    if (showFed) parts2.push(`FedInvest: ${fedCount}`);
    if (showFid) parts2.push(`Market: ${fidCount}`);
    statusEl.textContent = parts2.join(' · ');
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

  const toPoint = b => ({ x: b.maturityDate.getTime(), y: parseFloat((b.yield * 100).toFixed(3)) });
  const bothShown = fedBonds && fidBonds;

  // FedInvest: cool blues/purple — Fidelity: warm orange/red/teal (all solid)
  const seriesDef = [];
  if (fedBonds) {
    const sfx = bothShown ? ' (FedInvest)' : '';
    seriesDef.push(
      { label: `Bills${sfx}`,  data: fedBonds.filter(b => b.type === 'MARKET BASED BILL' && !isStrip(b.cusip)).map(toPoint), color: '#0ea5e9', r: 2, w: 1.5 },
      { label: `Notes${sfx}`,  data: fedBonds.filter(b => b.type === 'MARKET BASED NOTE' && !isStrip(b.cusip)).map(toPoint), color: '#1a56db', r: 0, w: 2.5 },
      { label: `Bonds${sfx}`,  data: fedBonds.filter(b => b.type === 'MARKET BASED BOND' && !isStrip(b.cusip)).map(toPoint), color: '#7c3aed', r: 0, w: 2.5 },
      { label: `STRIPS${sfx}`, data: fedBonds.filter(b => isStrip(b.cusip)).map(toPoint), color: '#64748b', r: 0, w: 2.2 }
    );
  }
  if (fidBonds) {
    const sfx = bothShown ? ' (Market)' : '';
    seriesDef.push(
      { label: `Bills${sfx}`,  data: fidBonds.filter(b => b.type === 'MARKET BASED BILL' && !isStrip(b.cusip)).map(toPoint), color: '#f97316', r: 2, w: 1.5 },
      { label: `Notes${sfx}`,  data: fidBonds.filter(b => b.type === 'MARKET BASED NOTE' && !isStrip(b.cusip)).map(toPoint), color: '#dc2626', r: 0, w: 2.5 },
      { label: `Bonds${sfx}`,  data: fidBonds.filter(b => b.type === 'MARKET BASED BOND' && !isStrip(b.cusip)).map(toPoint), color: '#059669', r: 0, w: 2.5 },
      { label: `STRIPS${sfx}`, data: fidBonds.filter(b => isStrip(b.cusip)).map(toPoint), color: '#78350f', r: 0, w: 2.2 }
    );
  }

  // Filter series with no data points
  const activeSeries = seriesDef.filter(s => s.data.length > 0);
  const allPoints = activeSeries.flatMap(s => s.data);
  if (allPoints.length === 0) { if (chart) { chart.destroy(); chart = null; } return; }

  const minDate = new Date(Math.min(...allPoints.map(d => d.x)));
  const maxDate = new Date(Math.max(...allPoints.map(d => d.x)));
  const minX = new Date(minDate.getFullYear(), minDate.getMonth(), 1).getTime();
  const maxX = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1).getTime();
  const spanMonths = (maxDate.getFullYear() - minDate.getFullYear()) * 12 + (maxDate.getMonth() - minDate.getMonth());
  const timeUnit = spanMonths <= 18 ? 'month' : 'year';
  const allY = allPoints.map(d => d.y);
  let scaleY = allY;
  if (nominalsClipOutliers && allY.length >= 4) {
    const sorted = [...allY].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    const clipped = allY.filter(y => y >= lo && y <= hi);
    if (clipped.length > 0) scaleY = clipped;
  }
  const minYRaw = Math.min(...scaleY), maxYRaw = Math.max(...scaleY);
  const minY = Math.floor(minYRaw * 20) / 20;
  const maxY = Math.ceil(maxYRaw * 20) / 20;
  const dataRange = maxY - minY;
  const step = dataRange <= 0.5 ? 0.05 : dataRange <= 1.0 ? 0.1 : 0.25;

  const zoomToRestore = savedZoom['treasuries'];
  if (chart && chartTab) savedZoom[chartTab] = {
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
        pointRadius: s.r,
        pointHoverRadius: s.r > 0 ? s.r + 2 : 3,
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
            title: (items) => fmtDateMDY(new Date(items[0].parsed.x)),
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

  document.getElementById('resetZoom').onclick = () => {
    savedZoom['treasuries'] = null;
    chart.resetZoom('none');
    rescaleToVisible(chart);
  };
}

function processAndRenderTips() {
  const statusEl = document.getElementById('status');
  const showFed = document.getElementById('chkTipsFed').checked;
  const showBroker = document.getElementById('chkTipsBroker').checked && !!brokerPrices;

  if (!showFed && !showBroker) { statusEl.textContent = ''; if (chart) { chart.destroy(); chart = null; } return; }
  if (!rawYieldsData || rawYieldsData.length === 0 || !rawRefCpiData) return;

  try {
    const infoEl = document.getElementById('info-strip');
    const fedSettleStr = rawYieldsData[0]?.settlementDate;

    // Build the processed set for each active source
    const getProcessed = (sourceMap, isBroker) => {
      return rawYieldsData.map(bond => {
        const coupon = parseFloat(bond.coupon);
        let price = parseFloat(bond.price);
        let settleDateStr = bond.settlementDate;
        
        if (isBroker) {
          if (!sourceMap.has(bond.cusip)) return null;
          price = sourceMap.get(bond.cusip);
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

        if (isNaN(saSettle) || isNaN(saMature)) return null;

        const askYield = yieldFromPrice(price, coupon, localDate(settleDateStr), localDate(bond.maturity));
        const saYield = yieldFromPrice(price * (saSettle / saMature), coupon, localDate(settleDateStr), localDate(bond.maturity));
        return { ...bond, coupon, price, askYield, saYield, maturityDate: localDate(bond.maturity), settlementDate: settleDateStr, isBroker };
      }).filter(Boolean).sort((a, b) => a.maturityDate - b.maturityDate);
    };

    let fedBonds = showFed ? getProcessed(null, false) : null;
    let brokerBonds = showBroker ? getProcessed(brokerPrices, true) : null;

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
    const startCalEl = document.getElementById('startMaturityCal');
    const endCalEl = document.getElementById('endMaturityCal');

    const allCurrent = [...(fedBonds || []), ...(brokerBonds || [])].sort((a, b) => a.maturityDate - b.maturityDate);
    if (!startEl.value && allCurrent.length > 0) {
      startEl.value = isoToMDY(allCurrent[0].maturity);
      endEl.value = isoToMDY(allCurrent[allCurrent.length - 1].maturity);
      startCalEl.value = allCurrent[0].maturity;
      endCalEl.value = allCurrent[allCurrent.length - 1].maturity;
      setupDateInput(startEl, startCalEl, () => processAndRender());
      setupDateInput(endEl, endCalEl, () => processAndRender());
    }

    const startDate = parseDateInput(startEl.value) || new Date(0);
    const endDate = parseDateInput(endEl.value) || new Date(9999, 0);
    const inRange = b => b.maturityDate >= startDate && b.maturityDate <= endDate;
    const fedFiltered = fedBonds ? fedBonds.filter(inRange) : null;
    const brokerFiltered = brokerBonds ? brokerBonds.filter(inRange) : null;

    renderTable(fedFiltered, brokerFiltered);
    renderChart(fedFiltered, brokerFiltered);

    const parts = [];
    if (showFed) parts.push(`FedInvest settle ${isoToMDY(fedSettleStr)} (T)`);
    if (showBroker) {
      const loadDate = brokerDownloadDate ? parseFidelityDateStr(brokerDownloadDate) : localDate(fedSettleStr);
      const t1 = nextBusinessDay(loadDate, holidaySet);
      const timeStr = brokerDownloadDate ? fmtBrokerTime(brokerDownloadDate) : isoToMDY(fedSettleStr);
      parts.push(`Market ${timeStr} ET · settle ${isoToMDY(toIsoDate(t1))} (T+1)`);
    }
    infoEl.textContent = parts.join(' \xb7 ');
    const fedCount = fedFiltered?.length || 0;
    const brokerCount = brokerFiltered?.length || 0;
    const parts2 = [];
    if (showFed) parts2.push(`FedInvest: ${fedCount}`);
    if (showBroker) parts2.push(`Market: ${brokerCount}`);
    statusEl.textContent = parts2.join(' · ');
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

function renderChart(fedBonds, brokerBonds) {
  const ctx = document.getElementById('yieldChart').getContext('2d');
  const allBonds = [...(fedBonds || []), ...(brokerBonds || [])];
  if (allBonds.length === 0) { if (chart) { chart.destroy(); chart = null; } return; }

  const toPt = (b, key) => ({ x: b.maturityDate.getTime(), y: parseFloat((b[key] * 100).toFixed(3)) });
  const both = fedBonds && brokerBonds;
  const seriesDef = [];

  if (fedBonds) {
    const sfx = both ? ' (Fed)' : '';
    seriesDef.push(
      { label: `Ask${sfx}`, data: fedBonds.map(b => toPt(b, 'askYield')), color: '#94a3b8', style: 'rect', w: 1.5, r: 3.5 },
      { label: `SA${sfx}`,  data: fedBonds.map(b => toPt(b, 'saYield')),  color: '#475569', style: 'crossRot', w: 1.8, r: 4 },
      { label: `SAO${sfx}`, data: fedBonds.map(b => toPt(b, 'saoYield')), color: '#1a56db', style: 'circle', w: 2.2, r: 2.5 }
    );
  }
  if (brokerBonds) {
    const sfx = both ? ' (Market)' : '';
    seriesDef.push(
      { label: `Ask${sfx}`, data: brokerBonds.map(b => toPt(b, 'askYield')), color: '#f97316', style: 'rect', w: 1.5, r: 3.5 },
      { label: `SA${sfx}`,  data: brokerBonds.map(b => toPt(b, 'saYield')),  color: '#dc2626', style: 'crossRot', w: 1.8, r: 4 },
      { label: `SAO${sfx}`, data: brokerBonds.map(b => toPt(b, 'saoYield')), color: '#059669', style: 'circle', w: 2.2, r: 2.5 }
    );
  }

  const activeSeries = seriesDef.filter(s => s.data.length > 0);
  const allPoints = activeSeries.flatMap(s => s.data);
  const minDate = new Date(Math.min(...allPoints.map(d => d.x)));
  const maxDate = new Date(Math.max(...allPoints.map(d => d.x)));
  const minX = new Date(minDate.getFullYear(), 0, 1).getTime();
  const maxX = new Date(maxDate.getFullYear() + 1, 0, 1).getTime();
  const allY = allPoints.map(d => d.y);
  const minY = Math.floor(Math.min(...allY) * 4) / 4;
  const maxY = Math.ceil(Math.max(...allY) * 4) / 4;

  const zoomToRestore = savedZoom['tips'];
  if (chart && chartTab) savedZoom[chartTab] = {
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
        pointRadius: s.r,
        pointStyle: s.style,
        tension: 0.1
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'time', min: minX, max: maxX, time: { unit: 'year', displayFormats: { year: 'MMM yyyy' } }, grid: { color: 'rgba(0,0,0,0.05)' } },
        y: { type: 'linear', title: { display: true, text: 'Yield (%)' }, min: minY, max: maxY, ticks: { stepSize: 0.25, callback: (v) => v.toFixed(2) } }
      },
      plugins: {
        legend: {
          labels: { usePointStyle: true, boxWidth: 8, padding: 15, font: { size: 12, weight: '500' } },
          onClick: (e, item, legend) => { Chart.defaults.plugins.legend.onClick(e, item, legend); rescaleToVisible(legend.chart); }
        },
        zoom: {
          pan: { enabled: true, mode: 'xy', onPanComplete: ({chart}) => updateDynamicTicks(chart) },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy', onZoomComplete: ({chart}) => updateDynamicTicks(chart) }
        },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.95)', titleColor: '#1e293b', bodyColor: '#475569', borderColor: '#e2e8f0', borderWidth: 1, padding: 8, cornerRadius: 6, displayColors: false,
          callbacks: {
            title: (items) => fmtDateMDY(new Date(items[0].parsed.x)),
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
  }

  document.getElementById('resetZoom').onclick = () => {
    savedZoom['tips'] = null;
    chart.resetZoom('none');
    rescaleToVisible(chart);
  };
}

function rescaleToVisible(chart) {
  let allVisibleY = [];

  chart.data.datasets.forEach((dataset, i) => {
    if (!chart.isDatasetVisible(i)) return;
    dataset.data.forEach(p => allVisibleY.push(p.y));
  });

  if (allVisibleY.length === 0) return;

  if (nominalsClipOutliers && chartTab === 'treasuries' && allVisibleY.length >= 4) {
    const sorted = [...allVisibleY].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    const clipped = allVisibleY.filter(y => y >= lo && y <= hi);
    if (clipped.length > 0) allVisibleY = clipped;
  }

  const visibleMinY = Math.min(...allVisibleY);
  const visibleMaxY = Math.max(...allVisibleY);
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

// TIPS 'Show' Checkboxes & Links
['showTipsAsk', 'showTipsSa', 'showTipsSao'].forEach((id, idx) => {
  document.getElementById(id).addEventListener('change', (e) => {
    if (!chart || activeTab !== 'tips') return;
    const both = document.getElementById('chkTipsFed').checked && document.getElementById('chkTipsBroker').checked;
    
    // Dataset indexing: if both sources are active, indices are 0-2 (Fed), 3-5 (Broker)
    // Indices map: 0/3=Ask, 1/4=SA, 2/5=SAO
    const indices = both ? [idx, idx + 3] : [idx];
    indices.forEach(i => {
      if (chart.data.datasets[i]) chart.setDatasetVisibility(i, e.target.checked);
    });
    chart.update('none');
    rescaleToVisible(chart);
  });
});

document.getElementById('tipsShowAll').onclick = (e) => {
  e.preventDefault();
  ['showTipsAsk', 'showTipsSa', 'showTipsSao'].forEach(id => {
    const el = document.getElementById(id);
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
document.getElementById('tipsShowNone').onclick = (e) => {
  e.preventDefault();
  ['showTipsAsk', 'showTipsSa', 'showTipsSao'].forEach(id => {
    const el = document.getElementById(id);
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

// Nominals 'All/None' Links
document.getElementById('nominalsShowAll').onclick = (e) => {
  e.preventDefault();
  ['filterBills', 'filterNotes', 'filterBonds'].forEach(id => {
    const el = document.getElementById(id);
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
document.getElementById('nominalsShowNone').onclick = (e) => {
  e.preventDefault();
  ['filterBills', 'filterNotes', 'filterBonds'].forEach(id => {
    const el = document.getElementById(id);
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};



// Unified Source Change Handlers
['chkTipsFed', 'chkTipsBroker'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => { savedZoom['tips'] = null; processAndRender(); });
});
['chkFedInvest', 'chkFidelity'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => { savedZoom['treasuries'] = null; processAndRender(); });
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
  if (e.target.id === 'clipOutliers') {
    nominalsClipOutliers = e.target.checked;
    savedZoom['treasuries'] = null;
    processAndRenderNominals();
    return;
  }
  if (e.target.id === 'filterStrips') {
    nominalsShowStrips = e.target.checked;
    savedZoom['treasuries'] = null;
    processAndRenderNominals();
    return;
  }
  const type = typeCheckboxMap[e.target.id];
  if (!type) return;
  if (e.target.checked) nominalsTypeFilters.add(type);
  else nominalsTypeFilters.delete(type);
  savedZoom['treasuries'] = null;
  processAndRenderNominals();
});

init();

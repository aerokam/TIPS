// TIPS Seasonal Adjustment (TipsSA) Frontend Logic
import { yieldFromPrice } from '../../shared/src/bond-math.js';
import { handleChartKeydown } from '../../shared/src/chart-keys.js';

console.log("TipsSA app.js loading...");

const R2_BASE_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const YIELDS_CSV_URL = `${R2_BASE_URL}/TIPS/TipsYields.csv`;
const REF_CPI_CSV_URL = `${R2_BASE_URL}/TIPS/RefCpiNsaSa.csv`;
const HOLIDAYS_CSV_URL = `${R2_BASE_URL}/misc/BondHolidaysSifma.csv`;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// --- State ---
let rawYieldsData = null;
let rawRefCpiData = null;
let holidaySet = new Set();
let brokerPrices = null;
let chart = null;
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

async function _showIntuitionGuide() {
  try {
    const res = await fetch('./knowledge/4.0_SA_Intuition.md');
    const md = await res.text();
    const html = md
      .replace(/^# (.*$)/gm, '<h1 style="font-size:1.5em;margin:0 0 16px;color:#1a56db;">$1</h1>')
      .replace(/^## (.*$)/gm, '<h2 style="font-size:1.2em;margin:20px 0 12px;color:#1e293b;border-bottom:1px solid #e2e8f0;padding-bottom:4px;">$1</h2>')
      .replace(/^### (.*$)/gm, '<h3 style="font-size:1em;margin:16px 0 8px;color:#334155;">$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^- (.*$)/gm, '<li style="margin-bottom:6px;">$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>')
      .replace(/<p><li>/g, '<ul style="margin-bottom:16px;"><li>')
      .replace(/<\/li><\/p>/g, '</li></ul>');
    
    _showDrillPopup('Intuition: Seasonal Adjustments', html);
  } catch (err) {
    alert('Failed to load guide: ' + err.message);
  }
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
      <p>The <strong>SA Yield</strong> is calculated by finding the internal rate of return (IRR) of the bond using the <strong>Adjusted Price</strong> instead of the market price.</p>
      <p>A ratio &lt; 1.0 reduces the price (increasing yield), while a ratio &gt; 1.0 increases the price (decreasing yield).</p>
    </div>
  `;
  _showDrillPopup(`SA Drill-down: ${bond.cusip} (${fmtMMM(bond.maturity)})`, html);
}

// ─── Main Logic ──────────────────────────────────────────────────────────────

async function init() {
  const statusEl = document.getElementById('status');
  console.log("init() started");
  
  try {
    const [yieldsRes, refCpiRes, holidayRes] = await Promise.all([
      fetch(YIELDS_CSV_URL).catch(e => ({ ok: false, error: e })),
      fetch(REF_CPI_CSV_URL).catch(e => ({ ok: false, error: e })),
      fetch(HOLIDAYS_CSV_URL).catch(e => ({ ok: false, error: e }))
    ]);

    if (!yieldsRes.ok) throw new Error(`Failed to fetch yields: ${yieldsRes.status || yieldsRes.error}`);
    if (!refCpiRes.ok) throw new Error(`Failed to fetch Ref CPI: ${refCpiRes.status || refCpiRes.error}`);
    if (!holidayRes.ok) throw new Error(`Failed to fetch bond holidays: ${holidayRes.status || holidayRes.error}`);

    console.log("Fetches complete, parsing...");
    rawYieldsData = parseCsv(await yieldsRes.text());
    rawRefCpiData = parseCsv(await refCpiRes.text());
    
    console.log(`Parsed ${rawYieldsData.length} yield rows and ${rawRefCpiData.length} RefCPI rows.`);

    const holidayRows = parseCsv(await holidayRes.text(), false);
    holidaySet = new Set();
    holidayRows.forEach(row => {
      const datePart = row[0].split(',').slice(1).join(',').trim(); 
      const d = new Date(datePart);
      if (!isNaN(d.getTime())) holidaySet.add(toIsoDate(d));
    });

    processAndRender();

    window.addEventListener('keydown', (e) => {
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

    let trendWeight = 0.3;
    if (yearsToMat < 0.5) trendWeight = 0.9; 
    else if (yearsToMat < 2) trendWeight = 0.5; 
    else if (yearsToMat < 5) trendWeight = 0.4;

    sao[i] = (projected * trendWeight) + (bond.saYield * (1 - trendWeight));
  }
  return sao;
}

function processAndRender() {
  console.log("processAndRender() started");
  if (!rawYieldsData || rawYieldsData.length === 0 || !rawRefCpiData) {
    console.warn("No data to process.");
    return;
  }

  const statusEl = document.getElementById('status');
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
    infoEl.textContent = `Broker Prices · Settlement Date: ${displaySettle} (T+1)`;
  } else {
    priceSourceEl.style.display = 'none';
    infoEl.textContent = `FedInvest market data · Settlement Date: ${fedSettleStr} (T)`;
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

    const saSettle = parseFloat(rawRefCpiData.find(r => r["Ref CPI Date"].includes(`-${mmddSettle}`))?.["SA Factor"]);
    const saMature = parseFloat(rawRefCpiData.find(r => r["Ref CPI Date"].includes(`-${mmddMature}`))?.["SA Factor"]);

    if (!saSettle || !saMature) return null;

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

  const startSel = document.getElementById('startMaturity');
  const endSel = document.getElementById('endMaturity');
  if (startSel.options.length === 0) {
    allProcessed.forEach((b, i) => {
      const opt = (selected) => {
        const o = document.createElement('option');
        o.value = b.maturity; o.textContent = fmtMMM(b.maturity);
        if (selected) o.selected = true;
        return o;
      };
      startSel.appendChild(opt(i === 0));
      endSel.appendChild(opt(i === allProcessed.length - 1));
    });
    startSel.onchange = () => processAndRender();
    endSel.onchange = () => processAndRender();
  }

  const startDate = localDate(startSel.value);
  const endDate = localDate(endSel.value);
  const filteredBonds = allProcessed.filter(b => b.maturityDate >= startDate && b.maturityDate <= endDate);

  renderTable(filteredBonds);
  renderChart(filteredBonds);
  statusEl.textContent = `Successfully loaded ${filteredBonds.length} TIPS.`;
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
          labels: { usePointStyle: true, boxWidth: 8, padding: 15, font: { size: 12, weight: '500' } }
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
    chart.options.scales.y.min = minY;
    chart.options.scales.y.max = maxY;
    chart.options.scales.y.ticks.stepSize = 0.25;
    chart.update();
  };
}

function updateDynamicTicks(chart) {
  const xAx = chart.scales.x;
  let visibleMinY = Infinity;
  let visibleMaxY = -Infinity;

  chart.data.datasets.forEach((dataset, datasetIndex) => {
    if (!chart.isDatasetVisible(datasetIndex)) return;
    dataset.data.forEach(p => {
      if (p.x >= xAx.min && p.x <= xAx.max) {
        if (p.y < visibleMinY) visibleMinY = p.y;
        if (p.y > visibleMaxY) visibleMaxY = p.y;
      }
    });
  });

  if (visibleMinY === Infinity) return;

  const range = visibleMaxY - visibleMinY;
  let newStep = 0.25;
  if (range > 3) newStep = 0.50;  
  if (range > 7) newStep = 1.00;  
  if (range < 0.6) newStep = 0.05; 

  const snappedMin = Math.floor((visibleMinY - 0.01) / newStep) * newStep;
  const snappedMax = Math.ceil((visibleMaxY + 0.01) / newStep) * newStep;

  chart.options.scales.y.min = snappedMin;
  chart.options.scales.y.max = snappedMax;
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
    
    rows.forEach(row => {
      const desc = row["Description"] || "";
      let cusip = null;
      let priceStr = null;
      const cusipMatch = desc.match(/[A-Z0-9]{9}/);
      if (cusipMatch) {
        cusip = cusipMatch[0];
        priceStr = row["Price"];
      } else if (row["Cusip"]) {
        cusip = row["Cusip"];
        priceStr = row["Price Ask"];
      }
      if (cusip && !seenCusips.has(cusip)) {
        const price = parseFloat((priceStr || "").replace(/,/g, ''));
        if (!isNaN(price)) priceMap.set(cusip, price);
        seenCusips.add(cusip);
      }
    });

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
  _showSaDrill(td.dataset.cusip);
});

document.addEventListener('click', (e) => {
  if (e.target.id === 'why-adjust-link') {
    _showIntuitionGuide();
  }
});

init();

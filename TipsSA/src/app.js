// TIPS Seasonal Adjustment (TipsSA) Frontend Logic

const R2_BASE_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const YIELDS_CSV_URL = `${R2_BASE_URL}/TIPS/TipsYields.csv`;
const REF_CPI_CSV_URL = `${R2_BASE_URL}/TIPS/RefCpiNsaSa.csv`;

// --- Helpers ---
function parseCsv(text) {
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

  const headers = parseRow(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = values[idx];
    });
    result.push(obj);
  }
  return result;
}

function localDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Yield calculation (actual/actual)
function yieldFromPrice(cleanPrice, coupon, settleDateStr, maturityStr) {
  if (!cleanPrice || cleanPrice <= 0) return null;
  const settle = localDate(settleDateStr);
  const mature = localDate(maturityStr);
  if (settle >= mature) return null;

  const semiCoupon = (coupon / 2) * 100;
  const matMon = mature.getMonth() + 1;
  const cm1 = matMon <= 6 ? matMon : matMon - 6;
  const cm2 = cm1 + 6;

  function nextCouponOnOrAfter(d) {
    const candidates = [];
    for (let y = d.getFullYear() - 1; y <= d.getFullYear() + 1; y++) {
      candidates.push(new Date(y, cm1 - 1, 15));
      candidates.push(new Date(y, cm2 - 1, 15));
    }
    candidates.sort((a, b) => a - b);
    return candidates.find(c => c >= d && c <= mature) || null;
  }

  const nextCoupon = nextCouponOnOrAfter(settle);
  if (!nextCoupon) return null;
  const lastCoupon = new Date(nextCoupon.getFullYear(), nextCoupon.getMonth() - 6, 15);

  const days = (a, b) => (b - a) / 86400000;
  const E = days(lastCoupon, nextCoupon);
  const A = days(lastCoupon, settle);
  const DSC = days(settle, nextCoupon);
  const accrued = semiCoupon * (A / E);
  const dirtyPrice = cleanPrice + accrued;
  const w = DSC / E;

  const coupons = [];
  let d = new Date(nextCoupon);
  while (d <= mature) {
    coupons.push(new Date(d));
    d = new Date(d.getFullYear(), d.getMonth() + 6, 15);
  }
  const N = coupons.length;
  if (N === 0) return null;

  function pv(y) {
    const r = y / 2;
    let s = 0;
    for (let k = 0; k < N; k++) {
      const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
      s += cf / Math.pow(1 + r, w + k);
    }
    return s;
  }
  function dpv(y) {
    const r = y / 2;
    let s = 0;
    for (let k = 0; k < N; k++) {
      const cf = k === N - 1 ? semiCoupon + 100 : semiCoupon;
      s += (-cf * (w + k)) / (2 * Math.pow(1 + r, w + k + 1));
    }
    return s;
  }

  let y = coupon > 0.005 ? coupon : 0.02;
  for (let i = 0; i < 200; i++) {
    const diff = pv(y) - dirtyPrice;
    if (Math.abs(diff) < 1e-10) break;
    const deriv = dpv(y);
    if (Math.abs(deriv) < 1e-15) break;
    y -= diff / deriv;
  }
  return y;
}

let rawYieldsData = null;
let rawRefCpiData = null;
let brokerPrices = null;

async function init() {
  const statusEl = document.getElementById('status');
  
  try {
    const [yieldsRes, refCpiRes] = await Promise.all([
      fetch(YIELDS_CSV_URL).catch(e => ({ ok: false, error: e })),
      fetch(REF_CPI_CSV_URL).catch(e => ({ ok: false, error: e }))
    ]);

    if (!yieldsRes.ok) throw new Error(`Failed to fetch yields: ${yieldsRes.status}`);
    if (!refCpiRes.ok) throw new Error(`Failed to fetch RefCPI: ${refCpiRes.status}`);

    rawYieldsData = parseCsv(await yieldsRes.text());
    rawRefCpiData = parseCsv(await refCpiRes.text());

    processAndRender();

  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = 'error';
    console.error('Initialization failed:', err);
  }
}

// Backwards-Anchored Trend Fitting for SAO
function calculateSAO(bonds) {
  const n = bonds.length;
  const sao = new Array(n);
  const now = new Date();

  // Process from longest maturity to shortest
  for (let i = n - 1; i >= 0; i--) {
    const bond = bonds[i];
    const yearsToMat = (bond.maturityDate - now) / 31557600000;

    // 1. Long end (> 7 years): SAO strictly follows SA
    if (yearsToMat > 7 || i > n - 4) {
      sao[i] = bond.saYield;
      continue;
    }

    // 2. Short to Medium end: Fit to the trend established by longer maturities
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

    // 3. Blend logic
    // Refined weights: 2027 maturities (~1yr) should follow SA trend more (lower trendWeight)
    let trendWeight = 0.3;
    if (yearsToMat < 0.5) trendWeight = 0.9; // Very short end (e.g. Apr 2026) fits trend
    else if (yearsToMat < 2) trendWeight = 0.5; // Medium-short (e.g. 2027) follows SA more
    else if (yearsToMat < 5) trendWeight = 0.4;

    let candidate = (projected * trendWeight) + (bond.saYield * (1 - trendWeight));

    // 4. Strict Monotonicity Constraint (Right-to-Left)
    // If curve is positive (increasing to the right), shorter must be <= longer.
    if (i < n - 1) {
      candidate = Math.min(candidate, sao[i + 1]);
      
      // Specific fix for Apr 2026 vs Jul 2026: force a slight downward slope if very close
      const diffDays = (bonds[i+1].maturityDate - bond.maturityDate) / 86400000;
      if (yearsToMat < 0.6 && diffDays < 100) {
        candidate = Math.min(candidate, sao[i+1] - 0.00005); // Force at least 0.5bps lower
      }
    }

    sao[i] = candidate;
  }
  return sao;
}

function processAndRender() {
  if (!rawYieldsData || !rawRefCpiData) return;

  const statusEl = document.getElementById('status');
  const infoEl = document.getElementById('info-strip');
  const priceSourceEl = document.getElementById('priceSource');
  const sourceLabelEl = document.getElementById('priceSourceLabel');

  const fedSettleStr = rawYieldsData[0]?.settlementDate;
  
  if (brokerPrices) {
    const uploadTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    sourceLabelEl.textContent = `Using Broker Ask Prices (Uploaded at ${uploadTime})`;
    priceSourceEl.style.display = 'flex';
    infoEl.textContent = `Broker Prices (T+1 Settlement)`;
  } else {
    priceSourceEl.style.display = 'none';
    infoEl.textContent = `FedInvest Prices as of ${fedSettleStr}`;
  }

  // 1. Initial Processing
  const allProcessed = rawYieldsData.map(bond => {
    const coupon = parseFloat(bond.coupon);
    let price = parseFloat(bond.price);
    let settleDateStr = bond.settlementDate;

    if (brokerPrices && brokerPrices.has(bond.cusip)) {
      price = brokerPrices.get(bond.cusip);
      const today = new Date();
      const tPlus1 = new Date(today);
      tPlus1.setDate(today.getDate() + 1);
      settleDateStr = tPlus1.toISOString().split('T')[0];
    }

    const mmddSettle = settleDateStr.slice(5, 10);
    const mmddMature = bond.maturity.slice(5, 10);

    const saSettle = parseFloat(rawRefCpiData.find(r => r["Ref CPI Date"].includes(`-${mmddSettle}`))?.["SA Factor"]);
    const saMature = parseFloat(rawRefCpiData.find(r => r["Ref CPI Date"].includes(`-${mmddMature}`))?.["SA Factor"]);

    if (!saSettle || !saMature) return null;

    const askYield = yieldFromPrice(price, coupon, settleDateStr, bond.maturity);
    const saYield = yieldFromPrice(price * (saSettle / saMature), coupon, settleDateStr, bond.maturity);

    return { ...bond, coupon, price, askYield, saYield, maturityDate: localDate(bond.maturity) };
  }).filter(b => b !== null).sort((a, b) => a.maturityDate - b.maturityDate);

  // 2. Generate SAO Yields (Smoothed SA)
  const smoothed = calculateSAO(allProcessed);
  allProcessed.forEach((b, i) => {
    b.saoYield = smoothed[i];
    b.diffBps = (b.saYield - b.askYield) * 10000;
  });

  // 3. Setup Range Filter Dropdowns
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

document.getElementById('brokerFile').addEventListener('change', async (e) => {
  if (!e.target.files.length) return;
  try {
    const text = await e.target.files[0].text();
    const rows = parseCsv(text);
    const priceMap = new Map();
    const seenCusips = new Set();
    
    rows.forEach(row => {
      // 1. Check for standard format (CUSIP in Description)
      const desc = row["Description"] || "";
      let cusip = null;
      let priceStr = null;

      const cusipMatch = desc.match(/[A-Z0-9]{9}/);
      if (cusipMatch) {
        cusip = cusipMatch[0];
        priceStr = row["Price"];
      } else if (row["Cusip"]) {
        // 2. Check for Fidelity/Quotes format (Explicit Cusip column)
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

function fmtMMM(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function renderTable(bonds) {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = bonds.map(b => `
    <tr>
      <td>${fmtMMM(b.maturity)}</td>
      <td>${b.cusip}</td>
      <td>${(b.coupon * 100).toFixed(3)}%</td>
      <td>${b.price.toFixed(3)}</td>
      <td>${(b.askYield * 100).toFixed(3)}%</td>
      <td>${(b.saYield * 100).toFixed(3)}%</td>
      <td style="font-weight:700; color:#1a56db;">${(b.saoYield * 100).toFixed(3)}%</td>
      <td class="${b.diffBps >= 0 ? 'pos' : 'neg'}">${b.diffBps.toFixed(1)}</td>
    </tr>
  `).join('');
}

let chart = null;
function renderChart(bonds) {
  const ctx = document.getElementById('yieldChart').getContext('2d');
  
  if (bonds.length === 0) return;

  // Use Numbers for linear scales
  const askData = bonds.map(b => ({ x: b.maturityDate.getTime(), y: parseFloat((b.askYield * 100).toFixed(3)) }));
  const saData = bonds.map(b => ({ x: b.maturityDate.getTime(), y: parseFloat((b.saYield * 100).toFixed(3)) }));
  const saoData = bonds.map(b => ({ x: b.maturityDate.getTime(), y: parseFloat((b.saoYield * 100).toFixed(3)) }));

  // Explicitly set X bounds aligned to Jan 1st for consistent month labels
  const firstBondDate = new Date(Math.min(...askData.map(d => d.x)));
  const lastBondDate = new Date(Math.max(...askData.map(d => d.x)));
  const minX = new Date(firstBondDate.getFullYear(), 0, 1).getTime();
  const maxX = new Date(lastBondDate.getFullYear() + 1, 0, 1).getTime();

  // Calculate Y bounds rounded to nearest 0.25
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
          label: 'SA with Outlier Factor (SAO)',
          data: saoData,
          borderColor: '#1a56db', // Bold Blue
          backgroundColor: '#1a56db',
          borderWidth: 2.2,
          pointRadius: 2.5, // Even smaller
          pointStyle: 'circle',
          tension: 0.1,
          order: 1
        },
        {
          label: 'Seasonally Adjusted (SA)',
          data: saData,
          borderColor: '#475569', // Dark Gray
          backgroundColor: '#475569',
          borderWidth: 1.8,
          pointRadius: 4, 
          pointStyle: 'crossRot', // X shape
          tension: 0.1,
          order: 2
        },
        {
          label: 'Ask',
          data: askData,
          borderColor: '#94a3b8', // Medium Gray
          backgroundColor: '#94a3b8',
          borderWidth: 1.5,
          pointRadius: 3.5, 
          pointStyle: 'rect', // Square
          tension: 0.1,
          order: 3
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
          display: true, 
          title: { display: true, text: 'Maturity' },
          min: minX,
          max: maxX,
          time: {
            unit: 'year',
            displayFormats: {
              year: 'MMM yyyy',
              month: 'MMM yyyy'
            }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)',
            minor: {
              enabled: true,
              color: 'rgba(0, 0, 0, 0.02)'
            }
          },
          ticks: {
            autoSkip: true,
            maxRotation: 0,
            major: {
              enabled: true
            },
            font: (context) => ({
              weight: context.tick && context.tick.major ? 'bold' : 'normal'
            })
          }
        },
        y: { 
          type: 'linear',
          display: true, 
          title: { display: true, text: 'Yield (%)' },
          min: minY,
          max: maxY,
          beginAtZero: false,
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            stepSize: 0.25,
            callback: (val) => val.toFixed(2)
          }
        }
      },
      plugins: {
        legend: {
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            padding: 15,
            font: { size: 12, weight: '500' }
          },
          onHover: (e) => { e.native.target.style.cursor = 'pointer'; },
          onLeave: (e) => { e.native.target.style.cursor = 'default'; }
        },
        zoom: {
          pan: { 
            enabled: true, 
            mode: 'xy',
            onPanComplete: ({chart}) => updateDynamicTicks(chart)
          },
          zoom: { 
            wheel: { enabled: true }, 
            pinch: { enabled: true }, 
            mode: 'xy',
            onZoomComplete: ({chart}) => updateDynamicTicks(chart)
          }
        },
        tooltip: {
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

// Adaptive Step Size: Force alignment with 0.25 grid and snap bounds
function updateDynamicTicks(chart) {
  const yAx = chart.scales.y;
  const range = yAx.max - yAx.min;
  let newStep = 0.25;

  if (range > 3) newStep = 0.50;  
  if (range > 7) newStep = 1.00;  
  if (range < 0.6) newStep = 0.05; 

  // Snap the actual limits to the new step size for clean grid endpoints
  chart.options.scales.y.min = Math.floor(yAx.min / newStep + 0.001) * newStep;
  chart.options.scales.y.max = Math.ceil(yAx.max / newStep - 0.001) * newStep;
  chart.options.scales.y.ticks.stepSize = newStep;
  
  chart.update('none');
}

init();

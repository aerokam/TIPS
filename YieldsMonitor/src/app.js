// Treasury Yields Monitor - app.js
import { handleChartKeydown } from '../../shared/src/chart-keys.js';

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
  'US3M': '3-Month',
  'US6M': '6-Month',
  'US1Y': '1-Year',
  'US2Y': '2-Year',
  'US5Y': '5-Year',
  'US10Y': '10-Year',
  'US30Y': '30-Year'
};

const MATURITY_ORDER = {
  'US1M': 1, 'US2M': 2, 'US3M': 3, 'US6M': 4, 'US1Y': 5, 'US2Y': 6, 'US5Y': 7, 'US10Y': 8, 'US30Y': 9,
  'US1YTIPS': 5, 'US2YTIPS': 6, 'US5YTIPS': 7, 'US10YTIPS': 8, 'US30YTIPS': 9
};

const COLORS = [
  '#1a56db', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#be123c',
  '#4f46e5', '#db2777', '#059669', '#ea580c', '#7c3aed', '#0284c7', '#e11d48'
];

const TIME_RANGE_MAP = {
  '2D': '1D',
  '10D': '5D', // 5D is required for the 10-day lookback
  '1Y': '1M',
  '2Y': '3M',
  '3Y': '6M',
  '10Y': '5Y',
  'ALL': 'ALL'
};

const TIME_RANGES = Object.keys(TIME_RANGE_MAP);

const charts = {}; // symbol -> chartInstance
const historyCache = {}; // symbol -> points (baseline from R2)
const liveCache = {}; // symbol -> points (5D real-time tip)
let activeSymbols = new Set(['US10YTIPS', 'US30YTIPS', 'US10Y', 'US30Y']);
let activeRange = '2D';

const SYMBOL_LABELS = {
  'US1M': '1-Month', 'US2M': '2-Month', 'US3M': '3-Month', 'US6M': '6-Month',
  'US1Y': '1-Year', 'US2Y': '2-Year', 'US5Y': '5-Year', 'US10Y': '10-Year', 'US30Y': '30-Year',
  'US1YTIPS': '1-Year', 'US2YTIPS': '2-Year', 'US5YTIPS': '5-Year', 'US10YTIPS': '10-Year', 'US30YTIPS': '30-Year'
};

async function init() {
  setupUI();
  syncChartContainers();
  updateAllData();

  window.addEventListener('resize', () => {
    Object.values(charts).forEach(c => c.resize());
  });

  window.addEventListener('keydown', (e) => {
    Object.values(charts).forEach(chart => {
      handleChartKeydown(e, chart);
    });
  });
}

function setupUI() {
  const root = document.getElementById('controls-root');
  
  const rangeHtml = TIME_RANGES.map(r => 
    `<button class="range-btn ${r === activeRange ? 'active' : ''}" data-range="${r}">${r}</button>`
  ).join('');

  const tips = Object.keys(AVAILABLE_SYMBOLS).filter(s => s.endsWith('TIPS')).sort((a,b) => MATURITY_ORDER[a] - MATURITY_ORDER[b]);
  const nominals = Object.keys(AVAILABLE_SYMBOLS).filter(s => !s.endsWith('TIPS')).sort((a,b) => MATURITY_ORDER[a] - MATURITY_ORDER[b]);

  const createGrid = (syms) => syms.map(sym => {
    const idx = Object.keys(AVAILABLE_SYMBOLS).indexOf(sym);
    const color = COLORS[idx % COLORS.length];
    const label = SYMBOL_LABELS[sym] || sym;
    return `
      <label class="sym-item-check" id="label-${sym}">
        <input type="checkbox" value="${sym}" ${activeSymbols.has(sym) ? 'checked' : ''}>
        <span class="color-dot" style="background:${color}"></span>
        <span class="sym-code">${label}</span>
        <span class="sym-yield" id="yield-${sym}">---</span>
        <span class="sym-change" id="change-${sym}"></span>
      </label>
    `;
  }).join('');

  root.innerHTML = `
    <style>
      .range-picker { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 20px; }
      .range-btn { flex: 1; min-width: 45px; padding: 6px 0; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 11px; color: #000; }
      .range-btn.active { background: #0f172a; color: #fff; border-color: #0f172a; }
      .sym-group h4 { display: flex; justify-content: space-between; align-items: center; margin: 12px 0 6px; font-size: 10px; text-transform: uppercase; color: #000; font-weight: 800; letter-spacing: 0.05em; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; }
      .clear-btn { font-size: 9px; color: #64748b; cursor: pointer; text-transform: none; font-weight: 600; }
      .clear-btn:hover { color: #0f172a; text-decoration: underline; }
      .sym-item-check { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 11px; cursor: pointer; color: #000; }
      .sym-item-check input { margin: 0; }
      .color-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .sym-code { font-weight: 800; color: #000; width: 65px; flex-shrink: 0; }
      .sym-yield { font-family: monospace; font-weight: 700; font-size: 11px; color: #000; margin-left: auto; padding-right: 8px; }
      .sym-change { font-family: monospace; font-weight: 700; font-size: 10px; min-width: 55px; text-align: right; }
      .sym-change.up { color: #16a34a; }
      .sym-change.down { color: #dc2626; }
      #fetchStatus { font-size: 11px; color: #000; margin-top: 20px; font-weight: 700; }
      .no-data-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #000; background: rgba(255,255,255,0.9); pointer-events: none; z-index: 10; }
    </style>
    <div class="range-picker">${rangeHtml}</div>
    <div class="sym-group">
      <h4>TIPS <span class="clear-btn" data-type="TIPS">Clear All</span></h4>
      ${createGrid(tips)}
      <h4>Nominal Treasuries <span class="clear-btn" data-type="Nominal">Clear All</span></h4>
      ${createGrid(nominals)}
    </div>
    <div id="fetchStatus">Ready</div>
  `;

  document.querySelectorAll('.clear-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const isTips = e.target.dataset.type === 'TIPS';
      Object.keys(AVAILABLE_SYMBOLS).forEach(sym => {
        if (isTips && sym.endsWith('TIPS')) activeSymbols.delete(sym);
        else if (!isTips && !sym.endsWith('TIPS')) activeSymbols.delete(sym);
      });
      document.querySelectorAll('.sym-item-check input').forEach(cb => {
        const sym = cb.value;
        cb.checked = activeSymbols.has(sym);
      });
      syncChartContainers();
      updateAllData();
    });
  });

  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      activeRange = e.target.dataset.range;
      updateAllData();
    });
  });

  document.querySelectorAll('.sym-item-check input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) activeSymbols.add(e.target.value);
      else activeSymbols.delete(e.target.value);
      syncChartContainers();
      updateAllData();
    });
  });

  document.getElementById('refreshAll').addEventListener('click', updateAllData);
  document.getElementById('resetAllZoom').addEventListener('click', () => {
    Object.values(charts).forEach(c => c.resetZoom());
  });
}

function syncChartContainers() {
  const tipsRow = document.getElementById('tips-row');
  const nominalsRow = document.getElementById('nominals-row');
  
  // Remove charts no longer active
  Object.keys(charts).forEach(sym => {
    if (!activeSymbols.has(sym)) {
      charts[sym].destroy();
      delete charts[sym];
      const card = document.getElementById(`card-${sym}`);
      if (card) card.remove();
    }
  });

  // Create new charts & distribute
  activeSymbols.forEach(sym => {
    if (!charts[sym]) {
      const card = document.createElement('div');
      card.className = 'chart-card';
      card.id = `card-${sym}`;
      const groupLabel = sym.endsWith('TIPS') ? 'TIPS' : 'Nominal';
      const maturityLabel = SYMBOL_LABELS[sym] || sym;
      card.innerHTML = `
        <div class="chart-header">
          <span class="chart-title">${maturityLabel} ${groupLabel} Yield</span>
        </div>
        <div class="chart-container"><canvas id="chart-${sym}"></canvas></div>
      `;
      
      const targetRow = sym.endsWith('TIPS') ? tipsRow : nominalsRow;
      targetRow.appendChild(card);
      createChartInstance(sym);
    }
  });

  // Re-sort charts in each row
  const sortRow = (row, isTips) => {
    const syms = Array.from(activeSymbols).filter(s => isTips ? s.endsWith('TIPS') : !s.endsWith('TIPS'));
    syms.sort((a,b) => MATURITY_ORDER[a] - MATURITY_ORDER[b]);
    syms.forEach(sym => {
      const card = document.getElementById(`card-${sym}`);
      if (card) row.appendChild(card);
    });
    // Hide section if empty
    row.parentElement.style.display = syms.length > 0 ? 'flex' : 'none';
  };

  sortRow(tipsRow, true);
  sortRow(nominalsRow, false);

  // Trigger resize after grid re-layout
  setTimeout(() => {
    Object.values(charts).forEach(c => c.resize());
  }, 0);
}

function createChartInstance(sym) {
  const ctx = document.getElementById(`chart-${sym}`).getContext('2d');
  const symIdx = Object.keys(AVAILABLE_SYMBOLS).indexOf(sym);
  const color = COLORS[symIdx % COLORS.length];

  charts[sym] = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: sym,
        data: [],
        borderColor: color,
        backgroundColor: color + '1A',
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: false,
        tension: 0.1,
        segment: {
          borderColor: ctx => {
            if (activeRange !== '2D' && activeRange !== '10D') return color;
            const mid = (ctx.p0.parsed.x + ctx.p1.parsed.x) / 2;
            return isAfterHoursEt(mid) ? color + '55' : color;
          }
        }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'MM/dd/yy HH:mm:ss', displayFormats: { hour: 'MM/dd HH:mm', day: 'MMM dd' } },
          grid: { color: '#f1f5f9' },
          ticks: {
            autoSkip: true, font: { size: 9, weight: 'bold' }, color: '#000',
            callback: function(value, index, ticks) {
              const ts = ticks[index]?.value ?? value;
              if (typeof ts !== 'number') return value;
              const date = new Date(ts);
              if (activeRange === '2D') {
                return date.toLocaleString('en-US', {
                  timeZone: 'America/New_York', hourCycle: 'h23',
                  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                });
              }
              if (activeRange === '10D') {
                return date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
              }
              return date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', year: 'numeric' });
            }
          }
        },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 9, family: 'monospace', weight: 'bold' }, color: '#000', callback: v => v.toFixed(3) + '%' }
        }
      },
      plugins: {
        legend: { display: false },
        zoom: {
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' },
          pan: { enabled: true, mode: 'xy' }
        },
        annotation: {
          annotations: {}
        },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          titleColor: '#64748b',
          titleFont: { size: 11, weight: 'bold' },
          bodyColor: '#000',
          borderColor: '#cbd5e1',
          borderWidth: 1,
          padding: 8,
          bodyFont: { size: 12, weight: 'bold' },
          cornerRadius: 6,
          displayColors: false,
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const date = new Date(items[0].parsed.x);
              return date.toLocaleString('en-US', {
                timeZone: 'America/New_York', hourCycle: 'h23',
                month: '2-digit', day: '2-digit', year: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
              }) + ' ET';
            },
            label: ctx => `Yield: ${ctx.parsed.y.toFixed(3)}%`
          }
        }
      }
    }
  });

  const container = document.getElementById(`card-${sym}`);
  new ResizeObserver(() => {
    if (charts[sym]) charts[sym].resize();
  }).observe(container);
}

function buildUrl(symbol, timeRange) {
  const base = "https://webql-redesign.cnbcfm.com/graphql";
  const providerRange = TIME_RANGE_MAP[timeRange] || '1D';
  const params = {
    operationName: "getQuoteChartData",
    variables: JSON.stringify({ symbol, timeRange: providerRange }),
    extensions: JSON.stringify({
      persistedQuery: {
        version: 1,
        sha256Hash: "9e1670c29a10707c417a1efd327d4b2b1d456b77f1426e7e84fb7d399416bb6b"
      }
    }),
    _cb: Date.now() // Cache buster
  };
  return base + "?" + Object.entries(params).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
}

const R2_HISTORY_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/yield-history';

function parseSourceTime(tt) {
  if (!tt) return null;
  const s = String(tt);
  if (s.length < 8) return null;
  
  const year = parseInt(s.substring(0, 4), 10);
  const month = parseInt(s.substring(4, 6), 10) - 1;
  const day = parseInt(s.substring(6, 8), 10);
  
  let hour = 0, minute = 0, second = 0;
  if (s.length >= 10) hour = parseInt(s.substring(8, 10), 10);
  if (s.length >= 12) minute = parseInt(s.substring(10, 12), 10);
  if (s.length >= 14) second = parseInt(s.substring(12, 14), 10);
  
  // CNBC data is Eastern Time. Parse it correctly regardless of browser timezone.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric'
  });
  
  // Converge on the correct UTC moment. We want d such that wall-time in ET matches our parts.
  let d = new Date(Date.UTC(year, month, day, hour, minute, second));
  for (let i = 0; i < 2; i++) {
    const p = formatter.formatToParts(d).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
    // Calculate difference between what wall-time ET says it is, and what we want it to be.
    const diff = Date.UTC(year, month, day, hour, minute, second) - Date.UTC(parseInt(p.year, 10), parseInt(p.month, 10) - 1, parseInt(p.day, 10), parseInt(p.hour, 10), parseInt(p.minute, 10), parseInt(p.second, 10));
    if (diff === 0) break;
    d = new Date(d.getTime() + diff);
  }
  return d;
}

function getEtDateStr(date) {
  // Returns "MM/DD/YYYY" for the ET wall-clock date of the given UTC instant.
  return date.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
}

function makeEtMoment(year, month0, day, hour) {
  // Returns a Date (UTC instant) that represents `hour:00:00 ET` on the given ET calendar date.
  // Same iterative convergence approach as parseSourceTime.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric'
  });
  let d = new Date(Date.UTC(year, month0, day, hour, 0, 0));
  for (let i = 0; i < 2; i++) {
    const p = fmt.formatToParts(d).reduce((a, pt) => ({ ...a, [pt.type]: pt.value }), {});
    const diff = Date.UTC(year, month0, day, hour, 0, 0) -
      Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    if (diff === 0) break;
    d = new Date(d.getTime() + diff);
  }
  return d;
}

function isAfterHoursEt(tsMs) {
  // Returns true if the UTC instant falls outside 8:00–17:00 ET wall-clock time.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    hour: 'numeric', minute: 'numeric'
  }).formatToParts(new Date(tsMs)).reduce((a, p) => ({ ...a, [p.type]: +p.value }), {});
  const mins = parts.hour * 60 + parts.minute;
  return mins < 8 * 60 || mins >= 17 * 60;
}

async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { 
      ...options, 
      signal: controller.signal,
      cache: 'no-cache' // Tell browser not to use cached version
    });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

async function fetchOne(symbol, range) {
  const isIntraday = range === '2D' || range === '10D';
  
  if (isIntraday) {
    console.log(`%c[CNBC] %cFetching real-time ${range} for ${symbol}`, "color: #2563eb; font-weight: bold", "color: inherit");
    const live = await fetchLive(symbol, range);
    
    if (live && live.length > 0) {
      if (range === '2D' || range === '10D') liveCache[symbol] = live; // Update tip cache
      
      const cutoff = new Date();
      if (range === '2D') cutoff.setDate(cutoff.getDate() - 2);
      else if (range === '10D') cutoff.setDate(cutoff.getDate() - 10);
      return live.filter(p => p.x >= cutoff);
    }
    return live;
  } else {
    // Baseline from R2 + Live Tip from CNBC
    console.log(`%c[R2] %cLoading history for ${symbol}...`, "color: #ea580c; font-weight: bold", "color: inherit");
    const history = await fetchHistory(symbol);
    
    // Reuse live tip if available, else fetch once
    let liveTip = liveCache[symbol];
    if (!liveTip) {
      console.log(`%c[CNBC] %cFetching tip for ${symbol}...`, "color: #2563eb; font-weight: bold", "color: inherit");
      liveTip = await fetchLive(symbol, '2D'); 
      if (liveTip) liveCache[symbol] = liveTip;
    }

    let combined = history || [];
    if (liveTip && liveTip.length > 0) {
      const lastHistTime = combined.length > 0 ? combined[combined.length - 1].x.getTime() : 0;
      const newPoints = liveTip.filter(p => p.x.getTime() > lastHistTime);
      combined = [...combined, ...newPoints];
    }

    if (range === 'ALL') return combined;
    const cutoff = new Date();
    if (range === '1Y') cutoff.setFullYear(cutoff.getFullYear() - 1);
    else if (range === '2Y') cutoff.setFullYear(cutoff.getFullYear() - 2);
    else if (range === '3Y') cutoff.setFullYear(cutoff.getFullYear() - 3);
    else if (range === '10Y') cutoff.setFullYear(cutoff.getFullYear() - 10);
    
    return combined.filter(p => p.x >= cutoff);
  }
}

async function fetchLive(symbol, range) {
  const url = buildUrl(symbol, range);
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const priceBars = json?.data?.chartData?.priceBars || [];
    return priceBars.map(bar => {
      let closeVal = bar.close;
      if (typeof closeVal === "string" && closeVal.endsWith("%")) closeVal = closeVal.slice(0, -1);
      return { x: parseSourceTime(bar.tradeTime), y: parseFloat(closeVal) };
    }).filter(p => p.x && !isNaN(p.y));
  } catch (err) {
    console.warn(`Live fetch failed for ${symbol}:`, err);
    return null;
  }
}

async function fetchHistory(symbol) {
  if (!historyCache[symbol]) {
    historyCache[symbol] = (async () => {
      const fileName = `${symbol}_history.json`;
      const r2Url = `${R2_HISTORY_URL}/${fileName}`;
      const localUrl = `./data/yield-history/${fileName}`;

      try {
        let response = await fetchWithTimeout(r2Url).catch(() => null);
        if (!response || !response.ok) response = await fetchWithTimeout(localUrl);
        if (!response.ok) throw new Error("History not found");
        
        const data = await response.json();
        return data.map(p => ({ x: parseSourceTime(p.x), y: p.y }));
      } catch (err) {
        console.error(`History load failed for ${symbol}:`, err);
        delete historyCache[symbol];
        return null;
      }
    })();
  }
  return await historyCache[symbol];
}

function updateDynamicTicks(chart, data) {
  if (!data || data.length === 0) return;
  const yields = data.map(p => p.y);
  const min = Math.min(...yields);
  const max = Math.max(...yields);
  const range = max - min;
  const padding = range * 0.1 || 0.01;
  chart.options.scales.y.min = min - padding;
  chart.options.scales.y.max = max + padding;

  // Add 8am/5pm ET annotations if intraday
  if (activeRange === '2D' || activeRange === '10D') {
    const annotations = {};
    const etDateStrs = [...new Set(data.map(p => getEtDateStr(p.x)))];

    etDateStrs.forEach((etDateStr, idx) => {
      const dayData = data.filter(p => getEtDateStr(p.x) === etDateStr);
      if (dayData.length === 0) return;

      const dayMin = dayData[0].x;
      const dayMax = dayData[dayData.length - 1].x;

      // Parse "MM/DD/YYYY" → ET calendar parts, then build exact ET UTC instants
      const [m, d, y] = etDateStr.split('/').map(Number);
      const midnight = makeEtMoment(y, m - 1, d, 0);
      const am8 = makeEtMoment(y, m - 1, d, 8);
      const pm5 = makeEtMoment(y, m - 1, d, 17);
      const nextMidnight = makeEtMoment(y, m - 1, d + 1, 0); // JS Date handles month/year rollover

      // After-hours background shading (pre-market and post-market)
      const AH_BG = 'rgba(148, 163, 184, 0.13)';
      annotations[`pre-bg-${idx}`] = {
        type: 'box', xMin: midnight, xMax: am8,
        backgroundColor: AH_BG, borderWidth: 0, drawTime: 'beforeDatasetsDraw'
      };
      annotations[`aft-bg-${idx}`] = {
        type: 'box', xMin: pm5, xMax: nextMidnight,
        backgroundColor: AH_BG, borderWidth: 0, drawTime: 'beforeDatasetsDraw'
      };

      // Vertical open/close lines — only if they fall within data we have for this day
      // (or if it's today and we're during market hours)
      if (am8 >= dayMin && am8 <= dayMax) {
        annotations[`am8-${idx}`] = {
          type: 'line',
          xMin: am8, xMax: am8,
          borderColor: 'rgba(15, 23, 42, 0.4)', // Slightly softer
          borderWidth: 1.5, borderDash: [4, 4],
          label: { display: false }
        };
      }
      
      if (pm5 >= dayMin && pm5 <= dayMax) {
        annotations[`pm5-${idx}`] = {
          type: 'line',
          xMin: pm5, xMax: pm5,
          borderColor: 'rgba(15, 23, 42, 0.4)', // Slightly softer
          borderWidth: 1.5, borderDash: [4, 4],
          label: { display: false }
        };
      }
    });
    chart.options.plugins.annotation.annotations = annotations;
  } else {
    chart.options.plugins.annotation.annotations = {};
  }
}

async function updateAllData() {
  const statusEl = document.getElementById('fetchStatus');
  statusEl.textContent = `Updating data...`;

  const isIntraday = activeRange === '2D' || activeRange === '10D';

  const allSymbols = Object.keys(AVAILABLE_SYMBOLS);
  let successCount = 0;
  const currentFetchTimestamps = []; // Only use times from this specific update cycle
  
  const promises = allSymbols.map(async sym => {
    const data = await fetchOne(sym, activeRange);
    const chart = charts[sym];
    const card = document.getElementById(`card-${sym}`);

    if (data && data.length > 0) {
      successCount++;
      const lastP = data[data.length - 1].x;
      currentFetchTimestamps.push(lastP);

      if (card) {
        const existing = card.querySelector('.no-data-overlay');
        if (existing) existing.remove();
      }

      if (chart) {
        chart.data.datasets[0].data = data;
        chart.options.scales.x.time.unit = activeRange === '2D' ? 'hour' : activeRange === '10D' ? 'day' : 'month';
        chart.options.scales.x.time.tooltipFormat = isIntraday ? 'MM/dd/yy HH:mm:ss' : 'MM/dd/yy';
        chart.options.scales.x.time.displayFormats = activeRange === '2D'
          ? { hour: 'MM/dd HH:mm', minute: 'HH:mm:ss', day: 'MMM dd' }
          : activeRange === '10D'
          ? { day: 'MMM dd' }
          : { month: 'MMM yyyy', year: 'yyyy' };
        chart.options.scales.x.ticks.minRotation = 0;
        chart.options.scales.x.ticks.maxRotation = 45;
        updateDynamicTicks(chart, data);
        chart.update('none');
        chart.resetZoom();
      }

      // Calculate change since close
      const latestPoint = data[data.length - 1];
      let closePoint = null;
      const latestDay = latestPoint.x.toDateString();
      const fullData = (isIntraday && liveCache[sym]) ? liveCache[sym] : data;
      
      for (let i = fullData.length - 1; i >= 0; i--) {
        const p = fullData[i];
        const phour = p.x.getHours();
        const pmin = p.x.getMinutes();
        const pday = p.x.toDateString();
        if (pday !== latestDay) {
          if (phour < 17 || (phour === 17 && pmin <= 5)) {
            closePoint = p;
            break;
          }
        }
      }

      const changeEl = document.getElementById(`change-${sym}`);
      const yieldEl = document.getElementById(`yield-${sym}`);
      if (yieldEl) {
        yieldEl.textContent = `${latestPoint.y.toFixed(3)}%`;
      }
      if (changeEl) {
        if (closePoint) {
          const diff = latestPoint.y - closePoint.y;
          const sign = diff >= 0 ? '+' : '';
          changeEl.textContent = `${sign}${diff.toFixed(3)}%`;
          changeEl.className = `sym-change ${diff >= 0 ? 'up' : 'down'}`;
          changeEl.title = `Since ${closePoint.x.toLocaleString()} close (${closePoint.y.toFixed(3)}%)`;
        } else {
          changeEl.textContent = '---';
        }
      }
    } else if (card) {
      if (chart) {
        chart.data.datasets[0].data = [];
        chart.update();
      }
      if (!card.querySelector('.no-data-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'no-data-overlay';
        overlay.textContent = 'No data available for this range';
        card.querySelector('.chart-container').appendChild(overlay);
      }
    }
  });

  await Promise.all(promises);

  const now = new Date();
  const formatTZ = (date, tz, label, includeDate = false) => {
    const opts = { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' };
    if (includeDate) { opts.month = 'short'; opts.day = 'numeric'; }
    return date.toLocaleString('en-US', opts) + ' ' + label;
  };
  
  const latestDataTime = currentFetchTimestamps.length > 0 ? new Date(Math.max(...currentFetchTimestamps)) : null;

  const fetchPT = formatTZ(now, 'America/Los_Angeles', 'PT');
  const fetchET = formatTZ(now, 'America/New_York', 'ET');
  
  let statusHtml = `<div>Fetch: ${fetchPT} / ${fetchET}</div>`;
  if (latestDataTime) {
    const isToday = latestDataTime.toDateString() === now.toDateString();
    const dataPT = formatTZ(latestDataTime, 'America/Los_Angeles', 'PT', !isToday);
    const dataET = formatTZ(latestDataTime, 'America/New_York', 'ET', !isToday);
    statusHtml += `<div style="margin-top:2px; color:#0f172a">Data: ${dataPT} / ${dataET} (${successCount}/${allSymbols.length} syms)</div>`;
  } else {
    statusHtml += `<div style="margin-top:2px; color:#dc2626">No data returned (${successCount}/${allSymbols.length} syms)</div>`;
  }

  statusEl.innerHTML = statusHtml;
}

window.addEventListener('DOMContentLoaded', init);

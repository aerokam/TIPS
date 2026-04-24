// Treasury Yields Monitor - app.js
import { handleChartKeydown, setupAxisWheelZoom, snapYBounds, snapYAfterZoom, applyLockRight } from '../../shared/src/chart-keys.js';

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

const TIME_RANGE_MAP = {
  '2D': '1D',
  '10D': '5D',
  '1Y': '1Y',
  '2Y': '2Y',
  '3Y': '3Y',
  '10Y': '10Y',
  'ALL': 'ALL'
};

const TIME_RANGES = Object.keys(TIME_RANGE_MAP);

const charts = {}; 
const historyCache = {}; 
const liveCache = {}; 
const liveCacheTime = {}; // symbol_range -> timestamp
const rangeData = {}; 
const yieldCurveCharts = {}; 
let activeSymbols = new Set(['US10YTIPS', 'US30YTIPS', 'US10Y', 'US30Y']);
let activeRange = '2D';
let activeTab = 'timeseries';
let syncXAxis = true;
let lockRight = false;
const xMaxAnchors = {}; // sym -> pinned xMax timestamp (set when data loads)
let isSyncing = false;
let isUpdatingData = false;
const yOverrideSyms = new Set();
const panStartY = {}; // sym -> {min, max} at pan gesture start; cleared on pan end

const ET_YMD_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const ET_FULL_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
const ET_HM_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric' });
const ET_WDAY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });
const ET_TICK_DAY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
const ET_TICK_MON_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', year: 'numeric' });

let lastDayCache = { start: 0, end: 0, str: "" };

const SYMBOL_LABELS = {
  'US1M': '1-Month', 'US2M': '2-Month', 'US3M': '3-Month', 'US6M': '6-Month', 'US1Y': '1-Year', 'US2Y': '2-Year', 'US5Y': '5-Year', 'US10Y': '10-Year', 'US30Y': '30-Year',
  'US1YTIPS': '1-Year', 'US2YTIPS': '2-Year', 'US5YTIPS': '5-Year', 'US10YTIPS': '10-Year', 'US30YTIPS': '30-Year'
};

async function init() {
  setupUI();
  setupTabs();
  syncChartContainers();
  updateAllData();
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

function syncAllChartsX(sourceChart) {
  if (!syncXAxis || isSyncing || isUpdatingData) return;
  isSyncing = true;
  const xMin = sourceChart.options.scales.x.min ?? sourceChart.scales.x.min;
  const xMax = sourceChart.options.scales.x.max ?? sourceChart.scales.x.max;
  Object.entries(charts).forEach(([sym, chart]) => {
    if (chart === sourceChart) return;
    chart.options.scales.x.min = xMin;
    chart.options.scales.x.max = xMax;
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
  const rangeHtml = TIME_RANGES.map(r => `<button class="range-btn ${r === activeRange ? 'active' : ''}" data-range="${r}">${r}</button>`).join('');
  const tips = Object.keys(AVAILABLE_SYMBOLS).filter(s => s.endsWith('TIPS')).sort((a,b) => MATURITY_ORDER[a] - MATURITY_ORDER[b]);
  const nominals = Object.keys(AVAILABLE_SYMBOLS).filter(s => !s.endsWith('TIPS')).sort((a,b) => MATURITY_ORDER[a] - MATURITY_ORDER[b]);
  const createGrid = (syms) => syms.map(sym => {
    const idx = Object.keys(AVAILABLE_SYMBOLS).indexOf(sym);
    const color = COLORS[idx % COLORS.length];
    return `<label class="sym-item-check" id="label-${sym}"><input type="checkbox" value="${sym}" ${activeSymbols.has(sym) ? 'checked' : ''}><span class="color-dot" style="background:${color}"></span><span class="sym-code">${SYMBOL_LABELS[sym] || sym}</span><span class="sym-yield" id="yield-${sym}">---</span><span class="sym-change" id="change-${sym}"></span></label>`;
  }).join('');

  root.innerHTML = `<style>.range-picker { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 20px; } .range-btn { flex: 1; min-width: 45px; padding: 6px 0; border: none; background: var(--tab-inactive-bg); border-radius: 4px; cursor: pointer; font-weight: 700; font-size: 13px; color: var(--tab-inactive-text); text-transform: uppercase; letter-spacing: 0.04em; transition: background 0.1s; } .range-btn:hover:not(.active) { background: var(--btn-hover-bg); } .range-btn.active { background: var(--tab-active-bg); color: var(--tab-inactive-text); border-top: 3px solid var(--tab-active-accent); } .sym-group h4 { display: flex; justify-content: space-between; align-items: center; margin: 12px 0 6px; font-size: 13px; text-transform: uppercase; color: #000; font-weight: 800; letter-spacing: 0.05em; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; } .clear-btn { font-size: 11px; color: #64748b; cursor: pointer; text-transform: none; font-weight: 600; } .sym-item-check { display: flex; align-items: center; gap: 4px; padding: 4px 0; font-size: 15px; cursor: pointer; color: #000; } .color-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; } .sym-code { font-weight: 600; color: #000; width: 75px; flex-shrink: 0; white-space: nowrap; } .sym-yield { font-family: monospace; font-weight: 700; font-size: 15px; color: #000; margin-left: auto; padding-right: 4px; } .sym-change { font-family: monospace; font-weight: 700; font-size: 14px; min-width: 60px; text-align: right; } .sym-change.up { color: #16a34a; } .sym-change.down { color: #dc2626; } #fetchStatus { font-size: 13px; color: #000; margin-top: 20px; font-weight: 700; display: grid; grid-template-columns: auto auto; column-gap: 4px; row-gap: 2px; } #fetchStatus .fs-label { text-align: right; } #fetchStatus .fs-val { text-align: left; } .no-data-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #000; background: rgba(255,255,255,0.9); pointer-events: none; z-index: 10; } .sync-zoom-label { display: flex; align-items: center; gap: 6px; margin-top: 15px; font-size: 14px; font-weight: 700; color: #334155; cursor: pointer; background: #f8fafc; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; }</style><div class="range-picker">${rangeHtml}</div><div class="sym-group"><h4>TIPS <span class="clear-btn" data-type="TIPS">Clear All</span></h4>${createGrid(tips)}<h4>Treasuries <span class="clear-btn" data-type="Nominal">Clear All</span></h4>${createGrid(nominals)}</div><label class="sync-zoom-label"><input type="checkbox" id="syncXAxis" ${syncXAxis ? 'checked' : ''}> Sync Zoom & Pan</label><label class="sync-zoom-label"><input type="checkbox" id="lockRight"> Lock Right</label><div id="fetchStatus">Ready</div>`;

  document.getElementById('syncXAxis').addEventListener('change', (e) => {
    syncXAxis = e.target.checked;
    if (syncXAxis) {
      const first = Object.values(charts)[0];
      if (first) syncAllChartsX(first);
    }
  });
  document.getElementById('lockRight').addEventListener('change', (e) => { lockRight = e.target.checked; });

  document.querySelectorAll('.clear-btn').forEach(btn => btn.addEventListener('click', (e) => {
    const isTips = e.target.dataset.type === 'TIPS';
    Object.keys(AVAILABLE_SYMBOLS).forEach(sym => { if (isTips && sym.endsWith('TIPS')) activeSymbols.delete(sym); else if (!isTips && !sym.endsWith('TIPS')) activeSymbols.delete(sym); });
    document.querySelectorAll('.sym-item-check input').forEach(cb => cb.checked = activeSymbols.has(cb.value));
    syncChartContainers(); updateAllData();
  }));
  document.querySelectorAll('.range-btn').forEach(btn => btn.addEventListener('click', (e) => {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active'); activeRange = e.target.dataset.range; updateAllData();
  }));
  document.querySelectorAll('.sym-item-check input').forEach(cb => cb.addEventListener('change', (e) => {
    if (e.target.checked) activeSymbols.add(e.target.value); else activeSymbols.delete(e.target.value);
    syncChartContainers(); updateAllData();
  }));
  document.getElementById('refreshAll').addEventListener('click', () => updateAllData(true));
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
  charts[sym] = new Chart(ctx, {
    type: 'line',
    data: { datasets: [{ label: sym, data: [], borderColor: color, backgroundColor: color + '1A', borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, fill: false, tension: 0.1, segment: { borderColor: ctx => { if (activeRange !== '2D' && activeRange !== '10D') return color; const mid = (ctx.p0.parsed.x + ctx.p1.parsed.x) / 2; return (isAfterHoursEt(mid) || isWeekendEt(new Date(mid))) ? color + '55' : color; } } }] },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'time', time: { tooltipFormat: 'MM/dd/yy HH:mm:ss', displayFormats: { hour: 'MM/dd HH:mm', day: 'MMM dd', month: 'MMM yyyy', year: 'yyyy' } }, grid: { color: '#f1f5f9' }, ticks: { autoSkip: true, font: { size: 9, weight: 'bold' }, color: '#000', callback(value) { const d = new Date(value); if (activeRange === '2D') { const p = ET_HM_FMT.formatToParts(d).reduce((a, pt) => ({...a, [pt.type]: pt.value}), {}); return `${p.month}/${p.day} ${p.hour}:${p.minute}`; } if (activeRange === '10D') return ET_TICK_DAY_FMT.format(d); return ET_TICK_MON_FMT.format(d); } } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 9, family: 'monospace', weight: 'bold' }, color: '#000', callback: v => v.toFixed(3) + '%' } }
      },
      plugins: { legend: { display: false }, zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy', onZoom: ({chart}) => { if (lockRight) applyLockRight(chart, xMaxAnchors[sym]); if (syncXAxis) syncAllChartsX(chart); }, onZoomComplete: ({chart}) => { if (lockRight) applyLockRight(chart, xMaxAnchors[sym]); rescaleYToVisible(chart, sym); if (syncXAxis) syncAllChartsX(chart); } }, pan: { enabled: true, mode: 'xy', onPanStart: ({chart}) => { Object.entries(charts).forEach(([s, c]) => { panStartY[s] = { min: c.scales.y.min, max: c.scales.y.max }; }); }, onPan: ({chart}) => { if (syncXAxis) syncAllCharts(chart); }, onPanComplete: ({chart}) => { if (syncXAxis) syncAllCharts(chart); Object.keys(panStartY).forEach(k => delete panStartY[k]); } } }, annotation: { annotations: {} }, tooltip: { backgroundColor: 'rgba(255, 255, 255, 0.95)', titleColor: '#64748b', titleFont: { size: 11, weight: 'bold' }, bodyColor: '#000', borderColor: '#cbd5e1', borderWidth: 1, padding: 8, bodyFont: { size: 12, weight: 'bold' }, cornerRadius: 6, displayColors: false, callbacks: { title: (items) => { if (!items.length) return ''; const date = new Date(items[0].parsed.x); return date.toLocaleString('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', month: '2-digit', day: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ET'; }, label: ctx => `Yield: ${ctx.parsed.y.toFixed(3)}%` } } }
    }
  });
  setupAxisWheelZoom(ctx.canvas, ({chart}) => {
    if (lockRight) applyLockRight(chart, xMaxAnchors[sym]);
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

const R2_HISTORY_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/Treasuries/yield-history';

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

function isAfterHoursEt(tsMs) { const parts = ET_FULL_FMT.formatToParts(new Date(tsMs)).reduce((a, p) => ({ ...a, [p.type]: +p.value }), {}); const mins = parts.hour * 60 + parts.minute; return mins < 8 * 60 || mins >= 17 * 60; }
function isWeekendEt(date) { return ET_WDAY_FMT.format(date).match(/Sat|Sun/); }

async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController(), id = setTimeout(() => controller.abort(), timeout);
  try { const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-cache' }); clearTimeout(id); return response; } catch (e) { clearTimeout(id); throw e; }
}

async function fetchOne(symbol, range, force = false) {
  const is2D = range === '2D', is10D = range === '10D';
  if (is2D || is10D) {
    const providerRange = is2D ? '1D' : '5D', cacheKey = `${symbol}_${providerRange}`;
    const tipKey = `${symbol}_5D`;
    
    const fetchTasks = [];
    if (!force && liveCache[cacheKey]) {
      // Use cache
    } else {
      console.log(`%c[CNBC] %cFetching real-time ${providerRange} for ${symbol}`, "color: #2563eb; font-weight: bold", "color: inherit");
      fetchTasks.push(fetchLive(symbol, providerRange).then(live => { if (live) liveCache[cacheKey] = live; }));
    }
    
    if (is2D && (force || !liveCache[tipKey])) {
      console.log(`%c[CNBC] %cFetching 5D tip for metrics: ${symbol}`, "color: #2563eb; font-weight: bold", "color: inherit");
      fetchTasks.push(fetchLive(symbol, '5D').then(live => { if (live) liveCache[tipKey] = live; }));
    }
    
    if (fetchTasks.length > 0) await Promise.all(fetchTasks);

    const data = liveCache[cacheKey] || [];
    const cutoff = new Date(); if (is2D) cutoff.setDate(cutoff.getDate() - 2); else cutoff.setDate(cutoff.getDate() - 10);
    return data.filter(p => p.x >= cutoff);
  } else {
    console.log(`%c[R2] %cLoading history for ${symbol}...`, "color: #ea580c; font-weight: bold", "color: inherit");
    const history = await fetchHistory(symbol);
    const tipKey = `${symbol}_5D`; let liveTip = liveCache[tipKey];
    if (!liveTip || force) { console.log(`%c[CNBC] %cFetching 5D tip for ${symbol}...`, "color: #2563eb; font-weight: bold", "color: inherit"); liveTip = await fetchLive(symbol, '5D'); if (liveTip) liveCache[tipKey] = liveTip; }
    const cutoff = new Date();
    if (range === '1Y') cutoff.setFullYear(cutoff.getFullYear() - 1); else if (range === '2Y') cutoff.setFullYear(cutoff.getFullYear() - 2); else if (range === '3Y') cutoff.setFullYear(cutoff.getFullYear() - 3); else if (range === '10Y') cutoff.setFullYear(cutoff.getFullYear() - 10); else if (range === 'ALL') cutoff.setFullYear(cutoff.getFullYear() - 50);
    let combined = (history || []).filter(p => p.x >= cutoff);
    if (liveTip && liveTip.length > 0) { const lastHistTime = combined.length > 0 ? combined[combined.length - 1].x.getTime() : 0; const newPoints = liveTip.filter(p => p.x.getTime() > lastHistTime); combined = [...combined, ...newPoints]; }
    return combined;
  }
}

async function fetchLive(symbol, range) {
  try { const response = await fetchWithTimeout(buildUrl(symbol, range)); if (!response.ok) throw new Error(`HTTP ${response.status}`); const json = await response.json(); const priceBars = json?.data?.chartData?.priceBars || []; return priceBars.map(bar => { let v = bar.close; if (typeof v === "string" && v.endsWith("%")) v = v.slice(0, -1); return { x: parseSourceTime(bar.tradeTime), y: parseFloat(v) }; }).filter(p => p.x && !isNaN(p.y)); } catch (err) { console.warn(`Live fetch failed for ${symbol}:`, err); return null; }
}

async function fetchHistory(symbol) {
  if (!historyCache[symbol]) { historyCache[symbol] = (async () => { try { let response = await fetchWithTimeout(`${R2_HISTORY_URL}/${symbol}_history.json`).catch(() => null); if (!response || !response.ok) response = await fetchWithTimeout(`./data/yield-history/${symbol}_history.json`); if (!response.ok) throw new Error("History not found"); const data = await response.json(); return data.map(p => ({ x: parseSourceTime(p.x), y: p.y })); } catch (err) { console.error(`History load failed for ${symbol}:`, err); delete historyCache[symbol]; return null; } })(); }
  return await historyCache[symbol];
}


function snapXMax(date) {
  const d = new Date(date);
  if (activeRange === '2D') { d.setTime(d.getTime() + 15 * 60 * 1000); }
  else if (activeRange === '10D') { d.setTime(d.getTime() + 15 * 60 * 1000); }
  else { d.setDate(d.getDate() + 3); }
  return d;
}

function applyDefaultBounds(sym, chart, data) {
  if (!data || data.length === 0) return;
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
    chart.options.scales.x.min = null;
  }
  chart.options.scales.x.max = xMaxAnchors[sym] ?? snapXMax(data[data.length-1].x).getTime();
  chart.update('none');
  rescaleYToVisible(chart, sym);
}

function rescaleYToVisible(chart, sym) {
  const data = rangeData[sym]; if (!data || data.length === 0) return;
  const xMin = chart.options.scales.x.min ?? chart.scales.x.min, xMax = chart.options.scales.x.max ?? chart.scales.x.max;
  const visible = data.filter(p => { const t = +p.x; return t >= xMin && t <= xMax; }); if (visible.length === 0) return;
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

async function updateAllData(force = false) {
  yOverrideSyms.clear();
  isUpdatingData = true;
  const statusEl = document.getElementById('fetchStatus'); statusEl.textContent = `Updating...`;
  const allSyms = Object.keys(AVAILABLE_SYMBOLS); let successCount = 0; const tsList = [];
  await Promise.all(allSyms.map(async sym => {
    const data = await fetchOne(sym, activeRange, force), chart = charts[sym], card = document.getElementById(`card-${sym}`);
    rangeData[sym] = data;
    if (data && data.length > 0) {
      successCount++; tsList.push(data[data.length-1].x);
      if (card) { const ov = card.querySelector('.no-data-overlay'); if (ov) ov.remove(); }
      if (chart) {
        chart.data.datasets[0].data = data;
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
        xMaxAnchors[sym] = snapXMax(data[data.length-1].x).getTime();
        applyDefaultBounds(sym, chart, data);
      }
      const calculationData = (liveCache[`${sym}_5D`] || liveCache[`${sym}_1D`] || data), latest = calculationData[calculationData.length-1];
      let closeP = null; const latestDayET = getEtDateStr(latest.x);
      for (let i = calculationData.length-1; i >= 0; i--) { const p = calculationData[i], etStr = getEtDateStr(p.x); if (etStr !== latestDayET) { const pts = ET_FULL_FMT.formatToParts(p.x).reduce((a, pt) => ({ ...a, [pt.type]: pt.value }), {}), ph = +pts.hour; if (ph < 17 || (ph === 17 && +pts.minute === 0)) { closeP = p; break; } } }
      const changeEl = document.getElementById(`change-${sym}`), yieldEl = document.getElementById(`yield-${sym}`);
      if (yieldEl) yieldEl.textContent = `${latest.y.toFixed(3)}%`;
      if (changeEl) { if (closeP) { const diff = latest.y - closeP.y; changeEl.textContent = `${diff>=0?'+':''}${diff.toFixed(3)}%`; changeEl.className = `sym-change ${diff>=0?'up':'down'}`; changeEl.title = `Since ${ET_HM_FMT.format(closeP.x)} ET close (${closeP.y.toFixed(3)}%)`; } else changeEl.textContent = '---'; }
    } else if (card) {
      if (chart) { chart.data.datasets[0].data = []; chart.update(); }
      if (!card.querySelector('.no-data-overlay')) { const overlay = document.createElement('div'); overlay.className = 'no-data-overlay'; overlay.textContent = 'No data available for this range'; card.querySelector('.chart-container').appendChild(overlay); }
    }
  }));
  if (activeTab === 'yieldcurves' || activeTab === 'breakeven') updateYieldCurves();
  const now = new Date(), fmt = d => d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' ET';
  const latestDataT = tsList.length > 0 ? new Date(Math.max(...tsList)) : null;
  let statusHtml = `<span class="fs-label">Fetch:</span><span class="fs-val">${fmt(now)}</span>`;
  if (latestDataT) statusHtml += `<span class="fs-label">Data:</span><span class="fs-val">${fmt(latestDataT)}</span>`;
  else statusHtml += `<span class="fs-label">Data:</span><span class="fs-val" style="color:#dc2626">No data returned</span>`;
  statusEl.innerHTML = statusHtml;
  isUpdatingData = false;
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

function updateYieldCurves() {
  const buildYield = (id, key, syms) => {
    let sT = null, eT = null;
    const sD = syms.map(s => { const d = rangeData[s]; if (!d || d.length === 0) return null; if (!sT || d[0].x < sT) sT = d[0].x; return d[0].y; });
    const eD = syms.map(s => { const d = rangeData[s]; if (!d || d.length === 0) return null; if (!eT || d[d.length-1].x > eT) eT = d[d.length-1].x; return d[d.length-1].y; });
    const sL = sT ? ET_HM_FMT.format(sT) + ' ET' : '—', eL = eT ? ET_HM_FMT.format(eT) + ' ET' : '—';
    if (yieldCurveCharts[key]) { const c = yieldCurveCharts[key]; c.data.datasets[0].data = sD; c.data.datasets[0].label = sL; c.data.datasets[1].data = eD; c.data.datasets[1].label = eL; c.update(); return; }
    const ctx = document.getElementById(id).getContext('2d');
    yieldCurveCharts[key] = new Chart(ctx, {
      type: 'line',
      data: { labels: syms.map(s => SYMBOL_LABELS[s]), datasets: [{ label: sL, data: sD, borderColor: '#1a56db', borderDash: [6,3], fill: false, tension: 0.3, spanGaps: true }, { label: eL, data: eD, borderColor: '#dc2626', fill: false, tension: 0.3, spanGaps: true }] },
      options: { animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 10, weight: 'bold' }, color: '#000' } }, y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 9, family: 'monospace', weight: 'bold' }, color: '#000', callback: v => v.toFixed(3) + '%' } } }, plugins: { legend: { display: true, labels: { font: { size: 10, weight: 'bold' } } }, zoom: { zoom: { wheel: { enabled: true }, mode: 'xy' }, pan: { enabled: true, mode: 'xy' } } } }
    });
  };

  const buildBei = (id, key, pairs) => {
    let sT = null, eT = null;
    const sD = pairs.map(p => {
      const n = rangeData[p.n], t = rangeData[p.t];
      if (!n || n.length === 0 || !t || t.length === 0) return null;
      if (!sT || n[0].x < sT) sT = n[0].x;
      return n[0].y - t[0].y;
    });
    const eD = pairs.map(p => {
      const n = rangeData[p.n], t = rangeData[p.t];
      if (!n || n.length === 0 || !t || t.length === 0) return null;
      if (!eT || n[n.length-1].x > eT) eT = n[n.length-1].x;
      return n[n.length-1].y - t[t.length-1].y;
    });
    const sL = sT ? ET_HM_FMT.format(sT) + ' ET' : '—', eL = eT ? ET_HM_FMT.format(eT) + ' ET' : '—';
    if (yieldCurveCharts[key]) {
      const c = yieldCurveCharts[key];
      c.data.datasets[0].data = sD; c.data.datasets[0].label = sL;
      c.data.datasets[1].data = eD; c.data.datasets[1].label = eL;
      c.update();
      return;
    }
    const ctx = document.getElementById(id).getContext('2d');
    yieldCurveCharts[key] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: pairs.map(p => p.label),
        datasets: [
          { label: sL, data: sD, borderColor: '#1a56db', borderDash: [6,3], fill: false, tension: 0.3, spanGaps: true },
          { label: eL, data: eD, borderColor: '#dc2626', fill: false, tension: 0.3, spanGaps: true }
        ]
      },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 10, weight: 'bold' }, color: '#000' } },
          y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 9, family: 'monospace', weight: 'bold' }, color: '#000', callback: v => v.toFixed(3) + '%' } }
        },
        plugins: {
          legend: { display: true, labels: { font: { size: 10, weight: 'bold' } } },
          zoom: { zoom: { wheel: { enabled: true }, mode: 'xy' }, pan: { enabled: true, mode: 'xy' } }
        }
      }
    });
  };

  buildYield('yield-curve-tips', 'tips', TIPS_SYMBOLS);
  buildYield('yield-curve-nominal', 'nominal', NOMINAL_SYMBOLS);
  buildBei('yield-curve-breakeven', 'breakeven', BEI_PAIRS);
}

window.addEventListener('DOMContentLoaded', init);

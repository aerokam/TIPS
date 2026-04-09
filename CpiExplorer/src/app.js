// CpiExplorer — app.js
// Orchestration: wires controls → calc → chart; manages state.

import { fetchCpiHistory, fetchRefCpi } from './data.js';
import { isoDate, filterRows, calcIndex, calcYoY, calcMoM, calcRolling, calcP2P, calcStats } from './calc.js';
import { createChart, updateChart, resetZoom, getChart } from './chart.js';
import { handleChartKeydown } from '../../shared/src/chart-keys.js';

// ── State ─────────────────────────────────────────────────────────────────────

let cpiRows    = null; // CpiRow[]
let refCpiRows = null; // RefCpiRow[]

const state = {
  dataSources:   ['cpi-nsa'], // array of 'cpi-nsa' | 'cpi-sa' | 'ref-cpi'
  displayMode:   'index',    // 'index' | 'yoy' | 'mom' | 'rolling' | 'p2p'
  rollingMonths: 12,
  startDate:     null,       // Date | null (null = use source min)
  endDate:       null,       // Date | null (null = use source max)
  p2pStart:      null,
  p2pEnd:        null,
  logScale:      false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSourceRows(source) {
  return source === 'ref-cpi' ? refCpiRows : cpiRows;
}

function getSourceField(source) {
  if (source === 'cpi-nsa') return 'nsa';
  if (source === 'cpi-sa')  return 'sa';
  return 'value'; // ref-cpi
}

function getSourceLabel(source) {
  if (source === 'cpi-nsa') return 'CPI-U NSA';
  if (source === 'cpi-sa')  return 'CPI-U SA';
  return 'Ref CPI';
}

function isDaily(source) {
  return source === 'ref-cpi';
}

function sourceExtent(rows) {
  if (!rows?.length) return { min: null, max: null };
  return { min: rows[0].date, max: rows[rows.length - 1].date };
}

function combinedExtent() {
  let min = null, max = null;
  state.dataSources.forEach(src => {
    const rows = getSourceRows(src);
    const ext = sourceExtent(rows);
    if (!min || (ext.min && ext.min < min)) min = ext.min;
    if (!max || (ext.max && ext.max > max)) max = ext.max;
  });
  return { min, max };
}

function dateToMonth(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return { year: y, month: m };
}

function updateDateUI(prefix, d) {
  if (!d) return;
  const { year, month } = dateToMonth(d);
  const mEl = document.getElementById(`${prefix}Month`);
  const yEl = document.getElementById(`${prefix}Year`);
  if (mEl) mEl.value = month;
  if (yEl) yEl.value = year;
}

function getValuesFromUI(prefix) {
  const m = parseInt(document.getElementById(`${prefix}Month`).value, 10);
  const yStr = document.getElementById(`${prefix}Year`).value;
  if (!/^\d{4}$/.test(yStr)) return null;
  const y = parseInt(yStr, 10);
  return new Date(y, m - 1, 1);
}

function populateDateSelectors() {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthOptions = months.map((m, i) => `<option value="${i+1}">${m}</option>`).join('');
  
  ['start', 'end', 'p2pStart', 'p2pEnd'].forEach(id => {
    const el = document.getElementById(`${id}Month`);
    if (el) el.innerHTML = monthOptions;
  });

  const yearList = document.getElementById('yearList');
  if (yearList) {
    let years = '';
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= 1913; y--) {
      years += `<option value="${y}">`;
    }
    yearList.innerHTML = years;
  }

  // Overwrite behavior: select on focus + digit-only filtering
  document.querySelectorAll('.year-input').forEach(el => {
    el.addEventListener('focus', () => el.select());
    el.addEventListener('input', () => {
      el.value = el.value.replace(/\D/g, '');
    });
  });
}

function yAxisLabel() {
  switch (state.displayMode) {
    case 'index':   return 'CPI Index';
    case 'yoy':     return 'Year-over-Year %';
    case 'mom':     return 'Month-over-Month %';
    case 'rolling': return `Trailing ${state.rollingMonths}m Change %`;
    case 'p2p':     return 'CPI Index';
    default:        return 'CPI';
  }
}

function fmt(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toFixed(decimals);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  if (!state.dataSources.length) return;
  const datasets = [];
  const ext = combinedExtent();
  const startDate = state.startDate ?? ext.min;
  const endDate   = state.endDate   ?? ext.max;

  state.dataSources.forEach(src => {
    const rows  = getSourceRows(src);
    const field = getSourceField(src);
    const daily = isDaily(src);
    if (!rows?.length) return;

    let labels, values;
    if (state.displayMode === 'p2p') {
      const pStart = state.p2pStart ?? sourceExtent(rows).min;
      const pEnd   = state.p2pEnd   ?? sourceExtent(rows).max;
      const result = calcP2P(rows, field, pStart, pEnd);
      ({ labels, values } = result.series);
      if (src === state.dataSources[0]) renderP2PResult(result);
    } else {
      // FIX DATE BUG: Run calc on FULL data, then filter
      let fullLabels, fullValues;
      switch (state.displayMode) {
        case 'index':   ({ labels: fullLabels, values: fullValues } = calcIndex(rows, field)); break;
        case 'yoy':     ({ labels: fullLabels, values: fullValues } = calcYoY(rows, field, daily)); break;
        case 'mom':     ({ labels: fullLabels, values: fullValues } = calcMoM(rows, field, daily)); break;
        case 'rolling': ({ labels: fullLabels, values: fullValues } = calcRolling(rows, field, state.rollingMonths, daily)); break;
      }

      // Filter results to [startDate, endDate]
      labels = []; values = [];
      const startIso = isoDate(startDate);
      const endIso   = isoDate(endDate);
      for (let i = 0; i < fullLabels.length; i++) {
        if (fullLabels[i] >= startIso && fullLabels[i] <= endIso) {
          labels.push(fullLabels[i]);
          values.push(fullValues[i]);
        }
      }
      document.getElementById('p2pResult').style.display = 'none';
    }

    datasets.push({ label: getSourceLabel(src), labels, values });
  });

  const chart = getChart();
  if (!chart) {
    createChart('cpiChart', { datasets, yLabel: yAxisLabel(), logScale: state.logScale });
  } else {
    updateChart({ datasets, yLabel: yAxisLabel(), logScale: state.logScale });
  }

  // Stats from primary (first) selected source
  if (datasets.length) {
    renderStats(datasets[0].labels, datasets[0].values);
  } else {
    document.getElementById('statsStrip').style.display = 'none';
  }
}

function renderP2PResult(result) {
  const el = document.getElementById('p2pResult');
  if (result.changePct === null) {
    el.textContent = 'No data for selected range.';
  } else {
    const annualStr = result.annualized !== null ? `${fmt(result.annualized)}% annualized` : '';
    el.innerHTML =
      `<span class="p2p-val">${fmt(result.changePct)}% total</span>` +
      (annualStr ? `  <span class="p2p-sep">|</span>  <span class="p2p-annualized">${annualStr}</span>` : '');
  }
  el.style.display = 'block';
}

function renderStats(labels, values) {
  const strip = document.getElementById('statsStrip');
  if (!labels.length) { strip.style.display = 'none'; return; }
  const s = calcStats(labels, values, state.displayMode);
  if (!s) { strip.style.display = 'none'; return; }

  const isIndexMode = state.displayMode === 'index' || state.displayMode === 'p2p';
  strip.innerHTML = [
    `<span class="stat"><span class="stat-label">Current</span> <span class="stat-val">${fmt(s.current, 3)}</span></span>`,
    isIndexMode && s.changePct !== null
      ? `<span class="stat"><span class="stat-label">Period Chg</span> <span class="stat-val">${fmt(s.changePct)}%</span></span>`
      : '',
    isIndexMode && s.annualized !== null
      ? `<span class="stat"><span class="stat-label">Annualized</span> <span class="stat-val">${fmt(s.annualized)}%</span></span>`
      : '',
    `<span class="stat"><span class="stat-label">Peak</span> <span class="stat-val">${fmt(s.peak, 3)} <span class="stat-date">(${fmtDate(s.peakLabel)})</span></span></span>`,
    `<span class="stat"><span class="stat-label">Trough</span> <span class="stat-val">${fmt(s.trough, 3)} <span class="stat-date">(${fmtDate(s.troughLabel)})</span></span></span>`,
  ].filter(Boolean).join('');
  strip.style.display = 'flex';
}

// ── Date range ────────────────────────────────────────────────────────────────

function applySourceExtentToInputs() {
  const { min, max } = combinedExtent();
  if (!min || !max) return;
  state.startDate = min;
  state.endDate   = max;
  updateDateUI('start', min);
  updateDateUI('end', max);
  state.p2pStart = min;
  state.p2pEnd   = max;
  updateDateUI('p2pStart', min);
  updateDateUI('p2pEnd', max);
}

// ── UI visibility ─────────────────────────────────────────────────────────────

function updateSectionVisibility() {
  const mode = state.displayMode;
  document.getElementById('rollingSection').style.display   = mode === 'rolling' ? '' : 'none';
  document.getElementById('dateRangeSection').style.display = mode === 'p2p'     ? 'none' : '';
  document.getElementById('p2pSection').style.display       = mode === 'p2p'     ? '' : 'none';
  document.getElementById('logScaleOption').style.display   = (mode === 'index' || mode === 'p2p') ? '' : 'none';
}

// ── Status ────────────────────────────────────────────────────────────────────

function setStatus(text, isError = false) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = isError ? 'error' : '';
}

function setDataStatus() {
  const cpiLast = cpiRows?.length    ? cpiRows[cpiRows.length - 1]       : null;
  const refLast = refCpiRows?.length ? refCpiRows[refCpiRows.length - 1] : null;
  const cpiDate = cpiLast ? cpiLast.date.toLocaleString('en-US', { month: 'short', year: 'numeric' }) : '—';
  const refDate = refLast ? refLast.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  setStatus(`CPI through ${cpiDate}  ·  Ref CPI through ${refDate}`);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  setStatus('Loading…');

  try {
    [cpiRows, refCpiRows] = await Promise.all([fetchCpiHistory(), fetchRefCpi()]);
  } catch (err) {
    setStatus(`Load error: ${err.message}`, true);
    return;
  }

  setDataStatus();
  populateDateSelectors();
  applySourceExtentToInputs();
  updateSectionVisibility();
  render();
  wireControls();
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireControls() {
  // Data source (checkboxes)
  document.querySelectorAll('input[name="dataSource"]').forEach(el => {
    el.addEventListener('change', () => {
      const checked = Array.from(document.querySelectorAll('input[name="dataSource"]:checked')).map(cb => cb.value);
      if (checked.length === 0) {
        el.checked = true; // prevent zero selection
        return;
      }
      state.dataSources = checked;
      // applySourceExtentToInputs(); // Don't reset range on every click, let user decide?
      // Actually, if we add a source that expands the range, we might want to update.
      // But if we just update the chart, it might be better to stay at current range.
      render();
    });
  });

  // Display mode
  document.querySelectorAll('input[name="displayMode"]').forEach(el => {
    el.addEventListener('change', () => {
      state.displayMode = el.value;
      updateSectionVisibility();
      resetZoom();
      render();
    });
  });

  // Log Scale
  document.getElementById('logScale').addEventListener('change', e => {
    state.logScale = e.target.checked;
    render();
  });

  // Rolling presets
  document.querySelectorAll('.rolling-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      state.rollingMonths = parseInt(btn.dataset.months, 10);
      document.getElementById('rollingCustom').value = state.rollingMonths;
      document.querySelectorAll('.rolling-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    });
  });

  // Rolling custom
  let rollingDebounce = null;
  document.getElementById('rollingCustom').addEventListener('input', e => {
    clearTimeout(rollingDebounce);
    rollingDebounce = setTimeout(() => {
      const v = parseInt(e.target.value, 10);
      if (v > 0) {
        state.rollingMonths = v;
        document.querySelectorAll('.rolling-preset').forEach(b => b.classList.remove('active'));
        render();
      }
    }, 400);
  });

  // Date range
  ['startMonth', 'startYear'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const d = getValuesFromUI('start');
      if (d) { state.startDate = d; render(); }
    });
  });
  ['endMonth', 'endYear'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const d = getValuesFromUI('end');
      if (d) { state.endDate = d; render(); }
    });
  });
  document.getElementById('btnFullHistory').addEventListener('click', () => {
    applySourceExtentToInputs();
    resetZoom();
    render();
  });

  // P2P date inputs
  ['p2pStartMonth', 'p2pStartYear'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const d = getValuesFromUI('p2pStart');
      if (d) { state.p2pStart = d; render(); }
    });
  });
  ['p2pEndMonth', 'p2pEndYear'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const d = getValuesFromUI('p2pEnd');
      if (d) { state.p2pEnd = d; render(); }
    });
  });

  // Reset Zoom button
  document.getElementById('btnResetZoom').addEventListener('click', () => resetZoom());

  // Keyboard zoom/pan — pass all keydown events to the chart
  window.addEventListener('keydown', e => handleChartKeydown(e, getChart()));

  // Window resize — let ResizeObserver handle the chart canvas itself;
  // this covers any cases the observer misses (e.g. fullscreen toggle)
  window.addEventListener('resize', () => { const c = getChart(); if (c) c.resize(); });
}

init();

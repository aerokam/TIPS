// CpiExplorer — chart.js
// Chart.js lifecycle with full zoom/pan/resize matching YieldsMonitor.

import { snapYBounds, snapYAfterZoom, setupAxisWheelZoom } from '../../shared/src/chart-keys.js';
import { calendarTimeAxis } from '../../shared/src/chart-time-axis.js';

let _chart = null;
let _currentDatasets = null; // { label, labels, values }[]

export const COLORS = ['#1a56db', '#ea580c', '#7c3aed', '#059669', '#dc2626'];

// ── Y rescaling ───────────────────────────────────────────────────────────────

function rescaleYToVisible() {
  if (!_chart || !_currentDatasets) return;
  const xMin = _chart.scales.x.min;
  const xMax = _chart.scales.x.max;

  const visibleVals = [];
  _currentDatasets.forEach(ds => {
    const { labels, values } = ds;
    for (let i = 0; i < labels.length; i++) {
      const t = new Date(labels[i]).getTime();
      if (t >= xMin && t <= xMax) {
        const v = values[i];
        if (v !== null && !isNaN(v)) {
          // Log scale can't show 0 or negative
          if (_chart.options.scales.y.type === 'logarithmic' && v <= 0) continue;
          visibleVals.push(v);
        }
      }
    }
  });

  if (!visibleVals.length) return;

  if (_chart.options.scales.y.type === 'logarithmic') {
    _chart.options.scales.y.min = Math.min(...visibleVals) * 0.95;
    _chart.options.scales.y.max = Math.max(...visibleVals) * 1.05;
  } else {
    const b = snapYBounds(Math.min(...visibleVals), Math.max(...visibleVals));
    _chart.options.scales.y.min = b.min;
    _chart.options.scales.y.max = b.max;
    _chart.options.scales.y.ticks.stepSize = b.step;
  }
  _chart.update('none');
}

function applyYBoundsFromData(datasets) {
  const allVals = [];
  datasets.forEach(ds => {
    ds.values.forEach(v => {
      if (v !== null && !isNaN(v)) {
        if (_chart.options.scales.y.type === 'logarithmic' && v <= 0) return;
        allVals.push(v);
      }
    });
  });

  if (!allVals.length) return;

  if (_chart.options.scales.y.type === 'logarithmic') {
    _chart.options.scales.y.min = Math.min(...allVals) * 0.95;
    _chart.options.scales.y.max = Math.max(...allVals) * 1.05;
  } else {
    const b = snapYBounds(Math.min(...allVals), Math.max(...allVals));
    _chart.options.scales.y.min = b.min;
    _chart.options.scales.y.max = b.max;
    _chart.options.scales.y.ticks.stepSize = b.step;
  }
}

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * Create (or recreate) the Chart.js instance.
 * @param {string} canvasId
 * @param {{ datasets: Array, yLabel: string, logScale: boolean }} config
 * @returns {Chart}
 */
export function createChart(canvasId, { datasets, yLabel, logScale, tooltipFormat = 'MMM yyyy' }) {
  if (_chart) { _chart.destroy(); _chart = null; }
  _currentDatasets = datasets;

  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');

  const chartDatasets = datasets.map((ds, i) => ({
    label: ds.label,
    data: ds.labels.map((l, idx) => ({ x: l, y: ds.values[idx] })),
    borderColor: COLORS[i % COLORS.length],
    borderWidth: 1.5,
    pointRadius: ds.values.length > 500 ? 0 : 1.5,
    pointHoverRadius: 4,
    fill: false,
    tension: 0,
  }));

  _chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: chartDatasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: {
          display: datasets.length > 1,
          position: 'top',
          align: 'end',
          labels: { boxWidth: 12, font: { size: 10, weight: 'bold' }, color: '#64748b' }
        },
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'xy',
            onZoomComplete: () => rescaleYToVisible(),
          },
          pan: {
            enabled: true,
            mode: 'xy',
            onPanComplete: () => rescaleYToVisible(),
          },
        },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.95)',
          titleColor: '#64748b',
          titleFont: { size: 11, weight: 'bold' },
          bodyColor: '#1e293b',
          borderColor: '#e2e8f0',
          borderWidth: 1,
          padding: 8,
          bodyFont: { size: 12, weight: 'bold' },
          cornerRadius: 6,
          displayColors: true,
          callbacks: {
            title: items => items[0]?.label ?? '',
            label: item => {
              const v = item.raw && typeof item.raw === 'object' ? item.raw.y : item.raw;
              return ` ${item.dataset.label}: ${typeof v === 'number' ? v.toFixed(2) : v}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          time: {
            tooltipFormat: tooltipFormat,
            displayFormats: { year: 'yyyy', month: 'MMM yyyy', day: 'MMM d yyyy' },
          },
          ...calendarTimeAxis(),
        },
        y: {
          type: logScale ? 'logarithmic' : 'linear',
          title: { display: true, text: yLabel, color: '#64748b', font: { size: 11 } },
          grid: { color: '#f1f5f9' },
          ticks: {
            color: '#64748b',
            font: { size: 11 },
            callback: function(value) {
              return logScale ? Number(value).toFixed(1) : value;
            }
          },
        },
      },
    },
  });

  applyYBoundsFromData(datasets);
  _chart.update('none');

  setupAxisWheelZoom(
    canvas,
    () => rescaleYToVisible(),
    ({ chart, factor }) => snapYAfterZoom(chart, factor)
  );

  const container = canvas.closest('.chart-wrap') || canvas.parentElement;
  new ResizeObserver(() => { if (_chart) _chart.resize(); }).observe(container);

  return _chart;
}

// ── Update ────────────────────────────────────────────────────────────────────

/**
 * Update the existing chart with new data and y-axis label.
 * @param {{ datasets: Array, yLabel: string, logScale: boolean }} config
 */
export function updateChart({ datasets, yLabel, logScale, tooltipFormat = 'MMM yyyy' }) {
  if (!_chart) return;
  _currentDatasets = datasets;

  _chart.options.scales.y.type = logScale ? 'logarithmic' : 'linear';
  _chart.options.scales.y.title.text = yLabel;
  _chart.options.plugins.legend.display = datasets.length > 1;
  _chart.options.scales.x.time.tooltipFormat = tooltipFormat;

  // Preserve current x bounds so adding/removing a series doesn't reset the zoom.
  // Read from options (only set when user has zoomed) not scales (always has a value).
  const xMin = _chart.options.scales.x?.min;
  const xMax = _chart.options.scales.x?.max;

  _chart.data.datasets = datasets.map((ds, i) => ({
    label: ds.label,
    data: ds.labels.map((l, idx) => ({ x: l, y: ds.values[idx] })),
    borderColor: COLORS[i % COLORS.length],
    borderWidth: 1.5,
    pointRadius: ds.values.length > 500 ? 0 : 1.5,
    pointHoverRadius: 4,
    fill: false,
    tension: 0,
  }));

  rescaleYToVisible();
  _chart.update('none');

  // Restore x bounds after update (update() can reset them)
  if (xMin != null && xMax != null) {
    _chart.options.scales.x.min = xMin;
    _chart.options.scales.x.max = xMax;
    _chart.update('none');
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────

/** Reset zoom to show full dataset, then rescale Y to fit all data. */
export function resetZoom() {
  if (!_chart) return;
  _chart.resetZoom();
  if (_currentDatasets) applyYBoundsFromData(_currentDatasets);
  _chart.update('none');
}

/** Return the current Chart instance (null before first createChart). */
export function getChart() { return _chart; }

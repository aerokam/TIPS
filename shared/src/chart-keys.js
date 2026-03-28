/**
 * shared/src/chart-keys.js
 * Common keyboard interaction logic for Chart.js instances.
 * Provides panning and zooming via Arrow keys and +/- keys.
 */

export function handleChartKeydown(e, chart, options = {}) {
  if (!chart) return;

  const {
    panStep = 0.1,   // 10% of visible range
    zoomStep = 0.1,  // 10% zoom in/out
    onAction = null  // callback after update
  } = options;

  const xAx = chart.scales.x;
  const yAx = chart.scales.y;
  if (!xAx || !yAx) return;

  let handled = false;

  // 1. Panning (Arrow Keys)
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    const xRange = xAx.max - xAx.min;
    const yRange = yAx.max - yAx.min;
    const dx = xRange * panStep;
    const dy = yRange * panStep;

    if (e.key === 'ArrowLeft') {
      chart.options.scales.x.min = xAx.min - dx;
      chart.options.scales.x.max = xAx.max - dx;
    } else if (e.key === 'ArrowRight') {
      chart.options.scales.x.min = xAx.min + dx;
      chart.options.scales.x.max = xAx.max + dx;
    } else if (e.key === 'ArrowUp') {
      chart.options.scales.y.min = yAx.min + dy;
      chart.options.scales.y.max = yAx.max + dy;
    } else if (e.key === 'ArrowDown') {
      chart.options.scales.y.min = yAx.min - dy;
      chart.options.scales.y.max = yAx.max - dy;
    }
    handled = true;
  }

  // 2. Zooming (+/- Keys)
  // Use '=' for '+' without shift
  if (['+', '=', '-', '_'].includes(e.key)) {
    const xRange = xAx.max - xAx.min;
    const yRange = yAx.max - yAx.min;
    const isZoomIn = e.key === '+' || e.key === '=';
    
    // Zoom around the center of the current view
    const xMid = (xAx.max + xAx.min) / 2;
    const yMid = (yAx.max + yAx.min) / 2;
    
    const factor = isZoomIn ? (1 - zoomStep) : (1 + zoomStep);
    
    const newXHalf = (xRange * factor) / 2;
    const newYHalf = (yRange * factor) / 2;

    chart.options.scales.x.min = xMid - newXHalf;
    chart.options.scales.x.max = xMid + newXHalf;
    chart.options.scales.y.min = yMid - newYHalf;
    chart.options.scales.y.max = yMid + newYHalf;
    handled = true;
  }

  if (handled) {
    e.preventDefault();
    chart.update('none'); // Update without animation for responsiveness
    if (onAction) onAction({ chart });
  }
}

/**
 * Adds modifier-key wheel zoom for independent axis control.
 * - Ctrl + scroll  → zoom X axis only
 * - Shift + scroll → zoom Y axis only
 * Plain scroll is left to the chartjs-plugin-zoom wheel handler.
 */
export function setupAxisWheelZoom(canvas) {
  if (canvas._axisWheelZoomSetup) return;
  canvas._axisWheelZoomSetup = true;

  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.shiftKey) return; // let plugin handle plain scroll

    const chart = Chart.getChart(canvas);
    if (!chart) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const factor = e.deltaY > 0 ? 0.9 : 1.1;

    if (e.ctrlKey) {
      chart.zoom({ x: factor });
    } else {
      chart.zoom({ y: factor });
    }
  }, { passive: false, capture: true });
}

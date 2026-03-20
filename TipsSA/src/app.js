// TIPS Seasonal Adjustment (TipsSA) Frontend Logic

const YIELDS_CSV_URL = `/TipsSA/data/TipsYields.csv`;
const REF_CPI_CSV_URL = `/TipsSA/data/RefCpiNsaSa.csv`;

// --- Helpers ---
function parseCsv(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    const parts = line.split(',');
    const obj = {};
    header.forEach((h, i) => obj[h.trim()] = parts[i]?.trim());
    return obj;
  });
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
let schwabPrices = null;

async function init() {
  const statusEl = document.getElementById('status');
  
  try {
    const [yieldsRes, refCpiRes] = await Promise.all([
      fetch(YIELDS_CSV_URL),
      fetch(REF_CPI_CSV_URL)
    ]);

    if (!yieldsRes.ok || !refCpiRes.ok) throw new Error("Failed to fetch data from R2");

    rawYieldsData = parseCsv(await yieldsRes.text());
    rawRefCpiData = parseCsv(await refCpiRes.text());

    processAndRender();

  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = 'error';
    console.error(err);
  }
}

function processAndRender() {
  if (!rawYieldsData || !rawRefCpiData) return;

  const statusEl = document.getElementById('status');
  const infoEl = document.getElementById('info-strip');
  const priceSourceEl = document.getElementById('priceSource');

  const settleDateStr = rawYieldsData[0]?.settlementDate;
  infoEl.textContent = `Prices as of ${settleDateStr} · Reference CPI / SA factors from R2`;
  priceSourceEl.style.display = schwabPrices ? 'block' : 'none';

  const processedBonds = rawYieldsData.map(bond => {
    const coupon = parseFloat(bond.coupon);
    let price = parseFloat(bond.price);
    
    // Override with Schwab Ask price if available
    if (schwabPrices && schwabPrices.has(bond.cusip)) {
      price = schwabPrices.get(bond.cusip);
    }

    const mmddSettle = bond.settlementDate.slice(5, 10);
    const mmddMature = bond.maturity.slice(5, 10);

    const saSettle = parseFloat(rawRefCpiData.find(r => r["Ref CPI Date"].includes(`-${mmddSettle}`))?.["SA Factor"]);
    const saMature = parseFloat(rawRefCpiData.find(r => r["Ref CPI Date"].includes(`-${mmddMature}`))?.["SA Factor"]);

    if (!saSettle || !saMature) return null;

    const priceSaFactor = saSettle / saMature;
    const saPrice = price * priceSaFactor;

    const askYield = yieldFromPrice(price, coupon, bond.settlementDate, bond.maturity);
    const saYield = yieldFromPrice(saPrice, coupon, bond.settlementDate, bond.maturity);

    return {
      ...bond,
      coupon,
      price,
      askYield,
      saYield,
      diffBps: (saYield - askYield) * 10000
    };
  }).filter(b => b !== null);

  renderTable(processedBonds);
  renderChart(processedBonds);
  statusEl.textContent = `Successfully loaded ${processedBonds.length} TIPS bonds.`;
}

document.getElementById('schwabFile').addEventListener('change', async (e) => {
  if (!e.target.files.length) {
    schwabPrices = null;
    processAndRender();
    return;
  }

  try {
    const text = await e.target.files[0].text();
    const rows = parseCsv(text);
    const priceMap = new Map();

    rows.forEach(row => {
      // Schwab CSV: "Description" contains CUSIP, "Quote" is 'Ask', "Price" is clean price
      if (row["Quote"] === "Ask") {
        const desc = row["Description"] || "";
        const cusipMatch = desc.match(/[A-Z0-9]{9}/);
        const price = parseFloat((row["Price"] || "").replace(/,/g, ''));
        if (cusipMatch && !isNaN(price)) {
          priceMap.set(cusipMatch[0], price);
        }
      }
    });

    if (priceMap.size === 0) {
      alert("No valid Ask prices found in the Schwab CSV. Ensure it has 'Description' (with CUSIP), 'Quote' (Ask), and 'Price' columns.");
      e.target.value = '';
      return;
    }

    schwabPrices = priceMap;
    processAndRender();
  } catch (err) {
    alert("Error parsing Schwab CSV: " + err.message);
    console.error(err);
  }
});

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
      <td class="${b.diffBps >= 0 ? 'pos' : 'neg'}">${b.diffBps.toFixed(1)}</td>
    </tr>
  `).join('');
}

let chart = null;
function renderChart(bonds) {
  const ctx = document.getElementById('yieldChart').getContext('2d');
  
  // Sort bonds by maturity for the chart
  const sorted = [...bonds].sort((a, b) => localDate(a.maturity) - localDate(b.maturity));
  
  const labels = sorted.map(b => fmtMMM(b.maturity));
  const askYields = sorted.map(b => (b.askYield * 100).toFixed(3));
  const saYields = sorted.map(b => (b.saYield * 100).toFixed(3));

  if (chart) chart.destroy();

  const lockLeftEl = document.getElementById('lockLeft');
  const resizable = document.getElementById('chartResizable');
  const wrapper = document.getElementById('chartWrapper');

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Ask Yield (%)',
          data: askYields,
          borderColor: '#94a3b8',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.1
        },
        {
          label: 'SA Yield (%)',
          data: saYields,
          borderColor: '#1a56db',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        x: {
          display: true,
          title: { display: true, text: 'Maturity' }
        },
        y: {
          display: true,
          title: { display: true, text: 'Yield (%)' }
        }
      },
      plugins: {
        zoom: {
          pan: {
            enabled: true,
            mode: 'x',
          },
          zoom: {
            wheel: {
              enabled: true,
            },
            drag: {
              enabled: true,
              backgroundColor: 'rgba(26, 86, 219, 0.1)',
              borderColor: 'rgba(26, 86, 219, 0.4)',
              borderWidth: 1,
            },
            pinch: {
              enabled: true
            },
            mode: 'x',
            onZoomStart: ({chart, event}) => {
              if (lockLeftEl.checked) {
                chart.options.scales.x.min = 0;
              }
              return true;
            },
            onZoomComplete: ({chart}) => {
              const scale = chart.scales.x;
              let minIndex = Math.max(0, Math.round(scale.min));
              let maxIndex = Math.min(labels.length - 1, Math.round(scale.max));

              if (lockLeftEl.checked) {
                minIndex = 0;
              }

              const visibleCount = maxIndex - minIndex + 1;
              if (visibleCount <= 0) return;

              const totalCount = labels.length;
              const factor = totalCount / visibleCount;
              
              // Apply physical stretch to container
              resizable.style.width = Math.max(100, factor * 100) + '%';
              
              // Reset internal zoom so data fills the newly sized canvas
              // We do this by clearing min/max and calling update
              chart.options.scales.x.min = undefined;
              chart.options.scales.x.max = undefined;
              chart.update('none');

              // Scroll to the previous logical minIndex
              const scrollPercent = minIndex / totalCount;
              wrapper.scrollLeft = scrollPercent * resizable.offsetWidth;
            }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `${context.dataset.label}: ${context.parsed.y}%`;
            }
          }
        }
      }
    }
  });

  document.getElementById('resetZoom').addEventListener('click', () => {
    resizable.style.width = '100%';
    chart.options.scales.x.min = undefined;
    chart.options.scales.x.max = undefined;
    chart.resetZoom();
    chart.update();
    wrapper.scrollLeft = 0;
  });
}

init();

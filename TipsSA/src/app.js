// TIPS Seasonal Adjustment (TipsSA) Frontend Logic

const R2_BASE_URL = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const YIELDS_CSV_URL = `${R2_BASE_URL}/TIPS/TipsYields.csv`;
const REF_CPI_CSV_URL = `${R2_BASE_URL}/TIPS/RefCpiNsaSa.csv`;

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

async function init() {
  const statusEl = document.getElementById('status');
  const infoEl = document.getElementById('info-strip');
  
  try {
    const [yieldsRes, refCpiRes] = await Promise.all([
      fetch(YIELDS_CSV_URL),
      fetch(REF_CPI_CSV_URL)
    ]);

    if (!yieldsRes.ok || !refCpiRes.ok) throw new Error("Failed to fetch data from R2");

    const yieldsData = parseCsv(await yieldsRes.text());
    const refCpiData = parseCsv(await refCpiRes.text());

    const settleDateStr = yieldsData[0]?.settlementDate;
    infoEl.textContent = `Prices as of ${settleDateStr} · Reference CPI / SA factors from R2`;

    const processedBonds = yieldsData.map(bond => {
      const coupon = parseFloat(bond.coupon);
      const price = parseFloat(bond.price);
      
      const mmddSettle = bond.settlementDate.slice(5, 10);
      const mmddMature = bond.maturity.slice(5, 10);

      const saSettle = parseFloat(refCpiData.find(r => r["Ref CPI Date"].includes(`-${mmddSettle}`))?.["SA Factor"]);
      const saMature = parseFloat(refCpiData.find(r => r["Ref CPI Date"].includes(`-${mmddMature}`))?.["SA Factor"]);

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

  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = 'error';
    console.error(err);
  }
}

function renderTable(bonds) {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = bonds.map(b => `
    <tr>
      <td>${b.maturity}</td>
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
  
  const labels = sorted.map(b => b.maturity);
  const askYields = sorted.map(b => (b.askYield * 100).toFixed(3));
  const saYields = sorted.map(b => (b.saYield * 100).toFixed(3));

  if (chart) chart.destroy();

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
}

init();

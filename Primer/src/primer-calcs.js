// primer-calcs.js — interactive calculator widgets only (live data, sliders,
// inputs, event wiring). No page prose lives here — every calculator page's
// intro text is a block in content/deck.md, rendered by deck-manager.js
// before the matching function below mounts its widget into the page.
import { lookupRefCpi, pickFeaturedTips, baseCpiFor, fmtDate, pickFeaturedNote, pickFeaturedShortBill, pickFeaturedLongBill } from './primer-data.js';
import { priceFromYield, yieldFromPrice } from '../../shared/src/bond-math.js';
import { discountRateToPrice, priceToDiscountRate } from './primer-bills.js';

function wireIndexRatioCalc(el, data) {
  const rows = data.refCpiRows;
  const minDate = rows[0].date, maxDate = rows[rows.length - 1].date;
  const tipsOptions = data.tipsRefRows
    .filter(r => r.baseCpi)
    .sort((a, b) => a.maturity < b.maturity ? -1 : 1);
  const defaultTips = pickFeaturedTips(data, 10);

  el.innerHTML = `
    <div class="calc">
      <div class="inputs">
        <label>TIPS</label>
        <select id="ircTips">
          ${tipsOptions.map(t => `<option value="${t.cusip}" ${t.cusip === defaultTips.cusip ? 'selected' : ''}>${t.cusip} — matures ${fmtDate(t.maturity)}</option>`).join('')}
        </select>
        <label>Date</label>
        <input id="ircDate" type="date" min="${minDate}" max="${maxDate}" value="${maxDate}"/>
        <div class="aside" id="ircDateHint" style="margin-top:8px"></div>
      </div>
      <div class="outputs" id="ircOut"></div>
    </div>
  `;
  const sel = el.querySelector('#ircTips');
  const dateInp = el.querySelector('#ircDate');
  const hint = el.querySelector('#ircDateHint');
  const out = el.querySelector('#ircOut');

  function syncDateBounds() {
    const tips = data.tipsRefRows.find(t => t.cusip === sel.value);
    const lo = tips && tips.datedDate > minDate ? tips.datedDate : minDate;
    dateInp.min = lo;
    if (dateInp.value < lo) dateInp.value = lo;
    hint.textContent = `Ratio is only meaningful on or after this TIPS's dated date (${lo}); ` +
      `the field won't go earlier.`;
  }

  function recompute() {
    const cusip = sel.value;
    const tips = data.tipsRefRows.find(t => t.cusip === cusip);
    const baseCpi = baseCpiFor(data, cusip);
    const dateStr = dateInp.value;
    const refCpiDate = lookupRefCpi(rows, dateStr);
    if (refCpiDate == null || !baseCpi) {
      out.innerHTML = `<p class="err">No Ref CPI data for that date.</p>`;
      return;
    }
    const ratio = refCpiDate / baseCpi;
    out.innerHTML = `
      <div class="row"><span>Base CPI (dated ${fmtDate(tips.datedDate)})</span><b>${baseCpi.toFixed(5)}</b></div>
      <div class="row"><span>Ref CPI on ${dateStr}</span><b>${refCpiDate.toFixed(5)}</b></div>
      <div class="row"><span>Index Ratio</span><b>${ratio.toFixed(5)}</b></div>
      <div class="row"><span>$1,000 par → inflation-adjusted</span><b>$${(1000 * ratio).toFixed(2)}</b></div>
    `;
  }
  sel.addEventListener('change', () => { syncDateBounds(); recompute(); });
  dateInp.addEventListener('change', recompute);
  syncDateBounds();
  recompute();
}

function wireInflAdjPrincipal(el, data) {
  const tips = pickFeaturedTips(data, 10);
  const baseCpi = baseCpiFor(data, tips.cusip);
  const settle = data.settlementDate;
  const refCpi = lookupRefCpi(data.refCpiRows, settle) ?? lookupRefCpi(data.refCpiRows, data.refCpiRows[data.refCpiRows.length - 1].date);
  const ratio = refCpi && baseCpi ? refCpi / baseCpi : null;

  el.innerHTML = `
    <div class="calc">
      <div class="inputs">
        <label>Par amount</label>
        <input id="iapPar" type="number" value="1000" min="100" step="100"/>
        <div class="aside" style="margin-top:14px">Using live data for <b>${tips.cusip}</b>
        (matures ${fmtDate(tips.maturity)}): base CPI ${baseCpi ? baseCpi.toFixed(5) : '—'}, Ref CPI
        ${refCpi ? refCpi.toFixed(5) : '—'} as of ${settle}.</div>
      </div>
      <div class="outputs" id="iapOut"></div>
    </div>
  `;
  const inp = el.querySelector('#iapPar');
  const out = el.querySelector('#iapOut');
  function recompute() {
    const par = parseFloat(inp.value) || 0;
    if (!ratio) { out.innerHTML = `<p class="err">Live Ref CPI unavailable for this date.</p>`; return; }
    out.innerHTML = `
      <div class="row"><span>Index Ratio</span><b>${ratio.toFixed(5)}</b></div>
      <div class="row"><span>Par amount</span><b>$${par.toLocaleString()}</b></div>
      <div class="row"><span>Inflation-adjusted principal</span><b>$${(par * ratio).toFixed(2)}</b></div>
      <div class="row"><span>Next semiannual coupon (${(tips.coupon * 100).toFixed(3)}% ÷ 2)</span><b>$${(par * ratio * tips.coupon / 2).toFixed(2)}</b></div>
    `;
  }
  inp.addEventListener('input', recompute);
  recompute();
}

function wirePriceVsYieldCalc(el, data) {
  const note = pickFeaturedNote(data, 10);
  const settle = new Date(data.settlementDate);
  const maturity = new Date(note.maturity);
  el.innerHTML = `
    <p class="lead">Live example: a real ${(note.coupon * 100).toFixed(3)}% note/bond (CUSIP
    ${note.cusip}, matures ${fmtDate(note.maturity)}). Drag the yield and watch price move — computed
    with this suite's actual pricing function, the same one every other app uses.</p>
    <div class="calc">
      <div class="inputs">
        <label>Yield to maturity: <span id="pvyLbl"></span></label>
        <input id="pvySlider" type="range" min="0" max="800" value="${Math.round((note.yield || 0.04) * 10000)}" step="5"/>
      </div>
      <div class="outputs" id="pvyOut"></div>
    </div>
  `;
  const slider = el.querySelector('#pvySlider');
  const lbl = el.querySelector('#pvyLbl');
  const out = el.querySelector('#pvyOut');
  function recompute() {
    const yld = +slider.value / 10000;
    lbl.textContent = (yld * 100).toFixed(2) + '%';
    const price = priceFromYield(yld, note.coupon, settle, maturity);
    const premDisc = price == null ? '' : (price >= 100 ? 'premium' : 'discount');
    out.innerHTML = price == null ? `<p class="err">Can't price this combination.</p>` : `
      <div class="row"><span>Coupon</span><b>${(note.coupon * 100).toFixed(3)}%</b></div>
      <div class="row"><span>Yield</span><b>${(yld * 100).toFixed(3)}%</b></div>
      <div class="row"><span>Price</span><b>${price.toFixed(4)}</b></div>
      <div class="row"><span>vs. par</span><b>${premDisc}</b></div>
    `;
  }
  slider.addEventListener('input', recompute);
  recompute();
}

function wirePriceCalc(el, data) {
  const tips = pickFeaturedTips(data, 10);
  const settle = new Date(data.settlementDate);
  const maturity = new Date(tips.maturity);
  el.innerHTML = `
    <p class="lead">Live example: a real TIPS (CUSIP ${tips.cusip}, ${(tips.coupon * 100).toFixed(3)}%
    coupon, matures ${fmtDate(tips.maturity)}). Enter any real yield and get the unadjusted (real)
    price — frequency 2, exactly as the table on the previous page says.</p>
    <div class="calc">
      <div class="inputs">
        <label>Settlement date</label>
        <input id="pcSettle" type="text" value="${data.settlementDate}" disabled/>
        <label>Maturity date</label>
        <input id="pcMat" type="text" value="${tips.maturity}" disabled/>
        <label>Coupon (real, %)</label>
        <input id="pcCoupon" type="number" value="${(tips.coupon * 100).toFixed(3)}" step="0.001"/>
        <label>Real yield (%)</label>
        <input id="pcYield" type="number" value="${((tips.yield || 0.02) * 100).toFixed(3)}" step="0.001"/>
      </div>
      <div class="outputs" id="pcOut"></div>
    </div>
  `;
  const couponInp = el.querySelector('#pcCoupon');
  const yieldInp = el.querySelector('#pcYield');
  const out = el.querySelector('#pcOut');
  function recompute() {
    const coupon = (parseFloat(couponInp.value) || 0) / 100;
    const yld = (parseFloat(yieldInp.value) || 0) / 100;
    const price = priceFromYield(yld, coupon, settle, maturity);
    out.innerHTML = price == null ? `<p class="err">Can't price this combination.</p>` : `
      <div class="row"><span>Frequency</span><b>2 (semiannual)</b></div>
      <div class="row"><span>Unadjusted (real) price</span><b>${price.toFixed(6)}</b></div>
      <div class="row"><span>Per $1,000 par (real)</span><b>$${(price / 100 * 1000).toFixed(2)}</b></div>
      <div class="row"><span class="muted">Multiply by the Index Ratio (Ch. 4) to get the actual inflation-adjusted price paid.</span></div>
    `;
  }
  couponInp.addEventListener('input', recompute);
  yieldInp.addEventListener('input', recompute);
  recompute();
}

function wireBillCalc(el, data) {
  const shortBill = pickFeaturedShortBill(data);
  const longBill = pickFeaturedLongBill(data);
  const options = [shortBill, longBill].filter(Boolean);
  const settle = new Date(data.settlementDate);

  el.innerHTML = `
    <p class="lead">Two real, currently-outstanding bills — one on each side of the 26-week line.
    Pick one, then adjust the discount rate and watch price and investment rate follow.</p>
    <div class="calc">
      <div class="inputs">
        <label>Bill</label>
        <select id="bcSel">
          ${options.map((b, i) => `<option value="${i}">${b.cusip} — matures ${fmtDate(b.maturity)} (${b.days} days)</option>`).join('')}
        </select>
        <label>Discount rate (%)</label>
        <input id="bcRate" type="number" step="0.001"/>
      </div>
      <div class="outputs" id="bcOut"></div>
    </div>
  `;
  const sel = el.querySelector('#bcSel');
  const rateInp = el.querySelector('#bcRate');
  const out = el.querySelector('#bcOut');

  function loadBill() {
    const b = options[+sel.value];
    if (!b || b.price == null) { rateInp.value = ''; return; }
    rateInp.value = (priceToDiscountRate(b.price, b.days) * 100).toFixed(3);
    recompute();
  }
  function recompute() {
    const b = options[+sel.value];
    if (!b) return;
    const d = (parseFloat(rateInp.value) || 0) / 100;
    const price = discountRateToPrice(d, b.days);
    const invRate = yieldFromPrice(price, 0, settle, new Date(b.maturity));
    out.innerHTML = `
      <div class="row"><span>Days to maturity</span><b>${b.days}</b></div>
      <div class="row"><span>Frequency (per Ch. 7 rule)</span><b>${b.days > 182 ? '2' : '1'}</b></div>
      <div class="row"><span>Price</span><b>${price.toFixed(6)}</b></div>
      <div class="row"><span>Discount amount (per $1,000)</span><b>$${((100 - price) / 100 * 1000).toFixed(2)}</b></div>
      <div class="row"><span>Investment rate</span><b>${invRate == null ? '—' : (invRate * 100).toFixed(3) + '%'}</b></div>
    `;
  }
  sel.addEventListener('change', loadBill);
  rateInp.addEventListener('input', recompute);
  loadBill();
}

// Page id -> widget wiring function. index.html mounts a page's calculator
// (if any) into a container appended after that page's rendered deck.md blocks.
export const CALCS = {
  'index-ratio-calc': wireIndexRatioCalc,
  'inflation-adjusted-principal': wireInflAdjPrincipal,
  'price-vs-yield-calc': wirePriceVsYieldCalc,
  'price-calc': wirePriceCalc,
  'bill-calc': wireBillCalc,
};

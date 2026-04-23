// render.js -- Table rendering driven by COLS schema (6.0_UI_Schema.md)
// Exports: COLS, renderTable

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtCell(v, fmt) {
  if (fmt === 'str' || fmt === 'fy') return String(v ?? '');
  if (fmt === 'qty') return typeof v === 'number' ? String(Math.round(v)) : String(v ?? '');
  if (fmt === 'sgn') {
    if (typeof v !== 'number') return '';
    const r = Math.round(v);
    return (r > 0 ? '+' : '') + r.toLocaleString('en-US');
  }
  if (fmt === 'yld') return typeof v === 'number' ? (v * 100).toFixed(3) + '%' : String(v ?? '');
  return typeof v === 'number' ? Math.round(v).toLocaleString('en-US') : String(v ?? '');
}

function fmtCls(v, fmt) {
  return (fmt === 'sgn' && typeof v === 'number' && v !== 0) ? (v > 0 ? 'pos' : 'neg') : '';
}

function pi(d) { return d.principalPerBond * (1 + d.coupon / 2 * (d.nPeriods || 2)); }

// COLS schema -- single source for all table rendering (6.0_UI_Schema.md)
export const COLS = [
  // Shared (both modes)
  { label: 'CUSIP',       key: 'cusip',       fmt: 'str',
    value: d => d.cusip,       subValue: d => d.cusip },
  { label: 'Maturity',    key: 'maturity',    fmt: 'str',
    value: d => d.maturityStr, subValue: d => d.maturityStr },
  { label: 'Yield',       key: 'yield',       fmt: 'yld', buildOnly: true,
    value: d => d.yield },
  { label: 'Funded Year', headerHTML: 'Funded<br>Year', key: 'fundedYear',  fmt: 'fy',
    value: (d, ri, details) => (ri === details.length - 1 || details[ri+1].fundedYear !== d.fundedYear) ? d.fundedYear : '',
    subValue: d => d.isFuture30yCover ? 'Future 30Y' : 'Gap' },

  // Rebalance-only
  { label: 'Amount Before', headerHTML: 'Amt<br>Before', key: 'amtBefore', fmt: 'amt', rebalOnly: true,
    value:          d => d.araBeforeTotal,
    subValue:       d => d.excessQtyBefore * pi(d),
    subDrillKeyFn:  d => d.isFuture30yCover ? 'future30yAmtBefore' : 'gapAmtBefore',
    total: true, totalFn: d => (d.araBeforeTotal ?? 0) + (d.excessQtyBefore * pi(d) || 0),
    drill: true, drillCond: (_v, d) => d.araBeforeTotal !== null },

  { label: 'Amount After',  headerHTML: 'Amt<br>After',  key: 'amtAfter',  fmt: 'amt', rebalOnly: true,
    value:          d => d.araAfterTotal,
    subValue:       d => d.excessQtyAfter * pi(d),
    subDrillKeyFn:  d => d.isFuture30yCover ? 'future30yAmtAfter' : 'gapAmtAfter',
    total: true, totalFn: d => (d.araAfterTotal ?? 0) + (d.excessQtyAfter * pi(d) || 0),
    drill: true, drillCond: (_v, d) => d.araAfterTotal !== null },

  { label: 'Cost Before',   headerHTML: 'Cost<br>Before', key: 'costBefore', fmt: 'amt', rebalOnly: true,
    value:          d => d.fundedYearQtyBefore * d.costPerBond,
    subValue:       d => d.excessQtyBefore * d.costPerBond,
    subDrillKeyFn:  d => d.isFuture30yCover ? 'future30yCostBefore' : 'gapCostBefore',
    total: true, totalFn: d => (d.fundedYearQtyBefore * d.costPerBond) + (d.excessQtyBefore * d.costPerBond || 0),
    drill: true, drillCond: v => typeof v === 'number' && v > 0 },

  { label: 'Cost After',    headerHTML: 'Cost<br>After', key: 'costAfter',  fmt: 'amt', rebalOnly: true,
    value:          d => d.fundedYearQtyAfter * d.costPerBond,
    subValue:       d => d.excessQtyAfter * d.costPerBond,
    subDrillKeyFn:  d => d.isFuture30yCover ? 'future30yCostAfter' : 'gapCostAfter',
    total: true, totalFn: d => (d.fundedYearQtyAfter * d.costPerBond) + (d.excessQtyAfter * d.costPerBond || 0),
    drill: true, drillCond: v => typeof v === 'number' && v > 0 },

  { label: 'Quantity Before',    headerHTML: 'Quantity<br>Before', key: 'qtyBefore',  fmt: 'qty', rebalOnly: true,
    value:    d => d.fundedYearQtyBefore,
    subValue: d => d.excessQtyBefore,
    total: true, totalFn: d => d.qtyBefore || 0 },

  { label: 'Quantity After',     headerHTML: 'Quantity<br>After', key: 'qtyAfter',   fmt: 'qty', rebalOnly: true,
    value:    d => d.fundedYearQtyAfter,
    subValue: d => d.excessQtyAfter,
    subDrillKey: 'qtyAfter',
    total: true, totalFn: d => d.qtyAfter || 0,
    drill: true, drillCond: (_v, d) => (d.qtyAfter || 0) > 0 },

  { label: 'Quantity Delta',     headerHTML: 'Quantity<br>Delta', key: 'qtyDelta',   fmt: 'sgn', rebalOnly: true,
    value:    d => d.fundedYearQtyAfter - d.fundedYearQtyBefore,
    subValue: d => d.excessQtyAfter - d.excessQtyBefore,
    total: true, totalFn: d => (d.qtyAfter || 0) - (d.qtyBefore || 0) },

  { label: 'Cash Delta',    headerHTML: 'Cash<br>Delta', key: 'cashDelta',  fmt: 'sgn', rebalOnly: true,
    value:    d => -((d.fundedYearQtyAfter - d.fundedYearQtyBefore) * d.costPerBond),
    subValue: d => -((d.excessQtyAfter - d.excessQtyBefore) * d.costPerBond),
    subDrillKey: 'gapCashDelta',
    total: true, totalFn: d => -((d.qtyAfter - d.qtyBefore) * d.costPerBond),
    drill: true, drillCond: v => typeof v === 'number' && v !== 0 },

  // Build-only
  { label: 'Amount', key: 'amount', fmt: 'amt', buildOnly: true,
    value:          d => d.fundedYearAmt,
    subValue:       d => d.excessAmt,
    subDrillKeyFn:  d => d.isFuture30yCover ? 'future30yAmt' : 'gapAmount',
    total: true, totalFn: d => (d.fundedYearAmt ?? 0) + (d.excessAmt ?? 0),
    drill: true, drillCond: () => true },

  { label: 'Cost',   key: 'cost',   fmt: 'amt', buildOnly: true,
    value:          d => d.fundedYearCost,
    subValue:       d => d.excessCost,
    subDrillKeyFn:  d => d.isFuture30yCover ? 'future30yCost' : 'gapCost',
    total: true, totalFn: d => (d.fundedYearCost ?? 0) + (d.excessCost ?? 0),
    drill: true, drillCond: () => true },

  { label: 'Quantity',    key: 'qty',    fmt: 'qty', buildOnly: true,
    value:    d => d.fundedYearQty,
    subValue: d => d.excessQty,
    total: true, totalFn: d => (d.fundedYearQty || 0) + (d.excessQty || 0) },
];

function isBracket(d, mode) {
  return mode === 'rebal' ? (d.excessQtyBefore > 0 || d.excessQtyAfter > 0) : d.excessQty > 0;
}

function isUpperBracket(d, summary, mode) {
  return mode === 'rebal'
    ? d.fundedYear === summary.brackets?.upperYear
    : d.fundedYear === summary.upperYear;
}

function cellHtml(col, v, ri, drillKey) {
  const s   = fmtCell(v, col.fmt);
  const cls = fmtCls(v, col.fmt);
  const align = col.fmt === 'fy' ? ' style="text-align:center"' : col.fmt !== 'str' ? ' style="text-align:right"' : '';
  let attr = '';
  if (drillKey) {
    attr = ' class="drillable' + (cls ? ' ' + cls : '') + '" data-row="' + ri + '" data-col="' + drillKey + '"';
  } else if (cls) {
    attr = ' class="' + cls + '"';
  }
  return '<td' + attr + align + '>' + esc(s) + '</td>';
}

export function renderTable({ details, mode, summary }) {
  const cols = COLS.filter(c => mode === 'rebal' ? !c.buildOnly : !c.rebalOnly);

  const headerHTML = '<thead><tr>' +
    cols.map(c => '<th data-col="' + c.key + '" style="cursor:help">' + (c.headerHTML || esc(c.label)) + '</th>').join('') +
    '</tr></thead>';

  const bodyRows = details.map((d, ri) => {
    const bt    = isBracket(d, mode);
    const upper = bt && isUpperBracket(d, summary, mode);
    const noChg = mode === 'rebal' && d.qtyAfter === d.qtyBefore && d.excessQtyAfter === d.excessQtyBefore;

    const mainCells = cols.map(col => {
      const v = col.value(d, ri, details);
      let drillKey = null;
      if (col.drill) {
        const ok = col.drillCond ? col.drillCond(v, d) : (v != null && v !== 0);
        if (ok) drillKey = col.key;
      }
      return cellHtml(col, v, ri, drillKey);
    }).join('');
    let html = '<tr data-ri="' + ri + '" class="' + (bt ? 'bracket ' : '') + (noChg ? 'no-change' : '') + '">' + mainCells + '</tr>';

    if (bt) {
      const subCells = cols.map(col => {
        const sv = col.subValue ? col.subValue(d, ri, details) : null;
        const sdk = col.subDrillKeyFn ? col.subDrillKeyFn(d) : (col.subDrillKey ?? null);
        return cellHtml(col, sv, ri, sdk);
      }).join('');
      const subRow = '<tr data-ri="' + ri + '" data-sub="1" class="excess-subrow bracket">' + subCells + '</tr>';
      html = upper ? subRow + html : html + subRow;
    }
    return html;
  }).join('');

  const tfootCells = cols.map(col => {
    const align = col.fmt === 'fy' ? ' style="text-align:center"' : col.fmt !== 'str' ? ' style="text-align:right"' : '';
    let s = '';
    if (col.key === 'cusip') {
      s = 'Total';
    } else if (col.total) {
      const fn = col.totalFn ?? (d => { const v = col.value(d, 0, details); return typeof v === 'number' ? v : 0; });
      const sum = details.reduce((acc, d) => acc + fn(d), 0);
      s = col.fmt === 'sgn'
        ? (Math.round(sum) > 0 ? '+' : '') + Math.round(sum).toLocaleString('en-US')
        : Math.round(sum).toLocaleString('en-US');
    }
    return '<td' + align + '>' + esc(s) + '</td>';
  }).join('');

  return {
    headerHTML,
    bodyHTML: '<tbody>' + bodyRows + '</tbody>',
    tfootHTML: '<tfoot><tr>' + tfootCells + '</tr></tfoot>',
  };
}

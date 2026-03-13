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
  return typeof v === 'number' ? Math.round(v).toLocaleString('en-US') : String(v ?? '');
}

function fmtCls(v, fmt) {
  return (fmt === 'sgn' && typeof v === 'number' && v !== 0) ? (v > 0 ? 'pos' : 'neg') : '';
}

function pi(d) { return d.principalPerBond * (1 + d.coupon / 2 * d.nPeriods); }

// COLS schema -- single source for all table rendering (6.0_UI_Schema.md)
export const COLS = [
  // Shared (both modes)
  { label: 'CUSIP',       key: 'cusip',       fmt: 'str',
    value: d => d.cusip,       subValue: d => d.cusip },
  { label: 'Maturity',    key: 'maturity',    fmt: 'str',
    value: d => d.maturityStr, subValue: d => d.maturityStr },
  { label: 'Funded Year', key: 'fundedYear',  fmt: 'fy',
    value: d => d.fundedYear,  subValue: () => 'Gap' },

  // Rebalance-only
  { label: 'Amount Before', key: 'amtBefore', fmt: 'amt', rebalOnly: true,
    value:       d => d.araBeforeTotal,
    subValue:    d => d.excessQtyBefore * pi(d),
    subDrillKey: 'gapAmtBefore',
    total: true, totalFn: d => d.araBeforeTotal ?? 0,
    drill: true, drillCond: (_v, d) => d.araBeforeTotal !== null },

  { label: 'Amount After',  key: 'amtAfter',  fmt: 'amt', rebalOnly: true,
    value:       d => d.araAfterTotal,
    subValue:    d => d.excessQtyAfter * pi(d),
    subDrillKey: 'gapAmtAfter',
    total: true, totalFn: d => d.araAfterTotal ?? 0,
    drill: true, drillCond: (_v, d) => d.araAfterTotal !== null },

  { label: 'Cost Before',   key: 'costBefore', fmt: 'amt', rebalOnly: true,
    value:       d => (d.isBracketTarget ? d.fundedYearQty : d.qtyBefore) * d.costPerBond,
    subValue:    d => d.excessQtyBefore * d.costPerBond,
    subDrillKey: 'gapCostBefore',
    total: true, totalFn: d => d.qtyBefore * d.costPerBond,
    drill: true, drillCond: v => typeof v === 'number' && v > 0 },

  { label: 'Cost After',    key: 'costAfter',  fmt: 'amt', rebalOnly: true,
    value:       d => d.fundedYearQty * d.costPerBond,
    subValue:    d => d.excessQtyAfter * d.costPerBond,
    subDrillKey: 'gapCostAfter',
    total: true, totalFn: d => d.qtyAfter * d.costPerBond,
    drill: true, drillCond: v => typeof v === 'number' && v > 0 },

  { label: 'Qty Before',    key: 'qtyBefore',  fmt: 'qty', rebalOnly: true,
    value:    d => d.isBracketTarget ? d.fundedYearQty : d.qtyBefore,
    subValue: d => d.excessQtyBefore },

  { label: 'Qty After',     key: 'qtyAfter',   fmt: 'qty', rebalOnly: true,
    value:    d => d.isBracketTarget ? d.fundedYearQty : d.qtyAfter,
    subValue: d => d.excessQtyAfter,
    drill: true, drillCond: v => typeof v === 'number' && v > 0 },

  { label: 'Qty Delta',     key: 'qtyDelta',   fmt: 'sgn', rebalOnly: true,
    value:    d => d.isBracketTarget ? 0 : d.qtyAfter - d.qtyBefore,
    subValue: d => d.excessQtyAfter - d.excessQtyBefore },

  { label: 'Cash Delta',    key: 'cashDelta',  fmt: 'sgn', rebalOnly: true,
    value:    d => d.isBracketTarget ? 0 : -((d.qtyAfter - d.qtyBefore) * d.costPerBond),
    subValue: d => -((d.excessQtyAfter - d.excessQtyBefore) * d.costPerBond),
    subDrillKey: 'gapCashDelta',
    total: true, totalFn: d => -((d.qtyAfter - d.qtyBefore) * d.costPerBond),
    drill: true, drillCond: v => typeof v === 'number' && v !== 0 },

  // Build-only
  { label: 'Amount', key: 'amount', fmt: 'amt', buildOnly: true,
    value:       d => d.fundedYearAmt,
    subValue:    d => d.excessAmt,
    subDrillKey: 'gapAmount',
    total: true, totalFn: d => d.fundedYearAmt ?? 0,
    drill: true },

  { label: 'Cost',   key: 'cost',   fmt: 'amt', buildOnly: true,
    value:       d => d.fundedYearCost,
    subValue:    d => d.excessCost,
    subDrillKey: 'gapCost',
    total: true, totalFn: d => (d.fundedYearCost ?? 0) + (d.excessCost ?? 0),
    drill: true },

  { label: 'Qty',    key: 'qty',    fmt: 'qty', buildOnly: true,
    value:    d => d.fundedYearQty,
    subValue: d => d.excessQty,
    total: false },
];

function isBracket(d, mode) {
  return mode === 'rebal' ? !!d.isBracketTarget : d.excessQty > 0;
}

function isUpperBracket(d, summary, mode) {
  return mode === 'rebal'
    ? d.fundedYear === summary.brackets?.upperYear
    : d.fundedYear === summary.upperYear;
}

function cellHtml(col, v, ri, drillKey) {
  const s   = fmtCell(v, col.fmt);
  const cls = fmtCls(v, col.fmt);
  const align = (col.fmt !== 'str' && col.fmt !== 'fy') ? ' style="text-align:right"' : '';
  let attr = '';
  if (drillKey) {
    attr = ' class="drillable' + (cls ? ' ' + cls : '') + '" data-row="' + ri + '" data-col="' + drillKey + '"';
  } else if (cls) {
    attr = ' class="' + cls + '"';
  }
  return '<td' + attr + align + '>' + esc(s) + '</td>';
}

// renderTable: header + body + tfoot from COLS filtered by mode.
export function renderTable({ details, mode, summary }) {
  const cols = COLS.filter(c => mode === 'rebal' ? !c.buildOnly : !c.rebalOnly);

  const headerHTML = '<thead><tr>' +
    cols.map(c => '<th data-col="' + c.key + '" style="cursor:help">' + esc(c.label) + '</th>').join('') +
    '</tr></thead>';

  const bodyRows = details.map((d, ri) => {
    const bt    = isBracket(d, mode);
    const upper = bt && isUpperBracket(d, summary, mode);
    const noChg = mode === 'rebal' && !d.isBracketTarget && d.qtyAfter === d.qtyBefore;

    const mainCells = cols.map(col => {
      const v = col.value(d);
      let drillKey = null;
      if (col.drill) {
        const ok = col.drillCond ? col.drillCond(v, d) : (v != null && v !== 0);
        if (ok) drillKey = col.key;
      }
      return cellHtml(col, v, ri, drillKey);
    }).join('');
    let html = '<tr class="' + (bt ? 'bracket ' : '') + (noChg ? 'no-change' : '') + '">' + mainCells + '</tr>';

    if (bt) {
      const subCells = cols.map(col => {
        const sv = col.subValue ? col.subValue(d) : null;
        return cellHtml(col, sv, ri, col.subDrillKey ?? null);
      }).join('');
      const subRow = '<tr class="excess-subrow bracket">' + subCells + '</tr>';
      html = upper ? subRow + html : html + subRow;
    }
    return html;
  }).join('');

  const tfootCells = cols.map(col => {
    const align = (col.fmt !== 'str' && col.fmt !== 'fy') ? ' style="text-align:right"' : '';
    let s = '';
    if (col.key === 'cusip') {
      s = 'Total';
    } else if (col.total) {
      const fn = col.totalFn ?? (d => { const v = col.value(d); return typeof v === 'number' ? v : 0; });
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

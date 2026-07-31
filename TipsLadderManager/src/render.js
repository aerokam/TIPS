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
    value: d => d.cusip,       subValue: d => d.cusip,
    headerHTML: 'Funded Year<br><span style="font-weight:normal;opacity:0.7">CUSIP</span>' },
  { label: 'DARA / Maturity', key: 'maturity',    fmt: 'str',
    value: d => d.maturityStr, subValue: d => d.maturityStr,
    headerHTML: 'DARA<br><span style="font-weight:normal;opacity:0.7">Maturity</span>' },
  { label: 'Yield',       key: 'yield',       fmt: 'yld', buildOnly: true,
    value: d => d.yield, subValue: d => d.yield,
    headerHTML: '<span style="visibility:hidden">.</span><br><span style="font-weight:normal;opacity:0.7">Yield</span>' },
  // Rebalance-only
  // Excess sub-row = coverage delivered (≈ missing-years × DARA): excessAmt{Before,After} from
  // rebalance-lib (P+I − AMD net-out + block-LMI add-back), same rule as build's Amount column.
  { label: 'Amount Before', key: 'amtBefore', fmt: 'amt', rebalOnly: true, fyLevel: true,
    value:          d => d.araBeforeTotal ?? null,
    subValue:       d => d.excessAmtBefore ?? (d.excessQtyBefore != null ? d.excessQtyBefore * pi(d) : null),
    subDrillKeyFn:  d => d.isFuture30yCover ? 'future30yAmtBefore' : 'gapAmtBefore',
    total: true, totalFn: d => (d.araBeforeTotal ?? 0) + ((d.excessAmtBefore ?? (d.excessQtyBefore != null ? d.excessQtyBefore * pi(d) : 0)) || 0),
    drill: true, drillCond: (_v, d) => d.araBeforeTotal != null,
    headerHTML: 'Amt Before<br><span style="visibility:hidden">.</span>' },

  { label: 'Amount After',  key: 'amtAfter',  fmt: 'amt', rebalOnly: true, fyLevel: true,
    value:          d => d.araAfterTotal ?? null,
    subValue:       d => d.excessAmtAfter ?? (d.excessQtyAfter != null ? d.excessQtyAfter * pi(d) : null),
    subDrillKeyFn:  d => d.isFuture30yCover ? 'future30yAmtAfter' : 'gapAmtAfter',
    total: true, totalFn: d => (d.araAfterTotal ?? 0) + ((d.excessAmtAfter ?? (d.excessQtyAfter != null ? d.excessQtyAfter * pi(d) : 0)) || 0),
    drill: true, drillCond: (_v, d) => d.araAfterTotal != null,
    headerHTML: 'Amt After<br><span style="visibility:hidden">.</span>' },

  { label: 'Cost Before',   key: 'costBefore', fmt: 'amt', rebalOnly: true,
    value:          d => d.fundedYearQtyBefore != null && d.costPerBond != null ? d.fundedYearQtyBefore * d.costPerBond : null,
    subValue:       d => d.excessQtyBefore != null && d.costPerBond != null ? d.excessQtyBefore * d.costPerBond : null,
    subDrillKeyFn:  d => d.isFuture30yCover ? 'future30yCostBefore' : 'gapCostBefore',
    total: true, totalFn: d => (d.fundedYearQtyBefore != null && d.costPerBond != null ? d.fundedYearQtyBefore * d.costPerBond : 0)
      + (d.excessQtyBefore != null && d.costPerBond != null ? d.excessQtyBefore * d.costPerBond : 0),
    drill: true, drillCond: v => typeof v === 'number' && v > 0,
    headerHTML: 'Cost Before<br><span style="font-weight:normal;opacity:0.7">Cost Before</span>' },

  { label: 'Cost After',    key: 'costAfter',  fmt: 'amt', rebalOnly: true,
    value:          d => d.fundedYearQtyAfter != null && d.costPerBond != null ? d.fundedYearQtyAfter * d.costPerBond : null,
    subValue:       d => d.excessQtyAfter != null && d.costPerBond != null ? d.excessQtyAfter * d.costPerBond : null,
    subDrillKeyFn:  d => d.isFuture30yCover ? 'future30yCostAfter' : 'gapCostAfter',
    total: true, totalFn: d => (d.fundedYearQtyAfter != null && d.costPerBond != null ? d.fundedYearQtyAfter * d.costPerBond : 0)
      + (d.excessQtyAfter != null && d.costPerBond != null ? d.excessQtyAfter * d.costPerBond : 0),
    drill: true, drillCond: v => typeof v === 'number' && v > 0,
    headerHTML: 'Cost After<br><span style="font-weight:normal;opacity:0.7">Cost After</span>' },

  { label: 'Quantity Before',    key: 'qtyBefore',  fmt: 'qty', rebalOnly: true,
    value:    d => d.fundedYearQtyBefore,
    subValue: d => d.excessQtyBefore,
    total: true, totalFn: d => d.qtyBefore || 0,
    headerHTML: 'Qty Before<br><span style="font-weight:normal;opacity:0.7">Qty Before</span>' },

  { label: 'Quantity After',     key: 'qtyAfter',   fmt: 'qty', rebalOnly: true,
    value:    d => d.fundedYearQtyAfter,
    subValue: d => d.excessQtyAfter,
    subDrillKey: 'qtyAfter',
    total: true, totalFn: d => d.qtyAfter || 0,
    drill: true, drillCond: (_v, d) => (d.qtyAfter || 0) > 0,
    headerHTML: 'Qty After<br><span style="font-weight:normal;opacity:0.7">Qty After</span>' },

  // fundedYearQtyDelta/excessQtyDelta (not a plain After-minus-Before per bucket) are the actual
  // trade to place: for a bracket-target CUSIP, holdings are reallocated internally between the
  // funded and excess buckets at zero cost before either bucket is sized, so the same maturity is
  // never simultaneously bought in one bucket and sold in the other (3.0 §Named Quantities).
  { label: 'Quantity Delta',     key: 'qtyDelta',   fmt: 'sgn', rebalOnly: true,
    value:    d => d.fundedYearQtyDelta ?? null,
    subValue: d => d.excessQtyDelta ?? null,
    total: true, totalFn: d => (d.qtyAfter || 0) - (d.qtyBefore || 0),
    headerHTML: 'Qty Delta<br><span style="font-weight:normal;opacity:0.7">Qty Delta</span>' },

  { label: 'Cash Delta',    key: 'cashDelta',  fmt: 'sgn', rebalOnly: true,
    value:    d => d.fundedYearQtyDelta != null && d.costPerBond != null ? -(d.fundedYearQtyDelta * d.costPerBond) : null,
    subValue: d => d.excessQtyDelta != null && d.costPerBond != null ? -(d.excessQtyDelta * d.costPerBond) : null,
    subDrillKey: 'gapCashDelta',
    total: true, totalFn: d => (d.qtyAfter != null && d.qtyBefore != null && d.costPerBond != null) ? -((d.qtyAfter - d.qtyBefore) * d.costPerBond) : 0,
    drill: true, drillCond: v => typeof v === 'number' && v !== 0,
    headerHTML: 'Cash Delta<br><span style="font-weight:normal;opacity:0.7">Cash Delta</span>' },

  // Build-only
  { label: 'Amount', key: 'amount', fmt: 'amt', buildOnly: true, fyLevel: true,
    value:          d => d.fundedYearAmt,
    subValue:       d => d.excessAmt,
    subDrillKeyFn:  d => d.isFuture30yCover ? 'future30yAmt' : 'gapAmount',
    total: true, totalFn: d => (d.fundedYearAmt ?? 0) + (d.excessAmt ?? 0),
    drill: true, drillCond: () => true,
    headerHTML: 'Amount<br><span style="visibility:hidden">.</span>' },

  { label: 'Cost',   key: 'cost',   fmt: 'amt', buildOnly: true,
    value:          d => d.fundedYearCost,
    subValue:       d => d.excessCost,
    subDrillKeyFn:  d => d.isFuture30yCover ? 'future30yCost' : 'gapCost',
    total: true, totalFn: d => (d.fundedYearCost ?? 0) + (d.excessCost ?? 0),
    drill: true, drillCond: () => true,
    headerHTML: 'Cost<br><span style="font-weight:normal;opacity:0.7">Cost</span>' },

  { label: 'Quantity',    key: 'qty',    fmt: 'qty', buildOnly: true,
    value:    d => d.fundedYearQty,
    subValue: d => d.excessQty,
    total: true, totalFn: d => (d.fundedYearQty || 0) + (d.excessQty || 0),
    headerHTML: 'Qty<br><span style="font-weight:normal;opacity:0.7">Qty</span>' },
];

function isBracket(d, mode) {
  // Designated gap brackets stay rendered as brackets even at 0 excess (gap covered by PLI/LMI/AMD)
  // — the "*" + qty-0 excess sub-row remains, its drill explains the 0. Same rule for build and
  // rebalance, so a 0-excess bracket (e.g. 2036/2040 under high later-year DARA) shows in both.
  if (mode === 'rebal') return d.excessQtyBefore > 0 || d.excessQtyAfter > 0 || d.isGapBracket;
  return d.excessQty > 0 || d.isGapBracket;
}

function isUpperBracket(d, summary, mode) {
  return mode === 'rebal'
    ? d.fundedYear === summary.brackets?.upperYear
    : d.fundedYear === summary.upperYear;
}

// Which bracket/cover slot this funded-year group occupies, for the hover explainer's heading.
function bracketRoleLabel(fy, groupRows, mode, summary) {
  if (groupRows.some(d => d.isFuture30yCover)) {
    if (fy === summary.future30yLowerYear) return 'Lower cover year';
    if (fy === summary.future30yUpperYear) return 'Upper cover year';
    return 'Cover year';
  }
  if (mode === 'rebal') {
    const b = summary.brackets || {};
    if (summary.bracketMode === '3bracket' && summary.newLowerYear != null) {
      if (fy === b.lowerYear)        return 'Original lower bracket year';
      if (fy === summary.newLowerYear) return 'New lower bracket year';
      if (fy === b.upperYear)        return 'Upper bracket year';
    } else {
      if (fy === b.lowerYear) return 'Lower bracket year';
      if (fy === b.upperYear) return 'Upper bracket year';
    }
  } else {
    if (fy === summary.lowerYear) return 'Lower bracket year';
    if (fy === summary.upperYear) return 'Upper bracket year';
  }
  return 'Bracket year';
}

function bracketTipHTML(fy, groupRows, mode, summary) {
  const role = bracketRoleLabel(fy, groupRows, mode, summary);
  return `<b>${esc(role)}:</b>`
    + '<ul>'
    + '<li>The values in bold are the totals for the funded year. Amount (short for Annual Real Amount, or ARA) '
    + 'is only relevant at the funded year level, since it includes the interest paid this year by all TIPS in '
    + 'the ladder (click the Amount value to see the breakdown). Each other value in this row is the sum of the '
    + 'values for the TIPS that contribute to ARA for this funded year, which are in the non-italicized row(s) below.</li>'
    + '<li>Each non-italicized row shows values for a TIPS that contributes to ARA for this funded year. '
    + 'Click any underlined value to see how it is calculated.</li>'
    + '<li>The <i>italicized</i> row for this maturity year shows values for the excess TIPS that are held to '
    + 'contribute to the duration-matched coverage for the gap years or future 30Y TIPS (the latter is only '
    + 'relevant for ladders that extend beyond the current longest-maturity TIPS).</li>'
    + '</ul>';
}

// Inline per-year DARA input rendered inside the group header's merged toggle cell, immediately
// after the funded-year label (5.0 §Funded Year Group Header Row §DARA Input). `daraByYear`/
// `flaggedYears` are optional — omitted entirely (both null) when a caller has no DARA context at
// all (defensive default; every real call site now supplies them).
function daraInputHTML(fy, daraByYear, flaggedYears) {
  if (!daraByYear) return '';
  const val = daraByYear.get(fy);
  const flagged = !!flaggedYears?.has(fy);
  const flagHTML = flagged
    ? '<span class="fy-dara-flag" title="Auto-set to median: holdings suggest bracket excess. '
      + 'Adjust if this year is intended for higher income." style="color:#d97706;cursor:help;font-size:11px;margin-left:2px">⚠</span>'
    : '';
  const displayVal = val != null && !isNaN(val) ? Math.round(val) : '';
  // The group header row's background is LIGHT (table.simple tr.fy-group-header td: #dce8e8,
  // #c0d8d8 for bracket years — 6.0 §Group Header Row Visual Style), not the dark teal used by the
  // top form card — so this needs a light-theme input (white bg, dark text), the same style the
  // old standalone per-year DARA panel's row inputs used, not a translucent-dark/white-text combo.
  return ' <span class="fy-dara-wrap" style="font-weight:normal">'
    + `<input type="number" class="fy-dara-input" data-year="${fy}" value="${displayVal}" step="1000" min="0" `
    + 'style="width:88px;font-size:12px;text-align:right;border:1px solid #7fa8a8;cursor:text;'
    + 'border-radius:3px;padding:2px 4px;font-variant-numeric:tabular-nums;background:#fff;color:#1e293b" '
    + 'onclick="event.stopPropagation()">'
    + flagHTML + '</span>';
}

function renderGroupHeader(cols, fy, rows, isBracketGroup, mode, summary, daraByYear, flaggedYears) {
  const groupRows  = rows.map(r => r.d);
  const labelCount = cols.filter(c => c.fmt === 'str' || c.fmt === 'yld').length;
  const valueCols  = cols.filter(c => c.fmt !== 'str' && c.fmt !== 'yld');
  const cls = 'fy-group-header' + (isBracketGroup ? ' bracket' : '');
  const gapSet = new Set(summary?.gapYears || []);
  const future30ySet = new Set(summary?.future30yYears || []);
  const suffix = gapSet.has(fy) ? ' <span style="opacity:0.6;font-style:italic;font-size:10px">(gap)</span>'
    : future30ySet.has(fy) ? ' <span style="opacity:0.6;font-style:italic;font-size:10px">(30Y)</span>' : '';
  const label = String(fy) + (isBracketGroup ? '*' : '');
  const daraHTML = daraInputHTML(fy, daraByYear, flaggedYears);
  const labelTd = isBracketGroup
    ? `<td colspan="${labelCount}"><span class="formula-var bracket-tip-target" data-tip-html="${encodeURIComponent(bracketTipHTML(fy, groupRows, mode, summary))}">${esc(label)}</span>${suffix}${daraHTML}</td>`
    : `<td colspan="${labelCount}">${esc(label)}${suffix}${daraHTML}</td>`;

  let html = `<tr class="${cls}" data-fy="${fy}" data-expanded="true">`;
  html += labelTd;
  for (const col of valueCols) {
    let agg = null, drillKey = null, drillRi = null;
    if (col.fyLevel) {
      // fyLevel: find first non-null/non-undefined row's value (not sum); track its ri for drill.
      // `!= null` (not `!== null`) so a field the row simply never set (undefined — e.g. an
      // After-side field on a pre-Run before-state row) is treated the same as an explicit null,
      // not mistaken for "found a real value".
      for (const { d, ri } of rows) {
        const v = col.value(d, 0, groupRows);
        if (v != null) { agg = v; drillRi = ri; break; }
      }
      if (col.drill && drillRi !== null) {
        const drillD = rows.find(r => r.ri === drillRi)?.d;
        const ok = col.drillCond ? col.drillCond(agg, drillD) : (agg != null && agg !== 0);
        if (ok) drillKey = col.key;
      }
    } else {
      agg = groupRows.reduce((acc, d) => { const v = col.value(d, 0, groupRows); return acc + (typeof v === 'number' ? v : 0); }, 0);
    }
    const s    = fmtCell(agg, col.fmt);
    const cls2 = fmtCls(agg, col.fmt);
    let attr = '';
    if (drillKey) {
      attr = ' class="drillable' + (cls2 ? ' ' + cls2 : '') + '" data-row="' + drillRi + '" data-col="' + drillKey + '"';
    } else if (cls2) {
      attr = ' class="' + cls2 + '"';
    }
    html += `<td${attr} style="text-align:right">${esc(s)}</td>`;
  }
  html += '</tr>';
  return html;
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

export function renderTable({ details, mode, summary, daraByYear = null, flaggedYears = null }) {
  const cols = COLS.filter(c => mode === 'rebal' ? !c.buildOnly : !c.rebalOnly);

  const headerHTML = '<thead><tr>' +
    cols.map(c => '<th data-col="' + c.key + '">' + (c.headerHTML || esc(c.label)) + '</th>').join('') +
    '</tr></thead>';

  // Group consecutive rows by fundedYear
  const groups = [];
  for (const [ri, d] of details.entries()) {
    if (!groups.length || groups[groups.length - 1].fy !== d.fundedYear) {
      groups.push({ fy: d.fundedYear, rows: [{ d, ri }] });
    } else {
      groups[groups.length - 1].rows.push({ d, ri });
    }
  }

  // Every year in [firstYear, lastYear] gets its own group header row — including gap years and
  // Future 30Y years, which have no TIPS row of their own but still need a row to host the DARA
  // input (5.0 §Funded Year Group Header Row §DARA Input; 6.0 §Per-Year DARA (Table-Integrated)
  // §Year list). Insert an empty-rows placeholder group for any in-range year `details` didn't
  // already produce a group for.
  if (summary?.firstYear != null && summary?.lastYear != null) {
    const byYear = new Map(groups.map(g => [g.fy, g]));
    const merged = [];
    for (let y = summary.firstYear; y <= summary.lastYear; y++) {
      merged.push(byYear.get(y) ?? { fy: y, rows: [] });
      byYear.delete(y);
    }
    // Any group whose fy fell outside [firstYear, lastYear] (e.g. a Future 30Y cover CUSIP beyond
    // lastYear) is preserved in its original relative position rather than dropped.
    for (const g of groups) if (byYear.has(g.fy)) merged.push(g);
    groups.length = 0;
    groups.push(...merged);
  }

  const bodyRows = groups.map(({ fy, rows }) => {
    const isBracketGroup = rows.some(({ d }) => isBracket(d, mode));
    let html = renderGroupHeader(cols, fy, rows, isBracketGroup, mode, summary, daraByYear, flaggedYears);

    for (const { d, ri } of rows) {
      const bt    = isBracket(d, mode);
      const upper = bt && isUpperBracket(d, summary, mode);
      const noChg = mode === 'rebal' && d.qtyAfter === d.qtyBefore && d.excessQtyAfter === d.excessQtyBefore;

      const mainCells = cols.map(col => {
        if (col.fyLevel) return '<td></td>';
        const v = col.value(d, ri, details);
        let drillKey = null;
        if (col.drill) {
          const ok = col.drillCond ? col.drillCond(v, d) : (v != null && v !== 0);
          if (ok) drillKey = col.key;
        }
        return cellHtml(col, v, ri, drillKey);
      }).join('');

      const rowCls = 'fy-child' + (bt ? ' bracket' : '') + (noChg ? ' no-change' : '');
      let rowHtml = `<tr data-ri="${ri}" data-fy="${fy}" class="${rowCls}">${mainCells}</tr>`;

      if (bt) {
        const subCells = cols.map(col => {
          const sv = col.subValue ? col.subValue(d, ri, details) : null;
          // Never mark a blank/null sub-cell drillable — unlike the main row above (which already
          // guards this via drillCond), a subDrillKey was applied unconditionally regardless of
          // whether the sub-row actually has a value, so an empty After-side sub-cell (e.g.
          // qtyAfter/cashDelta on a pre-Run before-state row, where After data doesn't exist yet)
          // rendered as an invisible-but-clickable drillable cell that opened a NaN-filled popup.
          const sdk = sv != null ? (col.subDrillKeyFn ? col.subDrillKeyFn(d) : (col.subDrillKey ?? null)) : null;
          return cellHtml(col, sv, ri, sdk);
        }).join('');
        const subRow = `<tr data-ri="${ri}" data-sub="1" data-fy="${fy}" class="fy-child excess-subrow bracket">${subCells}</tr>`;
        rowHtml = upper ? subRow + rowHtml : rowHtml + subRow;
      }

      html += rowHtml;
    }
    return html;
  }).join('');

  const tfootCells = cols.map(col => {
    const align = col.fmt !== 'str' ? ' style="text-align:right"' : '';
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

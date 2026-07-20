// shared/src/date-range-filter.js
// Reusable date range filter manager for table applications.
// Projects/CLAUDE.md §2a: single source of truth for date range filtering logic.

import { initDatePicker } from './date-picker.js';

/**
 * Manages date range filtering for data tables with column-based date filters.
 * @param {Object} config
 * @param {string} config.popperId - ID of the popover element
 * @param {string} config.fromInputId - ID of the "from" date input
 * @param {string} config.toInputId - ID of the "to" date input
 * @param {string} config.titleId - ID of the popover title element
 * @param {string} config.doneButtonId - ID of the "Done" button
 * @param {string} config.clearButtonId - ID of the "Clear" button
 * @param {(field: string, from: string, to: string) => void} config.onApply - Called when range is applied
 */
export function createDateRangeFilter(config) {
  const popover = document.getElementById(config.popperId);
  const fromInput = document.getElementById(config.fromInputId);
  const toInput = document.getElementById(config.toInputId);
  const titleEl = document.getElementById(config.titleId);
  const doneBtn = document.getElementById(config.doneButtonId);
  const clearBtn = document.getElementById(config.clearButtonId);

  let currentField = null;
  let ranges = {};

  // Initialize date pickers
  initDatePicker(fromInput);
  initDatePicker(toInput);

  function open(field, fieldLabel, anchorEl) {
    currentField = field;
    const range = ranges[field] || {};
    titleEl.textContent = fieldLabel + ' range';
    fromInput.value = range.from || '';
    toInput.value = range.to || '';

    popover.style.display = 'flex';
    const rect = anchorEl.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    let left = rect.left;
    if (left + popRect.width > window.innerWidth - 8) {
      left = window.innerWidth - popRect.width - 8;
    }
    popover.style.left = Math.max(8, left) + 'px';
    popover.style.top = (rect.bottom + 4) + 'px';
  }

  function close() {
    currentField = null;
    popover.style.display = 'none';
  }

  function getDateRange(field) {
    return ranges[field] || {};
  }

  function setDateRange(field, from, to) {
    if (!from && !to) {
      delete ranges[field];
    } else {
      ranges[field] = { from, to };
    }
  }

  function getAllRanges() {
    return ranges;
  }

  // Event listeners
  doneBtn.addEventListener('click', () => {
    if (!currentField) return;
    const from = fromInput.value;
    const to = toInput.value;
    setDateRange(currentField, from, to);
    config.onApply(currentField, from, to);
    close();
  });

  clearBtn.addEventListener('click', () => {
    if (!currentField) return;
    setDateRange(currentField, '', '');
    fromInput.value = '';
    toInput.value = '';
    config.onApply(currentField, '', '');
    close();
  });

  document.addEventListener('click', (e) => {
    if (popover.style.display === 'flex' && e.target === popover) {
      close();
    }
  });

  return {
    open,
    close,
    getDateRange,
    setDateRange,
    getAllRanges,
    isOpen: () => currentField !== null,
    getCurrentField: () => currentField,
  };
}

// Presentation-only tooltips for the compact Receipt Encoding summary badges.
// Keep the existing visible/dynamic state text for no-CSS fallback and screen readers.
// The tooltip controls sit inside <summary>; cancel their activation so tapping an
// indicator does not also open/close the receipt editor.
export const statusTooltipText = Object.freeze({
  consumed: 'Consumed — Previously exported.',
  onHold: 'On Hold — Excluded from optimization, manual selection and export.',
  newReceipt: 'New, unsaved — Save to preserve this receipt.',
  unsaved: 'Unsaved changes — Save to preserve your edits.',
  outsideRange: 'Outside the selected amount range.',
  outsideFilters: 'Outside the current filters.'
});

export function setReceiptStatusTooltip(indicator, description) {
  if (!indicator) return;
  indicator.dataset.tooltip = description;
  indicator.setAttribute('aria-label', description);
  indicator.classList.remove('is-tooltip-open');
}

export function installReceiptSummaryTooltips(row) {
  const indicators = [...row.querySelectorAll('.summary-flags > .receipt-status-icon')];
  const closeAll = () => indicators.forEach(indicator => indicator.classList.remove('is-tooltip-open'));
  const toggle = indicator => {
    const wasOpen = indicator.classList.contains('is-tooltip-open');
    closeAll();
    if (!wasOpen && !indicator.hidden) indicator.classList.add('is-tooltip-open');
  };
  indicators.forEach(indicator => {
    indicator.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      toggle(indicator);
    });
    indicator.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeAll();
        indicator.blur?.();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        toggle(indicator);
      }
    });
    indicator.addEventListener('blur', () => indicator.classList.remove('is-tooltip-open'));
  });
  row.addEventListener('toggle', closeAll);
}

// Accessible naming helpers for receipt rows.
const pesos = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Names every receipt summary uniquely (stable receipt identity, store, amount, state) so screen-reader users can tell them apart.
export function receiptSummaryAccessibleName({ id, store = '', amountCents = null, status = 'available', open = false }) {
  const parts = [`Receipt ${id}`, String(store).trim() || 'no store name'];
  if (Number.isFinite(amountCents)) parts.push(`${pesos.format(amountCents / 100)} pesos`);
  if (status === 'consumed') parts.push('consumed');
  parts.push(open ? 'collapse details' : 'show details');
  return parts.join(', ');
}

// Cloned templates must not repeat ids: every id inside `root` gets `-suffix`, and references to it inside `root` are updated.
export function makeTemplateIdsUnique(root, suffix) {
  const renamed = new Map();
  root.querySelectorAll('[id]').forEach(element => {
    const next = `${element.id}-${suffix}`;
    renamed.set(element.id, next);
    element.id = next;
  });
  ['aria-labelledby', 'aria-describedby', 'aria-controls'].forEach(attribute => root.querySelectorAll(`[${attribute}]`).forEach(element => {
    const value = element.getAttribute(attribute).split(/\s+/).map(token => renamed.get(token) ?? token).join(' ');
    element.setAttribute(attribute, value);
  }));
  return renamed;
}

// Pure rules for Manual Selection (CP10-C3E-4): which saved receipts can be picked, in what order, how many, and what the selection adds up to.
// Receipts are identified ONLY by their database id (never by position or display number), and the selection is an ordered array of unique ids: the order in
// which the receipts were picked is the initial export order. Nothing here touches the DOM, storage or the database.
import { summarizeAmounts } from './exportArrangement.js';

export const maximumManualSelection = 100;

// A receipt can be picked only when it is a saved receipt (it has a database id) AND its status is exactly 'available'. Unsaved drafts, Consumed receipts and
// any unknown or missing status cannot ('unavailable').
export const manualEligibility = ({ dbId, status } = {}) => !dbId ? 'unsaved' : status === 'available' ? 'ok' : status === 'consumed' ? 'consumed' : 'unavailable';
export const isManuallySelectable = receipt => manualEligibility(receipt) === 'ok';

export const manualLimitMessage = (maximum = maximumManualSelection) => `You can select up to ${maximum} receipts for one export. Deselect a receipt before adding another.`;

// Adds an id at the END of the selection. A receipt that is already selected is left where it is.
export function addManual(ids, id, maximum = maximumManualSelection) {
  if (ids.includes(id)) return { ids, changed: false, rejected: null };
  if (ids.length >= maximum) return { ids, changed: false, rejected: 'limit' };
  return { ids: [...ids, id], changed: true, rejected: null };
}

export const removeManual = (ids, id) => ids.includes(id) ? { ids: ids.filter(candidate => candidate !== id), changed: true } : { ids, changed: false };

// Toggling off and on again moves the receipt to the end of the order.
export function toggleManual(ids, id, maximum = maximumManualSelection) {
  if (ids.includes(id)) return { ...removeManual(ids, id), action: 'removed', rejected: null };
  return { ...addManual(ids, id, maximum), action: 'added' };
}

// Select Shown: appends the shown receipts that are not already selected, in the order shown. All or nothing: if the result would pass the limit, nothing at all is
// added (no partial selection), and the reply says how many were needed.
export function selectShown(ids, shownIds, maximum = maximumManualSelection) {
  const fresh = [...new Set(shownIds)].filter(id => !ids.includes(id));
  if (!fresh.length) return { ids, added: [], rejected: null };
  if (ids.length + fresh.length > maximum) return { ids, added: [], rejected: { needed: fresh.length, selected: ids.length, available: Math.max(0, maximum - ids.length), maximum } };
  return { ids: [...ids, ...fresh], added: fresh, rejected: null };
}

export const bulkLimitMessage = ({ needed, selected, available, maximum }) =>
  `Selecting the ${needed} shown receipt${needed === 1 ? '' : 's'} that ${needed === 1 ? 'is' : 'are'} not selected yet would pass the limit of ${maximum} (${selected} already selected, room for ${available} more). Nothing was selected; narrow the filters or deselect some receipts first.`;

// Drops ids that are no longer eligible (deleted, Consumed, or missing locally). Returns what was removed so it can be reported, never silently.
export function pruneManual(ids, isEligible) {
  const kept = ids.filter(isEligible);
  return kept.length === ids.length ? { ids, removed: [] } : { ids: kept, removed: ids.filter(id => !kept.includes(id)) };
}

export const hiddenSelectedCount = (ids, visibleIds) => { const visible = new Set(visibleIds); return ids.filter(id => !visible.has(id)).length; };

// Count, receipts without an amount (a blank saved amount is valid and is NOT zero) and the exact sum of the real amounts in integer centavos.
export function summarizeManual(ids, savedById) {
  const summary = summarizeAmounts(ids.map(id => savedById.get(id) ?? { amount: '' }));
  if (!Number.isSafeInteger(summary.validCents)) throw new RangeError('The selected amounts exceed the supported range.');
  return summary;
}

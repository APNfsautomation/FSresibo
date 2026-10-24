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

// Select Shown: walks the shown receipts IN THE ORDER GIVEN (the visible sort order), skips ids that are already selected (and duplicates), and appends new ids
// until the selection reaches the maximum. Existing selections, hidden ones included, keep their positions. Never exceeds the maximum.
export function fillShown(ids, shownIds, maximum = maximumManualSelection) {
  const fresh = [...new Set(shownIds)].filter(id => !ids.includes(id));
  const room = Math.max(0, maximum - ids.length);
  const added = fresh.slice(0, room);
  const next = added.length ? [...ids, ...added] : ids;
  return { ids: next, added, notAdded: fresh.length - added.length, alreadySelected: new Set(shownIds).size - fresh.length, wasFull: room === 0, nowFull: next.length >= maximum };
}

export const selectionFullMessage = (maximum = maximumManualSelection) => `The selection is full (${maximum} of ${maximum}). Deselect a receipt to make room before adding more.`;

export function fillShownMessage(result, maximum = maximumManualSelection) {
  const { added, notAdded, wasFull, ids } = result;
  if (wasFull && notAdded) return selectionFullMessage(maximum);
  if (!added.length) return 'Every selectable receipt shown is already selected.';
  const plural = added.length === 1 ? '' : 's';
  const head = `${added.length} receipt${plural} added in the order shown.`;
  if (notAdded) return `${head} The selection is now full at ${maximum} of ${maximum}; ${notAdded} more shown receipt${notAdded === 1 ? ' was' : 's were'} not added.`;
  return `${head} ${ids.length} of ${maximum} selected.`;
}

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

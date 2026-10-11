// Presentation-only helpers for Receipt Encoding (edit pins, the available summary note, the out-of-range notice).
// Nothing here reads or writes receipts, storage or the database.
import { parseMoneyAmount } from '../domain/moneyAmount.js';

const text = value => String(value ?? '').trim();
const savedTextFields = Object.freeze(['receiptDate', 'vat', 'invoice', 'store', 'address', 'tin']);

// True when the typed values differ from the persisted receipt (or the receipt was never saved and has content).
// Amounts compare as exact centavos, so "1,250.50" and a saved 1250.5 are the same amount.
export function receiptHasUnsavedChanges(values, saved) {
  if (!saved) return Object.values(values).some(value => text(value));
  if (savedTextFields.some(key => text(values[key]) !== text(saved[key]))) return true;
  const typed = parseMoneyAmount(values.amount); const stored = parseMoneyAmount(saved.amount);
  if (typed.blank || stored.blank) return Boolean(typed.blank) !== Boolean(stored.blank);
  if (typed.valid && stored.valid) return typed.cents !== stored.cents;
  return text(values.amount) !== text(saved.amount);
}

export function outsideRangeNotice(receiptIds, rangeLabel) {
  const range = rangeLabel ? ` (${rangeLabel})` : '';
  if (receiptIds.length === 1) return `Receipt ${receiptIds[0]} is outside the selected amount range${range} and stays visible only while you edit it.`;
  return `${receiptIds.length} receipts are outside the selected amount range${range} and stay visible only while you edit them.`;
}

export function releasedHiddenNotice(receiptIds) {
  if (!receiptIds.length) return '';
  return receiptIds.length === 1
    ? `Receipt ${receiptIds[0]} is outside the selected amount range and is now hidden. Use the Amount range filter to see it.`
    : `${receiptIds.length} receipts outside the selected amount range are now hidden. Use the Amount range filter to see them.`;
}

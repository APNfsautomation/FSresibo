// Pure helpers for the receipt export integrity checks (CP10-C3E-1). No DOM, storage or network access.
// "Workbook fields" are exactly the receipt values that reach the Expense Detailed Report, so a difference in any of them is a difference in the workbook.
import { parseMoneyAmount } from './moneyAmount.js';

export const workbookFieldNames = Object.freeze(['receiptDate', 'store', 'address', 'vat', 'tin', 'invoice', 'amount']);
export const exportFieldLabels = Object.freeze({
  receiptDate: 'Receipt date', store: 'Store name', address: 'Store address', vat: 'VAT status', tin: 'TIN', invoice: 'Invoice number', amount: 'Amount', updatedAt: 'Last updated'
});

const exactText = value => String(value ?? '');

// Amounts compare by meaning, not by typed text: "1,250.50" equals a stored 1250.5, but a blank amount never equals zero.
export function amountIdentity(raw) {
  const parsed = parseMoneyAmount(raw);
  if (parsed.blank) return 'blank';
  if (!parsed.valid) return `invalid:${exactText(raw).trim()}`;
  return `cents:${parsed.cents}`;
}

// Text is compared exactly (the workbook writes it untrimmed); only a missing value and an empty string are the same thing.
export const workbookFields = receipt => Object.fromEntries(workbookFieldNames.map(name => [name, name === 'amount' ? receipt?.amount ?? '' : exactText(receipt?.[name])]));

export function changedWorkbookFields(before, after, { includeUpdatedAt = true } = {}) {
  const changed = workbookFieldNames.filter(name => name === 'amount'
    ? amountIdentity(before?.amount) !== amountIdentity(after?.amount)
    : exactText(before?.[name]) !== exactText(after?.[name]));
  if (includeUpdatedAt && exactText(before?.updatedAt) !== exactText(after?.updatedAt)) changed.push('updatedAt');
  return changed;
}

// entries: [{ dbId, label, used? }] in export order. snapshotRows: receipts freshly read from the database.
// reference: receipts the user already knows (locally saved values, or an earlier snapshot), by dbId.
// used: values the optimizer calculated with; only the amount decides whether the optimizer result still applies.
export function classifyExportSnapshot({ entries, snapshotRows, reference = new Map() }) {
  const byId = new Map(snapshotRows.map(row => [row.dbId, row]));
  const problems = [];
  for (const entry of entries) {
    const row = byId.get(entry.dbId);
    if (!row) { problems.push({ type: 'missing', dbId: entry.dbId, label: entry.label }); continue; }
    if (row.status !== 'available') { problems.push({ type: 'unavailable', dbId: entry.dbId, label: entry.label }); continue; }
    if (parseMoneyAmount(row.amount).valid === false) problems.push({ type: 'invalidAmount', dbId: entry.dbId, label: entry.label });
    if (entry.used && amountIdentity(entry.used.amount) !== amountIdentity(row.amount)) problems.push({ type: 'optimizerChanged', dbId: entry.dbId, label: entry.label });
    const known = reference.get(entry.dbId);
    const fields = known ? changedWorkbookFields(known, row) : [];
    if (fields.length) problems.push({ type: 'changed', dbId: entry.dbId, label: entry.label, fields });
  }
  return { ok: problems.length === 0, problems };
}

// After the status update: did the database return different workbook values than the ones that were exported?
export function exportDrift(exportedRows, returnedRows) {
  const returned = new Map(returnedRows.map(row => [row.dbId, row]));
  return exportedRows.flatMap(row => {
    const after = returned.get(row.dbId);
    const fields = after ? changedWorkbookFields(row, after, { includeUpdatedAt: false }) : [];
    return fields.length ? [{ dbId: row.dbId, fields }] : [];
  });
}

// ---- Review & Arrange (CP10-C3E-2): pure helpers for the temporary export order and the review summary ----

export const sameMembers = (first, second) => first.length === second.length && new Set(first).size === first.length && first.every(id => second.includes(id));

// Moves one id to a position (clamped). Returns a new array; the member set never changes.
export function moveId(order, id, toIndex) {
  const from = order.indexOf(id);
  if (from < 0) return [...order];
  const target = Math.max(0, Math.min(order.length - 1, toIndex));
  const next = order.filter(candidate => candidate !== id);
  next.splice(target, 0, id);
  return next;
}
export const moveBy = (order, id, delta) => moveId(order, id, order.indexOf(id) + delta);

// Count, receipts with no amount, and the sum of the valid amounts in exact centavos. A missing amount is never counted as zero; an explicit 0 is a valid amount.
export function summarizeAmounts(rows) {
  let withoutAmount = 0; let validCents = 0;
  for (const row of rows) {
    const parsed = parseMoneyAmount(row.amount);
    if (parsed.blank) withoutAmount += 1;
    else if (parsed.valid) validCents += parsed.cents;
  }
  return { count: rows.length, withoutAmount, validCents };
}

// Problems that can never be acknowledged away: the receipt is gone or Consumed, its saved amount is invalid, or the amount differs from what the
// optimizer used (so the result must be recalculated). Only other workbook fields changing on a still-Available receipt can be reviewed and acknowledged.
export function partitionExportProblems(problems) {
  const soft = problems.filter(problem => problem.type === 'changed' && !problem.fields.includes('amount'));
  return { hard: problems.filter(problem => !soft.includes(problem)), soft };
}

// What changed, for display: [{ field, label, before, after }] using the same labels as the export messages.
export function describeFieldChanges(before, after, fields) {
  const show = (receipt, field) => exactText(receipt?.[field]);
  return fields.map(field => ({ field, label: exportFieldLabels[field] ?? field, before: show(before, field), after: show(after, field) }));
}

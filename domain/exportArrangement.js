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

import assert from 'node:assert/strict';
import test from 'node:test';
import { amountIdentity, changedWorkbookFields, classifyExportSnapshot, exportDrift, workbookFields } from '../domain/exportArrangement.js';

const saved = (extra = {}) => ({ dbId: 'r1', status: 'available', amount: 1250.5, receiptDate: '2026-08-03', store: 'Mercury Drug', address: '1 Main St', tin: '000-111', vat: 'VAT', invoice: 'INV-1', updatedAt: 't1', ...extra });

test('amount identity keeps blank, zero, valid and invalid apart, and ignores typing format only', () => {
  assert.equal(amountIdentity('1,250.50'), amountIdentity(1250.5));
  assert.equal(amountIdentity('1250.5'), amountIdentity('1250.50'));
  assert.notEqual(amountIdentity(''), amountIdentity(0), 'a blank amount is never the same as zero');
  assert.notEqual(amountIdentity(null), amountIdentity('0.00'));
  assert.equal(amountIdentity('  '), 'blank');
  assert.match(amountIdentity('12,34.50'), /^invalid:/);
  assert.notEqual(amountIdentity('100'), amountIdentity('100.01'));
});

test('every workbook-relevant field is detected when it changes, and nothing else is reported', () => {
  assert.deepEqual(changedWorkbookFields(saved(), saved()), []);
  for (const [field, value] of Object.entries({ amount: 1250.51, receiptDate: '2026-08-04', store: 'Other', address: '2 Main St', tin: '999', vat: 'Non-VAT', invoice: 'INV-2' })) {
    assert.deepEqual(changedWorkbookFields(saved(), saved({ [field]: value })), [field], `${field} change is detected`);
  }
  assert.deepEqual(changedWorkbookFields(saved(), saved({ updatedAt: 't2' })), ['updatedAt']);
  assert.deepEqual(changedWorkbookFields(saved(), saved({ updatedAt: 't2' }), { includeUpdatedAt: false }), []);
});

test('text that would look different in the workbook is a change; an equal amount typed another way is not', () => {
  assert.deepEqual(changedWorkbookFields(saved(), saved({ store: ' Mercury Drug' })), ['store'], 'the workbook writes the store untrimmed');
  assert.deepEqual(changedWorkbookFields(saved({ address: undefined }), saved({ address: '' })), [], 'a missing value and an empty value are the same cell');
  assert.deepEqual(changedWorkbookFields(saved({ amount: '1,250.50' }), saved({ amount: 1250.5 })), []);
  assert.deepEqual(changedWorkbookFields(saved({ amount: '' }), saved({ amount: 0 })), ['amount'], 'blank to zero changes the workbook cell');
  assert.deepEqual(changedWorkbookFields(saved({ amount: 0 }), saved({ amount: '' })), ['amount']);
});

test('workbookFields keeps the typed amount text and normalizes missing text to empty', () => {
  assert.deepEqual(workbookFields({ amount: '1,250.50', store: 'A' }), { receiptDate: '', store: 'A', address: '', vat: '', tin: '', invoice: '', amount: '1,250.50' });
});

const entries = [{ dbId: 'r1', label: 'Receipt 1', used: { amount: '1,250.50' } }, { dbId: 'r2', label: 'Receipt 2', used: { amount: '300' } }];
const reference = rows => new Map(rows.map(row => [row.dbId, row]));

test('an unchanged, available selection passes', () => {
  const rows = [saved(), saved({ dbId: 'r2', amount: 300 })];
  assert.deepEqual(classifyExportSnapshot({ entries, snapshotRows: rows, reference: reference(rows) }), { ok: true, problems: [] });
});

test('a missing receipt, a Consumed receipt and an invalid amount are reported with the receipt that caused them', () => {
  const rows = [saved({ status: 'consumed' })];
  const result = classifyExportSnapshot({ entries, snapshotRows: rows, reference: reference(rows) });
  assert.deepEqual(result.problems.map(({ type, dbId }) => [type, dbId]), [['unavailable', 'r1'], ['missing', 'r2']]);
  const invalid = classifyExportSnapshot({ entries: [entries[0]], snapshotRows: [saved({ amount: '12,34.50' })], reference: new Map() });
  assert.deepEqual(invalid.problems.map(problem => problem.type), ['invalidAmount', 'optimizerChanged']);
});

test('an amount that differs from the one the optimizer used makes the result stale', () => {
  const rows = [saved({ amount: 1250.6 }), saved({ dbId: 'r2', amount: 300 })];
  const result = classifyExportSnapshot({ entries, snapshotRows: rows, reference: new Map() });
  assert.deepEqual(result.problems.map(({ type, dbId }) => [type, dbId]), [['optimizerChanged', 'r1']]);
});

test('a changed field is reported by name against the reference, including the updated timestamp', () => {
  const before = [saved(), saved({ dbId: 'r2', amount: 300 })];
  const now = [saved({ store: 'Renamed', updatedAt: 't2' }), saved({ dbId: 'r2', amount: 300 })];
  const result = classifyExportSnapshot({ entries, snapshotRows: now, reference: reference(before) });
  assert.deepEqual(result.problems, [{ type: 'changed', dbId: 'r1', label: 'Receipt 1', fields: ['store', 'updatedAt'] }]);
});

test('blank, zero and positive amounts all pass; blank and zero stay distinct when compared with what the optimizer used', () => {
  const rows = [saved({ amount: '' }), saved({ dbId: 'r2', amount: 0 })];
  const open = classifyExportSnapshot({ entries: [{ dbId: 'r1', label: 'Receipt 1' }, { dbId: 'r2', label: 'Receipt 2' }], snapshotRows: rows, reference: reference(rows) });
  assert.equal(open.ok, true);
  const mismatch = classifyExportSnapshot({ entries: [{ dbId: 'r1', label: 'Receipt 1', used: { amount: 0 } }], snapshotRows: [saved({ amount: '' })], reference: new Map() });
  assert.deepEqual(mismatch.problems.map(problem => problem.type), ['optimizerChanged']);
});

test('drift after the status update lists only receipts whose workbook values differ from what was exported', () => {
  const exported = [saved({ amount: '1250.50' }), saved({ dbId: 'r2', amount: '300.00' })];
  const returned = [saved({ status: 'consumed', updatedAt: 't9' }), saved({ dbId: 'r2', amount: 300, invoice: 'CHANGED', status: 'consumed' })];
  assert.deepEqual(exportDrift(exported, returned), [{ dbId: 'r2', fields: ['invoice'] }]);
  assert.deepEqual(exportDrift(exported, [returned[0]]), [], 'a missing returned row is not drift (the status update itself reports it)');
});

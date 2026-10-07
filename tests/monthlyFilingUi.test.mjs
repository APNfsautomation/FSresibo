import assert from 'node:assert/strict';
import test from 'node:test';
import { activeMonthlyFilingSnapshot, clearsSharedStoreAssociation, monthlyFilingExportFilename, monthlyFilingIsReadOnly, monthlyFilingProfileSnapshot, persistMonthlyFilingRows } from '../ui/monthlyFilingUi.js';

test('Company profile selection copies a transaction snapshot and retains sharedStoreId', () => {
  assert.deepEqual(monthlyFilingProfileSnapshot({ id: 'shared-1', storeName: 'Cafe', address: 'A', tin: '123', vat: 'VAT' }), { sharedStoreId: 'shared-1', store: 'Cafe', address: 'A', tin: '123', vat: 'VAT' });
});
test('manual Store, Address, or TIN changes clear the local Company association', () => {
  const original = { store: 'Cafe', address: 'A', tin: '123' };
  assert.equal(clearsSharedStoreAssociation(original, { ...original, address: 'B' }), true);
  assert.equal(clearsSharedStoreAssociation(original, original), false);
});
test('Archived Monthly Filing records remain read-only preparations', () => {
  assert.equal(monthlyFilingIsReadOnly({ status: 'archived' }), true);
  assert.equal(monthlyFilingIsReadOnly({ status: 'active' }), false);
});

test('Monthly Filing persistence stops on first error while retaining earlier new-row identities for update retry', async () => {
  const rows = [{ dataset: { monthlyId: '' } }, { dataset: { monthlyId: '' } }, { dataset: { monthlyId: '' } }];
  const calls = [];
  const first = await persistMonthlyFilingRows(rows, async (row, index) => {
    calls.push(row);
    if (row === rows[1]) throw new Error('save failed');
    row.dataset.monthlyId = 'created-a';
    return { dbId: 'created-a' };
  });
  assert.equal(first.error.message, 'save failed');
  assert.deepEqual(calls, [rows[0], rows[1]]);
  assert.equal(rows[0].dataset.monthlyId, 'created-a');
  assert.equal(rows[2].dataset.monthlyId, '');
  const retryCalls = [];
  await persistMonthlyFilingRows(rows.slice(0, 2), async row => { retryCalls.push(row.dataset.monthlyId ? 'update' : 'create'); return { dbId: row.dataset.monthlyId || 'created-b' }; });
  assert.deepEqual(retryCalls, ['update', 'create']);
});

test('an unsaved active row is removable locally while archived rows remain protected', () => {
  const records = [{ dbId: '', status: 'active' }, { dbId: 'archived-id', status: 'archived' }];
  records.splice(0, 1);
  assert.deepEqual(records, [{ dbId: 'archived-id', status: 'archived' }]);
  assert.equal(monthlyFilingIsReadOnly(records[0]), true);
});

test('only persisted Active Monthly Filing records form the export snapshot', () => {
  const snapshot = activeMonthlyFilingSnapshot([{ dbId: 'a', status: 'active' }, { dbId: 'b', status: 'archived' }, { dbId: '', status: 'active' }]);
  assert.deepEqual(snapshot.map(record => record.dbId), ['a']);
  assert.equal(monthlyFilingExportFilename(new Date('2026-10-07T00:00:00Z')), 'fsresibo-monthly-filing-2026-10-07.xlsx');
});

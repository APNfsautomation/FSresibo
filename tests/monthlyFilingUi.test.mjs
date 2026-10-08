import assert from 'node:assert/strict';
import test from 'node:test';
import { deduplicateDirectoryCandidates, postSaveDirectoryDecision } from '../domain/sharedStoreProfiles.js';
import { activeMonthlyFilingSnapshot, clearsSharedStoreAssociation, createMonthlyFilingLifecycleState, isBlankUnsavedMonthlyFilingRecord, monthlyFilingExportFilename, monthlyFilingIsReadOnly, monthlyFilingProfileSnapshot, persistMonthlyFilingRows, runMonthlyFilingExport, synchronizeMonthlyFilingRow } from '../ui/monthlyFilingUi.js';

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
    const saved = { dbId: 'created-a', sharedStoreId: 'shared-a', status: 'active' };
    synchronizeMonthlyFilingRow(row, saved);
    return saved;
  });
  assert.equal(first.error.message, 'save failed');
  assert.deepEqual(calls, [rows[0], rows[1]]);
  assert.equal(rows[0].dataset.monthlyId, 'created-a');
  assert.equal(rows[0].dataset.sharedStoreId, 'shared-a');
  assert.equal(rows[0].dataset.status, 'active');
  assert.equal(rows[2].dataset.monthlyId, '');
  const retryCalls = [];
  await persistMonthlyFilingRows(rows.slice(0, 2), async row => { retryCalls.push(row.dataset.monthlyId ? 'update' : 'create'); return { dbId: row.dataset.monthlyId || 'created-b' }; });
  assert.deepEqual(retryCalls, ['update', 'create']);
});

test('export lifecycle saves before generation, then archives exactly the generated snapshot', async () => {
  const calls = [];
  const snapshot = [{ dbId: 'a', status: 'active' }, { dbId: 'b', status: 'active' }];
  const result = await runMonthlyFilingExport({
    save: async () => { calls.push('save'); return true; }, snapshot: () => snapshot,
    generateWorkbook: records => { calls.push(['workbook', records.map(record => record.dbId)]); },
    archive: async ids => { calls.push(['archive', ids]); return snapshot.map(record => ({ ...record, status: 'archived' })); }
  });
  assert.equal(result.state, 'archived');
  assert.deepEqual(calls, ['save', ['workbook', ['a', 'b']], ['archive', ['a', 'b']]]);
});

test('save or workbook failure prevents archive, while archive failure is explicit', async () => {
  let archiveCalls = 0;
  const failedSave = await runMonthlyFilingExport({ save: async () => false, snapshot: () => [{ dbId: 'a', status: 'active' }], generateWorkbook() { throw new Error('must not generate'); }, archive: async () => { archiveCalls += 1; } });
  assert.equal(failedSave.state, 'save-failed');
  const failedWorkbook = await runMonthlyFilingExport({ save: async () => true, snapshot: () => [{ dbId: 'a', status: 'active' }], generateWorkbook() { throw new Error('xlsx failed'); }, archive: async () => { archiveCalls += 1; } });
  assert.equal(failedWorkbook.state, 'generation-failed');
  const failedArchive = await runMonthlyFilingExport({ save: async () => true, snapshot: () => [{ dbId: 'a', status: 'active' }], generateWorkbook() {}, archive: async () => { throw new Error('rpc failed'); } });
  assert.equal(failedArchive.state, 'archive-failed');
  assert.equal(archiveCalls, 0);
});

test('lifecycle state blocks concurrent export and clear, then requires reload after uncertain archive', () => {
  const lifecycle = createMonthlyFilingLifecycleState();
  assert.equal(lifecycle.beginExport(), true);
  assert.equal(lifecycle.beginExport(), false);
  assert.equal(lifecycle.clearBlocked(), true);
  lifecycle.finishExport();
  assert.equal(lifecycle.exportBlocked(), false);
  lifecycle.markArchiveUncertain();
  assert.equal(lifecycle.exportBlocked(), true);
  assert.equal(lifecycle.clearBlocked(), true);
  lifecycle.clearArchiveUncertain();
  assert.equal(lifecycle.exportBlocked(), false);
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

test('a completely blank new placeholder is skipped while a partial Monthly Filing row remains persistable', () => {
  const blank = { dbId: '', store: '', address: '', tin: '', vat: '', amount: '', receiptDate: '', invoice: '' };
  assert.equal(isBlankUnsavedMonthlyFilingRecord(blank), true);
  assert.equal(isBlankUnsavedMonthlyFilingRecord({ ...blank, invoice: 'OR-1' }), false);
  assert.equal(isBlankUnsavedMonthlyFilingRecord({ ...blank, dbId: 'saved-blank' }), false);
  assert.deepEqual(activeMonthlyFilingSnapshot([{ ...blank, status: 'active' }, { ...blank, dbId: 'persisted', status: 'active' }]).map(record => record.dbId), ['persisted']);
});

test('Monthly Filing uses the shared post-save directory governance for existing, ambiguous, and new candidates', () => {
  const values = { store: 'North Cafe', address: 'North Avenue', tin: '123-456', vat: 'VAT' };
  const existing = [{ id: 'north', storeName: 'North Cafe', address: 'North Avenue', tin: '123456' }];
  assert.equal(postSaveDirectoryDecision({ values, profiles: existing }).status, 'existing');
  assert.equal(postSaveDirectoryDecision({ values: { ...values, address: '', tin: '' }, profiles: [] }).status, 'ineligible');
  const ambiguous = [{ id: 'a', storeName: 'North Cafe', address: '', tin: '1' }, { id: 'b', storeName: 'North Cafe', address: '', tin: '2' }];
  assert.equal(postSaveDirectoryDecision({ values: { ...values, address: 'Different', tin: '' }, profiles: ambiguous }).status, 'ambiguous');
  const first = postSaveDirectoryDecision({ values, profiles: [] });
  const duplicate = postSaveDirectoryDecision({ values: { ...values, store: ' north  cafe ', tin: '123456' }, profiles: [] });
  assert.equal(first.status, 'new');
  assert.equal(deduplicateDirectoryCandidates([first, duplicate]).length, 1);
});

test('export remains automatic save-before-workbook and archive without a prior manual Save click', async () => {
  const calls = [];
  const result = await runMonthlyFilingExport({
    save: async () => { calls.push('auto-save'); return true; },
    snapshot: () => [{ dbId: 'saved-during-export', status: 'active' }],
    generateWorkbook: records => calls.push(`workbook:${records[0].dbId}`),
    archive: async ids => { calls.push(`archive:${ids.join(',')}`); return [{ dbId: ids[0], status: 'archived' }]; }
  });
  assert.equal(result.state, 'archived');
  assert.deepEqual(calls, ['auto-save', 'workbook:saved-during-export', 'archive:saved-during-export']);
});

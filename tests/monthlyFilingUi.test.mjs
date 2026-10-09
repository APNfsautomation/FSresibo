import assert from 'node:assert/strict';
import test from 'node:test';
import { deduplicateDirectoryCandidates, postSaveDirectoryDecision } from '../domain/sharedStoreProfiles.js';
import { activeMonthlyFilingSnapshot, clearsSharedStoreAssociation, createMonthlyFilingLifecycleState, createMonthlyFilingMutationState, directoryOutcomeFeedback, isBlankUnsavedMonthlyFilingRecord, matchingDirectoryEntries, monthlyFilingActiveExportCount, monthlyFilingExportFilename, monthlyFilingIsReadOnly, monthlyFilingProfileSnapshot, monthlyFilingRecordsForTab, monthlyFilingTabCounts, persistMonthlyFilingRows, reconcileArchivedMonthlyFilingDeletion, runMonthlyFilingExport, synchronizeMonthlyFilingRow } from '../ui/monthlyFilingUi.js';

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

test('live export eligibility counts typed nonblank Active rows while excluding blank placeholders and archived rows', () => {
  const blank = { dbId: '', status: 'active', store: '', address: '', tin: '', vat: '', amount: '', receiptDate: '', invoice: '' };
  assert.equal(monthlyFilingActiveExportCount([blank]), 0);
  assert.equal(monthlyFilingActiveExportCount([{ ...blank, amount: '500' }]), 1);
  assert.equal(monthlyFilingActiveExportCount([{ ...blank, amount: '500' }, { ...blank, dbId: 'archived', status: 'archived', amount: '100' }]), 1);
  assert.equal(monthlyFilingActiveExportCount([{ ...blank, dbId: 'saved', amount: '500' }, blank]), 1);
});

test('mixed directory decisions only associate rows carrying the matching new candidate', () => {
  const candidate = { storeName: 'TEST STORE', address: 'TEST ADDRESS', tin: '', vat: '' };
  const entries = [
    { id: 'no-store', decision: { status: 'ineligible' } },
    { id: 'unchanged', decision: { status: 'unchanged' } },
    { id: 'new-store', decision: { status: 'new', candidate } },
    { id: 'different', decision: { status: 'new', candidate: { ...candidate, storeName: 'OTHER STORE' } } }
  ];
  assert.deepEqual(matchingDirectoryEntries(entries, candidate).map(entry => entry.id), ['new-store']);
});

test('directory outcome feedback retains warnings and contribution results instead of replacing them with generic save feedback', () => {
  assert.match(directoryOutcomeFeedback([{ type: 'declined', message: 'Monthly Filing saved. Store kept only in Monthly Filing.' }]), /kept only/i);
  assert.match(directoryOutcomeFeedback([{ type: 'association-failed', message: 'Monthly Filing saved, but its Company Directory association could not be recorded: denied.' }]), /could not be recorded/i);
  assert.match(directoryOutcomeFeedback([{ type: 'contributed', message: 'Monthly Filing saved. Store added to the Company Directory.' }]), /added to the Company Directory/i);
});

test('Active and Archived views partition one Monthly Filing record set with accurate tab counts', () => {
  const records = [
    { dbId: 'active-saved', status: 'active', amount: '100' },
    { dbId: '', status: 'active', amount: '200' },
    { dbId: '', status: 'active', amount: '' },
    { dbId: 'archived-one', status: 'archived', amount: '300' }
  ];
  assert.deepEqual(monthlyFilingRecordsForTab(records, 'active').map(record => record.dbId), ['active-saved', '', '']);
  assert.deepEqual(monthlyFilingRecordsForTab(records, 'archived').map(record => record.dbId), ['archived-one']);
  assert.deepEqual(monthlyFilingTabCounts(records), { active: 2, archived: 1 });
  assert.deepEqual(activeMonthlyFilingSnapshot(records).map(record => record.dbId), ['active-saved']);
});

test('draft values retained in the Active local record survive a tab view change without persistence', () => {
  const records = [{ dbId: '', status: 'active', store: 'Draft Cafe', amount: '500', invoice: 'OR-7' }, { dbId: 'archived', status: 'archived', store: 'Old Cafe' }];
  const activeBefore = monthlyFilingRecordsForTab(records, 'active')[0];
  const archived = monthlyFilingRecordsForTab(records, 'archived');
  const activeAfter = monthlyFilingRecordsForTab(records, 'active')[0];
  assert.equal(archived.length, 1);
  assert.deepEqual(activeAfter, activeBefore);
  assert.equal(monthlyFilingActiveExportCount(records), 1);
});

test('clear Archived local-state transition preserves Active drafts, while Clear All intentionally removes both states', () => {
  const records = [{ dbId: '', status: 'active', store: 'Draft', amount: '100' }, { dbId: 'active', status: 'active', store: 'Saved' }, { dbId: 'archived', status: 'archived', store: 'Old' }];
  const afterClearArchived = records.filter(record => record.status !== 'archived');
  assert.deepEqual(afterClearArchived.map(record => record.status), ['active', 'active']);
  assert.equal(afterClearArchived[0].store, 'Draft');
  const afterClearAll = [];
  assert.deepEqual(afterClearAll, []);
});

test('one shared mutation guard blocks overlapping Save, Clear, Return, and Delete operations but permits Export internal Save', () => {
  const mutations = createMonthlyFilingMutationState();
  assert.equal(mutations.begin('save'), true);
  assert.equal(mutations.begin('clear-all'), false);
  assert.equal(mutations.begin('return-to-active'), false);
  assert.equal(mutations.begin('delete'), false);
  mutations.finish();
  assert.equal(mutations.begin('clear-archived'), true);
  assert.equal(mutations.begin('save'), false);
  assert.equal(mutations.begin('clear-all'), false);
  mutations.finish();
  assert.equal(mutations.begin('export'), true);
  assert.equal(mutations.permitsInternalExportSave(), true);
  mutations.finish();
  assert.equal(mutations.pending(), false);
  assert.equal(mutations.begin('clear-all'), true);
});

test('Archived deletion reconciliation removes only returned IDs and preserves Active changes, newer archives, and unsaved drafts', () => {
  const records = [
    { dbId: 'archived-confirmed', status: 'archived' },
    { dbId: 'changed-active', status: 'active' },
    { dbId: 'newly-archived', status: 'archived' },
    { dbId: '', status: 'active', store: 'Draft', amount: '1' }
  ];
  const reconciled = reconcileArchivedMonthlyFilingDeletion(records, ['archived-confirmed']);
  assert.deepEqual(reconciled.map(record => record.dbId), ['changed-active', 'newly-archived', '']);
  assert.equal(reconciled.at(-1).store, 'Draft');
});

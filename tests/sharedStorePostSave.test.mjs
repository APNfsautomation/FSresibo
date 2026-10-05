import assert from 'node:assert/strict';
import test from 'node:test';
import { deduplicateDirectoryCandidates, finalizeDirectoryPromptFingerprints, floatingAddVisibleForStatus, persistedStoreFingerprint, persistReceiptsBeforeDirectoryPrompts, postSaveDirectoryDecision } from '../ui/receiptUi.js';

const candidate = (overrides = {}) => ({ store: 'North Cafe', address: 'North Avenue', tin: '123-456', vat: 'VAT', ...overrides });
const companyProfiles = [{ id: 'north', storeName: 'North Cafe', address: 'North Avenue', tin: '123456' }];

test('a newly saved valid unknown store becomes a directory-prompt candidate', () => {
  assert.equal(postSaveDirectoryDecision({ values: candidate(), previousFingerprint: undefined, profiles: [] }).status, 'new');
});

test('store plus Address and store plus TIN each qualify, while a name-only store does not', () => {
  assert.equal(postSaveDirectoryDecision({ values: candidate({ tin: '' }), profiles: [] }).status, 'new');
  assert.equal(postSaveDirectoryDecision({ values: candidate({ address: '' }), profiles: [] }).status, 'new');
  assert.equal(postSaveDirectoryDecision({ values: candidate({ address: '', tin: '' }), profiles: [] }).status, 'ineligible');
});

test('an unchanged persisted store never becomes a second prompt candidate after a decline', () => {
  const values = candidate();
  assert.equal(postSaveDirectoryDecision({ values, previousFingerprint: persistedStoreFingerprint(values), profiles: [] }).status, 'unchanged');
});

test('a material Store, Address, or TIN change is eligible again after a prior decline', () => {
  const before = candidate();
  assert.equal(postSaveDirectoryDecision({ values: candidate({ address: 'South Avenue' }), previousFingerprint: persistedStoreFingerprint(before), profiles: [] }).status, 'new');
});

test('exact and uniquely compatible Company profiles do not prompt', () => {
  assert.equal(postSaveDirectoryDecision({ values: candidate(), profiles: companyProfiles }).status, 'existing');
  assert.equal(postSaveDirectoryDecision({ values: candidate({ tin: '' }), profiles: companyProfiles }).status, 'existing');
});

test('ambiguous Company profiles do not prompt or insert, but remain an explicit outcome', () => {
  const profiles = [{ id: 'one', storeName: 'North Cafe', address: '', tin: '1' }, { id: 'two', storeName: 'North Cafe', address: '', tin: '2' }];
  assert.equal(postSaveDirectoryDecision({ values: candidate({ address: 'New Avenue', tin: '' }), profiles }).status, 'ambiguous');
});

test('equivalent candidates from one Save operation are deduplicated', () => {
  const first = postSaveDirectoryDecision({ values: candidate(), profiles: [] });
  const second = postSaveDirectoryDecision({ values: candidate({ store: ' north  cafe ', tin: '123456' }), profiles: [] });
  assert.equal(deduplicateDirectoryCandidates([first, second]).length, 1);
});

test('receipt persistence completes before candidates can be processed for contribution', async () => {
  const calls = [];
  const result = await persistReceiptsBeforeDirectoryPrompts(['one', 'two'], async row => {
    calls.push(`save:${row}`);
    const values = candidate({ store: `Cafe ${row}` });
    return { row: { dataset: {} }, fingerprint: persistedStoreFingerprint(values), decision: postSaveDirectoryDecision({ values, profiles: [] }) };
  });
  calls.push(...result.candidates.map(item => `prompt:${item.candidate.storeName}`));
  assert.deepEqual(calls, ['save:one', 'save:two', 'prompt:Cafe one', 'prompt:Cafe two']);
});

test('a save batch stops on its first persistence failure and never processes later rows or candidates', async () => {
  const calls = [];
  const result = await persistReceiptsBeforeDirectoryPrompts(['saved', 'failed', 'later'], async row => {
    calls.push(`save:${row}`);
    if (row === 'failed') throw new Error('save failed');
    const values = candidate({ store: `Cafe ${row}` });
    return { row: { dataset: {} }, fingerprint: persistedStoreFingerprint(values), decision: postSaveDirectoryDecision({ values, profiles: [] }) };
  });
  assert.deepEqual(calls, ['save:saved', 'save:failed']);
  assert.equal(result.error.message, 'save failed');
  assert.equal(result.candidates.length, 0);
  assert.equal(result.persisted.length, 1);
});

test('an aborted batch preserves the prior prompt fingerprint while retaining an earlier new-row dbId', async () => {
  const row = { dataset: { persistedStoreFingerprint: '', receiptDbId: '' } };
  const values = candidate();
  const result = await persistReceiptsBeforeDirectoryPrompts(['first', 'failed'], async item => {
    if (item === 'failed') throw new Error('save failed');
    row.dataset.receiptDbId = 'new-row-id';
    return { row, fingerprint: persistedStoreFingerprint(values), decision: postSaveDirectoryDecision({ values, previousFingerprint: row.dataset.persistedStoreFingerprint, profiles: [] }) };
  });
  assert.equal(row.dataset.receiptDbId, 'new-row-id');
  assert.equal(row.dataset.persistedStoreFingerprint, '');
  assert.equal(result.candidates.length, 0);
  assert.equal(postSaveDirectoryDecision({ values, previousFingerprint: row.dataset.persistedStoreFingerprint, profiles: [] }).status, 'new');
});

test('a later all-successful save finalizes fingerprints and restores prompt eligibility', async () => {
  const row = { dataset: { persistedStoreFingerprint: '' } };
  const values = candidate();
  const result = await persistReceiptsBeforeDirectoryPrompts([row], async savedRow => ({
    row: savedRow,
    fingerprint: persistedStoreFingerprint(values),
    decision: postSaveDirectoryDecision({ values, previousFingerprint: savedRow.dataset.persistedStoreFingerprint, profiles: [] })
  }));
  assert.equal(result.error, undefined);
  assert.equal(result.candidates.length, 1);
  finalizeDirectoryPromptFingerprints(result.persisted);
  assert.equal(row.dataset.persistedStoreFingerprint, persistedStoreFingerprint(values));
  assert.equal(postSaveDirectoryDecision({ values, previousFingerprint: row.dataset.persistedStoreFingerprint, profiles: [] }).status, 'unchanged');
});

test('floating Add Receipt is visible for Available and All but hidden for Consumed', () => {
  assert.equal(floatingAddVisibleForStatus('available'), true);
  assert.equal(floatingAddVisibleForStatus('all'), true);
  assert.equal(floatingAddVisibleForStatus('consumed'), false);
});

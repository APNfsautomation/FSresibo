import assert from 'node:assert/strict';
import test from 'node:test';
import { deduplicateDirectoryCandidates, floatingAddVisibleForStatus, persistedStoreFingerprint, persistReceiptsBeforeDirectoryPrompts, postSaveDirectoryDecision } from '../ui/receiptUi.js';

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
    return postSaveDirectoryDecision({ values: candidate({ store: `Cafe ${row}` }), profiles: [] });
  });
  calls.push(...result.candidates.map(item => `prompt:${item.candidate.storeName}`));
  assert.deepEqual(calls, ['save:one', 'save:two', 'prompt:Cafe one', 'prompt:Cafe two']);
});

test('failed receipt persistence does not return a candidate for contribution', async () => {
  const result = await persistReceiptsBeforeDirectoryPrompts(['saved', 'failed'], async row => {
    if (row === 'failed') throw new Error('save failed');
    return postSaveDirectoryDecision({ values: candidate(), profiles: [] });
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.errors.length, 1);
});

test('floating Add Receipt is visible for Available and All but hidden for Consumed', () => {
  assert.equal(floatingAddVisibleForStatus('available'), true);
  assert.equal(floatingAddVisibleForStatus('all'), true);
  assert.equal(floatingAddVisibleForStatus('consumed'), false);
});

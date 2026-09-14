import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStoreProfileSnapshot, combineStoreProfiles, findCompatibleSharedProfiles, findStoreSuggestions, normalizeStoreTin, resolveSharedContributionCandidate } from '../ui/receiptUi.js';

test('shared profiles precede history fallbacks and equivalent history is removed', () => {
  const profiles = combineStoreProfiles([{ id: 'shared-1', storeName: 'Jollibee', address: 'SM North', tin: '123-456', vat: 'VAT' }], [{ id: 'history-1', store: ' jollibee ', address: 'SM  North', tin: '123456', vat: 'VAT' }, { id: 'history-2', store: 'Jollibee', address: 'Trinoma', tin: '789' }]);
  assert.deepEqual(profiles.map(profile => profile.source), ['shared', 'history']);
  assert.deepEqual(findStoreSuggestions(profiles, 'jolli').map(profile => profile.address), ['SM North', 'Trinoma']);
});

test('TIN matching is digits-only while addresses remain conservative', () => {
  assert.equal(normalizeStoreTin('123-456 789'), normalizeStoreTin('123456789'));
  const profiles = combineStoreProfiles([{ id: 'one', storeName: 'Cafe', address: 'A, Street', tin: '1' }], [{ id: 'two', store: 'Cafe', address: 'A Street', tin: '1' }]);
  assert.equal(profiles.length, 2);
});

test('shared selection copies an exact snapshot and clears stale blank fields', () => {
  const snapshot = applyStoreProfileSnapshot({ store: 'Old', address: 'Old Address', tin: '111', vat: 'VAT' }, { source: 'shared', store: 'Jollibee', address: '', tin: '222', vat: '' });
  assert.deepEqual(snapshot, { store: 'Jollibee', address: '', tin: '222', vat: '' });
});

test('exact and uniquely compatible incomplete candidates reuse, while branches remain ambiguous', () => {
  const profiles = [{ id: 'north', storeName: 'Jollibee', address: 'SM North', tin: '123-456' }, { id: 'trinoma', storeName: 'Jollibee', address: 'Trinoma', tin: '789' }];
  assert.equal(resolveSharedContributionCandidate({ storeName: ' jollibee ', address: 'SM  North', tin: '123456' }, profiles).status, 'existing');
  assert.equal(resolveSharedContributionCandidate({ storeName: 'Jollibee', address: 'SM North', tin: '' }, profiles).profile.id, 'north');
  assert.equal(resolveSharedContributionCandidate({ storeName: 'Jollibee', address: '', tin: '' }, profiles).status, 'ambiguous');
  assert.equal(findCompatibleSharedProfiles({ storeName: 'Jollibee', address: 'Elsewhere', tin: '' }, profiles).length, 0);
});

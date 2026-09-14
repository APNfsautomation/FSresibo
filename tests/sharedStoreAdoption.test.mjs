import assert from 'node:assert/strict';
import test from 'node:test';
import { combineStoreProfiles, findStoreSuggestions, normalizeStoreTin } from '../ui/receiptUi.js';

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

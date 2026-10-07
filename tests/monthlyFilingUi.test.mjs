import assert from 'node:assert/strict';
import test from 'node:test';
import { clearsSharedStoreAssociation, monthlyFilingIsReadOnly, monthlyFilingProfileSnapshot } from '../ui/monthlyFilingUi.js';

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

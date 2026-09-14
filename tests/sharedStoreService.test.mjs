import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SharedStoreDuplicateError, createSharedStoreActions, fromDatabaseSharedStore, toDatabaseSharedStore } from '../services/sharedStoreService.js';

const databaseProfile = Object.freeze({ id: 'store-1', store_name: 'Jollibee', address: 'Branch A', tin: '123-456-789', vat_status: 'VAT', active: true, created_by: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' });

test('shared-store mapping keeps canonical display fields and forces new contributions active', () => {
  assert.deepEqual(toDatabaseSharedStore({ storeName: ' Jollibee ', address: ' Branch A ', tin: ' 123-456-789 ', vat: 'VAT' }, 'user-1'), { store_name: 'Jollibee', address: 'Branch A', tin: '123-456-789', vat_status: 'VAT', active: true, created_by: 'user-1' });
  assert.deepEqual(fromDatabaseSharedStore(databaseProfile), { id: 'store-1', storeName: 'Jollibee', address: 'Branch A', tin: '123-456-789', vat: 'VAT', active: true, createdBy: 'user-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' });
});

test('shared-store service lists only active profiles from its dedicated table', async () => {
  const calls = [];
  const client = { from: table => {
    calls.push(['from', table]);
    const query = { select: columns => { calls.push(['select', columns]); return query; }, eq: (...args) => { calls.push(['eq', ...args]); return query; }, order: (...args) => { calls.push(['order', ...args]); return Promise.resolve({ data: [databaseProfile], error: null }); } };
    return query;
  } };
  const stores = await createSharedStoreActions(async () => client).listActive();
  assert.deepEqual(stores.map(store => store.storeName), ['Jollibee']);
  assert.deepEqual(calls[0], ['from', 'shared_store_directory']);
  assert.deepEqual(calls[2], ['eq', 'active', true]);
});

test('shared-store contribution inserts without overwriting and exposes duplicate conflicts', async () => {
  const calls = [];
  const client = { from: table => {
    calls.push(['from', table]);
    const query = { insert: payload => { calls.push(['insert', payload]); return query; }, select: () => query, single: () => Promise.resolve({ data: databaseProfile, error: null }) };
    return query;
  } };
  const actions = createSharedStoreActions(async () => client);
  const profile = await actions.contribute({ storeName: 'Jollibee', address: 'Branch A', tin: '123-456-789', vat: 'VAT' }, 'user-1');
  assert.equal(profile.id, 'store-1');
  assert.deepEqual(calls[1][1], { store_name: 'Jollibee', address: 'Branch A', tin: '123-456-789', vat_status: 'VAT', active: true, created_by: 'user-1' });

  const duplicateClient = { from: () => { const query = { insert: () => query, select: () => query, single: () => Promise.resolve({ data: null, error: { code: '23505' } }) }; return query; } };
  await assert.rejects(() => createSharedStoreActions(async () => duplicateClient).contribute({ storeName: 'Jollibee', address: 'Branch A' }, 'user-1'), SharedStoreDuplicateError);
});

test('shared-store service remains isolated from receipt persistence', async () => {
  const source = await readFile(new URL('../services/sharedStoreService.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /receiptService|public\.receipts|from\('receipts'\)/);
});

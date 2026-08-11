import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStoreProfiles, describeStoreProfile, findStoreSuggestions, normalizeStoreText, storeProfileFields } from '../ui/receiptUi.js';

const receipt = (overrides = {}) => ({
  dbId: crypto.randomUUID(), store: '', address: '', tin: '', vat: '', amount: '100.00', receiptDate: '2026-08-01', invoice: 'OR-1', updatedAt: '2026-08-01T00:00:00.000Z', ...overrides
});

test('store matching normalizes capitalization and whitespace without changing displayed values', () => {
  assert.equal(normalizeStoreText('  Robinsons   Supermarket  '), 'robinsons supermarket');
  const profiles = buildStoreProfiles([
    receipt({ store: ' Robinsons   Supermarket ', address: 'Ortigas', tin: '111', updatedAt: '2026-08-01T00:00:00.000Z' }),
    receipt({ store: 'ROBINSONS SUPERMARKET', address: ' Ortigas ', tin: '111', vat: 'VAT', updatedAt: '2026-08-02T00:00:00.000Z' })
  ]);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].store, 'ROBINSONS SUPERMARKET');
  assert.equal(profiles[0].address, 'Ortigas');
  assert.equal(profiles[0].vat, 'VAT');
});

test('separate address or TIN branches remain distinct suggestions', () => {
  const profiles = buildStoreProfiles([
    receipt({ store: 'Robinsons Supermarket', address: 'Ortigas Center', tin: '111', vat: 'VAT' }),
    receipt({ store: 'ROBINSONS SUPERMARKET', address: 'Magnolia', tin: '222', vat: 'Non-VAT', updatedAt: '2026-08-02T00:00:00.000Z' })
  ]);
  assert.equal(profiles.length, 2);
  assert.deepEqual(profiles.map(describeStoreProfile), ['Magnolia · 222', 'Ortigas Center · 111']);
  assert.deepEqual(findStoreSuggestions(profiles, 'rob').map(profile => profile.tin).sort(), ['111', '222']);
});

test('incomplete metadata inherits a profile only when it is unambiguous', () => {
  const unambiguous = buildStoreProfiles([
    receipt({ store: 'Mercury Drug', address: 'Makati', tin: '333', vat: 'VAT', updatedAt: '2026-08-01T00:00:00.000Z' }),
    receipt({ store: ' mercury drug ', vat: 'Non-VAT', updatedAt: '2026-08-03T00:00:00.000Z' })
  ]);
  assert.equal(unambiguous.length, 1);
  assert.equal(unambiguous[0].vat, 'Non-VAT');

  const ambiguous = buildStoreProfiles([
    receipt({ store: 'Mercury Drug', address: 'Makati', tin: '333', vat: 'VAT' }),
    receipt({ store: 'Mercury Drug', address: 'Quezon City', tin: '444', vat: 'Non-VAT' }),
    receipt({ store: 'Mercury Drug', vat: 'VAT', updatedAt: '2026-08-04T00:00:00.000Z' })
  ]);
  assert.equal(ambiguous.length, 3);
  assert.ok(ambiguous.some(profile => !profile.address && !profile.tin));
});

test('each reusable field chooses the most recently saved non-empty value within its profile', () => {
  const [profile] = buildStoreProfiles([
    receipt({ store: 'National Book Store', address: 'Cubao', tin: '', vat: 'VAT', updatedAt: '2026-08-01T00:00:00.000Z' }),
    receipt({ store: 'National Book Store', address: 'Cubao', tin: '556', vat: '', updatedAt: '2026-08-04T00:00:00.000Z' }),
    receipt({ store: 'NATIONAL BOOK STORE', address: 'Cubao', tin: '556', vat: 'Non-VAT', updatedAt: '2026-08-05T00:00:00.000Z' })
  ]);
  assert.equal(profile.store, 'NATIONAL BOOK STORE');
  assert.equal(profile.address, 'Cubao');
  assert.equal(profile.tin, '556');
  assert.equal(profile.vat, 'Non-VAT');
});

test('prefix matches rank before substring matches and results are limited', () => {
  const profiles = buildStoreProfiles([
    receipt({ store: 'Metro Robinsons' }),
    receipt({ store: 'Robinsons Department Store' }),
    receipt({ store: 'Robinsons Supermarket' }),
    ...Array.from({ length: 8 }, (_, index) => receipt({ store: `Robinsons Branch ${index}`, address: `Address ${index}`, tin: String(index) }))
  ]);
  const suggestions = findStoreSuggestions(profiles, 'rob');
  assert.equal(suggestions.length, 6);
  assert.ok(suggestions.every(profile => profile.normalizedStore.startsWith('rob')));
  assert.equal(findStoreSuggestions(profiles, 'metro')[0].store, 'Metro Robinsons');
});

test('suggestion payload contains only reusable store fields', () => {
  const [profile] = buildStoreProfiles([receipt({ store: 'SM Store', address: 'BGC', tin: '666', vat: 'VAT', amount: '999.99', receiptDate: '2026-02-02', invoice: 'OR-999' })]);
  assert.deepEqual(storeProfileFields(profile), { store: 'SM Store', address: 'BGC', tin: '666', vat: 'VAT' });
});

test('a 600-receipt repeated-store fixture builds once and queries without rescanning receipt data', () => {
  const receipts = Array.from({ length: 600 }, (_, index) => receipt({
    store: `Store ${index % 40}`,
    address: `Branch ${Math.floor(index / 40) % 5}`,
    tin: `TIN-${Math.floor(index / 40) % 5}`,
    vat: index % 2 ? 'VAT' : 'Non-VAT',
    updatedAt: `2026-08-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`
  }));
  const profiles = buildStoreProfiles(receipts);
  assert.equal(profiles.length, 200);
  assert.equal(findStoreSuggestions(profiles, 'store 1').length, 6);
});

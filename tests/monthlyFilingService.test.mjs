import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fromDatabaseMonthlyFilingReceipt, monthlyFilingTable, toDatabaseMonthlyFilingReceipt, validateArchivedMonthlyFilingReceiptSet } from '../services/monthlyFilingService.js';

test('Monthly Filing service maps the separate table model and defaults creates to Active', () => {
  const database = toDatabaseMonthlyFilingReceipt({ sharedStoreId: 'store-1', store: 'Cafe', address: 'A', tin: '123', vat: 'VAT', amount: '12.50', receiptDate: '2026-10-01', invoice: 'OR-1' }, 'user-1');
  assert.equal(monthlyFilingTable, 'monthly_filing_receipts');
  assert.deepEqual(database, { user_id: 'user-1', shared_store_id: 'store-1', store_name: 'Cafe', address: 'A', tin: '123', vat_status: 'VAT', amount: 12.5, receipt_date: '2026-10-01', invoice_number: 'OR-1', status: 'active' });
  assert.equal(fromDatabaseMonthlyFilingReceipt({ id: 'one', ...database, archived_at: null, updated_at: 'now' }).sharedStoreId, 'store-1');
});

test('Monthly Filing service stays isolated from long-term receipts and active-guards normal mutation paths', async () => {
  const source = await readFile(new URL('../services/monthlyFilingService.js', import.meta.url), 'utf8');
  const receiptSource = await readFile(new URL('../services/receiptService.js', import.meta.url), 'utf8');
  assert.match(source, /from\(monthlyFilingTable\)/);
  assert.doesNotMatch(source, /from\('receipts'\)|receiptService/);
  assert.match(source, /\.eq\('status', 'active'\)/);
  assert.doesNotMatch(receiptSource, /monthly_filing_receipts/);
});

test('Monthly Filing lifecycle uses exact RPC archive, archived-only return, and user-scoped clear', async () => {
  const source = await readFile(new URL('../services/monthlyFilingService.js', import.meta.url), 'utf8');
  assert.match(source, /rpc\('archive_monthly_filing_receipts', \{ p_ids: exactIds \}\)/);
  assert.match(source, /associateMonthlyFilingSharedStore[\s\S]*update\(\{ shared_store_id: sharedStoreId \|\| null \}\)[\s\S]*eq\('status', 'active'\)/);
  assert.match(source, /new Set\(ids\.filter\(Boolean\)\)/);
  assert.doesNotMatch(source, /update\([^)]*status:\s*'archived'[^)]*\)\.eq\('status', 'active'\)/);
  assert.match(source, /update\(\{ status: 'active', archived_at: null \}\)\.eq\('id', id\)\.eq\('status', 'archived'\)/);
  assert.match(source, /from\(monthlyFilingTable\)\.delete\(\)\.eq\('user_id', userId\)/);
  assert.match(source, /clearArchivedMonthlyFilingReceipts[\s\S]*from\(monthlyFilingTable\)\.delete\(\)\.eq\('user_id', userId\)\.eq\('status', 'archived'\)/);
  assert.doesNotMatch(source, /from\('receipts'\)|shared_store_directory/);
});

test('archive return validation requires exact count, exact IDs, and archived statuses', () => {
  const archived = [{ dbId: 'a', status: 'archived' }, { dbId: 'b', status: 'archived' }];
  assert.equal(validateArchivedMonthlyFilingReceiptSet(['a', 'b'], archived), archived);
  assert.throws(() => validateArchivedMonthlyFilingReceiptSet(['a', 'b'], [{ dbId: 'a', status: 'archived' }]));
  assert.throws(() => validateArchivedMonthlyFilingReceiptSet(['a', 'b'], [{ dbId: 'a', status: 'archived' }, { dbId: 'unexpected', status: 'archived' }]));
  assert.throws(() => validateArchivedMonthlyFilingReceiptSet(['a', 'b'], [{ dbId: 'a', status: 'archived' }, { dbId: 'b', status: 'archived' }, { dbId: 'b', status: 'archived' }]));
  assert.throws(() => validateArchivedMonthlyFilingReceiptSet(['a'], [{ dbId: 'a', status: 'active' }]));
});

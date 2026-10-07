import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fromDatabaseMonthlyFilingReceipt, monthlyFilingTable, toDatabaseMonthlyFilingReceipt } from '../services/monthlyFilingService.js';

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

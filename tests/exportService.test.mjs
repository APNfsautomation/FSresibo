import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectedReceiptsWorkbook, buildExpenseDetailedReportRows, expenseDetailedReportHeaders } from '../services/exportService.js';
import { read, write } from '../vendor/sheetjs/xlsx-0.20.3.mjs';

const receipts = [
  { dbId: 'first', receiptDate: '2026-07-13', store: 'Alpha Store', address: 'Makati', vat: 'VAT', tin: '123', invoice: 'OR-001', amount: '27998.00' },
  { dbId: 'second', receiptDate: '2026-07-14', store: 'Beta Store', address: 'Quezon City', vat: 'Non-VAT', tin: '456', invoice: 'OR-002', amount: '100.50' }
];

test('Expense Detailed Report staging rows preserve the exact A:O mapping', () => {
  const rows = buildExpenseDetailedReportRows(receipts);
  assert.equal(expenseDetailedReportHeaders.length, 15);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].length, 15);
  assert.equal(rows[1][1].getFullYear(), 2026);
  assert.equal(rows[1][1].getMonth(), 6);
  assert.equal(rows[1][1].getDate(), 13);
  assert.deepEqual([rows[1][0], ...rows[1].slice(2, 8)], [1, 'Alpha Store', 'Makati', 'VAT', '123', 'OR-001', 27998]);
  assert.deepEqual(rows[1].slice(8), ['', '', '', '', '', '', '']);
  assert.equal(typeof rows[1][7], 'number');
});

test('workbook uses one Selected Receipts worksheet with date and amount cells', () => {
  const workbook = createSelectedReceiptsWorkbook(receipts);
  assert.deepEqual(workbook.SheetNames, ['Selected Receipts']);
  const sheet = workbook.Sheets['Selected Receipts'];
  assert.equal(sheet['!ref'], 'A1:O3');
  assert.equal(sheet.B2.t, 'd');
  assert.equal(sheet.B2.z, 'd-mmm');
  assert.equal(sheet.H2.t, 'n');
  assert.equal(sheet.H2.v, 27998);
  ['I', 'J', 'K', 'L', 'M', 'N', 'O'].forEach(column => assert.deepEqual(sheet[`${column}2`], { t: 's', v: '' }));
});

test('the vendored SheetJS build generates and reads an XLSX workbook without network access', () => {
  const generated = write(createSelectedReceiptsWorkbook(receipts), { bookType: 'xlsx', type: 'array', cellDates: true });
  const reopened = read(generated, { type: 'array', cellDates: true, cellNF: true });
  const sheet = reopened.Sheets['Selected Receipts'];
  assert.ok(generated.byteLength > 0);
  assert.equal(sheet.H2.v, 27998);
  assert.equal(sheet.B2.z, 'd-mmm');
  assert.equal(sheet.I2.v, '');
});

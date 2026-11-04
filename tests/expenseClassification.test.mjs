import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  classificationOptions, expenseAccountOptions, expenseExportProblems, expenseFieldsFromDatabase, expenseFieldsToDatabase, expenseProblemMessage, filterOptions, isClassification, isExpenseAccount, missingExpenseFields, resolveOption
} from '../domain/expenseClassification.js';
import { fromDatabaseReceipt, toDatabaseReceipt } from '../services/receiptService.js';
import { fromDatabaseMonthlyFilingReceipt, toDatabaseMonthlyFilingReceipt } from '../services/monthlyFilingService.js';
import { buildExpenseDetailedReportRows, createExpenseDetailedReportWorkbook, expenseDetailedReportHeaders } from '../services/exportService.js';
import { read, write } from '../vendor/sheetjs/xlsx-0.20.3.mjs';

const approvedClassifications = ['Accomodation', 'Building Maintenance and Repairs', 'Bank Fees', 'Cost of Goods', 'Equipment', 'Gasoline', 'Marketing', 'Meals', 'Office Supplies', 'Others', 'Parking', 'Postage and Shipping', 'Professional Fee', 'Representation', 'Taxes and Registration', 'Toll Fee', 'Transportation', 'Utilities', 'Vehicle Maintenance', 'Advertisement', 'Car Insurance', 'Car Registration', 'Delivery Fee', 'Electricity', 'Freight Cost', 'Gifts for Customer', 'Grocery', 'Hotel', 'Internet', 'Meals w/ Customer', 'Notary Fee', 'Packaging', 'Permits', 'Phone', 'Sponsorship', 'Staffhouse', 'Stationeries', 'Trade Show Fees', 'Water'];

test('EXP-1: the option lists are exactly the approved values, in source order, with the source spelling', () => {
  assert.deepEqual([...expenseAccountOptions], ['Day to day', 'Project Expense']);
  assert.deepEqual([...classificationOptions], approvedClassifications);
  assert.equal(classificationOptions.length, 39);
  assert.equal(new Set(classificationOptions).size, 39);
  assert.ok(classificationOptions.includes('Accomodation') && !classificationOptions.includes('Accommodation'));
  assert.ok(Object.isFrozen(classificationOptions) && Object.isFrozen(expenseAccountOptions));
});

test('EXP-2: membership is exact; resolveOption maps only an unambiguous typed name and never invents a value', () => {
  assert.equal(isExpenseAccount('Day to day'), true);
  assert.equal(isExpenseAccount('day to day'), false, 'a stored value must be the exact option');
  assert.equal(isExpenseAccount(''), false); assert.equal(isExpenseAccount(null), false);
  assert.equal(isClassification('Meals w/ Customer'), true); assert.equal(isClassification('Meals with Customer'), false);
  assert.equal(resolveOption(expenseAccountOptions, '  project expense '), 'Project Expense');
  assert.equal(resolveOption(expenseAccountOptions, 'proj'), '', 'a partial name is not a choice');
  assert.equal(resolveOption(classificationOptions, ''), '');
});

test('EXP-3: keyboard-first autocomplete: D and P select the Expense Account, classification search ranks prefix before word before contains', () => {
  assert.deepEqual(filterOptions(expenseAccountOptions, 'd'), ['Day to day']);
  assert.deepEqual(filterOptions(expenseAccountOptions, 'P'), ['Project Expense']);
  assert.deepEqual(filterOptions(expenseAccountOptions, ''), ['Day to day', 'Project Expense'], 'a blank query shows every option and chooses none');
  assert.deepEqual(filterOptions(classificationOptions, 'zzz'), []);
  const meals = filterOptions(classificationOptions, 'meals');
  assert.deepEqual(meals, ['Meals', 'Meals w/ Customer']);
  assert.deepEqual(filterOptions(classificationOptions, 'fee'), ['Bank Fees', 'Professional Fee', 'Toll Fee', 'Delivery Fee', 'Notary Fee', 'Trade Show Fees'], 'word matches keep source order');
  assert.equal(filterOptions(classificationOptions, 'ac')[0], 'Accomodation', 'prefix first');
  assert.deepEqual(filterOptions(classificationOptions, 'ate'), ['Water'], 'contains match ranks last');
  assert.equal(filterOptions(classificationOptions, 'customer').includes('Gifts for Customer'), true, 'word anywhere');
  assert.equal(filterOptions(classificationOptions, 'ma')[0], 'Marketing', 'prefix matches rank first');
});

test('EXP-4: blank and unknown stored values are "missing"; a complete pair is not', () => {
  assert.deepEqual(missingExpenseFields({}), ['expenseAccount', 'classification']);
  assert.deepEqual(missingExpenseFields({ expenseAccount: 'Day to day', classification: '' }), ['classification']);
  assert.deepEqual(missingExpenseFields({ expenseAccount: 'Whatever', classification: 'Meals' }), ['expenseAccount'], 'uncontrolled free text is not accepted at export');
  assert.deepEqual(missingExpenseFields({ expenseAccount: 'Project Expense', classification: 'Water' }), []);
});

test('EXP-5: export preflight inspects only the exact selection, names receipts and fields, and its message promises no export and no status change', () => {
  const complete = { expenseAccount: 'Day to day', classification: 'Meals' };
  const problems = expenseExportProblems([
    { label: 'Receipt 1', receipt: complete },
    { label: 'Receipt 3', receipt: { expenseAccount: '', classification: 'Water' } },
    { label: 'Receipt 4', receipt: {} }
  ]);
  assert.deepEqual(problems.map(problem => [problem.label, problem.fields]), [['Receipt 3', ['expenseAccount']], ['Receipt 4', ['expenseAccount', 'classification']]]);
  assert.deepEqual(expenseExportProblems([{ label: 'Receipt 1', receipt: complete }]), [], 'an unselected, incomplete receipt elsewhere is never inspected');
  const message = expenseProblemMessage(problems);
  assert.match(message, /Receipt 3 needs Expense Account\./); assert.match(message, /Receipt 4 needs Expense Account and Classification of Expense\./);
  assert.match(message, /Nothing was exported and no receipt status was changed\./);
});

test('EXP-6: both services persist the fields, store a blank as NULL, and read an old row (no columns) as blank without error', () => {
  const base = { store: 'Cafe', address: 'A', tin: '1', vat: 'VAT', amount: '10', receiptDate: '2026-10-01', invoice: 'OR-1' };
  const withFields = { ...base, expenseAccount: 'Project Expense', classification: 'Accomodation' };
  assert.deepEqual([toDatabaseReceipt(withFields, 'u').expense_account, toDatabaseReceipt(withFields, 'u').classification_of_expense], ['Project Expense', 'Accomodation']);
  assert.deepEqual([toDatabaseMonthlyFilingReceipt(withFields, 'u').expense_account, toDatabaseMonthlyFilingReceipt(withFields, 'u').classification_of_expense], ['Project Expense', 'Accomodation']);
  for (const blank of [base, { ...base, expenseAccount: '', classification: '   ' }]) {
    assert.deepEqual(expenseFieldsToDatabase(blank), { expense_account: null, classification_of_expense: null }, 'no silent default');
    assert.equal(toDatabaseReceipt(blank, 'u').expense_account, null);
    assert.equal(toDatabaseMonthlyFilingReceipt(blank, 'u').classification_of_expense, null);
  }
  const oldRow = { id: 'old', store_name: 'Old', amount: 5, receipt_date: null, vat_status: null, invoice_number: null, address: null, tin: null, status: 'consumed', updated_at: 'x' };
  assert.equal(fromDatabaseReceipt(oldRow).expenseAccount, ''); assert.equal(fromDatabaseReceipt(oldRow).classification, ''); assert.equal(fromDatabaseReceipt(oldRow).status, 'consumed');
  assert.equal(fromDatabaseMonthlyFilingReceipt({ ...oldRow, status: 'archived' }).classification, ''); assert.equal(fromDatabaseMonthlyFilingReceipt({ ...oldRow, status: 'archived' }).status, 'archived');
  assert.deepEqual(expenseFieldsFromDatabase({ expense_account: 'Day to day', classification_of_expense: 'Water' }), { expenseAccount: 'Day to day', classification: 'Water' });
  const roundTrip = fromDatabaseReceipt({ id: 'r', ...toDatabaseReceipt(withFields, 'u'), status: 'available' });
  assert.deepEqual([roundTrip.expenseAccount, roundTrip.classification], ['Project Expense', 'Accomodation']);
});

test('EXP-7: the migration is additive and nullable only, leaves RLS and the archive function alone, and protects the two fixed account values', async () => {
  const sql = await readFile(new URL('../supabase/migrations/005_add_expense_fields.sql', import.meta.url), 'utf8');
  const code = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.match(code, /alter table public\.receipts[\s\S]*add column if not exists expense_account text/i);
  assert.match(code, /alter table public\.monthly_filing_receipts[\s\S]*add column if not exists classification_of_expense text/i);
  assert.doesNotMatch(code, /not null|default|drop |delete |update |truncate|policy|grant|revoke|archive_monthly_filing_receipts|status/i, 'no default, backfill, deletion, policy, grant or status change');
  assert.match(code, /expense_account in \('Day to day', 'Project Expense'\)/);
  assert.doesNotMatch(code, /classification_of_expense in/, 'the classification list stays in the app so the approved list can grow without a production migration');
  for (const name of ['001_create_receipts', '003_create_monthly_filing_receipts', '004_add_monthly_filing_archive_function']) assert.ok((await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8')).length > 0);
});

const receipt = (overrides = {}) => ({ dbId: 'r', receiptDate: '2026-07-13', store: 'Alpha', address: 'Makati', vat: 'VAT', tin: '123', invoice: '00123', amount: '1250.5', expenseAccount: 'Day to day', classification: 'Meals w/ Customer', ...overrides });

test('XLS-1: Expense Account precedes one Classification of Expense column and both carry the saved values', () => {
  assert.equal(expenseDetailedReportHeaders.filter(header => header === 'Classification of Expense').length, 1);
  assert.equal(expenseDetailedReportHeaders.indexOf('Expense Account') + 1, expenseDetailedReportHeaders.indexOf('Classification of Expense'));
  const rows = buildExpenseDetailedReportRows([receipt(), receipt({ expenseAccount: '', classification: '' })]);
  assert.deepEqual(rows[2].slice(8, 10), ['Day to day', 'Meals w/ Customer']);
  assert.deepEqual(rows[3].slice(8, 10), ['', '']);
  assert.equal(rows[2].length, 14);
});

test('XLS-2: one sheet named Expense Detailed Report; real mm/dd/yyyy date; Invoice No. is text with leading zeros; Amount numeric with two decimals', () => {
  const workbook = createExpenseDetailedReportWorkbook([receipt(), receipt({ invoice: '0007', amount: '3' }), receipt({ invoice: 12345 })]);
  assert.deepEqual(workbook.SheetNames, ['Expense Detailed Report']);
  const reopened = read(write(workbook, { bookType: 'xlsx', type: 'array', cellDates: true }), { type: 'array', cellDates: true, cellNF: true });
  assert.deepEqual(reopened.SheetNames, ['Expense Detailed Report']);
  const sheet = reopened.Sheets['Expense Detailed Report'];
  assert.equal(sheet.B3.t, 'd'); assert.equal(sheet.B3.z, 'mm/dd/yyyy');
  assert.deepEqual([sheet.B3.v.getFullYear(), sheet.B3.v.getMonth(), sheet.B3.v.getDate()], [2026, 6, 13]);
  assert.deepEqual([sheet.G3.t, sheet.G3.v], ['s', '00123'], 'leading zeros survive as text');
  assert.deepEqual([sheet.G4.t, sheet.G4.v], ['s', '0007']);
  assert.deepEqual([sheet.G5.t, sheet.G5.v], ['s', '12345'], 'a numeric-looking invoice stays text');
  assert.deepEqual([sheet.H3.t, sheet.H3.v, sheet.H3.z], ['n', 1250.5, '#,##0.00']);
  assert.deepEqual([sheet.I3.v, sheet.J3.v], ['Day to day', 'Meals w/ Customer']);
});

test('XLS-3: row order is exactly the order supplied (the reviewed order), numbered 1..n, and existing merges and widths are kept', () => {
  const ordered = [receipt({ store: 'Third', invoice: 'C' }), receipt({ store: 'First', invoice: 'A' }), receipt({ store: 'Second', invoice: 'B' })];
  const sheet = createExpenseDetailedReportWorkbook(ordered).Sheets['Expense Detailed Report'];
  assert.deepEqual([3, 4, 5].map(row => [sheet[`A${row}`].v, sheet[`C${row}`].v, sheet[`G${row}`].v]), [[1, 'Third', 'C'], [2, 'First', 'A'], [3, 'Second', 'B']]);
  assert.equal(sheet['!merges'].length, 13); assert.equal(sheet['!cols'].length, 14);
  assert.ok(sheet['!merges'].some(range => range.s.c === 2 && range.e.c === 3 && range.s.r === 0 && range.e.r === 0));
});

test('XLS-4: SheetJS CE 0.20.3 stays the only spreadsheet library (no ExcelJS, no second sheet)', async () => {
  const manifest = JSON.parse(await readFile(new URL('../vendor/dependency-manifest.json', import.meta.url), 'utf8'));
  assert.match(JSON.stringify(manifest), /0\.20\.3/);
  assert.doesNotMatch(JSON.stringify(manifest) + await readFile(new URL('../services/exportService.js', import.meta.url), 'utf8') + await readFile(new URL('../index.html', import.meta.url), 'utf8'), /exceljs/i);
});

test('XLS-5: the redundant Additional Classification column is gone: 14 columns A-N, former L-O fields shifted to K-N, one sheet', () => {
  assert.ok(!expenseDetailedReportHeaders.includes('Additional Classification'));
  assert.deepEqual([...expenseDetailedReportHeaders].slice(8), ['Expense Account', 'Classification of Expense', 'Customer Name', 'Customer PO#', 'Notes for Accounting', 'Item Description (FOR COGS)']);
  const workbook = createExpenseDetailedReportWorkbook([receipt()]);
  const sheet = workbook.Sheets['Expense Detailed Report'];
  assert.equal(sheet['!ref'], 'A1:N3'); assert.deepEqual(workbook.SheetNames, ['Expense Detailed Report']);
  assert.deepEqual(['K', 'L', 'M', 'N'].map(column => sheet[`${column}1`].v), ['Customer Name', 'Customer PO#', 'Notes for Accounting', 'Item Description (FOR COGS)']);
  assert.equal(sheet.O1, undefined); assert.equal(sheet['!cols'].length, 14); assert.equal(sheet['!merges'].length, 13);
  assert.ok(sheet['!merges'].every(range => range.e.c <= 13));
});

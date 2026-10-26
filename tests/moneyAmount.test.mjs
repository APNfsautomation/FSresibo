import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { InvalidMoneyAmountError, maximumMoneyCents, normalizeMoneyAmount, parseMoneyAmount } from '../domain/moneyAmount.js';
import { toDatabaseReceipt } from '../services/receiptService.js';
import { toDatabaseMonthlyFilingReceipt } from '../services/monthlyFilingService.js';
import { buildExpenseDetailedReportRows } from '../services/exportService.js';
import { receiptFixture as fixture, settle } from './helpers/receiptUiFixture.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

// ---- the parser -------------------------------------------------------------------------------------------------------------------
test('valid amounts parse to exact centavos and a canonical two-decimal value', () => {
  const cases = [
    ['1250.50', 125050, '1250.50'], ['1,250.50', 125050, '1250.50'], ['12,500', 1250000, '12500.00'], ['1,234,567.89', 123456789, '1234567.89'], ['0.50', 50, '0.50'],
    ['0', 0, '0.00'], ['0.00', 0, '0.00'], ['25', 2500, '25.00'], ['25.5', 2550, '25.50'], ['25.05', 2505, '25.05'], ['999', 99900, '999.00'], ['1,000', 100000, '1000.00'],
    ['007', 700, '7.00'], ['  1,250.50  ', 125050, '1250.50'], ['9,999,999,999.99', maximumMoneyCents, '9999999999.99'], ['0.07', 7, '0.07'], ['19.99', 1999, '19.99']
  ];
  for (const [raw, cents, canonical] of cases) {
    const parsed = parseMoneyAmount(raw);
    assert.equal(parsed.valid, true, raw);
    assert.equal(parsed.cents, cents, raw);
    assert.equal(parsed.canonical, canonical, raw);
    assert.equal(parsed.amount, Number(canonical), raw);
    assert.ok(Number.isSafeInteger(parsed.cents));
  }
});

test('numbers coming back from the database are accepted exactly', () => {
  assert.equal(parseMoneyAmount(1250.5).cents, 125050);
  assert.equal(parseMoneyAmount(185).canonical, '185.00');
  assert.equal(parseMoneyAmount(0).canonical, '0.00');
  assert.equal(parseMoneyAmount(4120.5).amount, 4120.5);
});

test('floating-point-unfriendly values keep exact centavos', () => {
  for (const [raw, cents] of [['0.29', 29], ['1.15', 115], ['4.35', 435], ['8.2', 820], ['1,000,000.07', 100000007]]) assert.equal(parseMoneyAmount(raw).cents, cents, raw);
});

test('blank amounts are blank, not invalid and not zero', () => {
  for (const raw of ['', '   ', null, undefined]) { assert.deepEqual(parseMoneyAmount(raw), { blank: true }); assert.equal(normalizeMoneyAmount(raw), null); }
});

test('malformed amounts are rejected with a reason instead of being guessed', () => {
  const cases = [
    ['12,34.50', /group exactly three digits/], ['1,250.999', /at most two decimal places/], ['1,,250', /group exactly three digits/], ['abc123', /digits/], ['-500', /negative/], ['-0.50', /negative/],
    ['NaN', /digits/], ['Infinity', /digits/], ['-Infinity', /negative/], ['1.2.3', /one decimal point/], ['1,250.50.1', /./], ['.5', /digits/], ['5.', /digits/], ['1e3', /digits/], ['0x10', /digits/],
    ['₱1,250.50', /digits/], ['PHP 5', /digits/], ['1 250', /digits/], ['12,3', /group exactly three digits/], ['1,2345', /group exactly three digits/], ['1250,50', /group exactly three digits/], ['1,250.5.0', /./],
    ['+5', /digits/], ['5-', /digits/], ['٣٥', /digits/], ['9,999,999,999.995', /two decimal/], ['10,000,000,000', /exceed/], ['99999999999', /exceed/], ['10000000000.00', /exceed/]
  ];
  for (const [raw, reason] of cases) {
    const parsed = parseMoneyAmount(raw);
    assert.equal(parsed.valid, false, `${raw} must be rejected`);
    assert.match(parsed.reason, reason, raw);
    assert.match(parsed.message, /^Invalid amount "/);
    assert.throws(() => normalizeMoneyAmount(raw), error => error instanceof InvalidMoneyAmountError && error.message === parsed.message);
  }
  for (const raw of [NaN, Infinity, -Infinity, 1e21, -5]) assert.equal(parseMoneyAmount(raw).valid, false, String(raw));
});

test('the largest permitted amount is the numeric(12,2) capacity of the receipts table', async () => {
  assert.equal(maximumMoneyCents, 999999999999);
  const migration = await read('../supabase/migrations/001_create_receipts.sql');
  assert.match(migration, /amount numeric\(12,2\)/);
  assert.equal(parseMoneyAmount('9999999999.99').valid, true); assert.equal(parseMoneyAmount('9999999999.991').valid, false); assert.equal(parseMoneyAmount('10000000000').valid, false);
});

// ---- the persistence boundary -----------------------------------------------------------------------------------------------------
const receipt = amount => ({ amount, receiptDate: '2026-10-01', vat: 'VAT', invoice: 'OR-1', store: 'Cafe', address: 'A', tin: '123' });
const monthlyReceipt = amount => ({ sharedStoreId: '', store: 'Cafe', address: 'A', tin: '123', vat: 'VAT', amount, receiptDate: '2026-10-01', invoice: 'OR-1' });

test('Receipt Encoding persistence normalizes valid amounts and keeps blank as NULL', () => {
  for (const [raw, stored] of [['1250.50', 1250.5], ['1,250.50', 1250.5], ['12,500', 12500], ['1,234,567.89', 1234567.89], ['0.50', 0.5], ['0', 0], ['25.05', 25.05], ['', null], ['   ', null], [undefined, null]]) {
    assert.equal(toDatabaseReceipt(receipt(raw), 'user-1').amount, stored, String(raw));
  }
  assert.deepEqual(toDatabaseReceipt(receipt('1,250.50'), 'user-1'), { user_id: 'user-1', store_name: 'Cafe', amount: 1250.5, receipt_date: '2026-10-01', address: 'A', tin: '123', vat_status: 'VAT', invoice_number: 'OR-1' });
});

test('Monthly Filing persistence normalizes valid amounts and keeps blank as NULL', () => {
  for (const [raw, stored] of [['1250.50', 1250.5], ['1,250.50', 1250.5], ['12,500', 12500], ['0.50', 0.5], ['0', 0], ['', null], [undefined, null], [4120.5, 4120.5]]) {
    assert.equal(toDatabaseMonthlyFilingReceipt(monthlyReceipt(raw), 'user-1').amount, stored, String(raw));
  }
});

test('no malformed non-blank amount can silently become NULL or zero in either service', () => {
  for (const raw of ['12,34.50', '1,250.999', '1,,250', 'abc123', '-500', 'NaN', 'Infinity', '1e3', '.5', '5.', '1.2.3', '₱5', '10,000,000,000']) {
    assert.throws(() => toDatabaseReceipt(receipt(raw), 'user-1'), InvalidMoneyAmountError, `receipts: ${raw}`);
    assert.throws(() => toDatabaseMonthlyFilingReceipt(monthlyReceipt(raw), 'user-1'), InvalidMoneyAmountError, `monthly: ${raw}`);
  }
});

test('every write path of both services goes through the validated mapper, and imports name the offending draft receipt', async () => {
  const receipts = await read('../services/receiptService.js'); const monthly = await read('../services/monthlyFilingService.js');
  assert.equal((receipts.match(/toDatabaseReceipt\(/g) ?? []).length, 4, 'definition + create + update + import');
  assert.match(receipts, /import \{ normalizeMoneyAmount \} from '\.\.\/domain\/moneyAmount\.js'/);
  assert.match(receipts, /Browser draft receipt \$\{index \+ 1\}: \$\{error\.message\}/);
  assert.doesNotMatch(receipts + monthly, /Number\.isFinite\(numeric/, 'the old Number()-to-NULL conversion is gone');
  assert.match(monthly, /amount: normalizeMoneyAmount\(receipt\.amount\)/);
  assert.match(monthly, /createMonthlyFilingReceipt[\s\S]*toDatabaseMonthlyFilingReceipt\(receipt, userId\)/);
  assert.match(monthly, /updateMonthlyFilingReceipt[\s\S]*toDatabaseMonthlyFilingReceipt\(receipt, userId\)/);
});

// ---- export workbook amounts --------------------------------------------------------------------------------------------------------
test('the workbook receives the normalized amount: a comma-formatted amount is never blank in the XLSX', () => {
  const rows = buildExpenseDetailedReportRows([{ receiptDate: '2026-10-01', store: 'Cafe', amount: '1250.50' }, { receiptDate: '', store: 'B', amount: 12500 }, { store: 'C', amount: 0.5 }]);
  assert.deepEqual(rows.slice(2).map(row => row[7]), [1250.5, 12500, 0.5]);
  assert.equal(buildExpenseDetailedReportRows([{ amount: '1,250.50' }])[2][7], 1250.5, 'the builder now uses the strict CP10-C0 parser, so correctly grouped commas are read exactly');
  assert.throws(() => buildExpenseDetailedReportRows([{ amount: '12,34.50' }]), /Cannot export receipt amount: Invalid amount "12,34\.50"/, 'an invalid non-blank amount is rejected, never exported as blank or guessed');
});


test('Save with a malformed amount persists nothing, names the receipt, keeps the typed text and focuses the amount', async () => {
  const f = await fixture();
  await f.click(f.elements.floatingAdd);
  const [row] = f.rows(); await f.type(row, 'store', 'Cafe'); await f.type(row, 'amount', '12,34.50');
  await f.click(f.elements.saveDraft);
  assert.equal(f.calls.create.length + f.calls.update.length, 0, 'nothing was sent to the service');
  assert.match(f.elements.encodingFeedback.textContent, /Could not save receipt changes\. Receipt 1: Invalid amount "12,34\.50"\. Thousands commas must group exactly three digits/);
  assert.match(f.elements.encodingFeedback.textContent, /Nothing was saved/);
  assert.equal(f.field(row, 'amount').value, '12,34.50', 'the entered value is preserved for correction');
  assert.equal(f.focusLog.at(-1), f.field(row, 'amount')); assert.equal(row.open, true);
  assert.equal(f.elements.saveDraft.disabled, false, 'Save is usable again');
});

test('a malformed amount on one receipt blocks the whole batch: valid receipts are not saved either', async () => {
  const f = await fixture();
  await f.click(f.elements.floatingAdd); await f.type(f.rows()[0], 'store', 'Good'); await f.type(f.rows()[0], 'amount', '100');
  await f.click(f.elements.floatingAdd); await f.type(f.rows()[1], 'store', 'Bad'); await f.type(f.rows()[1], 'amount', '1,250.999');
  await f.click(f.elements.saveDraft);
  assert.equal(f.calls.create.length, 0);
  assert.match(f.elements.encodingFeedback.textContent, /Receipt 2: Invalid amount "1,250\.999"\. Use at most two decimal places\./);
});

test('valid plain and grouped amounts, zero and blank amounts still save (the raw text goes to the validating service)', async () => {
  const f = await fixture();
  for (const [index, amount] of ['1,250.50', '1250.50', '0', ''].entries()) { await f.click(f.elements.floatingAdd); await f.type(f.rows()[index], 'store', `Store ${index}`); await f.type(f.rows()[index], 'amount', amount); }
  await f.click(f.elements.saveDraft);
  assert.deepEqual(f.calls.create.map(values => values.amount), ['1,250.50', '1250.50', '0', '']);
  assert.equal(f.elements.encodingFeedback.textContent, 'Receipt changes saved.');
  assert.deepEqual(f.calls.create.map(values => toDatabaseReceipt(values, 'u').amount), [1250.5, 1250.5, 0, null]);
});

test('a blank unsaved receipt and a Consumed receipt never block Save', async () => {
  const f = await fixture({ loaded: [{ dbId: 'c1', amount: '', store: 'Consumed one', status: 'consumed' }] });
  f.field(f.rows()[0], 'amount').value = 'not a number';
  await f.click(f.elements.floatingAdd);
  await f.click(f.elements.saveDraft);
  assert.equal(f.elements.encodingFeedback.textContent, 'No changes to save.', 'nothing was dirty: Save says so and writes nothing (Issue #24)');
  assert.equal(f.calls.create.length, 0); assert.equal(f.calls.update.length, 0);
});

test('Find Best Match refuses to run on a malformed Available amount instead of guessing it', async () => {
  const f = await fixture({ loaded: [{ dbId: 'r1', amount: 100, store: 'A' }, { dbId: 'r2', amount: 200, store: 'B' }] });
  f.elements.target.value = '300';
  await f.type(f.rows()[1], 'amount', '2,00.00');
  await f.click(f.elements.calculate);
  assert.match(f.elements.difference.textContent, /Receipt 2: Invalid amount "2,00\.00"\..*Correct it before running Find Best Match\./);
  assert.equal(f.elements.exportSelected.disabled, true);
  await f.type(f.rows()[1], 'amount', '2,000.00'); f.elements.target.value = '2,100';
  await f.click(f.elements.calculate);
  assert.match(f.elements.resultTitle.textContent, /match/i);
  assert.equal(f.elements.resultAmount.textContent.replace(/\s/g, ''), '₱2,100.00', 'grouped amounts calculate as exact centavos (₱100 + ₱2,000)');
});

test('Receipt Optimization export sends the normalized amount: "1,250.50" reaches the workbook as 1250.50, never blank', async () => {
  const f = await fixture({ loaded: [{ dbId: 'r1', amount: 1250.5, store: 'A' }, { dbId: 'r2', amount: 12500, store: 'B' }] });
  await f.type(f.rows()[0], 'amount', '1,250.50'); await f.type(f.rows()[1], 'amount', '12,500');
  f.elements.target.value = '13750.50'; await f.click(f.elements.calculate);
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)');
  await f.click(f.elements.exportSelected); await f.click(f.elements.confirmExport);
  assert.equal(f.calls.download.length, 1);
  assert.deepEqual(f.calls.download[0].map(item => [item.dbId, item.amount]), [['r1', '1250.50'], ['r2', '12500.00']]);
  const workbookAmounts = buildExpenseDetailedReportRows(f.calls.download[0]).slice(2).map(row => row[7]);
  assert.deepEqual(workbookAmounts, [1250.5, 12500]);
  assert.deepEqual(f.calls.consume, [['r1', 'r2']], 'the exact selected IDs are marked Consumed');
});

test('an amount that became malformed after the calculation cannot produce a misleading export', async () => {
  const f = await fixture({ loaded: [{ dbId: 'r1', amount: 100, store: 'A' }, { dbId: 'r2', amount: 200, store: 'B' }] });
  f.elements.target.value = '300'; await f.click(f.elements.calculate);
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)');
  await f.type(f.rows()[1], 'amount', '2,00'); // edited after the result was produced
  await f.click(f.elements.exportSelected);
  // Any amount edit clears the selection (existing behaviour), so the export is refused outright; the explicit invalid-amount guard is a second layer.
  assert.equal(f.elements.exportSelected.disabled, true); assert.match(f.elements.difference.textContent, /Run Find Best Match/);
  await f.click(f.elements.confirmExport);
  assert.equal(f.calls.download.length, 0, 'even a forced confirmation cannot export'); assert.equal(f.calls.consume.length, 0);
});

test('the Edit receipt dialog validates the amount too and keeps the dialog open with the typed value', async () => {
  const f = await fixture({ loaded: [{ dbId: 'r1', amount: 100, store: 'A' }] });
  f.elements.editModal.dataset.receiptIndex = '0';
  Object.assign(f.elements.editAmount, { value: '1,250.5.0' });
  for (const [key, value] of Object.entries({ editReceiptDate: '', editVat: '', editInvoice: '', editStore: 'A', editAddress: '', editTin: '' })) f.elements[key].value = value;
  f.elements.editModal.hidden = false;
  await f.elements.editForm.emit('submit', { submitter: null }); await settle();
  assert.match(f.elements.editFeedback.textContent, /Could not save correction: Invalid amount "1,250\.5\.0"\./);
  assert.equal(f.calls.update.length, 0); assert.equal(f.elements.editModal.hidden, false); assert.equal(f.elements.editAmount.value, '1,250.5.0');
  f.elements.editAmount.value = '1,250.50';
  await f.elements.editForm.emit('submit', { submitter: null }); await settle();
  assert.deepEqual(f.calls.update.map(([id, values]) => [id, values.amount]), [['r1', '1,250.50']], 'valid grouped amount goes to the validating service');
});

// ---- protected invariants stay untouched ------------------------------------------------------------------------------------------------------
test('the financial engine, export builder and database schema are unchanged by this correction', async () => {
  const engine = await read('../services/optimizationService.js');
  assert.match(engine, /export const MAXIMUM_EXCESS_CENTS = 5000;/);
  assert.match(engine, /export function toCents\(value\) \{ const number = Number\(String\(value\)\.replace\(\/\[\^0-9\.\]\/g, ''\)\); return Number\.isFinite\(number\) \? Math\.round\(number \* 100\) : 0; \}/);
  const exporter = await read('../services/exportService.js');
  assert.match(exporter, /export const numericAmount = value => \{\s*const parsed = parseMoneyAmount\(value\);/, 'CP10-C3: the builder reuses the strict parser instead of Number()');
  assert.doesNotMatch(exporter, /Number\(String\(value/);
  const ui = await read('../ui/receiptUi.js');
  // Issue #27: the runner step is now guarded by its session, but still hands the database snapshot rows to the same exporter function.
  assert.ok(ui.includes('generateWorkbook: rows => { if (!live()) throw ended(); return downloadSelectedReceipts(rows); }'), 'the same exporter function receives the workbook rows (now database snapshot rows)');
});

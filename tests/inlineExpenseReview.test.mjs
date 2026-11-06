// Issue #56: Expense Account / Classification of Expense completed inside Review & Arrange (Feature A), and the two added classifications (Feature B).
// Driven through the real receipt UI against the in-memory receipts database of the shared fixture.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { receiptFixture } from './helpers/receiptUiFixture.mjs';
import { classificationOptions, expenseAccountOptions, expenseExportProblems, filterOptions, isClassification, isExpenseAccount, missingExpenseFields } from '../domain/expenseClassification.js';
import { fromDatabaseReceipt, toDatabaseReceipt } from '../services/receiptService.js';
import { fromDatabaseMonthlyFilingReceipt, toDatabaseMonthlyFilingReceipt } from '../services/monthlyFilingService.js';
import { buildExpenseDetailedReportRows, createExpenseDetailedReportWorkbook } from '../services/exportService.js';
import { read, write } from '../vendor/sheetjs/xlsx-0.20.3.mjs';

const blank = { expenseAccount: '', classification: '' };
const incomplete = () => [
  { dbId: 'r1', amount: 100, store: 'Store A', invoice: 'INV-1', receiptDate: '2026-08-01', ...blank },
  { dbId: 'r2', amount: 200, store: 'Store B', invoice: 'INV-2', receiptDate: '2026-08-02', ...blank },
  { dbId: 'r3', amount: 300, store: 'Store C', ...blank },
  { dbId: 'r4', amount: 400, store: 'Store D', ...blank }
];
const open = async (f, target = '1000') => { f.elements.target.value = target; await f.click(f.elements.calculate); await f.click(f.elements.exportSelected); return f; };
const dialogOpen = f => f.elements.exportConfirmModal.hidden === false;
const items = f => f.elements.exportReviewList.children;
const order = f => items(f).map(item => item.dataset.receiptId);
const parts = (f, id) => items(f).find(item => item.dataset.receiptId === id).reviewParts;
const choose = async (f, id, control, value) => { parts(f, id)[control].value = value; await parts(f, id)[control].emit('change'); };
const complete = async (f, ids, classification = 'Meals') => { for (const id of ids) { await choose(f, id, 'account', 'Day to day'); await choose(f, id, 'classification', classification); } };
const confirm = f => f.click(f.elements.confirmExport);
const readiness = f => f.elements.exportReviewReadiness.textContent;
const otherSession = (f, id, changes) => f.db.set(id, { ...f.db.get(id), ...changes, updatedAt: f.stamp() });

// ---------------- Feature B: Service Charge and Government Benefits ----------------

test('B1, B8: exactly 41 classifications; the original 39 are unchanged and the two new ones come last, in the approved order', () => {
  assert.equal(classificationOptions.length, 41);
  assert.equal(new Set(classificationOptions).size, 41);
  assert.deepEqual(classificationOptions.slice(39), ['Service Charge', 'Government Benefits']);
  assert.equal(classificationOptions[0], 'Accomodation'); assert.equal(classificationOptions[38], 'Water');
  for (const original of classificationOptions.slice(0, 39)) assert.equal(isClassification(original), true);
});

test('B2, B3: both new values are valid classifications, are found by autocomplete, and are NOT Expense Account options', () => {
  for (const value of ['Service Charge', 'Government Benefits']) {
    assert.equal(isClassification(value), true);
    assert.equal(isExpenseAccount(value), false);
    assert.equal(expenseAccountOptions.includes(value), false);
  }
  assert.deepEqual(filterOptions(classificationOptions, 'serv'), ['Service Charge']);
  assert.deepEqual(filterOptions(classificationOptions, 'gov'), ['Government Benefits']);
  assert.ok(filterOptions(classificationOptions, 'benefit').includes('Government Benefits'), 'a word anywhere in the name matches');
  assert.ok(filterOptions(classificationOptions, 'charge').includes('Service Charge'));
  assert.deepEqual([...expenseAccountOptions], ['Day to day', 'Project Expense']);
});

test('B2: export validation accepts both values and still rejects an unknown one', () => {
  for (const classification of ['Service Charge', 'Government Benefits']) {
    assert.deepEqual(missingExpenseFields({ expenseAccount: 'Project Expense', classification }), []);
    assert.deepEqual(expenseExportProblems([{ label: 'Receipt 1', receipt: { expenseAccount: 'Day to day', classification } }]), []);
  }
  assert.deepEqual(missingExpenseFields({ expenseAccount: 'Day to day', classification: 'service charge' }), ['classification'], 'membership stays exact');
});

test('B4, B5: both values survive the database model conversion for receipts and for Monthly Filing, and nothing is rewritten', () => {
  for (const classification of ['Service Charge', 'Government Benefits']) {
    const receipt = { store: 'S', amount: '10', expenseAccount: 'Day to day', classification };
    assert.equal(toDatabaseReceipt(receipt, 'u').classification_of_expense, classification);
    assert.equal(fromDatabaseReceipt({ id: 'r', ...toDatabaseReceipt(receipt, 'u'), status: 'available' }).classification, classification);
    assert.equal(toDatabaseMonthlyFilingReceipt(receipt, 'u').classification_of_expense, classification);
    assert.equal(fromDatabaseMonthlyFilingReceipt({ id: 'm', ...toDatabaseMonthlyFilingReceipt(receipt, 'u'), status: 'active' }).classification, classification);
  }
});

test('B4, B5: Receipt Encoding and Monthly Filing build their classification choices from the one shared list (no second hard-coded list)', async () => {
  for (const file of ['../ui/receiptUi.js', '../ui/monthlyFilingUi.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /options: classificationOptions/, file);
    assert.doesNotMatch(source, /Service Charge|Government Benefits/, `${file} must not repeat the values`);
  }
  const review = await readFile(new URL('../ui/exportReview.js', import.meta.url), 'utf8');
  assert.doesNotMatch(review, /Service Charge|Government Benefits|Accomodation/);
});

test('B7: the generated Excel workbook carries both new classifications exactly', () => {
  const rows = ['Service Charge', 'Government Benefits'].map((classification, index) => ({ dbId: `r${index}`, store: `S${index}`, amount: '10.00', receiptDate: '2026-07-13', invoice: `${index}`, expenseAccount: 'Project Expense', classification }));
  assert.deepEqual(buildExpenseDetailedReportRows(rows).slice(2).map(row => row.slice(8, 10)), [['Project Expense', 'Service Charge'], ['Project Expense', 'Government Benefits']]);
  const reopened = read(write(createExpenseDetailedReportWorkbook(rows), { bookType: 'xlsx', type: 'array', cellDates: true }), { type: 'array', cellDates: true });
  const sheet = reopened.Sheets['Expense Detailed Report'];
  assert.deepEqual([sheet.I3.v, sheet.J3.v, sheet.I4.v, sheet.J4.v], ['Project Expense', 'Service Charge', 'Project Expense', 'Government Benefits']);
});

test('B6: both new classifications can be chosen in Review & Arrange and are saved and exported', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete().slice(0, 2) }), '300');
  await choose(f, 'r1', 'account', 'Project Expense'); await choose(f, 'r1', 'classification', 'Service Charge');
  await choose(f, 'r2', 'account', 'Day to day'); await choose(f, 'r2', 'classification', 'Government Benefits');
  await confirm(f);
  assert.deepEqual([f.db.get('r1').classification, f.db.get('r2').classification], ['Service Charge', 'Government Benefits']);
  assert.deepEqual(f.calls.download[0].map(item => item.classification), ['Service Charge', 'Government Benefits']);
  assert.deepEqual(f.calls.consume, [['r1', 'r2']]);
});

// ---------------- Feature A: inline completion in Review & Arrange ----------------

test('A1: four receipts without expense fields open Review & Arrange; completing them there exports without a new Find Best Match', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete() }));
  assert.equal(dialogOpen(f), true);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']);
  assert.equal(readiness(f), 'Export readiness: 0 of 4 receipts complete');
  assert.equal(f.elements.exportGoToEncoding.hidden, true, 'no trip back to Encoding is offered');
  const title = f.elements.resultTitle.textContent; const calculations = f.calls.snapshot.length;
  await complete(f, ['r1', 'r2', 'r3', 'r4']);
  assert.equal(readiness(f), 'Export readiness: 4 of 4 receipts complete');
  assert.equal(f.elements.confirmExport.textContent, 'Save Details & Export');
  assert.equal(f.calls.expenseSave, undefined, 'choosing a value writes nothing');
  await confirm(f);
  assert.equal(dialogOpen(f), false);
  assert.deepEqual(f.calls.expenseSave.map(([id, values]) => [id, values]), ['r1', 'r2', 'r3', 'r4'].map(id => [id, { expenseAccount: 'Day to day', classification: 'Meals' }]));
  assert.equal(f.calls.download.length, 1);
  assert.deepEqual(f.calls.download[0].map(item => [item.dbId, item.expenseAccount, item.classification]), ['r1', 'r2', 'r3', 'r4'].map(id => [id, 'Day to day', 'Meals']));
  assert.deepEqual(f.calls.consume, [['r1', 'r2', 'r3', 'r4']]);
  assert.deepEqual(['r1', 'r2', 'r3', 'r4'].map(id => f.db.get(id).status), Array(4).fill('consumed'));
  assert.notEqual(f.elements.resultTitle.textContent, title);
  assert.equal(f.calls.update.length, 0, 'a full-receipt update was never used');
  assert.equal(f.calls.snapshot.length >= calculations, true);
});

test('A2: export stays blocked until every selected receipt is complete, and nothing is written meanwhile', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete() }));
  await complete(f, ['r1', 'r2']);
  assert.equal(readiness(f), 'Export readiness: 2 of 4 receipts complete');
  await choose(f, 'r3', 'account', 'Project Expense'); // half of a receipt is still incomplete
  await confirm(f);
  assert.equal(dialogOpen(f), true);
  assert.match(f.elements.exportConfirmMessage.textContent, /^Receipt 3, Receipt 4 still need an Expense Account and a Classification of Expense\. Nothing was saved or exported\.$/);
  assert.equal(f.focusLog.at(-1), parts(f, 'r3').classification, 'focus goes to the first missing field');
  assert.equal(f.calls.expenseSave, undefined); assert.equal(f.calls.download.length, 0); assert.equal(f.calls.consume.length, 0);
  assert.equal(f.db.get('r1').classification, '', 'completed fields are not saved before the whole selection is ready');
  assert.ok(parts(f, 'r3').classification.attrs['aria-invalid']);
  assert.equal(parts(f, 'r1').classification.attrs['aria-invalid'], undefined);
});

test('A2: only the exact selected receipts count toward readiness and are validated', async () => {
  const loaded = [...incomplete().slice(0, 2), { dbId: 'r9', amount: 5000, store: 'Not selected', ...blank }];
  const f = await open(await receiptFixture({ loaded }), '300');
  assert.deepEqual(order(f), ['r1', 'r2']);
  assert.equal(readiness(f), 'Export readiness: 0 of 2 receipts complete');
  await complete(f, ['r1', 'r2']);
  await confirm(f);
  assert.deepEqual(f.calls.consume, [['r1', 'r2']]);
  assert.deepEqual(f.calls.expenseSave.map(([id]) => id), ['r1', 'r2']);
  assert.equal(f.db.get('r9').status, 'available'); assert.equal(f.db.get('r9').classification, '');
});

test('A2: only receipts that changed are written, and a complete receipt is left alone', async () => {
  const loaded = incomplete(); loaded[1] = { ...loaded[1], expenseAccount: 'Project Expense', classification: 'Water' };
  const f = await open(await receiptFixture({ loaded }));
  assert.equal(readiness(f), 'Export readiness: 1 of 4 receipts complete');
  await complete(f, ['r1', 'r3', 'r4']);
  await confirm(f);
  assert.deepEqual(f.calls.expenseSave.map(([id]) => id), ['r1', 'r3', 'r4']);
  assert.deepEqual(f.calls.download[0].find(item => item.dbId === 'r2').classification, 'Water');
});

test('A2: a receipt that was already complete exports exactly as before: no save step, the usual button label', async () => {
  const loaded = incomplete().map(item => ({ ...item, expenseAccount: 'Day to day', classification: 'Others' }));
  const f = await open(await receiptFixture({ loaded }));
  assert.equal(readiness(f), 'Export readiness: 4 of 4 receipts complete');
  assert.equal(f.elements.confirmExport.textContent, 'Export & Mark Consumed');
  await confirm(f);
  assert.equal(f.calls.expenseSave, undefined); assert.equal(f.calls.download.length, 1); assert.equal(f.calls.consume.length, 1);
});

test('A3: edits survive reordering, and the workbook follows the chosen order with the edited values', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete() }));
  await choose(f, 'r1', 'account', 'Project Expense'); await choose(f, 'r1', 'classification', 'Government Benefits');
  await choose(f, 'r2', 'classification', 'Water');
  await parts(f, 'r4').up.emit('click'); await parts(f, 'r4').handle.emit('keydown', { key: 'Home' });
  assert.deepEqual(order(f), ['r4', 'r1', 'r2', 'r3']);
  assert.deepEqual([parts(f, 'r1').account.value, parts(f, 'r1').classification.value, parts(f, 'r2').account.value, parts(f, 'r2').classification.value], ['Project Expense', 'Government Benefits', '', 'Water'], 'values typed before the move are still there');
  await f.elements.exportReviewReset.emit('click');
  assert.equal(parts(f, 'r1').classification.value, 'Government Benefits', 'Reset order keeps the edits too');
  await complete(f, ['r3', 'r4']); await choose(f, 'r2', 'account', 'Day to day');
  await parts(f, 'r3').handle.emit('keydown', { key: 'Home' });
  await confirm(f);
  assert.deepEqual(f.calls.download[0].map(item => item.dbId), ['r3', 'r1', 'r2', 'r4']);
  assert.deepEqual(f.calls.download[0].map(item => item.classification), ['Meals', 'Government Benefits', 'Water', 'Meals']);
});

test('A3: after a field is chosen focus stays on that field, and the choice is announced', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete() }));
  await choose(f, 'r2', 'classification', 'Water');
  assert.equal(f.focusLog.at(-1), parts(f, 'r2').classification);
  assert.match(f.elements.exportReviewAnnouncer.textContent, /^0 of 4 receipts ready to export\.\s?$/);
});

test('A4: Cancel discards what was typed in the dialog; no database call, no workbook, nothing consumed; reopening starts from the saved values', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete() }));
  const before = JSON.stringify([...f.db.values()]);
  await complete(f, ['r1', 'r2', 'r3', 'r4']);
  await f.click(f.elements.cancelExport);
  assert.equal(dialogOpen(f), false);
  assert.equal(f.calls.expenseSave, undefined); assert.equal(f.calls.download.length, 0); assert.equal(f.calls.consume.length, 0);
  assert.equal(JSON.stringify([...f.db.values()]), before);
  await f.click(f.elements.exportSelected);
  assert.equal(readiness(f), 'Export readiness: 0 of 4 receipts complete');
  assert.equal(parts(f, 'r1').classification.value, '');
});

test('A4: Cancel and Escape cannot interrupt a save that is running', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete().slice(0, 2) }), '300');
  await complete(f, ['r1', 'r2']);
  let release; f.fails.expenseSaveGate = new Promise(resolve => { release = resolve; });
  const running = f.elements.confirmExport.emit('click');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.elements.cancelExport.disabled, true);
  assert.equal(parts(f, 'r1').classification.disabled, true, 'fields are locked while saving');
  assert.equal(f.elements.confirmExport.disabled, true, 'no second submission is possible');
  await f.elements.confirmExport.emit('click');
  await f.elements.cancelExport.emit('click');
  assert.equal(dialogOpen(f), true, 'the dialog stays open while the operation runs');
  release(); await running; await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.calls.expenseSave.length, 2, 'the second click did not start a second save');
  assert.equal(f.calls.download.length, 1); assert.deepEqual(f.calls.consume, [['r1', 'r2']]);
  assert.equal(dialogOpen(f), false);
});

test('A5: a failed save generates no workbook and consumes nothing; receipts saved before the failure are reported as saved, not as rolled back', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete() }));
  await complete(f, ['r1', 'r2', 'r3', 'r4']);
  f.fails.expenseSave = { when: id => id === 'r3', error: new Error('Simulated write failure') };
  await confirm(f);
  assert.equal(f.calls.download.length, 0); assert.equal(f.calls.consume.length, 0);
  assert.deepEqual(['r1', 'r2', 'r3', 'r4'].map(id => f.db.get(id).status), Array(4).fill('available'));
  assert.deepEqual(f.calls.expenseSave.map(([id]) => id), ['r1', 'r2', 'r3'], 'it stopped at the failure');
  assert.equal(dialogOpen(f), true, 'the dialog stays open so the user can retry');
  const message = f.elements.exportConfirmMessage.textContent;
  assert.match(message, /Could not save the details of Receipt 3: Simulated write failure\./);
  assert.match(message, /Receipt 1 and Receipt 2 were already saved and stay saved\./);
  assert.match(message, /Nothing was exported and no receipt was marked Consumed\./);
  assert.doesNotMatch(message, /rolled back/i);
  assert.deepEqual([f.db.get('r1').classification, f.db.get('r2').classification, f.db.get('r3').classification], ['Meals', 'Meals', ''], 'the database holds exactly what was really saved');
  assert.equal(f.elements.confirmExport.disabled, false); assert.equal(f.elements.cancelExport.disabled, false);
  f.fails.expenseSave = null;
  await confirm(f);
  assert.deepEqual(f.calls.expenseSave.slice(3).map(([id]) => id), ['r3', 'r4'], 'a retry saves only what is still unsaved');
  assert.equal(f.calls.download.length, 1); assert.deepEqual(f.calls.consume, [['r1', 'r2', 'r3', 'r4']]);
});

test('A5: when the saved values cannot be confirmed by the read-back, nothing is exported', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete().slice(0, 2) }), '300');
  await complete(f, ['r1', 'r2']);
  // the database accepts the write, but what it holds afterwards is not what was written (for example a trigger or another session blanked it)
  const store = f.db.set.bind(f.db);
  f.db.set = (id, row) => store(id, id === 'r2' && row.classification === 'Meals' ? { ...row, classification: '' } : row);
  await confirm(f);
  assert.equal(f.calls.download.length, 0); assert.equal(f.calls.consume.length, 0);
  assert.match(f.elements.exportConfirmMessage.textContent, /saved details of Receipt 2 could not be confirmed/);
  assert.match(f.elements.exportConfirmMessage.textContent, /Receipt 1 and Receipt 2 were already saved and stay saved\./);
});

test('A6: another session consumed a selected receipt before Save Details & Export: nothing is exported and the result is marked out of date', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete() }));
  await complete(f, ['r1', 'r2', 'r3', 'r4']);
  otherSession(f, 'r3', { status: 'consumed' });
  await confirm(f);
  assert.equal(f.calls.download.length, 0); assert.equal(f.calls.consume.length, 0);
  assert.equal(f.db.get('r3').expenseAccount, '', 'the consumed receipt was not edited');
  assert.equal(dialogOpen(f), false);
  assert.match(f.elements.difference.textContent, /Receipt 3 is no longer Available/);
  assert.match(f.elements.difference.textContent, /already saved and stay saved/, 'what was saved before the stop is reported');
});

test('A6: another session edited a selected receipt: its details are not overwritten; the user reviews the new values and confirms again', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete() }));
  await complete(f, ['r1', 'r2', 'r3', 'r4']);
  otherSession(f, 'r2', { classification: 'Hotel', expenseAccount: 'Project Expense' });
  await confirm(f);
  assert.equal(f.calls.download.length, 0); assert.equal(f.calls.consume.length, 0);
  assert.deepEqual([f.db.get('r2').expenseAccount, f.db.get('r2').classification], ['Project Expense', 'Hotel'], "the other session's values are intact");
  assert.equal(dialogOpen(f), true);
  assert.match(f.elements.exportConfirmMessage.textContent, /Receipt 2 was changed in another session, so its details were not saved\./);
  assert.match(f.elements.exportConfirmMessage.textContent, /Receipt 1 was already saved and stays saved\./);
  assert.equal(f.elements.exportReviewAck.hidden, false); assert.equal(f.elements.confirmExport.disabled, true);
  assert.match(items(f).find(item => item.dataset.receiptId === 'r2').children[1].children[2].textContent, /Updated since selection/);
  assert.equal(parts(f, 'r2').classification.value, 'Meals', 'the typed choice is kept and shown');
  f.elements.exportReviewAckInput.checked = true; await f.elements.exportReviewAckInput.emit('change');
  await confirm(f);
  assert.deepEqual(f.calls.consume, [['r1', 'r2', 'r3', 'r4']]);
  assert.equal(f.db.get('r2').classification, 'Meals', 'only after the explicit acknowledgement is the choice saved');
});

test('A6: another session changed an amount: the optimizer result is out of date, nothing is exported', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete() }));
  await complete(f, ['r1', 'r2', 'r3', 'r4']);
  otherSession(f, 'r4', { amount: 450 });
  await confirm(f);
  assert.equal(f.calls.download.length, 0); assert.equal(f.calls.consume.length, 0);
  assert.equal(dialogOpen(f), false);
  assert.equal(f.elements.resultTitle.textContent, 'Result out of date');
});

test('A6: a receipt consumed by another session right after the details were saved is caught by the read-back; it never reaches the workbook', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete().slice(0, 2) }), '300');
  await complete(f, ['r1', 'r2']);
  const store = f.db.set.bind(f.db);
  f.db.set = (id, row) => { store(id, row); if (id === 'r2' && row.classification === 'Meals') store('r1', { ...f.db.get('r1'), status: 'consumed', updatedAt: f.stamp() }); };
  await confirm(f);
  assert.equal(f.calls.download.length, 0);
  assert.equal(f.calls.consume.length, 0);
  assert.match(f.elements.difference.textContent, /Receipt 1 is no longer Available/);
});

test('A7: changing only the expense fields keeps the optimized combination, its order and the result panel', async () => {
  const f = await receiptFixture({ loaded: incomplete() });
  f.elements.target.value = '600'; await f.click(f.elements.calculate);
  const result = { title: f.elements.resultTitle.textContent, amount: f.elements.resultAmount.textContent, label: f.elements.exportSelected.textContent };
  const selected = f.cards().filter(card => card.classList.contains('is-selected')).length;
  await f.click(f.elements.exportSelected);
  const ids = order(f);
  await complete(f, ids);
  await f.click(f.elements.cancelExport);
  assert.deepEqual({ title: f.elements.resultTitle.textContent, amount: f.elements.resultAmount.textContent, label: f.elements.exportSelected.textContent }, result);
  assert.equal(f.cards().filter(card => card.classList.contains('is-selected')).length, selected);
  await f.click(f.elements.exportSelected); await complete(f, ids); await confirm(f);
  assert.deepEqual(f.calls.consume, [ids], 'exactly the originally optimized receipts, without another Find Best Match');
  assert.equal(f.elements.resultTitle.textContent, 'Export complete');
});

test('A7: the saved receipts on screen show their new values and update time (no stale "unsaved" state) even when the export itself then fails', async () => {
  const f = await open(await receiptFixture({ loaded: incomplete().slice(0, 2) }), '300');
  await complete(f, ['r1', 'r2']);
  f.fails.download = new Error('Simulated workbook failure'); // the details were saved, then the workbook could not be built
  await confirm(f);
  assert.equal(f.calls.consume.length, 0, 'no receipt is consumed without a workbook');
  assert.deepEqual(['r1', 'r2'].map(id => f.db.get(id).status), ['available', 'available']);
  const row = f.rows().find(item => f.field(item, 'store').value === 'Store A');
  assert.deepEqual([f.field(row, 'expenseAccount').value, f.field(row, 'classification').value], ['Day to day', 'Meals']);
  assert.equal(row.dataset.receiptUpdatedAt, f.db.get('r1').updatedAt);
  assert.notEqual(row.dataset.unsavedKind, 'changes');
});

test('A8: Manual Selection opens the same dialog, accepts inline details and exports the picked order', async () => {
  const f = await receiptFixture({ loaded: incomplete() });
  f.elements.exportModeManual.checked = true; f.elements.exportModeBestMatch.checked = false; await f.elements.exportModeManual.emit('change');
  for (const store of ['Store C', 'Store A']) await f.cards().find(card => card.part('.compact-store').textContent === store).part('.manual-select').emit('change');
  await f.click(f.elements.manualExportSelected);
  assert.equal(dialogOpen(f), true);
  assert.deepEqual(order(f), ['r3', 'r1']);
  await complete(f, ['r1', 'r3'], 'Service Charge');
  await confirm(f);
  assert.deepEqual(f.calls.download[0].map(item => [item.dbId, item.classification]), [['r3', 'Service Charge'], ['r1', 'Service Charge']]);
  assert.deepEqual(f.calls.consume, [['r3', 'r1']]);
});

test('A8: an unsaved edit still blocks the review (and offers Go to Encoding); only the expense fields were relaxed', async () => {
  const f = await receiptFixture({ loaded: incomplete() });
  f.elements.target.value = '1000'; await f.click(f.elements.calculate);
  await f.type(f.rows()[0], 'amount', '100.50');
  await f.click(f.elements.exportSelected);
  assert.equal(dialogOpen(f), false);
});

test('A1/A8: a stored value that is not an approved option is shown as invalid and must be replaced before export', async () => {
  const loaded = incomplete().slice(0, 1).map(item => ({ ...item, expenseAccount: 'Day to day', classification: 'Accommodation' }));
  const f = await open(await receiptFixture({ loaded }), '100');
  assert.equal(readiness(f), 'Export readiness: 0 of 1 receipt complete');
  assert.ok(parts(f, 'r1').classification.attrs['aria-invalid']);
  await confirm(f);
  assert.equal(f.calls.download.length, 0);
  await choose(f, 'r1', 'classification', 'Accomodation');
  await confirm(f);
  assert.equal(f.calls.download.length, 1);
});

test('the review markup has a readiness status line and the Review & Arrange dialog is still the only export dialog', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="exportReviewReadiness"[^>]*role="status"/);
  assert.equal((html.match(/id="exportConfirmModal"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Save Details &amp; Export<\/button>/, 'the label is set by the UI so the Cancel/Confirm wiring is unchanged');
});

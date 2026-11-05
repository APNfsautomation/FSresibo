// Issue #58: Expense Account / Classification of Expense completed inside the existing Monthly Filing Review & Arrange dialog.
// The real Monthly Filing UI and the real review dialog run against an in-memory monthly_filing_receipts table (fixture mocks; no Supabase).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMonthlyExportReview } from '../ui/monthlyExportReview.js';
import { monthlyFixture, savedMonthly } from './helpers/monthlyFilingUiFixture.mjs';
import { formatMonthlyFilingCents } from '../ui/monthlyFilingUi.js';
import { createExpenseDetailedReportWorkbook } from '../services/exportService.js';
import { updateMonthlyFilingExpenseFields } from '../services/monthlyFilingService.js';

const user = { id: 'user-1' };
const blank = { expenseAccount: '', classification: '' };
const tick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));

function node(extra = {}) {
  const self = { hidden: false, disabled: false, textContent: '', className: '', dataset: {}, attrs: {}, listeners: {}, children: [], style: {}, value: '', checked: false,
    classList: { classes: new Set(), add(name) { this.classes.add(name); }, remove(name) { this.classes.delete(name); }, toggle(name, on) { on ? this.classes.add(name) : this.classes.delete(name); }, contains(name) { return this.classes.has(name); } },
    setAttribute(name, value) { self.attrs[name] = String(value); }, getAttribute: name => self.attrs[name] ?? null, removeAttribute(name) { delete self.attrs[name]; },
    addEventListener(name, listener) { (self.listeners[name] ??= []).push(listener); }, emit(name, event = {}) { return Promise.all((self.listeners[name] ?? []).map(listener => listener({ currentTarget: self, target: self, preventDefault() {}, ...event }))); },
    append(...items) { self.children.push(...items); }, replaceChildren(...items) { self.children = items; }, focus() { focusLog.push(self); }, getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0, left: 0, right: 0 }),
    parentElement: null, contains: () => false, querySelector: () => null, querySelectorAll: () => [], ...extra };
  return self;
}
let focusLog = [];

// A real review dialog on fake nodes, wired into the real Monthly Filing UI.
async function setup(records) {
  focusLog = [];
  const els = { modal: node({ hidden: true }), backdrop: node(), message: node(), list: node(), announcer: node(), readiness: node({ hidden: true }), resetButton: node(), confirmButton: node({ textContent: 'Export & Archive' }), cancelButton: node(),
    summary: { count: node(), total: node(), noAmountGroup: node({ hidden: true }), noAmount: node() } };
  const modalFocus = { open: () => {}, close: () => {} };
  const review = createMonthlyExportReview({ ...els, modalFocus, format: formatMonthlyFilingCents, createElement: () => node() });
  review.start();
  const f = monthlyFixture({ records, exportReview: review });
  await f.ui.loadForUser(user);
  const items = () => els.list.children; const order = () => items().map(item => item.dataset.receiptId);
  const parts = id => items().find(item => item.dataset.receiptId === id).reviewParts;
  const choose = async (id, control, value) => { parts(id)[control].value = value; await parts(id)[control].emit('change'); };
  const complete = async (ids, classification = 'Meals', account = 'Day to day') => { for (const id of ids) { await choose(id, 'account', account); await choose(id, 'classification', classification); } };
  const start = async () => { const run = f.elements.exportActive.emit('click', { currentTarget: f.elements.exportActive }); await tick(); return () => run; };
  const confirm = async () => { await els.confirmButton.emit('click'); await tick(); };
  const open = () => els.modal.hidden === false;
  return { ...f, els, review, items, order, parts, choose, complete, start, confirm, open, readiness: () => els.readiness.textContent };
}
const four = () => [savedMonthly('a', { store: 'Alpha', amount: '100', ...blank }), savedMonthly('b', { store: 'Beta', amount: '200', ...blank }), savedMonthly('c', { store: 'Gamma', amount: '300', ...blank }), savedMonthly('d', { store: 'Delta', amount: '400', ...blank })];
const otherSession = (f, id, changes) => f.table.set(id, { ...f.table.get(id), ...changes, updatedAt: f.stamp() });

test('M1, M2, M5, M10: four Active receipts without expense fields open the review; completing and reordering them exports one workbook in that order and archives exactly them', async () => {
  const f = await setup(four());
  const run = await f.start();
  assert.equal(f.open(), true, 'the review opens although every receipt lacks both fields');
  const stamps = Object.fromEntries([...f.table.values()].map(record => [record.dbId, record.updatedAt])); // what the pre-review save left in the table
  assert.deepEqual(f.order(), ['a', 'b', 'c', 'd']);
  assert.equal(f.readiness(), 'Export readiness: 0 of 4 receipts complete');
  assert.equal(f.els.confirmButton.textContent, 'Export & Archive');
  await f.complete(['a', 'b', 'c', 'd']);
  assert.equal(f.readiness(), 'Export readiness: 4 of 4 receipts complete');
  assert.equal(f.els.confirmButton.textContent, 'Save Details & Export');
  assert.equal(f.calls.expenseSave.length, 0, 'choosing values writes nothing');
  await f.parts('d').handle.emit('keydown', { key: 'Home' }); await f.parts('b').down.emit('click');
  assert.deepEqual(f.order(), ['d', 'a', 'c', 'b']);
  await f.confirm(); await run();
  assert.equal(f.open(), false);
  assert.equal(f.calls.workbook.length, 1);
  assert.deepEqual(f.calls.workbook[0].map(record => [record.dbId, record.expenseAccount, record.classification]), ['d', 'a', 'c', 'b'].map(id => [id, 'Day to day', 'Meals']));
  const sheet = createExpenseDetailedReportWorkbook(f.calls.workbook[0]).Sheets['Expense Detailed Report'];
  assert.deepEqual([3, 4, 5, 6].map(row => [sheet[`A${row}`].v, sheet[`C${row}`].v, sheet[`I${row}`].v, sheet[`J${row}`].v]), [[1, 'Delta', 'Day to day', 'Meals'], [2, 'Alpha', 'Day to day', 'Meals'], [3, 'Gamma', 'Day to day', 'Meals'], [4, 'Beta', 'Day to day', 'Meals']]);
  assert.deepEqual(f.calls.archive, [['d', 'a', 'c', 'b']]);
  assert.ok([...f.table.values()].every(record => record.status === 'archived'));
  assert.deepEqual(f.calls.expenseSave.map(([id, values, expected]) => [id, values, expected]), ['d', 'a', 'c', 'b'].map(id => [id, { expenseAccount: 'Day to day', classification: 'Meals' }, stamps[id]]), 'targeted writes in the confirmed order, each guarded by the last known updated_at');
  assert.equal(f.calls.update.length, 4, 'only the existing pre-review save wrote whole receipts (and nothing at the end)');
  assert.match(f.elements.feedback.textContent, /^Exported and archived 4 Monthly Filing receipts/);
});

test('M3: with only two of four complete, Export keeps the dialog open, focuses the first incomplete field, and writes, generates and archives nothing', async () => {
  const f = await setup(four());
  const run = await f.start();
  await f.complete(['a', 'b']);
  assert.equal(f.readiness(), 'Export readiness: 2 of 4 receipts complete');
  await f.choose('c', 'account', 'Project Expense'); // half of a receipt
  await f.confirm();
  assert.equal(f.open(), true);
  assert.match(f.els.message.textContent, /^Receipt 3, Receipt 4 still need an Expense Account and a Classification of Expense\. Nothing was saved, exported or archived\.$/);
  assert.equal(focusLog.at(-1), f.parts('c').classification, 'focus: the first field that is still missing');
  assert.ok(f.parts('c').classification.attrs['aria-invalid']); assert.equal(f.parts('a').classification.attrs['aria-invalid'], undefined);
  assert.equal(f.calls.expenseSave.length, 0); assert.equal(f.calls.workbook.length, 0); assert.equal(f.calls.archive.length, 0);
  assert.equal(f.table.get('a').classification, '', 'the completed fields were not saved');
  f.review.cancel(); await run();
});

test('M4: classification edits stay with their receipt through moves, Reset order and drag-free keyboard reordering', async () => {
  const f = await setup(four());
  const run = await f.start();
  await f.choose('a', 'account', 'Project Expense'); await f.choose('a', 'classification', 'Government Benefits'); await f.choose('b', 'classification', 'Service Charge');
  await f.parts('d').up.emit('click'); await f.parts('d').handle.emit('keydown', { key: 'Home' });
  assert.deepEqual(f.order(), ['d', 'a', 'b', 'c']);
  assert.deepEqual(['a', 'b'].map(id => [f.parts(id).account.value, f.parts(id).classification.value]), [['Project Expense', 'Government Benefits'], ['', 'Service Charge']]);
  await f.els.resetButton.emit('click');
  assert.deepEqual(f.order(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(['a', 'b'].map(id => [f.parts(id).account.value, f.parts(id).classification.value]), [['Project Expense', 'Government Benefits'], ['', 'Service Charge']], 'Reset order keeps the edits');
  f.review.cancel(); await run();
});

test('M6, M7: Cancel discards the details chosen in the review but keeps what the pre-review save already stored; nothing is exported', async () => {
  const f = await setup(four());
  await f.edit(f.cards()[0], 'store', 'Alpha renamed'); // an edit that the pre-review save persists
  const run = await f.start();
  assert.equal(f.table.get('a').store, 'Alpha renamed', 'saved before the review opened');
  await f.complete(['a', 'b', 'c', 'd']);
  await f.els.cancelButton.emit('click'); await run();
  assert.equal(f.open(), false);
  assert.equal(f.calls.expenseSave.length, 0); assert.equal(f.calls.workbook.length, 0); assert.equal(f.calls.archive.length, 0);
  assert.equal(f.table.get('a').store, 'Alpha renamed', 'the earlier save stays');
  assert.deepEqual(['a', 'b', 'c', 'd'].map(id => f.table.get(id).classification), ['', '', '', ''], 'the review edits were discarded');
  assert.ok([...f.table.values()].every(record => record.status === 'active'));
  assert.match(f.elements.feedback.textContent, /Changes saved before the review stay saved; expense details chosen in the review were discarded\. Nothing was exported or archived\./);
  assert.doesNotMatch(f.elements.feedback.textContent, /rolled back/i);
  const again = await f.start();
  assert.equal(f.readiness(), 'Export readiness: 0 of 4 receipts complete', 'reopening starts from the saved values');
  f.review.cancel(); await again();
});

test('M8: a failed expense write keeps the dialog open, reports what was already saved (not rolled back), and exports nothing; a retry saves only what is left', async () => {
  const f = await setup(four());
  const run = await f.start();
  await f.complete(['a', 'b', 'c', 'd']);
  f.fails.expense = { when: id => id === 'c', error: new Error('Simulated write failure') };
  await f.confirm();
  assert.equal(f.open(), true);
  assert.deepEqual(f.calls.expenseSave.map(([id]) => id), ['a', 'b', 'c'], 'it stopped at the failure');
  assert.equal(f.calls.workbook.length, 0); assert.equal(f.calls.archive.length, 0);
  const message = f.els.message.textContent;
  assert.match(message, /Could not save the details of Receipt 3: Simulated write failure\./);
  assert.match(message, /Receipt 1 and Receipt 2 were already saved and stay saved\. Nothing was exported or archived\./);
  assert.doesNotMatch(message, /rolled back/i);
  assert.deepEqual(['a', 'b', 'c'].map(id => f.table.get(id).classification), ['Meals', 'Meals', ''], 'the table holds exactly what was really saved');
  assert.equal(f.els.confirmButton.disabled, false); assert.equal(f.els.cancelButton.disabled, false);
  f.fails.expense = null;
  await f.confirm(); await run();
  assert.deepEqual(f.calls.expenseSave.slice(3).map(([id]) => id), ['c', 'd'], 'a retry writes only what is still unsaved');
  assert.equal(f.calls.workbook.length, 1); assert.deepEqual([...f.calls.archive[0]].sort(), ['a', 'b', 'c', 'd']);
});

test('M8: when the read-back fails, nothing is exported; a retry verifies and exports', async () => {
  const f = await setup(four().slice(0, 2));
  const run = await f.start();
  await f.complete(['a', 'b']);
  f.fails.readBack = new Error('Simulated read failure');
  await f.confirm();
  assert.equal(f.open(), true);
  assert.match(f.els.message.textContent, /could not be read back and verified: Simulated read failure\. Receipt 1 and Receipt 2 were already saved and stay saved\. Nothing was exported or archived\./);
  assert.equal(f.calls.workbook.length, 0); assert.equal(f.calls.archive.length, 0);
  f.fails.readBack = null; await f.confirm(); await run();
  assert.equal(f.calls.expenseSave.length, 2, 'nothing was written twice');
  assert.equal(f.calls.workbook.length, 1);
});

test('M8: a read-back that does not show what was written stops the export', async () => {
  const f = await setup(four().slice(0, 2));
  const run = await f.start();
  await f.complete(['a', 'b']);
  const store = f.table.set.bind(f.table);
  f.table.set = (id, row) => store(id, id === 'b' && row.classification === 'Meals' ? { ...row, classification: '' } : row);
  await f.confirm(); await run();
  assert.equal(f.open(), false);
  assert.equal(f.calls.workbook.length, 0); assert.equal(f.calls.archive.length, 0);
  assert.match(f.elements.feedback.textContent, /The saved details of Receipt 2 could not be confirmed in the database\. Receipt 1 and Receipt 2 were already saved and stay saved\. Nothing was exported or archived\./);
});

test('M9: another session edited a receipt while the review was open: its values are not overwritten, nothing is exported, and the saved receipts are reported', async () => {
  const f = await setup(four());
  const run = await f.start();
  await f.complete(['a', 'b', 'c', 'd']);
  otherSession(f, 'c', { expenseAccount: 'Project Expense', classification: 'Hotel' });
  await f.confirm(); await run();
  assert.equal(f.open(), false);
  assert.deepEqual([f.table.get('c').expenseAccount, f.table.get('c').classification], ['Project Expense', 'Hotel'], "the other session's values are intact");
  assert.equal(f.calls.workbook.length, 0); assert.equal(f.calls.archive.length, 0);
  assert.match(f.elements.feedback.textContent, /Receipt 3 was changed, archived or deleted in another session, so its details were not saved\. Receipt 1 and Receipt 2 were already saved and stay saved\. Nothing was exported or archived\. Refresh Monthly Filing/);
  assert.ok([...f.table.values()].every(record => record.status === 'active'));
});

test('M9: a receipt archived, deleted or changed in amount in another session stops the export before any workbook', async () => {
  for (const [name, change, expected] of [
    ['archived', f => otherSession(f, 'b', { status: 'archived' }), /Receipt 2 was changed, archived or deleted in another session/],
    ['deleted', f => f.table.delete('b'), /Receipt 2 was changed, archived or deleted in another session/],
    ['amount of a receipt that needed no write', f => otherSession(f, 'a', { amount: '999.00' }), /Receipt 1 changed in another session while this review was open\./]
  ]) {
    const records = [savedMonthly('a', { store: 'Alpha', amount: '100' }), savedMonthly('b', { store: 'Beta', amount: '200', ...blank })];
    const f = await setup(records);
    const run = await f.start();
    await f.complete(['b']);
    change(f);
    await f.confirm(); await run();
    assert.equal(f.calls.workbook.length, 0, name); assert.equal(f.calls.archive.length, 0, name);
    assert.match(f.elements.feedback.textContent, expected, name);
  }
});

test('M9: a receipt consumed by another session right after the details were saved is caught by the read-back', async () => {
  const f = await setup(four().slice(0, 2));
  const run = await f.start();
  await f.complete(['a', 'b']);
  const store = f.table.set.bind(f.table);
  f.table.set = (id, row) => { store(id, row); if (id === 'b' && row.classification === 'Meals') store('a', { ...f.table.get('a'), status: 'archived', updatedAt: f.stamp() }); };
  await f.confirm(); await run();
  assert.equal(f.calls.workbook.length, 0); assert.equal(f.calls.archive.length, 0);
  assert.match(f.elements.feedback.textContent, /Receipt 1 is no longer Active\./);
});

test('M11: a single Active receipt with missing fields opens the review and is completed there', async () => {
  const f = await setup([savedMonthly('only', { store: 'Solo', amount: '50', ...blank })]);
  const run = await f.start();
  assert.equal(f.open(), true); assert.equal(f.readiness(), 'Export readiness: 0 of 1 receipt complete');
  await f.confirm();
  assert.equal(f.open(), true, 'incomplete: still open'); assert.equal(f.calls.workbook.length, 0);
  await f.complete(['only'], 'Service Charge', 'Project Expense');
  await f.confirm(); await run();
  assert.deepEqual(f.calls.workbook[0].map(record => [record.dbId, record.expenseAccount, record.classification]), [['only', 'Project Expense', 'Service Charge']]);
  assert.deepEqual(f.calls.archive, [['only']]); assert.equal(f.table.get('only').status, 'archived');
});

test('M14: both new classifications are selectable, saved, exported and archived', async () => {
  const f = await setup(four().slice(0, 2));
  const run = await f.start();
  await f.choose('a', 'account', 'Day to day'); await f.choose('a', 'classification', 'Service Charge');
  await f.choose('b', 'account', 'Project Expense'); await f.choose('b', 'classification', 'Government Benefits');
  await f.confirm(); await run();
  assert.deepEqual(f.calls.workbook[0].map(record => record.classification), ['Service Charge', 'Government Benefits']);
  assert.deepEqual(['a', 'b'].map(id => f.table.get(id).classification), ['Service Charge', 'Government Benefits']);
});

test('only changed receipts are written; a receipt that was already complete exports exactly as before without any write', async () => {
  const f = await setup([savedMonthly('a', { store: 'Alpha', expenseAccount: 'Project Expense', classification: 'Water' }), savedMonthly('b', { store: 'Beta', ...blank })]);
  const run = await f.start();
  assert.equal(f.readiness(), 'Export readiness: 1 of 2 receipts complete');
  await f.complete(['b']); await f.confirm(); await run();
  assert.deepEqual(f.calls.expenseSave.map(([id]) => id), ['b']);
  const g = await setup([savedMonthly('a'), savedMonthly('b')]);
  const second = await g.start();
  assert.equal(g.els.confirmButton.textContent, 'Export & Archive'); await g.confirm(); await second();
  assert.equal(g.calls.expenseSave.length, 0); assert.equal(g.calls.workbook.length, 1); assert.deepEqual([...g.calls.archive[0]].sort(), ['a', 'b']);
});

test('Cancel, Escape and the backdrop cannot interrupt a save that is running; the fields lock; a second click starts nothing', async () => {
  const f = await setup(four().slice(0, 2));
  const run = await f.start();
  await f.complete(['a', 'b']);
  let release; f.gates.expense = new Promise(resolve => { release = resolve; });
  const confirming = f.els.confirmButton.emit('click'); await tick();
  assert.equal(f.els.cancelButton.disabled, true); assert.equal(f.els.confirmButton.disabled, true); assert.equal(f.parts('a').classification.disabled, true);
  await f.els.confirmButton.emit('click'); await f.els.cancelButton.emit('click'); await f.els.backdrop.emit('click'); f.review.escape();
  assert.equal(f.open(), true, 'the dialog stays open while the operation runs');
  release(); await confirming; await run();
  assert.equal(f.calls.expenseSave.length, 2, 'no second save started'); assert.equal(f.calls.workbook.length, 1); assert.equal(f.calls.archive.length, 1);
});

test('signing out during the save: nothing further is written, no workbook, no archive, and nothing is said for the next account', async () => {
  const f = await setup(four().slice(0, 2));
  const run = await f.start();
  await f.complete(['a', 'b']);
  let release; f.gates.expense = new Promise(resolve => { release = resolve; });
  const confirming = f.els.confirmButton.emit('click'); await tick();
  f.ui.clearForLogout();
  assert.equal(f.open(), false, 'signing out ends the review');
  release(); await confirming; await run(); await tick();
  assert.equal(f.calls.expenseSave.length, 1, 'no further write was sent for the ended session');
  assert.equal(f.calls.workbook.length, 0); assert.equal(f.calls.archive.length, 0);
});

test('a workbook failure or an archive failure after the details were saved does not claim success, and the saved details are kept', async () => {
  const f = await setup(four().slice(0, 2));
  const run = await f.start();
  await f.complete(['a', 'b']);
  f.gates.archive = Promise.reject(new Error('Simulated archive failure')); f.gates.archive.catch(() => {});
  await f.confirm(); await run();
  assert.equal(f.calls.workbook.length, 1);
  assert.match(f.elements.feedback.textContent, /Workbook generated, but archive status could not be confirmed/);
  assert.deepEqual(['a', 'b'].map(id => f.table.get(id).classification), ['Meals', 'Meals']);
});

test('the service writes only the expense columns, guarded by status and updated_at, and refuses unapproved values before any request', async () => {
  await assert.rejects(() => updateMonthlyFilingExpenseFields('a', { expenseAccount: 'Day to day', classification: 'Nope' }, 't'), /approved/);
  await assert.rejects(() => updateMonthlyFilingExpenseFields('a', { expenseAccount: 'Day to day', classification: 'Meals' }, ''), /last known update time/);
  const source = await readFile(new URL('../services/monthlyFilingService.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export async function updateMonthlyFilingExpenseFields'), source.indexOf('export async function associateMonthlyFilingSharedStore'));
  assert.match(body, /\.update\(expenseFieldsToDatabase\(/); assert.match(body, /\.eq\('status', 'active'\)/); assert.match(body, /\.eq\('updated_at', expectedUpdatedAt\)/);
  assert.doesNotMatch(body, /from\('receipts'\)|rpc\(/, 'never the long-term receipts table, never the archive RPC');
  assert.match(source, /client\.rpc\('archive_monthly_filing_receipts', \{ p_ids: exactIds \}\)/, 'the archive RPC is unchanged');
});

test('the markup has the readiness line, and Monthly Filing still has exactly one review dialog (no separate classification popup)', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="monthlyExportReviewReadiness"[^>]*role="status"/);
  assert.equal((html.match(/id="monthlyExportReviewModal"/g) ?? []).length, 1);
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /readiness: document\.querySelector\('#monthlyExportReviewReadiness'\)/);
  const ui = await readFile(new URL('../ui/monthlyExportReview.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /Service Charge|Government Benefits|Accomodation/, 'no duplicate option list');
});

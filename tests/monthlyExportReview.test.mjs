// Issue #50 requirement 1: Review & Arrange for Monthly Filing exports. The order is for the workbook only; membership, accounting integrity and the saved cards never change.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMonthlyExportReview } from '../ui/monthlyExportReview.js';
import { monthlyFixture, savedMonthly } from './helpers/monthlyFilingUiFixture.mjs';
import { formatMonthlyFilingCents, runMonthlyFilingExport } from '../ui/monthlyFilingUi.js';
import { createExpenseDetailedReportWorkbook } from '../services/exportService.js';

function node(extra = {}) {
  const self = { hidden: false, disabled: false, textContent: '', className: '', dataset: {}, attrs: {}, listeners: {}, children: [], style: {}, checked: false,
    setAttribute(name, value) { self.attrs[name] = String(value); }, getAttribute: name => self.attrs[name] ?? null, removeAttribute(name) { delete self.attrs[name]; },
    addEventListener(name, listener) { (self.listeners[name] ??= []).push(listener); }, emit(name, event = {}) { (self.listeners[name] ?? []).forEach(listener => listener({ currentTarget: self, target: self, preventDefault() {}, ...event })); },
    append(...items) { self.children.push(...items); }, replaceChildren(...items) { self.children = items; }, focus() { self.focused = true; }, getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0, left: 0, right: 0 }),
    parentElement: null, contains: () => false, querySelector: () => null, querySelectorAll: () => [], ...extra };
  return self;
}
function reviewFixture() {
  const els = { modal: node({ hidden: true }), backdrop: node(), message: node(), list: node(), announcer: node(), resetButton: node(), confirmButton: node(), cancelButton: node(),
    summary: { count: node(), total: node(), noAmountGroup: node({ hidden: true }), noAmount: node() } };
  const focusCalls = []; const modalFocus = { open: (modal, options) => focusCalls.push(['open', options]), close: (modal, options) => focusCalls.push(['close', options]) };
  const review = createMonthlyExportReview({ ...els, modalFocus, format: formatMonthlyFilingCents, createElement: () => node() });
  review.start();
  const rows = () => els.list.children; const order = () => rows().map(row => row.dataset.receiptId);
  const move = (id, key) => rows().find(row => row.dataset.receiptId === id).emit('keydown', { key });
  return { els, review, rows, order, move, focusCalls };
}
const records = () => [savedMonthly('a', { amount: '100', store: 'Alpha' }), savedMonthly('b', { amount: '250.50', store: 'Beta' }), savedMonthly('c', { amount: '', store: 'Gamma' })];

test('REV-1: the dialog lists the saved receipts in their current order, with count, exact total and a note for a missing amount', async () => {
  const f = reviewFixture(); const pending = f.review.review(records(), { trigger: {} });
  assert.equal(f.els.modal.hidden, false); assert.deepEqual(f.order(), ['a', 'b', 'c']);
  assert.equal(f.els.summary.count.textContent, '3'); assert.equal(f.els.summary.total.textContent, '₱350.50'); assert.equal(f.els.summary.noAmountGroup.hidden, false);
  assert.match(f.els.message.textContent, /Your Monthly Filing cards keep their current order\./);
  assert.equal(f.focusCalls[0][0], 'open'); f.els.cancelButton.emit('click'); assert.equal(await pending, null);
});

test('REV-2: keyboard arrows reorder, Reset restores, Confirm resolves with the same receipts in the confirmed order; total and members never change', async () => {
  const f = reviewFixture(); const pending = f.review.review(records());
  f.move('c', 'ArrowUp'); f.move('c', 'ArrowUp'); assert.deepEqual(f.order(), ['c', 'a', 'b']);
  f.move('a', 'End'); assert.deepEqual(f.order(), ['c', 'b', 'a']); assert.equal(f.els.summary.total.textContent, '₱350.50', 'the total is order-independent');
  assert.equal(f.els.resetButton.disabled, false); f.els.resetButton.emit('click'); assert.deepEqual(f.order(), ['a', 'b', 'c']); assert.equal(f.els.resetButton.disabled, true);
  f.move('b', 'Home'); f.els.confirmButton.emit('click');
  const ordered = await pending; assert.deepEqual(ordered.map(record => record.dbId), ['b', 'a', 'c']);
  assert.equal(f.els.modal.hidden, true); assert.equal(f.focusCalls.at(-1)[0], 'close'); assert.equal(f.review.isOpen(), false);
});

test('REV-3: Cancel, backdrop, Escape and a session-ending cancel() all resolve null and leave the dialog closed; Escape first cancels a drag', async () => {
  for (const close of [f => f.els.cancelButton.emit('click'), f => f.els.backdrop.emit('click'), f => f.review.escape(), f => f.review.cancel()]) {
    const f = reviewFixture(); const pending = f.review.review(records()); close(f);
    assert.equal(await pending, null); assert.equal(f.els.modal.hidden, true); assert.equal(f.review.isOpen(), false);
  }
});

test('REV-4: only one review at a time, and an empty or unsaved set is never offered', async () => {
  const f = reviewFixture(); const first = f.review.review(records());
  assert.equal(await f.review.review(records()), null, 'a second review while one is open does nothing'); assert.equal(f.review.isOpen(), true); f.review.cancel(); await first;
  assert.equal(await f.review.review([]), null);
  assert.equal(await f.review.review([{ ...savedMonthly('x'), dbId: '' }]), null, 'an unsaved receipt has no identity to order by');
});

// ---- the export flow ---------------------------------------------------------------------------------------------------------------------
async function withReview(arrangement) {
  const received = []; const exportReview = { review: async (saved, options) => { received.push(saved.map(record => record.dbId)); return arrangement(saved); }, cancel: () => {} };
  const f = monthlyFixture({ records: records().map(record => ({ ...record, amount: record.amount || '' })), exportReview });
  await f.ui.loadForUser({ id: 'user-1' }); f.received = received; return f;
}

test('REV-5: the confirmed order is the workbook order (Item No. 1..n) and the archive covers exactly the same receipts; the saved cards keep their order', async () => {
  const f = await withReview(saved => [saved[2], saved[0], saved[1]]);
  const cardOrder = () => f.cards().map(card => f.field(card, 'store').value);
  await f.click(f.elements.exportActive);
  assert.deepEqual(f.received, [['a', 'b', 'c']], 'the review was offered the saved receipts in card order');
  assert.deepEqual(f.calls.workbook[0].map(record => record.dbId), ['c', 'a', 'b'], 'the workbook follows the confirmed order');
  assert.deepEqual([...f.calls.archive[0]].sort(), ['a', 'b', 'c'], 'exactly the reviewed receipts are archived');
  const sheet = createExpenseDetailedReportWorkbook(f.calls.workbook[0]).Sheets['Expense Detailed Report'];
  assert.deepEqual([3, 4, 5].map(row => [sheet[`A${row}`].v, sheet[`C${row}`].v]), [[1, 'Gamma'], [2, 'Alpha'], [3, 'Beta']]);
  assert.deepEqual([...f.table.keys()].sort(), ['a', 'b', 'c'], 'no record was lost or duplicated'); assert.ok([...f.table.values()].every(record => record.status === 'archived'));
  await f.click(f.elements.archivedTab); assert.deepEqual(cardOrder(), ['Alpha', 'Beta', 'Gamma'], 'the saved cards keep their own order; only the workbook was rearranged');
  assert.match(f.elements.feedback.textContent, /^Exported and archived 3 Monthly Filing receipts \(Total: ₱350\.50\)\./, 'the exported total is order-independent');
});

test('REV-6: cancelling the review exports and archives nothing, keeps every receipt Active, and says the changes were saved', async () => {
  const f = await withReview(() => null);
  await f.click(f.elements.exportActive);
  assert.equal(f.calls.workbook.length, 0); assert.equal(f.calls.archive.length, 0);
  assert.ok([...f.table.values()].every(record => record.status === 'active'));
  assert.match(f.elements.feedback.textContent, /Export cancelled\. Your changes were saved; nothing was exported or archived\./);
  assert.equal(f.elements.exportActive.disabled, false, 'the export can be started again');
});

test('REV-7: an arrangement that adds, drops or duplicates a receipt is rejected: nothing is exported or archived', async () => {
  for (const tamper of [saved => saved.slice(1), saved => [...saved, saved[0]], saved => [saved[0], saved[0], saved[1]], saved => [saved[0], saved[1], { ...saved[2], dbId: 'zzz' }]]) {
    const f = await withReview(tamper); await f.click(f.elements.exportActive);
    assert.equal(f.calls.workbook.length, 0); assert.equal(f.calls.archive.length, 0); assert.match(f.elements.feedback.textContent, /could not be confirmed, so nothing was exported or archived/);
  }
});

test('REV-8: a single Active receipt has nothing to arrange and exports directly; the expense validation still runs before the review', async () => {
  const f = await withReview(() => { throw new Error('must not be asked'); });
  f.table.clear(); await f.ui.loadForUser({ id: 'user-1' });
  f.table.set('only', { ...savedMonthly('only') }); await f.ui.loadForUser({ id: 'user-1' });
  await f.click(f.elements.exportActive); assert.equal(f.calls.workbook.length, 1);
  const g = await withReview(saved => saved); g.table.set('a', { ...g.table.get('a'), classification: '' }); await g.ui.loadForUser({ id: 'user-1' });
  await g.click(g.elements.exportActive); assert.deepEqual(g.received, [], 'no review for an export that the expense check refuses'); assert.equal(g.calls.workbook.length, 0);
});

test('REV-9: runMonthlyFilingExport keeps its order of steps: save, validate, arrange, workbook, archive; arrange can stop it before the workbook', async () => {
  const log = []; const saved = [{ dbId: 'a' }, { dbId: 'b' }];
  const ok = await runMonthlyFilingExport({ save: async () => { log.push('save'); return true; }, snapshot: () => saved, validate: () => { log.push('validate'); return []; }, arrange: async list => { log.push('arrange'); return [list[1], list[0]]; }, generateWorkbook: list => log.push(`workbook:${list.map(r => r.dbId)}`), archive: async ids => { log.push(`archive:${ids}`); return ids; } });
  assert.equal(ok.state, 'archived'); assert.deepEqual(log, ['save', 'validate', 'arrange', 'workbook:b,a', 'archive:b,a']);
  const stopped = await runMonthlyFilingExport({ save: async () => true, snapshot: () => saved, arrange: async () => null, generateWorkbook: () => assert.fail('no workbook'), archive: async () => assert.fail('no archive') });
  assert.equal(stopped.state, 'cancelled');
});

test('REV-10: signing out or switching account cancels an open review, and the markup is a labelled modal dialog with the same list structure as Receipt Optimization', async () => {
  let cancelled = 0; const f = monthlyFixture({ records: records(), exportReview: { review: async () => null, cancel: () => { cancelled += 1; } } });
  await f.ui.loadForUser({ id: 'user-1' }); f.ui.clearForLogout(); await f.ui.loadForUser({ id: 'user-2' }); assert.ok(cancelled >= 3, 'every session change ends an open review');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="monthlyExportReviewModal" role="dialog" aria-modal="true" aria-labelledby="monthlyExportReviewTitle" aria-describedby="monthlyExportReviewMessage" hidden/);
  for (const id of ['monthlyExportReviewList', 'monthlyExportReviewHint', 'monthlyExportReviewAnnouncer', 'monthlyExportReviewReset', 'monthlyExportReviewConfirm', 'monthlyExportReviewCancel']) assert.ok(html.includes(`id="${id}"`), id);
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8'); assert.match(app, /createMonthlyFilingUi\(\{ exportReview: monthlyExportReview,/); assert.match(app, /monthlyExportReview\.start\(\);/);
});

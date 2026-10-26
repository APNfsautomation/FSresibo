// CP10-C3E-1: behavioral tests of the My Receipts export, driving the real createReceiptUi against an in-memory receipts database.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExpenseDetailedReportRows } from '../services/exportService.js';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const saved = (dbId, amount, store, extra = {}) => ({ dbId, amount, store, ...extra });
const three = () => [saved('r1', 100, 'Store A'), saved('r2', 200, 'Store B'), saved('r3', 300, 'Store C')];
const calculate = async (f, target) => { f.elements.target.value = target; await f.click(f.elements.calculate); };
const exportClick = f => f.click(f.elements.exportSelected);
const confirm = f => f.click(f.elements.confirmExport);
const dialogOpen = f => f.elements.exportConfirmModal.hidden === false;
const cardStores = (f, selected) => f.cards().filter(card => card.classList.contains('is-selected') === selected).map(card => card.part('.compact-store').textContent);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Simulates another session: change the stored receipt directly.
const otherSession = (f, id, changes) => f.db.set(id, { ...f.db.get(id), ...changes, updatedAt: f.stamp() });

// ---- stable identity and selection ----------------------------------------------------------------------------------------------------
test('A: the selection follows database ids, not row positions, when rows shift', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500');
  assert.deepEqual(cardStores(f, true), ['Store B', 'Store C']);
  f.list.children.splice(0, 1); // the first row leaves the list: every remaining row moves up one position
  f.elements.optimizationSort.emit('change'); await settle();
  assert.deepEqual(cardStores(f, true), ['Store B', 'Store C'], 'the same receipts stay highlighted');
  assert.deepEqual(cardStores(f, false), []);
  await exportClick(f); await confirm(f);
  assert.deepEqual(f.calls.download[0].map(item => item.dbId), ['r2', 'r3']);
});

test('B: filters and sorting change the view but never the selection or the export', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500');
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)');
  f.elements.optimizationStoreFilter.value = 'store c'; f.elements.optimizationStoreFilter.emit('change'); await settle();
  assert.equal(f.elements.optimizationHiddenSelected.textContent, '1 selected receipt is hidden by the current filters.');
  assert.deepEqual(cardStores(f, true), ['Store C']);
  f.elements.optimizationStoreFilter.value = ''; f.elements.optimizationStoreFilter.emit('change');
  f.elements.optimizationSort.value = 'amount-desc'; f.elements.optimizationSort.emit('change'); await settle();
  assert.deepEqual(f.cards().map(card => card.part('.compact-store').textContent), ['Store C', 'Store B', 'Store A'], 'sorted view');
  assert.deepEqual(cardStores(f, true), ['Store C', 'Store B']);
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)');
  await exportClick(f); await confirm(f);
  assert.deepEqual(f.calls.download[0].map(item => item.dbId), ['r2', 'r3'], 'L: the export keeps the optimizer order, whatever the sort');
});

// ---- preflight: drafts and unsaved edits -----------------------------------------------------------------------------------------------
test('C: an unsaved draft chosen by the optimizer is kept and blocks export with an actionable message', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A'), saved('r2', 300, 'Store B')] });
  await f.click(f.elements.floatingAdd);
  const draft = f.rows()[2]; await f.type(draft, 'store', 'Draft Store'); await f.type(draft, 'amount', '200');
  await calculate(f, '200');
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (1)', 'the draft selection is not silently dropped');
  assert.equal(f.elements.exportSelected.disabled, false);
  await exportClick(f);
  assert.match(f.elements.difference.textContent, /Receipt 3 has not been saved\. Save it before exporting and run Find Best Match again\./);
  assert.equal(dialogOpen(f), false);
  assert.equal(f.calls.snapshot.length, 0, 'the database is not even read');
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  assert.equal(f.field(draft, 'amount').value, '200', 'the typed values are untouched'); assert.equal(f.calls.create.length, 0, 'nothing was saved on the user behalf');
  assert.match(f.elements.optimizationUnsavedNotice.textContent, /selected result includes Receipt 3 with unsaved values/);
});

test('D: unsaved changes on a selected saved receipt block export and are neither saved nor discarded', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A'), saved('r2', 200, 'Store B')] });
  await f.type(f.rows()[0], 'amount', '150');
  await calculate(f, '350');
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)');
  await exportClick(f);
  assert.match(f.elements.difference.textContent, /Receipt 1 has unsaved changes\. Save them in Encoding, then run Find Best Match again before exporting\. Nothing was exported\./);
  assert.equal(dialogOpen(f), false);
  assert.equal(f.field(f.rows()[0], 'amount').value, '150', 'the edit is still there');
  assert.equal(f.db.get('r1').amount, 100, 'and the database was not touched');
  assert.deepEqual([f.calls.update.length, f.calls.download.length, f.calls.consume.length], [0, 0, 0]);
});

test('the unsaved-values notice is informational: an unsaved receipt that only took part in the calculation is not reported as selected', async () => {
  const f = await receiptFixture({ loaded: three() });
  await f.type(f.rows()[2], 'amount', '350'); // unsaved edit: the calculation sees 100, 200 and 350
  await calculate(f, '300');
  assert.match(f.elements.optimizationUnsavedNotice.textContent, /also used unsaved values for Receipt 3; none of them is in the selected result/);
  assert.doesNotMatch(f.elements.optimizationUnsavedNotice.textContent, /selected result includes/);
  assert.equal(f.elements.optimizationUnsavedNotice.hidden, false);
  await exportClick(f); assert.equal(dialogOpen(f), true, 'the selection (Receipts 1 and 2) is saved and can be exported');
  await confirm(f);
  assert.deepEqual(f.calls.download[0].map(item => item.dbId), ['r1', 'r2']);
  assert.equal(f.field(f.rows()[2], 'amount').value, '350', 'the unrelated unsaved edit survives the export');
  assert.equal(f.elements.optimizationUnsavedNotice.hidden, true, 'the notice goes away with the result');
});

test('no notice appears when every receipt used by the calculation is saved', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500');
  assert.equal(f.elements.optimizationUnsavedNotice.hidden, true);
  assert.equal(f.elements.optimizationUnsavedNotice.textContent, '');
});

// ---- the normal path ---------------------------------------------------------------------------------------------------------------------
test('E, Q, R: a valid unchanged selection exports normally, becomes Consumed and keeps focus on a working control', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500');
  await exportClick(f);
  assert.equal(dialogOpen(f), true);
  assert.match(f.elements.exportConfirmMessage.textContent, /^Export 2 selected receipts\? After the export is prepared, these receipts will be marked as Consumed/);
  assert.equal(f.focusLog.at(-1), f.elements.confirmExport, 'the dialog opens on its primary action');
  await confirm(f);
  assert.equal(dialogOpen(f), false);
  assert.equal(f.calls.download.length, 1);
  assert.deepEqual(f.calls.consume, [['r2', 'r3']]);
  assert.deepEqual(f.rows().map(row => row.dataset.receiptStatus), ['available', 'consumed', 'consumed']);
  assert.deepEqual(['r1', 'r2', 'r3'].map(id => f.db.get(id).status), ['available', 'consumed', 'consumed']);
  assert.equal(f.elements.resultTitle.textContent, 'Export complete');
  assert.equal(f.elements.difference.textContent, '2 receipts exported and marked as Consumed.');
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (0)'); assert.equal(f.elements.exportSelected.disabled, true);
  assert.equal(f.focusLog.at(-1), f.elements.calculate);
  assert.equal(f.field(f.rows()[1], 'amount').disabled, true, 'Consumed receipts are read-only again');
});

test('K: the workbook receives saved database values, never the text typed on screen', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 1250.5, 'Store A'), saved('r2', 200, 'Store B')] });
  // A grouped amount is the same money as the saved 1250.5, so it is not an edit; the workbook still gets the database value, normalized.
  f.field(f.rows()[0], 'amount').value = '1,250.50';
  await calculate(f, '1450.50');
  await exportClick(f); await confirm(f);
  const [first, second] = f.calls.download[0];
  assert.equal(first.store, 'Store A', 'the exported store is the saved value, not the typed one');
  assert.equal(first.amount, '1250.50');
  assert.deepEqual(buildExpenseDetailedReportRows(f.calls.download[0]).slice(2).map(line => [line[0], line[2], line[7]]), [[1, 'Store A', 1250.5], [2, 'Store B', 200]], 'Item No. follows the export order');
  assert.equal(second.dbId, 'r2');
});

test('P: a double click on Export Selected and on the confirmation starts one review and one export', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500');
  await Promise.all([f.elements.exportSelected.emit('click'), f.elements.exportSelected.emit('click')]); await settle();
  assert.equal(f.calls.snapshot.length, 1, 'one review read');
  await Promise.all([f.elements.confirmExport.emit('click'), f.elements.confirmExport.emit('click')]); await settle();
  assert.equal(f.calls.download.length, 1); assert.equal(f.calls.consume.length, 1);
});

test('cancelling the confirmation exports and consumes nothing and keeps the result', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500'); await exportClick(f);
  await f.click(f.elements.cancelExport);
  assert.equal(dialogOpen(f), false);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)');
});

// ---- the result must still apply ------------------------------------------------------------------------------------------------------
test('F: an amount that changed in the database after Find Best Match blocks export and requires a new calculation', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500');
  otherSession(f, 'r2', { amount: 250 });
  await exportClick(f);
  assert.match(f.elements.difference.textContent, /The saved amount of Receipt 2 no longer matches the amount Find Best Match used, so this result is out of date\./);
  assert.match(f.elements.difference.textContent, /Run Find Best Match again\.$/);
  assert.equal(dialogOpen(f), false);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  assert.equal(f.elements.resultTitle.textContent, 'Result out of date');
  assert.equal(f.elements.exportSelected.disabled, true, 'the old combination is not kept or silently recalculated');
  assert.equal(f.field(f.rows()[1], 'amount').value, 250, 'the screen now shows the database value');
});

// C3E-2 (intentional change from C3E-1, which blocked): other workbook fields changing on an Available receipt are shown and must be acknowledged.
test('I: a changed workbook field other than the amount opens the review with the updated values and requires acknowledgement', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500');
  otherSession(f, 'r3', { invoice: 'NEW-INV', store: 'Renamed' });
  await exportClick(f);
  assert.equal(dialogOpen(f), true);
  assert.equal(f.elements.exportReviewAck.hidden, false);
  assert.equal(f.elements.confirmExport.disabled, true, 'export stays disabled until the changes are acknowledged');
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  assert.equal(f.field(f.rows()[2], 'invoice').value, 'NEW-INV', 'the screen shows the database value');
});

test('G: correcting a selected receipt through the Edit dialog invalidates the stale result and says why', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500');
  f.elements.editModal.dataset.receiptIndex = '1'; // Receipt 2 is part of the result
  f.elements.editAmount.value = '210';
  for (const [key, value] of Object.entries({ editReceiptDate: '', editVat: '', editInvoice: '', editStore: 'Store B', editAddress: '', editTin: '' })) f.elements[key].value = value;
  await f.elements.editForm.emit('submit', { submitter: null }); await settle();
  assert.equal(f.calls.update.length, 1);
  assert.match(f.elements.difference.textContent, /^Receipt 2 was corrected after Find Best Match ran, so the previous result was cleared\. Run Find Best Match again\.$/);
  assert.equal(f.elements.resultTitle.textContent, 'Result out of date');
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (0)'); assert.equal(f.elements.exportSelected.disabled, true);
  assert.deepEqual(cardStores(f, true), []);
});

test('G: correcting a receipt that is not part of the result leaves the result alone', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500');
  f.elements.editModal.dataset.receiptIndex = '0'; // Receipt 1 is not selected
  f.elements.editAmount.value = '110';
  for (const [key, value] of Object.entries({ editReceiptDate: '', editVat: '', editInvoice: '', editStore: 'Store A', editAddress: '', editTin: '' })) f.elements[key].value = value;
  await f.elements.editForm.emit('submit', { submitter: null }); await settle();
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)');
});

test('H: a receipt consumed in another session cannot be exported, and the screen learns it is Consumed', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500');
  otherSession(f, 'r2', { status: 'consumed' });
  await exportClick(f);
  assert.match(f.elements.difference.textContent, /Receipt 2 is no longer Available \(already Consumed in another session\)\. Nothing was exported\. Run Find Best Match again\./);
  assert.equal(dialogOpen(f), false);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  assert.equal(f.rows()[1].dataset.receiptStatus, 'consumed');
  assert.equal(f.elements.exportSelected.disabled, true);
});

test('H: a receipt deleted in another session cannot be exported', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500');
  f.db.delete('r3');
  await exportClick(f);
  assert.match(f.elements.difference.textContent, /Receipt 3 no longer exists in your saved receipts\./);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
});

// C3E-2 (intentional change from C3E-1, which closed the dialog): a non-amount change while the dialog is open keeps it open and asks again.
test('J: a change made while the confirmation is open generates nothing, asks for a new acknowledgement, and the new values are what gets exported', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500'); await exportClick(f);
  assert.equal(dialogOpen(f), true); assert.equal(f.elements.exportReviewAck.hidden, true);
  otherSession(f, 'r2', { store: 'Edited elsewhere' });
  await confirm(f);
  assert.equal(f.calls.snapshot.length, 2, 'Snapshot A and Snapshot B');
  assert.equal(dialogOpen(f), true, 'the dialog stays open for review');
  assert.equal(f.elements.exportReviewAck.hidden, false);
  assert.equal(f.elements.confirmExport.disabled, true);
  assert.match(f.elements.exportReviewAnnouncer.textContent, /Receipt values changed while you were reviewing/);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  assert.equal(f.db.get('r2').status, 'available');
  f.elements.exportReviewAckInput.checked = true; await f.elements.exportReviewAckInput.emit('change');
  assert.equal(f.elements.confirmExport.disabled, false);
  await confirm(f);
  assert.equal(f.calls.download[0].find(item => item.dbId === 'r2').store, 'Edited elsewhere', 'the reviewed (new) value is exported');
  assert.deepEqual(f.calls.consume, [['r2', 'r3']]);
});

test('a receipt consumed while the confirmation is open cannot be exported either', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500'); await exportClick(f);
  otherSession(f, 'r3', { status: 'consumed' });
  await confirm(f);
  assert.match(f.elements.difference.textContent, /Receipt 3 is no longer Available/);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
});

// ---- failures ------------------------------------------------------------------------------------------------------------------------------
test('a failed review read exports nothing and says so', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500');
  f.fails.snapshot = new Error('connection lost');
  await exportClick(f);
  assert.match(f.elements.difference.textContent, /^Could not load the latest saved receipt values: connection lost\. Nothing was exported\.$/);
  assert.equal(dialogOpen(f), false);
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)', 'the result is kept so the user can try again');
  f.fails.snapshot = null; await exportClick(f); assert.equal(dialogOpen(f), true);
});

test('M: a workbook generation failure marks nothing Consumed and keeps the result', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500'); await exportClick(f);
  f.fails.download = new Error('disk full');
  await confirm(f);
  assert.match(f.elements.difference.textContent, /^Could not prepare the XLSX export: disk full\. No receipt was marked Consumed\.$/);
  assert.equal(f.calls.consume.length, 0);
  assert.deepEqual(['r1', 'r2', 'r3'].map(id => f.db.get(id).status), ['available', 'available', 'available']);
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)');
  assert.equal(dialogOpen(f), false); assert.equal(f.elements.confirmExport.disabled, false);
});

test('N: a failed status update after the workbook explains the uncertainty and keeps the selection', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500'); await exportClick(f);
  f.fails.consume = new Error('network down');
  await confirm(f);
  assert.equal(f.calls.download.length, 1);
  assert.match(f.elements.difference.textContent, /The XLSX export was prepared, but the receipt status update could not be confirmed: network down\./);
  assert.match(f.elements.difference.textContent, /workbook may already have been downloaded, and some or all of these receipts may already be Consumed\. Check each receipt's status before exporting again/);
  assert.match(f.elements.difference.textContent, /verified against the database first/);
  assert.doesNotMatch(f.elements.difference.textContent, /still Available/, 'the outcome is not claimed to be known');
  assert.deepEqual(f.rows().map(row => row.dataset.receiptStatus), ['available', 'available', 'available'], 'the screen is not changed without a confirmed result');
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)');
});

const uncertainMessage = async fails => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500'); await exportClick(f);
  Object.assign(f.fails, fails); await confirm(f);
  return { f, message: f.elements.difference.textContent };
};

test('C: the failure message is the same, and accurate, whether the update never happened or was committed with the answer lost', async () => {
  const before = await uncertainMessage({ consume: new Error('network down') });         // A: failed before the database update
  const lost = await uncertainMessage({ consumeResponseLost: new Error('network down') }); // B: database updated, response failed
  assert.deepEqual(['r2', 'r3'].map(id => before.f.db.get(id).status), ['available', 'available']);
  assert.deepEqual(['r2', 'r3'].map(id => lost.f.db.get(id).status), ['consumed', 'consumed'], 'the database really was updated in scenario B');
  assert.equal(before.message, lost.message, 'the screen cannot tell the two apart, so the message must not either');
  assert.doesNotMatch(lost.message, /still Available/);
  assert.match(lost.message, /may already be Consumed/);
  assert.equal(lost.f.calls.download.length, 1);
  assert.deepEqual(lost.f.rows().map(row => row.dataset.receiptStatus), ['available', 'available', 'available'], 'local state is not guessed');
});

test('D: after a lost response, fresh verification finds the receipts Consumed and blocks a second export', async () => {
  const { f } = await uncertainMessage({ consumeResponseLost: new Error('timeout') });
  f.fails.consumeResponseLost = null;
  const readsBefore = f.calls.snapshot.length;
  await exportClick(f);
  assert.ok(f.calls.snapshot.length > readsBefore, 'the retry starts with a fresh database read');
  assert.match(f.elements.difference.textContent, /Receipt 2 and Receipt 3 are no longer Available \(already Consumed in another session\)/);
  assert.equal(dialogOpen(f), false);
  assert.equal(f.calls.download.length, 1, 'no second workbook');
  assert.deepEqual(f.rows().slice(1).map(row => row.dataset.receiptStatus), ['consumed', 'consumed'], 'the confirmed status is now shown');
});

test('O: after an uncertain export the retry re-reads the database, warns about the earlier workbook and only then exports', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500'); await exportClick(f);
  f.fails.consume = new Error('network down'); await confirm(f);
  const readsBefore = f.calls.snapshot.length;
  f.fails.consume = null;
  await exportClick(f);
  assert.ok(f.calls.snapshot.length > readsBefore, 'a fresh verification read');
  assert.equal(dialogOpen(f), true);
  assert.match(f.elements.exportConfirmMessage.textContent, /already prepared earlier and its status update could not be confirmed\. The database now confirms they are still Available\. Exporting again downloads another workbook\./);
  assert.equal(f.calls.download.length, 1, 'nothing new is generated until the user confirms');
  await confirm(f);
  assert.equal(f.calls.download.length, 2); assert.equal(f.db.get('r2').status, 'consumed');
});

test('O: if the earlier status update did reach the database, the retry is blocked instead of exporting twice', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500'); await exportClick(f);
  f.fails.consume = new Error('timeout'); await confirm(f);
  f.fails.consume = null;
  otherSession(f, 'r2', { status: 'consumed' }); otherSession(f, 'r3', { status: 'consumed' }); // the update had actually succeeded
  await exportClick(f);
  assert.match(f.elements.difference.textContent, /Receipt 2 and Receipt 3 are no longer Available/);
  assert.equal(dialogOpen(f), false);
  assert.equal(f.calls.download.length, 1, 'no duplicate workbook');
});

test('values changed by another session during the status update are reported after the export', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500'); await exportClick(f);
  f.fails.afterDownload = () => { f.db.set('r2', { ...f.db.get('r2'), store: 'Edited during export' }); };
  await confirm(f);
  assert.match(f.elements.difference.textContent, /^2 receipts exported and marked as Consumed\. Warning: Receipt 2 changed in another session while the export was being prepared\. Check the workbook against your saved receipts\.$/);
  assert.equal(f.db.get('r2').status, 'consumed');
});

// ---- selection lifecycle -------------------------------------------------------------------------------------------------------------------
test('editing a field still clears the result, and so do logout and reload', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500');
  await f.type(f.rows()[0], 'amount', '101'); assert.equal(f.elements.exportSelected.disabled, true);
  await calculate(f, '500'); assert.equal(f.elements.exportSelected.disabled, false);
  f.ui.clearForLogout(); assert.equal(f.elements.exportSelected.disabled, true);
});

test('with no result, Export Selected explains what to do and reads nothing', async () => {
  const f = await receiptFixture({ loaded: three() });
  await f.click(f.elements.exportSelected);
  assert.match(f.elements.difference.textContent, /Run Find Best Match with saved Available receipts before exporting\./);
  assert.equal(f.calls.snapshot.length, 0);
});

test('pausing between steps does not leave the review marked busy', async () => {
  const f = await receiptFixture({ loaded: three() });
  await calculate(f, '500'); await exportClick(f); await pause(10);
  assert.equal(f.elements.exportSelected.getAttribute('aria-busy'), null);
});

// ---- exact text change detection (the workbook writes text untrimmed) ------------------------------------------------------------------
const exactFixture = () => receiptFixture({ loaded: [saved('r1', 1250.5, 'Store A', { invoice: 'INV-1' }), saved('r2', 200, 'Store B')] });
const attempt = async (edit) => {
  const f = await exactFixture();
  edit(f);
  await calculate(f, '1450.50');
  await exportClick(f);
  return f;
};
const blocked = f => dialogOpen(f) === false && /Receipt 1 has unsaved changes\. Save them in Encoding/.test(f.elements.difference.textContent);

test('exact text: identical saved text, and a grouped amount equal to the saved amount, pass', async () => {
  const same = await attempt(f => { f.field(f.rows()[0], 'store').value = 'Store A'; f.field(f.rows()[0], 'invoice').value = 'INV-1'; });
  assert.equal(dialogOpen(same), true);
  const grouped = await attempt(f => { f.field(f.rows()[0], 'amount').value = '1,250.50'; });
  assert.equal(dialogOpen(grouped), true, 'E: "1,250.50" is the same money as the saved 1250.5');
});

test('exact text: trailing-space and leading-space changes block export', async () => {
  for (const value of ['Store A ', ' Store A', 'Store  A']) {
    const f = await attempt(fixture => { fixture.field(fixture.rows()[0], 'store').value = value; });
    assert.equal(blocked(f), true, `"${value}" is a change`);
    assert.deepEqual([f.calls.snapshot.length, f.calls.download.length, f.calls.consume.length], [0, 0, 0]);
  }
});

test('exact text: invoice and store text differences, and a real monetary change, block export', async () => {
  assert.equal(blocked(await attempt(f => { f.field(f.rows()[0], 'invoice').value = 'INV-2'; })), true);
  assert.equal(blocked(await attempt(f => { f.field(f.rows()[0], 'store').value = 'Store X'; })), true);
  assert.equal(blocked(await attempt(f => { f.field(f.rows()[0], 'amount').value = '1,250.51'; })), true, 'F');
});

test('exact text: the blocked edit is never saved or discarded, and the Encoding indicator keeps its own trimmed rule', async () => {
  const f = await attempt(fixture => { fixture.field(fixture.rows()[0], 'store').value = 'Store A '; });
  assert.equal(blocked(f), true);
  assert.equal(f.field(f.rows()[0], 'store').value, 'Store A ', 'the edit is still on screen');
  assert.equal(f.db.get('r1').store, 'Store A', 'and the database still has the saved text');
  assert.equal(f.calls.update.length + f.calls.create.length, 0);
  assert.match(f.elements.optimizationUnsavedNotice.textContent, /selected result includes Receipt 1 with unsaved values/);
  assert.equal(f.elements.encodingUnsavedIndicator.hidden, true, 'the Encoding unsaved indicator is unchanged: whitespace-only edits are not counted there');
});

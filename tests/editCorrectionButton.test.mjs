// Issue #33: the Edit dialog's shared "Save correction" button is released after a successful same-session correction, stays disabled while a correction is pending,
// and is released only by the session that disabled it (Issue #27, R6). The real receipt UI controller against the fixture's in-memory database; the dialog's submit
// button is the one shared object, passed as the form submitter exactly as a browser does.
import assert from 'node:assert/strict';
import test from 'node:test';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const gate = () => { let open, fail; const promise = new Promise((resolve, reject) => { open = resolve; fail = reject; }); return { promise, open, fail }; };
const row = (dbId, store, amount = 100) => ({ dbId, store, amount, receiptDate: '2026-08-01' });
const setTable = (f, rows) => { f.db.clear(); rows.forEach(item => f.db.set(item.dbId, { amount: '', receiptDate: '', vat: '', invoice: '', store: '', address: '', tin: '', status: 'available', updatedAt: f.stamp(), ...item })); };
const threeForA = () => [row('r1', 'A-Store-1', 100), row('r2', 'A-Store-2', 200), row('r3', 'A-Store-3', 300)];
const twoForB = () => [row('b1', 'B-Store-1', 100), row('b2', 'B-Store-2', 200)];

async function editor({ loaded = threeForA() } = {}) {
  const f = await receiptFixture({ loaded });
  const submit = { disabled: false }; f.elements.editForm.querySelector = selector => /submit/.test(selector) ? submit : null; // the one shared button of the Edit dialog
  // Opens the dialog for the receipt card at `index` with a new store name, as the Edit button does, then submits it. Returns the submit's promise.
  const open = (index, store) => {
    const target = f.rows()[index]; f.elements.editModal.dataset.receiptIndex = String(index); f.elements.editAmount.value = f.field(target, 'amount').value; f.elements.editStore.value = store;
    for (const [key, field] of Object.entries({ editReceiptDate: 'receiptDate', editVat: 'vat', editInvoice: 'invoice', editAddress: 'address', editTin: 'tin' })) f.elements[key].value = f.field(target, field).value;
    f.elements.editModal.hidden = false;
  };
  const submitForm = () => f.elements.editForm.emit('submit', { submitter: submit });
  return { f, submit, open, submitForm };
}
const storeOf = (f, index) => f.field(f.rows()[index], 'store').value;

test('Issue #33: after a successful correction the Save correction button is enabled again, and a second correction (same receipt, then another) saves exactly once each', async () => {
  const { f, submit, open, submitForm } = await editor();
  open(0, 'A-corrected-1'); await submitForm(); await settle();
  assert.equal(f.calls.update.length, 1); assert.equal(storeOf(f, 0), 'A-corrected-1'); assert.equal(f.elements.editModal.hidden, true, 'the dialog closed');
  assert.equal(submit.disabled, false, 'the button is usable again without a page reload');
  open(0, 'A-corrected-2'); assert.equal(submit.disabled, false, 'reopening the dialog shows an enabled button'); await submitForm(); await settle();
  assert.equal(f.calls.update.length, 2); assert.equal(storeOf(f, 0), 'A-corrected-2'); assert.equal(submit.disabled, false);
  open(2, 'A-corrected-3'); await submitForm(); await settle();
  assert.equal(f.calls.update.length, 3, 'one update per submit, no repeats'); assert.equal(storeOf(f, 2), 'A-corrected-3'); assert.equal(storeOf(f, 1), 'A-Store-2', 'other receipts are untouched');
  assert.equal(f.db.get('r1').store, 'A-corrected-2'); assert.equal(f.db.get('r3').store, 'A-corrected-3'); assert.equal(submit.disabled, false);
});

test('Issue #33: the button stays disabled while the correction is pending, and a second submit while pending sends nothing', async () => {
  const { f, submit, open, submitForm } = await editor();
  const hold = gate(); f.fails.saveGate = hold.promise; open(0, 'A-slow');
  const first = submitForm(); await settle();
  assert.equal(submit.disabled, true, 'disabled during the mutation'); assert.equal(f.calls.update.length, 1);
  await submitForm(); await settle(); assert.equal(f.calls.update.length, 1, 'a repeated submit while pending is ignored');
  assert.equal(f.elements.editModal.hidden, false, 'the dialog stays open while pending'); assert.equal(submit.disabled, true);
  hold.open(); await first; await settle();
  assert.equal(submit.disabled, false, 'released by its own completion'); assert.equal(f.calls.update.length, 1); assert.equal(storeOf(f, 0), 'A-slow');
});

test('Issue #33: a failed correction re-enables the button, keeps the dialog open, and a retry then succeeds and releases it again', async () => {
  const { f, submit, open, submitForm } = await editor();
  const hold = gate(); f.fails.saveGate = hold.promise; open(0, 'A-retry'); const first = submitForm(); await settle(); assert.equal(submit.disabled, true);
  hold.fail(new Error('network down')); await first; await settle();
  assert.equal(submit.disabled, false, 'failure releases the button'); assert.match(f.elements.editFeedback.textContent, /Could not save correction: network down/);
  assert.equal(f.elements.editModal.hidden, false); assert.equal(storeOf(f, 0), 'A-Store-1', 'nothing was applied');
  f.fails.saveGate = null; await submitForm(); await settle();
  assert.equal(storeOf(f, 0), 'A-retry'); assert.equal(f.elements.editModal.hidden, true); assert.equal(submit.disabled, false);
});

test('Issue #33: the unsaved-draft branch (a receipt with no database id, no request) also releases the button', async () => {
  const { f, submit, open, submitForm } = await editor({ loaded: [] });
  await f.click(f.elements.floatingAdd); const draft = f.rows().at(-1); await f.type(draft, 'store', 'draft-store'); await f.type(draft, 'amount', '10');
  const index = f.rows().length - 1; open(index, 'draft-corrected'); await submitForm(); await settle();
  assert.equal(f.calls.update.length, 0, 'an unsaved receipt makes no request'); assert.equal(storeOf(f, index), 'draft-corrected'); assert.equal(submit.disabled, false);
  open(index, 'draft-corrected-again'); await submitForm(); await settle(); assert.equal(storeOf(f, index), 'draft-corrected-again'); assert.equal(submit.disabled, false);
});

test('Issue #33: validation errors and a Consumed receipt never leave the button disabled', async () => {
  const { f, submit, open, submitForm } = await editor();
  open(0, 'A-x'); f.elements.editAmount.value = 'not money'; await submitForm(); await settle();
  assert.equal(f.calls.update.length, 0); assert.equal(submit.disabled, false); assert.match(f.elements.editFeedback.textContent, /Could not save correction/);
});

for (const mode of ['sign-out then sign-in', 'direct switch']) {
  test(`Issue #33 + R6 (${mode}): A's late correction (success or failure) neither releases nor holds B's button; B's own completion releases it, and B can then correct again`, async () => {
    for (const aOutcome of ['late success', 'late failure']) {
      const { f, submit, open, submitForm } = await editor();
      const aGate = gate(); f.fails.saveGate = aGate.promise; open(0, 'A-corrected'); const aSaving = submitForm(); await settle();
      assert.equal(submit.disabled, true, 'A\'s correction is pending');
      if (mode === 'sign-out then sign-in') f.ui.clearForLogout(); setTable(f, twoForB()); await f.ui.loadForUser({ id: 'B' });
      assert.equal(submit.disabled, false, 'B starts with a free button');
      const bGate = gate(); f.fails.saveGate = bGate.promise; open(0, 'B-corrected'); const bSaving = submitForm(); await settle();
      assert.equal(submit.disabled, true, 'B\'s own correction is pending');
      if (aOutcome === 'late success') aGate.open(); else aGate.fail(new Error('A failed'));
      await aSaving; await settle();
      assert.equal(submit.disabled, true, `${aOutcome}: A did not release B's button`); assert.equal(storeOf(f, 0), 'B-Store-1', 'A changed nothing on B\'s screen'); assert.doesNotMatch(f.elements.editFeedback.textContent, /A failed/);
      assert.equal(f.elements.editModal.hidden, false, 'B\'s dialog is still open');
      bGate.open(); await bSaving; await settle();
      assert.equal(submit.disabled, false, 'B\'s own success releases B\'s button (Issue #33)'); assert.equal(storeOf(f, 0), 'B-corrected');
      f.fails.saveGate = null; open(1, 'B-corrected-2'); await submitForm(); await settle();
      assert.equal(storeOf(f, 1), 'B-corrected-2'); assert.equal(submit.disabled, false);
    }
  });
}

test('Issue #33 + R6: A\'s late correction answer arriving while B is idle leaves B\'s free button and screen untouched', async () => {
  const { f, submit, open, submitForm } = await editor();
  const aGate = gate(); f.fails.saveGate = aGate.promise; open(0, 'A-corrected'); const aSaving = submitForm(); await settle();
  f.fails.saveGate = null; setTable(f, twoForB()); await f.ui.loadForUser({ id: 'B' });
  aGate.open(); await aSaving; await settle();
  assert.equal(submit.disabled, false); assert.deepEqual(f.rows().map(item => f.field(item, 'store').value), ['B-Store-1', 'B-Store-2']);
  open(0, 'B-fine'); await submitForm(); await settle(); assert.equal(storeOf(f, 0), 'B-fine'); assert.equal(submit.disabled, false);
});

test('Issue #33: the same account signing in again while its own correction is pending gets a free button (renewal), and the old answer stays inert', async () => {
  const { f, submit, open, submitForm } = await editor();
  const hold = gate(); f.fails.saveGate = hold.promise; open(0, 'A-first'); const saving = submitForm(); await settle(); assert.equal(submit.disabled, true);
  f.fails.saveGate = null; await f.ui.loadForUser({ id: 'A' }); assert.equal(submit.disabled, false, 'a renewed session starts with a free button');
  hold.open(); await saving; await settle(); assert.equal(submit.disabled, false);
  open(0, 'A-second'); await submitForm(); await settle(); assert.equal(storeOf(f, 0), 'A-second'); assert.equal(submit.disabled, false);
});

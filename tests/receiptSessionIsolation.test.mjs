// Issue #27, AUTH-10: overlapping account activation and Receipt Encoding load operations. The real receipt UI controller (and, in crossModuleRegression.test.mjs,
// the real app.js bootstrap) driven with independent deferred promises: a load or import that belongs to an earlier account must never render, announce or
// populate suggestions under the next account. Fake backend only; this is not a hosted Supabase test.
import assert from 'node:assert/strict';
import test from 'node:test';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const gate = () => { let open, fail; const promise = new Promise((resolve, reject) => { open = resolve; fail = reject; }); return { promise, open, fail }; };
const row = (dbId, store, amount = 100) => ({ dbId, store, amount, receiptDate: '2026-08-01' });
const stores = f => f.rows().map(item => f.field(item, 'store').value);
const setTable = (f, rows) => { f.db.clear(); rows.forEach(item => f.db.set(item.dbId, { amount: '', receiptDate: '', vat: '', invoice: '', store: '', address: '', tin: '', status: 'available', updatedAt: f.stamp(), ...item })); };
const visible = f => [stores(f).join(','), f.elements.encodingFeedback.textContent, f.elements.receiptCount.textContent].join(' | ');

test('AUTH-10a: an earlier account\'s slow load that resolves AFTER the next account\'s load never replaces its receipts', async () => {
  const f = await receiptFixture({ loaded: [row('seed', 'seed')] });
  setTable(f, [row('a1', 'A-secret-store'), row('a2', 'A-other')]);
  const slow = gate(); f.fails.loadGates.push(slow.promise); const aLoading = f.ui.loadForUser({ id: 'A' }); await settle();
  setTable(f, [row('b1', 'B-store')]); await f.ui.loadForUser({ id: 'B' });
  assert.deepEqual(stores(f), ['B-store']);
  slow.open(); await aLoading; await settle();
  assert.deepEqual(stores(f), ['B-store'], 'A\'s receipts do not appear under B'); assert.doesNotMatch(visible(f), /A-secret|A-other/);
  assert.equal(f.elements.receiptCount.textContent, '1 receipt');
});

test('AUTH-10b: an earlier account\'s load that resolves BEFORE the next account\'s load finishes does not render under the next account either', async () => {
  const f = await receiptFixture({ loaded: [row('seed', 'seed')] });
  setTable(f, [row('a1', 'A-secret-store')]); const aGate = gate(); f.fails.loadGates.push(aGate.promise); const aLoading = f.ui.loadForUser({ id: 'A' }); await settle();
  setTable(f, [row('b1', 'B-store')]); const bGate = gate(); f.fails.loadGates.push(bGate.promise); const bLoading = f.ui.loadForUser({ id: 'B' }); await settle();
  assert.doesNotMatch(visible(f), /A-secret/, 'while B is loading the screen holds no receipts of the account that was active before');
  aGate.open(); await aLoading; await settle();
  assert.doesNotMatch(visible(f), /A-secret/, 'A\'s answer arrives while B is still loading: nothing is rendered');
  bGate.open(); await bLoading; await settle();
  assert.deepEqual(stores(f), ['B-store']);
});

test('AUTH-10c: signing out while a load is running means the load never renders afterwards', async () => {
  const f = await receiptFixture({ loaded: [row('seed', 'seed')] });
  setTable(f, [row('a1', 'A-secret-store')]); const hold = gate(); f.fails.loadGates.push(hold.promise); const loading = f.ui.loadForUser({ id: 'A' }); await settle();
  f.ui.clearForLogout(); hold.open(); await loading; await settle();
  assert.deepEqual(stores(f), []); assert.doesNotMatch(visible(f), /A-secret/); assert.equal(f.elements.exportSelected.disabled, true);
});

test('AUTH-10d: a Company Directory list that fails late for an earlier account shows no warning under the next account', async () => {
  const queue = []; // each entry answers one directory request: { hold, fail }
  const f = await receiptFixture({ loaded: [], sharedStoreList: async () => { const next = queue.shift(); if (next?.hold) await next.hold.promise; if (next?.fail) throw new Error('directory down'); return []; } });
  const hold = gate(); queue.push({ hold, fail: true }); setTable(f, [row('a1', 'A-store')]);
  const aLoading = f.ui.loadForUser({ id: 'A' }); await settle();
  setTable(f, [row('b1', 'B-store')]); await f.ui.loadForUser({ id: 'B' });
  assert.equal(f.elements.encodingFeedback.textContent, '');
  hold.open(); await aLoading; await settle();
  assert.doesNotMatch(f.elements.encodingFeedback.textContent, /Company Store Directory is temporarily unavailable/, 'the stale failure is silent'); assert.deepEqual(stores(f), ['B-store']);
});

test('AUTH-10e: a legacy-draft import that finishes after the account changed is not rendered under the next account', async () => {
  const f = await receiptFixture({ loaded: [row('b-seed', 'B-seed')] });
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => key.includes('imported-for') ? null : JSON.stringify({ receipts: [{ store: 'Draft-of-A', amount: '12' }] }), setItem() {}, removeItem() {} };
  try {
    const hold = gate(); f.fails.importGate = hold.promise;
    const importing = f.ui.importLegacyDraft({ id: 'A' }); await settle();
    f.ui.clearForLogout(); await f.ui.loadForUser({ id: 'B' });
    hold.open(); await importing; await settle();
    assert.doesNotMatch(visible(f), /Draft-of-A|Import completed/); assert.deepEqual(stores(f), ['B-seed']);
  } finally { globalThis.localStorage = original; }
});

test('AUTH-10f: the same account signing in again is a new session: the older load of the same id is ignored', async () => {
  const f = await receiptFixture({ loaded: [row('seed', 'seed')] });
  setTable(f, [row('a1', 'A-v1')]); const hold = gate(); f.fails.loadGates.push(hold.promise); const first = f.ui.loadForUser({ id: 'A' }); await settle();
  setTable(f, [row('a1', 'A-v2')]); await f.ui.loadForUser({ id: 'A' });
  hold.open(); await first; await settle();
  assert.deepEqual(stores(f), ['A-v2']);
});

// ---- Round 1 review of PR #31, R3: Receipt Encoding's review/edit dialogs and pending export belong to the session that opened them ----------------------------
const threeForA = () => [row('r1', 'A-Store-1', 100), row('r2', 'A-Store-2', 200), row('r3', 'A-Store-3', 300)];
const twoForB = () => [row('b1', 'B-Store-1', 100), row('b2', 'B-Store-2', 200)];
const modalOpen = f => f.elements.exportConfirmModal.hidden === false;
const textOf = node => [node.textContent ?? '', ...(node.children ?? []).map(textOf)].join(' ');
const reviewText = f => f.elements.exportReviewList.children.map(textOf).join(' ');
const bestMatch = async (f, target) => { f.elements.target.value = target; await f.click(f.elements.calculate); };
const endModes = { 'sign-out then sign-in': f => f.ui.clearForLogout(), 'direct switch': () => {} };
// The next account: its table, optionally with its load held, then the load itself. Returns the promise of that load.
function startB(f, mode, { hold } = {}) { endModes[mode](f); setTable(f, twoForB()); if (hold) f.fails.loadGates.push(hold.promise); return f.ui.loadForUser({ id: 'B' }); }
// B must be able to review, export and consume its own receipts afterwards: none of A's flags or guards may linger.
async function bExportsItsOwn(f) {
  const before = { downloads: f.calls.download.length, consumes: f.calls.consume.length };
  await bestMatch(f, '300'); await f.click(f.elements.exportSelected); assert.equal(modalOpen(f), true, 'B\'s own review opens'); await f.click(f.elements.confirmExport);
  assert.equal(f.calls.download.length, before.downloads + 1); assert.deepEqual(f.calls.download.at(-1).map(item => item.dbId).sort(), ['b1', 'b2']);
  assert.deepEqual(f.calls.consume.at(-1).slice().sort(), ['b1', 'b2']); assert.equal(f.calls.consume.length, before.consumes + 1);
}

for (const mode of ['sign-out then sign-in', 'direct switch']) {
  test(`R3 (${mode}): A's Review & Arrange dialog is closed and emptied at once, before B's load answers, and its Confirm does nothing`, async () => {
    const f = await receiptFixture({ loaded: threeForA() }); await bestMatch(f, '500'); await f.click(f.elements.exportSelected);
    assert.equal(modalOpen(f), true); assert.match(reviewText(f), /A-Store/);
    const hold = gate(); const loading = startB(f, mode, { hold }); await settle();
    assert.equal(modalOpen(f), false, 'closed while B is still loading'); assert.doesNotMatch(reviewText(f), /A-Store/, 'A\'s receipts are gone from the review list');
    await f.click(f.elements.confirmExport); assert.equal(f.calls.download.length, 0); assert.equal(f.calls.consume.length, 0);
    hold.open(); await loading; await settle();
    assert.equal(modalOpen(f), false); assert.deepEqual(stores(f), ['B-Store-1', 'B-Store-2']); await bExportsItsOwn(f);
  });

  test(`R3 (${mode}): a slow review read (Snapshot A) that answers after the switch opens no dialog, shows nothing of A, and leaves B free to export (${mode})`, async () => {
    const f = await receiptFixture({ loaded: threeForA() }); await bestMatch(f, '500');
    const snapshot = gate(); f.fails.snapshotHold = snapshot.promise; const opening = f.elements.exportSelected.emit('click'); await settle();
    assert.equal(f.elements.exportSelected.getAttribute('aria-busy'), 'true');
    await startB(f, mode); f.fails.snapshotHold = null;
    snapshot.open(); await opening; await settle();
    assert.equal(modalOpen(f), false, 'no review dialog for A appears for B'); assert.doesNotMatch(reviewText(f), /A-Store/); assert.doesNotMatch(f.elements.encodingFeedback.textContent + f.elements.difference.textContent, /Nothing was exported|selected receipts/);
    await bExportsItsOwn(f);
  });

  test(`R3 (${mode}): an export confirmed for A whose final read (Snapshot B) answers after the switch generates no workbook and consumes nothing (${mode})`, async () => {
    const f = await receiptFixture({ loaded: threeForA() }); await bestMatch(f, '500'); await f.click(f.elements.exportSelected); assert.equal(modalOpen(f), true);
    const snapshot = gate(); f.fails.snapshotHold = snapshot.promise; const confirming = f.elements.confirmExport.emit('click'); await settle();
    await startB(f, mode); f.fails.snapshotHold = null;
    snapshot.open(); await confirming; await settle();
    assert.equal(f.calls.download.length, 0, 'no workbook is generated after the session ended'); assert.equal(f.calls.consume.length, 0, 'nothing is marked Consumed');
    assert.equal(modalOpen(f), false); assert.doesNotMatch(f.elements.difference.textContent + f.elements.encodingFeedback.textContent, /exported|Consumed|XLSX/);
    await bExportsItsOwn(f);
  });

  test(`R3 (${mode}): a consume already sent for A that answers after the switch changes nothing on B's screen and holds no lock (${mode})`, async () => {
    const f = await receiptFixture({ loaded: threeForA() }); await bestMatch(f, '500'); await f.click(f.elements.exportSelected);
    const consume = gate(); f.fails.gate = consume.promise; const confirming = f.elements.confirmExport.emit('click'); await settle();
    assert.equal(f.calls.download.length, 1, 'the workbook was generated before the switch: this cannot be recalled'); assert.equal(f.calls.consume.length, 1, 'the status update was sent before the switch: this cannot be recalled');
    await startB(f, mode); f.fails.gate = null; const resultBefore = f.elements.resultTitle.textContent;
    consume.open(); await confirming; await settle();
    assert.equal(f.elements.resultTitle.textContent, resultBefore); assert.doesNotMatch(f.elements.difference.textContent + f.elements.encodingFeedback.textContent + f.elements.manualFeedback.textContent, /exported and marked|Consumed|workbook/i);
    assert.equal(modalOpen(f), false); assert.deepEqual(stores(f), ['B-Store-1', 'B-Store-2']);
    await bExportsItsOwn(f);
  });

  test(`R3 (${mode}): A's Edit dialog is closed at once, and a correction saved for A that answers late changes nothing for B (${mode})`, async () => {
    const f = await receiptFixture({ loaded: threeForA() });
    const first = f.rows()[0]; f.elements.editModal.dataset.receiptIndex = '0'; f.elements.editAmount.value = '100'; f.elements.editStore.value = 'A-corrected';
    for (const [key, field] of Object.entries({ editReceiptDate: 'receiptDate', editVat: 'vat', editInvoice: 'invoice', editAddress: 'address', editTin: 'tin' })) f.elements[key].value = f.field(first, field).value;
    f.elements.editModal.hidden = false;
    const saveHold = gate(); f.fails.saveGate = saveHold.promise; const saving = f.elements.editForm.emit('submit', { submitter: null }); await settle();
    assert.equal(f.calls.update.length, 1, 'the correction was sent before the switch');
    const hold = gate(); const loading = startB(f, mode, { hold }); await settle();
    assert.equal(f.elements.editModal.hidden, true, 'A\'s Edit dialog is closed while B is still loading');
    hold.open(); await loading; f.fails.saveGate = null; await settle();
    saveHold.open(); await saving; await settle();
    assert.equal(f.elements.editModal.hidden, true); assert.doesNotMatch(f.elements.editFeedback.textContent + f.elements.encodingFeedback.textContent, /A-corrected|correction/i); assert.deepEqual(stores(f), ['B-Store-1', 'B-Store-2']);
  });
}

test('R3: A\'s finishing review does not release B\'s own pending review or its busy state', async () => {
  const f = await receiptFixture({ loaded: threeForA() }); await bestMatch(f, '500');
  const aRead = gate(); f.fails.snapshotHold = aRead.promise; const aOpening = f.elements.exportSelected.emit('click'); await settle();
  await startB(f, 'direct switch'); await bestMatch(f, '300');
  const bRead = gate(); f.fails.snapshotHold = bRead.promise; const bOpening = f.elements.exportSelected.emit('click'); await settle();
  assert.equal(f.elements.exportSelected.getAttribute('aria-busy'), 'true'); const reads = f.calls.snapshot.length;
  aRead.open(); await aOpening; await settle();
  assert.equal(f.elements.exportSelected.getAttribute('aria-busy'), 'true', 'A\'s finally did not clear B\'s busy state');
  await f.elements.exportSelected.emit('click'); await settle(); assert.equal(f.calls.snapshot.length, reads, 'a second click while B\'s review is pending starts nothing: B\'s pending flag is intact');
  f.fails.snapshotHold = null; bRead.open(); await bOpening; await settle();
  assert.equal(modalOpen(f), true, 'B\'s review opens normally'); assert.match(reviewText(f), /B-Store/); assert.doesNotMatch(reviewText(f), /A-Store/);
});

test('R3: a correction saved for A that answers after the switch neither cancels B\'s running calculation nor adds A\'s receipt to B\'s suggestions', async () => {
  const runs = []; const optimizer = { run(args) { const record = { cancelled: false }; record.promise = new Promise(resolve => { record.settle = resolve; }); runs.push(record); return { promise: record.promise, cancel: () => { record.cancelled = true; } }; } };
  const f = await receiptFixture({ loaded: threeForA(), poolOptimizer: optimizer });
  const first = f.rows()[0]; f.elements.editModal.dataset.receiptIndex = '0'; f.elements.editAmount.value = '100'; f.elements.editStore.value = 'A-corrected';
  for (const [key, field] of Object.entries({ editReceiptDate: 'receiptDate', editVat: 'vat', editInvoice: 'invoice', editAddress: 'address', editTin: 'tin' })) f.elements[key].value = f.field(first, field).value;
  f.elements.editModal.hidden = false;
  const saveHold = gate(); f.fails.saveGate = saveHold.promise; const saving = f.elements.editForm.emit('submit', { submitter: null }); await settle();
  endModes['direct switch'](f); setTable(f, Array.from({ length: 40 }, (_, i) => row(`b${i}`, `B-Store-${i}`, 100 + i))); await f.ui.loadForUser({ id: 'B' }); f.fails.saveGate = null;
  await bestMatch(f, '1000'); assert.equal(runs.length, 1, 'B\'s long-pool calculation is running'); assert.equal(f.elements.calculate.disabled, true);
  saveHold.open(); await saving; await settle();
  assert.equal(runs[0].cancelled, false, 'A\'s late correction did not stop B\'s calculation'); assert.equal(f.elements.calculate.disabled, true);
});

// ---- Round 2 review of PR #31: R5 (every remaining asynchronous Receipt Encoding continuation) and R6 (the shared Edit submit button) -------------------------------
const consumedA = () => ({ ...row('a1', 'A-CONFIDENTIAL-STORE', 100), address: 'A-PRIVATE-ADDRESS 12 Secret Street', tin: 'A-TIN-999', status: 'consumed' });
const isSecret = text => /A-CONFIDENTIAL|A-PRIVATE|A-TIN|Secret Street/.test(text);
// What B's personal "My receipt history" autocomplete offers for what B types in its first receipt's Store field.
async function suggestionsFor(f, typed) {
  const first = f.rows()[0]; await f.type(first, 'store', typed);
  return first.part('.store-suggestions').children.flatMap(item => item.children ?? []).map(option => [option.children?.[0]?.textContent, option.children?.[1]?.textContent].join(' '));
}
const quiet = (f, pattern) => assert.doesNotMatch([f.elements.encodingFeedback.textContent, f.elements.difference.textContent, f.elements.manualFeedback.textContent].join(' | '), pattern);

for (const mode of ['sign-out then sign-in', 'direct switch']) {
  test(`R5 (${mode}): a Restore (Mark Available) that answers after the switch puts nothing of A into B's receipt-history suggestions, and says nothing on B's screen (${mode})`, async () => {
    const f = await receiptFixture({ loaded: [consumedA()] });
    const hold = gate(); f.fails.restoreGate = hold.promise; const restoring = f.rows()[0].part('.restore-receipt').emit('click'); await settle();
    assert.equal(f.db.get('a1').status, 'available', 'the status update was sent before the switch: this cannot be recalled');
    await startB(f, mode); f.fails.restoreGate = null;
    assert.deepEqual((await suggestionsFor(f, 'A-')).filter(isSecret), [], 'nothing of A before the late answer');
    hold.open(); await restoring; await settle();
    assert.deepEqual((await suggestionsFor(f, 'A-')).filter(isSecret), [], 'A\'s store, address and TIN do not appear in B\'s suggestions after the late answer');
    assert.deepEqual((await suggestionsFor(f, 'B-Store')).length > 0, true, 'B\'s own history is still offered');
    quiet(f, /marked as Available|restore this receipt/i);
  });

  test(`R5 (${mode}): a Delete that answers after the switch neither clears B's Best Match selection nor speaks on B's screen (${mode})`, async () => {
    const f = await receiptFixture({ loaded: threeForA() });
    const hold = gate(); f.fails.deleteGate = hold.promise; const deleting = f.rows()[0].part('.delete-receipt').emit('click'); await settle();
    assert.deepEqual(f.calls.deleted, ['r1'], 'the delete was sent before the switch');
    await startB(f, mode); f.fails.deleteGate = null; await bestMatch(f, '300');
    assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)');
    hold.open(); await deleting; await settle();
    assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)', 'B\'s selection is intact'); assert.equal(f.elements.exportSelected.disabled, false);
    quiet(f, /delete/i);
  });

  test(`R5 (${mode}): a permanent Consumed delete that answers after the switch changes nothing on B's screen (${mode})`, async () => {
    const f = await receiptFixture({ loaded: [consumedA()] });
    const hold = gate(); f.fails.deleteGate = hold.promise; const deleting = f.rows()[0].part('.delete-consumed').emit('click'); await settle();
    assert.deepEqual(f.calls.deleted, ['a1']);
    await startB(f, mode); f.fails.deleteGate = null; await bestMatch(f, '300');
    hold.open(); await deleting; await settle();
    assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)'); quiet(f, /deleted permanently|Consumed receipt/i);
  });

  test(`R5 (${mode}): a Company Directory contribution from a receipt card that answers late (success or failure) says nothing on B's screen (${mode})`, async () => {
    for (const outcome of ['success', 'failure']) {
      const hold = gate(); const sharedStore = { listActiveSharedStores: async () => [], contributeSharedStore: async () => { await hold.promise; if (outcome === 'failure') throw new Error('directory refused A'); return { id: 's1', storeName: 'A-Contrib' }; } };
      const f = await receiptFixture({ loaded: [{ ...row('a1', 'A-Contrib', 100), address: 'A address' }], sharedStore });
      const contributing = f.rows()[0].part('.contribute-store').emit('click'); await settle();
      await startB(f, mode);
      hold.open(); await contributing.catch(() => {}); await settle();
      quiet(f, /Company Store Directory|could not add this store|directory refused A/i);
    }
  });

  test(`R5 (${mode}): after A's save, a Company Directory prompt open at the switch is not followed by prompts for A's other stores or messages on B's screen (${mode})`, async () => {
    const answer = gate(); const prompts = [];
    const f = await receiptFixture({ loaded: [], confirm: async options => { prompts.push(options.message ?? options.title); return options.title === 'Add store to Company Directory?' ? answer.promise : true; } });
    for (const [store, address] of [['A-Fresh-One', '1 Alpha Street'], ['A-Fresh-Two', '2 Beta Street']]) {
      await f.click(f.elements.floatingAdd); const blank = f.rows().at(-1);
      await f.type(blank, 'store', store); await f.type(blank, 'address', address); await f.type(blank, 'amount', '10');
    }
    const saving = f.elements.saveDraft.emit('click'); await settle(); await settle();
    assert.equal(prompts.filter(text => /A-Fresh-One/.test(text)).length, 1, 'the first prompt is open');
    await startB(f, mode); answer.open(false); await saving; await settle(); await settle();
    assert.equal(prompts.filter(text => /A-Fresh-Two/.test(text)).length, 0, 'A\'s second store is never offered to B');
    quiet(f, /kept in My Receipt History|Company Directory|A-Fresh/i);
  });
}

for (const mode of ['sign-out then sign-in', 'direct switch']) {
  test(`R5 (${mode}): a contribution sent from A's post-save prompt that answers after the switch is not followed by prompts for A's other stores (${mode})`, async () => {
    const hold = gate(); const prompts = [];
    const sharedStore = { listActiveSharedStores: async () => [], contributeSharedStore: async () => { await hold.promise; return { id: 's1', storeName: 'A-Fresh-One' }; } };
    const f = await receiptFixture({ loaded: [], sharedStore, confirm: async options => { prompts.push(options.message ?? options.title); return true; } });
    for (const [store, address] of [['A-Fresh-One', '1 Alpha Street'], ['A-Fresh-Two', '2 Beta Street']]) {
      await f.click(f.elements.floatingAdd); const blank = f.rows().at(-1);
      await f.type(blank, 'store', store); await f.type(blank, 'address', address); await f.type(blank, 'amount', '10');
    }
    const saving = f.elements.saveDraft.emit('click'); await settle(); await settle();
    assert.equal(prompts.filter(text => /A-Fresh-One/.test(text)).length, 1, 'the first prompt was answered Yes and its contribution is in flight');
    await startB(f, mode); hold.open(); await saving; await settle(); await settle();
    assert.equal(prompts.filter(text => /A-Fresh-Two/.test(text)).length, 0, 'A\'s second store is never offered to B');
    quiet(f, /Company Directory|A-Fresh/i);
  });
}

test('R5 (audit): an OCR scan that finishes after the switch fills only A\'s own card and shows or adds nothing under B', async () => {
  const hold = gate(); let scanned;
  const scan = async (file, rowElement, done) => { scanned = rowElement; await hold.promise; rowElement.part('.receipt-store').value = 'A-OCR-STORE'; rowElement.part('.receipt-tin').value = 'A-OCR-TIN'; done(rowElement); };
  const f = await receiptFixture({ loaded: threeForA(), scan });
  const photo = f.rows()[0].part('.receipt-photo'); photo.files = [{ name: 'receipt.jpg' }]; await photo.emit('change'); await settle();
  assert.ok(scanned, 'the scan started for A\'s card');
  await startB(f, 'direct switch'); const before = [f.elements.availableTotal.textContent, f.elements.encodingUnsavedText.textContent];
  hold.open(); await settle(); await settle();
  assert.deepEqual([f.elements.availableTotal.textContent, f.elements.encodingUnsavedText.textContent], before, 'B\'s totals and unsaved count are untouched');
  assert.deepEqual(stores(f), ['B-Store-1', 'B-Store-2']); assert.deepEqual((await suggestionsFor(f, 'A-OCR')).filter(text => /A-OCR/.test(text)), []);
});

test('R6: a stale correction answer (late success or late failure) never re-enables the shared Save correction button while B\'s own correction is pending', async () => {
  for (const aOutcome of ['late success', 'late failure']) {
    const f = await receiptFixture({ loaded: threeForA() });
    const submit = { disabled: false }; f.elements.editForm.querySelector = selector => /submit/.test(selector) ? submit : null; // the one shared button of the Edit dialog
    const fill = (index, store) => { const target = f.rows()[index]; f.elements.editModal.dataset.receiptIndex = String(index); f.elements.editAmount.value = f.field(target, 'amount').value; f.elements.editStore.value = store; for (const [key, field] of Object.entries({ editReceiptDate: 'receiptDate', editVat: 'vat', editInvoice: 'invoice', editAddress: 'address', editTin: 'tin' })) f.elements[key].value = f.field(target, field).value; f.elements.editModal.hidden = false; };
    const aGate = gate(); f.fails.saveGate = aGate.promise; fill(0, 'A-corrected'); const aSaving = f.elements.editForm.emit('submit', { submitter: submit }); await settle();
    assert.equal(submit.disabled, true, 'A\'s correction is pending');
    await startB(f, 'direct switch'); assert.equal(submit.disabled, false, 'the new session starts with a free button');
    const bGate = gate(); f.fails.saveGate = bGate.promise; fill(0, 'B-corrected'); const bSaving = f.elements.editForm.emit('submit', { submitter: submit }); await settle();
    assert.equal(submit.disabled, true, 'B\'s own correction is pending');
    if (aOutcome === 'late success') aGate.open(); else aGate.fail(new Error('A update failed'));
    await aSaving; await settle();
    assert.equal(submit.disabled, true, `${aOutcome}: A's answer did not touch B's button`); assert.doesNotMatch(f.elements.editFeedback.textContent, /A update failed/);
    bGate.fail(new Error('B update failed')); await bSaving; await settle();
    assert.equal(submit.disabled, false, 'B\'s own completion releases its own button'); assert.match(f.elements.editFeedback.textContent, /B update failed/);
  }
});

// ---- Round 3 review of PR #31, R7: a late confirmation from A must not change B's receipts, selections, feedback or focus ------------------------------------------------
// The shared prompt is dismissed (answer false) by app.js when an account ends or changes; these tests use the harder case, an alternate or delayed confirmation that
// still answers TRUE after B's session is in place, so the controller must not trust the prompt.
const manyFor = (prefix, count) => Array.from({ length: count }, (_, i) => row(`${prefix}${i + 1}`, `${prefix}-Store-${i + 1}`, 10 + i));
const heldConfirm = title => { const answer = gate(); const asked = []; return { answer, asked, confirm: async options => { if (options.title !== title) return true; asked.push(options.title); return answer.promise; } }; };
const selectAllShown = async f => { f.elements.exportModeManual.checked = true; f.elements.exportModeBestMatch.checked = false; await f.elements.exportModeManual.emit('change'); await f.click(f.elements.manualSelectShown); };
const feedbackOf = f => [f.elements.encodingFeedback.textContent, f.elements.manualFeedback.textContent, f.elements.difference.textContent].join(' | ');

for (const mode of ['sign-out then sign-in', 'direct switch']) {
  test(`R7 (${mode}): a late "Clear the manual selection?" confirmation from A does not clear B's manual selection, feedback or focus (${mode})`, async () => {
    const held = heldConfirm('Clear the manual selection?');
    const f = await receiptFixture({ loaded: manyFor('a', 30), confirm: held.confirm });
    await selectAllShown(f); assert.equal(f.elements.manualSelectedCount.textContent.startsWith('30'), true, 'A has 30 selected');
    const clearing = f.elements.manualClearSelection.emit('click'); await settle(); assert.equal(held.asked.length, 1, 'the confirmation is open for A');
    endModes[mode](f); setTable(f, manyFor('b', 30)); await f.ui.loadForUser({ id: 'B' }); await selectAllShown(f);
    const selected = f.elements.manualSelectedCount.textContent, feedbackBefore = feedbackOf(f), focusBefore = f.focusLog.length;
    assert.equal(selected.startsWith('30'), true, 'B has its own 30 selected');
    held.answer.open(true); await clearing; await settle();
    assert.equal(f.elements.manualSelectedCount.textContent, selected, 'B\'s selection is intact'); assert.equal(feedbackOf(f), feedbackBefore); assert.doesNotMatch(feedbackOf(f), /Manual selection cleared/);
    assert.equal(f.focusLog.length, focusBefore, 'no focus moved in B\'s screen');
    await f.click(f.elements.manualClearSelection); // same-session behavior: B can still clear its own selection after confirming
  });

  test(`R7 (${mode}): a late "Clear receipts from this form?" confirmation from A does not erase B's form, unsaved edits, selection or focus (${mode})`, async () => {
    const held = heldConfirm('Clear receipts from this form?');
    const f = await receiptFixture({ loaded: threeForA(), confirm: held.confirm });
    const clearing = f.elements.clearAll.emit('click'); await settle(); assert.equal(held.asked.length, 1);
    endModes[mode](f); setTable(f, twoForB()); await f.ui.loadForUser({ id: 'B' });
    await f.type(f.rows()[0], 'store', 'B-unsaved-edit'); await bestMatch(f, '300');
    const exportLabel = f.elements.exportSelected.textContent, feedbackBefore = feedbackOf(f), focusBefore = f.focusLog.length;
    held.answer.open(true); await clearing; await settle();
    assert.equal(f.rows().length, 2, 'B\'s form is intact'); assert.equal(f.field(f.rows()[0], 'store').value, 'B-unsaved-edit', 'B\'s unsaved edit survives');
    assert.equal(f.elements.exportSelected.textContent, exportLabel, 'B\'s Best Match selection survives'); assert.equal(feedbackOf(f), feedbackBefore); assert.equal(f.focusLog.length, focusBefore);
  });

  test(`R7 (${mode}): a late "Discard unfinished receipt?" confirmation from A removes nothing of B's and clears no selection or focus of B (${mode})`, async () => {
    const held = heldConfirm('Discard unfinished receipt?');
    const f = await receiptFixture({ loaded: [], confirm: held.confirm });
    await f.click(f.elements.floatingAdd); const draft = f.rows()[0]; await f.type(draft, 'store', 'A-draft-store');
    const discarding = draft.part('.delete-receipt').emit('click'); await settle(); assert.equal(held.asked.length, 1, 'the discard question is open for A');
    endModes[mode](f); setTable(f, twoForB()); await f.ui.loadForUser({ id: 'B' }); await bestMatch(f, '300');
    const exportLabel = f.elements.exportSelected.textContent, feedbackBefore = feedbackOf(f), focusBefore = f.focusLog.length;
    held.answer.open(true); await discarding; await settle();
    assert.equal(f.rows().length, 2); assert.deepEqual(stores(f), ['B-Store-1', 'B-Store-2']); assert.equal(f.elements.exportSelected.textContent, exportLabel, 'B\'s selection survives');
    assert.equal(feedbackOf(f), feedbackBefore); assert.equal(f.focusLog.length, focusBefore, 'no focus moved');
  });
}

test('R7: in the same session, confirming still clears the manual selection, the form and an unfinished receipt', async () => {
  const f = await receiptFixture({ loaded: manyFor('a', 30) }); // the default confirmation answers Yes
  await selectAllShown(f); await f.click(f.elements.manualClearSelection); assert.equal(f.elements.manualFeedback.textContent, 'Manual selection cleared.');
  await f.click(f.elements.floatingAdd); const draft = f.rows().at(-1); await f.type(draft, 'store', 'draft'); const before = f.rows().length;
  await f.click(draft.part('.delete-receipt')); assert.equal(f.rows().length, before - 1, 'the unfinished receipt was discarded');
  await f.click(f.elements.clearAll); assert.equal(f.rows().length, 0, 'the form was cleared');
});

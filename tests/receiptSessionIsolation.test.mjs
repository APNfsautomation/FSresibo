// Issue #27, AUTH-10: overlapping account activation and Receipt Encoding load operations. The real receipt UI controller (and, in crossModuleRegression.test.mjs,
// the real app.js bootstrap) driven with independent deferred promises: a load or import that belongs to an earlier account must never render, announce or
// populate suggestions under the next account. Fake backend only; this is not a hosted Supabase test.
import assert from 'node:assert/strict';
import test from 'node:test';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const gate = () => { let open; const promise = new Promise(resolve => { open = resolve; }); return { promise, open }; };
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

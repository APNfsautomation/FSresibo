// CP10-C3E-3: pointer dragging inside the real Review & Arrange dialog (real receipt UI, in-memory receipts database, fake layout).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildExpenseDetailedReportRows } from '../services/exportService.js';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const saved = (dbId, amount, store, extra = {}) => ({ dbId, amount, store, ...extra });
const four = () => [saved('r1', 100, 'Store A'), saved('r2', 200, 'Store B'), saved('r3', 300, 'Store C'), saved('r4', 400, 'Store D')];
const calculate = async (f, target) => { f.elements.target.value = target; await f.click(f.elements.calculate); };
const items = f => f.elements.exportReviewList.children;
const order = f => items(f).map(item => item.dataset.receiptId);
const parts = (f, id) => items(f).find(item => item.dataset.receiptId === id).reviewParts;
const dialogOpen = f => f.elements.exportConfirmModal.hidden === false;
const confirm = f => f.click(f.elements.confirmExport);
const press = (f, id, key) => parts(f, id).handle.emit('keydown', { key });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fakeModalFocus = () => { const log = { open: [], close: [] }; return { log, open: (modal, options) => log.open.push(options), close: (modal, options) => log.close.push(options) }; };

// Each review row gets a layout: row k occupies 100 + 60k .. 100 + 60k + 56 (the real layout is the browser's; only the drop logic is under test).
const layout = f => items(f).forEach(item => { item.getBoundingClientRect = () => { const k = items(f).indexOf(item); return { top: 100 + 60 * k, height: 56, bottom: 156 + 60 * k, left: 0, right: 600 }; }; });
const middle = k => 100 + 60 * k + 28;
const open = async (f, { target = '1000' } = {}) => { await calculate(f, target); await f.click(f.elements.exportSelected); layout(f); return f; };
const down = (f, id, y = middle(order(f).indexOf(id)), extra = {}) => parts(f, id).handle.emit('pointerdown', { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 40, clientY: y, ...extra });
const move = (f, id, y, extra = {}) => parts(f, id).handle.emit('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 40, clientY: y, ...extra });
const up = (f, id, y, extra = {}) => parts(f, id).handle.emit('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 40, clientY: y, ...extra });
const dragTo = (f, id, y, extra = {}) => { down(f, id, undefined, extra); move(f, id, y, extra); up(f, id, y, extra); };
const dragging = f => items(f).some(item => item.classList.contains('is-dragging')) || f.elements.exportReviewList.classList.contains('is-dragging');

test('A: dragging the first receipt below the last moves it to the end, through the one move operation', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  dragTo(f, 'r1', middle(3) + 20);
  assert.deepEqual(order(f), ['r2', 'r3', 'r4', 'r1']);
  assert.deepEqual(items(f).map(item => item.reviewParts.position.textContent), ['1', '2', '3', '4']);
  assert.match(f.elements.exportReviewAnnouncer.textContent, /^Receipt 1 moved to position 4 of 4\.\s*$/);
  assert.equal(f.focusLog.at(-1), parts(f, 'r1').handle, 'focus is on the handle of the moved receipt');
  assert.equal(dragging(f), false); assert.equal(f.elements.exportReviewReset.disabled, false);
});

test('A: last to first, and across several positions', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  dragTo(f, 'r4', 0); assert.deepEqual(order(f), ['r4', 'r1', 'r2', 'r3']);
  layout(f); dragTo(f, 'r1', middle(3) + 5); assert.deepEqual(order(f), ['r4', 'r2', 'r3', 'r1']);
});

test('B: a small movement is not a drag: nothing is announced, moved or highlighted', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  down(f, 'r2'); move(f, 'r2', middle(1) + 2); up(f, 'r2', middle(1) + 2);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']); assert.equal(dragging(f), false);
  assert.doesNotMatch(f.elements.exportReviewAnnouncer.textContent, /Picked up|moved/);
});

test('G, C, D: while dragging, the row is lifted, the others slide to make room BEFORE release, and a slot marks the landing place; the list is not rebuilt', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  f.elements.exportReviewList.getBoundingClientRect = () => ({ top: 100 }); // the list starts where the first row starts
  const vars = new Map(); f.elements.exportReviewList.style.setProperty = (key, value) => vars.set(key, value); f.elements.exportReviewList.style.removeProperty = key => vars.delete(key);
  const before = [...items(f)];
  down(f, 'r1'); move(f, 'r1', middle(0) + 20);
  assert.match(f.elements.exportReviewAnnouncer.textContent, /^Picked up Receipt 1, position 1 of 4\. Drag to a new position, or press Escape to cancel\./);
  assert.equal(items(f)[0].classList.contains('is-dragging'), true);
  assert.deepEqual([1, 2, 3].map(i => items(f)[i].style.transform ?? ''), ['', '', ''], 'nothing slides until the pointer passes a middle');
  move(f, 'r1', middle(2) + 5);
  assert.deepEqual([1, 2, 3].map(i => items(f)[i].style.transform ?? ''), ['translateY(-60px)', 'translateY(-60px)', ''], 'rows 2 and 3 have already moved up one slot');
  assert.equal(vars.get('--drag-slot-top'), '120px'); assert.equal(vars.get('--drag-slot-height'), '56px');
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4'], 'the real order only changes on release');
  assert.deepEqual(items(f), before, 'the same row elements, in the same order, while dragging');
  up(f, 'r1', middle(2) + 5);
  assert.deepEqual(order(f), ['r2', 'r3', 'r1', 'r4']);
  assert.equal(vars.size, 0, 'the slot variables are cleared');
  assert.equal(items(f).every(item => !item.style.transform), true);
});

test('B: pressing a row and releasing without moving changes nothing and keeps keyboard focus on the row', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  down(f, 'r3'); up(f, 'r3', middle(2));
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']); assert.equal(f.focusLog.at(-1), parts(f, 'r3').row, 'the row is focused by the press (for the keyboard)');
  assert.equal(dragging(f), false);
});

test('buttons: Move up / Move down are not intercepted by the row, and a press that starts on one never starts a drag', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  const onButton = { closest: selector => /button/.test(selector) ? parts(f, 'r2').up : null };
  down(f, 'r2', middle(1), { target: onButton }); move(f, 'r2', middle(3), { target: onButton }); up(f, 'r2', middle(3), { target: onButton });
  assert.equal(dragging(f), false); assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4'], 'no drag, no move');
  await parts(f, 'r2').up.emit('click'); assert.deepEqual(order(f), ['r2', 'r1', 'r3', 'r4'], 'the button still moves the receipt');
  assert.equal(parts(f, 'r2').up.disabled, true, 'a disabled boundary button stays disabled');
  assert.equal(parts(f, 'r4').down.disabled, true);
});

test('the dropped row settles with a short transform animation, and none at all when the user prefers reduced motion', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  dragTo(f, 'r1', middle(3) + 20);
  const row = items(f).find(item => item.dataset.receiptId === 'r1');
  assert.equal(row.style.transition, 'transform 160ms ease-out', 'it slides from where it was dropped into its new place');
  assert.equal(row.style.transform, '', 'ending at its natural position');
  const g = await receiptFixture({ loaded: four() }); // (the fixture resets matchMedia, so the preference is set afterwards)
  const reduced = globalThis.matchMedia; globalThis.matchMedia = () => ({ matches: true });
  try {
    await open(g);
    dragTo(g, 'r1', middle(3) + 20);
    const still = items(g).find(item => item.dataset.receiptId === 'r1');
    assert.notEqual(still.style.transition, 'transform 160ms ease-out', 'reduced motion: the preview is shown without animation and the drop does not slide');
    assert.deepEqual(order(g), ['r2', 'r3', 'r4', 'r1']);
  } finally { globalThis.matchMedia = reduced; }
});

test('D, E: pointercancel and a lost pointer capture cancel the drag and leave the order as it was', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  down(f, 'r3'); move(f, 'r3', 30); parts(f, 'r3').handle.emit('pointercancel', { pointerId: 1 });
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']); assert.equal(dragging(f), false);
  assert.match(f.elements.exportReviewAnnouncer.textContent, /^Move cancelled\. Receipt 3 is still at position 3 of 4\.\s*$/);
  assert.equal(f.focusLog.at(-1), parts(f, 'r3').handle);
  down(f, 'r2'); move(f, 'r2', 500); parts(f, 'r2').handle.emit('lostpointercapture', { pointerId: 1 });
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']); assert.equal(dragging(f), false);
  up(f, 'r2', 500); assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4'], 'a late pointerup after the cancel does nothing');
});

test('F: releasing far outside the list (above, below or sideways) still drops at the first or last position', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  down(f, 'r2'); move(f, 'r2', -300, { clientX: -800 }); up(f, 'r2', -300, { clientX: -800 });
  assert.deepEqual(order(f), ['r2', 'r1', 'r3', 'r4']);
  layout(f); down(f, 'r2'); move(f, 'r2', 5000, { clientX: 4000 }); up(f, 'r2', 5000, { clientX: 4000 });
  assert.deepEqual(order(f), ['r1', 'r3', 'r4', 'r2']);
});

test('J: touch needs a long press: a quick swipe scrolls (nothing is lifted), a stationary press for about 250 ms lifts the receipt', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  const touch = { pointerType: 'touch', pointerId: 9 };
  down(f, 'r4', undefined, touch); move(f, 'r4', middle(3) - 40, touch); up(f, 'r4', middle(3) - 40, touch);
  assert.equal(dragging(f), false, 'moving at once is a scroll gesture, not a drag'); assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']);
  await pause(300);
  assert.equal(dragging(f), false, 'and the abandoned press cannot fire later');
  down(f, 'r4', undefined, touch); move(f, 'r4', middle(3) - 3, touch); assert.equal(dragging(f), false, 'still waiting: the long press has not completed');
  await pause(320);
  assert.equal(dragging(f), true, 'held in place for the long press: the receipt is lifted');
  move(f, 'r4', middle(3) - 90, touch); up(f, 'r4', middle(0) - 10, touch);
  assert.deepEqual(order(f), ['r4', 'r1', 'r2', 'r3']);
});

test('J: a tap on a row (touch) neither lifts nor reorders anything, and never leaves a timer behind', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  const touch = { pointerType: 'touch', pointerId: 4 };
  down(f, 'r2', undefined, touch); up(f, 'r2', middle(1), touch); await pause(320);
  assert.equal(dragging(f), false); assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']);
});

test('G, H: Escape during an active drag cancels only the drag; Escape when idle closes the dialog and keeps the arrangement', async () => {
  const modalFocus = fakeModalFocus();
  const f = await open(await receiptFixture({ loaded: four(), modalFocus }));
  const [{ onEscape }] = modalFocus.log.open;
  press(f, 'r4', 'Home'); layout(f);
  const arranged = [...order(f)];
  down(f, 'r1'); move(f, 'r1', 600);
  assert.equal(dragging(f), true);
  onEscape();
  assert.equal(dragging(f), false); assert.equal(dialogOpen(f), true, 'the dialog stays open');
  assert.deepEqual(order(f), arranged, 'the order is exactly what it was before the drag');
  assert.equal(modalFocus.log.close.length, 0);
  assert.match(f.elements.exportReviewAnnouncer.textContent, /^Move cancelled\./);
  up(f, 'r1', 600); assert.deepEqual(order(f), arranged, 'the pointer release after Escape is ignored');
  onEscape();
  assert.equal(dialogOpen(f), false); assert.equal(modalFocus.log.close.length, 1);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  await f.click(f.elements.exportSelected); assert.deepEqual(order(f), arranged, 'the arrangement was kept');
});

test('closing the dialog while a drag is in progress leaves no drag state behind', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  down(f, 'r1'); move(f, 'r1', 400);
  await f.click(f.elements.cancelExport);
  assert.equal(dialogOpen(f), false); assert.equal(f.elements.exportReviewList.classList.contains('is-dragging'), false);
  await f.click(f.elements.exportSelected); layout(f);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']); assert.equal(dragging(f), false);
});

test('L, M, N: a drag never duplicates or drops a receipt, and changes neither the selection, the total nor the result', async () => {
  const f = await receiptFixture({ loaded: four() });
  await calculate(f, '1000');
  const result = [f.elements.resultTitle.textContent, f.elements.resultAmount.textContent, f.elements.exportSelected.textContent];
  await f.click(f.elements.exportSelected); layout(f);
  const total = f.elements.exportReviewTotal.textContent;
  for (const [id, y] of [['r1', 900], ['r3', -50], ['r2', middle(1)], ['r4', middle(2)]]) { layout(f); dragTo(f, id, y); assert.deepEqual([...order(f)].sort(), ['r1', 'r2', 'r3', 'r4']); assert.equal(new Set(order(f)).size, 4); }
  assert.equal(f.elements.exportReviewTotal.textContent, total);
  assert.equal(f.elements.exportReviewCount.textContent, '4');
  assert.deepEqual([f.elements.resultTitle.textContent, f.elements.resultAmount.textContent, f.elements.exportSelected.textContent], result);
  assert.deepEqual(['r1', 'r2', 'r3', 'r4'].map(id => f.db.get(id).amount), [100, 200, 300, 400]);
  assert.equal(f.calls.update.length + f.calls.create.length, 0, 'nothing is written');
});

test('O, P, Q: Item No. follows the dragged order, the keyboard still works afterwards, and Reset order restores the original', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  dragTo(f, 'r4', 0); layout(f);
  await parts(f, 'r2').up.emit('click'); assert.deepEqual(order(f), ['r4', 'r2', 'r1', 'r3']);
  await press(f, 'r3', 'Home'); assert.deepEqual(order(f), ['r3', 'r4', 'r2', 'r1']);
  layout(f); dragTo(f, 'r1', middle(1)); assert.deepEqual(order(f), ['r3', 'r1', 'r4', 'r2']);
  const confirmed = [...order(f)];
  await confirm(f);
  assert.deepEqual(f.calls.download[0].map(item => item.dbId), confirmed);
  const rows = buildExpenseDetailedReportRows(f.calls.download[0]).slice(2);
  assert.deepEqual(rows.map(row => [row[0], row[2], row[7]]), [[1, 'Store C', 300], [2, 'Store A', 100], [3, 'Store D', 400], [4, 'Store B', 200]]);
  assert.deepEqual(f.calls.consume, [confirmed]);
  assert.equal(f.elements.difference.textContent, '4 receipts exported and marked as Consumed.');
  const g = await open(await receiptFixture({ loaded: four() }));
  dragTo(g, 'r3', 0); await g.elements.exportReviewReset.emit('click');
  assert.deepEqual(order(g), ['r1', 'r2', 'r3', 'r4']); assert.equal(g.elements.exportReviewReset.disabled, true);
});

test('R, S: Cancel and reopen keep a dragged arrangement; a successful export discards it', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  dragTo(f, 'r2', 800); const arranged = [...order(f)];
  await f.click(f.elements.cancelExport); assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  await f.click(f.elements.exportSelected); layout(f);
  assert.deepEqual(order(f), arranged);
  await confirm(f); assert.equal(f.calls.download.length, 1);
  for (const row of f.rows()) { await row.part('.restore-receipt').emit('click'); await settle(); }
  await open(f);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4']);
});

test('T: the snapshot, acknowledgement and duplicate-confirmation safeguards still apply after a drag', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  dragTo(f, 'r1', 800);
  f.db.set('r3', { ...f.db.get('r3'), store: 'Renamed elsewhere', updatedAt: f.stamp() });
  await confirm(f);
  assert.equal(dialogOpen(f), true); assert.equal(f.elements.exportReviewAck.hidden, false); assert.equal(f.elements.confirmExport.disabled, true);
  assert.equal(f.calls.download.length, 0);
  f.elements.exportReviewAckInput.checked = true; await f.elements.exportReviewAckInput.emit('change');
  await Promise.all([f.elements.confirmExport.emit('click'), f.elements.confirmExport.emit('click')]); await settle();
  assert.equal(f.calls.download.length, 1); assert.equal(f.calls.consume.length, 1);
  assert.equal(f.calls.download[0].find(item => item.dbId === 'r3').store, 'Renamed elsewhere');
  assert.deepEqual(f.calls.download[0].map(item => item.dbId), ['r2', 'r3', 'r4', 'r1']);
});

test('a stale-amount result is still rejected, so a dragged arrangement can never export an out-of-date result', async () => {
  const f = await open(await receiptFixture({ loaded: four() }));
  dragTo(f, 'r1', 800);
  f.db.set('r2', { ...f.db.get('r2'), amount: 250, updatedAt: f.stamp() });
  await confirm(f);
  assert.equal(dialogOpen(f), false); assert.match(f.elements.difference.textContent, /Run Find Best Match again\.$/);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
});

// ---- styles: touch handling, theme tokens, reduced motion ------------------------------------------------------------------------------------------
const css = (await readFile(new URL('../styles.css', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const rule = selector => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';

test('K, U: rows keep native scrolling: no element in the review area disables touch panning (touch drags use a long press instead of a touch-action)', () => {
  for (const selector of ['.export-review-row', '.export-review-list', '.export-review-details', '.export-review-moves', '.export-review-amount', '.export-review-move', '.export-review-card.modal-card']) assert.doesNotMatch(rule(selector), /touch-action/, `${selector} still scrolls`);
  const reviewCss = css.slice(css.indexOf('/* Review & Arrange'), css.indexOf('.unsaved-values-notice + .export-go-encoding')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(reviewCss, /touch-action/, 'no touch-action anywhere in the review styles');
  assert.match(rule('.export-review-row'), /user-select: none/); assert.match(rule('.export-review-row'), /-webkit-touch-callout: none/, 'no text selection or callout menu on a long press');
  assert.match(rule('.export-review-row'), /cursor: grab/); assert.match(rule('.export-review-move'), /cursor: pointer/);
  assert.match(rule('.export-review-list.is-dragging, .export-review-list.is-dragging *'), /cursor: grabbing/);
});

test('the review rows have no separate drag-handle control any more (and no leftover handle styles or drop-line styles)', () => {
  assert.doesNotMatch(css, /export-review-handle/); assert.doesNotMatch(css, /is-drop-before|is-drop-after/);
  assert.match(rule('.export-review-row'), /grid-template-columns: 34px minmax\(0, 1fr\) auto auto/);
  assert.match(rule('.export-review-row'), /grid-template-areas: "position details amount moves"/);
  assert.match(html, /Drag a receipt \(on a touch screen, press and hold first\)[^<]*focus a receipt and press the arrow keys/, 'the instructions describe dragging, the buttons and the keyboard');
  assert.doesNotMatch(html, /handle/i);
});

test('U: the live preview is a transform transition (150 ms) on the other rows only; the lifted row has none; reduced motion removes it through the global rule', () => {
  const sliding = rule('.export-review-list.is-dragging .export-review-row:not(.is-dragging)');
  assert.match(sliding, /transition: transform 150ms ease/); assert.doesNotMatch(sliding, /animation|@keyframes/);
  const lifted = rule('.export-review-row.is-dragging');
  assert.match(lifted, /transition: none/, 'the lifted row follows the pointer without lag'); assert.match(lifted, /box-shadow: var\(--shadow-lg\)/); assert.match(lifted, /will-change: transform/);
  assert.doesNotMatch(css.slice(css.indexOf('/* Review & Arrange'), css.indexOf('.unsaved-values-notice + .export-go-encoding')), /@keyframes|animation:/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \* \{ transition: none !important; \} html \{ scroll-behavior: auto; \} \}/, 'reduced motion: the preview still moves rows (instantly), it just does not animate');
  assert.ok(css.indexOf('@media (prefers-reduced-motion') > css.indexOf('.export-review-list.is-dragging .export-review-row:not(.is-dragging)'), 'the global rule comes later, so its !important wins regardless');
});

test('U: the insertion slot is a dashed, full-row, token-coloured placeholder positioned by the script, and nothing in the drag styles is hard-coded', () => {
  const slot = rule('.export-review-list.is-dragging::after');
  assert.match(slot, /content: ""/); assert.match(slot, /top: var\(--drag-slot-top, 0\)/); assert.match(slot, /height: var\(--drag-slot-height, 0\)/);
  assert.match(slot, /left: 4px; right: 4px/); assert.match(slot, /border: 2px dashed var\(--primary\)/); assert.match(slot, /pointer-events: none/);
  assert.match(rule('.export-review-list'), /position: relative/, 'the slot is positioned inside the list');
  const feedback = ['.export-review-row.is-dragging', '.export-review-list.is-dragging::after', '.export-review-list.is-dragging .export-review-row:not(.is-dragging)'].map(rule).join('\n');
  assert.doesNotMatch(feedback, /#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(/, 'light and dark follow the tokens');
  for (const token of [...feedback.matchAll(/var\((--[a-z0-9-]+)/g)].map(match => match[1])) assert.ok(css.includes(`${token}:`) || token.startsWith('--drag-slot-'), `${token} is defined`);
});

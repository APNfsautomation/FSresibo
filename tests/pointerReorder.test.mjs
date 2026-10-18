// CP10-C3E-3: the pointer reorder module against a small fake DOM (rows with layout, a scrolling container, handles, manual animation frames).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPointerReorder } from '../ui/pointerReorder.js';

function world({ count = 5, rowHeight = 50, listTop = 100, viewport = 800, visible = 200, scrollers, obstructions } = {}) {
  const log = { start: [], drop: [], cancel: [] };
  const frames = []; const cancelled = []; const timers = [];
  const scroller = { scrollTop: 0, scrollHeight: count * rowHeight, clientHeight: visible, getBoundingClientRect: () => ({ top: listTop, bottom: listTop + visible }) };
  const classList = () => { const set = new Set(); return { set, add: (...names) => names.forEach(name => set.add(name)), remove: (...names) => names.forEach(name => set.delete(name)), contains: name => set.has(name) }; };
  const list = { children: [], classList: classList() };
  const rows = Array.from({ length: count }, (_, index) => ({ dataset: { receiptId: `r${index + 1}` }, classList: classList(), style: {}, getBoundingClientRect: () => { const position = list.children.indexOf(rows[index]); return { top: listTop + position * rowHeight - scroller.scrollTop, height: rowHeight }; } }));
  list.children = [...rows];
  const handles = rows.map(row => {
    const listeners = {}; const state = { captured: new Set(), focus: 0, rejected: [] };
    return { state, row, addEventListener: (name, fn) => { (listeners[name] ??= []).push(fn); }, setPointerCapture: id => state.captured.add(id), hasPointerCapture: id => state.captured.has(id), releasePointerCapture: id => state.captured.delete(id), focus: () => { state.focus += 1; },
      emit(name, event = {}) { const e = { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 10, clientY: 0, prevented: false, stopped: false, preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; }, ...event }; (listeners[name] ?? []).forEach(fn => fn(e)); return e; } };
  });
  const pointer = createPointerReorder({ list, windowRef: { innerHeight: viewport, setTimeout: fn => { timers.push(fn); } }, requestFrame: callback => { frames.push(callback); return frames.length; }, cancelFrame: id => { cancelled.push(id); }, findScrollers: () => scrollers ?? [scroller], obstructions,
    onStart: id => log.start.push(id), onDrop: (id, to) => log.drop.push([id, to]), onCancel: id => log.cancel.push(id) });
  handles.forEach((handle, index) => pointer.attach(handle, `r${index + 1}`));
  // Row k has its middle at listTop + k*rowHeight + rowHeight / 2 (when the scroller is not scrolled).
  const middle = k => listTop + k * rowHeight + rowHeight / 2;
  const runFrame = () => { const callback = frames.shift(); callback?.(); return Boolean(callback); };
  return { log, frames, cancelled, timers, scroller, list, rows, handles, pointer, middle, runFrame, flushTimers: () => timers.splice(0).forEach(fn => fn()) };
}
const grab = (w, index, y = w.middle(index), extra = {}) => w.handles[index].emit('pointerdown', { clientY: y, ...extra });
const drag = (w, index, y, extra = {}) => w.handles[index].emit('pointermove', { clientY: y, ...extra });
const release = (w, index, y, extra = {}) => w.handles[index].emit('pointerup', { clientY: y, ...extra });
const clean = w => { assert.equal(w.list.classList.contains('is-dragging'), false); for (const row of w.rows) { assert.equal(row.classList.contains('is-dragging'), false); assert.equal(row.classList.contains('is-drop-before'), false); assert.equal(row.classList.contains('is-drop-after'), false); assert.equal(row.style.transform ?? '', ''); } assert.equal(w.pointer.isActive(), false); };

test('A, C: mouse down, move and up on a handle drops the receipt at the position under the pointer', () => {
  const w = world();
  grab(w, 0); drag(w, 0, w.middle(0) + 60); release(w, 0, w.middle(3) + 5);
  assert.deepEqual(w.log.start, ['r1']); assert.deepEqual(w.log.drop, [['r1', 3]]); assert.deepEqual(w.log.cancel, []);
  clean(w);
  assert.equal(w.handles[0].state.captured.size, 0, 'the pointer capture is released');
});

test('A: dragging first to last, last to first and across several positions', () => {
  const first = world(); grab(first, 0); drag(first, 0, 500); release(first, 0, 500);
  const last = world(); grab(last, 4); drag(last, 4, 0); release(last, 4, 0);
  const middle = world(); grab(middle, 1); drag(middle, 1, middle.middle(1) + 8 * 5); release(middle, 1, middle.middle(3) - 5);
  assert.deepEqual([first.log.drop[0], last.log.drop[0], middle.log.drop[0]], [['r1', 4], ['r5', 0], ['r2', 2]]);
});

test('B: nothing happens before the movement threshold; a press and release is an ordinary click', () => {
  const w = world();
  grab(w, 2); drag(w, 2, w.middle(2) + 2); drag(w, 2, w.middle(2) - 3);
  assert.equal(w.pointer.isActive(), false); assert.deepEqual(w.log.start, []);
  assert.equal(w.rows[2].classList.contains('is-dragging'), false);
  release(w, 2, w.middle(2));
  assert.deepEqual([w.log.drop, w.log.cancel], [[], []]);
  const click = w.handles[2].emit('click'); assert.equal(click.prevented, false, 'a click without a drag is not suppressed');
  drag(w, 2, w.middle(2) + 50); assert.equal(w.pointer.isActive(), false, 'the pointer is no longer tracked after release');
  grab(w, 2); drag(w, 2, w.middle(2) + 5); assert.equal(w.pointer.isActive(), true, 'at the threshold the drag starts');
  w.pointer.cancel();
});

test('J: touch and pen use their own (larger) thresholds and the same code path', () => {
  const touch = world(); grab(touch, 1, touch.middle(1), { pointerType: 'touch', pointerId: 7 });
  drag(touch, 1, touch.middle(1) + 6, { pointerType: 'touch', pointerId: 7 }); assert.equal(touch.pointer.isActive(), false);
  drag(touch, 1, touch.middle(1) + 9, { pointerType: 'touch', pointerId: 7 }); assert.equal(touch.pointer.isActive(), true);
  release(touch, 1, touch.middle(4) + 5, { pointerType: 'touch', pointerId: 7 });
  assert.deepEqual(touch.log.drop, [['r2', 4]]);
  const pen = world(); grab(pen, 0, pen.middle(0), { pointerType: 'pen' }); drag(pen, 0, pen.middle(0) + 5, { pointerType: 'pen' });
  assert.equal(pen.pointer.isActive(), true); pen.pointer.cancel();
});

test('K: only the handle starts a drag; other pointers, buttons and non-primary touches are ignored', () => {
  const w = world();
  w.rows[0].emit?.('pointerdown'); // the row itself has no listeners at all
  grab(w, 0, w.middle(0), { button: 2 }); drag(w, 0, 300); assert.equal(w.pointer.isActive(), false);
  grab(w, 0, w.middle(0), { isPrimary: false }); drag(w, 0, 300); assert.equal(w.pointer.isActive(), false);
  grab(w, 0, w.middle(0), { pointerId: 1 }); drag(w, 0, 300, { pointerId: 1 }); assert.equal(w.pointer.isActive(), true);
  grab(w, 1, w.middle(1), { pointerId: 2 }); drag(w, 1, 300, { pointerId: 2 });
  release(w, 1, 300, { pointerId: 2 }); assert.deepEqual(w.log.drop, [], 'a second finger cannot take over or finish the drag');
  release(w, 0, 500, { pointerId: 1 }); assert.deepEqual(w.log.drop, [['r1', 4]]);
  const down = grab(world(), 0); assert.equal(down.prevented, true, 'pointerdown on the handle prevents text selection');
});

test('C, M: the lifted row follows the pointer and a drop line shows where the receipt will go; nothing is rebuilt', () => {
  const w = world(); const before = [...w.list.children];
  grab(w, 1, w.middle(1)); drag(w, 1, w.middle(1) + 20);
  assert.equal(w.rows[1].classList.contains('is-dragging'), true); assert.equal(w.list.classList.contains('is-dragging'), true);
  assert.equal(w.rows[1].style.transform, 'translateY(20px)');
  drag(w, 1, w.middle(3) + 1); // past the middle of rows 2 and 3 (and 0): lands after row index 3
  assert.equal(w.rows[3].classList.contains('is-drop-after'), true);
  assert.equal(w.rows[2].classList.contains('is-drop-after'), false, 'one indicator at a time');
  drag(w, 1, 0); assert.equal(w.rows[0].classList.contains('is-drop-before'), true); assert.equal(w.rows[3].classList.contains('is-drop-after'), false);
  assert.deepEqual(w.list.children, before, 'the list is not rebuilt or reordered while dragging');
  w.pointer.cancel(); clean(w);
});

test('F: dragging outside the list (above, below, far to the side) keeps choosing the first or last position', () => {
  const w = world();
  grab(w, 2); drag(w, 2, -400, { clientX: -900 }); release(w, 2, -400, { clientX: -900 });
  const x = world(); grab(x, 2); drag(x, 2, 9000, { clientX: 5000 }); release(x, 2, 9000, { clientX: 5000 });
  assert.deepEqual([w.log.drop[0], x.log.drop[0]], [['r3', 0], ['r3', 4]]);
});

test('D, G: cancelling (Escape) restores everything and reports a cancel, never a drop', () => {
  const w = world();
  grab(w, 0); drag(w, 0, 400);
  assert.equal(w.pointer.cancel(), true);
  assert.deepEqual([w.log.drop, w.log.cancel], [[], ['r1']]); clean(w);
  assert.equal(w.pointer.cancel(), false, 'a second cancel has nothing to do');
  drag(w, 0, 300); release(w, 0, 300); assert.deepEqual(w.log.drop, [], 'later pointer events are ignored');
});

test('D: pointercancel (for example the browser takes over a touch) cancels safely', () => {
  const w = world();
  grab(w, 3, w.middle(3), { pointerType: 'touch' }); drag(w, 3, 50, { pointerType: 'touch' });
  w.handles[3].emit('pointercancel', { pointerType: 'touch' });
  assert.deepEqual([w.log.drop, w.log.cancel], [[], ['r4']]); clean(w);
});

test('E: a lost pointer capture cancels safely, but the capture released by a normal drop is not mistaken for a loss', () => {
  const w = world();
  grab(w, 1); drag(w, 1, 300); w.handles[1].emit('lostpointercapture');
  assert.deepEqual([w.log.drop, w.log.cancel], [[], ['r2']]); clean(w);
  const x = world(); grab(x, 1); drag(x, 1, 500); release(x, 1, 500); x.handles[1].emit('lostpointercapture');
  assert.deepEqual([x.log.drop, x.log.cancel], [[['r2', 4]], []], 'exactly one outcome per drag');
  const pending = world(); grab(pending, 1); pending.handles[1].emit('lostpointercapture'); assert.deepEqual([pending.log.drop, pending.log.cancel], [[], []], 'nothing started, nothing to cancel');
});

test('H: cancel while only a press is pending is a no-op for Escape, and a silent cancel (re-render) reports nothing', () => {
  const w = world();
  grab(w, 0); assert.equal(w.pointer.cancel(), false);
  const x = world(); grab(x, 0); drag(x, 0, 300);
  assert.equal(x.pointer.cancel({ silent: true }), true); assert.deepEqual([x.log.drop, x.log.cancel], [[], []]); clean(x);
});

test('after a drag the click that browsers still deliver to the handle is swallowed once', () => {
  const w = world();
  grab(w, 0); drag(w, 0, 300); release(w, 0, 300);
  const first = w.handles[0].emit('click'); assert.equal(first.prevented, true); assert.equal(first.stopped, true);
  assert.equal(w.handles[0].emit('click').prevented, false, 'only once');
  grab(w, 0); drag(w, 0, 300); release(w, 0, 300); w.flushTimers();
  assert.equal(w.handles[0].emit('click').prevented, false, 'and never after the event turn ends');
});

test('I: near the bottom edge the scroller scrolls on animation frames, the drop target keeps following, and it stops at the end', () => {
  const w = world({ count: 12, visible: 200 }); // 600px of content in a 200px viewport
  grab(w, 0, w.middle(0)); drag(w, 0, 150);
  assert.equal(w.frames.length, 0, 'no frame is requested away from the edges');
  drag(w, 0, 295); // bottom edge zone: the area ends at 300
  assert.equal(w.frames.length, 1);
  const startTarget = w.rows[0].style.transform;
  assert.ok(w.runFrame()); assert.ok(w.scroller.scrollTop > 0, 'scrolled down');
  assert.notEqual(w.rows[0].style.transform, startTarget, 'the lifted row compensates for the scroll and stays under the pointer');
  let frames = 0; while (w.runFrame() && frames < 200) frames += 1;
  assert.equal(w.scroller.scrollTop, w.scroller.scrollHeight - w.scroller.clientHeight, 'it stops at the end of the content');
  assert.equal(w.frames.length, 0, 'and requests no further frames');
  release(w, 0, 295);
  assert.deepEqual(w.log.drop, [['r1', 11]], 'the last receipt is reachable by scrolling');
});

test('I: near the top edge it scrolls up, and the speed grows towards the very edge', () => {
  const w = world({ count: 12, visible: 200 });
  w.scroller.scrollTop = 400;
  grab(w, 5, w.middle(5) - 400); drag(w, 5, 100 + 50); // 50px into the area: inside the 56px zone but not at the edge
  w.runFrame(); const slow = 400 - w.scroller.scrollTop;
  w.scroller.scrollTop = 400;
  drag(w, 5, 101); w.runFrame(); const fast = 400 - w.scroller.scrollTop; // the next frame was already queued; it reads the new pointer position
  assert.ok(slow >= 2 && fast > slow && fast <= 18, `speed ${slow} then ${fast}`);
  w.pointer.cancel();
});

test('I: no animation frame is left running after a drop, a cancel or leaving the edge zone', () => {
  for (const end of [w => release(w, 0, 295), w => w.pointer.cancel(), w => w.handles[0].emit('pointercancel')]) {
    const w = world({ count: 12 }); grab(w, 0, w.middle(0)); drag(w, 0, 295);
    assert.equal(w.frames.length, 1); end(w);
    assert.equal(w.cancelled.length, 1, 'the pending frame request is cancelled');
    const top = w.scroller.scrollTop; w.runFrame(); assert.equal(w.scroller.scrollTop, top, 'a stale frame callback does nothing');
  }
  const w = world({ count: 12 }); grab(w, 0, w.middle(0)); drag(w, 0, 295); w.runFrame();
  drag(w, 0, 200); w.runFrame(); assert.equal(w.frames.length, 0, 'moving back to the middle ends the scrolling');
  w.pointer.cancel();
});

test('I: the scrolling container is chosen per drag, so the desktop list and the phone sheet both work', () => {
  const sheet = { scrollTop: 0, scrollHeight: 2000, clientHeight: 600, getBoundingClientRect: () => ({ top: 0, bottom: 600 }) };
  const list = { scrollTop: 0, scrollHeight: 200, clientHeight: 200, getBoundingClientRect: () => ({ top: 100, bottom: 300 }) }; // fully visible: it cannot scroll
  const phone = world({ viewport: 600, scrollers: [list, sheet] });
  grab(phone, 0, 100); drag(phone, 0, 590);
  assert.equal(phone.frames.length, 1, 'the whole-sheet scroller reacts near the bottom of the screen');
  phone.runFrame(); assert.ok(sheet.scrollTop > 0); assert.equal(list.scrollTop, 0); phone.pointer.cancel();
  const desktop = world({ count: 12, viewport: 900 });
  grab(desktop, 0, 125); drag(desktop, 0, 295); desktop.runFrame();
  assert.ok(desktop.scroller.scrollTop > 0, 'the inner list scrolls on desktop'); desktop.pointer.cancel();
});

test('I: a bar pinned over the bottom of the scrolling area moves the bottom edge up to where the bar starts (the phone sheet)', () => {
  const bar = { getBoundingClientRect: () => ({ top: 250, bottom: 300 }) }; // the action buttons, over the last 50px of the scroller
  const w = world({ count: 12, obstructions: () => [bar] });
  grab(w, 0, w.middle(0)); drag(w, 0, 215);
  assert.equal(w.frames.length, 1, 'the zone now starts about 56px above the bar, so this position scrolls');
  w.pointer.cancel();
  const plain = world({ count: 12 }); grab(plain, 0, plain.middle(0)); drag(plain, 0, 215);
  assert.equal(plain.frames.length, 0, 'without the bar the same position is not near the edge');
  const over = world({ count: 12, obstructions: () => [bar] }); grab(over, 0, over.middle(0)); drag(over, 0, 290);
  assert.equal(over.frames.length, 1, 'a pointer over the bar still scrolls'); over.pointer.cancel();
  const away = { getBoundingClientRect: () => ({ top: 600, bottom: 650 }) }; // a bar that does not touch the scroller is ignored
  const apart = world({ count: 12, obstructions: () => [away] }); grab(apart, 0, apart.middle(0)); drag(apart, 0, 215); assert.equal(apart.frames.length, 0);
});

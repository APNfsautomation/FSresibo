// CP10-C3E-3R: the pointer reorder module against a small fake DOM (rows with layout, a scrolling container, fake timers and manual animation frames).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPointerReorder, previewShifts } from '../ui/pointerReorder.js';

function world({ count = 5, rowHeight = 50, listTop = 100, viewport = 800, visible = 200, scrollers, obstructions, heights } = {}) {
  const log = { start: [], drop: [], cancel: [] };
  const frames = []; const cancelled = []; const timers = new Map(); let timerId = 0; const clearedTimers = []; const windowTimers = [];
  const scroller = { scrollTop: 0, scrollHeight: count * rowHeight, clientHeight: visible, getBoundingClientRect: () => ({ top: listTop, bottom: listTop + visible }) };
  const classList = () => { const set = new Set(); return { set, add: (...names) => names.forEach(name => set.add(name)), remove: (...names) => names.forEach(name => set.delete(name)), contains: name => set.has(name) }; };
  const cssVars = new Map();
  const touchmove = [];
  const list = { children: [], classList: classList(), style: { setProperty: (key, value) => cssVars.set(key, value), removeProperty: key => cssVars.delete(key) }, addEventListener: (name, fn, options) => { if (name === 'touchmove') touchmove.push({ fn, options }); }, getBoundingClientRect: () => ({ top: listTop }), scrollTop: 0, clientTop: 0 };
  const rowHeights = heights ?? Array(count).fill(rowHeight);
  const topOf = index => listTop + rowHeights.slice(0, index).reduce((sum, h) => sum + h, 0) - scroller.scrollTop;
  const rows = Array.from({ length: count }, (_, index) => {
    const listeners = {}; const state = { captured: new Set(), focus: 0 };
    const row = { dataset: { receiptId: `r${index + 1}` }, classList: classList(), style: {}, state, listeners,
      getBoundingClientRect: () => ({ top: topOf(list.children.indexOf(row)), height: rowHeights[index] }),
      addEventListener: (name, fn) => { (listeners[name] ??= []).push(fn); }, setPointerCapture: id => state.captured.add(id), hasPointerCapture: id => state.captured.has(id), releasePointerCapture: id => state.captured.delete(id), focus: () => { state.focus += 1; },
      emit(name, event = {}) { const e = { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 10, clientY: 0, target: row, cancelable: true, prevented: false, stopped: false, preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; }, ...event }; (listeners[name] ?? []).forEach(fn => fn(e)); return e; } };
    return row;
  });
  list.children = [...rows];
  const pointer = createPointerReorder({ list, windowRef: { innerHeight: viewport, setTimeout: fn => { windowTimers.push(fn); } },
    requestFrame: callback => { frames.push(callback); return frames.length; }, cancelFrame: id => { cancelled.push(id); },
    setTimer: (fn, ms) => { timerId += 1; timers.set(timerId, { fn, ms }); return timerId; }, clearTimer: id => { clearedTimers.push(id); timers.delete(id); },
    findScrollers: () => scrollers ?? [scroller], obstructions,
    onStart: id => log.start.push(id), onDrop: (id, to, info) => log.drop.push([id, to, info]), onCancel: id => log.cancel.push(id) });
  rows.forEach((row, index) => pointer.attach(row, `r${index + 1}`));
  const middle = k => topOf(k) + rowHeights[k] / 2;
  const runFrame = () => { const callback = frames.shift(); callback?.(); return Boolean(callback); };
  const firePress = () => { const [id, timer] = [...timers.entries()][0] ?? []; if (!timer) return false; timers.delete(id); timer.fn(); return true; };
  return { log, frames, cancelled, timers, clearedTimers, cssVars, touchmove, scroller, list, rows, pointer, middle, runFrame, firePress, topOf, flushTimers: () => windowTimers.splice(0).forEach(fn => fn()) };
}
const grab = (w, index, y = w.middle(index), extra = {}) => w.rows[index].emit('pointerdown', { clientY: y, ...extra });
const drag = (w, index, y, extra = {}) => w.rows[index].emit('pointermove', { clientY: y, ...extra });
const release = (w, index, y, extra = {}) => w.rows[index].emit('pointerup', { clientY: y, ...extra });
const touch = { pointerType: 'touch', pointerId: 7 };
const clean = w => { assert.equal(w.list.classList.contains('is-dragging'), false); for (const row of w.rows) { assert.equal(row.classList.contains('is-dragging'), false); assert.equal(row.style.transform ?? '', '', 'no stuck transform'); } assert.equal(w.cssVars.size, 0, 'no stuck placeholder variables'); assert.equal(w.pointer.isActive(), false); };
const shiftOf = (w, index) => w.rows[index].style.transform ?? '';

// ---- pure preview geometry -----------------------------------------------------------------------------------------------------------------------
test('previewShifts: moving a row down shifts the rows it passes up, moving it up shifts them down, and the slot lands at the target', () => {
  const tops = [0, 50, 100, 150, 200]; const heights = [50, 50, 50, 50, 50];
  assert.deepEqual(previewShifts({ tops, heights, origin: 0, target: 2 }), { shifts: [0, -50, -50, 0, 0], slotOffset: 100 });
  assert.deepEqual(previewShifts({ tops, heights, origin: 4, target: 1 }), { shifts: [0, 50, 50, 50, 0], slotOffset: 50 });
  assert.deepEqual(previewShifts({ tops, heights, origin: 2, target: 2 }), { shifts: [0, 0, 0, 0, 0], slotOffset: 100 }, 'no change at the original position');
  assert.deepEqual(previewShifts({ tops, heights, origin: 0, target: 4 }).shifts, [0, -50, -50, -50, -50]);
  assert.deepEqual(previewShifts({ tops, heights, origin: 3, target: 0 }).shifts, [50, 50, 50, 0, 0]);
});

test('previewShifts: rows of different height end up exactly where they will be after the drop (an updated row with a note is taller)', () => {
  const heights = [50, 90, 50, 50]; const tops = [0, 50, 140, 190];
  const { shifts, slotOffset } = previewShifts({ tops, heights, origin: 1, target: 3 });
  assert.deepEqual(shifts, [0, 0, -90, -90]); assert.equal(slotOffset, 150);
  const moved = previewShifts({ tops, heights, origin: 0, target: 2 });
  assert.deepEqual(moved.shifts, [0, -50, -50, 0]); assert.equal(moved.slotOffset, 140);
});

test('previewShifts: every target keeps the rows exactly one slot apart with the held slot included, and clamps the target', () => {
  const tops = [0, 60, 120, 180]; const heights = [56, 56, 56, 56];
  for (let origin = 0; origin < 4; origin += 1) for (let target = 0; target < 4; target += 1) {
    const { shifts, slotOffset } = previewShifts({ tops, heights, origin, target });
    const placed = tops.map((top, index) => index === origin ? slotOffset : top + shifts[index]).sort((a, b) => a - b);
    assert.deepEqual(placed, [0, 60, 120, 180], `origin ${origin} target ${target}: no overlap, no gap, no duplicate slot`);
  }
  assert.equal(previewShifts({ tops, heights, origin: 0, target: 99 }).slotOffset, 180); assert.equal(previewShifts({ tops, heights, origin: 3, target: -4 }).slotOffset, 0);
  assert.deepEqual(previewShifts({ tops: [], heights: [], origin: 0, target: 0 }), { shifts: [], slotOffset: 0 });
});

// ---- mouse: the whole row ---------------------------------------------------------------------------------------------------------------------
test('A: pressing anywhere on the row (not just a handle), moving and releasing drops the receipt at the position under the pointer', () => {
  const w = world();
  grab(w, 0); drag(w, 0, w.middle(0) + 60); release(w, 0, w.middle(3) + 5);
  assert.deepEqual(w.log.start, ['r1']); assert.equal(w.log.drop.length, 1); assert.deepEqual(w.log.drop[0].slice(0, 2), ['r1', 3]); assert.deepEqual(w.log.cancel, []);
  assert.ok(Number.isFinite(w.log.drop[0][2].fromTop), 'the drop reports where the lifted row was, so it can settle from there');
  clean(w);
  assert.equal(w.rows[0].state.captured.size, 0, 'the pointer capture is released');
});

test('A: first to last, last to first and across several positions', () => {
  const first = world(); grab(first, 0); drag(first, 0, 500); release(first, 0, 500);
  const last = world(); grab(last, 4); drag(last, 4, 0); release(last, 4, 0);
  const middle = world(); grab(middle, 1); drag(middle, 1, middle.middle(1) + 40); release(middle, 1, middle.middle(3) - 5);
  assert.deepEqual([first.log.drop[0], last.log.drop[0], middle.log.drop[0]].map(d => d.slice(0, 2)), [['r1', 4], ['r5', 0], ['r2', 2]]);
});

test('B: nothing happens before the movement threshold; pressing and releasing a row is an ordinary click that changes nothing', () => {
  const w = world();
  grab(w, 2); drag(w, 2, w.middle(2) + 2); drag(w, 2, w.middle(2) - 3);
  assert.equal(w.pointer.isActive(), false); assert.deepEqual(w.log.start, []);
  assert.equal(w.rows[2].classList.contains('is-dragging'), false);
  release(w, 2, w.middle(2));
  assert.deepEqual([w.log.drop, w.log.cancel], [[], []]);
  assert.equal(w.rows[2].emit('click').prevented, false, 'a click without a drag is not suppressed');
  drag(w, 2, w.middle(2) + 50); assert.equal(w.pointer.isActive(), false, 'the pointer is no longer tracked after release');
  grab(w, 2); drag(w, 2, w.middle(2) + 5); assert.equal(w.pointer.isActive(), true, 'at the threshold the drag starts');
  w.pointer.cancel();
});

test('buttons keep their own behaviour: a press that starts on a button (or any control) never starts a drag, even though it is inside the row', () => {
  const w = world();
  const button = { closest: selector => /button/.test(selector) ? button : null };
  const text = { closest: () => null };
  grab(w, 1, w.middle(1), { target: button }); drag(w, 1, w.middle(1) + 80, { target: button });
  assert.equal(w.pointer.isActive(), false); assert.equal(w.rows[1].state.captured.size, 0, 'the button press is not captured by the row');
  release(w, 1, w.middle(1) + 80, { target: button }); assert.deepEqual([w.log.start, w.log.drop], [[], []]);
  grab(w, 1, w.middle(1), { target: text }); drag(w, 1, w.middle(1) + 80, { target: text });
  assert.equal(w.pointer.isActive(), true, 'the same movement on the row text does start a drag');
  w.pointer.cancel();
  const custom = world(); const other = createPointerReorder({ list: custom.list, windowRef: { innerHeight: 800 }, isInteractive: target => target?.noDrag === true, findScrollers: () => [], onDrop() {} });
  other.attach(custom.rows[0], 'r1');
  custom.rows[0].emit('pointerdown', { clientY: 125, target: { noDrag: true } }); custom.rows[0].emit('pointermove', { clientY: 300, target: { noDrag: true } });
  assert.equal(other.isActive(), false, 'the exclusion rule can be replaced');
});

test('K: other pointers, non-primary buttons and non-primary touches are ignored', () => {
  const w = world();
  grab(w, 0, w.middle(0), { button: 2 }); drag(w, 0, 300); assert.equal(w.pointer.isActive(), false);
  grab(w, 0, w.middle(0), { isPrimary: false }); drag(w, 0, 300); assert.equal(w.pointer.isActive(), false);
  grab(w, 0, w.middle(0), { pointerId: 1 }); drag(w, 0, 300, { pointerId: 1 }); assert.equal(w.pointer.isActive(), true);
  grab(w, 1, w.middle(1), { pointerId: 2 }); drag(w, 1, 300, { pointerId: 2 });
  release(w, 1, 300, { pointerId: 2 }); assert.deepEqual(w.log.drop, [], 'a second finger cannot take over or finish the drag');
  release(w, 0, 500, { pointerId: 1 }); assert.deepEqual(w.log.drop.map(d => d.slice(0, 2)), [['r1', 4]]);
  const down = grab(world(), 0); assert.equal(down.prevented, true, 'a mouse press prevents text selection');
});

// ---- touch: long press ------------------------------------------------------------------------------------------------------------------------
test('J: touch needs a deliberate long press: a stationary press arms a ~250 ms timer and only the timer starts the drag', () => {
  const w = world();
  const down = grab(w, 1, w.middle(1), touch);
  assert.equal(down.prevented, false, 'the touch press itself is never prevented, so scrolling and taps keep working');
  assert.equal(w.timers.size, 1); assert.equal([...w.timers.values()][0].ms, 250);
  assert.equal(w.pointer.isActive(), false, 'nothing is lifted yet'); assert.equal(w.rows[1].classList.contains('is-dragging'), false);
  drag(w, 1, w.middle(1) + 4, touch); assert.equal(w.pointer.isActive(), false, 'a tiny wobble within the slop keeps waiting');
  assert.ok(w.firePress()); assert.equal(w.pointer.isActive(), true); assert.deepEqual(w.log.start, ['r2']);
  drag(w, 1, w.middle(3) + 5, touch); release(w, 1, w.middle(3) + 5, touch);
  assert.deepEqual(w.log.drop.map(d => d.slice(0, 2)), [['r2', 3]]); clean(w);
});

test('J: moving before the long press completes is a scroll: the press is abandoned, the timer cleared, and nothing is ever lifted', () => {
  const w = world();
  grab(w, 2, w.middle(2), touch); drag(w, 2, w.middle(2) + 30, touch);
  assert.equal(w.timers.size, 0, 'the long-press timer is cancelled'); assert.equal(w.clearedTimers.length, 1);
  assert.equal(w.firePress(), false, 'it can no longer fire');
  assert.equal(w.pointer.isActive(), false); assert.deepEqual([w.log.start, w.log.drop, w.log.cancel], [[], [], []]); clean(w);
  drag(w, 2, w.middle(2) + 200, touch); release(w, 2, w.middle(2) + 200, touch); assert.deepEqual(w.log.drop, [], 'later events of that swipe do nothing');
});

test('J: lifting the finger or the browser taking over (pointercancel) before the long press completes just clears the timer', () => {
  const tap = world(); grab(tap, 0, tap.middle(0), touch); release(tap, 0, tap.middle(0), touch);
  assert.equal(tap.timers.size, 0); assert.deepEqual([tap.log.start, tap.log.drop, tap.log.cancel], [[], [], []]);
  assert.equal(tap.rows[0].emit('click').prevented, false, 'a tap still clicks');
  const scroll = world(); grab(scroll, 0, scroll.middle(0), touch); scroll.rows[0].emit('pointercancel', touch);
  assert.equal(scroll.timers.size, 0); assert.deepEqual([scroll.log.start, scroll.log.drop, scroll.log.cancel], [[], [], []]); clean(scroll);
});

test('J: pen behaves like touch (long press) and a touch press on a button never starts anything', () => {
  const pen = world(); grab(pen, 0, pen.middle(0), { pointerType: 'pen' });
  assert.equal(pen.timers.size, 1); assert.ok(pen.firePress()); assert.equal(pen.pointer.isActive(), true); pen.pointer.cancel();
  const w = world(); const button = { closest: () => button };
  grab(w, 0, w.middle(0), { ...touch, target: button }); assert.equal(w.timers.size, 0, 'no long-press timer for a button');
});

test('J: while a long-press drag is active the browser panning default is cancelled (non-passive touchmove), and never otherwise', () => {
  const w = world();
  assert.equal(w.touchmove.length, 1); assert.deepEqual(w.touchmove[0].options, { passive: false }, 'registered up front and non-passive');
  const event = () => ({ cancelable: true, prevented: false, preventDefault() { this.prevented = true; } });
  const idle = event(); w.touchmove[0].fn(idle); assert.equal(idle.prevented, false, 'a normal swipe still scrolls');
  grab(w, 1, w.middle(1), touch); const pending = event(); w.touchmove[0].fn(pending); assert.equal(pending.prevented, false, 'also while the press is only pending');
  w.firePress();
  const active = event(); w.touchmove[0].fn(active); assert.equal(active.prevented, true, 'cancelled once the drag is active');
  const late = { cancelable: false, prevented: false, preventDefault() { this.prevented = true; } };
  w.touchmove[0].fn(late); assert.equal(late.prevented, false, 'an already-scrolling gesture cannot be cancelled and is left alone');
  w.pointer.cancel();
  const after = event(); w.touchmove[0].fn(after); assert.equal(after.prevented, false);
});

test('J: the long-press menu (contextmenu) is suppressed during a press or drag only', () => {
  const w = world();
  assert.equal(w.rows[0].emit('contextmenu').prevented, false);
  grab(w, 0, w.middle(0), touch); assert.equal(w.rows[0].emit('contextmenu').prevented, true);
  w.pointer.cancel(); assert.equal(w.rows[0].emit('contextmenu').prevented, false);
});

// ---- live preview ------------------------------------------------------------------------------------------------------------------------------
test('C, D, E: the lifted row follows the pointer, the others slide to make room before release, and the slot marks exactly where it will land', () => {
  const w = world(); const before = [...w.list.children];
  grab(w, 0, w.middle(0)); drag(w, 0, w.middle(0) + 20);
  assert.equal(w.rows[0].classList.contains('is-dragging'), true); assert.equal(w.list.classList.contains('is-dragging'), true);
  assert.equal(shiftOf(w, 0), 'translateY(20px)');
  assert.deepEqual([1, 2, 3, 4].map(i => shiftOf(w, i)), ['', '', '', ''], 'still before the first midpoint: nothing moves');
  drag(w, 0, w.middle(1) + 1);
  assert.deepEqual([1, 2, 3, 4].map(i => shiftOf(w, i)), ['translateY(-50px)', '', '', ''], 'the row it passed has slid up into its old place');
  assert.equal(w.cssVars.get('--drag-slot-top'), '50px'); assert.equal(w.cssVars.get('--drag-slot-height'), '50px');
  drag(w, 0, w.middle(3) + 1);
  assert.deepEqual([1, 2, 3, 4].map(i => shiftOf(w, i)), ['translateY(-50px)', 'translateY(-50px)', 'translateY(-50px)', ''], 'the preview updates immediately as midpoints are crossed');
  assert.equal(w.cssVars.get('--drag-slot-top'), '150px');
  drag(w, 0, w.middle(1) + 1);
  assert.deepEqual([1, 2, 3, 4].map(i => shiftOf(w, i)), ['translateY(-50px)', '', '', ''], 'and back again when the pointer returns');
  assert.deepEqual(w.list.children, before, 'the list is not rebuilt or reordered while dragging');
  w.pointer.cancel(); clean(w);
});

test('E: the preview always shows what a release would produce: the shifted rows plus the slot are exactly the final order', () => {
  const w = world({ count: 6 });
  for (const y of [w.middle(4) - 10, w.middle(2) - 1, w.middle(0) - 30, w.middle(5) + 40, w.middle(3)]) {
    grab(w, 4, w.middle(4)); drag(w, 4, y);
    const visual = w.rows.map((row, i) => ({ id: row.dataset.receiptId, top: i === 4 ? Number(w.cssVars.get('--drag-slot-top').replace('px', '')) + w.topOf(0) : w.topOf(i) + Number((shiftOf(w, i).match(/-?\d+/) ?? ['0'])[0]) }));
    const previewOrder = visual.sort((a, b) => a.top - b.top).map(item => item.id);
    release(w, 4, y);
    const [id, to] = w.log.drop.at(-1); const expected = w.rows.map(row => row.dataset.receiptId).filter(x => x !== id); expected.splice(to, 0, id);
    assert.deepEqual(previewOrder, expected, `pointer at ${y}`);
  }
});

test('rows of different height: the slot and the shifts use real heights, so there is no overlap and no layout jump', () => {
  const w = world({ count: 4, heights: [50, 90, 50, 50] });
  grab(w, 0, w.middle(0)); drag(w, 0, w.middle(2) + 1);
  assert.deepEqual([1, 2, 3].map(i => shiftOf(w, i)), ['translateY(-50px)', 'translateY(-50px)', ''], 'the tall row moves up by the height of the lifted row');
  assert.equal(w.cssVars.get('--drag-slot-top'), '140px'); assert.equal(w.cssVars.get('--drag-slot-height'), '50px');
  w.pointer.cancel();
});

test('F: dragging outside the list (above, below, far to the side) keeps choosing the first or last position', () => {
  const w = world();
  grab(w, 2); drag(w, 2, -400, { clientX: -900 }); release(w, 2, -400, { clientX: -900 });
  const x = world(); grab(x, 2); drag(x, 2, 9000, { clientX: 5000 }); release(x, 2, 9000, { clientX: 5000 });
  assert.deepEqual([w.log.drop[0], x.log.drop[0]].map(d => d.slice(0, 2)), [['r3', 0], ['r3', 4]]);
});

// ---- cancellation ------------------------------------------------------------------------------------------------------------------------------
test('D, G: cancelling (Escape) puts every row back, clears the slot and reports a cancel, never a drop', () => {
  const w = world();
  grab(w, 0); drag(w, 0, 400);
  assert.notEqual(shiftOf(w, 1), ''); assert.ok(w.cssVars.size > 0);
  assert.equal(w.pointer.cancel(), true);
  assert.deepEqual([w.log.drop, w.log.cancel], [[], ['r1']]); clean(w);
  assert.equal(w.pointer.cancel(), false, 'a second cancel has nothing to do');
  drag(w, 0, 300); release(w, 0, 300); assert.deepEqual(w.log.drop, [], 'later pointer events are ignored');
});

test('D: pointercancel (for example the browser takes over a touch) cancels safely', () => {
  const w = world();
  grab(w, 3, w.middle(3), touch); w.firePress(); drag(w, 3, 50, touch);
  w.rows[3].emit('pointercancel', touch);
  assert.deepEqual([w.log.drop, w.log.cancel], [[], ['r4']]); clean(w);
});

test('E: a lost pointer capture cancels safely, but the capture released by a normal drop is not mistaken for a loss', () => {
  const w = world();
  grab(w, 1); drag(w, 1, 300); w.rows[1].emit('lostpointercapture');
  assert.deepEqual([w.log.drop, w.log.cancel], [[], ['r2']]); clean(w);
  const x = world(); grab(x, 1); drag(x, 1, 500); release(x, 1, 500); x.rows[1].emit('lostpointercapture');
  assert.deepEqual([x.log.drop.length, x.log.cancel.length], [1, 0], 'exactly one outcome per drag');
  const pending = world(); grab(pending, 1); pending.rows[1].emit('lostpointercapture'); assert.deepEqual([pending.log.drop, pending.log.cancel], [[], []], 'nothing started, nothing to cancel');
});

test('H: cancel while only a press is pending is a no-op for Escape and clears the timer; a silent cancel (re-render) reports nothing', () => {
  const w = world();
  grab(w, 0, w.middle(0), touch); assert.equal(w.pointer.cancel(), false); assert.equal(w.timers.size, 0, 'the pending long press is cancelled too');
  const x = world(); grab(x, 0); drag(x, 0, 300);
  assert.equal(x.pointer.cancel({ silent: true }), true); assert.deepEqual([x.log.drop, x.log.cancel], [[], []]); clean(x);
});

test('after a drag the click that browsers still deliver to the row is swallowed once', () => {
  const w = world();
  grab(w, 0); drag(w, 0, 300); release(w, 0, 300);
  const first = w.rows[0].emit('click'); assert.equal(first.prevented, true); assert.equal(first.stopped, true);
  assert.equal(w.rows[0].emit('click').prevented, false, 'only once');
  grab(w, 0); drag(w, 0, 300); release(w, 0, 300); w.flushTimers();
  assert.equal(w.rows[0].emit('click').prevented, false, 'and never after the event turn ends');
});

// ---- auto-scroll -------------------------------------------------------------------------------------------------------------------------------
test('I: near the bottom edge the scroller scrolls on animation frames, the preview keeps following, and it stops at the end', () => {
  const w = world({ count: 12, visible: 200 });
  grab(w, 0, w.middle(0)); drag(w, 0, 150);
  assert.equal(w.frames.length, 0, 'no frame is requested away from the edges');
  drag(w, 0, 295);
  assert.equal(w.frames.length, 1);
  const startTransform = shiftOf(w, 0);
  assert.ok(w.runFrame()); assert.ok(w.scroller.scrollTop > 0, 'scrolled down');
  assert.notEqual(shiftOf(w, 0), startTransform, 'the lifted row compensates for the scroll and stays under the pointer');
  let frames = 0; while (w.runFrame() && frames < 200) frames += 1;
  assert.equal(w.scroller.scrollTop, w.scroller.scrollHeight - w.scroller.clientHeight, 'it stops at the end of the content');
  assert.equal(w.frames.length, 0, 'and requests no further frames');
  release(w, 0, 295);
  assert.deepEqual(w.log.drop.map(d => d.slice(0, 2)), [['r1', 11]], 'the last receipt is reachable by scrolling');
});

test('I: the other rows keep shifting correctly while the list scrolls under a stationary pointer', () => {
  const w = world({ count: 12, visible: 200 });
  grab(w, 0, w.middle(0)); drag(w, 0, 295);
  for (let i = 0; i < 4; i += 1) w.runFrame();
  const scrolled = w.scroller.scrollTop;
  assert.ok(scrolled > 0);
  const passed = w.rows.slice(1).filter((_, i) => w.middle(i + 1) < 295).length; // the fake layout already reflects the scroll
  assert.equal(w.rows.slice(1).filter(row => row.style.transform === 'translateY(-50px)').length, passed);
  w.pointer.cancel(); clean(w);
});

test('I: near the top edge it scrolls up, and the speed grows towards the very edge', () => {
  const w = world({ count: 12, visible: 200 });
  w.scroller.scrollTop = 400;
  grab(w, 5, w.middle(5)); drag(w, 5, 100 + 50);
  w.runFrame(); const slow = 400 - w.scroller.scrollTop;
  w.scroller.scrollTop = 400;
  drag(w, 5, 101); w.runFrame(); const fast = 400 - w.scroller.scrollTop;
  assert.ok(slow >= 2 && fast > slow && fast <= 18, `speed ${slow} then ${fast}`);
  w.pointer.cancel();
});

test('I: no animation frame or timer is left running after a drop, a cancel or leaving the edge zone', () => {
  for (const end of [w => release(w, 0, 295), w => w.pointer.cancel(), w => w.rows[0].emit('pointercancel')]) {
    const w = world({ count: 12 }); grab(w, 0, w.middle(0)); drag(w, 0, 295);
    assert.equal(w.frames.length, 1); end(w);
    assert.equal(w.cancelled.length, 1, 'the pending frame request is cancelled');
    const top = w.scroller.scrollTop; w.runFrame(); assert.equal(w.scroller.scrollTop, top, 'a stale frame callback does nothing'); clean(w);
  }
  const w = world({ count: 12 }); grab(w, 0, w.middle(0)); drag(w, 0, 295); w.runFrame();
  drag(w, 0, 200); w.runFrame(); assert.equal(w.frames.length, 0, 'moving back to the middle ends the scrolling');
  w.pointer.cancel();
  const t = world(); grab(t, 0, t.middle(0), touch); t.pointer.cancel(); assert.equal(t.timers.size, 0, 'no long-press timer outlives the press');
});

test('I: the scrolling container is chosen per drag, so the desktop list and the phone sheet both work', () => {
  const sheet = { scrollTop: 0, scrollHeight: 2000, clientHeight: 600, getBoundingClientRect: () => ({ top: 0, bottom: 600 }) };
  const list = { scrollTop: 0, scrollHeight: 200, clientHeight: 200, getBoundingClientRect: () => ({ top: 100, bottom: 300 }) };
  const phone = world({ viewport: 600, scrollers: [list, sheet] });
  grab(phone, 0, 100); drag(phone, 0, 590);
  assert.equal(phone.frames.length, 1, 'the whole-sheet scroller reacts near the bottom of the screen');
  phone.runFrame(); assert.ok(sheet.scrollTop > 0); assert.equal(list.scrollTop, 0); phone.pointer.cancel();
  const desktop = world({ count: 12, viewport: 900 });
  grab(desktop, 0, 125); drag(desktop, 0, 295); desktop.runFrame();
  assert.ok(desktop.scroller.scrollTop > 0, 'the inner list scrolls on desktop'); desktop.pointer.cancel();
});

test('I: a bar pinned over the bottom of the scrolling area moves the bottom edge up to where the bar starts (the phone sheet)', () => {
  const bar = { getBoundingClientRect: () => ({ top: 250, bottom: 300 }) };
  const w = world({ count: 12, obstructions: () => [bar] });
  grab(w, 0, w.middle(0)); drag(w, 0, 215);
  assert.equal(w.frames.length, 1, 'the zone now starts about 56px above the bar, so this position scrolls');
  w.pointer.cancel();
  const plain = world({ count: 12 }); grab(plain, 0, plain.middle(0)); drag(plain, 0, 215);
  assert.equal(plain.frames.length, 0, 'without the bar the same position is not near the edge');
  const over = world({ count: 12, obstructions: () => [bar] }); grab(over, 0, over.middle(0)); drag(over, 0, 290);
  assert.equal(over.frames.length, 1, 'a pointer over the bar still scrolls'); over.pointer.cancel();
  const away = { getBoundingClientRect: () => ({ top: 600, bottom: 650 }) };
  const apart = world({ count: 12, obstructions: () => [away] }); grab(apart, 0, apart.middle(0)); drag(apart, 0, 215); assert.equal(apart.frames.length, 0);
});

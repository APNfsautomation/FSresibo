// Pointer (mouse, touch, pen) reordering for the Review & Arrange list (CP10-C3E-3R).
// Native Pointer Events only: no HTML5 drag and drop, no library. The whole receipt row is the drag surface; presses that start on a button (or any other
// control) never start a drag. This module holds no ordering state: while a drag is active it only draws a LIVE PREVIEW (the lifted row follows the pointer,
// the other rows slide to make room, and a dashed slot marks the insertion point) and, on drop, reports the receipt id and the position it should take. The
// caller applies that through the same move operation the buttons and keys use. The list is never rebuilt while dragging, so cancelling is just "put the
// transforms back".
//
// Mouse: pointerdown on the row, movement beyond a small threshold -> drag. Touch / pen: a deliberate long press (about 250 ms without moving more than a few
// pixels) -> drag; moving earlier means the person is scrolling, so the press is abandoned and the browser scrolls the list as usual (the rows keep the default
// touch-action, so vertical panning is never disabled). Once a long-press drag is active the browser would still pan on the first touchmove, so a non-passive
// touchmove listener on the list cancels that default only while a drag is active (it is only cancelable before panning has started, which is why the
// activation must happen from a stationary press).
//
// Hit-testing uses the rows' ORIGINAL geometry (captured when the drag becomes active, adjusted for scrolling), never their live shifted positions, so the preview
// cannot oscillate. Auto-scroll runs on animation frames only while the pointer is in an edge zone of a scrolling container, and every timer and frame request
// is cancelled when the drag ends or is cancelled.

const defaults = { thresholds: { mouse: 4 }, longPressMs: 250, touchSlop: 10, edge: 56, maxSpeed: 18 };
const interactiveSelector = 'button, a[href], input, select, textarea, label, summary, [role="button"]';

// Where every row goes while one of them is held at insertion index `target` (its final position among all rows). Uses real heights, so rows of different
// height (a row with an "updated" note is taller) still land exactly where they will be after the drop. Returns the vertical shift of each row from its
// original place (0 for the held row, which follows the pointer instead) and the offset of the insertion slot from the first row.
export function previewShifts({ tops, heights, origin, target }) {
  const count = tops.length;
  if (!count) return { shifts: [], slotOffset: 0 };
  const rel = tops.map(top => top - tops[0]);
  const gap = count > 1 ? Math.max(0, rel[1] - rel[0] - heights[0]) : 0;
  const finalOrder = [...Array(count).keys()].filter(index => index !== origin);
  finalOrder.splice(Math.max(0, Math.min(count - 1, target)), 0, origin);
  const newRel = []; let position = 0;
  for (const index of finalOrder) { newRel[index] = position; position += heights[index] + gap; }
  return { shifts: rel.map((place, index) => index === origin ? 0 : newRel[index] - place), slotOffset: newRel[origin] };
}

export function createPointerReorder({ list, onStart = () => {}, onDrop, onCancel = () => {}, windowRef = globalThis, requestFrame = callback => windowRef.requestAnimationFrame(callback), cancelFrame = id => windowRef.cancelAnimationFrame(id), setTimer = (callback, ms) => windowRef.setTimeout(callback, ms), clearTimer = id => windowRef.clearTimeout(id), findScrollers, obstructions = () => [], isInteractive = target => Boolean(target?.closest?.(interactiveSelector)), thresholds = defaults.thresholds, longPressMs = defaults.longPressMs, touchSlop = defaults.touchSlop, edge = defaults.edge, maxSpeed = defaults.maxSpeed }) {
  let drag = null; // { row, id, pointerId, type, touchLike, startX, startY, pointerY, active, geo, origin, scrollers, startScroll, slotBase, target, frame, pressTimer }
  let suppressClick = false;

  const rowsOf = () => [...list.children].filter(row => row.dataset?.receiptId);
  const viewportHeight = () => windowRef.innerHeight ?? 0;
  // The part of a scrolling container the user can actually see: clipped by the screen, and by bars that sit on top of it (on a phone the action buttons are
  // pinned over the bottom of the scrolling sheet, so the "bottom edge" is where they start, not the bottom of the screen).
  const visibleRect = element => {
    const rect = element.getBoundingClientRect();
    let top = Math.max(rect.top, 0); let bottom = Math.min(rect.bottom, viewportHeight() || rect.bottom);
    const centre = (top + bottom) / 2;
    for (const bar of obstructions()) {
      const box = bar?.getBoundingClientRect?.();
      if (!box || box.bottom <= top || box.top >= bottom) continue;
      if (box.top >= centre) bottom = Math.min(bottom, box.top); else top = Math.max(top, box.bottom);
    }
    return { top, bottom };
  };
  // The review area scrolls in a different element on desktop (the list) and on a phone (the whole sheet): look at the list and its scrolling ancestors.
  const scrollingAncestors = () => {
    if (findScrollers) return findScrollers(list);
    const found = []; const computed = windowRef.getComputedStyle?.bind(windowRef);
    for (let node = list; node && node.nodeType === 1; node = node.parentElement) {
      const overflowY = computed?.(node).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) found.push(node);
    }
    return found;
  };
  const scrolledBy = () => drag.scrollers.reduce((total, scroller) => total + (scroller.scrollTop - (drag.startScroll.get(scroller) ?? 0)), 0);

  // The position the receipt would take if dropped now: the number of OTHER rows whose original middle is above the pointer. Dragging outside the list simply
  // gives the first or the last position.
  const targetIndex = () => {
    const offset = scrolledBy(); let target = 0;
    drag.geo.forEach((box, index) => { if (index !== drag.origin && drag.pointerY > box.top - offset + box.height / 2) target += 1; });
    return target;
  };
  const showPreview = target => {
    const { shifts, slotOffset } = previewShifts({ tops: drag.geo.map(box => box.top), heights: drag.geo.map(box => box.height), origin: drag.origin, target });
    drag.geo.forEach((box, index) => { if (index !== drag.origin && box.row.style) box.row.style.transform = shifts[index] ? `translateY(${Math.round(shifts[index])}px)` : ''; });
    list.style?.setProperty?.('--drag-slot-top', `${Math.round(drag.slotBase + slotOffset)}px`);
  };
  const drawFeedback = () => {
    const target = targetIndex();
    if (drag.row.style) drag.row.style.transform = `translateY(${Math.round(drag.pointerY - drag.startY + scrolledBy())}px)`;
    if (target !== drag.target) { drag.target = target; showPreview(target); }
  };

  const velocity = () => {
    for (const scroller of drag.scrollers) {
      const rect = visibleRect(scroller);
      const speed = distance => Math.min(maxSpeed, Math.max(2, Math.ceil(distance / edge * maxSpeed)));
      if (drag.pointerY < rect.top + edge && scroller.scrollTop > 0) return { scroller, step: -speed(rect.top + edge - drag.pointerY) };
      if (drag.pointerY > rect.bottom - edge && scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight) return { scroller, step: speed(drag.pointerY - (rect.bottom - edge)) };
    }
    return null;
  };
  const scheduleScroll = () => {
    if (!drag?.active || drag.frame !== null || !velocity()) return;
    const current = drag;
    current.frame = 'pending'; // a frame callback that runs synchronously must not be overwritten by the id returned afterwards
    const id = requestFrame(() => {
      if (drag !== current || !current.active) return;
      current.frame = null;
      const move = velocity();
      if (!move) return;
      const { scroller } = move; scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, scroller.scrollTop + move.step));
      drawFeedback();
      scheduleScroll();
    });
    if (drag === current && current.frame === 'pending') current.frame = id;
  };

  const stopTracking = () => {
    if (!drag) return;
    if (drag.pressTimer !== null) clearTimer(drag.pressTimer);
    if (drag.frame !== null && drag.frame !== 'pending') cancelFrame(drag.frame);
    if (drag.active) {
      drag.geo.forEach(box => { if (box.row.style) box.row.style.transform = ''; });
      drag.row.classList.remove('is-dragging');
      list.classList.remove('is-dragging');
      list.style?.removeProperty?.('--drag-slot-top'); list.style?.removeProperty?.('--drag-slot-height');
    }
    try { if (drag.row.hasPointerCapture?.(drag.pointerId)) drag.row.releasePointerCapture(drag.pointerId); } catch { /* the pointer may already be gone */ }
    drag = null;
  };

  const activate = () => {
    drag.pressTimer = null;
    drag.active = true;
    const rows = rowsOf();
    drag.origin = rows.indexOf(drag.row);
    if (drag.origin < 0) { stopTracking(); return false; }
    drag.scrollers = scrollingAncestors();
    drag.startScroll = new Map(drag.scrollers.map(scroller => [scroller, scroller.scrollTop]));
    drag.geo = rows.map(row => { const box = row.getBoundingClientRect(); return { row, top: box.top, height: box.height }; });
    const listBox = list.getBoundingClientRect?.() ?? { top: 0 };
    drag.slotBase = drag.geo[0].top - (listBox.top + (list.clientTop ?? 0)) + (list.scrollTop ?? 0); // offset of the first slot inside the list's own scrolling content
    drag.target = null;
    drag.row.classList.add('is-dragging');
    list.classList.add('is-dragging');
    list.style?.setProperty?.('--drag-slot-height', `${Math.round(drag.geo[drag.origin].height)}px`);
    onStart(drag.id);
    return true;
  };

  const finish = committed => {
    const { id, target, row } = drag;
    const wasActive = drag.active;
    const fromTop = wasActive ? row.getBoundingClientRect().top : 0; // where the lifted row is on screen, so the drop can settle from there
    stopTracking();
    if (!wasActive) return;
    suppressClick = true; // the browser may still deliver a click on the row after the drop
    windowRef.setTimeout?.(() => { suppressClick = false; }, 0);
    if (committed) onDrop(id, target, { fromTop }); else onCancel(id, row);
  };

  list?.addEventListener?.('touchmove', event => { if (drag?.active && event.cancelable !== false) event.preventDefault(); }, { passive: false });

  return {
    attach(row, id) {
      row.addEventListener('pointerdown', event => {
        if (drag || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
        if (isInteractive(event.target)) return; // buttons keep their own behaviour
        const type = event.pointerType || 'mouse'; const touchLike = type === 'touch' || type === 'pen';
        drag = { row, id, pointerId: event.pointerId, type, touchLike, startX: event.clientX, startY: event.clientY, pointerY: event.clientY, active: false, geo: [], origin: -1, scrollers: [], startScroll: new Map(), slotBase: 0, target: null, frame: null, pressTimer: null };
        try { row.setPointerCapture?.(event.pointerId); } catch { /* capture is best effort; events still reach the row */ }
        if (touchLike) {
          const current = drag;
          current.pressTimer = setTimer(() => { if (drag === current && !current.active && activate()) drawFeedback(); }, longPressMs);
        } else {
          event.preventDefault?.(); // no text selection, no compatibility mouse events
          row.focus?.({ preventScroll: true });
        }
      });
      row.addEventListener('pointermove', event => {
        if (!drag || drag.row !== row || event.pointerId !== drag.pointerId) return;
        drag.pointerY = event.clientY;
        if (!drag.active) {
          const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
          if (drag.touchLike) { if (moved > touchSlop) stopTracking(); return; } // moved before the long press: this is a scroll, not a drag
          if (moved < (thresholds[drag.type] ?? thresholds.mouse)) return;
          if (!activate()) return;
        }
        event.preventDefault?.();
        drawFeedback();
        scheduleScroll();
      });
      row.addEventListener('pointerup', event => {
        if (!drag || drag.row !== row || event.pointerId !== drag.pointerId) return;
        if (drag.active) { drag.pointerY = event.clientY ?? drag.pointerY; drawFeedback(); event.preventDefault?.(); }
        finish(true);
      });
      row.addEventListener('pointercancel', event => { if (drag && drag.row === row && event.pointerId === drag.pointerId) finish(false); });
      row.addEventListener('lostpointercapture', event => { if (drag && drag.row === row && event.pointerId === drag.pointerId) finish(false); });
      row.addEventListener('contextmenu', event => { if (drag) event.preventDefault?.(); }); // the long-press menu on touch devices
      row.addEventListener('click', event => { if (suppressClick) { suppressClick = false; event.preventDefault?.(); event.stopPropagation?.(); } });
    },
    isActive: () => Boolean(drag?.active),
    // Escape, closing the dialog or re-rendering the list. Returns true only when an ACTIVE drag was cancelled (so Escape can be used up by it).
    cancel({ silent = false } = {}) {
      if (!drag) return false;
      const active = drag.active;
      if (!active) { stopTracking(); return false; }
      if (silent) { stopTracking(); return true; }
      finish(false);
      return true;
    }
  };
}

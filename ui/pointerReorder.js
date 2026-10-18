// Pointer (mouse, touch, pen) reordering for the Review & Arrange list (CP10-C3E-3).
// Native Pointer Events only: no HTML5 drag and drop, no library. A drag can start ONLY from a receipt's reorder handle; the rest of the row stays free for
// scrolling and clicking. This module holds no ordering state: while a drag is active it only draws feedback (a lifted row and a drop line) and, on drop,
// reports the receipt id and the position it should take. The caller applies that through the same move operation the buttons and keys use, and the list is
// not rebuilt while dragging, so cancelling is always just "remove the feedback".
//
// Lifecycle of one pointer: pointerdown on a handle -> pending; movement beyond a small threshold -> active; pointerup -> drop; pointercancel, a lost pointer
// capture or Escape (cancel()) -> cancelled with the original order untouched. Auto-scroll runs on animation frames only while the pointer is in an edge zone
// of a scrolling container, and every frame request is cancelled when the drag ends.

const defaults = { thresholds: { mouse: 4, pen: 5, touch: 8 }, edge: 56, maxSpeed: 18 };

export function createPointerReorder({ list, onStart = () => {}, onDrop, onCancel = () => {}, windowRef = globalThis, requestFrame = callback => windowRef.requestAnimationFrame(callback), cancelFrame = id => windowRef.cancelAnimationFrame(id), findScrollers, obstructions = () => [], thresholds = defaults.thresholds, edge = defaults.edge, maxSpeed = defaults.maxSpeed }) {
  let drag = null; // { handle, id, pointerId, type, startX, startY, active, row, scrollers, startScroll, pointerY, indicator, target, frame, suppressClick }
  let suppressClick = false;

  const rowsOf = () => [...list.children];
  const rowFor = id => rowsOf().find(row => row.dataset?.receiptId === id);
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

  const clearIndicator = () => { if (drag?.indicator) { drag.indicator.row.classList.remove('is-drop-before', 'is-drop-after'); drag.indicator = null; } };
  // Position the receipt would take if dropped now: the number of OTHER rows whose middle is above the pointer. Dragging outside the list simply gives the first or the last position.
  const targetIndex = () => {
    const others = rowsOf().filter(row => row !== drag.row);
    let target = 0;
    for (const row of others) { const box = row.getBoundingClientRect(); if (drag.pointerY > box.top + box.height / 2) target += 1; }
    return { target, others };
  };
  const drawFeedback = () => {
    const { target, others } = targetIndex();
    drag.target = target;
    if (drag.row.style) drag.row.style.transform = `translateY(${Math.round(drag.pointerY - drag.startY + scrolledBy())}px)`;
    const next = !others.length ? null : target === 0 ? { row: others[0], side: 'is-drop-before' } : { row: others[target - 1], side: 'is-drop-after' };
    if (drag.indicator && next && drag.indicator.row === next.row && drag.indicator.side === next.side) return;
    clearIndicator();
    if (next) { next.row.classList.add(next.side); drag.indicator = next; }
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
    if (drag.frame !== null && drag.frame !== 'pending') cancelFrame(drag.frame);
    clearIndicator();
    if (drag.active) {
      if (drag.row.style) drag.row.style.transform = '';
      drag.row.classList.remove('is-dragging');
      list.classList.remove('is-dragging');
    }
    try { if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId); } catch { /* the pointer may already be gone */ }
    drag = null;
  };

  const activate = () => {
    drag.active = true;
    drag.row = rowFor(drag.id);
    if (!drag.row) { stopTracking(); return false; }
    drag.scrollers = scrollingAncestors();
    drag.startScroll = new Map(drag.scrollers.map(scroller => [scroller, scroller.scrollTop]));
    drag.row.classList.add('is-dragging');
    list.classList.add('is-dragging');
    onStart(drag.id);
    return true;
  };

  const finish = committed => {
    const { id, target, handle } = drag;
    const wasActive = drag.active;
    stopTracking();
    if (!wasActive) return;
    suppressClick = true; // the browser may still deliver a click on the handle after the drop
    windowRef.setTimeout?.(() => { suppressClick = false; }, 0);
    if (committed) onDrop(id, target); else onCancel(id, handle);
  };

  return {
    attach(handle, id) {
      handle.addEventListener('pointerdown', event => {
        if (drag || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
        event.preventDefault?.(); // no text selection, no compatibility mouse events
        handle.focus?.({ preventScroll: true });
        drag = { handle, id, pointerId: event.pointerId, type: event.pointerType || 'mouse', startX: event.clientX, startY: event.clientY, pointerY: event.clientY, active: false, row: null, scrollers: [], startScroll: new Map(), indicator: null, target: 0, frame: null };
        try { handle.setPointerCapture?.(event.pointerId); } catch { /* capture is best effort; events still reach the handle */ }
      });
      handle.addEventListener('pointermove', event => {
        if (!drag || drag.handle !== handle || event.pointerId !== drag.pointerId) return;
        drag.pointerY = event.clientY;
        if (!drag.active) {
          const limit = thresholds[drag.type] ?? thresholds.mouse;
          if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < limit) return;
          if (!activate()) return;
        }
        event.preventDefault?.();
        drawFeedback();
        scheduleScroll();
      });
      handle.addEventListener('pointerup', event => {
        if (!drag || drag.handle !== handle || event.pointerId !== drag.pointerId) return;
        if (drag.active) { drag.pointerY = event.clientY ?? drag.pointerY; drawFeedback(); event.preventDefault?.(); }
        finish(true);
      });
      handle.addEventListener('pointercancel', event => { if (drag && drag.handle === handle && event.pointerId === drag.pointerId) finish(false); });
      handle.addEventListener('lostpointercapture', event => { if (drag && drag.handle === handle && event.pointerId === drag.pointerId) finish(false); });
      handle.addEventListener('contextmenu', event => { if (drag) event.preventDefault?.(); });
      handle.addEventListener('click', event => { if (suppressClick) { suppressClick = false; event.preventDefault?.(); event.stopPropagation?.(); } });
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

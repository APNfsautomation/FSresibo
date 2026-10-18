// Presentation of the Review & Arrange dialog (CP10-C3E-2): the numbered receipt list, the reorder controls, the summary and the acknowledgement.
// It holds no export, selection or database logic. The caller owns the order (an array of receipt ids) and passes a model to render().
//
// Every control calls the same onMove(id, toIndex): the Move Up / Move Down buttons, and ArrowUp / ArrowDown / Home / End on the reorder handle.
// After a move the dialog is rebuilt, focus returns to the control that was used (or to its neighbour when it just became disabled at an edge),
// and the move is announced in a polite live region. Pointer dragging (pointerReorder.js) starts only from the handle and ends in the same onMove.

import { parseMoneyAmount } from '../domain/moneyAmount.js';
import { createPointerReorder } from './pointerReorder.js';

const ownDocument = () => globalThis.document;

// One review row from a SAVED receipt (database snapshot). A missing amount reads "No amount" and is never shown as zero; an explicit 0 is a real amount.
export function buildReviewRow(entry, saved, note, { format, formatDate }) {
  const parsed = parseMoneyAmount(saved.amount);
  const store = String(saved.store ?? '').trim();
  const invoice = String(saved.invoice ?? '').trim();
  return {
    id: entry.dbId, label: entry.label, store: store || 'Store not set', invoice: invoice ? `Invoice ${invoice}` : 'No invoice number', date: formatDate(saved.receiptDate),
    amountMissing: Boolean(parsed.blank), amountText: parsed.blank ? 'No amount' : parsed.valid ? format(parsed.cents) : 'Invalid amount', note: note ?? ''
  };
}

export function createExportReview({ list, announcer, summary, acknowledgement, reset, hintId = 'exportReviewHint', onMove, onReset, onAcknowledge, createElement = tag => ownDocument().createElement(tag), pointerOptions = {} }) {
  let model = { rows: [] };
  let focusAfter = null;
  let announcements = 0;

  const make = (tag, className, text) => {
    const element = createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (className, label, symbol) => {
    const control = make('button', className, symbol);
    control.setAttribute('type', 'button');
    control.setAttribute('aria-label', label);
    return control;
  };
  const announce = text => {
    if (!announcer) return;
    announcements += 1;
    // A trailing non-breaking space on every other message makes a repeated sentence a new change for screen readers.
    announcer.textContent = `${text}${announcements % 2 ? '' : ' '}`;
  };

  const requestMove = (id, toIndex, control) => {
    const from = model.rows.findIndex(row => row.id === id);
    if (from < 0) return;
    const last = model.rows.length - 1;
    const target = Math.max(0, Math.min(last, toIndex));
    const { label } = model.rows[from];
    if (target === from) { announce(`${label} is already at position ${from + 1} of ${model.rows.length}.`); return; }
    focusAfter = { id, control };
    onMove(id, target);
    announce(`${label} moved to position ${target + 1} of ${model.rows.length}.`);
  };

  const rowInfo = id => { const index = model.rows.findIndex(row => row.id === id); return { index, label: model.rows[index]?.label ?? '', count: model.rows.length }; };
  const pointer = createPointerReorder({
    list,
    ...pointerOptions,
    onStart: id => { const { index, label, count } = rowInfo(id); announce(`Picked up ${label}, position ${index + 1} of ${count}. Drag to a new position, or press Escape to cancel.`); },
    // A drop is just another move request, so the order, the focus handling and the announcement are the ones the buttons and keys use.
    onDrop: (id, toIndex) => {
      const { index, label, count } = rowInfo(id);
      if (toIndex === index) { announce(`${label} stays at position ${index + 1} of ${count}.`); focusHandle(id); return; }
      requestMove(id, toIndex, 'handle');
    },
    onCancel: id => { const { index, label, count } = rowInfo(id); announce(`Move cancelled. ${label} is still at position ${index + 1} of ${count}.`); focusHandle(id); }
  });
  const focusHandle = id => [...(list.children ?? [])].find(item => item.dataset?.receiptId === id)?.reviewParts?.handle.focus?.({ preventScroll: true });

  const buildRow = (row, index, count) => {
    const item = make('li', `export-review-row${row.note ? ' has-note' : ''}${row.amountMissing ? ' has-no-amount' : ''}`);
    item.dataset.receiptId = row.id;
    const position = make('span', 'export-review-position', String(index + 1));
    position.setAttribute('aria-hidden', 'true');
    const handle = button('export-review-handle', `Reorder ${row.label}, position ${index + 1} of ${count}`, '⠿');
    handle.setAttribute('aria-describedby', hintId);
    const up = button('export-review-move export-review-up', `Move ${row.label} up`, '▲');
    const down = button('export-review-move export-review-down', `Move ${row.label} down`, '▼');
    up.disabled = index === 0;
    down.disabled = index === count - 1;
    up.addEventListener('click', () => requestMove(row.id, index - 1, 'up'));
    down.addEventListener('click', () => requestMove(row.id, index + 1, 'down'));
    handle.addEventListener('keydown', event => {
      const target = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: count - 1 }[event.key];
      if (target === undefined || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault?.();
      requestMove(row.id, target, 'handle');
    });
    pointer.attach(handle, row.id);
    const details = make('div', 'export-review-details');
    details.append(make('strong', 'export-review-receipt', `${row.label} · ${row.store}`), make('span', 'export-review-meta', `${row.invoice} · ${row.date}`));
    if (row.note) details.append(make('span', 'export-review-note', row.note));
    const amount = make('strong', `export-review-amount${row.amountMissing ? ' is-missing' : ''}`, row.amountText);
    const moves = make('div', 'export-review-moves');
    moves.append(up, down);
    item.append(position, handle, details, amount, moves);
    item.reviewParts = { handle, up, down, position, amount };
    return item;
  };

  const restoreFocus = items => {
    if (!focusAfter) return;
    const { id, control } = focusAfter;
    focusAfter = null;
    const parts = items.find(item => item.dataset.receiptId === id)?.reviewParts;
    if (!parts) return;
    const wanted = control === 'up' ? parts.up : control === 'down' ? parts.down : parts.handle;
    const neighbour = control === 'up' ? parts.down : control === 'down' ? parts.up : parts.handle;
    (wanted.disabled ? (neighbour.disabled ? parts.handle : neighbour) : wanted).focus?.({ preventScroll: false });
  };

  return {
    render(next) {
      pointer.cancel({ silent: true }); // a rebuilt list cannot continue a drag
      model = next;
      const count = next.rows.length;
      const items = next.rows.map((row, index) => buildRow(row, index, count));
      list.replaceChildren(...items);
      list.setAttribute?.('aria-label', `Receipts in export order, ${count} in total`);
      if (summary) {
        summary.count.textContent = String(count);
        summary.total.textContent = next.totalText;
        summary.noAmountGroup.hidden = !next.withoutAmount;
        summary.noAmount.textContent = next.withoutAmount ? `${next.withoutAmount} without an amount (not counted in the total)` : '';
      }
      if (reset) reset.disabled = !next.canReset;
      if (acknowledgement) {
        acknowledgement.group.hidden = !next.acknowledgement;
        acknowledgement.text.textContent = next.acknowledgement?.text ?? '';
        acknowledgement.input.checked = Boolean(next.acknowledgement?.checked);
      }
      restoreFocus(items);
      return items;
    },
    // The one place that wires the static controls (reset and acknowledgement); the receipt rows are wired as they are built.
    start() {
      reset?.addEventListener('click', () => { onReset(); announce('Order reset to the original export order.'); list.children?.[0]?.reviewParts?.handle.focus?.({ preventScroll: false }); });
      acknowledgement?.input?.addEventListener('change', event => onAcknowledge(Boolean((event.currentTarget ?? acknowledgement.input).checked)));
    },
    announce,
    // Escape while dragging cancels the drag and keeps the dialog open; true when it did, so the caller does not also close the dialog.
    cancelDrag: () => pointer.cancel(),
    isDragging: () => pointer.isActive(),
    clear() {
      pointer.cancel({ silent: true });
      model = { rows: [] };
      focusAfter = null;
      list?.replaceChildren();
      if (announcer) announcer.textContent = '';
      if (acknowledgement?.group) { acknowledgement.group.hidden = true; acknowledgement.input.checked = false; }
    }
  };
}

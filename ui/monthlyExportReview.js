// Review & Arrange for Monthly Filing (Issue #50, requirement 1): the same numbered, reorderable list that Receipt Optimization shows before an export, for the
// SAVED Active receipts about to be exported. It only decides ORDER: the receipt set is exactly the one handed in, nothing is saved, generated or archived here,
// and the workspace cards are never reordered (the order exists only for the workbook's Item No. sequence). Resolves with the receipts in the confirmed order,
// or null when the user cancels (Cancel, backdrop or Escape) or the review is cancelled because the session ended.
import { createExportReview, buildReviewRow } from './exportReview.js';
import { moveId, sameMembers, summarizeAmounts } from '../domain/exportArrangement.js';

export function createMonthlyExportReview({ modal, backdrop, message, list, announcer, summary, resetButton, confirmButton, cancelButton, modalFocus = null, format, formatDate = value => value || 'Date not set', createElement }) {
  let session = null; // { records, byId, labels, initial, order, resolve, trigger }
  const finish = result => {
    if (!session) return;
    const done = session; session = null;
    reviewView.clear?.();
    modal.hidden = true;
    confirmButton.disabled = false;
    if (modalFocus) modalFocus.close(modal, { fallback: done.trigger }); else done.trigger?.focus?.({ preventScroll: true });
    done.resolve(result);
  };
  const render = () => {
    if (!session) return;
    const rows = session.order.map(id => buildReviewRow({ dbId: id, label: session.labels.get(id) }, session.byId.get(id), '', { format, formatDate }));
    const sums = summarizeAmounts(session.order.map(id => session.byId.get(id)));
    reviewView.render({ rows, totalText: format(sums.validCents), withoutAmount: sums.withoutAmount, canReset: session.order.some((id, index) => id !== session.initial[index]), acknowledgement: null });
  };
  const reviewView = createExportReview({
    list, announcer, summary, reset: resetButton, hintId: 'monthlyExportReviewHint', createElement,
    onMove: (id, toIndex) => { if (session) { session.order = moveId(session.order, id, toIndex); render(); } },
    onReset: () => { if (session) { session.order = [...session.initial]; render(); } },
    onAcknowledge: () => {},
    pointerOptions: { obstructions: () => [confirmButton?.parentElement].filter(Boolean) }
  });
  const escape = () => { if (reviewView.cancelDrag()) return; finish(null); };
  return {
    start() {
      reviewView.start();
      confirmButton.addEventListener('click', () => { if (session) finish(session.order.map(id => session.byId.get(id))); });
      cancelButton.addEventListener('click', () => finish(null));
      backdrop.addEventListener('click', () => finish(null));
    },
    isOpen: () => Boolean(session),
    // Ends an open review without a result (sign-out, another account): the export that was waiting for it stops.
    cancel: () => finish(null),
    // records: the saved Active receipts in their current order, each with a dbId. Labels keep the receipt's current number so it stays recognisable while it moves.
    review(records, { trigger = null } = {}) {
      if (session || !records.length) return Promise.resolve(null);
      const ids = records.map(record => record.dbId);
      if (ids.some(id => !id) || !sameMembers(ids, [...ids])) return Promise.resolve(null);
      return new Promise(resolve => {
        session = { records, byId: new Map(records.map(record => [record.dbId, record])), labels: new Map(records.map((record, index) => [record.dbId, `Receipt ${index + 1}`])), initial: ids, order: [...ids], resolve, trigger };
        message.textContent = `Put the ${records.length} Active receipt${records.length === 1 ? '' : 's'} in the order of your paper copies. After the workbook is generated, they are Archived and become read-only. Your Monthly Filing cards keep their current order.`;
        modal.hidden = false;
        render();
        modalFocus?.open(modal, { trigger, fallback: trigger, onEscape: escape });
        confirmButton.focus?.({ preventScroll: true });
      });
    },
    escape
  };
}

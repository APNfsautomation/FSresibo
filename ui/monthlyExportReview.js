// Review & Arrange for Monthly Filing (Issue #50, requirement 1): the same numbered, reorderable list that Receipt Optimization shows before an export, for the
// SAVED Active receipts about to be exported. The workspace cards are never reordered (the order exists only for the workbook's Item No. sequence).
// Resolves with the receipts in the confirmed order, or null when the user cancels (Cancel, backdrop or Escape) or the review ends without a result
// (the session ended, or the injected `commit` stopped the export).
//
// Issue #58: when the caller passes `commit`, every row also carries editable Expense Account and Classification of Expense. The edits live only in this dialog;
// nothing is written here. On confirm, an incomplete selection keeps the dialog open (first missing field focused, nothing saved); a complete one is handed to
// `commit({ order, edits, records })`, which saves only the changed fields, verifies them and answers
//   { ok: true, records }                      -> the dialog closes with these verified records in the confirmed order,
//   { ok: false, message, records?, savedIds? } -> it stays open with the message (saved receipts are no longer edits),
//   { ok: false, close: true }                  -> it closes without a result (the caller says why).
// Without `commit` the dialog is order-only, exactly as before.
import { createExportReview, buildReviewRow, expenseRowModel } from './exportReview.js';
import { moveId, sameMembers, summarizeAmounts } from '../domain/exportArrangement.js';
import { classificationOptions, expenseAccountOptions, isClassification, isExpenseAccount } from '../domain/expenseClassification.js';

const expenseChecks = { expenseAccount: isExpenseAccount, classification: isClassification };
const idleLabel = 'Export & Archive';
const dirtyLabel = 'Save Details & Export';

export function createMonthlyExportReview({ modal, backdrop, message, list, announcer, summary, readiness, resetButton, confirmButton, cancelButton, modalFocus = null, format, formatDate = value => value || 'Date not set', createElement }) {
  let session = null; // { records, byId, labels, initial, order, resolve, trigger, commit, edits, busy }
  const value = (current, id, key) => { const edit = current.edits.get(id); return edit && key in edit ? edit[key] : current.byId.get(id)?.[key] ?? ''; };
  const incompleteIds = current => current.order.filter(id => Object.keys(expenseChecks).some(key => !expenseChecks[key](value(current, id, key))));
  const dirtyIds = current => current.order.filter(id => Object.keys(expenseChecks).some(key => value(current, id, key) !== (current.byId.get(id)?.[key] ?? '')));
  const finish = result => {
    if (!session) return;
    const done = session; session = null;
    reviewView.clear?.();
    if (readiness) readiness.hidden = true;
    modal.hidden = true;
    confirmButton.disabled = false; confirmButton.textContent = idleLabel; cancelButton.disabled = false;
    if (modalFocus) modalFocus.close(modal, { fallback: done.trigger }); else done.trigger?.focus?.({ preventScroll: true });
    done.resolve(result);
  };
  const showState = () => {
    if (!session) return;
    confirmButton.disabled = session.busy;
    cancelButton.disabled = session.busy; // Cancel must not race a running save
    if (!session.busy) confirmButton.textContent = session.commit && dirtyIds(session).length ? dirtyLabel : idleLabel;
  };
  const render = () => {
    if (!session) return;
    const current = session;
    const rows = current.order.map(id => {
      const row = buildReviewRow({ dbId: id, label: current.labels.get(id) }, current.byId.get(id), '', { format, formatDate });
      return current.commit ? { ...row, expense: expenseRowModel(value(current, id, 'expenseAccount'), value(current, id, 'classification'), current.busy) } : row;
    });
    const sums = summarizeAmounts(current.order.map(id => current.byId.get(id)));
    const complete = current.order.length - incompleteIds(current).length;
    reviewView.render({
      rows, totalText: format(sums.validCents), withoutAmount: sums.withoutAmount, canReset: current.order.some((id, index) => id !== current.initial[index]), acknowledgement: null, locked: current.busy,
      ...(current.commit ? { readinessText: `Export readiness: ${complete} of ${current.order.length} receipt${current.order.length === 1 ? '' : 's'} complete`, readinessComplete: complete === current.order.length } : {})
    });
  };
  const focusFirstIncomplete = () => {
    const id = incompleteIds(session)[0];
    const parts = [...(list.children ?? [])].find(item => item.dataset?.receiptId === id)?.reviewParts;
    const target = [parts?.account, parts?.classification].find(select => select?.getAttribute?.('aria-invalid')) ?? parts?.account;
    if (!target || target.disabled) return false;
    target.focus?.({ preventScroll: false });
    return true;
  };
  const reviewView = createExportReview({
    list, announcer, summary, reset: resetButton, readiness, hintId: 'monthlyExportReviewHint', createElement,
    expenseOptions: { expenseAccount: expenseAccountOptions, classification: classificationOptions },
    onExpenseChange: (id, key, chosen) => {
      if (!session?.commit || session.busy || !session.byId.has(id)) return;
      const edit = { ...(session.edits.get(id) ?? {}), [key]: chosen };
      if (edit[key] === (session.byId.get(id)[key] ?? '')) delete edit[key]; // back to the saved value: not an edit any more
      if (Object.keys(edit).length) session.edits.set(id, edit); else session.edits.delete(id);
      render(); showState();
      reviewView.announce(`${session.order.length - incompleteIds(session).length} of ${session.order.length} receipts ready to export.`);
    },
    onMove: (id, toIndex) => { if (session && !session.busy) { session.order = moveId(session.order, id, toIndex); render(); } },
    onReset: () => { if (session && !session.busy) { session.order = [...session.initial]; render(); } },
    onAcknowledge: () => {},
    pointerOptions: { obstructions: () => [confirmButton?.parentElement].filter(Boolean) }
  });
  const dismiss = () => { if (session?.busy) return; finish(null); };
  const escape = () => { if (reviewView.cancelDrag()) return; dismiss(); };
  const confirm = async () => {
    const mine = session;
    if (!mine || mine.busy) return;
    if (!mine.commit) return finish(mine.order.map(id => mine.byId.get(id)));
    const incomplete = incompleteIds(mine);
    if (incomplete.length) {
      const text = `${incomplete.map(id => mine.labels.get(id)).join(', ')} still ${incomplete.length === 1 ? 'needs' : 'need'} an Expense Account and a Classification of Expense. Nothing was saved, exported or archived.`;
      message.textContent = text; reviewView.announce(text); focusFirstIncomplete();
      return;
    }
    const edits = new Map(dirtyIds(mine).map(id => [id, { expenseAccount: value(mine, id, 'expenseAccount'), classification: value(mine, id, 'classification') }]));
    mine.busy = true; render(); showState();
    let outcome;
    // `records` are the newest known values (a retry after a partial save must start from what was really saved, not from the records the review opened with).
    try { outcome = await mine.commit({ order: [...mine.order], edits, records: mine.records.map(record => mine.byId.get(record.dbId)) }); }
    catch (error) { outcome = { ok: false, message: `Could not save the details: ${error?.message || 'Unknown error'}. Nothing was exported or archived.` }; }
    if (session !== mine) return; // the review ended (another account, sign-out) while the commit ran: its answer is not applied
    mine.busy = false;
    if (outcome?.ok) return finish(outcome.records);
    if (outcome?.close) return finish(null);
    for (const record of outcome?.records ?? []) if (mine.byId.has(record.dbId)) mine.byId.set(record.dbId, record);
    for (const id of outcome?.savedIds ?? []) mine.edits.delete(id);
    message.textContent = outcome?.message ?? 'The details could not be saved. Nothing was exported or archived.';
    reviewView.announce(message.textContent);
    render(); showState();
    if (!focusFirstIncomplete()) confirmButton.focus?.({ preventScroll: true });
  };
  return {
    start() {
      reviewView.start();
      confirmButton.addEventListener('click', confirm);
      cancelButton.addEventListener('click', dismiss);
      backdrop.addEventListener('click', dismiss);
    },
    isOpen: () => Boolean(session),
    // Ends an open review without a result (sign-out, another account): the export that was waiting for it stops, even while a save is running.
    cancel: () => finish(null),
    // records: the saved Active receipts in their current order, each with a dbId. Labels keep the receipt's current number so it stays recognisable while it moves.
    review(records, { trigger = null, commit = null } = {}) {
      if (session || !records.length) return Promise.resolve(null);
      const ids = records.map(record => record.dbId);
      if (ids.some(id => !id) || !sameMembers(ids, [...ids])) return Promise.resolve(null);
      return new Promise(resolve => {
        session = { records, byId: new Map(records.map(record => [record.dbId, record])), labels: new Map(records.map((record, index) => [record.dbId, `Receipt ${index + 1}`])), initial: ids, order: [...ids], resolve, trigger, commit, edits: new Map(), busy: false };
        const count = records.length;
        message.textContent = `Put the ${count} Active receipt${count === 1 ? '' : 's'} in the order of your paper copies. After the workbook is generated, ${count === 1 ? 'it is' : 'they are'} Archived and become read-only. Your Monthly Filing cards keep their current order.${commit ? ' Expense details you choose here are saved only when you choose Save Details & Export; Cancel discards them, and anything saved before this review stays saved.' : ''}`;
        modal.hidden = false;
        render(); showState();
        modalFocus?.open(modal, { trigger, fallback: trigger, onEscape: escape });
        if (!(commit && focusFirstIncomplete())) confirmButton.focus?.({ preventScroll: true });
      });
    },
    escape
  };
}

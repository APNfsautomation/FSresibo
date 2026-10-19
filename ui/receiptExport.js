// Nonvisual orchestration of a My Receipts export (CP10-C3E-1): preflight, database snapshots, workbook, status update, post-check.
// No DOM, storage or network access of its own: the caller injects the receipt reads, the workbook writer and the lifecycle update.
//
// Sequence (unchanged order): the workbook is generated first, then the receipts are marked Consumed.
// Known concurrency window: a receipt changed in another session between the final snapshot read and the status update is not prevented
// (that would need a database transaction, which is out of scope). It is detected afterwards by comparing the returned values (see `drift`).
import { parseMoneyAmount } from '../domain/moneyAmount.js';
import { classifyExportSnapshot, exportDrift, exportFieldLabels } from '../domain/exportArrangement.js';

const names = labels => labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
const fieldNames = fields => names(fields.map(field => exportFieldLabels[field] ?? field));
const labelsOf = (problems, type) => [...new Set(problems.filter(problem => problem.type === type).map(problem => problem.label))];

// items: one descriptor per selected receipt, read from the screen by the caller:
// { label, dbId, present, status, unsaved, amountProblem }. A receipt with no dbId was never saved (the optimizer can select unsaved drafts).
export function preflightExport(items) {
  const problems = [];
  for (const item of items) {
    if (!item.present || item.status !== 'available') problems.push({ type: 'unavailable', label: item.label });
    else if (!item.dbId) problems.push({ type: item.savedSinceResult ? 'resultStale' : 'draft', label: item.label });
    else if (item.unsaved) problems.push({ type: 'unsaved', label: item.label });
    else if (item.amountProblem) problems.push({ type: 'invalidAmount', label: item.label, detail: item.amountProblem });
  }
  return { ok: problems.length === 0, problems };
}

// `mode` is 'best-match' or 'manual': a manual selection is never told to run Find Best Match; it is told to fix the receipt and export again.
export function preflightMessage(problems, { mode = 'best-match' } = {}) {
  const manual = mode === 'manual';
  const lines = [];
  for (const label of labelsOf(problems, 'draft')) lines.push(manual ? `${label} has not been saved. Save it in Encoding before exporting.` : `${label} has not been saved. Save it before exporting and run Find Best Match again.`);
  for (const label of labelsOf(problems, 'resultStale')) lines.push(`${label} was saved after Find Best Match ran. Run Find Best Match again so the result uses its saved values.`);
  const unsaved = labelsOf(problems, 'unsaved');
  if (unsaved.length) lines.push(`${names(unsaved)} ${unsaved.length === 1 ? 'has' : 'have'} unsaved changes. Save them in Encoding, then ${manual ? 'choose Export Selected again' : 'run Find Best Match again before exporting'}.`);
  for (const problem of problems.filter(candidate => candidate.type === 'invalidAmount')) lines.push(`${problem.label}: ${problem.detail} Correct it before exporting.`);
  const unavailable = labelsOf(problems, 'unavailable');
  if (unavailable.length) lines.push(`${names(unavailable)} ${unavailable.length === 1 ? 'is' : 'are'} no longer Available. ${manual ? `Deselect ${unavailable.length === 1 ? 'it' : 'them'} and choose Export Selected again.` : 'Run Find Best Match again.'}`);
  return `${lines.join(' ')} Nothing was exported.`;
}

// Problems found by comparing the database against what the user selected (or against the snapshot they reviewed).
export function snapshotProblemMessage(problems, { stage = 'review', mode = 'best-match' } = {}) {
  const manual = mode === 'manual';
  const lines = [];
  const removed = items => manual ? ` and ${items.length === 1 ? 'was' : 'were'} removed from your selection` : '';
  const missing = labelsOf(problems, 'missing');
  if (missing.length) lines.push(`${names(missing)} no longer ${missing.length === 1 ? 'exists' : 'exist'} in your saved receipts${removed(missing)}.`);
  const unavailable = labelsOf(problems, 'unavailable');
  if (unavailable.length) lines.push(`${names(unavailable)} ${unavailable.length === 1 ? 'is' : 'are'} no longer Available (already Consumed in another session)${removed(unavailable)}.`);
  const invalid = labelsOf(problems, 'invalidAmount');
  if (invalid.length) lines.push(`${names(invalid)} ${invalid.length === 1 ? 'has' : 'have'} an invalid saved amount.`);
  const stale = labelsOf(problems, 'optimizerChanged');
  if (stale.length) lines.push(`The saved amount of ${names(stale)} no longer matches the amount Find Best Match used, so this result is out of date.`);
  for (const problem of problems.filter(candidate => candidate.type === 'changed')) lines.push(`${problem.label} was changed after it was selected (${fieldNames(problem.fields)}).`);
  const onlyMissing = problems.every(problem => problem.type === 'missing'); // a deleted receipt has no saved values to show
  const next = manual ? `${onlyMissing ? '' : 'The affected receipts now show their current saved values. '}Review your selection and choose Export Selected again.` : 'Run Find Best Match again.';
  const closing = stage === 'confirm' ? `No workbook was prepared and nothing was marked Consumed. ${next}` : `Nothing was exported. ${next}`;
  return `${lines.join(' ')} ${closing}`;
}

// Informational only: which receipts with unsaved values took part in the calculation, and whether any of them was actually selected.
export function unsavedValuesNotice({ selected = [], considered = [] }) {
  const others = considered.filter(label => !selected.includes(label));
  if (!selected.length && !others.length) return '';
  const parts = [];
  if (selected.length) parts.push(`The selected result includes ${names(selected)} with unsaved values. Save ${selected.length === 1 ? 'it' : 'them'} in Encoding and run Find Best Match again before exporting.`);
  if (others.length) parts.push(selected.length ? `Unsaved values were also used for ${names(others)}.` : `Find Best Match also used unsaved values for ${names(others)}; none of them is in the selected result.`);
  return parts.join(' ');
}

// The workbook receives the saved database values; the amount is normalized the way the existing export always did ("1250.5" -> "1250.50").
export function exportRowFromSnapshot(row) {
  const parsed = parseMoneyAmount(row.amount);
  return { ...row, amount: parsed.valid ? parsed.canonical : row.amount };
}

export function createReceiptExportRunner({ fetchSnapshot, generateWorkbook, consume }) {
  let pending = false;
  let generation = 0;
  let uncertain = null;
  const forgetResolved = (ids, rows) => {
    if (!uncertain) return;
    const fetched = new Set(ids);
    const stillAvailable = new Set(rows.filter(row => row.status === 'available').map(row => row.dbId));
    const remaining = uncertain.ids.filter(id => !fetched.has(id) || stillAvailable.has(id));
    uncertain = remaining.length ? { ...uncertain, ids: remaining } : null;
  };
  return {
    isPending: () => pending,
    // Receipts whose status update failed after a workbook was prepared, and which the database still reports as Available.
    uncertainIds: () => uncertain ? [...uncertain.ids] : [],
    // Snapshot A: always a fresh database read. A baseline from before a failed status update cannot be reused for a retry.
    async loadBaseline(ids) {
      const rows = await fetchSnapshot(ids);
      forgetResolved(ids, rows);
      return { rows, generation };
    },
    async run({ entries, baseline }) {
      if (pending) return { state: 'busy' };
      if (!baseline || baseline.generation !== generation) return { state: 'verification-required' };
      pending = true;
      try {
        const ids = entries.map(entry => entry.dbId);
        let rows;
        try { rows = await fetchSnapshot(ids); } catch (error) { return { state: 'snapshot-failed', error }; }
        const verdict = classifyExportSnapshot({ entries, snapshotRows: rows, reference: new Map(baseline.rows.map(row => [row.dbId, row])) });
        if (!verdict.ok) return { state: 'blocked', problems: verdict.problems, snapshotRows: rows };
        const byId = new Map(rows.map(row => [row.dbId, row]));
        const exportRows = ids.map(id => exportRowFromSnapshot(byId.get(id)));
        try { generateWorkbook(exportRows); } catch (error) { return { state: 'generation-failed', error }; }
        let consumed;
        try { consumed = await consume(ids); } catch (error) { generation += 1; uncertain = { ids, error }; return { state: 'consume-failed', error, exportRows }; }
        if (uncertain) { const done = new Set(ids); const remaining = uncertain.ids.filter(id => !done.has(id)); uncertain = remaining.length ? { ...uncertain, ids: remaining } : null; }
        return { state: 'consumed', consumed, exportRows, drift: exportDrift(exportRows, consumed) };
      } finally { pending = false; }
    }
  };
}

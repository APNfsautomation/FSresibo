import assert from 'node:assert/strict';
import test from 'node:test';
import { amountCompartmentForCents, availableOptimizerReceipts, availableReceiptTotalCents, buildOptimizationView, defaultOptimizationToolbarState, groupSelectedReceiptsByCompartment, normalizeReceiptStatus, receiptMatchesEncodingAmountCompartment } from '../ui/receiptUi.js';
import { buildExpenseDetailedReportRows } from '../services/exportService.js';
import { findBest } from '../services/optimizationService.js';

const entries = [
  { index: 0, receiptId: '1', date: '2026-07-01', amount: 50000, receipt: { store: 'Available Store', invoice: '', tin: '', address: '', status: 'available' } },
  { index: 1, receiptId: '2', date: '2026-07-02', amount: 60000, receipt: { store: 'Consumed Store', invoice: '', tin: '', address: '', status: 'consumed' } }
];

test('receipt lifecycle defaults unknown and existing values to Available', () => {
  assert.equal(normalizeReceiptStatus('available'), 'available');
  assert.equal(normalizeReceiptStatus('consumed'), 'consumed');
  assert.equal(normalizeReceiptStatus('archived'), 'available');
  assert.equal(defaultOptimizationToolbarState().status, 'available');
});

test('status filter shows Available, Consumed, and All predictably', () => {
  const state = defaultOptimizationToolbarState();
  assert.deepEqual(buildOptimizationView(entries, state).visible.map(entry => entry.receiptId), ['1']);
  state.status = 'consumed';
  assert.deepEqual(buildOptimizationView(entries, state).visible.map(entry => entry.receiptId), ['2']);
  state.status = 'all';
  assert.deepEqual(buildOptimizationView(entries, state).visible.map(entry => entry.receiptId), ['1', '2']);
});

test('optimizer eligibility remains Available-only even when Consumed or All is viewed', () => {
  const candidates = [
    { index: 0, status: 'available', cents: 50000 },
    { index: 1, status: 'consumed', cents: 60000 },
    { index: 2, status: 'available', cents: 0 }
  ];
  assert.deepEqual(availableOptimizerReceipts(candidates).map(receipt => receipt.index), [0]);
});

test('shared amount compartments are centavo-safe at every physical filing boundary', () => {
  const cases = [[0, 'below-200'], [1, 'below-200'], [19950, 'below-200'], [19999, 'below-200'], [20000, '200-299'], [29999, '200-299'], [30000, '300-399'], [99999, '900-999'], [100000, '1000-plus'], [250075, '1000-plus']];
  cases.forEach(([cents, expected]) => {
    assert.equal(amountCompartmentForCents(cents)?.value, expected);
    assert.equal(receiptMatchesEncodingAmountCompartment(cents, expected), true);
  });
});

test('Available Total includes the complete Available pool regardless of display filters', () => {
  assert.equal(availableReceiptTotalCents([{ status: 'available', cents: 19950 }, { status: 'consumed', cents: 50000 }, { status: 'available', cents: 20000 }]), 39950);
});

test('selected-result grouping is derived, ordered by compartment, and leaves export input untouched', () => {
  const selected = [
    { dbId: 'one', label: 'Receipt 1', cents: 35000, amount: '350.00', store: 'Gamma', receiptDate: '2026-08-01' },
    { dbId: 'two', label: 'Receipt 2', cents: 10000, amount: '100.00', store: 'Alpha', receiptDate: '2026-08-02' },
    { dbId: 'three', label: 'Receipt 3', cents: 25000, amount: '250.00', store: 'Beta', receiptDate: '2026-08-03' },
    { dbId: 'four', label: 'Receipt 4', cents: 10000, amount: '100.00', store: 'Delta', receiptDate: '2026-08-04' }
  ];
  const sourceOrder = selected.map(receipt => receipt.dbId);
  const optimizerCandidates = selected.map((receipt, index) => ({ index, cents: receipt.cents }));
  const optimizerResultBeforeGrouping = findBest(optimizerCandidates, 80000);
  const groups = groupSelectedReceiptsByCompartment(selected);
  assert.deepEqual(groups.map(group => group.label), ['Below ₱200', '₱200–299', '₱300–399']);
  assert.deepEqual(groups[0].receipts.map(receipt => receipt.dbId), ['two', 'four']);
  assert.deepEqual(selected.map(receipt => receipt.dbId), sourceOrder);
  assert.deepEqual(groups.flatMap(group => group.receipts).map(receipt => receipt.dbId).sort(), sourceOrder.slice().sort());
  assert.deepEqual(findBest(optimizerCandidates, 80000), optimizerResultBeforeGrouping);

  const exportRows = buildExpenseDetailedReportRows(selected);
  assert.deepEqual(exportRows.slice(2).map(row => row[2]), ['Gamma', 'Alpha', 'Beta', 'Delta']);
  assert.deepEqual(selected.map(receipt => receipt.dbId), sourceOrder);
});

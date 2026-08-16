import assert from 'node:assert/strict';
import test from 'node:test';
import { availableOptimizerReceipts, availableReceiptTotalCents, buildOptimizationView, defaultOptimizationToolbarState, normalizeReceiptStatus, receiptMatchesEncodingAmountCompartment } from '../ui/receiptUi.js';

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

test('Encoding amount compartments are display-only centavo-safe presets', () => {
  assert.equal(receiptMatchesEncodingAmountCompartment(19950, 'below-200'), true);
  assert.equal(receiptMatchesEncodingAmountCompartment(20000, '200-299'), true);
  assert.equal(receiptMatchesEncodingAmountCompartment(29999, '200-299'), true);
  assert.equal(receiptMatchesEncodingAmountCompartment(30000, '200-299'), false);
  assert.equal(receiptMatchesEncodingAmountCompartment(100000, '1000-plus'), true);
});

test('Available Total includes the complete Available pool regardless of display filters', () => {
  assert.equal(availableReceiptTotalCents([{ status: 'available', cents: 19950 }, { status: 'consumed', cents: 50000 }, { status: 'available', cents: 20000 }]), 39950);
});

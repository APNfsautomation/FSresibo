import assert from 'node:assert/strict';
import test from 'node:test';
import { createReceiptUi } from '../ui/receiptUi.js';
import { optimizationStrategies } from '../services/optimizationService.js';

const element = (overrides = {}) => ({ hidden: false, textContent: '', value: '', disabled: false, children: [], replaceChildren() {}, setAttribute() {}, ...overrides });
const storage = new Map();
globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
globalThis.Option = class { constructor(label, value) { this.label = label; this.value = value; } };
globalThis.document = {
  createDocumentFragment: () => ({ append() {} }),
  createElement: () => element({ className: '' })
};
const makeElements = () => ({
  receiptWorkspaceSwitcher: element(), receiptStatusControl: element(), encodingWorkspace: element(), optimizationWorkspace: element(),
  encodingTab: element(), optimizationTab: element(), optimizationStrategy: element({ value: optimizationStrategies.closest }), optimizationStrategyHelper: element(),
  list: element(), optimizationStoreFilter: element(), optimizationSearch: element(), optimizationStartDate: element(), optimizationEndDate: element(),
  optimizationMinAmount: element(), optimizationMaxAmount: element(), optimizationSort: element({ value: 'default' }), receiptStatusFilter: element({ value: 'available' }),
  optimizationList: element(), optimizationResultCount: element(), optimizationFilterStatus: element(), clearOptimizationFilters: element(), clearOptimizationSearch: element(),
  optimizationRangeValidation: element(), optimizationHiddenSelected: element(), exportSelected: element()
});

test('Receipt module visibility uses app.js receiptWorkspaceSwitcher contract and restores workspaces', () => {
  const elements = makeElements();
  const ui = createReceiptUi({ elements, findBest: () => null, optimizationStrategies, toCents: Number, scanPrintedDetails: async () => ({}), downloadSelectedReceipts() {}, receiptService: {} });

  ui.setModuleVisible(false);
  assert.equal(elements.receiptWorkspaceSwitcher.hidden, true);
  assert.equal(elements.receiptStatusControl.hidden, true);
  assert.equal(elements.encodingWorkspace.hidden, true);
  assert.equal(elements.optimizationWorkspace.hidden, true);

  ui.setModuleVisible(true);
  assert.equal(elements.receiptWorkspaceSwitcher.hidden, false);
  assert.equal(elements.receiptStatusControl.hidden, false);

  ui.setWorkspace('optimization');
  assert.equal(elements.encodingWorkspace.hidden, true);
  assert.equal(elements.optimizationWorkspace.hidden, false);

  ui.setWorkspace('encoding');
  assert.equal(elements.encodingWorkspace.hidden, false);
  assert.equal(elements.optimizationWorkspace.hidden, true);
});

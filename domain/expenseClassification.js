// Expense Account and Classification of Expense (Issue #50, requirements 4-6). Pure helpers: no DOM, storage or network access.
// Both fields are optional while a receipt is being saved and REQUIRED before a new export. A stored value is never silently defaulted or rewritten.

export const expenseAccountOptions = Object.freeze(['Day to day', 'Project Expense']);

// The 39 source values from the Product Owner's workbook (Sheet1!B3:B21 and C3:C22), in source order. The spelling "Accomodation" is the source's and is preserved on purpose.
export const classificationOptions = Object.freeze([
  'Accomodation', 'Building Maintenance and Repairs', 'Bank Fees', 'Cost of Goods', 'Equipment', 'Gasoline', 'Marketing', 'Meals', 'Office Supplies', 'Others',
  'Parking', 'Postage and Shipping', 'Professional Fee', 'Representation', 'Taxes and Registration', 'Toll Fee', 'Transportation', 'Utilities', 'Vehicle Maintenance',
  'Advertisement', 'Car Insurance', 'Car Registration', 'Delivery Fee', 'Electricity', 'Freight Cost', 'Gifts for Customer', 'Grocery', 'Hotel', 'Internet',
  'Meals w/ Customer', 'Notary Fee', 'Packaging', 'Permits', 'Phone', 'Sponsorship', 'Staffhouse', 'Stationeries', 'Trade Show Fees', 'Water'
]);

export const expenseFieldLabels = Object.freeze({ expenseAccount: 'Expense Account', classification: 'Classification of Expense' });

const text = value => String(value ?? '').trim();
const key = value => text(value).toLowerCase();

// Exact (case-sensitive) membership: only a value that is literally one of the options is a valid stored choice.
export const isExpenseAccount = value => expenseAccountOptions.includes(value);
export const isClassification = value => classificationOptions.includes(value);

// Maps what the user typed to an option when it names exactly one (case-insensitive, trimmed); otherwise ''. Never invents a value.
export function resolveOption(options, typed) {
  const wanted = key(typed);
  if (!wanted) return '';
  return options.find(option => key(option) === wanted) ?? '';
}

// Keyboard-first autocomplete. Ranking: options that START with the query (D -> Day to day, P -> Project Expense), then options with a word starting with it,
// then options that merely contain it. Source order is kept inside each rank. A blank query lists every option.
export function filterOptions(options, query) {
  const wanted = key(query);
  if (!wanted) return [...options];
  const ranked = options.map((option, index) => {
    const lower = option.toLowerCase();
    const rank = lower.startsWith(wanted) ? 0 : lower.split(/[^a-z0-9]+/).some(word => word.startsWith(wanted)) ? 1 : lower.includes(wanted) ? 2 : -1;
    return { option, index, rank };
  }).filter(entry => entry.rank >= 0);
  return ranked.sort((first, second) => first.rank - second.rank || first.index - second.index).map(entry => entry.option);
}

// Which export-required expense fields of ONE receipt are not usable: blank, or a stored value that is not one of the fixed options.
export function missingExpenseFields(receipt) {
  const missing = [];
  if (!isExpenseAccount(receipt?.expenseAccount)) missing.push('expenseAccount');
  if (!isClassification(receipt?.classification)) missing.push('classification');
  return missing;
}

// Export preflight over the EXACT selection only. entries: [{ label, receipt }] in export order. Receipts outside the selection are never inspected.
// Returns [{ label, fields, fieldLabels }] for the receipts that block the export; an empty array means the expense fields are complete.
export function expenseExportProblems(entries) {
  return entries.flatMap(({ label, receipt }) => {
    const fields = missingExpenseFields(receipt);
    return fields.length ? [{ label, fields, fieldLabels: fields.map(field => expenseFieldLabels[field]) }] : [];
  });
}

const joinNames = names => names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

// One plain sentence per blocked receipt, naming the receipt and the missing fields, ending with the guarantee that nothing was exported or changed.
export function expenseProblemMessage(problems) {
  const lines = problems.map(problem => `${problem.label} needs ${joinNames(problem.fieldLabels)}.`);
  return `${lines.join(' ')} Choose the missing value${problems.some(problem => problem.fields.length > 1) || problems.length > 1 ? 's' : ''}, save, and export again. Nothing was exported and no receipt status was changed.`;
}

// Database <-> model helpers shared by both receipt tables: a blank is stored as NULL and never defaulted.
export const expenseFieldsToDatabase = receipt => ({ expense_account: text(receipt.expenseAccount) ? receipt.expenseAccount : null, classification_of_expense: text(receipt.classification) ? receipt.classification : null });
export const expenseFieldsFromDatabase = row => ({ expenseAccount: row.expense_account ?? '', classification: row.classification_of_expense ?? '' });

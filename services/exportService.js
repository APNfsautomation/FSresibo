import { utils, writeFileXLSX } from '../vendor/sheetjs/xlsx-0.20.3.mjs';
import { parseMoneyAmount } from '../domain/moneyAmount.js';
import { philippineDateStamp } from '../domain/exportDate.js';

export const expenseDetailedReportHeaders = Object.freeze([
  'Item No.', 'Receipt Date', 'Supplier Details: Name', 'Supplier Details: Address', 'VAT Status / Indicator',
  'TIN Number', 'Invoice No.', 'Amount', 'Expense Account', 'Classification of Expense',
  'Additional Classification', 'Customer Name', 'Customer PO#', 'Notes for Accounting', 'Item Description (FOR COGS)'
]);
const expenseDetailedReportHeaderRows = Object.freeze([
  ['Item No.', 'Receipt Date', 'Supplier Details', '', 'VAT Status / Indicator', 'TIN Number', 'Invoice No.', 'Amount', 'Expense Account', 'Classification of Expense', 'Additional Classification', 'Customer Name', 'Customer PO#', 'Notes for Accounting', 'Item Description (FOR COGS)'],
  ['', '', 'Name', 'Address', '', '', '', '', '', '', '', '', '', '', '']
]);
const expenseDetailedReportHeaderMerges = Object.freeze([
  'A1:A2', 'B1:B2', 'C1:D1', 'E1:E2', 'F1:F2', 'G1:G2', 'H1:H2', 'I1:I2', 'J1:J2', 'K1:K2', 'L1:L2', 'M1:M2', 'N1:N2', 'O1:O2'
]);

const spreadsheetDate = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : '';
};

export const amountCellFormat = '#,##0.00';

// Amount cell value from the strict CP10-C0 parser: missing (null, undefined, blank or whitespace) = no cell at all (null); an explicit 0 or "0" = numeric zero;
// a valid amount = its exact numeric value. A non-blank amount that cannot be parsed is rejected, never exported as an empty cell or a guessed number.
// (Callers validate amounts before exporting; this is the defensive last check, so no misleading accounting report is produced.)
export const numericAmount = value => {
  const parsed = parseMoneyAmount(value);
  if (parsed.blank) return null;
  if (!parsed.valid) throw new Error(`Cannot export receipt amount: ${parsed.message}`);
  return parsed.amount;
};

export const buildExpenseDetailedReportRows = receipts => [
  ...expenseDetailedReportHeaderRows,
  ...receipts.map((receipt, index) => [
    index + 1, spreadsheetDate(receipt.receiptDate), receipt.store || '', receipt.address || '', receipt.vat || '', receipt.tin || '', receipt.invoice || '', numericAmount(receipt.amount),
    '', '', '', '', '', '', ''
  ])
];

export function createExpenseDetailedReportWorkbook(receipts, xlsx = { utils }) {
  const worksheet = xlsx.utils.aoa_to_sheet(buildExpenseDetailedReportRows(receipts), { cellDates: true });
  receipts.forEach((receipt, index) => {
    const cell = worksheet[`B${index + 3}`];
    if (cell?.v instanceof Date) cell.z = 'd-mmm';
    const amount = worksheet[`H${index + 3}`];
    if (amount?.t === 'n') amount.z = amountCellFormat;
  });
  worksheet['!merges'] = expenseDetailedReportHeaderMerges.map(range => xlsx.utils.decode_range(range));
  worksheet['!cols'] = [
    { wch: 10 }, { wch: 13 }, { wch: 30 }, { wch: 42 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 14 },
    { wch: 20 }, { wch: 26 }, { wch: 26 }, { wch: 24 }, { wch: 18 }, { wch: 28 }, { wch: 30 }
  ];
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Selected Receipts');
  return workbook;
}

export function downloadExpenseDetailedReport(receipts, filename) {
  const workbook = createExpenseDetailedReportWorkbook(receipts);
  writeFileXLSX(workbook, filename, { compression: true });
}

export const createSelectedReceiptsWorkbook = createExpenseDetailedReportWorkbook;
export function downloadSelectedReceipts(receipts, filename = `fsresibo-selected-receipts-${philippineDateStamp()}.xlsx`) {
  downloadExpenseDetailedReport(receipts, filename);
}

import { utils, writeFileXLSX } from '../vendor/sheetjs/xlsx-0.20.3.mjs';

export const expenseDetailedReportHeaders = Object.freeze([
  'Item No.', 'Receipt Date', 'Supplier Details: Name', 'Supplier Details: Address', 'VAT Status / Indicator',
  'TIN Number', 'Invoice No.', 'Amount', 'Expense Account', 'Classification of Expense',
  'Additional Classification', 'Customer Name', 'Customer PO#', 'Notes for Accounting', 'Item Description (FOR COGS)'
]);

const spreadsheetDate = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : '';
};

const numericAmount = value => {
  const amount = Number(String(value || '').trim());
  return Number.isFinite(amount) ? amount : '';
};

export const buildExpenseDetailedReportRows = receipts => [
  expenseDetailedReportHeaders,
  ...receipts.map((receipt, index) => [
    index + 1, spreadsheetDate(receipt.receiptDate), receipt.store || '', receipt.address || '', receipt.vat || '', receipt.tin || '', receipt.invoice || '', numericAmount(receipt.amount),
    '', '', '', '', '', '', ''
  ])
];

export function createSelectedReceiptsWorkbook(receipts, xlsx = { utils }) {
  const worksheet = xlsx.utils.aoa_to_sheet(buildExpenseDetailedReportRows(receipts), { cellDates: true });
  receipts.forEach((receipt, index) => {
    const cell = worksheet[`B${index + 2}`];
    if (cell?.v instanceof Date) cell.z = 'd-mmm';
  });
  worksheet['!cols'] = [
    { wch: 10 }, { wch: 13 }, { wch: 30 }, { wch: 42 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 14 },
    { wch: 20 }, { wch: 26 }, { wch: 26 }, { wch: 24 }, { wch: 18 }, { wch: 28 }, { wch: 30 }
  ];
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Selected Receipts');
  return workbook;
}

export function downloadSelectedReceipts(receipts, filename = `fsresibo-selected-receipts-${new Date().toISOString().slice(0, 10)}.xlsx`) {
  const workbook = createSelectedReceiptsWorkbook(receipts);
  writeFileXLSX(workbook, filename, { compression: true });
}

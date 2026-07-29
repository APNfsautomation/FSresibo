function textLines(text) { return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean); }

export function printedReceiptDetails(text) {
  const lines = textLines(text);
  const tin = text.match(/(?:VAT\s*(?:REG\.?\s*)?)?TIN\s*[:#]?\s*([0-9]{3}[\s-]*[0-9]{3}[\s-]*[0-9]{3}[\s-]*[0-9]{3,5})/i)?.[1]?.replace(/\s+/g, '') || '';
  const invoice = text.match(/(?:sales\s+invoice|official\s+receipt|invoice|receipt|OR)\s*(?:no\.?|#)?\s*[:#-]?\s*([A-Z0-9-]{3,})/i)?.[1] || '';
  const vat = /non[-\s]?vat|vat[-\s]?exempt/i.test(text) ? 'Non-VAT' : /vat\s*(?:reg|inclusive|amount|sales)/i.test(text) ? 'VAT' : '';
  const ignored = /(?:tin|vat|invoice|receipt|date|address|tel|phone|no\.|#)/i;
  const storeIndex = lines.findIndex(line => /[A-Za-z]{4,}/.test(line) && !ignored.test(line));
  const store = storeIndex >= 0 ? lines[storeIndex] : '';
  const addressLines = lines.slice(storeIndex + 1, storeIndex + 4).filter(line => /(?:street|st\.?|road|rd\.?|ave\.?|barangay|brgy|city|manila|cavite|building|mall|philippines)/i.test(line));
  return { store, address: addressLines.join(', '), tin, invoice, vat };
}

export async function scanPrintedDetails(file, row, refreshSummary) {
  const status = row.querySelector('.ocr-status'); status.className = 'ocr-status';
  if (!window.Tesseract) { status.textContent = 'Free OCR could not load. Check your internet connection.'; status.classList.add('warning'); return; }
  status.textContent = 'Reading printed receipt details…';
  try {
    const result = await Tesseract.recognize(file, 'eng');
    const details = printedReceiptDetails(result.data.text);
    row.querySelector('.receipt-store').value = details.store || row.querySelector('.receipt-store').value;
    row.querySelector('.receipt-address').value = details.address || row.querySelector('.receipt-address').value;
    row.querySelector('.receipt-tin').value = details.tin || row.querySelector('.receipt-tin').value;
    row.querySelector('.receipt-invoice').value = details.invoice || row.querySelector('.receipt-invoice').value;
    if (details.vat) row.querySelector('.receipt-vat').value = details.vat;
    refreshSummary(row); status.textContent = 'Printed details scanned — please review and correct if needed.'; status.classList.add('success');
  } catch { status.textContent = 'Could not read printed details. Please enter them manually.'; status.classList.add('warning'); }
}

const list = document.querySelector('#receiptList');
const template = document.querySelector('#receiptTemplate');
const target = document.querySelector('#targetAmount');
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const draftKey = 'receipt-match-draft-v2';

function toCents(value) { const number = Number(String(value).replace(/[^0-9.]/g, '')); return Number.isFinite(number) ? Math.round(number * 100) : 0; }
function format(cents) { return money.format(cents / 100); }
function textLines(text) { return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean); }

function printedReceiptDetails(text) {
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

async function scanPrintedDetails(file, row) {
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

function addReceipt(values = {}) {
  const row = template.content.firstElementChild.cloneNode(true);
  for (const [key, value] of Object.entries(values)) { const field = row.querySelector(`.receipt-${key}`); if (field) field.value = value; }
  row.querySelector('.receipt-photo').addEventListener('change', event => { const file = event.currentTarget.files[0]; if (file) scanPrintedDetails(file, row); });
  row.querySelector('.remove').addEventListener('click', () => { row.remove(); refreshReceiptIds(); });
  row.querySelectorAll('input, select').forEach(field => {
    field.addEventListener('input', () => refreshSummary(row));
    field.addEventListener('change', () => refreshSummary(row));
  });
  row.addEventListener('toggle', () => refreshToggle(row));
  list.append(row); refreshReceiptIds();
}
function refreshSummary(row) {
  const id = row.dataset.receiptId || '1';
  const store = row.querySelector('.receipt-store').value.trim() || 'Store not set';
  const amount = toCents(row.querySelector('.receipt-amount').value);
  row.querySelector('.summary-id').textContent = `Receipt ${id}`;
  row.querySelector('.summary-store').textContent = store;
  row.querySelector('.summary-amount').textContent = format(amount);
}
function refreshToggle(row) { row.querySelector('.toggle-label').textContent = row.open ? 'Close' : 'Details'; }
function refreshReceiptIds() {
  [...list.children].forEach((row, index) => { row.dataset.receiptId = index + 1; refreshSummary(row); });
  document.querySelector('#receiptCount').textContent = list.children.length ? `${list.children.length} receipt${list.children.length === 1 ? '' : 's'}` : 'No receipts added';
}
function rowValues(row) { return Object.fromEntries(['amount','vat','invoice','store','address','tin'].map(key => [key, row.querySelector(`.receipt-${key}`).value])); }
function saveDraft() { localStorage.setItem(draftKey, JSON.stringify({ target: target.value, receipts: [...list.children].map(rowValues) })); alert('Saved on this device and browser.'); }
function loadDraft() { const draft = localStorage.getItem(draftKey); if (!draft) return alert('No saved draft was found on this device.'); try { const data = JSON.parse(draft); target.value = data.target || ''; list.innerHTML = ''; (data.receipts || []).forEach(addReceipt); showEmpty(); } catch { alert('The saved draft could not be loaded.'); } }
function better(candidate, best, targetCents) { if (!best) return true; const gap = Math.abs(candidate.total-targetCents), bestGap = Math.abs(best.total-targetCents); return gap < bestGap || (gap === bestGap && candidate.total > best.total) || (gap === bestGap && candidate.total === best.total && candidate.items.length < best.items.length); }
function findBest(receipts, targetCents) {
  if (receipts.length > 32) throw new Error('Please calculate up to 32 receipts at a time.');
  const split = Math.ceil(receipts.length / 2);
  const makeSums = (entries, offset) => {
    let sums = [{ total: 0, items: [] }];
    entries.forEach((entry, index) => { sums = sums.concat(sums.map(sum => ({ total: sum.total + entry.cents, items: sum.items.concat(offset + index) }))); });
    return sums;
  };
  const left = makeSums(receipts.slice(0, split), 0);
  const right = makeSums(receipts.slice(split), split).sort((a, b) => a.total - b.total);
  let best = null;
  for (const first of left) {
    const needed = targetCents - first.total;
    let low = 0, high = right.length;
    while (low < high) { const middle = (low + high) >> 1; if (right[middle].total < needed) low = middle + 1; else high = middle; }
    for (const index of [low - 1, low]) if (right[index]) {
      const second = right[index];
      const candidate = { total: first.total + second.total, items: first.items.concat(second.items) };
      if (candidate.items.length && better(candidate, best, targetCents)) best = candidate;
    }
  }
  return best;
}
function showEmpty() { document.querySelector('#resultTitle').textContent='Add receipts to begin'; document.querySelector('#resultAmount').textContent='₱0.00'; document.querySelector('#difference').textContent='Enter a target and receipt amounts.'; document.querySelector('#keptReceipts').innerHTML=''; }
function calculate() { const targetCents=toCents(target.value); const receipts=[...list.children].map(row=>({ label:`Receipt ${row.dataset.receiptId}`, cents:toCents(row.querySelector('.receipt-amount').value) })).filter(r=>r.cents>0); if(!targetCents||!receipts.length)return showEmpty(); try { const best=findBest(receipts,targetCents), chosen=best.items.map(i=>receipts[i]), difference=best.total-targetCents; document.querySelector('#resultTitle').textContent=difference===0?'Exact match found':'Best available match'; document.querySelector('#resultAmount').textContent=format(best.total); document.querySelector('#difference').textContent=difference===0?'This selection matches your requested amount exactly.':`${difference>0?'Over':'Under'} by ${format(Math.abs(difference))}.`; document.querySelector('#keptReceipts').innerHTML=chosen.map(r=>`<span class="chip">${r.label} · ${format(r.cents)}</span>`).join(''); document.querySelector('#adminContent').innerHTML=`<p><strong>Selection:</strong> ${chosen.map(r=>r.label).join(' + ')} = <strong>${format(best.total)}</strong></p><ul><li>Target: ${format(targetCents)}</li><li>Difference: ${difference===0?'Exact':format(Math.abs(difference))+(difference>0?' over':' under')}</li><li>Rule: closest total, then larger total, then fewer receipts.</li></ul>`; } catch(error) { alert(error.message); } }
document.querySelector('#addReceipt').addEventListener('click',()=>addReceipt()); document.querySelector('#calculate').addEventListener('click',calculate); document.querySelector('#saveDraft').addEventListener('click',saveDraft); document.querySelector('#loadDraft').addEventListener('click',loadDraft); document.querySelector('#clearAll').addEventListener('click',()=>{ target.value=''; list.innerHTML=''; refreshReceiptIds(); showEmpty(); }); refreshReceiptIds(); showEmpty();

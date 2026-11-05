import { getSupabaseClient } from '../config/supabase.js';
import { normalizeMoneyAmount } from '../domain/moneyAmount.js';
import { expenseFieldsFromDatabase, expenseFieldsToDatabase, isClassification, isExpenseAccount } from '../domain/expenseClassification.js';

export const monthlyFilingTable = 'monthly_filing_receipts';
export function toDatabaseMonthlyFilingReceipt(receipt, userId) {
  return { user_id: userId, shared_store_id: receipt.sharedStoreId || null, store_name: receipt.store || '', address: receipt.address || null, tin: receipt.tin || null, vat_status: receipt.vat || null, amount: normalizeMoneyAmount(receipt.amount), receipt_date: receipt.receiptDate || null, invoice_number: receipt.invoice || null, ...expenseFieldsToDatabase(receipt), status: 'active' };
}
export function fromDatabaseMonthlyFilingReceipt(receipt) {
  return { dbId: receipt.id, sharedStoreId: receipt.shared_store_id ?? '', store: receipt.store_name ?? '', address: receipt.address ?? '', tin: receipt.tin ?? '', vat: receipt.vat_status ?? '', amount: receipt.amount ?? '', receiptDate: receipt.receipt_date ?? '', invoice: receipt.invoice_number ?? '', ...expenseFieldsFromDatabase(receipt), status: receipt.status === 'archived' ? 'archived' : 'active', archivedAt: receipt.archived_at ?? '', updatedAt: receipt.updated_at ?? '' };
}
async function clientOrThrow() { const client = await getSupabaseClient(); if (!client) throw new Error('Supabase is not configured yet.'); return client; }
export async function loadMonthlyFilingReceipts() { const client = await clientOrThrow(); const { data, error } = await client.from(monthlyFilingTable).select('*').order('created_at', { ascending: true }).order('id', { ascending: true }); if (error) throw error; return data.map(fromDatabaseMonthlyFilingReceipt); }
export async function createMonthlyFilingReceipt(receipt, userId) { const client = await clientOrThrow(); const { data, error } = await client.from(monthlyFilingTable).insert(toDatabaseMonthlyFilingReceipt(receipt, userId)).select().single(); if (error) throw error; return fromDatabaseMonthlyFilingReceipt(data); }
export async function updateMonthlyFilingReceipt(id, receipt, userId) { const client = await clientOrThrow(); const { user_id, status, ...changes } = toDatabaseMonthlyFilingReceipt(receipt, userId); const { data, error } = await client.from(monthlyFilingTable).update(changes).eq('id', id).eq('status', 'active').select().single(); if (error) throw error; return fromDatabaseMonthlyFilingReceipt(data); }
// Monthly Review & Arrange (Issue #58): read exactly these receipts back, whatever their status (a receipt archived or deleted elsewhere shows as archived or is absent).
export async function loadMonthlyFilingReceiptsByIds(ids) {
  const exactIds = [...new Set((ids || []).filter(Boolean))];
  if (!exactIds.length) return [];
  const client = await clientOrThrow();
  const { data, error } = await client.from(monthlyFilingTable).select('*').in('id', exactIds);
  if (error) throw error;
  return data.map(fromDatabaseMonthlyFilingReceipt);
}
// Writes ONLY the two expense columns of ONE receipt, and only while it is still Active with the `updated_at` the caller last saw. Anything else matches no row and is
// reported as a conflict; another session's change is never overwritten. Row-level security still limits the write to the signed-in user's own receipts.
export async function updateMonthlyFilingExpenseFields(id, { expenseAccount, classification }, expectedUpdatedAt) {
  if (!id || !expectedUpdatedAt) throw new Error('A saved receipt and its last known update time are required.');
  if (!isExpenseAccount(expenseAccount) || !isClassification(classification)) throw new Error('Choose an approved Expense Account and Classification of Expense.');
  const client = await clientOrThrow();
  const { data, error } = await client.from(monthlyFilingTable).update(expenseFieldsToDatabase({ expenseAccount, classification })).eq('id', id).eq('status', 'active').eq('updated_at', expectedUpdatedAt).select();
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== 1 || data[0]?.id !== id) { const conflict = new Error('The receipt was changed, archived or deleted in another session, so its details were not saved.'); conflict.code = 'RECEIPT_CONFLICT'; throw conflict; }
  return fromDatabaseMonthlyFilingReceipt(data[0]);
}
export async function associateMonthlyFilingSharedStore(id, sharedStoreId) { const client = await clientOrThrow(); const { data, error } = await client.from(monthlyFilingTable).update({ shared_store_id: sharedStoreId || null }).eq('id', id).eq('status', 'active').select().single(); if (error) throw error; return fromDatabaseMonthlyFilingReceipt(data); }
export async function deleteMonthlyFilingReceipt(id) { const client = await clientOrThrow(); const { error } = await client.from(monthlyFilingTable).delete().eq('id', id).eq('status', 'active'); if (error) throw error; }
export function validateArchivedMonthlyFilingReceiptSet(ids, archivedRecords) {
  const expected = new Set(ids);
  const received = new Set(archivedRecords.map(record => record.dbId));
  if (archivedRecords.length !== expected.size || received.size !== expected.size || [...expected].some(id => !received.has(id)) || archivedRecords.some(record => record.status !== 'archived')) throw new Error('Monthly Filing archive integrity check failed.');
  return archivedRecords;
}
export async function archiveMonthlyFilingReceipts(ids) {
  const exactIds = [...new Set(ids.filter(Boolean))];
  if (!exactIds.length) throw new Error('No Active Monthly Filing receipts were supplied for archiving.');
  const client = await clientOrThrow();
  const { data, error } = await client.rpc('archive_monthly_filing_receipts', { p_ids: exactIds });
  if (error) throw error;
  return validateArchivedMonthlyFilingReceiptSet(exactIds, (data || []).map(fromDatabaseMonthlyFilingReceipt));
}
export async function returnMonthlyFilingReceiptToActive(id) {
  const client = await clientOrThrow();
  const { data, error } = await client.from(monthlyFilingTable).update({ status: 'active', archived_at: null }).eq('id', id).eq('status', 'archived').select().single();
  if (error) throw error;
  return fromDatabaseMonthlyFilingReceipt(data);
}
export async function clearMonthlyFilingReceipts(userId) {
  const client = await clientOrThrow();
  const { error } = await client.from(monthlyFilingTable).delete().eq('user_id', userId);
  if (error) throw error;
}
export async function clearArchivedMonthlyFilingReceipts(userId, ids = []) {
  const exactIds = [...new Set(ids.filter(Boolean))];
  if (!exactIds.length) return [];
  const client = await clientOrThrow();
  const { data, error } = await client.from(monthlyFilingTable).delete().in('id', exactIds).eq('user_id', userId).eq('status', 'archived').select('id');
  if (error) throw error;
  return (data || []).map(row => row.id);
}

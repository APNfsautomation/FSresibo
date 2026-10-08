import { getSupabaseClient } from '../config/supabase.js';

export const monthlyFilingTable = 'monthly_filing_receipts';
export function toDatabaseMonthlyFilingReceipt(receipt, userId) {
  const amount = String(receipt.amount ?? '').trim();
  const numeric = Number(amount);
  return { user_id: userId, shared_store_id: receipt.sharedStoreId || null, store_name: receipt.store || '', address: receipt.address || null, tin: receipt.tin || null, vat_status: receipt.vat || null, amount: amount && Number.isFinite(numeric) ? numeric : null, receipt_date: receipt.receiptDate || null, invoice_number: receipt.invoice || null, status: 'active' };
}
export function fromDatabaseMonthlyFilingReceipt(receipt) {
  return { dbId: receipt.id, sharedStoreId: receipt.shared_store_id ?? '', store: receipt.store_name ?? '', address: receipt.address ?? '', tin: receipt.tin ?? '', vat: receipt.vat_status ?? '', amount: receipt.amount ?? '', receiptDate: receipt.receipt_date ?? '', invoice: receipt.invoice_number ?? '', status: receipt.status === 'archived' ? 'archived' : 'active', archivedAt: receipt.archived_at ?? '', updatedAt: receipt.updated_at ?? '' };
}
async function clientOrThrow() { const client = await getSupabaseClient(); if (!client) throw new Error('Supabase is not configured yet.'); return client; }
export async function loadMonthlyFilingReceipts() { const client = await clientOrThrow(); const { data, error } = await client.from(monthlyFilingTable).select('*').order('created_at', { ascending: true }); if (error) throw error; return data.map(fromDatabaseMonthlyFilingReceipt); }
export async function createMonthlyFilingReceipt(receipt, userId) { const client = await clientOrThrow(); const { data, error } = await client.from(monthlyFilingTable).insert(toDatabaseMonthlyFilingReceipt(receipt, userId)).select().single(); if (error) throw error; return fromDatabaseMonthlyFilingReceipt(data); }
export async function updateMonthlyFilingReceipt(id, receipt, userId) { const client = await clientOrThrow(); const { user_id, status, ...changes } = toDatabaseMonthlyFilingReceipt(receipt, userId); const { data, error } = await client.from(monthlyFilingTable).update(changes).eq('id', id).eq('status', 'active').select().single(); if (error) throw error; return fromDatabaseMonthlyFilingReceipt(data); }
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

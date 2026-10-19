import { getSupabaseClient } from '../config/supabase.js';
import { normalizeMoneyAmount } from '../domain/moneyAmount.js';

export function toDatabaseReceipt(receipt, userId) {
  // A blank amount is stored as NULL; a malformed non-blank amount is rejected here, never turned into NULL.
  return {
    user_id: userId,
    store_name: receipt.store || '',
    amount: normalizeMoneyAmount(receipt.amount),
    receipt_date: receipt.receiptDate || null,
    address: receipt.address || null,
    tin: receipt.tin || null,
    vat_status: receipt.vat || null,
    invoice_number: receipt.invoice || null
  };
}

// The status is passed through exactly as the database holds it: Available and Consumed are the only lifecycle states the app acts on, and anything else
// (an unexpected, empty or missing value) must stay recognisable as "not Available" so it can never be selected or exported. The UI normalizes it for display only.
export function fromDatabaseReceipt(receipt) {
  return {
    dbId: receipt.id,
    amount: receipt.amount ?? '',
    receiptDate: receipt.receipt_date ?? '',
    vat: receipt.vat_status ?? '',
    invoice: receipt.invoice_number ?? '',
    store: receipt.store_name ?? '',
    address: receipt.address ?? '',
    tin: receipt.tin ?? '',
    updatedAt: receipt.updated_at ?? '',
    status: receipt.status ?? ''
  };
}

async function clientOrThrow() {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Supabase is not configured yet.');
  return client;
}

export async function loadReceipts() {
  const client = await clientOrThrow();
  const { data, error } = await client.from('receipts').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data.map(fromDatabaseReceipt);
}

// Read-only snapshot of specific receipts for export. Row-level security still limits the read to the signed-in user's own receipts;
// an id that is not returned is missing (deleted, or never visible to this user).
export async function loadReceiptsByIds(ids) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (!uniqueIds.length) return [];
  const client = await clientOrThrow();
  const { data, error } = await client.from('receipts').select('*').in('id', uniqueIds);
  if (error) throw error;
  return data.map(fromDatabaseReceipt);
}

export async function createReceipt(receipt, userId) {
  const client = await clientOrThrow();
  const { data, error } = await client.from('receipts').insert(toDatabaseReceipt(receipt, userId)).select().single();
  if (error) throw error;
  return fromDatabaseReceipt(data);
}

export async function updateReceipt(id, receipt, userId) {
  const client = await clientOrThrow();
  const { user_id, ...changes } = toDatabaseReceipt(receipt, userId);
  const { data, error } = await client.from('receipts').update(changes).eq('id', id).select().single();
  if (error) throw error;
  return fromDatabaseReceipt(data);
}

export async function deleteReceipt(id) {
  const client = await clientOrThrow();
  const { error } = await client.from('receipts').delete().eq('id', id);
  if (error) throw error;
}

// Permanently deletes ONE receipt, and only while its status in the database is still 'consumed'.
// Row-level security already limits deletes to the caller's own rows; the status condition is added here so a receipt that another session
// has meanwhile restored to Available is never deleted. The call succeeds only if the database confirms exactly one deleted row.
export async function deleteConsumedReceipt(id) {
  if (!id) throw new Error('A saved receipt is required.');
  const client = await clientOrThrow();
  const { data, error } = await client.from('receipts').delete().eq('id', id).eq('status', 'consumed').select('id');
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== 1 || data[0]?.id !== id) throw new Error('The receipt is no longer Consumed (or no longer exists), so it was not deleted. Refresh to see its current status.');
}

export async function updateReceiptStatus(id, status) {
  if (!['available', 'consumed'].includes(status)) throw new Error('Unsupported receipt status.');
  const client = await clientOrThrow();
  const { data, error } = await client.from('receipts').update({ status }).eq('id', id).select().single();
  if (error) throw error;
  return fromDatabaseReceipt(data);
}

export async function consumeReceipts(ids) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (!uniqueIds.length) return [];
  const client = await clientOrThrow();
  const { data, error } = await client.from('receipts').update({ status: 'consumed' }).in('id', uniqueIds).eq('status', 'available').select();
  if (error) throw error;
  if (data.length !== uniqueIds.length) throw new Error('One or more selected receipts are no longer available. Refresh and review the result before exporting again.');
  return data.map(fromDatabaseReceipt);
}

export async function importReceipts(receipts, userId) {
  if (!receipts.length) return [];
  const client = await clientOrThrow();
  const rows = receipts.map((receipt, index) => { try { return toDatabaseReceipt(receipt, userId); } catch (error) { throw new Error(`Browser draft receipt ${index + 1}: ${error.message}`); } });
  const { data, error } = await client.from('receipts').insert(rows).select();
  if (error) throw error;
  return data.map(fromDatabaseReceipt);
}

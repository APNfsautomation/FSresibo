import { getSupabaseClient } from '../config/supabase.js';

function toDatabaseReceipt(receipt, userId) {
  const amount = String(receipt.amount ?? '').trim();
  const numericAmount = Number(amount);
  return {
    user_id: userId,
    store_name: receipt.store || '',
    amount: amount && Number.isFinite(numericAmount) ? numericAmount : null,
    receipt_date: receipt.receiptDate || null,
    address: receipt.address || null,
    tin: receipt.tin || null,
    vat_status: receipt.vat || null,
    invoice_number: receipt.invoice || null
  };
}

function fromDatabaseReceipt(receipt) {
  return {
    dbId: receipt.id,
    amount: receipt.amount ?? '',
    receiptDate: receipt.receipt_date ?? '',
    vat: receipt.vat_status ?? '',
    invoice: receipt.invoice_number ?? '',
    store: receipt.store_name ?? '',
    address: receipt.address ?? '',
    tin: receipt.tin ?? '',
    updatedAt: receipt.updated_at ?? ''
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

export async function importReceipts(receipts, userId) {
  if (!receipts.length) return [];
  const client = await clientOrThrow();
  const { data, error } = await client.from('receipts').insert(receipts.map(receipt => toDatabaseReceipt(receipt, userId))).select();
  if (error) throw error;
  return data.map(fromDatabaseReceipt);
}

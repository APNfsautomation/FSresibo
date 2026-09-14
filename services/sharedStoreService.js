import { getSupabaseClient } from '../config/supabase.js';

const sharedStoreColumns = 'id, store_name, address, tin, vat_status, active, created_by, created_at, updated_at';

export class SharedStoreDuplicateError extends Error {
  constructor(cause) {
    super('An equivalent shared store profile already exists.');
    this.name = 'SharedStoreDuplicateError';
    this.cause = cause;
  }
}

export const isSharedStoreDuplicateError = error => error?.code === '23505';

export function toDatabaseSharedStore(profile, userId) {
  return {
    store_name: String(profile.storeName ?? '').trim(),
    address: String(profile.address ?? '').trim() || null,
    tin: String(profile.tin ?? '').trim() || null,
    vat_status: String(profile.vat ?? '').trim() || null,
    active: true,
    created_by: userId
  };
}

export function fromDatabaseSharedStore(profile) {
  return {
    id: profile.id,
    storeName: profile.store_name ?? '',
    address: profile.address ?? '',
    tin: profile.tin ?? '',
    vat: profile.vat_status ?? '',
    active: profile.active === true,
    createdBy: profile.created_by ?? '',
    createdAt: profile.created_at ?? '',
    updatedAt: profile.updated_at ?? ''
  };
}

async function clientOrThrow() {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Supabase is not configured yet.');
  return client;
}

export function createSharedStoreActions(resolveClient) {
  return {
    async listActive() {
      const client = await resolveClient();
      const { data, error } = await client.from('shared_store_directory').select(sharedStoreColumns).eq('active', true).order('store_name', { ascending: true });
      if (error) throw error;
      return data.map(fromDatabaseSharedStore);
    },
    async contribute(profile, userId) {
      const client = await resolveClient();
      const { data, error } = await client.from('shared_store_directory').insert(toDatabaseSharedStore(profile, userId)).select(sharedStoreColumns).single();
      if (error) {
        if (isSharedStoreDuplicateError(error)) throw new SharedStoreDuplicateError(error);
        throw error;
      }
      return fromDatabaseSharedStore(data);
    }
  };
}

const actions = createSharedStoreActions(clientOrThrow);
export const listActiveSharedStores = actions.listActive;
export const contributeSharedStore = actions.contribute;

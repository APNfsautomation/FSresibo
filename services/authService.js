import { getSupabaseClient } from '../config/supabase.js';

async function clientOrThrow() {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Supabase is not configured yet.');
  return client;
}

export function authRedirectUrl(state, locationLike = globalThis.location) {
  const current = new URL(locationLike.href);
  const base = new URL('./', current.href);
  base.searchParams.set('auth', state);
  return base.toString();
}

export function createAuthActions(resolveClient) {
  return {
    async register(email, password, emailRedirectTo) {
      const client = await resolveClient();
      const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo } });
      if (error) throw error;
      return data;
    },
    async requestPasswordReset(email, redirectTo) {
      const client = await resolveClient();
      const { data, error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      return data;
    },
    async updatePassword(password) {
      const client = await resolveClient();
      const { data, error } = await client.auth.updateUser({ password });
      if (error) throw error;
      return data;
    }
  };
}

const actions = createAuthActions(clientOrThrow);
export const register = actions.register;
export const requestPasswordReset = actions.requestPasswordReset;
export const updatePassword = actions.updatePassword;

export async function login(email, password) {
  const client = await clientOrThrow();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function logout() {
  const client = await clientOrThrow();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function getCurrentSession() {
  const client = await clientOrThrow();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function onAuthStateChange(callback) {
  const client = await clientOrThrow();
  return client.auth.onAuthStateChange(callback);
}

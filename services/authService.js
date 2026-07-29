import { getSupabaseClient } from '../config/supabase.js';

async function clientOrThrow() {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Supabase is not configured yet.');
  return client;
}

export async function register(email, password) {
  const client = await clientOrThrow();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

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

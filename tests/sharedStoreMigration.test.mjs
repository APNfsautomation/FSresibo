import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/002_create_shared_store_directory.sql', import.meta.url);
const migration = await readFile(migrationUrl, 'utf8');

test('shared-store migration creates a normalized company reference table with quality and duplicate protections', () => {
  assert.match(migration, /create table public\.shared_store_directory/i);
  assert.match(migration, /store_name_key text generated always as/i);
  assert.match(migration, /address_key text generated always as/i);
  assert.match(migration, /tin_key text generated always as/i);
  assert.match(migration, /store_name_key is not null/i);
  assert.match(migration, /address_key is not null or tin_key is not null/i);
  assert.match(migration, /normalize_store_tin/i);
  assert.match(migration, /regexp_replace\(value, '\\\\D', '', 'g'\)/i);
  assert.match(migration, /shared_store_directory_exact_profile_key/i);
  assert.match(migration, /coalesce\(address_key, ''\), coalesce\(tin_key, ''\)/i);
});

test('shared-store migration enables restrictive RLS and grants only active reads plus owned active contributions', () => {
  assert.match(migration, /alter table public\.shared_store_directory enable row level security/i);
  assert.match(migration, /revoke all on table public\.shared_store_directory from anon, authenticated/i);
  assert.match(migration, /grant select, insert on table public\.shared_store_directory to authenticated/i);
  assert.match(migration, /for select to authenticated\s+using \(active is true\)/i);
  assert.match(migration, /for insert to authenticated\s+with check \(\(select auth\.uid\(\)\) = created_by and active is true\)/i);
  assert.doesNotMatch(migration, /grant[^;]*(update|delete)[^;]*shared_store_directory/i);
  assert.doesNotMatch(migration, /for (update|delete) to authenticated/i);
});

test('shared-store migration reuses the existing updated_at trigger and does not alter receipts', () => {
  assert.match(migration, /execute procedure public\.set_updated_at\(\)/i);
  assert.doesNotMatch(migration, /alter table public\.receipts/i);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = () => readFile(new URL('../supabase/migrations/004_add_monthly_filing_archive_function.sql', import.meta.url), 'utf8');
test('Monthly Filing archive RPC is exact-set, authenticated, and security-invoker', async () => {
  const sql = await migration();
  assert.match(sql, /create function public\.archive_monthly_filing_receipts\(p_ids uuid\[\]\)/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /set search_path = public, pg_temp/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /array_agg\(distinct id\)/i);
  assert.match(sql, /status = 'active'/i);
  assert.match(sql, /status = 'archived', archived_at = now\(\)/i);
  assert.match(sql, /revoke all on function .* from public, anon/i);
  assert.match(sql, /grant execute .* to authenticated/i);
  assert.doesNotMatch(sql, /security definer|public\.receipts/i);
});

test('Migration 004 does not alter the accepted Monthly Filing table migration', async () => {
  const original = await readFile(new URL('../supabase/migrations/003_create_monthly_filing_receipts.sql', import.meta.url), 'utf8');
  assert.match(original, /create table public\.monthly_filing_receipts/i);
  assert.match(original, /enable row level security/i);
});

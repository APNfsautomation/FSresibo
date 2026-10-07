create table public.monthly_filing_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shared_store_id uuid references public.shared_store_directory(id) on delete set null,
  store_name text not null default '',
  address text,
  tin text,
  vat_status text check (vat_status is null or vat_status in ('VAT', 'Non-VAT')),
  amount numeric check (amount is null or amount >= 0),
  receipt_date date,
  invoice_number text,
  status text not null default 'active' check (status in ('active', 'archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index monthly_filing_receipts_user_status_date_idx on public.monthly_filing_receipts (user_id, status, receipt_date);
create index monthly_filing_receipts_user_created_idx on public.monthly_filing_receipts (user_id, created_at);
create index monthly_filing_receipts_shared_store_idx on public.monthly_filing_receipts (shared_store_id);

create trigger monthly_filing_receipts_set_updated_at
before update on public.monthly_filing_receipts
for each row execute procedure public.set_updated_at();

alter table public.monthly_filing_receipts enable row level security;
revoke all on table public.monthly_filing_receipts from anon, authenticated;
grant select, insert, update, delete on table public.monthly_filing_receipts to authenticated;

create policy "Users can view own monthly filing receipts"
on public.monthly_filing_receipts for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create own monthly filing receipts"
on public.monthly_filing_receipts for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update own monthly filing receipts"
on public.monthly_filing_receipts for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete own monthly filing receipts"
on public.monthly_filing_receipts for delete to authenticated
using ((select auth.uid()) = user_id);

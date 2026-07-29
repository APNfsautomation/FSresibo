create extension if not exists pgcrypto;

create type public.receipt_status as enum ('available', 'consumed', 'archived');

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_name text not null default '',
  amount numeric(12,2),
  receipt_date date,
  status public.receipt_status not null default 'available',
  address text,
  tin text,
  vat_status text,
  invoice_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint receipts_amount_nonnegative check (amount is null or amount >= 0)
);

create index receipts_user_created_at_idx on public.receipts (user_id, created_at);
create index receipts_user_status_date_idx on public.receipts (user_id, status, receipt_date desc);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger receipts_set_updated_at
before update on public.receipts
for each row execute procedure public.set_updated_at();

alter table public.receipts enable row level security;

grant select, insert, update, delete on public.receipts to authenticated;

create policy "Users can view their own receipts"
on public.receipts for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own receipts"
on public.receipts for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own receipts"
on public.receipts for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own receipts"
on public.receipts for delete to authenticated
using ((select auth.uid()) = user_id);

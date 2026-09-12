create function public.normalize_store_text(value text)
returns text
language sql
immutable
strict
as $$
  select nullif(lower(regexp_replace(btrim(value), '\\s+', ' ', 'g')), '');
$$;

create function public.normalize_store_tin(value text)
returns text
language sql
immutable
strict
as $$
  select nullif(regexp_replace(value, '\\D', '', 'g'), '');
$$;

create table public.shared_store_directory (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  address text,
  tin text,
  vat_status text,
  store_name_key text generated always as (public.normalize_store_text(store_name)) stored,
  address_key text generated always as (public.normalize_store_text(address)) stored,
  tin_key text generated always as (public.normalize_store_tin(tin)) stored,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_store_directory_store_name_required check (store_name_key is not null),
  constraint shared_store_directory_identification_required check (address_key is not null or tin_key is not null),
  constraint shared_store_directory_vat_status_valid check (vat_status is null or vat_status in ('VAT', 'Non-VAT'))
);

create unique index shared_store_directory_exact_profile_key
on public.shared_store_directory (store_name_key, coalesce(address_key, ''), coalesce(tin_key, ''));

create index shared_store_directory_active_name_idx
on public.shared_store_directory (store_name_key)
where active;

create trigger shared_store_directory_set_updated_at
before update on public.shared_store_directory
for each row execute procedure public.set_updated_at();

alter table public.shared_store_directory enable row level security;

revoke all on table public.shared_store_directory from anon, authenticated;
grant select, insert on table public.shared_store_directory to authenticated;

create policy "Authenticated users can view active shared stores"
on public.shared_store_directory for select to authenticated
using (active is true);

create policy "Authenticated users can contribute active shared stores"
on public.shared_store_directory for insert to authenticated
with check ((select auth.uid()) = created_by and active is true);

-- FSResibo v3.7.0 (Issue #50): Expense Account and Classification of Expense.
-- ADDITIVE and NULLABLE only: no default, no backfill, no deletion, no status change. Existing rows keep NULL (shown as blank) and stay readable.
-- RLS policies, grants, triggers and the archive_monthly_filing_receipts() function are NOT touched; the existing per-user policies already cover the new columns.
-- Apply to the UAT Supabase project first. Production requires a separately approved change. Re-running is safe (IF NOT EXISTS).
--
-- expense_account has a database CHECK because its two values are fixed by the approved requirements.
-- classification_of_expense is validated by the app against the 39 approved values (domain/expenseClassification.js) and has NO database CHECK on purpose,
-- so the approved list can grow (the Product Owner keeps an external reference list) without another production migration.

alter table public.receipts
  add column if not exists expense_account text,
  add column if not exists classification_of_expense text;

alter table public.monthly_filing_receipts
  add column if not exists expense_account text,
  add column if not exists classification_of_expense text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'receipts_expense_account_check') then
    alter table public.receipts add constraint receipts_expense_account_check
      check (expense_account is null or expense_account in ('Day to day', 'Project Expense'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'monthly_filing_receipts_expense_account_check') then
    alter table public.monthly_filing_receipts add constraint monthly_filing_receipts_expense_account_check
      check (expense_account is null or expense_account in ('Day to day', 'Project Expense'));
  end if;
end
$$;

-- Rollback (UAT only; drops the two columns and any data in them):
--   alter table public.receipts drop constraint if exists receipts_expense_account_check, drop column if exists expense_account, drop column if exists classification_of_expense;
--   alter table public.monthly_filing_receipts drop constraint if exists monthly_filing_receipts_expense_account_check, drop column if exists expense_account, drop column if exists classification_of_expense;

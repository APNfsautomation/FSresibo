create function public.archive_monthly_filing_receipts(p_ids uuid[])
returns setof public.monthly_filing_receipts
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  requested_ids uuid[];
  requested_count integer;
  eligible_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  select array_agg(distinct id), count(distinct id)
  into requested_ids, requested_count
  from unnest(p_ids) as requested(id)
  where id is not null;
  if requested_count is null or requested_count = 0 then
    raise exception 'At least one Monthly Filing receipt is required';
  end if;
  select count(*) into eligible_count
  from public.monthly_filing_receipts
  where id = any(requested_ids)
    and user_id = auth.uid()
    and status = 'active';
  if eligible_count <> requested_count then
    raise exception 'Every requested Monthly Filing receipt must be owned and Active';
  end if;
  return query
  update public.monthly_filing_receipts
  set status = 'archived', archived_at = now()
  where id = any(requested_ids)
    and user_id = auth.uid()
    and status = 'active'
  returning *;
end;
$$;

revoke all on function public.archive_monthly_filing_receipts(uuid[]) from public, anon;
grant execute on function public.archive_monthly_filing_receipts(uuid[]) to authenticated;

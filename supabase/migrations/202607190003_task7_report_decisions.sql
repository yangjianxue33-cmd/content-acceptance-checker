create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

create function public.set_anonymous_review_decision(
  p_review_id uuid,
  p_access_token_hash text,
  p_decision public.user_decision
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.review_status;
  stored_hash text;
  expires_at timestamptz;
  recorded_at timestamptz;
begin
  select reviews.status, reviews.anonymous_access_token_hash, reviews.delete_at
  into current_status, stored_hash, expires_at
  from public.reviews
  where reviews.id = p_review_id
  for update;

  if not found
    or stored_hash is null
    or p_access_token_hash is null
    or stored_hash <> p_access_token_hash
    or expires_at <= now()
    or current_status not in ('completed', 'partial', 'failed')
  then
    raise exception 'review_access_denied' using errcode = 'P0001';
  end if;

  insert into public.review_decisions (review_id, decision)
  values (p_review_id, p_decision)
  on conflict (review_id) do update
  set decision = excluded.decision
  where review_decisions.decision is distinct from excluded.decision
  returning updated_at into recorded_at;

  if recorded_at is null then
    select review_decisions.updated_at
    into recorded_at
    from public.review_decisions
    where review_decisions.review_id = p_review_id;
  end if;

  return recorded_at;
end;
$$;

revoke all on function public.set_anonymous_review_decision(
  uuid, text, public.user_decision
) from public, anon, authenticated;

grant execute on function public.set_anonymous_review_decision(
  uuid, text, public.user_decision
) to service_role;

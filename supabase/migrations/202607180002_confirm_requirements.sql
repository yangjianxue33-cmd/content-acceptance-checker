create function public.replace_review_requirements(
  p_review_id uuid,
  p_requirements jsonb,
  p_confirm boolean
)
returns public.review_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplied_requirements jsonb := coalesce(p_requirements, '[]'::jsonb);
  current_status public.review_status;
  has_brief boolean;
begin
  select reviews.status, reviews.brief_present
  into current_status, has_brief
  from public.reviews
  where reviews.id = p_review_id
  for update;

  if not found then
    raise exception 'review not found' using errcode = 'P0002';
  end if;

  if p_confirm and current_status = 'queued' then
    return current_status;
  end if;

  if current_status <> 'awaiting_brief_confirmation' or not has_brief then
    raise exception 'review is not awaiting brief confirmation'
      using errcode = '23514';
  end if;

  if jsonb_typeof(supplied_requirements) <> 'array'
    or jsonb_array_length(supplied_requirements) > 30 then
    raise exception 'requirements must be an array with at most 30 entries'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(supplied_requirements) as supplied(item)
    where jsonb_typeof(item) is distinct from 'object'
      or (
        select array_agg(key order by key)
        from jsonb_object_keys(item) as keys(key)
      ) is distinct from array[
        'category', 'is_critical', 'requirement_text', 'source_excerpt'
      ]::text[]
      or jsonb_typeof(item -> 'category') is distinct from 'string'
      or length(trim(item ->> 'category')) not between 1 and 80
      or jsonb_typeof(item -> 'requirement_text') is distinct from 'string'
      or length(trim(item ->> 'requirement_text')) not between 1 and 1000
      or jsonb_typeof(item -> 'is_critical') is distinct from 'boolean'
      or jsonb_typeof(item -> 'source_excerpt') not in ('string', 'null')
      or (
        jsonb_typeof(item -> 'source_excerpt') = 'string'
        and length(trim(item ->> 'source_excerpt')) not between 1 and 500
      )
  ) then
    raise exception 'requirements payload is invalid' using errcode = '23514';
  end if;

  if not p_confirm and exists (
    select 1
    from public.requirements
    where requirements.review_id = p_review_id
      and requirements.user_confirmed
  ) then
    raise exception 'confirmed requirements cannot be replaced by a draft'
      using errcode = '23514';
  end if;

  if p_confirm then
    delete from public.requirements
    where requirements.review_id = p_review_id;
  else
    delete from public.requirements
    where requirements.review_id = p_review_id
      and not requirements.user_confirmed;
  end if;

  insert into public.requirements (
    review_id,
    category,
    source_excerpt,
    requirement_text,
    is_critical,
    user_confirmed
  )
  select
    p_review_id,
    trim(supplied.category),
    case when supplied.source_excerpt is null
      then null
      else trim(supplied.source_excerpt)
    end,
    trim(supplied.requirement_text),
    supplied.is_critical,
    p_confirm
  from jsonb_to_recordset(supplied_requirements) as supplied(
    category text,
    requirement_text text,
    is_critical boolean,
    source_excerpt text
  );

  if p_confirm then
    update public.reviews
    set status = 'queued'
    where reviews.id = p_review_id;
    current_status := 'queued';
  end if;

  return current_status;
end;
$$;

revoke all on function public.replace_review_requirements(uuid, jsonb, boolean)
from public, anon, authenticated;

grant execute on function public.replace_review_requirements(uuid, jsonb, boolean)
to service_role;

create table public.citation_checks (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  module public.analysis_module not null default 'evidence_citations',
  normalized_url text,
  status_code integer check (status_code is null or status_code between 100 and 599),
  result_category text not null check (
    result_category in ('reachable', 'http_error', 'unsafe', 'unavailable')
  ),
  reason_code text check (reason_code is null or reason_code ~ '^[a-z_]{1,40}$'),
  created_at timestamptz not null default now(),
  constraint citation_checks_module_scope check (module = 'evidence_citations'),
  constraint citation_checks_safe_metadata check (
    case
      when result_category in ('reachable', 'http_error') then
        normalized_url ~ '^https?://' and status_code is not null
      else normalized_url is null and status_code is null
    end
  )
);

create index citation_checks_review_id_idx on public.citation_checks(review_id);
alter table public.citation_checks enable row level security;
revoke all on table public.citation_checks from public, anon, authenticated;
grant all on table public.citation_checks to service_role;

create function public.start_anonymous_review_analysis(
  p_review_id uuid,
  p_access_token_hash text
)
returns public.review_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.review_status;
  stored_hash text;
  expires_at timestamptz;
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
    or current_status = 'deleted'
  then
    raise exception 'review_access_denied' using errcode = 'P0001';
  end if;

  if current_status not in ('queued', 'reviewing', 'partial', 'failed', 'completed') then
    raise exception 'review is not ready for analysis' using errcode = '23514';
  end if;

  insert into public.analysis_modules (review_id, module, status)
  select p_review_id, supplied.module, 'queued'
  from unnest(array[
    'brief_fit'::public.analysis_module,
    'evidence_citations'::public.analysis_module,
    'editorial_quality'::public.analysis_module,
    'ai_risk'::public.analysis_module
  ]) as supplied(module)
  on conflict (review_id, module) do nothing;

  if current_status in ('partial', 'failed') then
    update public.reviews
    set
      status = 'queued',
      overall_score = null,
      system_recommendation = null
    where id = p_review_id;
    current_status := 'queued';
  end if;

  return current_status;
end;
$$;

create function public.claim_analysis_module(
  p_review_id uuid,
  p_module public.analysis_module
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.review_status;
  expires_at timestamptz;
  claimed_id uuid;
begin
  select reviews.status, reviews.delete_at
  into current_status, expires_at
  from public.reviews
  where reviews.id = p_review_id
  for update;

  if not found or expires_at <= now() or current_status = 'deleted' then
    return false;
  end if;
  if current_status not in ('queued', 'reviewing', 'partial', 'failed') then
    return false;
  end if;

  update public.analysis_modules
  set
    status = 'reviewing',
    score = null,
    ai_risk = null,
    summary = null,
    caveats = '{}',
    error_code = null,
    started_at = now(),
    completed_at = null
  where review_id = p_review_id
    and module = p_module
    and status in ('queued', 'unavailable')
  returning id into claimed_id;

  if claimed_id is not null then
    update public.reviews set status = 'reviewing' where id = p_review_id;
    return true;
  end if;
  return false;
end;
$$;

create function public.persist_analysis_module_result(
  p_review_id uuid,
  p_module public.analysis_module,
  p_status public.module_status,
  p_score integer,
  p_ai_risk public.ai_risk,
  p_summary text,
  p_caveats text[],
  p_error_code text,
  p_issues jsonb,
  p_citation_checks jsonb,
  p_requirement_evaluations jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  module_id uuid;
  supplied_issues jsonb := coalesce(p_issues, '[]'::jsonb);
  supplied_citations jsonb := coalesce(p_citation_checks, '[]'::jsonb);
  supplied_evaluations jsonb := coalesce(p_requirement_evaluations, '[]'::jsonb);
begin
  select analysis_modules.id into module_id
  from public.analysis_modules
  where review_id = p_review_id and module = p_module
  for update;

  if not found or (
    select status from public.analysis_modules where id = module_id
  ) <> 'reviewing' then
    raise exception 'module_not_claimed' using errcode = 'P0001';
  end if;
  if p_status not in ('complete', 'not_assessed', 'unavailable') then
    raise exception 'module result must be terminal' using errcode = '23514';
  end if;
  if p_score is not null and p_score not between 0 and 100 then
    raise exception 'module score is invalid' using errcode = '23514';
  end if;
  if (p_module <> 'ai_risk' and p_ai_risk is not null)
    or (p_module = 'ai_risk' and p_status = 'complete' and p_ai_risk not in ('low', 'medium', 'high'))
    or (p_module = 'ai_risk' and p_status = 'not_assessed' and p_ai_risk is distinct from 'not_assessed')
    or (p_status = 'unavailable' and p_ai_risk is not null)
  then
    raise exception 'AI risk result is invalid' using errcode = '23514';
  end if;
  if jsonb_typeof(supplied_issues) <> 'array'
    or jsonb_typeof(supplied_citations) <> 'array'
    or jsonb_typeof(supplied_evaluations) <> 'array'
    or jsonb_array_length(supplied_issues) > 50
    or jsonb_array_length(supplied_citations) > 50
    or jsonb_array_length(supplied_evaluations) > 30
  then
    raise exception 'module result payload is invalid' using errcode = '23514';
  end if;

  delete from public.issues
  where review_id = p_review_id and module = p_module;
  delete from public.citation_checks
  where review_id = p_review_id and module = p_module;

  if p_status = 'complete' then
    insert into public.issues (
      review_id, module, issue_type, severity, source_excerpt, source_start,
      source_end, related_requirement_id, explanation, suggested_action,
      confidence, include_in_writer_checklist
    )
    select
      p_review_id, p_module, supplied.issue_type, supplied.severity,
      supplied.source_excerpt, supplied.source_start, supplied.source_end,
      supplied.related_requirement_id, supplied.explanation,
      supplied.suggested_action, supplied.confidence,
      supplied.include_in_writer_checklist
    from jsonb_to_recordset(supplied_issues) as supplied(
      issue_type text,
      severity public.issue_severity,
      source_excerpt text,
      source_start integer,
      source_end integer,
      related_requirement_id uuid,
      explanation text,
      suggested_action text,
      confidence public.confidence_band,
      include_in_writer_checklist boolean
    );

    if p_module = 'evidence_citations' then
      insert into public.citation_checks (
        review_id, module, normalized_url, status_code, result_category, reason_code
      )
      select
        p_review_id, p_module, supplied.normalized_url, supplied.status_code,
        supplied.result_category, supplied.reason_code
      from jsonb_to_recordset(supplied_citations) as supplied(
        normalized_url text,
        status_code integer,
        result_category text,
        reason_code text
      );
    elsif supplied_citations <> '[]'::jsonb then
      raise exception 'citations are only valid for evidence analysis' using errcode = '23514';
    end if;

    if p_module = 'brief_fit' then
      update public.requirements
      set evaluation_result = supplied.result
      from jsonb_to_recordset(supplied_evaluations) as supplied(
        requirement_id uuid,
        result public.requirement_evaluation
      )
      where requirements.id = supplied.requirement_id
        and requirements.review_id = p_review_id;
    elsif supplied_evaluations <> '[]'::jsonb then
      raise exception 'requirement evaluations are only valid for brief fit' using errcode = '23514';
    end if;
  elsif supplied_issues <> '[]'::jsonb
    or supplied_citations <> '[]'::jsonb
    or supplied_evaluations <> '[]'::jsonb
  then
    raise exception 'non-complete modules cannot persist findings' using errcode = '23514';
  end if;

  update public.analysis_modules
  set
    status = p_status,
    score = p_score,
    ai_risk = p_ai_risk,
    summary = p_summary,
    caveats = coalesce(p_caveats, '{}'),
    error_code = p_error_code,
    completed_at = now()
  where id = module_id;
end;
$$;

create function public.finalize_review_analysis(
  p_review_id uuid,
  p_overall_score integer,
  p_recommendation public.system_recommendation
)
returns public.review_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.review_status;
  expires_at timestamptz;
  terminal_count integer;
  complete_count integer;
  unavailable_count integer;
  final_status public.review_status;
begin
  select reviews.status, reviews.delete_at
  into current_status, expires_at
  from public.reviews
  where reviews.id = p_review_id
  for update;

  if not found or expires_at <= now() or current_status = 'deleted' then
    raise exception 'review_unavailable' using errcode = 'P0001';
  end if;
  if current_status = 'completed' then return current_status; end if;

  select
    count(*) filter (where status in ('complete', 'not_assessed', 'unavailable')),
    count(*) filter (where status = 'complete'),
    count(*) filter (where status = 'unavailable')
  into terminal_count, complete_count, unavailable_count
  from public.analysis_modules
  where review_id = p_review_id;

  if terminal_count <> 4 then
    raise exception 'analysis_not_terminal' using errcode = 'P0001';
  end if;
  final_status := case
    when complete_count < 2 then 'failed'::public.review_status
    when unavailable_count > 0 then 'partial'::public.review_status
    else 'completed'::public.review_status
  end;
  if (complete_count < 2 and (p_overall_score is not null or p_recommendation <> 'manual_review_required'))
    or (complete_count >= 2 and (p_overall_score is null or p_overall_score not between 0 and 100))
  then
    raise exception 'invalid_finalization' using errcode = '23514';
  end if;

  update public.reviews
  set
    status = final_status,
    overall_score = p_overall_score,
    system_recommendation = p_recommendation
  where id = p_review_id;
  return final_status;
end;
$$;

revoke all on function public.start_anonymous_review_analysis(uuid, text)
from public, anon, authenticated;
revoke all on function public.claim_analysis_module(uuid, public.analysis_module)
from public, anon, authenticated;
revoke all on function public.persist_analysis_module_result(
  uuid, public.analysis_module, public.module_status, integer, public.ai_risk,
  text, text[], text, jsonb, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.finalize_review_analysis(
  uuid, integer, public.system_recommendation
) from public, anon, authenticated;

grant execute on function public.start_anonymous_review_analysis(uuid, text)
to service_role;
grant execute on function public.claim_analysis_module(uuid, public.analysis_module)
to service_role;
grant execute on function public.persist_analysis_module_result(
  uuid, public.analysis_module, public.module_status, integer, public.ai_risk,
  text, text[], text, jsonb, jsonb, jsonb
) to service_role;
grant execute on function public.finalize_review_analysis(
  uuid, integer, public.system_recommendation
) to service_role;

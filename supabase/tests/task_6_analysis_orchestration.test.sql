begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select has_table('public', 'citation_checks', 'citation metadata table exists');
select has_function(
  'public', 'start_anonymous_review_analysis', array['uuid', 'text'],
  'anonymous start RPC exists'
);
select has_function(
  'public', 'claim_analysis_module', array['uuid', 'public.analysis_module'],
  'module claim RPC exists'
);
select has_function(
  'public', 'persist_analysis_module_result',
  array[
    'uuid', 'public.analysis_module', 'public.module_status', 'integer',
    'public.ai_risk', 'text', 'text[]', 'text', 'jsonb', 'jsonb', 'jsonb'
  ],
  'atomic module persistence RPC exists'
);
select has_function(
  'public', 'finalize_review_analysis',
  array['uuid', 'integer', 'public.system_recommendation'],
  'atomic finalization RPC exists'
);

select function_privs_are(
  'public', 'start_anonymous_review_analysis', array['uuid', 'text'],
  'service_role', array['EXECUTE'], 'only service role can invoke anonymous start'
);
select function_privs_are(
  'public', 'claim_analysis_module', array['uuid', 'public.analysis_module'],
  'service_role', array['EXECUTE'], 'only service role can claim work'
);
select function_privs_are(
  'public', 'persist_analysis_module_result',
  array[
    'uuid', 'public.analysis_module', 'public.module_status', 'integer',
    'public.ai_risk', 'text', 'text[]', 'text', 'jsonb', 'jsonb', 'jsonb'
  ],
  'service_role', array['EXECUTE'], 'only service role can persist module output'
);
select function_privs_are(
  'public', 'finalize_review_analysis',
  array['uuid', 'integer', 'public.system_recommendation'],
  'service_role', array['EXECUTE'], 'only service role can finalize'
);

insert into public.reviews (
  id, anonymous_access_token_hash, title, content_type, source_input_type,
  word_count, brief_present, status, source_text_encrypted, delete_at
) values (
  '99999999-9999-4999-8999-999999999999', repeat('a', 64), 'Analysis review',
  'blog_post', 'pasted_text', 400, false, 'queued', decode('001122', 'hex'),
  now() + interval '24 hours'
);

set local role service_role;
select throws_ok(
  $$ select public.start_anonymous_review_analysis(
    '99999999-9999-4999-8999-999999999999', repeat('b', 64)
  ) $$,
  'P0001', 'review_access_denied',
  'wrong cookie hash is denied while the review row is locked'
);
reset role;

select results_eq(
  $$ select count(*)::bigint from public.analysis_modules where review_id = '99999999-9999-4999-8999-999999999999' $$,
  $$ values (0::bigint) $$,
  'failed ownership check creates no module rows'
);

set local role service_role;
select is(
  public.start_anonymous_review_analysis(
    '99999999-9999-4999-8999-999999999999', repeat('a', 64)
  )::text,
  'queued',
  'owned review starts idempotently'
);
select is(
  public.start_anonymous_review_analysis(
    '99999999-9999-4999-8999-999999999999', repeat('a', 64)
  )::text,
  'queued',
  'repeat start returns the same state'
);
reset role;

select results_eq(
  $$ select module::text from public.analysis_modules where review_id = '99999999-9999-4999-8999-999999999999' order by module::text $$,
  $$ values ('ai_risk'::text), ('brief_fit'::text), ('editorial_quality'::text), ('evidence_citations'::text) $$,
  'start creates exactly one queued row per module'
);

set local role service_role;
select ok(
  public.claim_analysis_module(
    '99999999-9999-4999-8999-999999999999', 'brief_fit'
  ),
  'queued module can be claimed'
);
select ok(
  not public.claim_analysis_module(
    '99999999-9999-4999-8999-999999999999', 'brief_fit'
  ),
  'reviewing module cannot be claimed concurrently'
);
select lives_ok(
  $$ select public.persist_analysis_module_result(
    '99999999-9999-4999-8999-999999999999', 'brief_fit', 'complete', 90,
    null, 'Fits the brief', array[]::text[], null,
    '[{
      "issue_type":"missing_detail","severity":"major","source_excerpt":null,
      "source_start":null,"source_end":null,"related_requirement_id":null,
      "explanation":"A required detail is missing.",
      "suggested_action":"Add the required detail.","confidence":"high",
      "include_in_writer_checklist":true
    }]'::jsonb,
    '[]'::jsonb, '[]'::jsonb
  ) $$,
  'claimed module result persists atomically'
);
select ok(
  not public.claim_analysis_module(
    '99999999-9999-4999-8999-999999999999', 'brief_fit'
  ),
  'successful module is immutable to ordinary retries'
);
reset role;

select results_eq(
  $$ select status::text, score, summary from public.analysis_modules where review_id = '99999999-9999-4999-8999-999999999999' and module = 'brief_fit' $$,
  $$ values ('complete'::text, 90, 'Fits the brief'::text) $$,
  'module row contains the validated terminal result'
);
select results_eq(
  $$ select count(*)::bigint from public.issues where review_id = '99999999-9999-4999-8999-999999999999' and module = 'brief_fit' $$,
  $$ values (1::bigint) $$,
  'module issues commit with the module row'
);

set local role service_role;
select ok(public.claim_analysis_module('99999999-9999-4999-8999-999999999999', 'evidence_citations'), 'evidence module can be claimed');
select lives_ok(
  $$ select public.persist_analysis_module_result(
    '99999999-9999-4999-8999-999999999999', 'evidence_citations', 'unavailable',
    null, null, null, array['Temporarily unavailable'], 'provider_failed',
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
  ) $$,
  'unavailable result persists safely'
);
select ok(public.claim_analysis_module('99999999-9999-4999-8999-999999999999', 'evidence_citations'), 'unavailable module can reclaim its existing row');
reset role;

select results_eq(
  $$ select count(*)::bigint from public.analysis_modules where review_id = '99999999-9999-4999-8999-999999999999' and module = 'evidence_citations' $$,
  $$ values (1::bigint) $$,
  'retry reuses the unique module row'
);

update public.analysis_modules
set status = case module
  when 'ai_risk' then 'not_assessed'::public.module_status
  when 'evidence_citations' then 'unavailable'::public.module_status
  else 'complete'::public.module_status
end,
ai_risk = case when module = 'ai_risk' then 'not_assessed'::public.ai_risk else null end,
score = case when module = 'editorial_quality' then 95 when module = 'brief_fit' then 90 else null end,
completed_at = now()
where review_id = '99999999-9999-4999-8999-999999999999';

set local role service_role;
select is(
  public.finalize_review_analysis(
    '99999999-9999-4999-8999-999999999999', 92, 'request_revisions'
  )::text,
  'partial',
  'final state is derived from persisted terminal module rows'
);
reset role;

select results_eq(
  $$ select status::text, overall_score, system_recommendation::text from public.reviews where id = '99999999-9999-4999-8999-999999999999' $$,
  $$ values ('partial'::text, 92, 'request_revisions'::text) $$,
  'finalization persists only safe aggregate review fields'
);

set local role service_role;
select is(
  public.start_anonymous_review_analysis(
    '99999999-9999-4999-8999-999999999999', repeat('a', 64)
  )::text,
  'queued',
  'retry start moves a partial review back to nonterminal queued state'
);
reset role;

select results_eq(
  $$ select status::text from public.reviews where id = '99999999-9999-4999-8999-999999999999' $$,
  $$ values ('queued'::text) $$,
  'progress polling remains active while unavailable modules retry'
);

select * from finish();

rollback;

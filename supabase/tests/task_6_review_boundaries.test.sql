begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select table_privs_are(
  'public', 'analysis_modules', 'authenticated', array['SELECT'],
  'authenticated can only select analysis module results'
);
select table_privs_are(
  'public', 'issues', 'authenticated', array['SELECT'],
  'authenticated can only select persisted issues'
);
select results_eq(
  $$
    select tablename::text collate "C", cmd::text collate "C"
    from pg_policies
    where schemaname = 'public'
      and tablename in ('analysis_modules', 'issues')
      and roles = array['authenticated'::name]
    order by tablename, cmd
  $$,
  $$
    values
      ('analysis_modules'::text collate "C", 'SELECT'::text collate "C"),
      ('issues'::text collate "C", 'SELECT'::text collate "C")
  $$,
  'authenticated mutation policies are absent while owner reads remain'
);
select ok(
  has_table_privilege('service_role', 'public.analysis_modules', 'INSERT,UPDATE,DELETE'),
  'service role retains analysis module writes'
);
select ok(
  has_table_privilege('service_role', 'public.issues', 'INSERT,UPDATE,DELETE'),
  'service role retains issue writes'
);

insert into public.reviews (
  id, anonymous_access_token_hash, title, content_type, source_input_type,
  word_count, brief_present, status, delete_at
) values (
  '12121212-1212-4212-8212-121212121212', repeat('1', 64),
  'Boundary review', 'blog_post', 'pasted_text', 400, false, 'queued',
  now() + interval '24 hours'
);
insert into public.analysis_modules (
  id, review_id, module, status
) values (
  '13131313-1313-4313-8313-131313131313',
  '12121212-1212-4212-8212-121212121212', 'brief_fit', 'queued'
);
insert into public.issues (
  id, review_id, module, issue_type, severity, explanation, suggested_action
) values (
  '14141414-1414-4414-8414-141414141414',
  '12121212-1212-4212-8212-121212121212', 'brief_fit', 'boundary_test',
  'minor', 'Boundary test issue.', 'No action.'
);

set local role authenticated;

select throws_ok(
  $$ insert into public.analysis_modules (review_id, module, status) values (
    '12121212-1212-4212-8212-121212121212', 'ai_risk', 'queued'
  ) $$,
  '42501', 'permission denied for table analysis_modules',
  'authenticated cannot insert analysis modules'
);
select throws_ok(
  $$ update public.analysis_modules set status = 'reviewing' where id =
    '13131313-1313-4313-8313-131313131313' $$,
  '42501', 'permission denied for table analysis_modules',
  'authenticated cannot update analysis modules'
);
select throws_ok(
  $$ delete from public.analysis_modules where id =
    '13131313-1313-4313-8313-131313131313' $$,
  '42501', 'permission denied for table analysis_modules',
  'authenticated cannot delete analysis modules'
);
select throws_ok(
  $$ insert into public.issues (
    review_id, module, issue_type, severity, explanation, suggested_action
  ) values (
    '12121212-1212-4212-8212-121212121212', 'brief_fit', 'forbidden',
    'minor', 'Forbidden issue.', 'No action.'
  ) $$,
  '42501', 'permission denied for table issues',
  'authenticated cannot insert issues'
);
select throws_ok(
  $$ update public.issues set explanation = 'Forbidden update' where id =
    '14141414-1414-4414-8414-141414141414' $$,
  '42501', 'permission denied for table issues',
  'authenticated cannot update issues'
);
select throws_ok(
  $$ delete from public.issues where id =
    '14141414-1414-4414-8414-141414141414' $$,
  '42501', 'permission denied for table issues',
  'authenticated cannot delete issues'
);

reset role;
select * from finish();
rollback;

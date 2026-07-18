begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_function(
  'public', 'set_anonymous_review_decision',
  array['uuid', 'text', 'public.user_decision'],
  'atomic anonymous decision RPC exists'
);
select function_privs_are(
  'public', 'set_anonymous_review_decision',
  array['uuid', 'text', 'public.user_decision'],
  'service_role', array['EXECUTE'],
  'only service role can invoke the anonymous decision RPC'
);
select enum_has_labels(
  'public', 'user_decision',
  array['ready', 'revisions_requested', 'manually_reviewed'],
  'editor decision has exactly the approved three values'
);

insert into public.reviews (
  id, anonymous_access_token_hash, title, content_type, source_input_type,
  word_count, brief_present, status, overall_score, system_recommendation,
  delete_at
) values
  (
    '71717171-7171-4717-8717-717171717171', repeat('a', 64),
    'Terminal report', 'blog_post', 'pasted_text', 400, false, 'completed',
    92, 'ready_to_approve', now() + interval '24 hours'
  ),
  (
    '72727272-7272-4727-8727-727272727272', repeat('b', 64),
    'Expired report', 'blog_post', 'pasted_text', 400, false, 'completed',
    92, 'ready_to_approve', now() - interval '1 second'
  ),
  (
    '73737373-7373-4737-8737-737373737373', repeat('c', 64),
    'Reviewing report', 'blog_post', 'pasted_text', 400, false, 'reviewing',
    null, null, now() + interval '24 hours'
  );

set local role service_role;

select throws_ok(
  $$ select public.set_anonymous_review_decision(
    '71717171-7171-4717-8717-717171717171', repeat('z', 64), 'ready'
  ) $$,
  'P0001', 'review_access_denied',
  'wrong HMAC is denied under the review lock'
);
select throws_ok(
  $$ select public.set_anonymous_review_decision(
    '72727272-7272-4727-8727-727272727272', repeat('b', 64), 'ready'
  ) $$,
  'P0001', 'review_access_denied',
  'expired review is denied'
);
select throws_ok(
  $$ select public.set_anonymous_review_decision(
    '73737373-7373-4737-8737-737373737373', repeat('c', 64), 'ready'
  ) $$,
  'P0001', 'review_access_denied',
  'nonterminal review cannot record a decision'
);

select results_eq(
  $$ select count(*)::bigint from public.review_decisions $$,
  $$ values (0::bigint) $$,
  'denied attempts persist no decision'
);

select ok(
  public.set_anonymous_review_decision(
    '71717171-7171-4717-8717-717171717171', repeat('a', 64), 'ready'
  ) is not null,
  'ready is recorded with a server audit timestamp'
);
select results_eq(
  $$ select decision::text from public.review_decisions where review_id = '71717171-7171-4717-8717-717171717171' $$,
  $$ values ('ready'::text) $$,
  'ready is the recorded decision'
);

create temporary table first_decision_timestamp as
select updated_at from public.review_decisions
where review_id = '71717171-7171-4717-8717-717171717171';

select is(
  public.set_anonymous_review_decision(
    '71717171-7171-4717-8717-717171717171', repeat('a', 64), 'ready'
  ),
  (select updated_at from first_decision_timestamp),
  'repeat submission is idempotent and preserves its audit timestamp'
);

do $$ begin perform pg_sleep(0.01); end $$;
select ok(
  public.set_anonymous_review_decision(
    '71717171-7171-4717-8717-717171717171', repeat('a', 64), 'revisions_requested'
  ) > (select updated_at from first_decision_timestamp),
  'a changed decision advances its server audit timestamp'
);
select results_eq(
  $$ select decision::text from public.review_decisions where review_id = '71717171-7171-4717-8717-717171717171' $$,
  $$ values ('revisions_requested'::text) $$,
  'revisions requested replaces the previous value'
);

do $$ begin perform pg_sleep(0.01); end $$;
select ok(
  public.set_anonymous_review_decision(
    '71717171-7171-4717-8717-717171717171', repeat('a', 64), 'manually_reviewed'
  ) is not null,
  'manually reviewed is accepted'
);
select results_eq(
  $$ select decision::text, count(*) over ()::bigint from public.review_decisions where review_id = '71717171-7171-4717-8717-717171717171' $$,
  $$ values ('manually_reviewed'::text, 1::bigint) $$,
  'last write wins while one unique decision row remains'
);

reset role;

set local role anon;
select throws_ok(
  $$ select public.set_anonymous_review_decision(
    '71717171-7171-4717-8717-717171717171', repeat('a', 64), 'ready'
  ) $$,
  '42501',
  'permission denied for function set_anonymous_review_decision',
  'anonymous clients cannot invoke the RPC directly'
);
select throws_ok(
  $$ select decision from public.review_decisions $$,
  '42501', 'permission denied for table review_decisions',
  'anonymous clients cannot read decisions directly'
);
reset role;

select results_eq(
  $$ select count(*)::bigint from public.review_decisions where review_id = '72727272-7272-4727-8727-727272727272' $$,
  $$ values (0::bigint) $$,
  'expired review still has no decision'
);
select results_eq(
  $$ select count(*)::bigint from public.review_decisions where review_id = '73737373-7373-4737-8737-737373737373' $$,
  $$ values (0::bigint) $$,
  'nonterminal review still has no decision'
);

select * from finish();

rollback;

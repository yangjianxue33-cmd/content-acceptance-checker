begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

select ok(
  to_regprocedure('public.replace_review_requirements(uuid,jsonb,boolean)') is not null,
  'atomic requirements replacement RPC exists'
);

select is(
  (
    select prosecdef
    from pg_proc
    where oid = to_regprocedure('public.replace_review_requirements(uuid,jsonb,boolean)')
  ),
  true,
  'requirements replacement uses a security-definer boundary'
);

select ok(
  coalesce((
    select has_function_privilege('service_role', oid, 'execute')
    from pg_proc
    where oid = to_regprocedure('public.replace_review_requirements(uuid,jsonb,boolean)')
  ), false),
  'service_role can execute requirements replacement'
);

select ok(
  not coalesce((
    select has_function_privilege('anon', oid, 'execute')
    from pg_proc
    where oid = to_regprocedure('public.replace_review_requirements(uuid,jsonb,boolean)')
  ), false),
  'anon cannot execute requirements replacement'
);

select ok(
  not coalesce((
    select has_function_privilege('authenticated', oid, 'execute')
    from pg_proc
    where oid = to_regprocedure('public.replace_review_requirements(uuid,jsonb,boolean)')
  ), false),
  'authenticated cannot execute requirements replacement'
);

select ok(
  lower(pg_get_functiondef(
    to_regprocedure('public.replace_review_requirements(uuid,jsonb,boolean)')
  )) like '%for update%',
  'requirements replacement locks the parent review row'
);

insert into public.reviews (
  id, anonymous_access_token_hash, title, content_type, source_input_type,
  word_count, brief_present, status, source_text_encrypted, delete_at
) values
  (
    '55555555-5555-4555-8555-555555555551', repeat('a', 64), 'Requirement review',
    'blog_post', 'pasted_text', 400, true, 'awaiting_brief_confirmation',
    decode('001122', 'hex'), now() + interval '24 hours'
  ),
  (
    '55555555-5555-4555-8555-555555555552', repeat('b', 64), 'Rollback review',
    'other', 'pasted_text', 400, true, 'awaiting_brief_confirmation',
    decode('334455', 'hex'), now() + interval '24 hours'
  );

set local role service_role;
select lives_ok(
  $$
    select public.replace_review_requirements(
      '55555555-5555-4555-8555-555555555551',
      '[
        {
          "category": "Audience",
          "requirement_text": "Write for editors.",
          "is_critical": false,
          "source_excerpt": "For editorial teams."
        },
        {
          "category": "Evidence",
          "requirement_text": "Include a customer example.",
          "is_critical": true,
          "source_excerpt": "Include a customer example."
        }
      ]'::jsonb,
      false
    )
  $$,
  'service_role atomically persists an unconfirmed draft'
);
reset role;

select results_eq(
  $$
    select category, requirement_text, is_critical, user_confirmed
    from public.requirements
    where review_id = '55555555-5555-4555-8555-555555555551'
    order by category
  $$,
  $$
    values
      ('Audience'::text, 'Write for editors.'::text, false, false),
      ('Evidence'::text, 'Include a customer example.'::text, true, false)
  $$,
  'draft rows preserve editable values and remain unconfirmed'
);

set local role service_role;
select lives_ok(
  $$
    select public.replace_review_requirements(
      '55555555-5555-4555-8555-555555555551',
      '[{
        "category": "Replacement",
        "requirement_text": "Use the replacement draft.",
        "is_critical": true,
        "source_excerpt": "Replacement source."
      }]'::jsonb,
      false
    )
  $$,
  'a concurrent-style draft retry replaces the whole draft set'
);
reset role;

select results_eq(
  $$
    select category, requirement_text
    from public.requirements
    where review_id = '55555555-5555-4555-8555-555555555551'
  $$,
  $$ values ('Replacement'::text, 'Use the replacement draft.'::text) $$,
  'draft replacement leaves one coherent set'
);

set local role service_role;
select lives_ok(
  $$
    select public.replace_review_requirements(
      '55555555-5555-4555-8555-555555555551',
      '[{
        "category": "Confirmed",
        "requirement_text": "Keep the accepted version.",
        "is_critical": false,
        "source_excerpt": null
      }]'::jsonb,
      true
    )
  $$,
  'confirmation replaces the full set and queues the review atomically'
);
reset role;

select results_eq(
  $$ select status::text from public.reviews where id = '55555555-5555-4555-8555-555555555551' $$,
  $$ values ('queued'::text) $$,
  'confirmation advances awaiting confirmation to queued'
);

select results_eq(
  $$
    select category, requirement_text, is_critical, source_excerpt, user_confirmed
    from public.requirements
    where review_id = '55555555-5555-4555-8555-555555555551'
  $$,
  $$
    values (
      'Confirmed'::text, 'Keep the accepted version.'::text,
      false, null::text, true
    )
  $$,
  'confirmation persists only the user-confirmed set'
);

set local role service_role;
select lives_ok(
  $$
    select public.replace_review_requirements(
      '55555555-5555-4555-8555-555555555551',
      '[{
        "category": "Divergent retry",
        "requirement_text": "This must not replace the first confirmation.",
        "is_critical": true,
        "source_excerpt": null
      }]'::jsonb,
      true
    )
  $$,
  'a divergent confirmation retry is a successful no-op'
);
reset role;

select results_eq(
  $$
    select category, requirement_text, user_confirmed
    from public.requirements
    where review_id = '55555555-5555-4555-8555-555555555551'
  $$,
  $$ values ('Confirmed'::text, 'Keep the accepted version.'::text, true) $$,
  'the first confirmed set wins a divergent double submit'
);

set local role service_role;
select public.replace_review_requirements(
  '55555555-5555-4555-8555-555555555552',
  '[{
    "category": "Original",
    "requirement_text": "Preserve this draft.",
    "is_critical": false,
    "source_excerpt": "Original excerpt."
  }]'::jsonb,
  false
);

select throws_ok(
  $$
    select public.replace_review_requirements(
      '55555555-5555-4555-8555-555555555552',
      '[
        {
          "category": "Valid",
          "requirement_text": "Would be valid alone.",
          "is_critical": false,
          "source_excerpt": null
        },
        {
          "category": "Invalid",
          "requirement_text": "",
          "is_critical": true,
          "source_excerpt": null
        }
      ]'::jsonb,
      true
    )
  $$,
  '23514',
  null,
  'one invalid row aborts the full confirmation'
);
reset role;

select results_eq(
  $$
    select category, requirement_text, user_confirmed
    from public.requirements
    where review_id = '55555555-5555-4555-8555-555555555552'
  $$,
  $$ values ('Original'::text, 'Preserve this draft.'::text, false) $$,
  'failed confirmation rolls back every requirements change'
);

select results_eq(
  $$ select status::text from public.reviews where id = '55555555-5555-4555-8555-555555555552' $$,
  $$ values ('awaiting_brief_confirmation'::text) $$,
  'failed confirmation does not advance the review'
);

set local role anon;
select throws_ok(
  $$
    select public.replace_review_requirements(
      '55555555-5555-4555-8555-555555555552', '[]'::jsonb, false
    )
  $$,
  '42501',
  null,
  'anon cannot call the service-only requirements RPC'
);
reset role;

select * from finish();

rollback;

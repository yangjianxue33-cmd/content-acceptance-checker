begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select ok(
  to_regprocedure(
    'public.create_anonymous_review(uuid,text,text,public.content_type,public.source_input_type,text,integer,boolean,public.review_status,bytea,timestamp with time zone,jsonb)'
  ) is not null,
  'transactional anonymous review creation RPC exists'
);

select is(
  (
    select prosecdef
    from pg_proc
    where oid = to_regprocedure(
      'public.create_anonymous_review(uuid,text,text,public.content_type,public.source_input_type,text,integer,boolean,public.review_status,bytea,timestamp with time zone,jsonb)'
    )
  ),
  true,
  'anonymous review creation uses a security-definer boundary'
);

select ok(
  coalesce((
    select has_function_privilege('service_role', oid, 'execute')
    from pg_proc
    where oid = to_regprocedure(
      'public.create_anonymous_review(uuid,text,text,public.content_type,public.source_input_type,text,integer,boolean,public.review_status,bytea,timestamp with time zone,jsonb)'
    )
  ), false),
  'service_role can execute the creation RPC'
);

select ok(
  not coalesce((
    select has_function_privilege('anon', oid, 'execute')
    from pg_proc
    where oid = to_regprocedure(
      'public.create_anonymous_review(uuid,text,text,public.content_type,public.source_input_type,text,integer,boolean,public.review_status,bytea,timestamp with time zone,jsonb)'
    )
  ), false),
  'anon cannot execute the creation RPC'
);

select ok(
  not coalesce((
    select has_function_privilege('authenticated', oid, 'execute')
    from pg_proc
    where oid = to_regprocedure(
      'public.create_anonymous_review(uuid,text,text,public.content_type,public.source_input_type,text,integer,boolean,public.review_status,bytea,timestamp with time zone,jsonb)'
    )
  ), false),
  'authenticated cannot execute the creation RPC'
);

set local role service_role;
select lives_ok(
  $$
    select public.create_anonymous_review(
      '44444444-4444-4444-8444-444444444441',
      'hashed-token-task-4-success',
      'Transactional review',
      'blog_post',
      'uploaded_file',
      'article.txt',
      299,
      true,
      'awaiting_brief_confirmation',
      decode('001122334455', 'hex'),
      '2026-07-19T08:00:00Z',
      '[
        {
          "file_kind": "source",
          "object_path": "44444444-4444-4444-8444-444444444441/source.txt",
          "original_filename": "article.txt",
          "mime_type": "text/plain",
          "size_bytes": 100
        },
        {
          "file_kind": "brief",
          "object_path": "44444444-4444-4444-8444-444444444441/brief.txt",
          "original_filename": null,
          "mime_type": "text/plain",
          "size_bytes": 50
        }
      ]'::jsonb
    )
  $$,
  'service_role creates a review and all file metadata in one call'
);
reset role;

select results_eq(
  $$
    select title, word_count, brief_present, status::text
    from public.reviews
    where id = '44444444-4444-4444-8444-444444444441'
  $$,
  $$ values ('Transactional review'::text, 299, true, 'awaiting_brief_confirmation'::text) $$,
  'the RPC persists the anonymous review contract'
);

select results_eq(
  $$
    select file_kind::text, object_path
    from public.review_files
    where review_id = '44444444-4444-4444-8444-444444444441'
    order by file_kind
  $$,
  $$
    values
      ('brief'::text, '44444444-4444-4444-8444-444444444441/brief.txt'::text),
      ('source'::text, '44444444-4444-4444-8444-444444444441/source.txt'::text)
  $$,
  'the RPC persists every supplied file metadata row'
);

set local role anon;
select throws_ok(
  $$
    select public.create_anonymous_review(
      '44444444-4444-4444-8444-444444444442',
      'hashed-token-task-4-anon',
      'Forbidden review',
      'other',
      'pasted_text',
      null,
      350,
      false,
      'queued',
      decode('0011', 'hex'),
      now() + interval '1 day',
      '[]'::jsonb
    )
  $$,
  '42501',
  null,
  'anon cannot call the service-only creation RPC'
);
reset role;

set local role service_role;
select throws_ok(
  $$
    select public.create_anonymous_review(
      '44444444-4444-4444-8444-444444444443',
      'hashed-token-task-4-rollback',
      'Rollback review',
      'other',
      'uploaded_file',
      'article.txt',
      350,
      false,
      'queued',
      decode('0011', 'hex'),
      now() + interval '1 day',
      '[
        {
          "file_kind": "source",
          "object_path": "44444444-4444-4444-8444-444444444443/source-one.txt",
          "original_filename": "article.txt",
          "mime_type": "text/plain",
          "size_bytes": 100
        },
        {
          "file_kind": "source",
          "object_path": "44444444-4444-4444-8444-444444444443/source-two.txt",
          "original_filename": "article.txt",
          "mime_type": "text/plain",
          "size_bytes": 100
        }
      ]'::jsonb
    )
  $$,
  '23505',
  null,
  'invalid file metadata aborts the RPC'
);
reset role;

select results_eq(
  $$
    select count(*)::bigint
    from public.reviews
    where id = '44444444-4444-4444-8444-444444444443'
  $$,
  $$ values (0::bigint) $$,
  'review insertion rolls back with file metadata failure'
);

select * from finish();

rollback;

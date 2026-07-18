begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

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
      repeat('a', 64),
      'Transactional review',
      'blog_post',
      'uploaded_file',
      'article.txt',
      299,
      true,
      'awaiting_brief_confirmation',
      decode('001122334455', 'hex'),
      now() + interval '24 hours',
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
      repeat('b', 64),
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
      repeat('c', 64),
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
  '23514',
  null,
  'inconsistent file metadata aborts the RPC before insertion'
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

set local role service_role;
select throws_ok(
  $$ select public.create_anonymous_review(
    '44444444-4444-4444-8444-444444444450', 'not-a-hash', 'Bad hash',
    'other', 'pasted_text', null, 300, false, 'queued', decode('0011', 'hex'),
    now() + interval '24 hours', '[]'::jsonb
  ) $$,
  '23514', null, 'RPC rejects a malformed token hash'
);

select throws_ok(
  $$ select public.create_anonymous_review(
    '44444444-4444-4444-8444-444444444451', repeat('d', 64), 'Too long',
    'other', 'pasted_text', null, 5001, false, 'queued', decode('0011', 'hex'),
    now() + interval '24 hours', '[]'::jsonb
  ) $$,
  '23514', null, 'RPC enforces the 5000 word ceiling'
);

select throws_ok(
  $$ select public.create_anonymous_review(
    '44444444-4444-4444-8444-444444444452', repeat('e', 64), 'Bad retention',
    'other', 'pasted_text', null, 300, false, 'queued', decode('0011', 'hex'),
    now() + interval '48 hours', '[]'::jsonb
  ) $$,
  '23514', null, 'RPC enforces approximately 24 hour retention'
);

select throws_ok(
  $$ select public.create_anonymous_review(
    '44444444-4444-4444-8444-444444444453', repeat('f', 64), 'Bad brief state',
    'other', 'pasted_text', null, 300, true, 'queued', decode('0011', 'hex'),
    now() + interval '24 hours', '[]'::jsonb
  ) $$,
  '23514', null, 'RPC binds the brief flag to status and metadata'
);

select throws_ok(
  $$ select public.create_anonymous_review(
    '44444444-4444-4444-8444-444444444454', repeat('1', 64), 'Missing source',
    'other', 'uploaded_file', 'article.txt', 300, false, 'queued', decode('0011', 'hex'),
    now() + interval '24 hours', '[]'::jsonb
  ) $$,
  '23514', null, 'RPC requires source metadata for uploaded files'
);

select throws_ok(
  $$ select public.create_anonymous_review(
    '44444444-4444-4444-8444-444444444455', repeat('2', 64), 'Bad files JSON',
    'other', 'pasted_text', null, 300, false, 'queued', decode('0011', 'hex'),
    now() + interval '24 hours', '{}'::jsonb
  ) $$,
  '23514', null, 'RPC rejects a non-array files payload'
);
reset role;

select * from finish();

rollback;

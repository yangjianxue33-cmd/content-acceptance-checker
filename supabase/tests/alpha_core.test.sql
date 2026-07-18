begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

select has_table('public', 'reviews', 'reviews table exists');
select has_table('public', 'requirements', 'requirements table exists');
select has_table('public', 'analysis_modules', 'analysis_modules table exists');
select has_table('public', 'issues', 'issues table exists');
select has_table('public', 'review_decisions', 'review_decisions table exists');
select has_table('public', 'review_files', 'review_files table exists');
select col_type_is(
  'public',
  'reviews',
  'source_text_encrypted',
  'bytea',
  'review source text is stored as ciphertext bytes'
);
select col_is_fk(
  'public',
  'reviews',
  'owner_id',
  'reviews.owner_id references an authenticated user'
);
select results_eq(
  $$
    select c.relname::text collate "C"
    from pg_constraint fk
    join pg_class c on c.oid = fk.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class parent on parent.oid = fk.confrelid
    join pg_namespace parent_n on parent_n.oid = parent.relnamespace
    where fk.contype = 'f'
      and n.nspname = 'public'
      and parent_n.nspname = 'public'
      and parent.relname = 'reviews'
    order by c.relname
  $$,
  $$
    values
      ('analysis_modules'::text collate "C"),
      ('issues'::text collate "C"),
      ('requirements'::text collate "C"),
      ('review_decisions'::text collate "C"),
      ('review_files'::text collate "C")
  $$,
  'every review child has a foreign key to reviews'
);
select results_eq(
  $$
    select c.relname::text collate "C"
    from pg_constraint fk
    join pg_class c on c.oid = fk.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class parent on parent.oid = fk.confrelid
    join pg_namespace parent_n on parent_n.oid = parent.relnamespace
    where fk.contype = 'f'
      and fk.confdeltype = 'c'
      and n.nspname = 'public'
      and parent_n.nspname = 'public'
      and parent.relname = 'reviews'
    order by c.relname
  $$,
  $$
    values
      ('analysis_modules'::text collate "C"),
      ('issues'::text collate "C"),
      ('requirements'::text collate "C"),
      ('review_decisions'::text collate "C"),
      ('review_files'::text collate "C")
  $$,
  'every review child cascades when its review is deleted'
);
select results_eq(
  $$
    select array_agg(a.attname order by key_columns.ordinality)::text collate "C"
    from pg_constraint constraint_row
    cross join lateral unnest(constraint_row.conkey) with ordinality as key_columns(attnum, ordinality)
    join pg_attribute a
      on a.attrelid = constraint_row.conrelid
     and a.attnum = key_columns.attnum
    where constraint_row.conrelid = 'public.analysis_modules'::regclass
      and constraint_row.contype = 'u'
    group by constraint_row.oid
  $$,
  $$ values ('{review_id,module}'::text collate "C") $$,
  'a review has at most one row for each analysis module'
);
select results_eq(
  $$
    select c.relname::text collate "C"
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'reviews',
        'requirements',
        'analysis_modules',
        'issues',
        'review_decisions',
        'review_files'
      )
      and c.relrowsecurity
    order by c.relname
  $$,
  $$
    values
      ('analysis_modules'::text collate "C"),
      ('issues'::text collate "C"),
      ('requirements'::text collate "C"),
      ('review_decisions'::text collate "C"),
      ('review_files'::text collate "C"),
      ('reviews'::text collate "C")
  $$,
  'RLS is enabled on reviews and every review child'
);
select results_eq(
  $$ select public from storage.buckets where id = 'review-source' $$,
  $$ values (false) $$,
  'review-source bucket is private'
);
select results_eq(
  $$
    select tablename::text collate "C"
    from pg_policies
    where schemaname = 'public'
      and roles = array['authenticated'::name]
      and tablename in (
        'reviews',
        'requirements',
        'analysis_modules',
        'issues',
        'review_decisions',
        'review_files'
      )
    group by tablename
    having array_agg(cmd order by cmd) = array['DELETE', 'INSERT', 'SELECT', 'UPDATE']
    order by tablename
  $$,
  $$
    values
      ('analysis_modules'::text collate "C"),
      ('issues'::text collate "C"),
      ('requirements'::text collate "C"),
      ('review_decisions'::text collate "C"),
      ('review_files'::text collate "C"),
      ('reviews'::text collate "C")
  $$,
  'authenticated users have owner-scoped CRUD policies on every review table'
);
select results_eq(
  $$
    select c.relname::text collate "C"
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'reviews',
        'requirements',
        'analysis_modules',
        'issues',
        'review_decisions',
        'review_files'
      )
      and has_table_privilege('anon', c.oid, 'SELECT')
    order by c.relname
  $$,
  $$ select null::text collate "C" where false $$,
  'anonymous users have no direct SELECT privilege on review tables'
);
select is(
  has_column_privilege(
    'authenticated',
    'public.reviews',
    'source_text_encrypted',
    'SELECT'
  ),
  false,
  'authenticated clients cannot select encrypted source text'
);

select exists(
  select 1
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'reviews'
) as alpha_schema_ready \gset

\if :alpha_schema_ready

select lives_ok(
  $$
    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    values
      (
        '11111111-1111-4111-8111-111111111111',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'owner-one@example.test',
        '',
        now(),
        '{"provider":"email","providers":["email"]}',
        '{}',
        now(),
        now()
      ),
      (
        '22222222-2222-4222-8222-222222222222',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'owner-two@example.test',
        '',
        now(),
        '{"provider":"email","providers":["email"]}',
        '{}',
        now(),
        now()
      );

    insert into public.reviews (
      id,
      owner_id,
      title,
      content_type,
      source_input_type,
      word_count,
      brief_present,
      status,
      source_text_encrypted,
      delete_at
    )
    values
      (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        '11111111-1111-4111-8111-111111111111',
        'Owner one review',
        'blog_post',
        'pasted_text',
        500,
        true,
        'draft',
        decode('01', 'hex'),
        now() + interval '30 days'
      ),
      (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        '22222222-2222-4222-8222-222222222222',
        'Owner two review',
        'seo_article',
        'uploaded_file',
        700,
        false,
        'queued',
        decode('02', 'hex'),
        now() + interval '30 days'
      );

    insert into public.requirements (
      id,
      review_id,
      category,
      requirement_text,
      is_critical
    ) values (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'required_point',
      'Include the required example',
      true
    );

    insert into public.analysis_modules (
      id,
      review_id,
      module,
      status
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'brief_fit',
      'queued'
    );

    insert into public.issues (
      id,
      review_id,
      module,
      issue_type,
      severity,
      explanation,
      suggested_action
    ) values (
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'brief_fit',
      'required_point_missing',
      'critical',
      'The required example is absent.',
      'Add the required example.'
    );

    insert into public.review_decisions (
      id,
      review_id,
      decision
    ) values (
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'revisions_requested'
    );

    insert into public.review_files (
      id,
      review_id,
      file_kind,
      object_path,
      mime_type,
      size_bytes
    ) values (
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'source',
      '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/source.txt',
      'text/plain',
      1200
    );
  $$,
  'test owners and review graph can be created through the trusted role'
);

select throws_ok(
  $$
    insert into public.analysis_modules (review_id, module, status)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'brief_fit',
      'reviewing'
    )
  $$,
  '23505',
  null,
  'a review cannot contain the same analysis module twice'
);

set local role anon;
select throws_ok(
  $$ select id from public.reviews $$,
  '42501',
  'permission denied for table reviews',
  'anonymous users cannot query reviews directly'
);
select throws_ok(
  $$ select id from public.requirements $$,
  '42501',
  'permission denied for table requirements',
  'anonymous users cannot query requirements directly'
);
select throws_ok(
  $$ select id from public.analysis_modules $$,
  '42501',
  'permission denied for table analysis_modules',
  'anonymous users cannot query analysis modules directly'
);
select throws_ok(
  $$ select id from public.issues $$,
  '42501',
  'permission denied for table issues',
  'anonymous users cannot query issues directly'
);
select throws_ok(
  $$ select id from public.review_decisions $$,
  '42501',
  'permission denied for table review_decisions',
  'anonymous users cannot query review decisions directly'
);
select throws_ok(
  $$ select id from public.review_files $$,
  '42501',
  'permission denied for table review_files',
  'anonymous users cannot query review files directly'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select results_eq(
  $$ select title from public.reviews order by title $$,
  $$ values ('Owner one review'::text) $$,
  'an authenticated owner reads only their own review'
);
select results_eq(
  $$
    with changed as (
      update public.reviews
      set title = 'Cross-owner write'
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
      returning id
    )
    select count(*)::bigint from changed
  $$,
  $$ values (0::bigint) $$,
  'an authenticated owner cannot update another owner review'
);
select lives_ok(
  $$
    insert into public.reviews (
      owner_id,
      title,
      content_type,
      source_input_type,
      word_count,
      brief_present,
      status,
      delete_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'Owner-created review',
      'other',
      'pasted_text',
      350,
      false,
      'draft',
      now() + interval '30 days'
    )
  $$,
  'an authenticated owner can create a review without writing ciphertext'
);
select throws_ok(
  $$
    insert into public.reviews (
      owner_id,
      title,
      content_type,
      source_input_type,
      word_count,
      brief_present,
      status,
      delete_at
    ) values (
      '22222222-2222-4222-8222-222222222222',
      'Wrong owner',
      'other',
      'pasted_text',
      350,
      false,
      'draft',
      now() + interval '30 days'
    )
  $$,
  '42501',
  null,
  'an authenticated user cannot create a review for another owner'
);
select results_eq(
  $$
    select sum(row_count)::bigint
    from (
      select count(*) as row_count from public.requirements
      union all
      select count(*) from public.analysis_modules
      union all
      select count(*) from public.issues
      union all
      select count(*) from public.review_decisions
      union all
      select count(*) from public.review_files
    ) child_counts
  $$,
  $$ values (5::bigint) $$,
  'an authenticated owner can read all children of their own review'
);
select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);
select results_eq(
  $$
    select sum(row_count)::bigint
    from (
      select count(*) as row_count from public.requirements
      union all
      select count(*) from public.analysis_modules
      union all
      select count(*) from public.issues
      union all
      select count(*) from public.review_decisions
      union all
      select count(*) from public.review_files
    ) child_counts
  $$,
  $$ values (0::bigint) $$,
  'an authenticated user cannot read another owner review children'
);
select throws_ok(
  $$
    insert into public.requirements (
      review_id,
      category,
      requirement_text,
      is_critical
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'required_point',
      'Cross-owner requirement',
      true
    )
  $$,
  '42501',
  null,
  'an authenticated user cannot add a child to another owner review'
);
select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'review-source',
      '22222222-2222-4222-8222-222222222222/review/source.txt',
      '22222222-2222-4222-8222-222222222222'
    )
  $$,
  'an authenticated owner can create a storage object in their path'
);
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'review-source',
      '11111111-1111-4111-8111-111111111111/review/source.txt',
      '22222222-2222-4222-8222-222222222222'
    )
  $$,
  '42501',
  null,
  'an authenticated user cannot create an object in another owner path'
);
select results_eq(
  $$ select name from storage.objects where bucket_id = 'review-source' $$,
  $$ values ('22222222-2222-4222-8222-222222222222/review/source.txt'::text) $$,
  'an authenticated owner sees only storage objects in their path'
);
reset role;

set local role anon;
select results_eq(
  $$ select count(*)::bigint from storage.objects where bucket_id = 'review-source' $$,
  $$ values (0::bigint) $$,
  'anonymous users cannot read private review storage objects'
);
reset role;

select lives_ok(
  $$ delete from public.reviews where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' $$,
  'a trusted delete can remove a review with children'
);
select results_eq(
  $$
    select child_table, remaining
    from (
      select 'analysis_modules'::text as child_table, count(*)::bigint as remaining
      from public.analysis_modules
      where review_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      union all
      select 'issues', count(*)
      from public.issues
      where review_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      union all
      select 'requirements', count(*)
      from public.requirements
      where review_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      union all
      select 'review_decisions', count(*)
      from public.review_decisions
      where review_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      union all
      select 'review_files', count(*)
      from public.review_files
      where review_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    ) counts
    order by child_table
  $$,
  $$
    values
      ('analysis_modules'::text, 0::bigint),
      ('issues'::text, 0::bigint),
      ('requirements'::text, 0::bigint),
      ('review_decisions'::text, 0::bigint),
      ('review_files'::text, 0::bigint)
  $$,
  'deleting a review cascades to every review child'
);

\else

select * from skip(21, 'alpha schema migration is not present yet');

\endif

select * from finish();

rollback;

begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions version '1.2';

select plan(70);

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
      anonymous_access_token_hash,
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
        null,
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
        null,
        'Owner two review',
        'seo_article',
        'uploaded_file',
        700,
        false,
        'queued',
        decode('02', 'hex'),
        now() + interval '30 days'
      ),
      (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
        '11111111-1111-4111-8111-111111111111',
        null,
        'Owner one empty review',
        'other',
        'pasted_text',
        400,
        false,
        'draft',
        decode('03', 'hex'),
        now() + interval '30 days'
      ),
      (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
        null,
        'anonymous-review-token-hash',
        'Anonymous review',
        'other',
        'pasted_text',
        450,
        false,
        'draft',
        decode('04', 'hex'),
        now() + interval '24 hours'
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
    ), (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc2',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'recommended_point',
      'Retain this linked requirement',
      false
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
      related_requirement_id,
      explanation,
      suggested_action
    ) values (
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'brief_fit',
      'required_point_missing',
      'critical',
      null,
      'The required example is absent.',
      'Add the required example.'
    ), (
      'dddddddd-dddd-4ddd-8ddd-ddddddddddc2',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'brief_fit',
      'recommended_point_missing',
      'minor',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc2',
      'The recommended point is absent.',
      'Consider adding the recommended point.'
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

select throws_ok(
  $$
    insert into public.issues (
      id,
      review_id,
      module,
      issue_type,
      severity,
      related_requirement_id,
      explanation,
      suggested_action
    ) values (
      'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'brief_fit',
      'cross_review_requirement',
      'major',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'This issue links to another review.',
      'Reject the cross-review link.'
    )
  $$,
  '23503',
  null,
  'an issue cannot reference a requirement from another review'
);
delete from public.issues where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';

select lives_ok(
  $$
    delete from public.requirements
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc2'
  $$,
  'deleting a linked requirement does not delete its issue'
);
select results_eq(
  $$
    select review_id, related_requirement_id
    from public.issues
    where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddc2'
  $$,
  $$
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid,
      null::uuid
    )
  $$,
  'requirement deletion nulls only the issue requirement link'
);
delete from public.issues where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddc2';

set local role service_role;
select throws_ok(
  $$
    insert into public.review_files (
      id,
      review_id,
      file_kind,
      object_path,
      mime_type,
      size_bytes
    ) values (
      'ffffffff-ffff-4fff-8fff-ffffffffff01',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'source',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3/source.txt',
      'text/plain',
      100
    )
  $$,
  '23514',
  null,
  'service-role writes require an authenticated review file path to start with owner_id'
);
delete from public.review_files where id = 'ffffffff-ffff-4fff-8fff-ffffffffff01';

select lives_ok(
  $$
    insert into public.review_files (
      id,
      review_id,
      file_kind,
      object_path,
      mime_type,
      size_bytes
    ) values (
      'ffffffff-ffff-4fff-8fff-ffffffffff03',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'source',
      '11111111-1111-4111-8111-111111111111/owner-boundary.txt',
      'text/plain',
      100
    );

    update public.reviews
    set status = 'reviewing'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  $$,
  'service-role can create a valid file and update non-owner review fields'
);
select throws_ok(
  $$
    update public.reviews
    set owner_id = '22222222-2222-4222-8222-222222222222'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
  $$,
  '23514',
  null,
  'service-role cannot change a review owner boundary while files exist'
);
select results_eq(
  $$
    select
      reviews.owner_id,
      split_part(review_files.object_path, '/', 1)::text collate "C"
    from public.reviews
    join public.review_files
      on review_files.review_id = reviews.id
    where reviews.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
      and review_files.id = 'ffffffff-ffff-4fff-8fff-ffffffffff03'
  $$,
  $$
    values (
      '11111111-1111-4111-8111-111111111111'::uuid,
      '11111111-1111-4111-8111-111111111111'::text collate "C"
    )
  $$,
  'a rejected owner-boundary update preserves the valid file prefix'
);
update public.reviews
set
  owner_id = '11111111-1111-4111-8111-111111111111',
  status = 'draft'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
delete from public.review_files where id = 'ffffffff-ffff-4fff-8fff-ffffffffff03';

select lives_ok(
  $$
    insert into public.review_files (
      id,
      review_id,
      file_kind,
      object_path,
      mime_type,
      size_bytes
    ) values (
      'ffffffff-ffff-4fff-8fff-ffffffffff02',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
      'source',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4/source.txt',
      'text/plain',
      100
    )
  $$,
  'service-role writes accept an anonymous review file path starting with review_id'
);
select throws_ok(
  $$
    update public.review_files
    set object_path = '11111111-1111-4111-8111-111111111111/anonymous/source.txt'
    where id = 'ffffffff-ffff-4fff-8fff-ffffffffff02'
  $$,
  '23514',
  null,
  'service-role updates cannot move anonymous review metadata outside its review_id prefix'
);
update public.review_files
set object_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4/source.txt'
where id = 'ffffffff-ffff-4fff-8fff-ffffffffff02';
reset role;

select extensions.dblink_connect(
  'task_3_review_file_race',
  'hostaddr=' || host(inet_server_addr())
    || ' port=' || inet_server_port()
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select extensions.dblink_exec(
  'task_3_review_file_race',
  $$
    delete from public.reviews
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac0';

    delete from auth.users
    where id = '33333333-3333-4333-8333-3333333333c0'
  $$
);
select extensions.dblink_exec(
  'task_3_review_file_race',
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
    ) values (
      '33333333-3333-4333-8333-3333333333c0',
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'task-3-concurrency-owner@example.test',
      '',
      now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(),
      now()
    )
  $$
);
select extensions.dblink_exec(
  'task_3_review_file_race',
  $$
    insert into public.reviews (
      id,
      owner_id,
      title,
      content_type,
      source_input_type,
      word_count,
      brief_present,
      status,
      delete_at
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac0',
      '33333333-3333-4333-8333-3333333333c0',
      'Task 3 concurrency review',
      'other',
      'uploaded_file',
      100,
      false,
      'draft',
      now() + interval '1 day'
    )
  $$
);
select extensions.dblink_exec('task_3_review_file_race', 'begin');
select extensions.dblink_exec(
  'task_3_review_file_race',
  $$
    insert into public.review_files (
      id,
      review_id,
      file_kind,
      object_path,
      mime_type,
      size_bytes
    ) values (
      'ffffffff-ffff-4fff-8fff-ffffffffffc0',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac0',
      'source',
      '33333333-3333-4333-8333-3333333333c0/source.txt',
      'text/plain',
      100
    )
  $$
);
select current_setting('lock_timeout') as task_3_previous_lock_timeout \gset
select set_config('lock_timeout', '250ms', true);
set local role service_role;
select throws_ok(
  $$
    do $concurrent_owner_update$
    begin
      update public.reviews
      set owner_id = '22222222-2222-4222-8222-222222222222'
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac0';

      raise exception 'concurrent owner update unexpectedly succeeded'
        using errcode = 'P0001';
    end
    $concurrent_owner_update$
  $$,
  '55P03',
  null,
  'an open review file insert blocks a concurrent owner-boundary update'
);
reset role;
select set_config('lock_timeout', :'task_3_previous_lock_timeout', true);
select extensions.dblink_exec('task_3_review_file_race', 'rollback');
select extensions.dblink_exec(
  'task_3_review_file_race',
  $$
    delete from public.reviews
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac0';

    delete from auth.users
    where id = '33333333-3333-4333-8333-3333333333c0'
  $$
);
select extensions.dblink_disconnect('task_3_review_file_race');

select throws_ok(
  $$
    insert into public.analysis_modules (
      id, review_id, module, status, ai_risk
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'editorial_quality',
      'complete',
      'low'
    )
  $$,
  '23514',
  null,
  'non-AI modules cannot persist an AI risk value'
);
delete from public.analysis_modules where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
select throws_ok(
  $$
    insert into public.analysis_modules (
      id, review_id, module, status, ai_risk
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'ai_risk',
      'complete',
      'not_assessed'
    )
  $$,
  '23514',
  null,
  'a completed AI-risk module requires low, medium, or high risk'
);
delete from public.analysis_modules where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
select throws_ok(
  $$
    insert into public.analysis_modules (
      id, review_id, module, status, ai_risk
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccc05',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'ai_risk',
      'complete',
      null
    )
  $$,
  '23514',
  null,
  'a completed AI-risk module cannot omit its risk value'
);
delete from public.analysis_modules where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc05';
select throws_ok(
  $$
    insert into public.analysis_modules (
      id, review_id, module, status, ai_risk
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccc03',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'ai_risk',
      'not_assessed',
      'high'
    )
  $$,
  '23514',
  null,
  'a not-assessed AI-risk module stores only not_assessed risk'
);
delete from public.analysis_modules where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc03';
select throws_ok(
  $$
    insert into public.analysis_modules (
      id, review_id, module, status, ai_risk
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccc06',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'ai_risk',
      'not_assessed',
      null
    )
  $$,
  '23514',
  null,
  'a not-assessed AI-risk module cannot omit not_assessed risk'
);
delete from public.analysis_modules where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc06';
select throws_ok(
  $$
    insert into public.analysis_modules (
      id, review_id, module, status, ai_risk
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccc04',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'ai_risk',
      'queued',
      'medium'
    )
  $$,
  '23514',
  null,
  'a queued AI-risk module cannot persist a risk value'
);
delete from public.analysis_modules where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc04';
select throws_ok(
  $$
    insert into public.analysis_modules (
      id, review_id, module, status, ai_risk
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccc07',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'ai_risk',
      'reviewing',
      'low'
    )
  $$,
  '23514',
  null,
  'a reviewing AI-risk module cannot persist a risk value'
);
delete from public.analysis_modules where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc07';
select throws_ok(
  $$
    insert into public.analysis_modules (
      id, review_id, module, status, ai_risk
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccc08',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'ai_risk',
      'unavailable',
      'high'
    )
  $$,
  '23514',
  null,
  'an unavailable AI-risk module cannot persist a risk value'
);
delete from public.analysis_modules where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc08';

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
      '11111111-1111-4111-8111-111111111111',
      'Anonymous direct write',
      'other',
      'pasted_text',
      350,
      false,
      'draft',
      now() + interval '1 day'
    )
  $$,
  '42501',
  null,
  'anonymous users cannot create reviews directly'
);
select throws_ok(
  $$
    insert into public.requirements (
      review_id, category, requirement_text, is_critical
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'required_point',
      'Anonymous direct requirement',
      true
    )
  $$,
  '42501',
  null,
  'anonymous users cannot create requirements directly'
);
select throws_ok(
  $$
    insert into public.analysis_modules (review_id, module, status)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'evidence_citations',
      'queued'
    )
  $$,
  '42501',
  null,
  'anonymous users cannot create analysis modules directly'
);
select throws_ok(
  $$
    insert into public.issues (
      review_id,
      module,
      issue_type,
      severity,
      explanation,
      suggested_action
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'editorial_quality',
      'anonymous_direct_issue',
      'minor',
      'Anonymous direct issue.',
      'Reject the direct write.'
    )
  $$,
  '42501',
  null,
  'anonymous users cannot create issues directly'
);
select throws_ok(
  $$
    insert into public.review_decisions (review_id, decision)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'ready'
    )
  $$,
  '42501',
  null,
  'anonymous users cannot create review decisions directly'
);
select throws_ok(
  $$
    insert into public.review_files (
      review_id,
      file_kind,
      object_path,
      mime_type,
      size_bytes
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'source',
      '11111111-1111-4111-8111-111111111111/anonymous-direct.txt',
      'text/plain',
      100
    )
  $$,
  '42501',
  null,
  'anonymous users cannot create review files directly'
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
  $$
    values
      ('Owner one empty review'::text),
      ('Owner one review'::text)
  $$,
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
select throws_ok(
  $$
    insert into public.analysis_modules (review_id, module, status)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'evidence_citations',
      'queued'
    )
  $$,
  '42501',
  null,
  'an authenticated user cannot add an analysis module to another owner review'
);
select throws_ok(
  $$
    insert into public.issues (
      review_id,
      module,
      issue_type,
      severity,
      explanation,
      suggested_action
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'editorial_quality',
      'cross_owner_issue',
      'minor',
      'Cross-owner issue.',
      'Reject the cross-owner write.'
    )
  $$,
  '42501',
  null,
  'an authenticated user cannot add an issue to another owner review'
);
select throws_ok(
  $$
    insert into public.review_decisions (review_id, decision)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'ready'
    )
  $$,
  '42501',
  null,
  'an authenticated user cannot add a decision to another owner review'
);
select throws_ok(
  $$
    insert into public.review_files (
      review_id,
      file_kind,
      object_path,
      mime_type,
      size_bytes
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'source',
      '11111111-1111-4111-8111-111111111111/cross-owner.txt',
      'text/plain',
      100
    )
  $$,
  '42501',
  null,
  'an authenticated user cannot add file metadata to another owner review'
);
select results_eq(
  $$
    with changed as (
      update public.requirements
      set category = 'cross_owner_update'
      where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      returning id
    )
    select count(*)::bigint from changed
  $$,
  $$ values (0::bigint) $$,
  'an authenticated user cannot update another owner requirement'
);
select results_eq(
  $$
    with changed as (
      update public.analysis_modules
      set status = 'reviewing'
      where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      returning id
    )
    select count(*)::bigint from changed
  $$,
  $$ values (0::bigint) $$,
  'an authenticated user cannot update another owner analysis module'
);
select results_eq(
  $$
    with changed as (
      update public.issues
      set explanation = 'Cross-owner update'
      where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      returning id
    )
    select count(*)::bigint from changed
  $$,
  $$ values (0::bigint) $$,
  'an authenticated user cannot update another owner issue'
);
select results_eq(
  $$
    with changed as (
      update public.review_decisions
      set decision = 'ready'
      where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
      returning id
    )
    select count(*)::bigint from changed
  $$,
  $$ values (0::bigint) $$,
  'an authenticated user cannot update another owner decision'
);
select results_eq(
  $$
    with changed as (
      update public.review_files
      set mime_type = 'application/pdf'
      where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
      returning id
    )
    select count(*)::bigint from changed
  $$,
  $$ values (0::bigint) $$,
  'an authenticated user cannot update another owner file metadata'
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

select * from skip(53, 'alpha schema migration is not present yet');

\endif

select * from finish();

rollback;

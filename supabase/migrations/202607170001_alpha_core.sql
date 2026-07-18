create extension if not exists pgcrypto with schema extensions;

create type public.analysis_module as enum (
  'brief_fit',
  'evidence_citations',
  'editorial_quality',
  'ai_risk'
);

create type public.module_status as enum (
  'queued',
  'reviewing',
  'complete',
  'not_assessed',
  'unavailable'
);

create type public.issue_severity as enum ('critical', 'major', 'minor');
create type public.ai_risk as enum ('low', 'medium', 'high', 'not_assessed');
create type public.system_recommendation as enum (
  'ready_to_approve',
  'request_revisions',
  'manual_review_required'
);
create type public.user_decision as enum (
  'ready',
  'revisions_requested',
  'manually_reviewed'
);
create type public.review_status as enum (
  'draft',
  'extracting',
  'awaiting_brief_confirmation',
  'queued',
  'reviewing',
  'completed',
  'partial',
  'failed',
  'deleted'
);
create type public.content_type as enum (
  'blog_post',
  'seo_article',
  'thought_leadership',
  'other'
);
create type public.source_input_type as enum ('pasted_text', 'uploaded_file');
create type public.requirement_evaluation as enum (
  'met',
  'partial',
  'missing',
  'not_assessed'
);
create type public.file_kind as enum ('source', 'brief');
create type public.confidence_band as enum ('low', 'medium', 'high');

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  anonymous_access_token_hash text unique,
  title text not null check (length(trim(title)) > 0),
  content_type public.content_type not null,
  source_input_type public.source_input_type not null,
  original_filename text,
  word_count integer not null check (word_count >= 0),
  brief_present boolean not null default false,
  status public.review_status not null default 'draft',
  source_text_encrypted bytea,
  overall_score integer check (overall_score between 0 and 100),
  system_recommendation public.system_recommendation,
  delete_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_owner_boundary check (
    num_nonnulls(owner_id, anonymous_access_token_hash) = 1
  )
);

create table public.requirements (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  category text not null check (length(trim(category)) > 0),
  source_excerpt text,
  requirement_text text not null check (length(trim(requirement_text)) > 0),
  is_critical boolean not null default false,
  user_confirmed boolean not null default false,
  evaluation_result public.requirement_evaluation,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.analysis_modules (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  module public.analysis_module not null,
  status public.module_status not null default 'queued',
  score integer check (score between 0 and 100),
  ai_risk public.ai_risk,
  summary text,
  caveats text[] not null default '{}',
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, module),
  constraint analysis_modules_ai_risk_scope check (
    module = 'ai_risk' or ai_risk is null
  )
);

create table public.issues (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  module public.analysis_module not null,
  issue_type text not null check (length(trim(issue_type)) > 0),
  severity public.issue_severity not null,
  source_excerpt text,
  source_start integer check (source_start is null or source_start >= 0),
  source_end integer check (
    source_end is null or source_end >= coalesce(source_start, 0)
  ),
  related_requirement_id uuid references public.requirements(id) on delete set null,
  explanation text not null check (length(trim(explanation)) > 0),
  suggested_action text not null check (length(trim(suggested_action)) > 0),
  confidence public.confidence_band,
  user_feedback boolean,
  include_in_writer_checklist boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint issues_ai_risk_not_critical check (
    module <> 'ai_risk' or severity <> 'critical'
  )
);

create table public.review_decisions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null unique references public.reviews(id) on delete cascade,
  decision public.user_decision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.review_files (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  file_kind public.file_kind not null,
  object_path text not null unique check (length(trim(object_path)) > 0),
  original_filename text,
  mime_type text not null check (length(trim(mime_type)) > 0),
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, file_kind)
);

create index reviews_owner_id_idx on public.reviews(owner_id);
create index reviews_delete_at_idx on public.reviews(delete_at);
create index requirements_review_id_idx on public.requirements(review_id);
create index analysis_modules_review_id_idx on public.analysis_modules(review_id);
create index issues_review_id_idx on public.issues(review_id);
create index review_files_review_id_idx on public.review_files(review_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger reviews_set_updated_at
before update on public.reviews
for each row execute function public.set_updated_at();
create trigger requirements_set_updated_at
before update on public.requirements
for each row execute function public.set_updated_at();
create trigger analysis_modules_set_updated_at
before update on public.analysis_modules
for each row execute function public.set_updated_at();
create trigger issues_set_updated_at
before update on public.issues
for each row execute function public.set_updated_at();
create trigger review_decisions_set_updated_at
before update on public.review_decisions
for each row execute function public.set_updated_at();
create trigger review_files_set_updated_at
before update on public.review_files
for each row execute function public.set_updated_at();

alter table public.reviews enable row level security;
alter table public.requirements enable row level security;
alter table public.analysis_modules enable row level security;
alter table public.issues enable row level security;
alter table public.review_decisions enable row level security;
alter table public.review_files enable row level security;

revoke all on table public.reviews from public, anon, authenticated;
revoke all on table public.requirements from public, anon, authenticated;
revoke all on table public.analysis_modules from public, anon, authenticated;
revoke all on table public.issues from public, anon, authenticated;
revoke all on table public.review_decisions from public, anon, authenticated;
revoke all on table public.review_files from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

grant select (
  id,
  owner_id,
  title,
  content_type,
  source_input_type,
  original_filename,
  word_count,
  brief_present,
  status,
  overall_score,
  system_recommendation,
  delete_at,
  created_at,
  updated_at
) on public.reviews to authenticated;
grant insert (
  owner_id,
  title,
  content_type,
  source_input_type,
  original_filename,
  word_count,
  brief_present,
  status,
  overall_score,
  system_recommendation,
  delete_at
) on public.reviews to authenticated;
grant update (
  title,
  content_type,
  source_input_type,
  original_filename,
  word_count,
  brief_present,
  status,
  overall_score,
  system_recommendation,
  delete_at
) on public.reviews to authenticated;
grant delete on public.reviews to authenticated;

grant select, insert, update, delete on public.requirements to authenticated;
grant select, insert, update, delete on public.analysis_modules to authenticated;
grant select, insert, update, delete on public.issues to authenticated;
grant select, insert, update, delete on public.review_decisions to authenticated;
grant select, insert, update, delete on public.review_files to authenticated;

grant all on table public.reviews to service_role;
grant all on table public.requirements to service_role;
grant all on table public.analysis_modules to service_role;
grant all on table public.issues to service_role;
grant all on table public.review_decisions to service_role;
grant all on table public.review_files to service_role;

create policy "Authenticated owners can select reviews"
on public.reviews for select
to authenticated
using (owner_id = (select auth.uid()));
create policy "Authenticated owners can insert reviews"
on public.reviews for insert
to authenticated
with check (owner_id = (select auth.uid()));
create policy "Authenticated owners can update reviews"
on public.reviews for update
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));
create policy "Authenticated owners can delete reviews"
on public.reviews for delete
to authenticated
using (owner_id = (select auth.uid()));

create policy "Authenticated owners can select requirements"
on public.requirements for select
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = requirements.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can insert requirements"
on public.requirements for insert
to authenticated
with check (
  exists (
    select 1 from public.reviews
    where reviews.id = requirements.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can update requirements"
on public.requirements for update
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = requirements.review_id
      and reviews.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.reviews
    where reviews.id = requirements.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can delete requirements"
on public.requirements for delete
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = requirements.review_id
      and reviews.owner_id = (select auth.uid())
  )
);

create policy "Authenticated owners can select analysis modules"
on public.analysis_modules for select
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = analysis_modules.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can insert analysis modules"
on public.analysis_modules for insert
to authenticated
with check (
  exists (
    select 1 from public.reviews
    where reviews.id = analysis_modules.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can update analysis modules"
on public.analysis_modules for update
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = analysis_modules.review_id
      and reviews.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.reviews
    where reviews.id = analysis_modules.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can delete analysis modules"
on public.analysis_modules for delete
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = analysis_modules.review_id
      and reviews.owner_id = (select auth.uid())
  )
);

create policy "Authenticated owners can select issues"
on public.issues for select
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = issues.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can insert issues"
on public.issues for insert
to authenticated
with check (
  exists (
    select 1 from public.reviews
    where reviews.id = issues.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can update issues"
on public.issues for update
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = issues.review_id
      and reviews.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.reviews
    where reviews.id = issues.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can delete issues"
on public.issues for delete
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = issues.review_id
      and reviews.owner_id = (select auth.uid())
  )
);

create policy "Authenticated owners can select review decisions"
on public.review_decisions for select
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = review_decisions.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can insert review decisions"
on public.review_decisions for insert
to authenticated
with check (
  exists (
    select 1 from public.reviews
    where reviews.id = review_decisions.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can update review decisions"
on public.review_decisions for update
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = review_decisions.review_id
      and reviews.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.reviews
    where reviews.id = review_decisions.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can delete review decisions"
on public.review_decisions for delete
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = review_decisions.review_id
      and reviews.owner_id = (select auth.uid())
  )
);

create policy "Authenticated owners can select review files"
on public.review_files for select
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = review_files.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can insert review files"
on public.review_files for insert
to authenticated
with check (
  exists (
    select 1 from public.reviews
    where reviews.id = review_files.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can update review files"
on public.review_files for update
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = review_files.review_id
      and reviews.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.reviews
    where reviews.id = review_files.review_id
      and reviews.owner_id = (select auth.uid())
  )
);
create policy "Authenticated owners can delete review files"
on public.review_files for delete
to authenticated
using (
  exists (
    select 1 from public.reviews
    where reviews.id = review_files.review_id
      and reviews.owner_id = (select auth.uid())
  )
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'review-source',
  'review-source',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
);

create policy "Authenticated owners can select review source objects"
on storage.objects for select
to authenticated
using (
  bucket_id = 'review-source'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
create policy "Authenticated owners can insert review source objects"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'review-source'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
create policy "Authenticated owners can update review source objects"
on storage.objects for update
to authenticated
using (
  bucket_id = 'review-source'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'review-source'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
create policy "Authenticated owners can delete review source objects"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'review-source'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

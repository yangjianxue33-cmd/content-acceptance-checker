create function public.create_anonymous_review(
  p_review_id uuid,
  p_access_token_hash text,
  p_title text,
  p_content_type public.content_type,
  p_source_input_type public.source_input_type,
  p_original_filename text,
  p_word_count integer,
  p_brief_present boolean,
  p_status public.review_status,
  p_source_text_encrypted bytea,
  p_delete_at timestamptz,
  p_files jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplied_files jsonb := coalesce(p_files, '[]'::jsonb);
  source_file_count integer;
  brief_file_count integer;
  source_filename text;
begin
  if p_access_token_hash is null or p_access_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'anonymous access token hash must be a lowercase sha256 digest'
      using errcode = '23514';
  end if;

  if p_source_text_encrypted is null or octet_length(p_source_text_encrypted) = 0 then
    raise exception 'encrypted source text is required'
      using errcode = '23514';
  end if;

  if p_word_count < 0 or p_word_count > 5000 then
    raise exception 'word count must be between 0 and 5000'
      using errcode = '23514';
  end if;

  if p_delete_at < now() + interval '23 hours'
    or p_delete_at > now() + interval '25 hours' then
    raise exception 'anonymous retention must be approximately 24 hours'
      using errcode = '23514';
  end if;

  if jsonb_typeof(supplied_files) <> 'array'
    or jsonb_array_length(supplied_files) > 2 then
    raise exception 'review files must be an array with at most two entries'
      using errcode = '23514';
  end if;

  select
    count(*) filter (where file_kind = 'source'),
    count(*) filter (where file_kind = 'brief'),
    max(original_filename) filter (where file_kind = 'source')
  into source_file_count, brief_file_count, source_filename
  from jsonb_to_recordset(supplied_files) as supplied_file(
    file_kind public.file_kind,
    original_filename text
  );

  if (p_brief_present and (p_status <> 'awaiting_brief_confirmation' or brief_file_count <> 1))
    or (not p_brief_present and (p_status <> 'queued' or brief_file_count <> 0)) then
    raise exception 'brief flag, status, and brief metadata are inconsistent'
      using errcode = '23514';
  end if;

  if (p_source_input_type = 'uploaded_file' and (
      p_original_filename is null
      or length(trim(p_original_filename)) = 0
      or source_file_count <> 1
      or source_filename is distinct from p_original_filename
    ))
    or (p_source_input_type = 'pasted_text' and (
      p_original_filename is not null
      or source_file_count <> 0
    )) then
    raise exception 'source input and source metadata are inconsistent'
      using errcode = '23514';
  end if;

  insert into public.reviews (
    id,
    anonymous_access_token_hash,
    title,
    content_type,
    source_input_type,
    original_filename,
    word_count,
    brief_present,
    status,
    source_text_encrypted,
    delete_at
  ) values (
    p_review_id,
    p_access_token_hash,
    p_title,
    p_content_type,
    p_source_input_type,
    p_original_filename,
    p_word_count,
    p_brief_present,
    p_status,
    p_source_text_encrypted,
    p_delete_at
  );

  insert into public.review_files (
    review_id,
    file_kind,
    object_path,
    original_filename,
    mime_type,
    size_bytes
  )
  select
    p_review_id,
    supplied_file.file_kind,
    supplied_file.object_path,
    supplied_file.original_filename,
    supplied_file.mime_type,
    supplied_file.size_bytes
  from jsonb_to_recordset(supplied_files) as supplied_file(
    file_kind public.file_kind,
    object_path text,
    original_filename text,
    mime_type text,
    size_bytes bigint
  );

  return p_review_id;
end;
$$;

revoke all on function public.create_anonymous_review(
  uuid,
  text,
  text,
  public.content_type,
  public.source_input_type,
  text,
  integer,
  boolean,
  public.review_status,
  bytea,
  timestamptz,
  jsonb
) from public, anon, authenticated;

grant execute on function public.create_anonymous_review(
  uuid,
  text,
  text,
  public.content_type,
  public.source_input_type,
  text,
  integer,
  boolean,
  public.review_status,
  bytea,
  timestamptz,
  jsonb
) to service_role;

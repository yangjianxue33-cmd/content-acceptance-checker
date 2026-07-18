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
begin
  if p_access_token_hash is null or length(trim(p_access_token_hash)) = 0 then
    raise exception 'anonymous access token hash is required'
      using errcode = '23514';
  end if;

  if p_source_text_encrypted is null or octet_length(p_source_text_encrypted) = 0 then
    raise exception 'encrypted source text is required'
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
  from jsonb_to_recordset(coalesce(p_files, '[]'::jsonb)) as supplied_file(
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

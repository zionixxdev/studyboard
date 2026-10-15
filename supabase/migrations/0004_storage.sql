-- =============================================================================
-- StudyBoard — 0004_storage.sql
-- Private bucket for PDFs and images, with room-scoped access. Object paths
-- follow `<room_id>/<uuid>-<filename>`; membership is resolved from the first
-- path segment, so a file can only be read or written by members of its room.
-- =============================================================================

-- Safe text->uuid cast: a malformed path segment yields NULL (=> access denied)
-- instead of raising inside a policy expression.
create or replace function public.try_uuid(p text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

revoke all on function public.try_uuid(text) from public;
grant execute on function public.try_uuid(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Private bucket, 25 MB per object, PDF + common image types only.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'room-files', 'room-files', false, 26214400,
  array['application/pdf','image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- Object policies. (storage.foldername(name))[1] is the room id.
-- -----------------------------------------------------------------------------
drop policy if exists room_files_read on storage.objects;
create policy room_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'room-files'
    and public.can_access_room(public.try_uuid((storage.foldername(name))[1]))
  );

drop policy if exists room_files_insert on storage.objects;
create policy room_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'room-files'
    and public.is_room_member(public.try_uuid((storage.foldername(name))[1]))
  );

drop policy if exists room_files_delete on storage.objects;
create policy room_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'room-files'
    and public.can_access_room(public.try_uuid((storage.foldername(name))[1]))
  );

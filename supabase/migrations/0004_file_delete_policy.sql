-- ============================================================================
-- StudyBoard — 0004_file_delete_policy.sql
-- Tighten who may delete an object in the `room-files` bucket: the uploader, or
-- a room owner/moderator. This matches the rule already enforced on the
-- public.files table, so a plain member cannot delete an object and orphan the
-- row that points at it.
-- Run after 0002_rls.sql.
-- ============================================================================

drop policy if exists "room files delete" on storage.objects;
create policy "room files delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'room-files'
    and exists (
      select 1
      from public.files f
      where f.storage_path = name
        and (
          f.uploader_id = auth.uid()
          or public.can_manage_room(f.room_id, auth.uid())
        )
    )
  );

-- ============================================================================
-- StudyBoard — 0002_rls.sql
-- Row Level Security for every sensitive table, plus storage policies.
-- Run after 0001_init.sql.
--
-- Design notes:
--  * Membership and role checks live in SECURITY DEFINER helper functions so
--    policies never recurse into each other.
--  * The browser is never trusted: it cannot set its own role, membership, or
--    room ownership — those are written only by the SECURITY DEFINER RPCs in
--    0003_functions.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they bypass RLS internally)
-- ----------------------------------------------------------------------------
create or replace function public.is_room_member(p_room uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room and user_id = p_user
  );
$$;

create or replace function public.room_role(p_room uuid, p_user uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.room_members where room_id = p_room and user_id = p_user;
$$;

create or replace function public.can_manage_room(p_room uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.room_role(p_room, p_user) in ('owner', 'moderator'), false);
$$;

-- ----------------------------------------------------------------------------
-- Enable RLS
-- ----------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.rooms                enable row level security;
alter table public.room_members         enable row level security;
alter table public.messages             enable row level security;
alter table public.whiteboard_snapshots enable row level security;
alter table public.files                enable row level security;
alter table public.room_state           enable row level security;

-- ----------------------------------------------------------------------------
-- profiles
--   Anyone signed in may read basic profiles (needed to show names/avatars).
--   You may only update your own row. Rows are created by the auth trigger.
-- ----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ----------------------------------------------------------------------------
-- rooms
--   Members can read their rooms; only the owner can modify/delete.
--   Inserts happen exclusively through create_room() (SECURITY DEFINER).
-- ----------------------------------------------------------------------------
drop policy if exists rooms_select_member on public.rooms;
create policy rooms_select_member on public.rooms
  for select to authenticated
  using (public.is_room_member(id, auth.uid()));

drop policy if exists rooms_update_owner on public.rooms;
create policy rooms_update_owner on public.rooms
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists rooms_delete_owner on public.rooms;
create policy rooms_delete_owner on public.rooms
  for delete to authenticated
  using (owner_id = auth.uid());

-- ----------------------------------------------------------------------------
-- room_members
--   Members can see the roster. All writes go through RPCs.
-- ----------------------------------------------------------------------------
drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members
  for select to authenticated
  using (public.is_room_member(room_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- messages
--   Members can read; you may only insert messages as yourself into a room
--   you belong to. No update/delete policies => messages are immutable here.
-- ----------------------------------------------------------------------------
drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages
  for select to authenticated
  using (public.is_room_member(room_id, auth.uid()));

drop policy if exists messages_insert_self on public.messages;
create policy messages_insert_self on public.messages
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_room_member(room_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- whiteboard_snapshots
--   Members can read and upsert the shared scene.
-- ----------------------------------------------------------------------------
drop policy if exists wb_select_member on public.whiteboard_snapshots;
create policy wb_select_member on public.whiteboard_snapshots
  for select to authenticated
  using (public.is_room_member(room_id, auth.uid()));

drop policy if exists wb_insert_member on public.whiteboard_snapshots;
create policy wb_insert_member on public.whiteboard_snapshots
  for insert to authenticated
  with check (public.is_room_member(room_id, auth.uid()));

drop policy if exists wb_update_member on public.whiteboard_snapshots;
create policy wb_update_member on public.whiteboard_snapshots
  for update to authenticated
  using (public.is_room_member(room_id, auth.uid()))
  with check (public.is_room_member(room_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- files
--   Members can read; you may insert as yourself; uploader or a manager may
--   delete.
-- ----------------------------------------------------------------------------
drop policy if exists files_select_member on public.files;
create policy files_select_member on public.files
  for select to authenticated
  using (public.is_room_member(room_id, auth.uid()));

drop policy if exists files_insert_self on public.files;
create policy files_insert_self on public.files
  for insert to authenticated
  with check (uploader_id = auth.uid() and public.is_room_member(room_id, auth.uid()));

drop policy if exists files_delete_owner_or_manager on public.files;
create policy files_delete_owner_or_manager on public.files
  for delete to authenticated
  using (uploader_id = auth.uid() or public.can_manage_room(room_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- room_state
--   Members can read. Writes are RPC-only (set_room_timer, and PDF page sync),
--   so there is deliberately no insert/update policy here.
-- ----------------------------------------------------------------------------
drop policy if exists room_state_select_member on public.room_state;
create policy room_state_select_member on public.room_state
  for select to authenticated
  using (public.is_room_member(room_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- Storage policies for the private `room-files` bucket.
--   Object paths are `<room_id>/<uuid>-<filename>`, so the first folder
--   segment is the room id.
-- ----------------------------------------------------------------------------
drop policy if exists "room files read" on storage.objects;
create policy "room files read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'room-files'
    and public.is_room_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

drop policy if exists "room files insert" on storage.objects;
create policy "room files insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'room-files'
    and public.is_room_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

drop policy if exists "room files delete" on storage.objects;
create policy "room files delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'room-files'
    and public.is_room_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

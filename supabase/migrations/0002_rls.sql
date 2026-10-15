-- =============================================================================
-- StudyBoard — 0002_rls.sql
-- Membership helpers + Row Level Security for every room-scoped table.
-- All mutations that must be validated server-side (create/join/role changes/
-- board clearing/timer) go through SECURITY DEFINER functions in 0003_rpc.sql;
-- here we only expose the read paths and the few safe direct writes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Membership helpers. SECURITY DEFINER so they bypass RLS and, critically,
-- do not recurse when referenced from policies on room_members itself.
-- -----------------------------------------------------------------------------
create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room and user_id = auth.uid()
  );
$$;

create or replace function public.is_room_owner(p_room uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.rooms
    where id = p_room and owner_id = auth.uid()
  );
$$;

create or replace function public.can_access_room(p_room uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
  select public.is_room_member(p_room) or public.is_room_owner(p_room);
$$;

revoke all on function public.is_room_member(uuid) from public;
revoke all on function public.is_room_owner(uuid)  from public;
revoke all on function public.can_access_room(uuid) from public;
grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_room_owner(uuid)  to authenticated;
grant execute on function public.can_access_room(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere.
-- -----------------------------------------------------------------------------
alter table public.rooms          enable row level security;
alter table public.room_members   enable row level security;
alter table public.invite_codes   enable row level security;
alter table public.board_pages    enable row level security;
alter table public.board_objects  enable row level security;
alter table public.chat_messages  enable row level security;
alter table public.documents      enable row level security;
alter table public.annotations    enable row level security;
alter table public.timer_state    enable row level security;
alter table public.room_events    enable row level security;
alter table public.rate_limits    enable row level security;

-- -----------------------------------------------------------------------------
-- rooms : members read, owner mutates. No INSERT policy -> creation only via
-- the create_room() RPC.
-- -----------------------------------------------------------------------------
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select to authenticated
  using (public.can_access_room(id));

drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms
  for update to authenticated
  using (public.is_room_owner(id))
  with check (public.is_room_owner(id));

drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms
  for delete to authenticated
  using (public.is_room_owner(id));

-- -----------------------------------------------------------------------------
-- room_members : members can read the roster. All writes go through RPCs
-- (join_room / remove_member / set_nickname / leave_room) so that a browser
-- can never insert itself into a room or promote itself.
-- -----------------------------------------------------------------------------
drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members
  for select to authenticated
  using (public.can_access_room(room_id));

-- -----------------------------------------------------------------------------
-- invite_codes : only the room owner may inspect invitation records.
-- -----------------------------------------------------------------------------
drop policy if exists invite_codes_select on public.invite_codes;
create policy invite_codes_select on public.invite_codes
  for select to authenticated
  using (public.is_room_owner(room_id));

-- -----------------------------------------------------------------------------
-- board_pages : members read/create/edit pages; owner deletes pages.
-- -----------------------------------------------------------------------------
drop policy if exists board_pages_select on public.board_pages;
create policy board_pages_select on public.board_pages
  for select to authenticated
  using (public.can_access_room(room_id));

drop policy if exists board_pages_insert on public.board_pages;
create policy board_pages_insert on public.board_pages
  for insert to authenticated
  with check (public.is_room_member(room_id));

drop policy if exists board_pages_update on public.board_pages;
create policy board_pages_update on public.board_pages
  for update to authenticated
  using (public.is_room_member(room_id))
  with check (public.is_room_member(room_id));

drop policy if exists board_pages_delete on public.board_pages;
create policy board_pages_delete on public.board_pages
  for delete to authenticated
  using (public.is_room_owner(room_id));

-- -----------------------------------------------------------------------------
-- board_objects : members draw; authors edit their own; owner can clear.
-- -----------------------------------------------------------------------------
drop policy if exists board_objects_select on public.board_objects;
create policy board_objects_select on public.board_objects
  for select to authenticated
  using (public.can_access_room(room_id));

drop policy if exists board_objects_insert on public.board_objects;
create policy board_objects_insert on public.board_objects
  for insert to authenticated
  with check (public.is_room_member(room_id) and author_id = auth.uid());

drop policy if exists board_objects_update on public.board_objects;
create policy board_objects_update on public.board_objects
  for update to authenticated
  using (public.is_room_member(room_id)
         and (author_id = auth.uid() or public.is_room_owner(room_id)))
  with check (public.is_room_member(room_id));

drop policy if exists board_objects_delete on public.board_objects;
create policy board_objects_delete on public.board_objects
  for delete to authenticated
  using (public.is_room_member(room_id)
         and (author_id = auth.uid() or public.is_room_owner(room_id)));

-- -----------------------------------------------------------------------------
-- chat_messages : members read/post. Nickname is validated against the
-- membership row so it cannot be spoofed by the browser. Owner can delete.
-- -----------------------------------------------------------------------------
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (public.can_access_room(room_id));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert to authenticated
  with check (
    public.is_room_member(room_id)
    and author_id = auth.uid()
    and nickname = (
      select m.nickname from public.room_members m
      where m.room_id = chat_messages.room_id and m.user_id = auth.uid()
    )
  );

drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages
  for delete to authenticated
  using (public.is_room_owner(room_id));

-- -----------------------------------------------------------------------------
-- documents : members read metadata and register uploads; uploader/owner delete.
-- -----------------------------------------------------------------------------
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (public.can_access_room(room_id));

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (public.is_room_member(room_id) and uploader_id = auth.uid());

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
  for delete to authenticated
  using (public.is_room_member(room_id)
         and (uploader_id = auth.uid() or public.is_room_owner(room_id)));

-- -----------------------------------------------------------------------------
-- annotations : members read/annotate; author or owner edits/deletes.
-- -----------------------------------------------------------------------------
drop policy if exists annotations_select on public.annotations;
create policy annotations_select on public.annotations
  for select to authenticated
  using (public.can_access_room(room_id));

drop policy if exists annotations_insert on public.annotations;
create policy annotations_insert on public.annotations
  for insert to authenticated
  with check (public.is_room_member(room_id) and author_id = auth.uid());

drop policy if exists annotations_update on public.annotations;
create policy annotations_update on public.annotations
  for update to authenticated
  using (public.is_room_member(room_id)
         and (author_id = auth.uid() or public.is_room_owner(room_id)))
  with check (public.is_room_member(room_id));

drop policy if exists annotations_delete on public.annotations;
create policy annotations_delete on public.annotations
  for delete to authenticated
  using (public.is_room_member(room_id)
         and (author_id = auth.uid() or public.is_room_owner(room_id)));

-- -----------------------------------------------------------------------------
-- timer_state : read by members; written only via timer_control() RPC.
-- -----------------------------------------------------------------------------
drop policy if exists timer_state_select on public.timer_state;
create policy timer_state_select on public.timer_state
  for select to authenticated
  using (public.can_access_room(room_id));

-- -----------------------------------------------------------------------------
-- room_events : members read the audit trail; inserts happen inside RPCs.
-- -----------------------------------------------------------------------------
drop policy if exists room_events_select on public.room_events;
create policy room_events_select on public.room_events
  for select to authenticated
  using (public.can_access_room(room_id));

-- -----------------------------------------------------------------------------
-- rate_limits : no policies at all. Only SECURITY DEFINER functions touch it.
-- -----------------------------------------------------------------------------

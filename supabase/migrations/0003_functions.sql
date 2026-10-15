-- ============================================================================
-- StudyBoard — 0003_functions.sql
-- SECURITY DEFINER RPCs used by the frontend.
-- Run after 0002_rls.sql.
--
-- Every function re-checks who the caller is (auth.uid()) and what they are
-- allowed to do. None of them trusts an id, role or permission from the client.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Invite-code generator (no ambiguous characters: no I, O, 0, 1)
-- ----------------------------------------------------------------------------
create or replace function public.gen_invite_code(p_len int default 8)
returns text
language sql volatile
as $$
  select string_agg(
           substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 32))::int + 1, 1),
           ''
         )
  from generate_series(1, greatest(4, least(p_len, 16)));
$$;

-- ----------------------------------------------------------------------------
-- Server time, used by clients to correct for clock skew (timer sync).
-- ----------------------------------------------------------------------------
create or replace function public.server_now()
returns timestamptz
language sql stable
as $$ select now(); $$;

-- ----------------------------------------------------------------------------
-- get_my_rooms(): the rooms the caller belongs to, with their role.
-- ----------------------------------------------------------------------------
create or replace function public.get_my_rooms()
returns table (
  id uuid, owner_id uuid, name text, subject text,
  invite_code text, invite_revoked boolean, created_at timestamptz,
  my_role text, member_count int
)
language sql stable security definer set search_path = public
as $$
  select
    r.id, r.owner_id, r.name, r.subject, r.invite_code, r.invite_revoked, r.created_at,
    m.role as my_role,
    (select count(*)::int from public.room_members rm where rm.room_id = r.id) as member_count
  from public.rooms r
  join public.room_members m on m.room_id = r.id and m.user_id = auth.uid()
  order by r.created_at desc;
$$;

-- ----------------------------------------------------------------------------
-- create_room(): creates a room, makes the caller its owner, seeds state.
-- ----------------------------------------------------------------------------
create or replace function public.create_room(p_name text, p_subject text default null)
returns public.rooms
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
  v_room public.rooms;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_name is null or char_length(btrim(p_name)) < 1 then
    raise exception 'room name is required';
  end if;

  loop
    v_code := public.gen_invite_code();
    exit when not exists (select 1 from public.rooms where invite_code = v_code);
  end loop;

  insert into public.rooms (owner_id, name, subject, invite_code)
  values (auth.uid(), btrim(p_name), nullif(btrim(coalesce(p_subject, '')), ''), v_code)
  returning * into v_room;

  insert into public.room_members (room_id, user_id, role)
  values (v_room.id, auth.uid(), 'owner');

  insert into public.room_state (room_id) values (v_room.id)
  on conflict (room_id) do nothing;

  return v_room;
end;
$$;

-- ----------------------------------------------------------------------------
-- join_room_by_code(): membership by invitation code. Idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.join_room_by_code(p_code text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_room public.rooms;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_room
  from public.rooms
  where invite_code = upper(btrim(p_code));

  if not found then
    raise exception 'invalid code';
  end if;
  if v_room.invite_revoked then
    raise exception 'invitation revoked';
  end if;
  if exists (
    select 1 from public.room_members
    where room_id = v_room.id and user_id = auth.uid()
  ) then
    return v_room.id; -- already a member
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (v_room.id, auth.uid(), 'member');

  insert into public.messages (room_id, user_id, body, kind)
  values (v_room.id, auth.uid(), 'joined the room', 'system');

  return v_room.id;
end;
$$;

-- ----------------------------------------------------------------------------
-- leave_room(): a member leaves. The owner must delete the room instead.
-- ----------------------------------------------------------------------------
create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role
  from public.room_members
  where room_id = p_room_id and user_id = auth.uid();

  if v_role is null then
    raise exception 'not a member of this room';
  end if;
  if v_role = 'owner' then
    raise exception 'the owner cannot leave; delete the room instead';
  end if;

  delete from public.room_members
  where room_id = p_room_id and user_id = auth.uid();
end;
$$;

-- ----------------------------------------------------------------------------
-- delete_room(): owner-only. Cascades members, messages, files, state.
-- ----------------------------------------------------------------------------
create or replace function public.delete_room(p_room_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.rooms where id = p_room_id and owner_id = auth.uid()
  ) then
    raise exception 'only the room owner can delete this room';
  end if;
  delete from public.rooms where id = p_room_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Invitation management (owner only)
-- ----------------------------------------------------------------------------
create or replace function public.revoke_room_invite(p_room_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.rooms where id = p_room_id and owner_id = auth.uid()
  ) then
    raise exception 'only the room owner can revoke invitations';
  end if;
  update public.rooms set invite_revoked = true where id = p_room_id;
end;
$$;

create or replace function public.regenerate_room_invite(p_room_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
begin
  if not exists (
    select 1 from public.rooms where id = p_room_id and owner_id = auth.uid()
  ) then
    raise exception 'only the room owner can change invitations';
  end if;

  loop
    v_code := public.gen_invite_code();
    exit when not exists (select 1 from public.rooms where invite_code = v_code);
  end loop;

  update public.rooms
  set invite_code = v_code, invite_revoked = false
  where id = p_room_id;

  return v_code;
end;
$$;

-- ----------------------------------------------------------------------------
-- Member management
-- ----------------------------------------------------------------------------
create or replace function public.remove_room_member(p_room_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_room(p_room_id, auth.uid()) then
    raise exception 'not allowed to remove members';
  end if;
  if p_user_id = (select owner_id from public.rooms where id = p_room_id) then
    raise exception 'the owner cannot be removed';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'use leave_room to remove yourself';
  end if;

  delete from public.room_members
  where room_id = p_room_id and user_id = p_user_id;
end;
$$;

create or replace function public.set_member_role(p_room_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.rooms where id = p_room_id and owner_id = auth.uid()
  ) then
    raise exception 'only the room owner can change roles';
  end if;
  if p_role not in ('member', 'moderator') then
    raise exception 'invalid role';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'you cannot change your own role';
  end if;

  update public.room_members
  set role = p_role
  where room_id = p_room_id and user_id = p_user_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- get_room_members(): roster with display names, members only.
-- ----------------------------------------------------------------------------
create or replace function public.get_room_members(p_room_id uuid)
returns table (
  user_id uuid, role text, joined_at timestamptz, display_name text, avatar_url text
)
language sql stable security definer set search_path = public
as $$
  select m.user_id, m.role, m.joined_at, p.display_name, p.avatar_url
  from public.room_members m
  join public.profiles p on p.id = m.user_id
  where m.room_id = p_room_id
    and public.is_room_member(p_room_id, auth.uid())
  order by case m.role when 'owner' then 0 when 'moderator' then 1 else 2 end, m.joined_at;
$$;

-- ----------------------------------------------------------------------------
-- get_room_messages(): paginated chat, oldest-first within each page.
--   Pass the oldest loaded created_at as p_before to fetch older messages.
-- ----------------------------------------------------------------------------
create or replace function public.get_room_messages(
  p_room_id uuid,
  p_before  timestamptz default null,
  p_limit   int default 40
)
returns table (
  id bigint, room_id uuid, user_id uuid, body text,
  kind text, created_at timestamptz, display_name text
)
language sql stable security definer set search_path = public
as $$
  select t.id, t.room_id, t.user_id, t.body, t.kind, t.created_at, t.display_name
  from (
    select m.id, m.room_id, m.user_id, m.body, m.kind, m.created_at, p.display_name
    from public.messages m
    join public.profiles p on p.id = m.user_id
    where m.room_id = p_room_id
      and public.is_room_member(p_room_id, auth.uid())
      and (p_before is null or m.created_at < p_before)
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  ) t
  order by t.created_at asc;
$$;

-- ----------------------------------------------------------------------------
-- set_room_timer(): managers only. Timer state is stored server-side.
-- ----------------------------------------------------------------------------
create or replace function public.set_room_timer(p_room_id uuid, p_timer jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_room(p_room_id, auth.uid()) then
    raise exception 'not allowed to control the timer';
  end if;

  insert into public.room_state (room_id, timer, updated_at)
  values (p_room_id, p_timer, now())
  on conflict (room_id) do update
    set timer = excluded.timer, updated_at = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- set_room_pdf(): any member may point the room at a file / page.
-- ----------------------------------------------------------------------------
create or replace function public.set_room_pdf(p_room_id uuid, p_file_id uuid, p_page int)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_room_member(p_room_id, auth.uid()) then
    raise exception 'not a member of this room';
  end if;

  insert into public.room_state (room_id, pdf_file_id, pdf_page, updated_at)
  values (p_room_id, p_file_id, greatest(coalesce(p_page, 1), 1), now())
  on conflict (room_id) do update
    set pdf_file_id = excluded.pdf_file_id,
        pdf_page    = excluded.pdf_page,
        updated_at  = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- delete_own_account(): deletes the caller's auth user (profiles cascade).
-- ----------------------------------------------------------------------------
create or replace function public.delete_own_account()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- ----------------------------------------------------------------------------
-- Lock down execution: only signed-in users may call these.
-- ----------------------------------------------------------------------------
revoke execute on function public.delete_own_account() from anon;
revoke execute on function public.create_room(text, text) from anon;
revoke execute on function public.join_room_by_code(text) from anon;
revoke execute on function public.get_my_rooms() from anon;
revoke execute on function public.get_room_members(uuid) from anon;
revoke execute on function public.get_room_messages(uuid, timestamptz, int) from anon;
revoke execute on function public.set_room_timer(uuid, jsonb) from anon;
revoke execute on function public.set_room_pdf(uuid, uuid, int) from anon;

grant execute on function public.delete_own_account() to authenticated;
grant execute on function public.create_room(text, text) to authenticated;
grant execute on function public.join_room_by_code(text) to authenticated;
grant execute on function public.get_my_rooms() to authenticated;
grant execute on function public.get_room_members(uuid) to authenticated;
grant execute on function public.get_room_messages(uuid, timestamptz, int) to authenticated;
grant execute on function public.set_room_timer(uuid, jsonb) to authenticated;
grant execute on function public.set_room_pdf(uuid, uuid, int) to authenticated;
grant execute on function public.server_now() to authenticated;

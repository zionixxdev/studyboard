-- =============================================================================
-- StudyBoard — 0003_rpc.sql
-- Server-authoritative functions. Every one runs as SECURITY DEFINER (owner),
-- re-derives identity from auth.uid(), validates all inputs and membership,
-- and writes an audit row where useful. The browser never supplies a trusted
-- role, room id or user id.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal: fixed-window rate limiter. Raises on breach.
-- -----------------------------------------------------------------------------
create or replace function public._rl_check(p_key text, p_limit int, p_window_seconds int)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare r public.rate_limits;
begin
  select * into r from public.rate_limits where bucket_key = p_key for update;
  if not found then
    insert into public.rate_limits(bucket_key, window_start, count)
      values (p_key, now(), 1);
    return;
  end if;
  if r.window_start < now() - make_interval(secs => p_window_seconds::double precision) then
    update public.rate_limits set window_start = now(), count = 1 where bucket_key = p_key;
    return;
  end if;
  if r.count >= p_limit then
    raise exception 'rate limit exceeded' using errcode = 'P0001';
  end if;
  update public.rate_limits set count = count + 1 where bucket_key = p_key;
end;
$$;

-- -----------------------------------------------------------------------------
-- Internal: cryptographically random, human-friendly invite code (10 chars,
-- no ambiguous 0/O/1/I). Only the SHA-256 hash is ever persisted.
-- -----------------------------------------------------------------------------
create or replace function public._gen_invite_code()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  alphabet text  := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 chars
  raw      bytea := extensions.gen_random_bytes(10);
  out_code text  := '';
  i        int;
begin
  for i in 0..9 loop
    out_code := out_code || substr(alphabet, 1 + (get_byte(raw, i) % 32), 1);
  end loop;
  return out_code;
end;
$$;

-- -----------------------------------------------------------------------------
-- create_room : make a room, make the caller its owner, seed page + timer,
-- issue the first invite code. Returns the plaintext code exactly once.
-- -----------------------------------------------------------------------------
create or replace function public.create_room(p_name text, p_nickname text)
returns table (room_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid  uuid := auth.uid();
  v_room uuid;
  v_code text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'invalid room name' using errcode = '22023';
  end if;
  if p_nickname is null or char_length(btrim(p_nickname)) not between 1 and 32 then
    raise exception 'invalid nickname' using errcode = '22023';
  end if;

  perform public._rl_check('create_room:' || v_uid::text, 10, 3600);

  insert into public.rooms(name, owner_id)
    values (btrim(p_name), v_uid) returning id into v_room;

  insert into public.room_members(room_id, user_id, nickname, role)
    values (v_room, v_uid, btrim(p_nickname), 'owner');

  insert into public.board_pages(room_id, name, page_index)
    values (v_room, 'Page 1', 0);

  insert into public.timer_state(room_id) values (v_room);

  v_code := public._gen_invite_code();
  insert into public.invite_codes(room_id, code_hash, code_prefix, created_by)
    values (v_room, encode(extensions.digest(v_code, 'sha256'), 'hex'),
            left(v_code, 4), v_uid);

  insert into public.room_events(room_id, actor_id, event_type, payload)
    values (v_room, v_uid, 'room_created',
            jsonb_build_object('name', btrim(p_name)));

  return query select v_room, v_code;
end;
$$;

-- -----------------------------------------------------------------------------
-- join_room : validate an invite code and add the caller as a member.
-- -----------------------------------------------------------------------------
create or replace function public.join_room(p_code text, p_nickname text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid  uuid := auth.uid();
  v_hash text;
  v_inv  public.invite_codes;
  v_room public.rooms;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_code is null or char_length(btrim(p_code)) not between 6 and 64 then
    raise exception 'invalid invite code' using errcode = '22023';
  end if;
  if p_nickname is null or char_length(btrim(p_nickname)) not between 1 and 32 then
    raise exception 'invalid nickname' using errcode = '22023';
  end if;

  perform public._rl_check('join_room:' || v_uid::text, 40, 3600);

  v_hash := encode(extensions.digest(upper(btrim(p_code)), 'sha256'), 'hex');
  select * into v_inv from public.invite_codes where code_hash = v_hash;
  if not found then
    raise exception 'invite code not found' using errcode = 'P0002';
  end if;
  if v_inv.revoked then
    raise exception 'invite code revoked' using errcode = 'P0001';
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    raise exception 'invite code expired' using errcode = 'P0001';
  end if;
  if v_inv.max_uses is not null and v_inv.uses >= v_inv.max_uses then
    raise exception 'invite code exhausted' using errcode = 'P0001';
  end if;

  select * into v_room from public.rooms where id = v_inv.room_id;
  if not found then
    raise exception 'room no longer exists' using errcode = 'P0002';
  end if;
  if v_room.is_locked and not exists (
    select 1 from public.room_members
    where room_id = v_room.id and user_id = v_uid
  ) then
    raise exception 'room is locked' using errcode = 'P0001';
  end if;

  insert into public.room_members(room_id, user_id, nickname, role)
    values (v_room.id, v_uid, btrim(p_nickname), 'member')
  on conflict (room_id, user_id)
    do update set nickname = excluded.nickname, last_seen_at = now();

  update public.invite_codes set uses = uses + 1 where id = v_inv.id;
  update public.rooms set last_active_at = now() where id = v_room.id;

  insert into public.room_events(room_id, actor_id, event_type, payload)
    values (v_room.id, v_uid, 'member_joined',
            jsonb_build_object('nickname', btrim(p_nickname)));

  return v_room.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- rotate_invite : owner revokes all live codes and mints a fresh one.
-- -----------------------------------------------------------------------------
create or replace function public.rotate_invite(p_room uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
begin
  if not public.is_room_owner(p_room) then
    raise exception 'not room owner' using errcode = '42501';
  end if;
  update public.invite_codes set revoked = true
    where room_id = p_room and revoked = false;
  v_code := public._gen_invite_code();
  insert into public.invite_codes(room_id, code_hash, code_prefix, created_by)
    values (p_room, encode(extensions.digest(v_code, 'sha256'), 'hex'),
            left(v_code, 4), v_uid);
  insert into public.room_events(room_id, actor_id, event_type)
    values (p_room, v_uid, 'invite_rotated');
  return v_code;
end;
$$;

-- -----------------------------------------------------------------------------
-- revoke_invite : owner revokes one invitation record.
-- -----------------------------------------------------------------------------
create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_room uuid;
begin
  select room_id into v_room from public.invite_codes where id = p_invite;
  if v_room is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if not public.is_room_owner(v_room) then
    raise exception 'not room owner' using errcode = '42501';
  end if;
  update public.invite_codes set revoked = true where id = p_invite;
  insert into public.room_events(room_id, actor_id, event_type)
    values (v_room, auth.uid(), 'invite_revoked');
end;
$$;

-- -----------------------------------------------------------------------------
-- set_nickname : a member changes their own display name.
-- -----------------------------------------------------------------------------
create or replace function public.set_nickname(p_room uuid, p_nickname text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_nickname is null or char_length(btrim(p_nickname)) not between 1 and 32 then
    raise exception 'invalid nickname' using errcode = '22023';
  end if;
  if not public.is_room_member(p_room) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  update public.room_members
    set nickname = btrim(p_nickname), last_seen_at = now()
    where room_id = p_room and user_id = auth.uid();
end;
$$;

-- -----------------------------------------------------------------------------
-- remove_member : owner removes someone else (never the owner row).
-- -----------------------------------------------------------------------------
create or replace function public.remove_member(p_room uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_room_owner(p_room) then
    raise exception 'not room owner' using errcode = '42501';
  end if;
  if p_user = (select owner_id from public.rooms where id = p_room) then
    raise exception 'cannot remove the owner' using errcode = '22023';
  end if;
  delete from public.room_members where room_id = p_room and user_id = p_user;
  insert into public.room_events(room_id, actor_id, event_type, payload)
    values (p_room, auth.uid(), 'member_removed',
            jsonb_build_object('user_id', p_user));
end;
$$;

-- -----------------------------------------------------------------------------
-- leave_room : a non-owner member removes themselves.
-- -----------------------------------------------------------------------------
create or replace function public.leave_room(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if public.is_room_owner(p_room) then
    raise exception 'owner must delete the room instead' using errcode = '22023';
  end if;
  delete from public.room_members
    where room_id = p_room and user_id = auth.uid();
  insert into public.room_events(room_id, actor_id, event_type)
    values (p_room, auth.uid(), 'member_left');
end;
$$;

-- -----------------------------------------------------------------------------
-- delete_room : owner deletes the room (cascades to all child rows).
-- -----------------------------------------------------------------------------
create or replace function public.delete_room(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_room_owner(p_room) then
    raise exception 'not room owner' using errcode = '42501';
  end if;
  delete from public.rooms where id = p_room;
end;
$$;

-- -----------------------------------------------------------------------------
-- set_room_locked : owner toggles whether new members may join.
-- -----------------------------------------------------------------------------
create or replace function public.set_room_locked(p_room uuid, p_locked boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_room_owner(p_room) then
    raise exception 'not room owner' using errcode = '42501';
  end if;
  update public.rooms set is_locked = coalesce(p_locked, false) where id = p_room;
  insert into public.room_events(room_id, actor_id, event_type, payload)
    values (p_room, auth.uid(), 'room_lock_changed',
            jsonb_build_object('locked', coalesce(p_locked, false)));
end;
$$;

-- -----------------------------------------------------------------------------
-- clear_board : owner wipes every object on one page.
-- -----------------------------------------------------------------------------
create or replace function public.clear_board(p_room uuid, p_page uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_room_owner(p_room) then
    raise exception 'not room owner' using errcode = '42501';
  end if;
  delete from public.board_objects where room_id = p_room and page_id = p_page;
  update public.board_pages set snapshot = null where id = p_page and room_id = p_room;
  insert into public.room_events(room_id, actor_id, event_type, payload)
    values (p_room, auth.uid(), 'board_cleared',
            jsonb_build_object('page_id', p_page));
end;
$$;

-- -----------------------------------------------------------------------------
-- create_page : any member adds a whiteboard page.
-- -----------------------------------------------------------------------------
create or replace function public.create_page(p_room uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_page uuid;
begin
  if not public.is_room_member(p_room) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  insert into public.board_pages(room_id, name, page_index)
    values (
      p_room,
      coalesce(nullif(btrim(p_name), ''), 'Page'),
      (select coalesce(max(page_index), -1) + 1 from public.board_pages where room_id = p_room)
    )
    returning id into v_page;
  return v_page;
end;
$$;

-- -----------------------------------------------------------------------------
-- delete_page : owner removes a page (never the last one).
-- -----------------------------------------------------------------------------
create or replace function public.delete_page(p_room uuid, p_page uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_room_owner(p_room) then
    raise exception 'not room owner' using errcode = '42501';
  end if;
  if (select count(*) from public.board_pages where room_id = p_room) <= 1 then
    raise exception 'cannot delete the last page' using errcode = '22023';
  end if;
  delete from public.board_pages where id = p_page and room_id = p_room;
end;
$$;

-- -----------------------------------------------------------------------------
-- timer_control : server-authoritative Pomodoro state with optimistic
-- concurrency control (the caller passes the version it last saw).
-- -----------------------------------------------------------------------------
create or replace function public.timer_control(
  p_room uuid, p_action text, p_version int, p_duration int default null
)
returns public.timer_state
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  t public.timer_state;
begin
  if not public.is_room_member(p_room) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  insert into public.timer_state(room_id) values (p_room)
    on conflict (room_id) do nothing;

  select * into t from public.timer_state where room_id = p_room for update;

  if p_version is not null and t.version <> p_version then
    raise exception 'stale timer version' using errcode = '40001';
  end if;

  if p_action = 'start' then
    t.running := true; t.started_at := now(); t.elapsed_before_pause := 0;
  elsif p_action = 'pause' then
    if t.running then
      t.elapsed_before_pause := t.elapsed_before_pause
        + extract(epoch from (now() - t.started_at))::int;
    end if;
    t.running := false; t.started_at := null;
  elsif p_action = 'resume' then
    t.running := true; t.started_at := now();
  elsif p_action = 'reset' then
    t.running := false; t.started_at := null; t.elapsed_before_pause := 0;
  elsif p_action = 'skip' then
    if t.mode = 'focus' then
      t.mode := 'break'; t.duration_seconds := 300;
    else
      t.mode := 'focus'; t.duration_seconds := 1500;
    end if;
    t.running := false; t.started_at := null; t.elapsed_before_pause := 0;
  elsif p_action = 'set_duration' then
    if p_duration is null or p_duration not between 60 and 7200 then
      raise exception 'invalid duration' using errcode = '22023';
    end if;
    t.duration_seconds := p_duration;
    t.running := false; t.started_at := null; t.elapsed_before_pause := 0;
  else
    raise exception 'unknown timer action' using errcode = '22023';
  end if;

  update public.timer_state set
    mode                 = t.mode,
    duration_seconds     = t.duration_seconds,
    running              = t.running,
    started_at           = t.started_at,
    elapsed_before_pause = t.elapsed_before_pause,
    version              = t.version + 1,
    updated_by           = v_uid,
    updated_at           = now()
  where room_id = p_room
  returning * into t;

  insert into public.room_events(room_id, actor_id, event_type, payload)
    values (p_room, v_uid, 'timer_' || p_action, '{}'::jsonb);

  return t;
end;
$$;

-- -----------------------------------------------------------------------------
-- touch_presence : lightweight heartbeat for last_seen / last_active.
-- -----------------------------------------------------------------------------
create or replace function public.touch_presence(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_room_member(p_room) then
    return;
  end if;
  update public.room_members
    set last_seen_at = now()
    where room_id = p_room and user_id = auth.uid();
  update public.rooms set last_active_at = now() where id = p_room;
end;
$$;

-- -----------------------------------------------------------------------------
-- cleanup_old_rooms : retention helper, intended for a scheduled job under the
-- service role only. Not granted to authenticated clients.
-- -----------------------------------------------------------------------------
create or replace function public.cleanup_old_rooms(p_days int default 30)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_count int;
begin
  with gone as (
    delete from public.rooms
    where last_active_at < now() - make_interval(days => greatest(p_days, 1))
    returning 1
  )
  select count(*) into v_count from gone;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants: expose the client-facing RPCs to authenticated (anonymous) users;
-- keep the internal helpers and the retention job out of reach.
-- -----------------------------------------------------------------------------
revoke all on function public._rl_check(text, int, int) from public;
revoke all on function public._gen_invite_code() from public;
revoke all on function public.cleanup_old_rooms(int) from public;

grant execute on function public.create_room(text, text)          to authenticated;
grant execute on function public.join_room(text, text)            to authenticated;
grant execute on function public.rotate_invite(uuid)              to authenticated;
grant execute on function public.revoke_invite(uuid)              to authenticated;
grant execute on function public.set_nickname(uuid, text)         to authenticated;
grant execute on function public.remove_member(uuid, uuid)        to authenticated;
grant execute on function public.leave_room(uuid)                 to authenticated;
grant execute on function public.delete_room(uuid)                to authenticated;
grant execute on function public.set_room_locked(uuid, boolean)   to authenticated;
grant execute on function public.clear_board(uuid, uuid)          to authenticated;
grant execute on function public.create_page(uuid, text)          to authenticated;
grant execute on function public.delete_page(uuid, uuid)          to authenticated;
grant execute on function public.timer_control(uuid, text, int, int) to authenticated;
grant execute on function public.touch_presence(uuid)             to authenticated;

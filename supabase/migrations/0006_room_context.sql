-- =============================================================================
-- StudyBoard — 0006_room_context.sql
--
-- One server-authoritative call that tells the client exactly what its
-- relationship to a room is. It replaces the client-side membership lookup that
-- conflated three very different situations:
--
--   1. nobody is signed in          -> raise 'not authenticated'
--   2. signed in, but not a member  -> return NULL
--   3. signed in and a member       -> return the room + the membership
--
-- Case 2 is the only one that should ever offer "enter an invite code". Case 1
-- must send the user to sign in. Getting these confused is what made the app
-- ask a room's own creator for an invite code.
-- =============================================================================

create or replace function public.get_room_context(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_room   public.rooms;
  v_member public.room_members;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_member
    from public.room_members
   where room_id = p_room and user_id = v_uid;
  if not found then
    return null;                       -- clean "not a member"; no exception
  end if;

  select * into v_room from public.rooms where id = p_room;
  if not found then
    return null;                       -- room was deleted
  end if;

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id',             v_room.id,
      'name',           v_room.name,
      'owner_id',       v_room.owner_id,
      'is_locked',      v_room.is_locked,
      'settings',       v_room.settings,
      'created_at',     v_room.created_at,
      'last_active_at', v_room.last_active_at
    ),
    'member', jsonb_build_object(
      'user_id',  v_member.user_id,
      'nickname', v_member.nickname,
      'role',     v_member.role
    )
  );
end;
$$;

revoke all on function public.get_room_context(uuid) from public;
grant execute on function public.get_room_context(uuid) to authenticated;

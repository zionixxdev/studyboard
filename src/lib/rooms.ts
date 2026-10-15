import { supabase } from '@/lib/supabase';
import type { RoomRole, RoomSummary } from '@/types/db';

/**
 * Room API. Every one of these calls a SECURITY DEFINER function or an RLS
 * policy in Postgres — the client is never trusted to decide membership or
 * permissions. See supabase/migrations/0003_functions.sql.
 */

export async function listMyRooms(): Promise<RoomSummary[]> {
  const { data, error } = await supabase.rpc('get_my_rooms');
  if (error) throw new Error(error.message);
  return (data as RoomSummary[]) ?? [];
}

export async function createRoom(input: {
  name: string;
  subject?: string;
}): Promise<{ id: string; invite_code: string }> {
  const { data, error } = await supabase.rpc('create_room', {
    p_name: input.name.trim(),
    p_subject: input.subject?.trim() || null,
  });
  if (error) throw new Error(error.message);
  // create_room returns the new room row.
  const row = Array.isArray(data) ? data[0] : data;
  return { id: row.id, invite_code: row.invite_code };
}

export async function joinRoomByCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_room_by_code', {
    p_code: code.trim().toUpperCase(),
  });
  if (error) throw new Error(error.message);
  return data as string; // room id
}

export async function leaveRoom(roomId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_room', { p_room_id: roomId });
  if (error) throw new Error(error.message);
}

export async function deleteRoom(roomId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_room', { p_room_id: roomId });
  if (error) throw new Error(error.message);
}

export async function revokeInvite(roomId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_room_invite', { p_room_id: roomId });
  if (error) throw new Error(error.message);
}

export async function regenerateInvite(roomId: string): Promise<string> {
  const { data, error } = await supabase.rpc('regenerate_room_invite', { p_room_id: roomId });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function removeMember(roomId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_room_member', {
    p_room_id: roomId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
}

export async function setMemberRole(
  roomId: string,
  userId: string,
  role: RoomRole,
): Promise<void> {
  const { error } = await supabase.rpc('set_member_role', {
    p_room_id: roomId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

/** Human-readable messages for the invite-code errors the RPCs raise. */
export function inviteErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid code')) return 'That invitation code is not valid.';
  if (m.includes('revoked')) return 'This invitation has been revoked by the room owner.';
  if (m.includes('already a member')) return "You're already a member of this room.";
  if (m.includes('not found')) return 'No room matches that invitation.';
  return message;
}

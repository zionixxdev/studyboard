import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Room, RoomMember, RoomRole } from '@/types/db';

export interface RoomMemberView extends RoomMember {
  display_name: string;
  avatar_url: string | null;
}

interface UseRoomResult {
  room: Room | null;
  members: RoomMemberView[];
  myRole: RoomRole | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Loads a single room plus its member list. Access is enforced by RLS: if the
 * caller is not a member, the query simply returns nothing rather than leaking
 * room data.
 */
export function useRoom(roomId: string | undefined): UseRoomResult {
  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<RoomMemberView[]>([]);
  const [myRole, setMyRole] = useState<RoomRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    setError(null);
    try {
      const [{ data: roomRow, error: roomErr }, { data: memberRows, error: memErr }] =
        await Promise.all([
          supabase.from('rooms').select('*').eq('id', roomId).maybeSingle(),
          supabase.rpc('get_room_members', { p_room_id: roomId }),
        ]);

      if (roomErr) throw new Error(roomErr.message);
      if (memErr) throw new Error(memErr.message);

      setRoom((roomRow as Room) ?? null);
      const list = (memberRows as RoomMemberView[]) ?? [];
      setMembers(list);

      const { data: auth } = await supabase.auth.getUser();
      const me = list.find((m) => m.user_id === auth.user?.id);
      setMyRole(me?.role ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { room, members, myRole, loading, error, refresh };
}

import { useCallback, useEffect, useState } from 'react';
import { inviteErrorMessage, listMyRooms } from '@/lib/rooms';
import type { RoomSummary } from '@/types/db';

/** Loads the rooms the signed-in user belongs to, with a manual refresh. */
export function useRooms() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRooms(await listMyRooms());
    } catch (e) {
      setError(inviteErrorMessage((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rooms, loading, error, refresh };
}

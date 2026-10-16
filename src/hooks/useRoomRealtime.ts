import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { RealtimeEvent } from '@/types/db';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface PresenceMeta {
  userId: string;
  name: string;
  online_at: string;
}

/**
 * One Realtime channel per room, shared by every collaborative feature
 * (whiteboard ops, cursors, PDF page sync, timer, chat notifications).
 *
 * - `broadcast` sends an ephemeral event to everyone in the room.
 * - `subscribe` registers a listener for inbound events.
 * - `onlineIds` / `presence` come from Supabase Realtime Presence.
 *
 * Whiteboard drawing never sends the whole canvas — only the incremental op
 * that was just drawn — so pointer moves stay cheap.
 */
export function useRoomRealtime(roomId: string | undefined, me: { id: string; name: string }) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const listeners = useRef<Set<(e: RealtimeEvent) => void>>(new Set());
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [presence, setPresence] = useState<PresenceMeta[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    if (!roomId) return;
    setStatus('connecting');

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        presence: { key: me.id },
        broadcast: { self: false },
      },
    });
    channelRef.current = channel;

    channel.on('broadcast', { event: 'evt' }, (payload) => {
      const evt = payload.payload as RealtimeEvent;
      listeners.current.forEach((fn) => fn(evt));
    });

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceMeta>();
      const metas = Object.values(state).flat() as unknown as PresenceMeta[];
      setPresence(metas);
      setOnlineIds(new Set(metas.map((m) => m.userId)));
    });

    channel.subscribe(async (state) => {
      if (state === 'SUBSCRIBED') {
        setStatus('connected');
        await channel.track({ userId: me.id, name: me.name, online_at: new Date().toISOString() });
      } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
        setStatus('disconnected');
      }
    });

    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId, me.id, me.name]);

  const broadcast = useCallback((event: RealtimeEvent) => {
    void channelRef.current?.send({ type: 'broadcast', event: 'evt', payload: event });
  }, []);

  const subscribe = useCallback((fn: (e: RealtimeEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  // Memoised: consumers' effects depend on this object, and a fresh identity on
  // every render would tear down and re-subscribe the channel constantly.
  return useMemo(
    () => ({ broadcast, subscribe, onlineIds, presence, status }),
    [broadcast, subscribe, onlineIds, presence, status],
  );
}

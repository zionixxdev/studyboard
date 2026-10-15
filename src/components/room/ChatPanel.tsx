import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { Avatar } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { formatTime } from '@/lib/utils';
import type { Message } from '@/types/db';
import type { RoomMemberView } from '@/hooks/useRoom';

const PAGE = 40;
const MIN_SEND_INTERVAL_MS = 600; // lightweight client throttle; server also rate-limits

export function ChatPanel({
  roomId,
  meId,
  members,
}: {
  roomId: string;
  meId: string;
  members: RoomMemberView[];
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const lastSentAt = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const nameFor = useCallback(
    (userId: string) => members.find((m) => m.user_id === userId)?.display_name ?? 'Someone',
    [members],
  );

  // Initial page: newest messages, rendered oldest-first.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase.rpc('get_room_messages', {
        p_room_id: roomId,
        p_before: null,
        p_limit: PAGE,
      });
      if (!active) return;
      if (err) setError(err.message);
      else {
        const rows = (data as Message[]) ?? [];
        setMessages(rows);
        setHasMore(rows.length === PAGE);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [roomId]);

  // Realtime inserts for this room. RLS on the table means only members can
  // read; the filter narrows to this room.
  useEffect(() => {
    const channel = supabase
      .channel(`chat:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function loadOlder() {
    if (loadingOlder || !hasMore || messages.length === 0) return;
    setLoadingOlder(true);
    const oldest = messages[0].created_at;
    const { data, error: err } = await supabase.rpc('get_room_messages', {
      p_room_id: roomId,
      p_before: oldest,
      p_limit: PAGE,
    });
    if (err) setError(err.message);
    else {
      const rows = (data as Message[]) ?? [];
      setMessages((prev) => [...rows, ...prev]);
      setHasMore(rows.length === PAGE);
    }
    setLoadingOlder(false);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body = draft.trim();
    if (!body) return;

    const now = Date.now();
    if (now - lastSentAt.current < MIN_SEND_INTERVAL_MS) {
      setError('You are sending messages too quickly.');
      return;
    }
    if (body.length > 2000) {
      setError('Message is too long (max 2000 characters).');
      return;
    }

    lastSentAt.current = now;
    setDraft('');
    const { error: err } = await supabase
      .from('messages')
      .insert({ room_id: roomId, user_id: meId, body, kind: 'text' });
    if (err) {
      setError(err.message);
      setDraft(body); // restore so nothing is lost
    }
  }

  return (
    <GlassCard className="flex h-full min-h-0 flex-col p-4">
      <h3 className="mb-3 font-semibold text-ink">Chat</h3>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {hasMore && !loading && (
          <div className="flex justify-center">
            <button
              onClick={loadOlder}
              disabled={loadingOlder}
              className="focus-ring pill px-3 py-1 text-xs text-soft hover:text-ink"
            >
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-soft">
            <Spinner size={16} /> Loading messages…
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-faint">No messages yet. Say hello.</p>
        ) : (
          messages.map((m) => {
            const mine = m.user_id === meId;
            return (
              <div key={m.id} className={'flex gap-2.5 ' + (mine ? 'flex-row-reverse' : '')}>
                <Avatar name={m.display_name ?? nameFor(m.user_id)} size={28} />
                <div className={'max-w-[80%] ' + (mine ? 'text-right' : '')}>
                  <div className="mb-0.5 flex items-center gap-2 text-xs text-faint">
                    <span>{mine ? 'You' : m.display_name ?? nameFor(m.user_id)}</span>
                    <span>{formatTime(m.created_at)}</span>
                  </div>
                  <div
                    className={
                      'inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ' +
                      (mine
                        ? 'bg-accent/25 text-ink'
                        : 'glass-subtle text-ink')
                    }
                  >
                    {m.body}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <form onSubmit={send} className="mt-3 flex items-end gap-2">
        <div className="flex-1">
          <GlassInput
            aria-label="Message"
            placeholder="Write a message…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
          />
        </div>
        <GlassButton type="submit" disabled={!draft.trim()}>
          Send
        </GlassButton>
      </form>
    </GlassCard>
  );
}

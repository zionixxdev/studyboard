import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassButton } from '@/components/ui/GlassButton';
import { Badge } from '@/components/ui/Badge';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { ChatPanel } from '@/components/room/ChatPanel';
import { MembersPanel } from '@/components/room/MembersPanel';
import { InvitePanel } from '@/components/room/InvitePanel';
import { useAuth } from '@/contexts/AuthContext';
import { useRoom } from '@/hooks/useRoom';
import { useRoomRealtime } from '@/hooks/useRoomRealtime';
import { removeMember, setMemberRole } from '@/lib/rooms';
import { cn } from '@/lib/utils';
import type { RoomRole } from '@/types/db';

// Heavy panels are lazy-loaded so the room shell paints fast on mobile.
const Whiteboard = lazy(() => import('@/components/room/Whiteboard'));
const PdfPanel = lazy(() => import('@/components/room/PdfPanel'));
const MathPanel = lazy(() => import('@/components/room/MathPanel'));
const TimerPanel = lazy(() => import('@/components/room/TimerPanel'));
const VoicePanel = lazy(() => import('@/components/room/VoicePanel'));

type Tab = 'board' | 'pdf' | 'math' | 'timer' | 'voice' | 'chat' | 'people';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'board', label: 'Whiteboard', icon: '✏️' },
  { id: 'pdf', label: 'PDF', icon: '📄' },
  { id: 'math', label: 'Math', icon: '∑' },
  { id: 'timer', label: 'Timer', icon: '⏱' },
  { id: 'voice', label: 'Voice', icon: '🎙' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'people', label: 'People', icon: '👥' },
];

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const { user, profile } = useAuth();
  const { room, members, myRole, loading, error, refresh } = useRoom(roomId);
  const [tab, setTab] = useState<Tab>('board');

  const me = useMemo(
    () => ({ id: user?.id ?? '', name: profile?.display_name ?? 'You' }),
    [user?.id, profile?.display_name],
  );

  const realtime = useRoomRealtime(roomId, me);

  if (loading) {
    return (
      <AppShell>
        <FullPageSpinner label="Loading room…" />
      </AppShell>
    );
  }

  if (error || !room) {
    return (
      <AppShell>
        <GlassCard className="mx-auto max-w-lg p-8 text-center">
          <h1 className="text-lg font-semibold text-ink">Room unavailable</h1>
          <p className="mt-2 text-sm text-soft">
            {error ?? "This room doesn't exist, or you're not a member."}
          </p>
          <Link to="/dashboard" className="mt-6 inline-block">
            <GlassButton>Back to dashboard</GlassButton>
          </Link>
        </GlassCard>
      </AppShell>
    );
  }

  const isOwner = myRole === 'owner';
  const canManage = myRole === 'owner' || myRole === 'moderator';

  const statusTone =
    realtime.status === 'connected'
      ? 'success'
      : realtime.status === 'connecting'
        ? 'accent'
        : 'danger';

  return (
    <AppShell>
      <div className="space-y-4">
        {/* Room header */}
        <GlassCard variant="strong" sheen className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight text-ink">
              {room.name}
            </h1>
            <div className="mt-1 flex items-center gap-2 text-xs text-faint">
              {room.subject && <span>{room.subject}</span>}
              <Badge tone={statusTone}>
                {realtime.status === 'connected'
                  ? `${realtime.onlineIds.size} online`
                  : realtime.status}
              </Badge>
            </div>
          </div>
          <Link to="/dashboard">
            <GlassButton variant="subtle" size="sm">
              Leave room
            </GlassButton>
          </Link>
        </GlassCard>

        {/* Tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'focus-ring pill shrink-0 px-4 py-2 text-sm transition-colors',
                tab === t.id
                  ? 'bg-accent/25 text-ink'
                  : 'glass-subtle text-soft hover:text-ink',
              )}
              aria-current={tab === t.id}
            >
              <span aria-hidden="true" className="mr-1.5">
                {t.icon}
              </span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="min-h-[60vh]">
          <Suspense fallback={<FullPageSpinner label="Loading panel…" />}>
            {tab === 'board' && (
              <Whiteboard roomId={room.id} realtime={realtime} canEdit={Boolean(myRole)} />
            )}
            {tab === 'pdf' && (
              <PdfPanel roomId={room.id} realtime={realtime} meId={me.id} canManage={canManage} />
            )}
            {tab === 'math' && <MathPanel realtime={realtime} />}
            {tab === 'timer' && (
              <TimerPanel roomId={room.id} realtime={realtime} canControl={canManage} />
            )}
            {tab === 'voice' && <VoicePanel roomId={room.id} me={me} />}
            {tab === 'chat' && (
              <div className="h-[65vh]">
                <ChatPanel roomId={room.id} meId={me.id} members={members} />
              </div>
            )}
            {tab === 'people' && (
              <div className="grid gap-4 lg:grid-cols-2">
                <InvitePanel room={room} isOwner={isOwner} onChanged={refresh} />
                <MembersPanel
                  members={members}
                  currentUserId={me.id}
                  canManage={canManage}
                  onlineIds={realtime.onlineIds}
                  onRemove={async (uid) => {
                    try {
                      await removeMember(room.id, uid);
                      await refresh();
                    } catch (e) {
                      alert((e as Error).message);
                    }
                  }}
                  onSetRole={async (uid, role: RoomRole) => {
                    try {
                      await setMemberRole(room.id, uid, role);
                      await refresh();
                    } catch (e) {
                      alert((e as Error).message);
                    }
                  }}
                />
              </div>
            )}
          </Suspense>
        </div>
      </div>
    </AppShell>
  );
}

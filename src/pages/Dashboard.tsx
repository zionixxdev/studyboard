import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassButton } from '@/components/ui/GlassButton';
import { Badge, Avatar } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { CreateRoomModal } from '@/components/room/CreateRoomModal';
import { JoinRoomModal } from '@/components/room/JoinRoomModal';
import { useAuth } from '@/contexts/AuthContext';
import { useRooms } from '@/hooks/useRooms';
import { formatTime } from '@/lib/utils';

export default function Dashboard() {
  const { profile, user } = useAuth();
  const { rooms, loading, error, refresh } = useRooms();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const name = profile?.display_name ?? user?.email ?? 'there';

  return (
    <AppShell>
      <div className="space-y-8">
        {/* Welcome */}
        <GlassCard variant="strong" sheen animated className="flex flex-wrap items-center gap-4 p-6">
          <Avatar name={name} size={56} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">
              Welcome back, {name.split(' ')[0]}
            </h1>
            <p className="text-sm text-soft">Pick up a room or start a new study session.</p>
          </div>
          <div className="flex gap-3">
            <GlassButton onClick={() => setShowCreate(true)}>New room</GlassButton>
            <GlassButton variant="ghost" onClick={() => setShowJoin(true)}>
              Join with code
            </GlassButton>
          </div>
        </GlassCard>

        {/* Rooms */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Your rooms</h2>
            <button
              onClick={() => void refresh()}
              className="focus-ring pill px-3 py-1 text-sm text-soft hover:text-ink"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-3 text-soft">
              <Spinner size={18} /> Loading your rooms…
            </div>
          ) : error ? (
            <GlassCard className="p-6 text-sm text-danger">{error}</GlassCard>
          ) : rooms.length === 0 ? (
            <GlassCard className="p-8 text-center">
              <p className="text-ink">You're not in any rooms yet.</p>
              <p className="mt-1 text-sm text-soft">
                Create one, or join with a code a friend shared.
              </p>
              <div className="mt-5 flex justify-center gap-3">
                <GlassButton onClick={() => setShowCreate(true)}>Create a room</GlassButton>
                <GlassButton variant="ghost" onClick={() => setShowJoin(true)}>
                  Join with code
                </GlassButton>
              </div>
            </GlassCard>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.map((room) => (
                <GlassCard
                  key={room.id}
                  className="group flex flex-col p-5 transition-transform duration-200 hover:-translate-y-1"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-ink">{room.name}</h3>
                      {room.subject && (
                        <p className="truncate text-sm text-soft">{room.subject}</p>
                      )}
                    </div>
                    <Badge tone={room.my_role === 'owner' ? 'accent' : 'default'}>
                      {room.my_role}
                    </Badge>
                  </div>

                  <div className="mt-4 flex items-center gap-2 text-xs text-faint">
                    <span>{room.member_count} member{room.member_count === 1 ? '' : 's'}</span>
                    <span aria-hidden="true">·</span>
                    <span>since {formatTime(room.created_at)}</span>
                  </div>

                  <div className="mt-5 flex gap-2">
                    <GlassButton
                      size="sm"
                      className="flex-1"
                      onClick={() => navigate(`/room/${room.id}`)}
                    >
                      Open
                    </GlassButton>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </section>

        {/* Quick links */}
        <section className="grid gap-4 sm:grid-cols-3">
          <Link to="/profile">
            <GlassCard className="h-full p-5 hover:-translate-y-1">
              <h3 className="font-medium text-ink">Profile & settings</h3>
              <p className="mt-1 text-sm text-soft">Name, avatar, password, theme.</p>
            </GlassCard>
          </Link>
          <GlassCard className="p-5">
            <h3 className="font-medium text-ink">Study history</h3>
            <p className="mt-1 text-sm text-soft">
              Session history appears here as you use rooms (see docs/LIMITATIONS.md).
            </p>
          </GlassCard>
          <GlassCard className="p-5">
            <h3 className="font-medium text-ink">Recent files</h3>
            <p className="mt-1 text-sm text-soft">
              PDFs you upload are shared per room, stored in a private bucket.
            </p>
          </GlassCard>
        </section>
      </div>

      <CreateRoomModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => navigate(`/room/${id}`)}
      />
      <JoinRoomModal
        open={showJoin}
        onClose={() => setShowJoin(false)}
        onJoined={(id) => navigate(`/room/${id}`)}
      />
    </AppShell>
  );
}

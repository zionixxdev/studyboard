import { Avatar, Badge } from '@/components/ui/Badge';
import { GlassCard } from '@/components/ui/GlassCard';
import type { RoomMemberView } from '@/hooks/useRoom';
import type { RoomRole } from '@/types/db';

const roleTone: Record<RoomRole, 'accent' | 'default' | 'success'> = {
  owner: 'accent',
  moderator: 'success',
  member: 'default',
};

export function MembersPanel({
  members,
  currentUserId,
  canManage,
  onRemove,
  onSetRole,
  onlineIds,
}: {
  members: RoomMemberView[];
  currentUserId?: string;
  canManage: boolean;
  onRemove: (userId: string) => void;
  onSetRole: (userId: string, role: RoomRole) => void;
  onlineIds?: Set<string>;
}) {
  return (
    <GlassCard className="p-5">
      <h3 className="mb-3 font-semibold text-ink">
        Participants <span className="text-sm font-normal text-faint">({members.length})</span>
      </h3>
      <ul className="space-y-2">
        {members.map((m) => {
          const online = onlineIds?.has(m.user_id);
          const isSelf = m.user_id === currentUserId;
          return (
            <li key={m.user_id} className="flex items-center gap-3 rounded-xl px-1 py-1.5">
              <span className="relative">
                <Avatar name={m.display_name} size={34} />
                {onlineIds && (
                  <span
                    title={online ? 'Online' : 'Offline'}
                    className={
                      'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[rgb(var(--app-bg-1))] ' +
                      (online ? 'bg-success' : 'bg-ink-faint')
                    }
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">
                  {m.display_name}
                  {isSelf && <span className="text-faint"> (you)</span>}
                </p>
                <Badge tone={roleTone[m.role]}>{m.role}</Badge>
              </div>

              {canManage && !isSelf && m.role !== 'owner' && (
                <div className="flex items-center gap-1">
                  <select
                    aria-label={`Role for ${m.display_name}`}
                    value={m.role}
                    onChange={(e) => onSetRole(m.user_id, e.target.value as RoomRole)}
                    className="focus-ring rounded-xl glass-subtle px-2 py-1 text-xs text-ink"
                  >
                    <option value="member">member</option>
                    <option value="moderator">moderator</option>
                  </select>
                  <button
                    onClick={() => onRemove(m.user_id)}
                    className="focus-ring pill px-2 py-1 text-xs text-danger hover:bg-danger/15"
                    aria-label={`Remove ${m.display_name}`}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}

import { useState } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassButton } from '@/components/ui/GlassButton';
import { Badge } from '@/components/ui/Badge';
import { regenerateInvite, revokeInvite } from '@/lib/rooms';
import type { Room } from '@/types/db';

/**
 * Owner-only invitation controls. The invite code is only ever shown to a
 * signed-in member of the room; the link is a convenience wrapper around it.
 */
export function InvitePanel({
  room,
  isOwner,
  onChanged,
}: {
  room: Room;
  isOwner: boolean;
  onChanged: () => void;
}) {
  const [code, setCode] = useState(room.invite_code);
  const [revoked, setRevoked] = useState(room.invite_revoked);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inviteLink = `${window.location.origin}/join?code=${code}`;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not access the clipboard. Copy manually.');
    }
  }

  async function onRegenerate() {
    setBusy(true);
    setError(null);
    try {
      const next = await regenerateInvite(room.id);
      setCode(next);
      setRevoked(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke() {
    setBusy(true);
    setError(null);
    try {
      await revokeInvite(room.id);
      setRevoked(true);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-ink">Invite people</h3>
        {revoked ? <Badge tone="danger">Revoked</Badge> : <Badge tone="success">Active</Badge>}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-xl glass-subtle px-3 py-2 font-mono text-sm tracking-widest text-ink">
            {code}
          </code>
          <GlassButton size="sm" variant="subtle" onClick={() => copy(code)}>
            {copied ? 'Copied' : 'Copy code'}
          </GlassButton>
        </div>

        <GlassButton size="sm" variant="ghost" block onClick={() => copy(inviteLink)}>
          Copy invite link
        </GlassButton>

        {isOwner && (
          <div className="flex gap-2 pt-1">
            <GlassButton size="sm" variant="subtle" loading={busy} onClick={onRegenerate}>
              New code
            </GlassButton>
            {!revoked && (
              <GlassButton size="sm" variant="danger" loading={busy} onClick={onRevoke}>
                Revoke
              </GlassButton>
            )}
          </div>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}
        {!isOwner && (
          <p className="text-xs text-faint">Only the room owner can change invitations.</p>
        )}
      </div>
    </GlassCard>
  );
}

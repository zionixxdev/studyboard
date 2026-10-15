import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { inviteErrorMessage, joinRoomByCode } from '@/lib/rooms';

/** Join a room by typing its invitation code (or pasting an invite link). */
export function JoinRoomModal({
  open,
  onClose,
  onJoined,
}: {
  open: boolean;
  onClose: () => void;
  onJoined: (roomId: string) => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function normalize(raw: string): string {
    // Accept either a bare code or a full invite link containing ?code=XXXX.
    const trimmed = raw.trim();
    try {
      const url = new URL(trimmed);
      return (url.searchParams.get('code') ?? trimmed).toUpperCase();
    } catch {
      return trimmed.toUpperCase();
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const normalized = normalize(code);
    if (normalized.length < 4) return setError('Enter a valid invitation code.');

    setSubmitting(true);
    try {
      const roomId = await joinRoomByCode(normalized);
      setCode('');
      onJoined(roomId);
      onClose();
    } catch (err) {
      setError(inviteErrorMessage((err as Error).message));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Join a study room">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <GlassInput
          label="Invitation code or link"
          placeholder="e.g. K7QP2M4T"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoCapitalize="characters"
        />
        {error && (
          <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <GlassButton type="button" variant="subtle" onClick={onClose}>
            Cancel
          </GlassButton>
          <GlassButton type="submit" loading={submitting} disabled={submitting}>
            Join room
          </GlassButton>
        </div>
      </form>
    </Modal>
  );
}

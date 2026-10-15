import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { createRoom } from '@/lib/rooms';

export function CreateRoomModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (roomId: string) => void;
}) {
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (name.trim().length < 2) return setError('Give the room a name.');

    setSubmitting(true);
    try {
      const room = await createRoom({ name, subject });
      setName('');
      setSubject('');
      onCreated(room.id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create a study room">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <GlassInput
          label="Room name"
          placeholder="e.g. Physics — Rotational Motion"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <GlassInput
          label="Subject (optional)"
          placeholder="e.g. Physics"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
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
            Create room
          </GlassButton>
        </div>
      </form>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassButton } from '@/components/ui/GlassButton';
import { Spinner } from '@/components/ui/Spinner';
import { inviteErrorMessage, joinRoomByCode } from '@/lib/rooms';

/** Handles invite links of the form /join?code=XXXXXXXX. */
export default function JoinRedirect() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const code = (params.get('code') ?? '').toUpperCase();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setError('This invite link is missing its code.');
      return;
    }
    (async () => {
      try {
        const roomId = await joinRoomByCode(code);
        navigate(`/room/${roomId}`, { replace: true });
      } catch (e) {
        setError(inviteErrorMessage((e as Error).message));
      }
    })();
  }, [code, navigate]);

  return (
    <AppShell>
      <GlassCard className="mx-auto max-w-md p-8 text-center">
        {error ? (
          <>
            <h1 className="text-lg font-semibold text-ink">Couldn't join</h1>
            <p className="mt-2 text-sm text-soft">{error}</p>
            <GlassButton className="mt-6" onClick={() => navigate('/dashboard')}>
              Back to dashboard
            </GlassButton>
          </>
        ) : (
          <div className="flex items-center justify-center gap-3 text-soft">
            <Spinner size={18} /> Joining room…
          </div>
        )}
      </GlassCard>
    </AppShell>
  );
}

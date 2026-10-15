import { useCallback, useEffect, useRef, useState } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassButton } from '@/components/ui/GlassButton';
import { supabase } from '@/lib/supabase';
import { formatDuration } from '@/lib/utils';
import type { RealtimeEvent, TimerState } from '@/types/db';
import type { useRoomRealtime } from '@/hooks/useRoomRealtime';

const DEFAULT_TIMER: TimerState = {
  mode: 'pomodoro',
  durationSec: 25 * 60,
  startedAt: null,
  elapsedMs: 0,
  running: false,
};

/**
 * Shared study timer.
 *
 * Synchronisation is server-authoritative: the running start time is a server
 * timestamp, and every client computes elapsed time against the server clock
 * (via a measured skew) rather than trusting its own device clock.
 */
export default function TimerPanel({
  roomId,
  realtime,
  canControl,
}: {
  roomId: string;
  realtime: ReturnType<typeof useRoomRealtime>;
  canControl: boolean;
}) {
  const [timer, setTimer] = useState<TimerState>(DEFAULT_TIMER);
  const [remaining, setRemaining] = useState(DEFAULT_TIMER.durationSec);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reminder, setReminder] = useState<string | null>(null);
  const [customMin, setCustomMin] = useState(45);

  const skewRef = useRef(0); // serverNow - clientNow
  const tickRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  /** Best estimate of the server's current time. */
  const serverNow = useCallback(() => Date.now() + skewRef.current, []);

  // Measure clock skew against the server, then load the room's timer.
  useEffect(() => {
    let active = true;
    (async () => {
      const t0 = Date.now();
      const { data } = await supabase.rpc('server_now');
      const t1 = Date.now();
      if (active && data) {
        const serverMs = new Date(data as string).getTime();
        skewRef.current = serverMs - (t0 + (t1 - t0) / 2);
      }

      const { data: state } = await supabase
        .from('room_state')
        .select('timer')
        .eq('room_id', roomId)
        .maybeSingle();
      if (active && state?.timer) setTimer({ ...DEFAULT_TIMER, ...(state.timer as TimerState) });
    })();
    return () => {
      active = false;
    };
  }, [roomId]);

  // Local ticking display, derived from the server clock.
  useEffect(() => {
    function tick() {
      const now = serverNow();
      const startedMs = timer.startedAt ? new Date(timer.startedAt).getTime() : 0;
      const elapsed = timer.elapsedMs + (timer.running && timer.startedAt ? now - startedMs : 0);
      const left = Math.max(0, Math.round((timer.durationSec * 1000 - elapsed) / 1000));
      setRemaining(left);

      if (timer.running && left <= 0 && !firedRef.current) {
        firedRef.current = true;
        setReminder(
          timer.mode === 'pomodoro'
            ? 'Focus block complete — take a short break.'
            : 'Timer finished.',
        );
      }
      if (left > 0) firedRef.current = false;
    }
    tick();
    tickRef.current = window.setInterval(tick, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [timer, serverNow]);

  // Follow timer changes from other participants.
  useEffect(() => {
    return realtime.subscribe((e: RealtimeEvent) => {
      if (e.type === 'timer:sync') setTimer(e.timer);
    });
  }, [realtime]);

  const push = useCallback(
    async (next: TimerState) => {
      if (!canControl) return;
      setBusy(true);
      setError(null);
      setTimer(next);
      const { error: err } = await supabase.rpc('set_room_timer', {
        p_room_id: roomId,
        p_timer: next,
      });
      setBusy(false);
      if (err) setError(err.message);
      else realtime.broadcast({ type: 'timer:sync', timer: next, sender: '' });
    },
    [canControl, roomId, realtime],
  );

  function start() {
    setReminder(null);
    firedRef.current = false;
    void push({
      ...timer,
      running: true,
      startedAt: new Date(serverNow()).toISOString(),
    });
  }

  function pause() {
    const now = serverNow();
    const startedMs = timer.startedAt ? new Date(timer.startedAt).getTime() : now;
    const elapsedMs = timer.elapsedMs + (timer.running && timer.startedAt ? now - startedMs : 0);
    void push({ ...timer, running: false, startedAt: null, elapsedMs });
  }

  function reset() {
    setReminder(null);
    firedRef.current = false;
    void push({ ...timer, running: false, startedAt: null, elapsedMs: 0 });
  }

  function setMode(mode: TimerState['mode'], durationSec: number) {
    setReminder(null);
    firedRef.current = false;
    void push({ ...timer, mode, durationSec, startedAt: null, elapsedMs: 0, running: false });
  }

  const total = timer.durationSec;
  const progress = total > 0 ? Math.min(100, ((total - remaining) / total) * 100) : 0;

  return (
    <GlassCard className="mx-auto max-w-xl space-y-5 p-6">
      <div className="text-center">
        <p className="text-sm text-soft">
          {timer.mode === 'pomodoro' ? 'Pomodoro' : 'Custom timer'}
          {timer.running ? ' · running' : ''}
        </p>
        <p className="mt-2 font-mono text-6xl font-semibold tracking-tight text-ink">
          {formatDuration(remaining)}
        </p>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-glass-bg/40">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {reminder && (
        <p role="status" className="rounded-xl bg-success/15 px-3 py-2 text-center text-sm text-success">
          {reminder}
        </p>
      )}

      {canControl ? (
        <>
          <div className="flex flex-wrap justify-center gap-2">
            {!timer.running ? (
              <GlassButton loading={busy} onClick={start}>
                Start
              </GlassButton>
            ) : (
              <GlassButton variant="ghost" loading={busy} onClick={pause}>
                Pause
              </GlassButton>
            )}
            <GlassButton variant="subtle" onClick={reset}>
              Reset
            </GlassButton>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-glass-border/10 pt-4">
            <GlassButton
              size="sm"
              variant={timer.mode === 'pomodoro' ? 'primary' : 'subtle'}
              onClick={() => setMode('pomodoro', 25 * 60)}
            >
              Pomodoro 25:00
            </GlassButton>
            <GlassButton
              size="sm"
              variant={timer.mode === 'pomodoro' ? 'primary' : 'subtle'}
              onClick={() => setMode('pomodoro', 5 * 60)}
            >
              Break 5:00
            </GlassButton>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={180}
                value={customMin}
                onChange={(e) => setCustomMin(Number(e.target.value))}
                className="focus-ring w-16 rounded-xl glass-subtle px-2 py-1 text-center text-sm text-ink"
                aria-label="Custom minutes"
              />
              <GlassButton
                size="sm"
                variant="subtle"
                onClick={() => setMode('custom', Math.max(1, customMin) * 60)}
              >
                Set custom
              </GlassButton>
            </div>
          </div>
        </>
      ) : (
        <p className="text-center text-sm text-faint">
          Only the room owner or a moderator can control the timer.
        </p>
      )}

      {error && <p className="text-center text-xs text-danger">{error}</p>}

      <p className="text-center text-xs text-faint">
        The timer stays in sync using server timestamps, so every device shows the same countdown.
      </p>
    </GlassCard>
  );
}

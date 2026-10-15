import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassButton } from '@/components/ui/GlassButton';
import { Avatar } from '@/components/ui/Badge';
import { supabase, iceServers, hasTurnRelay } from '@/lib/supabase';

interface Signal {
  type: 'join' | 'offer' | 'answer' | 'ice' | 'leave';
  from: string;
  to?: string;
  name?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

interface Peer {
  pc: RTCPeerConnection;
  stream: MediaStream | null;
  analyser: AnalyserNode | null;
  name: string;
}

/**
 * Voice chat over a small WebRTC mesh, signalled through Supabase Realtime.
 *
 * IMPORTANT (also in docs/LIMITATIONS.md): a mesh works for a handful of
 * participants. Peer-to-peer audio needs a STUN server (configured) and, for
 * users behind symmetric NATs / restrictive networks, a TURN relay. Without a
 * TURN server some pairs simply will not connect — that is expected, not a bug.
 */
export default function VoicePanel({
  roomId,
  me,
}: {
  roomId: string;
  me: { id: string; name: string };
}) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<{ userId: string; name: string }[]>([]);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());

  const channelRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const audioHostRef = useRef<HTMLDivElement>(null);
  const joinedRef = useRef(false);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const send = useCallback((signal: Signal) => {
    void channelRef.current?.send({ type: 'broadcast', event: 'sig', payload: signal });
  }, []);

  /* ----------------------------- signalling ---------------------------- */

  const closePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.close();
    peersRef.current.delete(peerId);
  }, []);

  const createPeer = useCallback(
    async (peerId: string, initiator: boolean, name = 'Participant') => {
      if (peersRef.current.has(peerId)) return peersRef.current.get(peerId)!;

      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      const peer: Peer = { pc, stream: null, analyser: null, name };
      peersRef.current.set(peerId, peer);

      localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));

      pc.onicecandidate = (e) => {
        if (e.candidate) send({ type: 'ice', from: me.id, to: peerId, candidate: e.candidate.toJSON() });
      };

      pc.ontrack = (e) => {
        peer.stream = e.streams[0];
        // Attach an analyser for a simple speaking indicator.
        try {
          const ctx = (audioCtxRef.current ??= new AudioContext());
          const src = ctx.createMediaStreamSource(peer.stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          src.connect(analyser);
          peer.analyser = analyser;
        } catch {
          /* analyser is best-effort */
        }
        // Play remote audio.
        const el = document.createElement('audio');
        el.autoplay = true;
        el.srcObject = peer.stream;
        el.dataset.peer = peerId;
        audioHostRef.current?.appendChild(el);
      };

      if (initiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ type: 'offer', from: me.id, to: peerId, sdp: offer });
      }
      return peer;
    },
    [me.id, send],
  );

  const handleSignal = useCallback(
    async (sig: Signal) => {
      if (sig.to && sig.to !== me.id) return;
      if (sig.from === me.id) return;

      try {
        switch (sig.type) {
          case 'join': {
            if (!joinedRef.current) return;
            // Existing member offers to the newcomer.
            await createPeer(sig.from, true, sig.name);
            break;
          }
          case 'offer': {
            const peer = await createPeer(sig.from, false, sig.name);
            await peer.pc.setRemoteDescription(new RTCSessionDescription(sig.sdp!));
            const answer = await peer.pc.createAnswer();
            await peer.pc.setLocalDescription(answer);
            send({ type: 'answer', from: me.id, to: sig.from, sdp: answer });
            break;
          }
          case 'answer': {
            const peer = peersRef.current.get(sig.from);
            if (peer && peer.pc.signalingState !== 'stable') {
              await peer.pc.setRemoteDescription(new RTCSessionDescription(sig.sdp!));
            }
            break;
          }
          case 'ice': {
            const peer = peersRef.current.get(sig.from);
            if (peer && sig.candidate) await peer.pc.addIceCandidate(sig.candidate);
            break;
          }
          case 'leave': {
            closePeer(sig.from);
            break;
          }
        }
      } catch (e) {
        // A failed negotiation usually means no relay path exists.
        setError(`Connection issue: ${(e as Error).message}`);
      }
    },
    [me.id, createPeer, send, closePeer],
  );

  /* ------------------------------- channel ----------------------------- */

  useEffect(() => {
    const channel = supabase.channel(`voice:${roomId}`, {
      config: { presence: { key: me.id } },
    });
    channelRef.current = channel;

    channel.on('broadcast', { event: 'sig' }, (p) => void handleSignal(p.payload as Signal));

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<{ userId: string; name: string; voice?: boolean }>();
      const metas = Object.values(state).flat() as unknown as { userId: string; name: string; voice?: boolean }[];
      setParticipants(
        metas.filter((m) => m.voice && m.userId !== me.id).map((m) => ({ userId: m.userId, name: m.name })),
      );
    });

    channel.subscribe((state) => {
      if (state === 'SUBSCRIBED' && joinedRef.current) {
        void channel.track({ userId: me.id, name: me.name, voice: true });
      }
    });

    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId, me.id, me.name, handleSignal]);

  // Speaking indicator loop.
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Set<string>();
      const check = (analyser: AnalyserNode | null, key: string) => {
        if (!analyser) return;
        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        if (avg > 18) now.add(key);
      };
      check(localAnalyserRef.current, me.id);
      for (const [peerId, peer] of peersRef.current) check(peer.analyser, peerId);
      setSpeaking(now);
    }, 400);
    return () => clearInterval(id);
  }, [me.id]);

  /* -------------------------------- actions ---------------------------- */

  async function join() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setMuted(false);

      // Local analyser for our own speaking dot.
      try {
        const ctx = (audioCtxRef.current ??= new AudioContext());
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        localAnalyserRef.current = analyser;
      } catch {
        /* best-effort */
      }

      joinedRef.current = true;
      setJoined(true);
      await channelRef.current?.track({ userId: me.id, name: me.name, voice: true });
      send({ type: 'join', from: me.id, name: me.name });
    } catch (e) {
      setError(`Microphone access failed: ${(e as Error).message}`);
    }
  }

  function leave() {
    send({ type: 'leave', from: me.id });
    for (const id of [...peersRef.current.keys()]) closePeer(id);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    localAnalyserRef.current = null;
    audioHostRef.current?.replaceChildren();
    joinedRef.current = false;
    setJoined(false);
    void channelRef.current?.untrack();
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }

  // Clean up on unmount.
  useEffect(() => {
    const peers = peersRef.current;
    const localStream = localStreamRef.current;
    const audioCtx = audioCtxRef.current;
    return () => {
      for (const id of [...peers.keys()]) closePeer(id);
      localStream?.getTracks().forEach((t) => t.stop());
      void audioCtx?.close();
    };
  }, [closePeer]);

  const everyone = joined ? [{ userId: me.id, name: me.name }, ...participants] : participants;

  return (
    <GlassCard className="mx-auto max-w-xl space-y-5 p-6">
      <div>
        <h3 className="text-lg font-semibold text-ink">Voice chat</h3>
        <p className="text-sm text-soft">
          Optional room audio. Microphone access is requested only when you join.
        </p>
      </div>

      {!hasTurnRelay && (
        <p className="rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
          No TURN relay is configured. Voice will work on many networks but can fail to connect for
          some users. See docs/SETUP.md to add a relay.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!joined ? (
          <GlassButton onClick={join}>Join voice</GlassButton>
        ) : (
          <>
            <GlassButton variant={muted ? 'danger' : 'ghost'} onClick={toggleMute}>
              {muted ? 'Unmute' : 'Mute'}
            </GlassButton>
            <GlassButton variant="subtle" onClick={leave}>
              Leave voice
            </GlassButton>
          </>
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div>
        <p className="mb-2 text-sm text-soft">
          In voice ({everyone.length})
        </p>
        {everyone.length === 0 ? (
          <p className="text-sm text-faint">No one is in voice yet.</p>
        ) : (
          <ul className="space-y-2">
            {everyone.map((p) => (
              <li key={p.userId} className="flex items-center gap-3">
                <span className="relative">
                  <Avatar name={p.name} size={34} />
                  <span
                    className={
                      'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[rgb(var(--app-bg-1))] ' +
                      (speaking.has(p.userId) ? 'bg-success' : 'bg-ink-faint')
                    }
                  />
                </span>
                <span className="text-sm text-ink">
                  {p.name}
                  {p.userId === me.id && <span className="text-faint"> (you)</span>}
                  {p.userId === me.id && muted && <span className="text-danger"> · muted</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Hidden host for remote <audio> elements */}
      <div ref={audioHostRef} className="hidden" aria-hidden="true" />
    </GlassCard>
  );
}

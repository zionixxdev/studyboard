// =============================================================================
// Voice / video over WebRTC, meshed for small rooms (<= ~6 people).
// Signaling rides the room's authenticated Realtime channel as `rtc`
// broadcasts addressed to a specific peer id.
//
// IMPORTANT: with STUN only, calls succeed on most home and mobile networks but
// fail on restrictive NATs (some corporate/campus Wi-Fi). Universal
// connectivity needs a TURN relay, which is NOT provided on the free tier.
// The UI states this honestly rather than promising it always works.
// =============================================================================
import { ICE_SERVERS } from "./config.js";

export function createCall({ channel, getChannel, myId, nickname, onPeers, onStatus }) {
  // Resolve the Realtime channel lazily: the room creates the call object before
  // its channel exists, so we read it on every send instead of capturing it.
  const ch = () => (typeof getChannel === "function" ? getChannel() : (getChannel || channel));
  const pcs = new Map();          // peerId -> RTCPeerConnection
  const remoteStreams = new Map();// peerId -> MediaStream
  const pendingIce = new Map();   // peerId -> RTCIceCandidateInit[]
  let localStream = null;
  let inCall = false;
  let micOn = true;
  let camOn = false;
  let peersInCall = new Set();

  const status = (s) => onStatus?.(s);
  const emitPeers = () => onPeers?.({ inCall, micOn, camOn, peers: [...peersInCall], streams: remoteStreams });

  // Deterministic initiator so both sides agree who sends the offer (no glare).
  const shouldInitiate = (peerId) => String(myId) < String(peerId);

  function newPc(peerId) {
    if (pcs.has(peerId)) return pcs.get(peerId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) send(peerId, "ice", e.candidate.toJSON());
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      remoteStreams.set(peerId, stream);
      emitPeers();
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "failed") { status("Connection failed — a TURN relay may be required on this network."); tryIceRestart(peerId); }
      if (st === "disconnected") status("Connection interrupted — reconnecting…");
      if (st === "connected") status("Connected.");
    };
    pcs.set(peerId, pc);
    return pc;
  }

  async function tryIceRestart(peerId) {
    const pc = pcs.get(peerId);
    if (!pc || !shouldInitiate(peerId)) return;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      send(peerId, "offer", offer);
    } catch { /* give up quietly */ }
  }

  function send(to, kind, data) {
    ch()?.send({ type: "broadcast", event: "rtc", payload: { to, from: myId, nickname, kind, data } });
  }

  // ---------------------------------------------------------------- signaling
  async function handleSignal(msg) {
    if (!msg || msg.from === myId) return;
    if (msg.to !== myId && msg.to !== "*") return;   // directed at us, or a broadcast
    const peerId = msg.from;
    peersInCall.add(peerId);

    try {
      if (msg.kind === "hello") {
        // A peer announced they are in the call; the designated initiator offers.
        if (shouldInitiate(peerId) && inCall) await offerTo(peerId);
        emitPeers();
        return;
      }
      if (msg.kind === "offer") {
        const pc = newPc(peerId);
        await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
        await flushIce(peerId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send(peerId, "answer", answer);
        emitPeers();
        return;
      }
      if (msg.kind === "answer") {
        const pc = pcs.get(peerId);
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
        await flushIce(peerId, pc);
        return;
      }
      if (msg.kind === "ice") {
        const pc = pcs.get(peerId);
        if (!pc || !pc.remoteDescription) {
          const arr = pendingIce.get(peerId) || [];
          arr.push(msg.data); pendingIce.set(peerId, arr);
          return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(msg.data));
        return;
      }
      if (msg.kind === "bye") {
        closePeer(peerId);
        return;
      }
    } catch (e) {
      status("Signaling error: " + (e?.message || e));
    }
  }

  async function flushIce(peerId, pc) {
    const arr = pendingIce.get(peerId) || [];
    for (const c of arr) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
    pendingIce.delete(peerId);
  }

  async function offerTo(peerId) {
    const pc = newPc(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send(peerId, "offer", offer);
  }

  function closePeer(peerId) {
    const pc = pcs.get(peerId);
    if (pc) { pc.onicecandidate = null; pc.ontrack = null; pc.close(); pcs.delete(peerId); }
    remoteStreams.delete(peerId);
    peersInCall.delete(peerId);
    emitPeers();
  }

  // --------------------------------------------------------------- public API
  async function join({ video = false } = {}) {
    if (inCall) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    } catch (e) {
      status("Microphone/camera permission denied — cannot join the call.");
      throw e;
    }
    camOn = video;
    micOn = true;
    inCall = true;
    status("In call. Connecting to peers…");
    // Announce presence so existing members can offer to us.
    ch()?.send({ type: "broadcast", event: "rtc", payload: { to: "*", from: myId, nickname, kind: "hello", data: null } });
    emitPeers();
  }

  async function leave() {
    for (const peerId of pcs.keys()) { send(peerId, "bye", null); closePeer(peerId); }
    ch()?.send({ type: "broadcast", event: "rtc", payload: { to: "*", from: myId, nickname, kind: "bye", data: null } });
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;
    inCall = false;
    status("Not in a call.");
    emitPeers();
  }

  function toggleMic() {
    micOn = !micOn;
    localStream?.getAudioTracks().forEach(t => { t.enabled = micOn; });
    emitPeers();
    return micOn;
  }

  async function toggleCam() {
    camOn = !camOn;
    const existing = localStream?.getVideoTracks()?.[0];
    if (existing) {
      existing.enabled = camOn;
    } else if (camOn) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        const track = s.getVideoTracks()[0];
        localStream.addTrack(track);
        for (const [peerId, pc] of pcs.entries()) {
          pc.addTrack(track, localStream);
          if (shouldInitiate(peerId)) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            send(peerId, "offer", offer);
          }
        }
      } catch { camOn = false; status("Camera permission denied."); }
    }
    emitPeers();
    return camOn;
  }

  function getLocalStream() { return localStream; }

  function destroy() { leave().catch(() => {}); }

  return { join, leave, toggleMic, toggleCam, handleSignal, getLocalStream, destroy,
           get state() { return { inCall, micOn, camOn, peers: [...peersInCall], streams: remoteStreams }; } };
}

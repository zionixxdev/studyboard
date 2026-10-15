// Shared, server-authoritative Pomodoro timer.
// The server stores the last known state; every client derives the remaining
// time from `started_at`/`elapsed_before_pause`, so all devices agree even
// after a refresh. Concurrent presses are serialised by an optimistic
// `version` check — the loser gets a stale-version error and just re-syncs.
import { sb } from "./supabase-client.js";

export function createTimer({ roomId, onState, onError }) {
  let state = null;
  let channel = null;
  let ticker = null;

  async function load() {
    const { data, error } = await sb
      .from("timer_state")
      .select("*")
      .eq("room_id", roomId)
      .maybeSingle();
    if (error) throw error;
    state = data;
    onState?.(state);
    return state;
  }

  function remaining() {
    if (!state) return 0;
    let elapsed = state.elapsed_before_pause || 0;
    if (state.running && state.started_at) {
      elapsed += (Date.now() - new Date(state.started_at).getTime()) / 1000;
    }
    return Math.max(0, (state.duration_seconds || 0) - elapsed);
  }

  async function control(action, duration) {
    const version = state?.version ?? null;
    const { data, error } = await sb.rpc("timer_control", {
      p_room: roomId, p_action: action, p_version: version,
      p_duration: duration ?? null,
    });
    if (error) {
      if (String(error.message).includes("stale timer version")) { await load(); return; }
      onError?.(error.message); return;
    }
    state = Array.isArray(data) ? data[0] : data;
    onState?.(state);
  }

  function subscribe(onChange) {
    channel = sb
      .channel("timer:" + roomId)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "timer_state", filter: `room_id=eq.${roomId}` },
        (payload) => {
          state = payload.new;
          onState?.(state);
          onChange?.(state);
        })
      .subscribe();
    return channel;
  }

  // Local 4 Hz repaint; when a running timer hits zero, one client claims the
  // transition to the next phase (others see the stale-version error and yield).
  let claimedZero = false;
  function startTicking(render) {
    stopTicking();
    ticker = setInterval(() => {
      const rem = remaining();
      render?.(rem, state);
      if (state?.running && rem <= 0 && !claimedZero) {
        claimedZero = true;
        control("skip").finally(() => setTimeout(() => { claimedZero = false; }, 2000));
      }
    }, 250);
  }
  function stopTicking() { if (ticker) clearInterval(ticker); ticker = null; }

  function destroy() { stopTicking(); if (channel) sb.removeChannel(channel); }

  return { load, control, remaining, subscribe, startTicking, stopTicking, destroy, get state() { return state; } };
}

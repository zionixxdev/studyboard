// Group chat. Messages are durable (chat_messages) and delivered live via
// Realtime `postgres_changes`. A client-generated client_id (unique per room)
// makes inserts idempotent, so a reconnect can never duplicate a message.
import { sb } from "./supabase-client.js";
import { randomId } from "./util.js";

export function createChat({ roomId, me }) {
  const seen = new Set();
  let channel = null;

  async function load(limit = 60) {
    const { data, error } = await sb
      .from("chat_messages")
      .select("id, author_id, nickname, body, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    const rows = (data || []).reverse();
    rows.forEach(r => seen.add(r.id));
    return rows;
  }

  // Returns the new row, or null if this was a duplicate.
  async function send(body, nickname) {
    const client_id = randomId();
    const { data, error } = await sb
      .from("chat_messages")
      .insert({ room_id: roomId, author_id: me, nickname, body, client_id })
      .select()
      .single();
    if (error) {
      if (String(error.message).includes("duplicate")) return null;
      throw error;
    }
    seen.add(data.id);
    return data;
  }

  function subscribe(onMessage) {
    channel = sb
      .channel("chat:" + roomId)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
        (payload) => {
          const row = payload.new;
          if (!row || seen.has(row.id)) return;   // de-dupe
          seen.add(row.id);
          onMessage(row);
        })
      .subscribe();
    return channel;
  }

  function destroy() { if (channel) sb.removeChannel(channel); }

  return { load, send, subscribe, destroy };
}

# Realtime design — StudyBoard

## 1. Two kinds of state

StudyBoard deliberately separates **durable** state (must survive a refresh and a
reconnect) from **transient** state (only meaningful in the moment).

| Signal | Transport | Durable? | Why |
| --- | --- | --- | --- |
| Committed drawing objects | DB insert + room broadcast | ✅ `board_objects` | Must reload after refresh |
| In-progress stroke points | Room broadcast only | ❌ | High frequency; worthless once committed |
| Remote cursor position | Room broadcast only | ❌ | Ephemeral by nature |
| Chat messages | DB insert + `postgres_changes` | ✅ `chat_messages` | History, ordering, de-duplication |
| Roster / presence | Realtime **presence** | ❌ (roster row is durable) | "Who is here now" |
| Membership changes | `postgres_changes` | ✅ `room_members` | Access control must persist |
| Timer state | RPC + `postgres_changes` | ✅ `timer_state` | Shared authoritative clock |
| Document metadata | `postgres_changes` | ✅ `documents` | Shared file list |
| PDF annotations | DB insert + `postgres_changes` | ✅ `annotations` | Persist separately from the file |
| Voice/video signalling | Room broadcast | ❌ | Only needed during call setup |

Rule of thumb: **if a late joiner must see it, it goes to the database; if it is
only useful right now, it stays a broadcast.**

## 2. Channels

One authenticated room channel carries everything room-scoped:

```
sb.channel("room:<roomId>", { config: { presence: { key: userId },
                                        broadcast: { self: false } } })
  .on("broadcast", { event: "op" },     …)   // committed add/delete
  .on("broadcast", { event: "live" },   …)   // in-progress stroke
  .on("broadcast", { event: "cursor" }, …)   // pointer position
  .on("broadcast", { event: "rtc" },    …)   // WebRTC signalling
  .on("presence",  { event: "sync" },   …)   // who is online
  .on("postgres_changes", { table: "chat_messages", … })
  .on("postgres_changes", { table: "room_members",  … })
  .on("postgres_changes", { table: "rooms",         … })
  .on("postgres_changes", { table: "documents",     … })
  .on("postgres_changes", { table: "board_pages",   … })
```

`broadcast: { self: false }` means a client never receives its own broadcast — it
already applied the change locally, which removes a whole class of duplication.

Tables that must stream live are added to the `supabase_realtime` publication
(`0005_realtime.sql`) with `REPLICA IDENTITY FULL` so UPDATE/DELETE payloads
carry every column.

## 3. The hard cases

**Duplicate events.** Every durable row has a stable id and every chat message a
per-room `client_id`. Both the sender and the receiver keep a seen-set, so the
same event applied twice is a no-op. Strokes are keyed by a client-generated
UUID; `applyRemote` ignores an id it already has. Undo of an "add" is a
`delete` carrying the same id, so replaying it is also idempotent.

**Out-of-order messages.** Chat is ordered by the server's `created_at` and
loaded newest-first then reversed, so history is always monotonic regardless of
arrival order. Board objects are ordered by a client `z` (creation time), which
is stable across devices.

**Reconnection & initial state.** On `SUBSCRIBED`, the client re-tracks presence
and runs `resync()`: it refetches members, the timer, chat, files, and the
current page's objects. Anything missed while offline is therefore reconciled
from the database rather than replayed. The connection pill reflects
`SUBSCRIBED` / `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` honestly.

**Concurrent edits.** Board objects are append-mostly, so conflicts are rare by
construction. The timer is the one genuinely contended resource and uses
optimistic concurrency: `timer_control` takes the caller's last-seen `version`,
row-locks the state, and rejects a mismatch with a stale-version error; the
loser simply re-syncs. When a running timer hits zero, several clients may race
to advance the phase — the version check lets exactly one win and the rest yield.

**Deleted or revoked rooms.** `postgres_changes` on `rooms` catches a DELETE and
ejects the client with a notice. Revoked invites simply stop working; a locked
room refuses new joins server-side.

**Network interruptions.** The service worker never intercepts Supabase traffic,
so the Realtime socket reconnects on its own; `resync()` repairs state. Local
work that could not be sent surfaces an error and is not silently lost.

**Excessive event frequency.** Three throttles keep slow connections usable:
drawing points broadcast at ~60 ms and trimmed to the most recent 24 points;
cursors at ~90 ms; the client's `eventsPerSecond` capped at 20. Finished strokes
are sent once, as a single object.

## 4. Failure modes and what the user sees

| Failure | Behaviour |
| --- | --- |
| Socket drops | Pill → "reconnecting…"; on reconnect state reconciles |
| Backend unreachable | Pill → "offline"; actions report an error; loaded content stays visible |
| Offline | Offline banner + shell; the UI states live collaboration needs a connection |
| Stale timer write | Silently re-syncs; no duplicate phase change |
| Storage upload rejected | Clear message (size/type); nothing partially written |

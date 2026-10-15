# Security review — StudyBoard

StudyBoard is treated as a real application used by students, not a demo. This
document states the threat model, the controls in place, and what was actually
verified against a live database.

## 1. Trust model

- **The browser is untrusted.** Every room id, nickname, role and user id sent
  from the client is re-derived or re-validated on the server. Nothing security
  relevant is taken on faith.
- **The publishable/anon key is public.** It is shipped to every browser by
  design. It grants nothing on its own — Row Level Security is what constrains
  access. The `service_role` key and database password are **never** in frontend
  code.
- **Identity is a real account** — email + password, or Google. Supabase
  verifies credentials server-side and issues its own session; the app only ever
  sees `auth.uid()`. A user id is therefore durable and is not a bearer
  credential tied to one browser.

## 2. Controls

### Row Level Security
RLS is enabled on all eleven public tables. There are no default-allow tables.

- `rooms`, `board_*`, `chat_messages`, `documents`, `annotations`, `timer_state`,
  `room_events`, `room_members` — readable only by members of that room, via the
  `SECURITY DEFINER` helpers `is_room_member` / `is_room_owner` / `can_access_room`
  (which bypass RLS and therefore cannot recurse).
- **No INSERT policy** on `rooms`, `room_members` or `invite_codes` — rows can
  only be created through vetted RPCs. A browser cannot insert itself into a room
  or mint itself an invitation.
- `chat_messages` INSERT additionally requires
  `nickname = (the caller's room_members.nickname)` and `author_id = auth.uid()`,
  so **nicknames cannot be spoofed**.
- `board_objects` UPDATE/DELETE require authorship **or** room ownership.
- `invite_codes` are selectable **only by the room owner**.
- `rate_limits` has no policies at all; only definer functions touch it.

### Server-authoritative RPCs (`SECURITY DEFINER`)
All run as the table owner, re-derive `auth.uid()`, validate inputs, and check
membership/ownership before acting:

| Function | Guard |
| --- | --- |
| `create_room` | auth required; name/nickname length checks; rate-limited |
| `join_room` | hashes the code, checks revoked/expired/exhausted/locked; rate-limited |
| `rotate_invite`, `revoke_invite` | owner only |
| `remove_member` | owner only; cannot remove the owner |
| `leave_room` | members only; owners must delete instead |
| `delete_room`, `set_room_locked`, `clear_board`, `delete_page` | owner only |
| `create_page`, `timer_control`, `touch_presence` | member only |
| `set_nickname` | self only |
| `_rl_check`, `_gen_invite_code`, `cleanup_old_rooms` | not granted to clients |

### Invitations
- 10 characters from a 32-symbol unambiguous alphabet
  (`A–Z` minus `I/O`, `2–9`) → ~50 bits of entropy per code.
- **Only the SHA-256 hash is stored.** The plaintext exists solely in the share
  link. The consequence (an owner who loses the link must rotate) is surfaced in
  the UI rather than hidden.
- Revocation is immediate and owner-only.

### Storage
- The `room-files` bucket is **private** (`public = false`).
- Objects are stored at `<room_id>/<uuid>-<name>`; storage policies resolve the
  room from the first path segment and require membership. A malformed segment
  yields `NULL` via `try_uuid()` → access denied rather than an error.
- Server-enforced limits: 25 MB per object and a PDF/PNG/JPG/WEBP/GIF MIME
  allow-list (belt-and-braces with the client-side check).
- Files are served via short-lived **signed URLs** (1 hour), never public URLs.

### Input handling and abuse limits
- All user text is HTML-escaped before rendering; only `http(s)` URLs are turned
  into links (`target="_blank" rel="noopener noreferrer"`).
- Chat is capped at 2000 chars; nicknames at 32; room names at 80 — enforced in
  both the UI and database `CHECK` constraints.
- Fixed-window rate limits (server-side, `_rl_check`) on room creation and
  joining. Supabase's own auth and Realtime limits sit in front of everything.
- Graph expressions are parsed by a small **whitelist evaluator** — `eval()` is
  never used, so a "function" cannot execute code.

### Error hygiene
RPCs raise typed, user-facing errors (e.g. *"invite code not found"*) and never
leak internals. The client maps them to friendly text.

## 3. Verified against the live database

Executed with simulated authenticated sessions against the deployed schema.
Every one of these held:

| Check | Result |
| --- | --- |
| Non-member sees zero rooms / chat / board objects / invite codes | ✅ 0 rows |
| Wrong invite code | blocked |
| Correct code joins; member then sees 1 room, 2 members | ✅ |
| Member promotes self to owner | 0 rows affected; role stays `member` |
| Member calls `clear_board` | blocked (not owner) |
| Member inserts chat with a spoofed nickname | blocked by RLS |
| Member inserts chat with their own nickname | allowed |
| Stale timer write (`version` mismatch) | rejected |
| Valid timer write | allowed |
| Non-member calls `timer_control` | blocked |
| Invite stored hashed (64-hex, ≠ plaintext) | ✅ |
| `rotate_invite` leaves exactly one active code | ✅ |

## 4. Known limitations (accepted, by design)

- **An account is mandatory.** There is no account-free mode: browser-local
  anonymous identity made rooms unreachable after any storage change, which is
  the failure this design removes.
- **No end-to-end encryption** of board/chat content; data is protected by RLS
  and TLS in transit, and readable by the project operator.
- **No TURN server** is provided, so some restrictive networks cannot place
  calls (a connectivity limit, not a confidentiality one). WebRTC media is
  DTLS-SRTP encrypted peer-to-peer.
- **Realtime broadcasts** are room-scoped and authenticated by the channel's RLS
  on `realtime.messages` (Supabase enforces membership for private channels);
  transient drawing payloads are not persisted.

## 5. Reporting

Found a problem? Open a private security advisory on the repository rather than
a public issue. Do not include real user data in a report.

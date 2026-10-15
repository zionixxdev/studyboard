# Testing — StudyBoard

Two layers: an **automated** check of the server-side security/logic, and a
**manual** two-device acceptance pass.

---

## 1. Automated (server-side)

The security-critical behaviour lives in SQL, so it is tested there. Against the
deployed schema, with simulated authenticated sessions:

```sql
-- Simulate a user by setting the JWT claims, then acting as `authenticated`:
select set_config('request.jwt.claims',
  json_build_object('sub', '<user-uuid>', 'role', 'authenticated')::text, true);
set local role authenticated;
select * from public.rooms;         -- RLS applies from here
```

Results of the last full run (all passed): non-members read zero rows everywhere;
wrong invite codes are rejected; members cannot self-promote (`UPDATE ... SET
role='owner'` affects 0 rows); `clear_board` is owner-only; chat rejects a
spoofed nickname but accepts the caller's own; stale timer writes are rejected
while valid ones succeed; invite codes are stored hashed; `rotate_invite` leaves
exactly one active code.

Re-run it any time — the script creates temporary users, exercises the RPCs, and
deletes the users at the end (cascade cleans up their rooms).

---

## 2. Manual acceptance checklist (two devices)

Prepare **Device A** (a laptop) and **Device B** (a phone on a *different*
network — mobile data is ideal). Open the deployed URL on both.

| # | Brief's acceptance test | Steps | Expected |
| --- | --- | --- | --- |
| 1 | Create + share an invite link | A: create a room → **Invite** → **Copy link** | Link contains `?invite=XXXXXXXXXX` |
| 2 | Join in a separate browser with a nickname | B: open the link → enter a nickname | B lands in the room; A's People panel shows B |
| 3 | Same drawing updates on both | A: draw with the pen; B: draw too | Strokes appear live on both; each sees the other's cursor |
| 4 | Chat without duplicates | Send several messages both ways; briefly toggle airplane mode on B, then send again | No message appears twice; order is sane |
| 5 | Board survives a refresh | Draw, then reload both pages | Everything is still there |
| 6 | Unauthorised access is denied | In a third, signed-out browser, call the REST API for the room id with the anon key | `[]` / 0 rows — never the room's data |
| 7 | No privilege escalation | As B, try to clear the board or remove A | Blocked; B's role stays `member` |
| 8 | Timer stays in sync | A: start the timer | B shows the same countdown within a second; both survive a refresh |
| 9 | Upload + annotate a PDF | A: upload a PDF → **Annotate** → draw | B can open the file and see the annotation |
| 10 | Call status is accurate | A: Join call (allow mic); deny the prompt once to check the failure path | Status reflects reality; buttons match state |
| 11 | Responsive | Resize A narrow; use B in portrait | Toolbars compact; side panel becomes a drawer |
| 12 | Disconnection is safe | Kill B's network mid-drawing, draw offline, restore | Nothing corrupts; on reconnect state reconciles |

### Security spot-checks
- Delete the room as owner → the other device is ejected with a notice.
- Rotate the invite link → the old link no longer joins.
- Lock the room → a fresh browser cannot join even with a valid code.
- Remove a member as owner → they lose access immediately.

### PWA
- Install the app from the browser menu on Android and desktop.
- Load once, go offline, reload → the offline shell appears and states that live
  collaboration needs a connection.

### Device matrix
Test at least: one low-end Android phone (Chrome), one iPhone (Safari), and one
desktop browser. Watch for: touch drawing latency, pinch-zoom, and the PDF
viewer on small screens.

---

## 3. What is *not* covered automatically

- Live WebRTC media (needs two real networks and, on strict NATs, TURN).
- Visual/canvas rendering fidelity (verify by eye).
- Cross-browser PDF rendering.

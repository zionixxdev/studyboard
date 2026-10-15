# Testing checklist

Run these against a configured Supabase project. They map directly to the
project's acceptance tests. Tick each one off.

## A. Authentication

- [ ] A new user can sign up; a verification email arrives (with SMTP
      configured) and confirming it activates the account.
- [ ] Before confirming, the user is held on `/verify` and cannot reach
      `/dashboard`.
- [ ] An existing user can log in and log out.
- [ ] Wrong password shows "Incorrect email or password."
- [ ] Unconfirmed email shows "Please confirm your email address first."
- [ ] Show/hide password toggles on signup, login and reset.
- [ ] Password strength guidance appears while typing on signup.
- [ ] Mismatched confirm-password shows an inline error.
- [ ] Submitting a form twice quickly does not create two accounts / two logins
      (button shows a spinner and is disabled).
- [ ] Forgot-password sends a reset link; the link opens `/reset-password`,
      which accepts a new password and then redirects to the dashboard.
- [ ] A used/expired reset link shows a clear message with a link to request a
      new one.
- [ ] Sessions persist across a page reload (you stay signed in).
- [ ] Signing out returns you to `/login`.

## B. Route protection

- [ ] Visiting `/dashboard`, `/room/:id` or `/profile` while signed out
      redirects to `/login`.
- [ ] Visiting `/login` or `/signup` while signed in redirects to `/dashboard`.

## C. Rooms and invitations

- [ ] A user can create a room with a name and optional subject; they become the
      owner.
- [ ] The dashboard lists the room with the correct role and member count.
- [ ] The owner can copy the invite code and invite link.
- [ ] A second registered user can join via the code **and** via the link.
- [ ] An invalid code shows "That invitation code is not valid."
- [ ] After the owner revokes the invite, joining shows "This invitation has
      been revoked…".
- [ ] "New code" regenerates the code and re-enables the invite.
- [ ] The owner can promote a member to moderator and remove a member.
- [ ] A moderator can remove a member but cannot delete the room or change
      roles (those are owner-only).
- [ ] A member who is not a manager sees no role/remove controls.

## D. Authorisation (the important part)

Using the browser devtools, as a signed-in **non-member**:

- [ ] `supabase.from('rooms').select()` returns only rooms you belong to.
- [ ] Requesting another room's messages returns nothing (RLS), even if you
      hand-craft the request.
- [ ] Calling `set_room_timer` on a room you don't manage raises
      "not allowed to control the timer".
- [ ] Calling `remove_room_member` as a plain member raises "not allowed to
      remove members".
- [ ] You cannot change your own role or remove the owner.

## E. Whiteboard

- [ ] Draw with mouse and with touch (phone/tablet); strokes render smoothly.
- [ ] Pen, highlighter, eraser, rectangle, ellipse, line, arrow and text all
      work.
- [ ] Colour and brush size apply.
- [ ] Undo and redo work; Clear empties the board for everyone.
- [ ] Grid toggle and zoom (+/−, wheel) and pan (Pan tool) work.
- [ ] With two participants, strokes appear on both screens in near real time.
- [ ] Remote cursors are visible.
- [ ] Save persists the board; reloading the room restores it.
- [ ] After a brief network drop, the board still shows the same content
      (reconnect + snapshot).

## F. PDF

- [ ] Uploading a non-PDF is rejected with a clear message.
- [ ] Uploading a file over 25 MB is rejected.
- [ ] A valid PDF uploads and appears in the list.
- [ ] It opens in the viewer; prev/next page and zoom work.
- [ ] Page changes sync to other participants in the room.
- [ ] A non-member cannot fetch the file (signed URL + storage policy).

## G. Maths

- [ ] The MathLive editor accepts typed input and the virtual keyboard.
- [ ] "Insert onto whiteboard" places the formula on the shared board for all
      participants.
- [ ] The plotter graphs `x^2 - 2`, `sin(x)`, etc.; Add circle / Add line work.

## H. Chat and presence

- [ ] Messages send and appear for all participants with name and time.
- [ ] "Load earlier messages" paginates older history.
- [ ] Join/leave system messages appear.
- [ ] The online indicator reflects who is connected.
- [ ] Rapid sending triggers the rate-limit message (and the server trigger).
- [ ] A non-member cannot read or send messages.

## I. Timer

- [ ] Start / Pause / Reset work for the owner or a moderator.
- [ ] Pomodoro presets and a custom duration can be set.
- [ ] Two participants see the same countdown despite different device clocks.
- [ ] A break reminder appears when a focus block completes.
- [ ] A plain member cannot change the timer.

## J. Voice (needs microphone; TURN recommended)

- [ ] Joining prompts for microphone permission only after clicking "Join voice".
- [ ] Mute / unmute toggles your microphone.
- [ ] Two participants on permissive networks hear each other.
- [ ] The speaking indicator lights up while someone talks.
- [ ] Leaving stops the microphone and removes you from the list.

## K. Profile & settings

- [ ] Display name changes and persists.
- [ ] Theme switches between dark / light / system and persists across reloads.
- [ ] Password change works; the new password signs you in next time.
- [ ] Account deletion asks for confirmation, then removes the account and
      returns you to `/login`.
- [ ] Reduced-motion preference (OS setting) quiets the background animations.

## L. Responsive & visual

- [ ] Layout works on a small Android screen (~360 px) and on desktop.
- [ ] All pages consistently use the liquid-glass style.
- [ ] Text has comfortable contrast in both themes.
- [ ] Touch targets are large enough to tap.

---

## Automated checks

```bash
npm run typecheck   # no type errors
npm run lint        # no lint errors
npm run build       # production build succeeds
```

There is no automated end-to-end suite in this scaffold — the checklist above is
the acceptance path. See [LIMITATIONS.md](LIMITATIONS.md) for what that implies.

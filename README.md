# StudyBoard

A real-time collaborative study portal. Spin up a room, share a link, and work
through problems together on a shared whiteboard with group chat, a
server-synchronised focus timer, file sharing, maths tools and voice/video.

Sign-in is a real account — **email + password, or Google** — so your rooms,
boards and files follow you across devices and survive clearing your browser
data.

Built as a **zero-build, zero-cost** Progressive Web App: a static frontend you
can host on GitHub Pages, backed by Supabase (Postgres + RLS + Realtime +
Storage + anonymous auth).

---

## 1. What's included

| Area | Status |
| --- | --- |
| Shared whiteboard (pen, highlighter, eraser, shapes, arrows, text, sticky notes) | ✅ |
| Pan / zoom / infinite-feeling canvas, normalised world coordinates | ✅ |
| Multi-page boards, save & restore, PNG + PDF export | ✅ |
| Multi-user undo / redo (you only undo *your* own work) | ✅ |
| Live drawing sync + remote cursors / presence | ✅ |
| Study rooms: create, invite codes, join by nickname, owner & member roles | ✅ |
| Group chat (links, inline LaTeX, de-duplicated across reconnects) | ✅ |
| PDF & image sharing with in-portal viewer and shared annotations | ✅ |
| Equation editor (MathLive + MathJax) and function plotting | ✅ |
| Class 11 PCM formula reference | ✅ |
| Shared, server-authoritative Pomodoro timer | ✅ |
| Voice / video (WebRTC, mesh, room-scoped signalling) | ✅ (STUN only — see limits) |
| PWA: installable, offline shell, dark mode | ✅ |
| Row Level Security, secure RPCs, rate limits, hashed invite codes | ✅ |

---

## 2. Tech stack

- **Frontend:** vanilla ES modules — no framework, no bundler, no build step.
- **Whiteboard:** HTML Canvas 2D.
- **Backend:** Supabase — PostgreSQL 17, Row Level Security, Realtime
  (broadcast + presence + `postgres_changes`), Storage, anonymous auth.
- **Voice/video:** WebRTC (mesh), signalling over the room's Realtime channel.
- **Maths:** MathLive (equation input) + MathJax (LaTeX → SVG for the canvas).
- **PDF:** pdf.js. **PDF export:** jsPDF. All heavy libraries are lazy-loaded.
- **Hosting:** GitHub Pages (static) + Supabase (backend).

---

## 3. Quick start (local)

```bash
git clone <your-repo-url> studyboard
cd studyboard

# Any static server works — ES modules need http(s), not file://
python3 -m http.server 8080
#   or:  npx serve -l 8080
```

Open <http://localhost:8080>.

The repo ships with a working `js/config.js` pointing at the reference Supabase
project, so it runs immediately. To point at **your own** project, see §4.

### Configuring `js/config.js`

There is no build step and nothing injects environment variables: the browser
reads `js/config.js` at runtime, so you edit that file directly.

```bash
cp config.example.js js/config.js   # then fill in your URL + anon key
```

The publishable/anon key is safe to commit — it is public by design, and RLS is
what protects the data. Keep only the `service_role` key out of the frontend.
There is deliberately **no** `package.json`: the project is a plain folder of
files, which is what makes it a free, build-free static site on any host.

---

## 4. Supabase setup (from scratch)

1. **Create a project** at <https://supabase.com> (free tier is enough).
   Note its **Project URL** and **anon / publishable key** (Settings → API).

2. **Apply the schema.** Either paste each file from
   `supabase/migrations/` into the SQL editor *in order*, or use the CLI:

   ```bash
   npm i -g supabase
   supabase link --project-ref <your-ref>
   supabase db push          # applies supabase/migrations/*.sql in order
   ```

   The migrations create every table, index, RLS policy, secure RPC, the
   Realtime publication and the private `room-files` storage bucket.

3. **Turn on sign-in.** The app supports email + password and Google.

   **Email + password** works out of the box, but check two settings under
   **Authentication → Sign In / Providers → Email**:
   - **Confirm email** — if ON (Supabase's default), a new user must click the
     link in their inbox before they can sign in. The app says so plainly.
     Turn it OFF for a frictionless start; leave it ON if you want verified
     addresses.
   - **Minimum password length** — the UI enforces 6 characters.

   **Google (optional).** In the
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   create an **OAuth client ID** of type **Web application** with this
   **Authorised redirect URI**:

   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```

   Copy the Client ID and secret, then in Supabase go to
   **Authentication → Sign In / Providers → Google**, enable it, paste both, and
   Save.

   Finally, in **Authentication → URL Configuration**, set the **Site URL** and
   add every URL the app is served from to **Redirect URLs** — e.g.
   `http://localhost:8080/**` and `https://<you>.github.io/<repo>/**`. Sign-in
   redirects and password-reset links both come back through this list, so a
   missing entry is the usual cause of a redirect error.

4. **(Recommended) Add a site URL** under Authentication → URL Configuration so
   redirects and rate limits behave on your deployed domain.

5. Put your URL + anon key in `js/config.js` (or `.env` + the generator).

> The migrations are idempotent — re-running them is safe.

---

## 5. Deployment (GitHub Pages)

```bash
git init && git add . && git commit -m "StudyBoard"
git branch -M main
git remote add origin https://github.com/<you>/studyboard.git
git push -u origin main
```

Then **Settings → Pages → Build and deployment → Source: Deploy from a
branch → `main` / `root`**. Your app is live at
`https://<you>.github.io/studyboard/`.

A ready-made GitHub Actions workflow is included at
`.github/workflows/deploy-pages.yml` if you prefer Actions-based deployment
(Settings → Pages → Source: **GitHub Actions**).

`.nojekyll` is included so every file is served verbatim.

Full walkthrough, custom domains and troubleshooting: **[DEPLOYMENT.md](DEPLOYMENT.md)**.

---

## 6. Project structure

```
studyboard/
├── index.html                 # home / dashboard — create or join a room
├── room.html                  # the study workspace
├── offline.html               # PWA offline fallback
├── manifest.webmanifest       # PWA manifest
├── sw.js                      # service worker (app shell + offline)
├── .nojekyll                  # serve files verbatim on Pages
├── css/styles.css             # design system (light + dark)
├── js/
│   ├── config.js              # URL + publishable key + ICE servers
│   ├── supabase-client.js     # shared client (CDN import, no build)
│   ├── util.js                # pure helpers
│   ├── ui.js                  # theme, toasts, modals, connection pill
│   ├── auth.js                # anonymous session
│   ├── app.js                 # dashboard logic
│   ├── room.js                # workspace orchestrator
│   ├── whiteboard.js          # canvas engine (world coords, tools, undo)
│   ├── chat.js                # group chat (durable + de-duped)
│   ├── timer.js               # server-authoritative Pomodoro
│   ├── files.js               # storage upload / signed URLs
│   ├── webrtc.js              # voice/video mesh + signalling
│   └── math-tools.js          # equation editor, plotter, formula reference
├── icons/                     # PWA icons
├── supabase/migrations/       # 0001…0005 — schema, RLS, RPCs, storage, realtime
├── docs/architecture.md       # architecture + component responsibilities
├── docs/realtime.md           # event taxonomy & sync design
├── SECURITY.md · TESTING.md · DEPLOYMENT.md
└── .env.example · .gitignore · LICENSE
```

---

## 7. How it works (short version)

**Identity.** Each browser signs in anonymously; Supabase stores a stable user
id in `localStorage`. A room membership row binds that id to a nickname.

**Invites.** Invite codes are 10-character random strings from a 32-symbol
alphabet. Only the **SHA-256 hash** is stored — the plaintext exists only in the
share link. Joining goes through a `SECURITY DEFINER` function that validates
the code server-side; a browser can never insert itself into a room.

**Whiteboard.** Objects live in fixed *world* coordinates on a 2600×1700 virtual
board, so the same board renders correctly on a phone and a desktop. Finished
objects are persisted to `board_objects` and broadcast to peers; in-progress
strokes are broadcast only (ephemeral) and throttled, then committed on
stroke-end. Undo/redo is per-author.

**Realtime.** Two complementary channels (see `docs/realtime.md`):
*durable* state (chat, timer, roster, documents, pages) streams over
`postgres_changes` and reconciles on reconnect; *high-frequency* drawing uses
ephemeral broadcasts. Every operation is idempotent, so reconnects never
duplicate messages or strokes.

**Timer.** The server stores the authoritative state (`started_at`,
`elapsed_before_pause`); clients derive the remaining time from it, so all
devices agree after a refresh. Concurrent writes are serialised with an
optimistic `version` check.

Deeper write-ups: **[docs/architecture.md](docs/architecture.md)** ·
**[docs/realtime.md](docs/realtime.md)**.

---

## 8. Free-tier notes and honest limitations

Everything runs on free tiers, but some things have real limits — stated plainly
rather than promised away:

- **Voice/video needs a connection and usually a TURN relay.** STUN-only WebRTC
  works on most home and mobile networks, but **not** on restrictive
  corporate/campus NATs. Free TURN is not dependable; add credentialed TURN in
  `js/config.js` for universal connectivity. The UI never claims calls always
  work.
- **Live collaboration does not work offline.** Drawings, chat, the timer and
  calls all sync through the server. The offline shell shows already-loaded
  content and explains this; unsent local work is kept where feasible.
- **An account is required.** Email + password or Google, by design. The
  earlier account-free mode tied identity to a single browser's storage, so
  clearing site data silently made you a stranger to your own rooms. Invited
  friends must sign in too, so they now need an account where they previously
  needed only a nickname.
- **Supabase free-tier quotas** apply (database size, storage, bandwidth,
  Realtime concurrent connections, and a project that pauses after ~1 week of
  inactivity). `public.cleanup_old_rooms(days)` is provided for retention —
  schedule it with `pg_cron` or an Edge Function if you run long-term.
- **Board growth.** Every stroke is a row. For very large boards, compact a page
  into `board_pages.snapshot` and prune old `board_objects`. The schema already
  has the `snapshot` column for this.
- **The plaintext invite code cannot be re-read.** Because only the hash is
  stored, an owner who loses the link must **rotate** to mint a new one (the UI
  offers this automatically).

---

## 9. Security

Row Level Security is enabled on **every** room-scoped table, and all sensitive
mutations go through `SECURITY DEFINER` functions that re-derive identity from
`auth.uid()`. Verified in a live database (see `TESTING.md`): non-members read
nothing, members cannot promote themselves, nicknames cannot be spoofed in chat,
owners alone can clear boards or revoke invites, and stale timer writes are
rejected.

Details and the full checklist: **[SECURITY.md](SECURITY.md)**.

> **Never** put the `service_role` key or a database password in the frontend.
> Only the publishable/anon key belongs in `js/config.js` — it is designed to be
> public, and RLS is what actually protects the data.

---

## 10. Testing

`TESTING.md` has a two-device acceptance checklist that maps 1:1 to the twelve
acceptance tests in the project brief.

---

## Licence

MIT — see [LICENSE](LICENSE).

# StudyBoard

A real-time collaborative study platform: shared virtual rooms with a
liquid-glass interface, a collaborative whiteboard, chat, PDF viewing,
mathematical tools, a synchronised study timer and optional voice chat.

Built with **React + TypeScript + Vite**, **Tailwind CSS**, and **Supabase**
(Auth, Postgres with Row Level Security, Realtime, and private Storage).

> This is a working, production-minded scaffold, not a mockup. Nothing is faked:
> authentication is real, permissions are enforced in Postgres, and features that
> need external configuration say so instead of pretending to work.

---

## What works

- **Authentication** — email/password signup with email verification, login,
  logout, password reset, show/hide password, session persistence.
- **Dashboard** — welcome, create room, join by code, room list with roles.
- **Rooms & invitations** — secure random invite codes, revocable/regenerable,
  shareable links, roles (owner / moderator / member), server-side permission
  checks.
- **Whiteboard** — pen, highlighter, eraser, shapes, text; colour and size;
  undo/redo; clear; grid; zoom/pan; real-time sync of incremental ops; remote
  cursors; save/restore snapshots; touch support.
- **PDF viewer** — upload (validated), view, page navigation, zoom, private
  storage with signed URLs, page sync across participants.
- **Math tools** — MathLive equation editor (inserts onto the board) and a
  JSXGraph coordinate plane.
- **Chat & presence** — real-time messages with pagination, online list,
  join/leave notices, server-side rate limiting.
- **Study timer** — Pomodoro/custom, start/pause/reset, server-timestamp sync,
  break reminder.
- **Voice** — WebRTC mesh with Supabase Realtime signalling, mute, speaking
  indicator. *Requires a TURN relay for some networks — see below.*
- **Profile & settings** — display name, theme (dark/light/system), password
  change, account deletion.

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in your Supabase URL + anon key
# run supabase/migrations/*.sql in the Supabase SQL editor (see docs/SETUP.md)
npm run dev
```

Open http://localhost:5173. Full instructions: **[docs/SETUP.md](docs/SETUP.md)**.

If the Supabase env vars are missing, the app shows a setup screen instead of
faking a login.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build for production into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript check without emitting |
| `npm run lint` | ESLint |

## Project structure

```
studyboard/
├── index.html
├── package.json, vite.config.ts, tailwind.config.js, tsconfig*.json
├── .env.example
├── docs/
│   ├── SETUP.md          Supabase + local setup, from scratch
│   ├── DEPLOYMENT.md     Hosting guide (Vercel / Netlify / Cloudflare Pages)
│   ├── TESTING.md        Acceptance-test checklist
│   └── LIMITATIONS.md    Known gaps, quotas and config dependencies
├── supabase/migrations/
│   ├── 0001_init.sql     Tables, indexes, triggers, storage bucket
│   ├── 0002_rls.sql      Row Level Security + storage policies
│   └── 0003_functions.sql SECURITY DEFINER RPCs
└── src/
    ├── main.tsx, App.tsx, index.css
    ├── lib/              supabase client, utils, room API
    ├── contexts/         AuthContext, ThemeContext
    ├── hooks/            useRooms, useRoom, useRoomRealtime
    ├── components/
    │   ├── ui/           GlassCard, GlassButton, GlassInput, Modal, …
    │   ├── layout/       AppShell, ProtectedRoute, ThemeToggle
    │   ├── auth/         AuthLayout, PasswordField
    │   └── room/         Whiteboard, ChatPanel, PdfPanel, MathPanel,
    │                     TimerPanel, VoicePanel, MembersPanel, InvitePanel, …
    ├── pages/            Login, Signup, Forgot/ResetPassword, VerifyEmail,
    │                     Dashboard, Room, Profile, JoinRedirect, …
    └── types/            db.ts (schema types), intrinsics.d.ts
```

## Security model (short version)

- The browser ships only the Supabase **anon** key; every table has **RLS**.
- Membership, roles and room ownership are written only by **SECURITY DEFINER**
  RPCs — the client can never grant itself permissions.
- Uploaded files live in a **private** bucket, reachable only via short-lived
  signed URLs by room members.
- The **service_role** key is never used in frontend code.

See **[docs/SETUP.md](docs/SETUP.md)** and **[docs/LIMITATIONS.md](docs/LIMITATIONS.md)**
for the details and the honest list of what still needs configuring.

# Setup — from scratch

This walks you from an empty machine to a running StudyBoard, using free tiers
only. Budget about 20 minutes.

You need: **Node.js 18.18+**, **npm**, and a free **Supabase** account
(supabase.com). A GitHub account helps for deployment but isn't required to run
locally.

---

## 1. Install dependencies

```bash
npm install
```

## 2. Create the Supabase project

1. Go to https://supabase.com, sign in, and click **New project**.
2. Pick an organisation, give the project a name (e.g. `studyboard`), set a
   database password, and choose the region closest to your users.
3. Wait ~2 minutes for provisioning.

## 3. Copy the API keys

In the Supabase dashboard, open **Project Settings → API**. You need two values:

- **Project URL** — looks like `https://abcdefgh.supabase.co`
- **anon public** key — a long JWT under *Project API keys*

> Use the **anon** key only. The **service_role** key bypasses Row Level
> Security and must never be placed in frontend code or committed.

Create your env file:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```ini
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
VITE_APP_URL=http://localhost:5173
```

## 4. Create the database schema

Open **SQL Editor** in the Supabase dashboard, and run the three migration files
**in order**. Paste each file's contents and click **Run**:

1. `supabase/migrations/0001_init.sql` — tables, indexes, triggers, the private
   `room-files` storage bucket, and Realtime for chat.
2. `supabase/migrations/0002_rls.sql` — Row Level Security policies and storage
   policies.
3. `supabase/migrations/0003_functions.sql` — the RPCs the app calls.

Each file is idempotent enough to re-run safely while developing (it uses
`create or replace` / `if not exists` / `drop policy if exists`).

> **Prefer the CLI?** If you have the Supabase CLI and a linked project, run
> `supabase db push` instead — it applies the same files.

Verify it worked: **Table Editor** should now list `profiles`, `rooms`,
`room_members`, `messages`, `whiteboard_snapshots`, `files`, and `room_state`.

## 5. Configure Authentication

Open **Authentication → Providers → Email**:

- Ensure **Email** is enabled.
- **Confirm email**: leave this **ON** to require email verification (the app
  handles the "confirm your email" screen). Turn it **OFF** if you want to skip
  verification while developing — the app detects either mode automatically.

### Redirect URLs (required for verification and password reset)

Open **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:5173`
- **Redirect URLs** — add both:
  - `http://localhost:5173/verify`
  - `http://localhost:5173/reset-password`

When you deploy, add your production equivalents too (see
[DEPLOYMENT.md](DEPLOYMENT.md)).

### Email delivery (needed for real verification / reset mails)

Supabase's built-in email service is fine for testing but is **heavily rate
limited** and not intended for production. To send real mail:

Open **Project Settings → Auth → SMTP Settings** and enter your own SMTP
credentials (e.g. Resend, Postmark, SendGrid, Amazon SES, or Gmail SMTP for
testing). Then, under **Authentication → Email Templates**, you can customise
the confirmation and recovery emails.

> Without SMTP configured, signup/reset emails may not arrive. This is a
> configuration dependency, not an app bug.

## 6. Storage

The private bucket `room-files` is created by `0001_init.sql`. Confirm it exists
under **Storage**. It is **private**; the app serves files through short-lived
signed URLs and the storage policies in `0002_rls.sql` restrict access to room
members.

Default free-tier limits apply (see [LIMITATIONS.md](LIMITATIONS.md)).

## 7. Run the app

```bash
npm run dev
```

Open http://localhost:5173.

1. **Sign up** with a real email you can access.
2. Open the verification email and confirm (or, if you disabled confirmation,
   you'll land straight on the dashboard).
3. Sign in, create a room, and copy the invite link.
4. Open the invite link in a second browser profile (or an incognito window),
   sign in as another user, and join — you should see both participants live.

## 8. Optional: voice chat (TURN relay)

Voice works peer-to-peer with a free STUN server out of the box, but some
networks (symmetric NATs, restrictive corporate/mobile networks) need a **TURN**
relay. Options:

- **Self-host coturn** on a small VM (free-tier VMs exist, but this is real
  infrastructure to maintain).
- **Managed TURN**: Twilio Network Traversal, Cloudflare Calls, Metered, etc.
  These generally require payment details and have usage limits.

When you have one, add it to `.env.local`:

```ini
VITE_TURN_URL=turn:your-turn-host:3478
VITE_TURN_USERNAME=your-username
VITE_TURN_CREDENTIAL=your-credential
```

The Voice tab shows a warning whenever no TURN relay is configured — that is
intentional.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "StudyBoard needs Supabase configured" screen | `.env.local` missing or the dev server wasn't restarted after editing it |
| Signup works but no email arrives | SMTP not configured / rate-limited — see step 5 |
| "Invalid login credentials" right after signup | Email not confirmed — check the inbox/spam, or disable confirmation |
| Redirected to `/verify` in a loop | Email confirmation is on and the address isn't confirmed yet |
| `permission denied` on a table | RLS policies not applied — re-run `0002_rls.sql` |
| Voice connects for some people only | No TURN relay — see step 8 |
| PDF upload fails | File over 25 MB, not a PDF, or storage policy not applied |

# Known limitations & configuration dependencies

This is an honest list. Where a feature depends on external configuration or has
a known shortcoming, it is stated here rather than hidden.

## Requires external configuration to be fully functional

### Email delivery (verification & password reset)
The app calls Supabase Auth, which sends verification and recovery emails. Out
of the box Supabase's shared mailer is **heavily rate-limited** (a handful of
messages per hour) and not meant for production. To make signup verification and
password reset reliable you must configure your own **SMTP** provider in the
Supabase dashboard. Until then, those emails may not arrive.

### Voice chat (TURN relay)
Voice uses WebRTC in a peer-to-peer mesh with a free **STUN** server. This
connects most users, but peers behind symmetric NATs or restrictive corporate /
mobile networks will **fail to connect without a TURN relay**. TURN is usually a
paid service or self-hosted infrastructure. The Voice tab warns whenever no
relay is configured. Do not expect voice to work reliably for every network pair
without one.

## Feature limitations

- **Voice is a mesh.** Every participant connects to every other participant.
  This is fine for a small study group (roughly up to 5–6 people) but does not
  scale; a larger room needs an SFU. Simultaneous joins can occasionally require
  a rejoin.
- **Whiteboard formulas** are drawn on the canvas as their **LaTeX source**
  rather than fully typeset. The Math tab previews the typeset form with
  MathLive; rendering typeset math onto the canvas would need MathJax-to-SVG.
- **Whiteboard text/formulas are not draggable** after placement.
- **Whiteboard performance**: a full redraw happens on undo/redo and on
  zoom/pan. Very large boards (thousands of strokes) will eventually slow down;
  the committed layer is offscreen-cached to keep normal drawing smooth.
- **Undo/redo** broadcasts a full snapshot rather than an inverse op, so it is
  slightly heavier than a single stroke on the wire.
- **PDF annotation** is limited to discussing alongside the document (chat) —
  drawing directly on the PDF page is not implemented.
- **PDF search** within the document is not implemented (page nav and zoom are).
- **Study-session history** and **recently shared files** on the dashboard are
  placeholders pointing at the relevant rooms; a dedicated history table is not
  included.
- **Notifications**: there is an email-notification preference field, but no
  background job sends notifications yet.
- **Invite codes are stored in plain text** (like meeting codes) and are visible
  to room members, not just the owner. Owners can revoke or regenerate them at
  any time. If you need codes to be secret even from members, add column-level
  privileges and an owner-only RPC.
- **No automated end-to-end tests** are included; `docs/TESTING.md` is a manual
  acceptance checklist.
- **Legal pages** (`/terms`, `/privacy`) are placeholders — replace them before
  any real deployment.

## Free-tier quotas (Supabase and hosting)

The project is designed to start at **₹0**, but free tiers have real limits.
Check the current Supabase pricing page for exact numbers; as a guide:

- **Database**: ~500 MB free. Text data (rooms, messages) is small; large
  message volumes and history will eventually matter.
- **Storage**: ~1 GB free. PDFs are capped at **25 MB each** in the app, so
  roughly dozens of files.
- **Bandwidth / egress**: limited per month. Serving many large PDFs to many
  users will consume it.
- **Realtime**: concurrent connections and messages-per-second are limited.
  Voice **does not** use Supabase Realtime for media — only for signalling — so
  media does not count against it, but signalling does.
- **Auth**: monthly active user limits on the free tier.
- **Inactivity**: free projects are paused after a period of inactivity.

Static hosting (Vercel / Netlify / Cloudflare Pages) is free for hobby use, with
bandwidth limits.

The app is written to **degrade gracefully**: if a feature can't work (e.g. voice
without TURN, email without SMTP), it says so instead of failing silently. It
does **not** promise unlimited users, storage, bandwidth, or voice minutes.

## Things that are intentionally not done for you

- No fake or hardcoded authentication anywhere.
- No placeholder-only buttons: anything that looks interactive does something,
  or is clearly marked.
- Secrets are never bundled: only the anon key ships; the service_role key stays
  server-side.

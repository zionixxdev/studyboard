# Deployment

StudyBoard builds to a folder of static files (`dist/`), so any static host
works. This guide covers three free options and the Supabase settings you must
update for each.

## Before you deploy

```bash
npm run build      # produces dist/
npm run preview    # sanity-check the production build locally
```

The app is a single-page app, so your host must **rewrite unknown paths to
`/index.html`** (otherwise refreshing `/room/xyz` 404s). Each host below shows
how.

## Environment variables

Set these in your host's dashboard (never commit them):

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your anon public key |
| `VITE_APP_URL` | Your production URL, e.g. `https://studyboard.vercel.app` |
| `VITE_STUN_URL` | `stun:stun.l.google.com:19302` (optional) |
| `VITE_TURN_URL` / `_USERNAME` / `_CREDENTIAL` | Only if you have a TURN relay |

> Vite inlines `VITE_*` values at build time. After changing them, **redeploy**.

## Supabase settings for production

In **Authentication → URL Configuration**:

- Set **Site URL** to your production URL.
- Add to **Redirect URLs**:
  - `https://YOUR-DOMAIN/verify`
  - `https://YOUR-DOMAIN/reset-password`

Optionally, under **Authentication → Attack Protection**, review rate limits and
CAPTCHA settings for a public deployment.

---

## Option A — Vercel (recommended)

1. Push the project to GitHub.
2. On vercel.com: **Add New → Project → Import** your repo.
3. Framework preset: **Vite**. Build command `npm run build`, output `dist`.
4. Add the environment variables above under **Settings → Environment Variables**.
5. Deploy.
6. Add `vercel.json` so client-side routes resolve:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

7. Copy the deployment URL into `VITE_APP_URL` and into Supabase's Site URL and
   redirect list, then redeploy.

## Option B — Netlify

1. Push to GitHub, then **Add new site → Import an existing project**.
2. Build command `npm run build`, publish directory `dist`.
3. Add environment variables under **Site settings → Environment variables**.
4. Add a `public/_redirects` file (or a Netlify redirect rule):

```
/*  /index.html  200
```

5. Update Supabase URLs as above.

## Option C — Cloudflare Pages

1. **Workers & Pages → Create → Pages → Connect to Git**.
2. Build command `npm run build`, output directory `dist`.
3. Add environment variables under **Settings → Environment variables**.
4. Cloudflare Pages handles SPA fallback automatically for a single-page app.
5. Update Supabase URLs as above.

---

## Custom domain

Add the domain in your host's dashboard, point DNS as instructed, then update
**both** `VITE_APP_URL` and Supabase's Site URL + Redirect URLs to the custom
domain and redeploy.

## Checklist

- [ ] `npm run build` succeeds locally
- [ ] Environment variables set on the host (anon key only — never service_role)
- [ ] SPA rewrite / fallback configured
- [ ] Supabase Site URL and Redirect URLs updated for the production domain
- [ ] Signup → verification email → login works on the live site
- [ ] Creating a room and joining from another browser works
- [ ] `VITE_APP_URL` matches the deployed URL (so auth links point to the right place)

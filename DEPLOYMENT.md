# Deployment — StudyBoard

Two independent pieces: a **static frontend** (GitHub Pages) and a **backend**
(Supabase). Neither needs a build step.

---

## 1. Supabase (backend)

1. Create a project (free tier). Copy the **Project URL** and **anon /
   publishable key** from Settings → API.
2. Apply the migrations in `supabase/migrations/` **in order** — either paste
   each into the SQL editor, or:
   ```bash
   npm i -g supabase
   supabase link --project-ref <your-ref>
   supabase db push
   ```
3. **Turn on sign-in.** Email + password works immediately — just decide whether
   to keep **Confirm email** on (Authentication → Sign In / Providers → Email).
   For Google, create an OAuth client ID (type: Web application) in Google Cloud
   Console with the authorised redirect URI
   `https://<your-project-ref>.supabase.co/auth/v1/callback`, then enable
   **Authentication → Sign In / Providers → Google** and paste the ID + secret.

   In **Authentication → URL Configuration**, set the Site URL and add your
   app's URLs to Redirect URLs (`http://localhost:8080/**` plus the deployed
   URL). Sign-in redirects and password-reset links return through this list, so
   a missing entry is the usual cause of a redirect error.
4. Authentication → URL Configuration: add your Pages URL.
5. Verify: `select * from pg_policies where schemaname='public';` should list the
   policies; Storage should show a private `room-files` bucket.

---

## 2. Frontend (GitHub Pages)

### Option A — deploy from a branch
1. Push the repo to GitHub.
2. Settings → Pages → Source: **Deploy from a branch** → `main` / `/ (root)`.
3. Live at `https://<you>.github.io/<repo>/`.

### Option B — GitHub Actions
1. Settings → Pages → Source: **GitHub Actions**.
2. The included `.github/workflows/deploy-pages.yml` publishes on every push to
   `main`.

`.nojekyll` is present so all files are served verbatim.

### Point the frontend at your backend
Edit `js/config.js` and set `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

There is no build step, so nothing injects these for you — the browser reads the
file at runtime. `config.example.js` is a template to copy from.

---

## 3. Custom domain
Settings → Pages → Custom domain, then add the `CNAME` record at your DNS
provider. Enable **Enforce HTTPS**. Update Supabase's URL Configuration to match.

---

## 4. Post-deploy checks
- [ ] Landing page loads; the connection pill reads **connected**.
- [ ] Create a room → you land in the workspace.
- [ ] Copy the invite link and open it in a private window → you can join.
- [ ] Upload a small PDF → it opens.
- [ ] Reload → the board is still there.
- [ ] Install the PWA.

---

## 5. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Connection pill stays **offline** | Wrong URL/key in `js/config.js`, or the Supabase project is paused. |
| "Anonymous sign-in failed" | The Anonymous provider is not enabled (step 3 above). |
| Everything 401/403 | The project is paused, or the key is a `service_role` key placed in the frontend (remove it). |
| Realtime events don't arrive | The tables must be in the `supabase_realtime` publication — re-run `0005_realtime.sql`. |
| Uploads fail | Bucket missing, or MIME/size outside the allow-list. Re-run `0004_storage.sql`. |
| Calls connect on one network, not another | Symmetric NAT — you need a TURN relay (see README §8). |
| Pages shows a 404 for JS | You're on a subpath; all asset paths are relative, so check you published from the repo root. |

---

## 6. Free-tier hygiene
- Supabase pauses inactive projects after ~1 week — open the dashboard or ping
  the API occasionally.
- Schedule retention: `select public.cleanup_old_rooms(30);` (via `pg_cron` or an
  Edge Function).
- Delete orphaned storage objects when rooms are deleted if you keep files
  long-term.

import { GlassCard } from '@/components/ui/GlassCard';

/**
 * Shown when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. The app
 * deliberately does not fall back to fake auth — it tells you what to configure.
 */
export default function SetupNotice() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <GlassCard variant="strong" sheen className="w-full max-w-2xl p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          StudyBoard needs Supabase configured
        </h1>
        <p className="mt-2 text-sm text-soft">
          Authentication and data are backed by Supabase. Add your project keys to a{' '}
          <code className="rounded bg-glass-bg/50 px-1.5 py-0.5">.env.local</code> file, then restart
          the dev server.
        </p>

        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-soft">
          <li>
            Create a project at supabase.com and open <strong>Project Settings → API</strong>.
          </li>
          <li>
            Copy the <strong>Project URL</strong> and the <strong>anon public</strong> key.
          </li>
          <li>
            Create <code className="rounded bg-glass-bg/50 px-1.5 py-0.5">.env.local</code> from{' '}
            <code className="rounded bg-glass-bg/50 px-1.5 py-0.5">.env.example</code> and set:
          </li>
        </ol>

        <pre className="mt-3 overflow-x-auto rounded-2xl glass-subtle p-4 text-xs text-ink">
{`VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
VITE_APP_URL=http://localhost:5173`}
        </pre>

        <p className="mt-4 text-sm text-soft">
          Then run the SQL in <code className="rounded bg-glass-bg/50 px-1.5 py-0.5">supabase/migrations/</code>{' '}
          and restart with <code className="rounded bg-glass-bg/50 px-1.5 py-0.5">npm run dev</code>.
          Full steps are in <strong>docs/SETUP.md</strong>.
        </p>

        <p className="mt-4 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
          Never put the service_role key here — only the anon public key belongs in the browser.
        </p>
      </GlassCard>
    </main>
  );
}

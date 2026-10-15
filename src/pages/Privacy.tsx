import { GlassCard } from '@/components/ui/GlassCard';

/**
 * Placeholder privacy page. Replace with your own policy before deployment.
 */
export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <GlassCard variant="strong" className="p-8">
        <h1 className="text-2xl font-semibold text-ink">Privacy Policy</h1>
        <p className="mt-3 text-sm text-soft">
          This is placeholder text shipped with the StudyBoard scaffold. Replace it with your own
          policy before deploying to real users.
        </p>
        <p className="mt-3 text-sm text-soft">
          Account data (email, display name) and the content you create (rooms, messages, files,
          whiteboards) are stored in your own Supabase project, protected by Row Level Security.
          Uploaded files live in a private storage bucket and are shared only with room members.
        </p>
      </GlassCard>
    </main>
  );
}

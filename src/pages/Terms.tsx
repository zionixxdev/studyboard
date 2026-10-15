import { GlassCard } from '@/components/ui/GlassCard';

/**
 * Placeholder legal page. Replace the text with your own policy before any
 * real deployment — signup requires accepting these.
 */
export default function Terms() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <GlassCard variant="strong" className="p-8">
        <h1 className="text-2xl font-semibold text-ink">Terms of Use</h1>
        <p className="mt-3 text-sm text-soft">
          This is placeholder text shipped with the StudyBoard scaffold. Replace it with your own
          terms before deploying to real users.
        </p>
        <p className="mt-3 text-sm text-soft">
          By creating an account you agree to use the service lawfully, to keep your credentials
          secure, and to respect other participants in shared rooms.
        </p>
      </GlassCard>
    </main>
  );
}

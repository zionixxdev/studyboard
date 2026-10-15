import { Link } from 'react-router-dom';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassButton } from '@/components/ui/GlassButton';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <GlassCard variant="strong" sheen animated className="max-w-md p-8 text-center">
        <p className="text-5xl font-bold text-accent">404</p>
        <h1 className="mt-3 text-xl font-semibold text-ink">Page not found</h1>
        <p className="mt-2 text-sm text-soft">
          The page you're looking for doesn't exist or has moved.
        </p>
        <Link to="/dashboard" className="mt-6 inline-block">
          <GlassButton>Back to dashboard</GlassButton>
        </Link>
      </GlassCard>
    </main>
  );
}

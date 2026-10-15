import { cn } from '@/lib/utils';

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block animate-spin rounded-full border-2 border-current border-t-transparent opacity-80', className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Full-surface loading state for lazy-loaded panels and route fallbacks. */
export function FullPageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3 text-soft">
      <Spinner size={32} />
      <p className="text-sm">{label}</p>
    </div>
  );
}

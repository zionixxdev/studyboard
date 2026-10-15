import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Badge({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode;
  tone?: 'default' | 'accent' | 'danger' | 'success';
  className?: string;
}) {
  const tones = {
    default: 'bg-glass-bg/50 text-soft',
    accent: 'bg-accent/20 text-accent',
    danger: 'bg-danger/20 text-danger',
    success: 'bg-success/20 text-success',
  } as const;
  return (
    <span
      className={cn(
        'pill inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Simple initials avatar with a deterministic gradient tint. */
export function Avatar({ name, size = 36 }: { name?: string | null; size?: number }) {
  const label = (name ?? '?').trim();
  const initial = (label[0] ?? '?').toUpperCase();
  // Deterministic hue from the name so avatars are stable across sessions.
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) % 360;
  return (
    <span
      className="pill inline-flex shrink-0 items-center justify-center font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(145deg, hsl(${hash} 70% 55%), hsl(${(hash + 40) % 360} 70% 45%))`,
      }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

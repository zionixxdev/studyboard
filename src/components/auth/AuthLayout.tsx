import type { ReactNode } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';

/** Shared shell for the auth pages: centred glass card over the ambient bg. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl glass-strong text-lg font-bold text-accent">
            SB
          </div>
          <span className="text-xl font-semibold tracking-tight text-ink">StudyBoard</span>
        </div>

        <GlassCard variant="strong" sheen animated className="p-7 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-soft">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </GlassCard>

        {footer && <div className="mt-5 text-center text-sm text-soft">{footer}</div>}
      </div>
    </main>
  );
}

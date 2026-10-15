import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Avatar } from '@/components/ui/Badge';
import { GlassButton } from '@/components/ui/GlassButton';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

/** Top navigation shared by all signed-in pages. */
export function AppShell({ children }: { children: ReactNode }) {
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const name = profile?.display_name ?? user?.email ?? 'You';

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-glass-border/10 glass">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link to="/dashboard" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl glass-strong text-sm font-bold text-accent">
              SB
            </span>
            <span className="hidden text-lg font-semibold tracking-tight text-ink sm:block">
              StudyBoard
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle className="hidden sm:block" />
            <Link
              to="/profile"
              className="focus-ring pill flex items-center gap-2 px-1.5 py-1 hover:bg-glass-bg/40"
              aria-label="Profile and settings"
            >
              <Avatar name={name} size={32} />
              <span className="hidden max-w-[10rem] truncate text-sm text-soft md:block">
                {name}
              </span>
            </Link>
            <GlassButton
              variant="subtle"
              size="sm"
              className={cn('hidden sm:inline-flex')}
              onClick={async () => {
                await signOut();
                navigate('/login', { replace: true });
              }}
            >
              Sign out
            </GlassButton>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

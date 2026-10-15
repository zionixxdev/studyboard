import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';

/** Compact dark/light switch that respects the ambient design. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const isDark = resolved === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cn(
        'focus-ring pill relative h-9 w-16 glass-subtle transition-colors hover:bg-glass-bg/50',
        className,
      )}
    >
      <span
        className={cn(
          'absolute top-1 grid h-7 w-7 place-items-center rounded-full bg-accent text-xs text-white transition-all duration-300',
          isDark ? 'left-1' : 'left-8',
        )}
      >
        {isDark ? '🌙' : '☀️'}
      </span>
    </button>
  );
}

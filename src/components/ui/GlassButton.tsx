import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

export interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-accent/90 to-accent/70 text-white border border-white/20 shadow-glow hover:from-accent hover:to-accent/80',
  ghost:
    'glass text-ink hover:bg-glass-bg/60',
  subtle:
    'glass-subtle text-soft hover:text-ink hover:bg-glass-bg/45',
  danger:
    'bg-gradient-to-b from-danger/90 to-danger/70 text-white border border-white/15 hover:from-danger hover:to-danger/80',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-6 text-sm',
  lg: 'h-12 px-8 text-base',
};

/** Pill-shaped glass button with hover lift and a disabled/loading state. */
export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(function GlassButton(
  { variant = 'primary', size = 'md', loading = false, block = false, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'focus-ring pill inline-flex select-none items-center justify-center gap-2 font-medium',
        'transition-all duration-200 ease-out active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100',
        !disabled && !loading && 'hover:-translate-y-0.5',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner size={16} />}
      {children}
    </button>
  );
});

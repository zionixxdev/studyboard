import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'strong' | 'subtle';

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  /** Adds a subtle specular highlight sweep across the top edge. */
  sheen?: boolean;
  /** Entrance animation (fade + rise). */
  animated?: boolean;
}

const variantClass: Record<Variant, string> = {
  default: 'glass',
  strong: 'glass-strong',
  subtle: 'glass-subtle',
};

/** A frosted, translucent surface — the base building block of the UI. */
export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard(
  { variant = 'default', sheen = false, animated = false, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-glass',
        variantClass[variant],
        sheen && 'glass-sheen',
        animated && 'animate-fade-up',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

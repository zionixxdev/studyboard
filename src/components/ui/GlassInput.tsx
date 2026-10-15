import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  hint?: string;
  /** Rendered inside the field on the right (e.g. a show/hide button). */
  trailing?: ReactNode;
}

/** Translucent glass text field with label, hint and inline error. */
export const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(function GlassInput(
  { label, error, hint, trailing, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-soft">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(
            'focus-ring h-11 w-full rounded-2xl px-4 text-ink placeholder:text-faint',
            'glass-subtle transition-colors duration-200',
            'focus:bg-glass-bg/45',
            trailing && 'pr-12',
            error && 'border-danger/60',
            className,
          )}
          {...rest}
        />
        {trailing && (
          <div className="absolute inset-y-0 right-2 flex items-center">{trailing}</div>
        )}
      </div>
      {error ? (
        <p id={`${inputId}-err`} role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

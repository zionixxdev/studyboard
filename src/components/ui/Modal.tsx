import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GlassCard } from './GlassCard';
import { cn } from '@/lib/utils';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Accessible glass modal: focus trap-lite, Esc to close, backdrop blur. */
export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog.
    const t = setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <GlassCard
        ref={panelRef}
        tabIndex={-1}
        variant="strong"
        sheen
        className={cn('relative z-10 w-full max-w-lg animate-fade-up p-6 focus-ring', className)}
      >
        {title && <h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>}
        <div className="text-soft">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-3">{footer}</div>}
      </GlassCard>
    </div>,
    document.body,
  );
}

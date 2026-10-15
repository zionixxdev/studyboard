import type { DetailedHTMLProps, HTMLAttributes } from 'react';

// MathLive registers a custom element. Declare it for TypeScript JSX.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & { 'virtual-keyboard-mode'?: string },
        HTMLElement
      >;
    }
  }
}

export {};

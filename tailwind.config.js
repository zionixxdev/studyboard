/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Liquid-glass palette — tuned for the dark midnight theme with a
        // light-mode counterpart driven by CSS variables in index.css.
        glass: {
          bg: 'rgb(var(--glass-bg) / <alpha-value>)',
          border: 'rgb(var(--glass-border) / <alpha-value>)',
          highlight: 'rgb(var(--glass-highlight) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
        },
        danger: 'rgb(var(--danger) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
      },
      borderRadius: {
        glass: '1.25rem',
        pill: '9999px',
      },
      backdropBlur: {
        glass: '20px',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
        'glass-sm': '0 4px 16px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.10)',
        glow: '0 0 40px rgba(var(--accent) / 0.35)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(0, -18px, 0)' },
        },
        drift: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(40px, -30px, 0) scale(1.08)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        float: 'float 9s ease-in-out infinite',
        drift: 'drift 18s ease-in-out infinite',
        shimmer: 'shimmer 2.4s linear infinite',
      },
    },
  },
  plugins: [],
};

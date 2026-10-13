import type { Config } from 'tailwindcss';

/**
 * Tailwind maps to the semantic tokens declared in `src/styles/tokens.css`
 * (see design-brief.md). Components reference `bg-surface` / `text-secondary`,
 * never a raw hex value — that is what keeps light and dark in step.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        surface: {
          DEFAULT: 'var(--bg-surface)',
          2: 'var(--bg-surface-2)',
        },
        rail: 'var(--bg-rail)',
        inset: 'var(--bg-inset)',
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        content: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          inverse: 'var(--text-inverse)',
          // Accent text. The numbered `brand` steps below are fill colours and
          // are unreadable as text on the dark theme — see tokens.css.
          brand: 'var(--brand-text)',
        },
        brand: {
          100: 'var(--brand-100)',
          200: 'var(--brand-200)',
          500: 'var(--brand-500)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
          900: 'var(--brand-900)',
          950: 'var(--brand-950)',
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--info)',
        ai: 'var(--ai)',
        note: 'var(--note)',
      },
      fontFamily: {
        sans: [
          'Inter Variable',
          'Inter var',
          'Inter',
          '-apple-system',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.5rem' }],
        lg: ['1.0625rem', { lineHeight: '1.625rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.625rem', { lineHeight: '2.125rem' }],
        '3xl': ['2.125rem', { lineHeight: '2.625rem' }],
      },
      // Read from tokens.css, so a theme can retune them — the dark theme's
      // shadows are hairline rings, which literal values here could not follow.
      borderRadius: {
        DEFAULT: 'var(--radius-sm)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      spacing: {
        rail: '56px',
        sidebar: '240px',
        list: '380px',
        details: '320px',
        topbar: '48px',
      },
    },
  },
  plugins: [],
} satisfies Config;

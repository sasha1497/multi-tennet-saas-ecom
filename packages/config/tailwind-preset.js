/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Shared Tailwind preset for merchant-web and storefront-web.
 *
 * Brand colours are wired to CSS custom properties so a tenant's stored theme
 * can repaint the storefront at runtime without a rebuild:
 *   <html style="--color-primary: 37 99 235">
 * Falls back to the design-system defaults when no tenant theme is set.
 */
const { palette, radii, shadows, breakpoints } = require('./dist/tokens.js');

/** `rgb(var(--x) / <alpha-value>)` keeps Tailwind opacity modifiers working. */
const withVar = (variable, fallback) => `rgb(var(${variable}, ${fallback}) / <alpha-value>)`;

module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    screens: {
      sm: `${breakpoints.sm}px`,
      md: `${breakpoints.md}px`,
      lg: `${breakpoints.lg}px`,
      xl: `${breakpoints.xl}px`,
      '2xl': `${breakpoints['2xl']}px`,
    },
    extend: {
      colors: {
        brand: palette.brand,
        accent: palette.accent,
        neutral: palette.neutral,
        success: palette.success,
        warning: palette.warning,
        danger: palette.danger,
        info: palette.info,

        // Runtime-themeable, driven by tenant branding.
        primary: {
          DEFAULT: withVar('--color-primary', '31 71 224'),
          fg: withVar('--color-primary-fg', '255 255 255'),
          soft: withVar('--color-primary-soft', '238 244 255'),
        },
        brandAccent: {
          DEFAULT: withVar('--color-accent', '249 115 22'),
          fg: withVar('--color-accent-fg', '255 255 255'),
        },

        // Semantic surface tokens (light/dark handled by the `dark:` variant).
        surface: {
          DEFAULT: withVar('--color-surface', '255 255 255'),
          muted: withVar('--color-surface-muted', '248 250 252'),
          raised: withVar('--color-surface-raised', '255 255 255'),
        },
        line: withVar('--color-border', '226 232 240'),
        content: {
          DEFAULT: withVar('--color-text', '15 23 42'),
          muted: withVar('--color-text-muted', '100 116 139'),
          subtle: withVar('--color-text-subtle', '148 163 184'),
        },
      },
      borderRadius: {
        sm: `${radii.sm}px`,
        DEFAULT: `${radii.md}px`,
        md: `${radii.md}px`,
        lg: `${radii.lg}px`,
        xl: `${radii.xl}px`,
        '2xl': `${radii['2xl']}px`,
      },
      boxShadow: {
        xs: shadows.xs,
        sm: shadows.sm,
        DEFAULT: shadows.sm,
        md: shadows.md,
        lg: shadows.lg,
        xl: shadows.xl,
      },
      fontFamily: {
        sans: [
          'var(--font-sans)',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.125rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
        md: ['0.9375rem', { lineHeight: '1.5rem' }],
        lg: ['1rem', { lineHeight: '1.5rem' }],
        xl: ['1.125rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.375rem', { lineHeight: '1.875rem' }],
        '3xl': ['1.75rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.125rem', { lineHeight: '2.5rem' }],
        '5xl': ['2.75rem', { lineHeight: '3rem' }],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in 140ms ease-out',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};

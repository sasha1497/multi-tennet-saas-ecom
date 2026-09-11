import type { Config } from 'tailwindcss';
import preset from '@retailos/config/tailwind-preset';

/**
 * Console theme.
 *
 * The shared preset is the platform-wide baseline — it is what the *storefront*
 * renders in, and a tenant's stored branding repaints it at runtime. The console
 * is not a storefront: it is RetailOS's own product surface and wants its own
 * voice, so everything below is layered on top of the preset and applies to this
 * app alone.
 *
 * That scoping is the whole point. `@retailos/ui` components are compiled by
 * each app's own Tailwind pass (both apps list `packages/ui/src` in `content`),
 * so tightening a radius or restating a shadow here changes how a shared `Card`
 * looks *in the console* while the storefront keeps exactly the geometry it has
 * always had. No shared file is edited, and no tenant design moves.
 */
const config: Config = {
  // The preset is a plain JS module (Tailwind requires CJS here), so its type is
  // widened rather than asserted — a preset legitimately has no `content` key.
  presets: [preset as Partial<Config>],
  content: [
    './src/**/*.{ts,tsx}',
    // The shared component library is compiled by Next, so Tailwind has to scan
    // it too or its class names get purged out of the stylesheet.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        /**
         * The sidebar's own palette.
         *
         * An ink rail against a light workspace is the console's single
         * strongest structural cue: it separates "where I am in the product"
         * from "what I am working on" without a single border, and it survives
         * the light/dark toggle by shifting one step rather than inverting.
         */
        rail: {
          DEFAULT: 'rgb(var(--rail-bg) / <alpha-value>)',
          raised: 'rgb(var(--rail-raised) / <alpha-value>)',
          line: 'rgb(var(--rail-line) / <alpha-value>)',
          fg: 'rgb(var(--rail-fg) / <alpha-value>)',
          muted: 'rgb(var(--rail-muted) / <alpha-value>)',
          subtle: 'rgb(var(--rail-subtle) / <alpha-value>)',
        },
        /** Accent ink for the console chrome — the brand at rail contrast. */
        iris: {
          50: '#f3f2fe',
          100: '#e8e5fd',
          200: '#d3cefb',
          300: '#b4aaf7',
          400: '#9182f1',
          500: '#7157e7',
          600: '#5b44dc',
          700: '#4b34bd',
          800: '#3e2d99',
          900: '#34277a',
          950: '#20174f',
        },
      },

      /**
       * Tighter than the storefront's.
       *
       * Storefront geometry is soft because it is selling something; an
       * operations console is read for hours and wants crisper corners. Every
       * step is pulled in, so shared components inherit the change without
       * knowing it happened.
       */
      borderRadius: {
        sm: '5px',
        DEFAULT: '7px',
        md: '7px',
        lg: '9px',
        xl: '12px',
        '2xl': '16px',
      },

      /**
       * Shadows that read as elevation rather than as a glow.
       *
       * Two layers each — a tight contact shadow plus a wider ambient one — and
       * a colder ink than the preset's, which keeps white panels sitting on the
       * canvas instead of floating above it.
       */
      boxShadow: {
        xs: '0 1px 1px 0 rgb(16 16 32 / 0.04)',
        sm: '0 1px 2px 0 rgb(16 16 32 / 0.05), 0 0 0 1px rgb(16 16 32 / 0.02)',
        DEFAULT: '0 1px 2px 0 rgb(16 16 32 / 0.05)',
        md: '0 2px 6px -1px rgb(16 16 32 / 0.07), 0 1px 2px -1px rgb(16 16 32 / 0.04)',
        lg: '0 10px 24px -8px rgb(16 16 32 / 0.16), 0 3px 8px -4px rgb(16 16 32 / 0.06)',
        xl: '0 24px 56px -16px rgb(16 16 32 / 0.22), 0 8px 20px -12px rgb(16 16 32 / 0.10)',
        rail: '1px 0 0 0 rgb(var(--rail-line))',
      },

      /**
       * A little more air than the storefront scale.
       *
       * Console body copy sits at 14px rather than the preset's 13.5px and every
       * heading step is nudged up, which is most of what separates a dense admin
       * that feels cheap from one that feels considered.
       */
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '0.9375rem', letterSpacing: '0.01em' }],
        xs: ['0.75rem', { lineHeight: '1.0625rem' }],
        sm: ['0.8125rem', { lineHeight: '1.1875rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
        md: ['0.9375rem', { lineHeight: '1.5rem' }],
        lg: ['1.0625rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em' }],
        xl: ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.015em' }],
        '2xl': ['1.5rem', { lineHeight: '1.9375rem', letterSpacing: '-0.02em' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.025em' }],
        '4xl': ['2.375rem', { lineHeight: '2.75rem', letterSpacing: '-0.03em' }],
        '5xl': ['3rem', { lineHeight: '3.25rem', letterSpacing: '-0.035em' }],
        '6xl': ['3.75rem', { lineHeight: '4rem', letterSpacing: '-0.04em' }],
        '7xl': ['4.5rem', { lineHeight: '4.75rem', letterSpacing: '-0.045em' }],
      },

      letterSpacing: {
        label: '0.06em',
      },

      /** Fixed widths the shell composes against, named so they stay in step. */
      width: {
        rail: '15.5rem',
        'rail-collapsed': '4.25rem',
      },
      spacing: {
        rail: '15.5rem',
        'rail-collapsed': '4.25rem',
        // Half-steps the preset does not carry, for 34px rows and 38px controls.
        8.5: '2.125rem',
        9.5: '2.375rem',
        10.5: '2.625rem',
        11.5: '2.875rem',
      },

      backgroundImage: {
        /** One restrained wash, used only behind marketing hero type. */
        'iris-wash':
          'radial-gradient(70rem 40rem at 50% -12rem, rgb(91 68 220 / 0.14), transparent 60%)',
        'grid-faint':
          'linear-gradient(to right, rgb(var(--color-border) / 0.55) 1px, transparent 1px),' +
          'linear-gradient(to bottom, rgb(var(--color-border) / 0.55) 1px, transparent 1px)',
      },

      keyframes: {
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'sheen': {
          from: { transform: 'translateX(-120%)' },
          to: { transform: 'translateX(120%)' },
        },
      },
      animation: {
        'rise-in': 'rise-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both',
        sheen: 'sheen 2.4s ease-in-out infinite',
      },
    },
  },
};

export default config;

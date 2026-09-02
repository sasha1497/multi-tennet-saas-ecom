/**
 * Design tokens — the single source of truth for the RetailOS design system.
 *
 * Consumed three ways:
 *   - `tailwind-preset.js` turns these into Tailwind theme values for both web apps
 *   - the mobile app imports them directly for its StyleSheet theme
 *   - the storefront overrides `primary`/`accent` at runtime from tenant branding
 *     via CSS custom properties, so a merchant's colours flow through everything
 */

/** Tailwind-compatible 50→950 ramps. */
export const palette = {
  brand: {
    50: '#eef4ff',
    100: '#d9e6ff',
    200: '#bcd3ff',
    300: '#8eb6ff',
    400: '#598eff',
    500: '#3366f2',
    600: '#1f47e0',
    700: '#1a37b5',
    800: '#1b3190',
    900: '#1c2e72',
    950: '#141d45',
  },
  accent: {
    50: '#fff7ed',
    100: '#ffedd5',
    200: '#fed7aa',
    300: '#fdba74',
    400: '#fb923c',
    500: '#f97316',
    600: '#ea580c',
    700: '#c2410c',
    800: '#9a3412',
    900: '#7c2d12',
    950: '#431407',
  },
  neutral: {
    0: '#ffffff',
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  },
  success: {
    50: '#ecfdf5',
    100: '#d1fae5',
    500: '#10b981',
    600: '#059669',
    700: '#047857',
  },
  warning: {
    50: '#fffbeb',
    100: '#fef3c7',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
  },
  danger: {
    50: '#fef2f2',
    100: '#fee2e2',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
  },
  info: {
    50: '#eff6ff',
    100: '#dbeafe',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
  },
} as const;

/** 4px base scale. */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

export const radii = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  '2xl': 28,
  full: 9999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 13,
  base: 14,
  md: 15,
  lg: 16,
  xl: 18,
  '2xl': 22,
  '3xl': 28,
  '4xl': 34,
  '5xl': 44,
} as const;

export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Soft, low-contrast elevation. Retail dashboards read better with subtle
 * shadows plus a hairline border than with heavy drop shadows.
 */
export const shadows = {
  xs: '0 1px 2px 0 rgb(15 23 42 / 0.04)',
  sm: '0 1px 3px 0 rgb(15 23 42 / 0.06), 0 1px 2px -1px rgb(15 23 42 / 0.04)',
  md: '0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.04)',
  lg: '0 12px 28px -8px rgb(15 23 42 / 0.14), 0 4px 10px -4px rgb(15 23 42 / 0.06)',
  xl: '0 24px 48px -12px rgb(15 23 42 / 0.18)',
} as const;

export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  drawer: 1200,
  modal: 1300,
  popover: 1400,
  toast: 1500,
} as const;

/** Default storefront theme applied to every newly provisioned tenant. */
export const defaultStoreTheme = {
  primaryColor: palette.brand[600],
  accentColor: palette.accent[500],
  radius: 'md' as const,
  fontFamily: 'Inter',
  colorMode: 'light' as const,
};

export type Palette = typeof palette;
export type Spacing = typeof spacing;
export type Radii = typeof radii;

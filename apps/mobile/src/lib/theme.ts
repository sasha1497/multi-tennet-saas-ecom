import { StyleSheet } from 'react-native';

/**
 * Mobile design tokens.
 *
 * Deliberately the same scale and palette as the web design system, so the two
 * surfaces feel like one product. Brand colours are overridden at runtime from
 * the tenant's stored theme via `ThemeProvider`.
 */
export const palette = {
  primary: '#1f47e0',
  primaryFg: '#ffffff',
  primarySoft: '#eef4ff',
  accent: '#f97316',

  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  border: '#e2e8f0',

  text: '#0f172a',
  textMuted: '#64748b',
  textSubtle: '#94a3b8',

  success: '#0ca30c',
  warning: '#fab219',
  danger: '#d03b3b',
  info: '#2a78d6',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
};

export const typography = StyleSheet.create({
  h1: { fontSize: 26, fontWeight: '700', color: palette.text, letterSpacing: -0.4 },
  h2: { fontSize: 20, fontWeight: '700', color: palette.text, letterSpacing: -0.2 },
  h3: { fontSize: 16, fontWeight: '600', color: palette.text },
  body: { fontSize: 14, color: palette.text },
  bodyMuted: { fontSize: 14, color: palette.textMuted },
  small: { fontSize: 12, color: palette.textMuted },
  tiny: { fontSize: 11, color: palette.textSubtle },
  price: { fontSize: 18, fontWeight: '700', color: palette.text },
});

export const shadow = {
  card: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
};

/** Order status → the reserved status colour, always shown with its label. */
export const statusColor: Record<string, string> = {
  PENDING: palette.warning,
  CONFIRMED: palette.info,
  PROCESSING: palette.info,
  SHIPPED: palette.info,
  OUT_FOR_DELIVERY: palette.info,
  DELIVERED: palette.success,
  CANCELLED: palette.danger,
  REFUNDED: palette.textSubtle,
};

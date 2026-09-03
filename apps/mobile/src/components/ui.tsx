import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { palette, radius, shadow, spacing, typography } from '@/lib/theme';

// ----------------------------------------------------------------- button --

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  icon,
  style,
  fullWidth,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
}) {
  const isDisabled = disabled || loading;
  const height = size === 'sm' ? 36 : size === 'lg' ? 52 : 44;

  const background =
    variant === 'primary'
      ? palette.primary
      : variant === 'danger'
        ? palette.danger
        : 'transparent';
  const textColor =
    variant === 'primary' || variant === 'danger' ? palette.primaryFg : palette.text;

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        {
          height,
          backgroundColor: background,
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: palette.border,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          width: fullWidth ? '100%' : undefined,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={size === 'lg' ? 18 : 16} color={textColor} />}
          <Text
            style={{
              color: textColor,
              fontSize: size === 'sm' ? 13 : size === 'lg' ? 16 : 15,
              fontWeight: '600',
            }}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

// ------------------------------------------------------------------ input --

export function Input({
  label,
  error,
  hint,
  style,
  ...props
}: TextInputProps & { label?: string; error?: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        placeholderTextColor={palette.textSubtle}
        style={[styles.input, error ? { borderColor: palette.danger } : null, style]}
        accessibilityLabel={label}
        {...props}
      />
      {error ? (
        <Text style={{ fontSize: 12, color: palette.danger }}>{error}</Text>
      ) : hint ? (
        <Text style={typography.tiny}>{hint}</Text>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------- card --

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// ------------------------------------------------------------------ badge --

export function Badge({
  label,
  color = palette.textSubtle,
}: {
  label: string;
  color?: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1A` }]}>
      {/* A dot plus the label — colour is never the only signal. */}
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={{ fontSize: 11, fontWeight: '600', color }}>{label}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ empty --

export function EmptyState({
  icon = 'cube-outline',
  title,
  description,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={24} color={palette.textSubtle} />
      </View>
      <Text style={[typography.h3, { textAlign: 'center' }]}>{title}</Text>
      {description && (
        <Text style={[typography.bodyMuted, { textAlign: 'center', marginTop: 4 }]}>
          {description}
        </Text>
      )}
      {action && <View style={{ marginTop: spacing.lg }}>{action}</View>}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={palette.primary} />
      {label && <Text style={[typography.small, { marginTop: spacing.sm }]}>{label}</Text>}
    </View>
  );
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: palette.border }} />;
}

export function Row({
  label,
  value,
  bold,
  color,
}: {
  label: string;
  value: string;
  bold?: boolean;
  color?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={bold ? typography.h3 : typography.bodyMuted}>{label}</Text>
      <Text
        style={[
          bold ? typography.h3 : typography.body,
          color ? { color } : null,
          { fontVariant: ['tabular-nums'] },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  label: { fontSize: 13, fontWeight: '600', color: palette.text },
  input: {
    height: 46,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: palette.text,
    backgroundColor: palette.surface,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});

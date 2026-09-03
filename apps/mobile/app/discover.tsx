import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Input } from '@/components/ui';
import { useStore } from '@/lib/store-context';
import { palette, radius, spacing, typography } from '@/lib/theme';

/**
 * Tenant discovery — the mobile answer to "which shop am I in?".
 *
 * A web shopper types a subdomain; a phone has no address bar, so the app
 * offers three routes to the same place:
 *   • type the store's short address
 *   • scan the QR code displayed in the shop
 *   • follow a deep link (`retailos://store/kickzone` or an https link), handled
 *     by the router without ever reaching this screen
 *
 * This is deliberately ONE app for every merchant rather than a white-label
 * build per shop — see docs/MOBILE.md for the reasoning.
 */
export default function DiscoverScreen() {
  const { selectStore } = useStore();
  const router = useRouter();

  const [slug, setSlug] = useState('');
  const [loading, setLoading] = useState(false);

  const open = async (value: string) => {
    if (!value.trim()) return;
    setLoading(true);
    const ok = await selectStore(value);
    setLoading(false);
    if (ok) router.replace('/(shop)');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.logo}>
              <Ionicons name="storefront" size={28} color={palette.primaryFg} />
            </View>
            <Text style={[typography.h1, { textAlign: 'center' }]}>Find your shop</Text>
            <Text style={[typography.bodyMuted, styles.heroText]}>
              Open any store on RetailOS. Enter its address, or scan the QR code at the counter.
            </Text>
          </View>

          <Card style={{ gap: spacing.lg }}>
            <Input
              label="Store address"
              placeholder="kickzone"
              autoCapitalize="none"
              autoCorrect={false}
              value={slug}
              onChangeText={setSlug}
              returnKeyType="go"
              onSubmitEditing={() => void open(slug)}
              hint="The short name on the shop's card or receipt."
            />
            <Button
              title="Open store"
              size="lg"
              fullWidth
              loading={loading}
              onPress={() => void open(slug)}
            />

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={typography.tiny}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <Button
              title="Scan store QR code"
              variant="outline"
              size="lg"
              fullWidth
              icon="qr-code-outline"
              onPress={() => router.push('/scan')}
            />
          </Card>

          {__DEV__ && (
            <Card style={{ marginTop: spacing.lg, backgroundColor: palette.surfaceMuted }}>
              <Text style={[typography.small, { fontWeight: '600', marginBottom: spacing.sm }]}>
                Demo stores
              </Text>
              {[
                { slug: 'kickzone', name: 'KickZone — footwear' },
                { slug: 'abcstore', name: 'ABC Store — general retail' },
                { slug: 'kumarstore', name: 'Kumar Mobile Store — electronics' },
              ].map((demo) => (
                <Pressable
                  key={demo.slug}
                  onPress={() => void open(demo.slug)}
                  style={styles.demoRow}
                >
                  <Text style={typography.body}>{demo.name}</Text>
                  <Ionicons name="chevron-forward" size={16} color={palette.textSubtle} />
                </Pressable>
              ))}
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.surface },
  container: { padding: spacing.xl, paddingTop: spacing.xxl },
  hero: { alignItems: 'center', marginBottom: spacing.xxl },
  logo: {
    width: 60,
    height: 60,
    borderRadius: radius.xl,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  heroText: { textAlign: 'center', marginTop: spacing.sm, maxWidth: 300 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dividerLine: { flex: 1, height: 1, backgroundColor: palette.border },
  demoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
});

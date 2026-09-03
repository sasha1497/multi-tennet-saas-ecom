import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatDate, formatMoney, ORDER_STATUS_LABELS } from '@retailos/config';
import { Badge, Button, Card, EmptyState, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { palette, radius, spacing, statusColor, typography } from '@/lib/theme';

export default function AccountScreen() {
  const { bootstrap, customer, tenantSlug, logout, leaveStore } = useStore();
  const router = useRouter();

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders', tenantSlug],
    queryFn: () => api().storefront.orders({ limit: 10 }),
    enabled: Boolean(customer),
  });

  if (!bootstrap) return <Loading />;

  const currency = bootstrap.store.currency;

  if (!customer) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <EmptyState
          icon="person-circle-outline"
          title="Sign in to your account"
          description={`Track your orders and check out faster at ${bootstrap.store.storeName}.`}
          action={
            <View style={{ gap: spacing.md, width: 240 }}>
              <Button title="Sign in" size="lg" fullWidth onPress={() => router.push('/login')} />
              <Button
                title="Create account"
                variant="outline"
                size="lg"
                fullWidth
                onPress={() => router.push('/register')}
              />
            </View>
          }
        />
        <Card style={{ marginTop: spacing.lg }}>
          <Pressable style={styles.link} onPress={() => void confirmLeave(leaveStore, router)}>
            <Ionicons name="swap-horizontal-outline" size={18} color={palette.textMuted} />
            <Text style={typography.body}>Switch to another store</Text>
            <Ionicons name="chevron-forward" size={16} color={palette.textSubtle} />
          </Pressable>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: palette.surfaceMuted }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {customer.firstName.charAt(0)}
            {customer.lastName.charAt(0)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={typography.h3}>{customer.fullName}</Text>
          <Text style={typography.small} numberOfLines={1}>
            {customer.email ?? customer.phone}
          </Text>
        </View>
      </Card>

      <Text style={[typography.h3, { marginTop: spacing.sm }]}>Recent orders</Text>

      {isLoading ? (
        <Loading />
      ) : (orders?.items.length ?? 0) === 0 ? (
        <Card>
          <Text style={typography.bodyMuted}>You have not placed an order yet.</Text>
        </Card>
      ) : (
        orders!.items.map((order) => (
          <Pressable key={order.id} onPress={() => router.push(`/order/${order.orderNumber}`)}>
            <Card style={{ padding: spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[typography.body, { fontWeight: '600' }]}>{order.orderNumber}</Text>
                  <Text style={typography.tiny}>
                    {formatDate(order.placedAt)} · {order.itemCount} item
                    {order.itemCount === 1 ? '' : 's'}
                  </Text>
                  <Badge
                    label={ORDER_STATUS_LABELS[order.status]}
                    color={statusColor[order.status]}
                  />
                </View>
                <Text style={[typography.price, { fontSize: 15 }]}>
                  {formatMoney(order.totalAmount, currency)}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={palette.textSubtle} />
              </View>
            </Card>
          </Pressable>
        ))
      )}

      <Card style={{ marginTop: spacing.sm, padding: 0 }}>
        <Pressable style={styles.link} onPress={() => router.push('/(shop)/search')}>
          <Ionicons name="heart-outline" size={18} color={palette.textMuted} />
          <Text style={typography.body}>Wishlist</Text>
          <Ionicons name="chevron-forward" size={16} color={palette.textSubtle} />
        </Pressable>
        <Pressable
          style={styles.link}
          onPress={() => void confirmLeave(leaveStore, router)}
        >
          <Ionicons name="swap-horizontal-outline" size={18} color={palette.textMuted} />
          <Text style={typography.body}>Switch store</Text>
          <Ionicons name="chevron-forward" size={16} color={palette.textSubtle} />
        </Pressable>
        <Pressable
          style={styles.link}
          onPress={() =>
            Alert.alert('Sign out?', 'You can sign back in at any time.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
            ])
          }
        >
          <Ionicons name="log-out-outline" size={18} color={palette.danger} />
          <Text style={[typography.body, { color: palette.danger }]}>Sign out</Text>
        </Pressable>
      </Card>

      <Text style={[typography.tiny, { textAlign: 'center', marginTop: spacing.lg }]}>
        Shopping at {bootstrap.store.storeName} · Powered by RetailOS
      </Text>
    </ScrollView>
  );
}

/** Switching merchants clears the session, so it is worth confirming. */
function confirmLeave(leaveStore: () => Promise<void>, router: { replace: (p: string) => void }) {
  Alert.alert(
    'Switch store?',
    'You will be signed out of this shop. Your bag here is kept for when you return.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Switch',
        onPress: async () => {
          await leaveStore();
          router.replace('/discover');
        },
      },
    ],
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: palette.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: palette.primary, fontWeight: '700', fontSize: 16 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
});

import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatDate, formatMoney, ORDER_STATUS_LABELS } from '@retailos/config';
import { Badge, Button, Card, Divider, EmptyState, Loading, Row } from '@/components/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { palette, radius, spacing, statusColor, typography } from '@/lib/theme';

export default function OrderScreen() {
  const { orderNumber } = useLocalSearchParams<{ orderNumber: string }>();
  const { bootstrap, tenantSlug } = useStore();
  const router = useRouter();

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders', tenantSlug],
    queryFn: () => api().storefront.orders({ limit: 50 }),
  });

  const summary = orders?.items.find((o) => o.orderNumber === orderNumber);

  const { data: order } = useQuery({
    queryKey: ['order', summary?.id],
    queryFn: () => api().storefront.order(summary!.id),
    enabled: Boolean(summary),
  });

  const { data: tracking } = useQuery({
    queryKey: ['tracking', orderNumber],
    queryFn: () => api().storefront.tracking(orderNumber),
    enabled: Boolean(orderNumber),
  });

  if (isLoading) return <Loading />;
  if (!summary || !bootstrap) {
    return <EmptyState icon="receipt-outline" title="Order not found" />;
  }

  const currency = bootstrap.store.currency;
  const money = (v: number) => formatMoney(v, currency);

  return (
    <ScrollView
      style={{ backgroundColor: palette.surfaceMuted }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <Card style={{ alignItems: 'center', gap: spacing.sm }}>
        <View style={styles.tick}>
          <Ionicons name="checkmark" size={26} color="#fff" />
        </View>
        <Text style={typography.h2}>{ORDER_STATUS_LABELS[summary.status]}</Text>
        <Text style={typography.small}>{summary.orderNumber}</Text>
        <Badge label={ORDER_STATUS_LABELS[summary.status]} color={statusColor[summary.status]} />
      </Card>

      {/* Delivery timeline */}
      {tracking && (
        <Card>
          <Text style={[typography.h3, { marginBottom: spacing.md }]}>Delivery status</Text>
          {tracking.timeline.map((step, i) => (
            <View key={step.status} style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ alignItems: 'center' }}>
                <View
                  style={[
                    styles.stepDot,
                    step.done
                      ? { backgroundColor: palette.primary }
                      : { borderWidth: 2, borderColor: palette.border },
                  ]}
                >
                  {step.done && <Ionicons name="checkmark" size={12} color="#fff" />}
                </View>
                {i < tracking.timeline.length - 1 && (
                  <View
                    style={[
                      styles.stepLine,
                      { backgroundColor: step.done ? palette.primary : palette.border },
                    ]}
                  />
                )}
              </View>
              <View style={{ flex: 1, paddingBottom: spacing.lg }}>
                <Text
                  style={[
                    typography.body,
                    { fontWeight: '600', color: step.done ? palette.text : palette.textSubtle },
                  ]}
                >
                  {step.label}
                </Text>
                {step.at && <Text style={typography.tiny}>{formatDate(step.at, true)}</Text>}
              </View>
            </View>
          ))}
        </Card>
      )}

      {order && (
        <>
          <Card style={{ gap: spacing.md }}>
            <Text style={typography.h3}>Items</Text>
            {order.items.map((item) => (
              <View key={item.id} style={{ flexDirection: 'row', gap: spacing.md }}>
                {item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, { backgroundColor: palette.surfaceMuted }]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={typography.body} numberOfLines={2}>
                    {item.productName}
                  </Text>
                  <Text style={typography.tiny}>
                    {item.variantLabel} · Qty {item.quantity}
                  </Text>
                </View>
                <Text style={[typography.body, { fontWeight: '600' }]}>{money(item.lineTotal)}</Text>
              </View>
            ))}

            <Divider />
            <Row label="Subtotal" value={money(order.subtotal)} />
            {order.discountAmount > 0 && (
              <Row
                label="Discount"
                value={`−${money(order.discountAmount)}`}
                color={palette.success}
              />
            )}
            <Row
              label="Delivery"
              value={order.shippingAmount === 0 ? 'Free' : money(order.shippingAmount)}
            />
            <Divider />
            <Row label="Total" value={money(order.totalAmount)} bold />
          </Card>

          <Card style={{ gap: spacing.sm }}>
            <Text style={typography.h3}>Delivery address</Text>
            <Text style={typography.bodyMuted}>
              {order.shippingAddress.fullName}
              {'\n'}
              {order.shippingAddress.line1}
              {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}
              {'\n'}
              {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
              {order.shippingAddress.postalCode}
              {'\n'}
              {order.shippingAddress.phone}
            </Text>
          </Card>

          <Card style={{ gap: spacing.sm }}>
            <Text style={typography.h3}>Payment</Text>
            <Row
              label="Method"
              value={order.paymentMethod === 'COD' ? 'Cash on delivery' : order.paymentMethod}
            />
            <Row label="Status" value={order.paymentStatus.toLowerCase()} />
          </Card>
        </>
      )}

      <Button
        title="Continue shopping"
        variant="outline"
        size="lg"
        fullWidth
        onPress={() => router.replace('/(shop)')}
      />
      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tick: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: palette.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: 52, height: 52, borderRadius: radius.md },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  stepLine: { width: 2, flex: 1, minHeight: 22 },
});

import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@retailos/config';
import type { Address, PaymentMethod } from '@retailos/types';
import { Button, Card, Divider, Input, Loading, Row } from '@/components/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { palette, radius, spacing, typography } from '@/lib/theme';

function newIdempotencyKey(): string {
  return `mob-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function CheckoutScreen() {
  const { bootstrap, cart, customer, refreshCart, tenantSlug } = useStore();
  const router = useRouter();

  const [addressId, setAddressId] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    line1: '',
    line2: '',
    city: '',
    state: 'Karnataka',
    postalCode: '',
  });
  const [method, setMethod] = useState<PaymentMethod>('COD');
  const [placing, setPlacing] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const { data: addresses, refetch } = useQuery({
    queryKey: ['addresses', tenantSlug],
    queryFn: () => api().storefront.addresses(),
    enabled: Boolean(customer),
  });

  useEffect(() => {
    if (!addresses) return;
    if (addresses.length === 0) setAdding(true);
    else if (!addressId) setAddressId((addresses.find((a) => a.isDefault) ?? addresses[0]).id);
  }, [addresses, addressId]);

  useEffect(() => {
    if (bootstrap && !bootstrap.store.codEnabled) setMethod('UPI');
  }, [bootstrap]);

  if (!bootstrap || !cart) return <Loading />;

  const currency = bootstrap.store.currency;
  const money = (v: number) => formatMoney(v, currency);

  const saveAddress = async () => {
    try {
      const created = await api().storefront.createAddress({
        ...form,
        line2: form.line2 || null,
        landmark: null,
        country: 'IN',
        type: 'HOME',
        label: null,
        isDefault: (addresses?.length ?? 0) === 0,
      });
      await refetch();
      setAddressId(created.id);
      setAdding(false);
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Check the details.');
    }
  };

  const placeOrder = async () => {
    if (!addressId) {
      Alert.alert('Address needed', 'Choose where you would like this delivered.');
      return;
    }
    setPlacing(true);
    try {
      const result = await api().storefront.createOrder({
        shippingAddressId: addressId,
        paymentMethod: method,
        idempotencyKey,
      });
      await refreshCart();

      // Online payments settle through the mock gateway locally; on a real
      // gateway this is where the provider SDK would open.
      if (result.payment && method !== 'COD') {
        try {
          const verified = await api().storefront.simulatePayment(
            result.payment.paymentId,
            'success',
          );
          if (verified.status !== 'PAID') throw new Error('Payment was not completed');
        } catch (err) {
          Alert.alert(
            'Payment not completed',
            err instanceof Error ? err.message : 'Your items were returned to stock.',
          );
          setPlacing(false);
          setIdempotencyKey(newIdempotencyKey());
          return;
        }
      }

      router.replace(`/order/${result.order.orderNumber}`);
    } catch (err) {
      setIdempotencyKey(newIdempotencyKey());
      Alert.alert('Order failed', err instanceof Error ? err.message : 'Please try again.');
      setPlacing(false);
    }
  };

  const methods: { value: PaymentMethod; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    ...(bootstrap.store.codEnabled
      ? [
          {
            value: 'COD' as PaymentMethod,
            label: 'Cash on delivery',
            hint: 'Pay when it arrives',
            icon: 'cash-outline' as const,
          },
        ]
      : []),
    ...(bootstrap.store.onlinePaymentEnabled
      ? [
          {
            value: 'UPI' as PaymentMethod,
            label: 'UPI',
            hint: 'Google Pay, PhonePe, Paytm',
            icon: 'phone-portrait-outline' as const,
          },
          {
            value: 'CARD' as PaymentMethod,
            label: 'Card',
            hint: 'Credit or debit',
            icon: 'card-outline' as const,
          },
        ]
      : []),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceMuted }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 110 }}>
        <Text style={typography.h3}>Delivery address</Text>

        {!adding &&
          addresses?.map((address: Address) => (
            <Pressable key={address.id} onPress={() => setAddressId(address.id)}>
              <Card
                style={[
                  { padding: spacing.md },
                  addressId === address.id && {
                    borderColor: palette.primary,
                    backgroundColor: palette.primarySoft,
                  },
                ]}
              >
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <Ionicons
                    name={addressId === address.id ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={addressId === address.id ? palette.primary : palette.textSubtle}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.body, { fontWeight: '600' }]}>{address.fullName}</Text>
                    <Text style={typography.small}>
                      {address.line1}
                      {address.line2 ? `, ${address.line2}` : ''}
                      {'\n'}
                      {address.city}, {address.state} {address.postalCode}
                    </Text>
                    <Text style={typography.small}>{address.phone}</Text>
                  </View>
                </View>
              </Card>
            </Pressable>
          ))}

        {adding ? (
          <Card style={{ gap: spacing.md }}>
            <Input
              label="Full name"
              value={form.fullName}
              onChangeText={(v) => setForm({ ...form, fullName: v })}
            />
            <Input
              label="Mobile number"
              keyboardType="phone-pad"
              value={form.phone}
              onChangeText={(v) => setForm({ ...form, phone: v })}
            />
            <Input
              label="Flat, house no., building"
              value={form.line1}
              onChangeText={(v) => setForm({ ...form, line1: v })}
            />
            <Input
              label="Area, street"
              value={form.line2}
              onChangeText={(v) => setForm({ ...form, line2: v })}
            />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Input
                  label="City"
                  value={form.city}
                  onChangeText={(v) => setForm({ ...form, city: v })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Input
                  label="PIN code"
                  keyboardType="number-pad"
                  value={form.postalCode}
                  onChangeText={(v) => setForm({ ...form, postalCode: v })}
                />
              </View>
            </View>
            <Input
              label="State"
              value={form.state}
              onChangeText={(v) => setForm({ ...form, state: v })}
            />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              {(addresses?.length ?? 0) > 0 && (
                <Button
                  title="Cancel"
                  variant="outline"
                  onPress={() => setAdding(false)}
                  style={{ flex: 1 }}
                />
              )}
              <Button title="Save address" onPress={() => void saveAddress()} style={{ flex: 1 }} />
            </View>
          </Card>
        ) : (
          <Button
            title="Add a new address"
            variant="outline"
            icon="add"
            onPress={() => setAdding(true)}
          />
        )}

        <Text style={[typography.h3, { marginTop: spacing.md }]}>Payment</Text>
        {methods.map((option) => (
          <Pressable key={option.value} onPress={() => setMethod(option.value)}>
            <Card
              style={[
                { padding: spacing.md },
                method === option.value && {
                  borderColor: palette.primary,
                  backgroundColor: palette.primarySoft,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Ionicons
                  name={method === option.value ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={method === option.value ? palette.primary : palette.textSubtle}
                />
                <Ionicons name={option.icon} size={20} color={palette.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={[typography.body, { fontWeight: '600' }]}>{option.label}</Text>
                  <Text style={typography.tiny}>{option.hint}</Text>
                </View>
              </View>
            </Card>
          </Pressable>
        ))}

        <Card style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <Row label="Subtotal" value={money(cart.totals.subtotal)} />
          {cart.totals.discount > 0 && (
            <Row label="Discount" value={`−${money(cart.totals.discount)}`} color={palette.success} />
          )}
          <Row
            label="Delivery"
            value={cart.totals.shipping === 0 ? 'Free' : money(cart.totals.shipping)}
          />
          <Divider />
          <Row label="Total" value={money(cart.totals.total)} bold />
        </Card>
      </ScrollView>

      <View style={styles.bar}>
        <Button
          title={method === 'COD' ? `Place order · ${money(cart.totals.total)}` : `Pay ${money(cart.totals.total)}`}
          size="lg"
          fullWidth
          loading={placing}
          disabled={!addressId || adding}
          onPress={() => void placeOrder()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
});

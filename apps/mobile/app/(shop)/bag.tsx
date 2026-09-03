import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@retailos/config';
import { Button, Card, Divider, EmptyState, Input, Loading, Row } from '@/components/ui';
import { useStore } from '@/lib/store-context';
import { palette, radius, spacing, typography } from '@/lib/theme';

export default function BagScreen() {
  const { bootstrap, cart, customer, updateCartItem, removeCartItem, applyCoupon } = useStore();
  const router = useRouter();

  const [coupon, setCoupon] = useState('');
  const [applying, setApplying] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  if (!bootstrap || !cart) return <Loading />;

  const currency = bootstrap.store.currency;
  const money = (v: number) => formatMoney(v, currency);

  if (cart.items.length === 0) {
    return (
      <EmptyState
        icon="bag-outline"
        title="Your bag is empty"
        description="Add something you like and it will show up here."
        action={
          <Button title="Start shopping" onPress={() => router.push('/(shop)')} />
        }
      />
    );
  }

  const blocking = cart.issues.filter((i) => i.code !== 'PRICE_CHANGED');

  const change = async (itemId: string, quantity: number) => {
    setBusyItem(itemId);
    try {
      await updateCartItem(itemId, quantity);
    } catch (err) {
      Alert.alert('Could not update', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusyItem(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceMuted }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {cart.issues.length > 0 && (
          <Card style={{ backgroundColor: '#FFF8E6', borderColor: palette.warning }}>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Ionicons name="alert-circle-outline" size={18} color={palette.warning} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[typography.body, { fontWeight: '600' }]}>Please review your bag</Text>
                {cart.issues.map((issue, i) => (
                  <Text key={i} style={typography.small}>
                    • {issue.message}
                  </Text>
                ))}
              </View>
            </View>
          </Card>
        )}

        {cart.items.map((item) => (
          <Card key={item.id} style={{ padding: spacing.md }}>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, { backgroundColor: palette.surfaceMuted }]} />
              )}

              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[typography.body, { fontWeight: '500' }]} numberOfLines={2}>
                  {item.productName}
                </Text>
                <Text style={typography.tiny}>{item.variantLabel}</Text>

                <View style={styles.itemFooter}>
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => void change(item.id, item.quantity - 1)}
                      disabled={busyItem === item.id}
                      style={styles.stepperButton}
                      accessibilityLabel="Decrease quantity"
                    >
                      <Ionicons name="remove" size={16} color={palette.textMuted} />
                    </Pressable>
                    <Text style={styles.stepperValue}>{item.quantity}</Text>
                    <Pressable
                      onPress={() => void change(item.id, item.quantity + 1)}
                      disabled={busyItem === item.id || item.quantity >= item.availableStock}
                      style={styles.stepperButton}
                      accessibilityLabel="Increase quantity"
                    >
                      <Ionicons name="add" size={16} color={palette.textMuted} />
                    </Pressable>
                  </View>

                  <Text style={[typography.price, { fontSize: 15 }]}>{money(item.lineTotal)}</Text>
                </View>
              </View>

              <Pressable
                onPress={() => void removeCartItem(item.id)}
                style={{ padding: 4 }}
                accessibilityLabel={`Remove ${item.productName}`}
              >
                <Ionicons name="trash-outline" size={18} color={palette.textSubtle} />
              </Pressable>
            </View>
          </Card>
        ))}

        {/* Coupon */}
        <Card style={{ gap: spacing.md }}>
          {cart.coupon ? (
            <View style={styles.couponApplied}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Ionicons name="pricetag" size={16} color={palette.success} />
                <Text style={{ fontWeight: '600', color: palette.success }}>
                  {cart.coupon.code}
                </Text>
              </View>
              <Text style={{ color: palette.success, fontWeight: '600' }}>
                −{money(cart.coupon.discountAmount)}
              </Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <Input
                  label="Coupon code"
                  placeholder="WELCOME10"
                  autoCapitalize="characters"
                  value={coupon}
                  onChangeText={setCoupon}
                />
              </View>
              <Button
                title="Apply"
                variant="outline"
                loading={applying}
                onPress={async () => {
                  if (!coupon.trim()) return;
                  setApplying(true);
                  try {
                    await applyCoupon(coupon.trim());
                    setCoupon('');
                  } catch (err) {
                    Alert.alert(
                      'Coupon not applied',
                      err instanceof Error ? err.message : 'That code did not work.',
                    );
                  } finally {
                    setApplying(false);
                  }
                }}
              />
            </View>
          )}
        </Card>

        {/* Totals */}
        <Card style={{ gap: spacing.sm }}>
          <Row label="Subtotal" value={money(cart.totals.subtotal)} />
          {cart.totals.discount > 0 && (
            <Row label="Discount" value={`−${money(cart.totals.discount)}`} color={palette.success} />
          )}
          <Row
            label="Delivery"
            value={cart.totals.shipping === 0 ? 'Free' : money(cart.totals.shipping)}
            color={cart.totals.shipping === 0 ? palette.success : undefined}
          />
          <Divider />
          <Row label="Total" value={money(cart.totals.total)} bold />
          {bootstrap.store.taxInclusivePricing && cart.totals.tax > 0 && (
            <Text style={[typography.tiny, { textAlign: 'right' }]}>
              Includes {money(cart.totals.tax)} tax
            </Text>
          )}
        </Card>

        <View style={{ height: 90 }} />
      </ScrollView>

      {/* Sticky checkout bar */}
      <View style={styles.checkoutBar}>
        <View style={{ flex: 1 }}>
          <Text style={typography.tiny}>Total</Text>
          <Text style={typography.price}>{money(cart.totals.total)}</Text>
        </View>
        <Button
          title={customer ? 'Checkout' : 'Sign in to checkout'}
          size="lg"
          disabled={blocking.length > 0}
          onPress={() => router.push(customer ? '/checkout' : '/login')}
          style={{ flex: 1.4 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  itemFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
  },
  stepperButton: { padding: 7 },
  stepperValue: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: palette.text,
  },
  couponApplied: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ECFDF5',
    padding: spacing.md,
    borderRadius: radius.md,
  },
  checkoutBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
});

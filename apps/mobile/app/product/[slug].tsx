import { useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@retailos/config';
import type { ProductVariant } from '@retailos/types';
import { Badge, Button, EmptyState, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { palette, radius, spacing, typography } from '@/lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function ProductScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { bootstrap, addToCart, tenantSlug } = useStore();
  const router = useRouter();

  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [adding, setAdding] = useState(false);
  const [initialised, setInitialised] = useState(false);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', tenantSlug, slug],
    queryFn: () => api().storefront.productBySlug(slug),
    enabled: Boolean(slug),
  });

  // Preselect the first buyable variant once the product arrives.
  if (product && !initialised) {
    const first = product.variants.find((v) => v.isActive && v.stock.inStock) ?? product.variants[0];
    if (first) setSelectedOptions(first.options);
    setInitialised(true);
  }

  const selectedVariant: ProductVariant | undefined = useMemo(() => {
    if (!product) return undefined;
    if (product.options.length === 0) return product.variants[0];
    return product.variants.find((v) =>
      product.options.every((opt) => v.options[opt.name] === selectedOptions[opt.name]),
    );
  }, [product, selectedOptions]);

  if (isLoading) return <Loading />;
  if (!product || !bootstrap) {
    return <EmptyState icon="alert-circle-outline" title="Product not found" />;
  }

  const currency = bootstrap.store.currency;
  const money = (v: number) => formatMoney(v, currency);

  const price = selectedVariant?.price ?? product.priceFrom;
  const mrp = selectedVariant?.mrp ?? product.mrpFrom;
  const discount = mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
  const available = selectedVariant?.stock.available ?? 0;
  const canBuy = Boolean(selectedVariant) && (available > 0 || bootstrap.store.allowBackorder);

  const isValueAvailable = (optionName: string, value: string) => {
    const probe = { ...selectedOptions, [optionName]: value };
    return product.variants.some(
      (v) =>
        v.isActive &&
        v.stock.inStock &&
        product.options.every((opt) => v.options[opt.name] === probe[opt.name]),
    );
  };

  const add = async (thenCheckout: boolean) => {
    if (!selectedVariant) return;
    setAdding(true);
    try {
      await addToCart(selectedVariant.id, quantity);
      if (thenCheckout) router.push('/cart');
      else Alert.alert('Added to bag', `${product.name} is in your bag.`);
    } catch (err) {
      Alert.alert('Could not add', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const images = product.images;

  return (
    <View style={{ flex: 1, backgroundColor: palette.surface }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        {/* Gallery */}
        <View>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) =>
              setImageIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))
            }
          >
            {(images.length > 0 ? images : [{ id: 'none', url: '' }]).map((image) => (
              <View key={image.id} style={{ width: SCREEN_WIDTH, aspectRatio: 1 }}>
                {image.url ? (
                  <Image source={{ uri: image.url }} style={{ width: '100%', height: '100%' }} />
                ) : (
                  <View style={styles.noImage}>
                    <Ionicons name="image-outline" size={40} color={palette.textSubtle} />
                  </View>
                )}
              </View>
            ))}
          </ScrollView>

          {images.length > 1 && (
            <View style={styles.dots}>
              {images.map((image, i) => (
                <View
                  key={image.id}
                  style={[styles.dot, i === imageIndex && { backgroundColor: palette.primary }]}
                />
              ))}
            </View>
          )}
        </View>

        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          {product.brand && <Text style={typography.tiny}>{product.brand.name.toUpperCase()}</Text>}
          <Text style={typography.h1}>{product.name}</Text>
          {product.shortDescription && (
            <Text style={typography.bodyMuted}>{product.shortDescription}</Text>
          )}

          {product.ratingCount > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={styles.rating}>
                <Text style={styles.ratingText}>{product.ratingAverage.toFixed(1)} ★</Text>
              </View>
              <Text style={typography.small}>
                {product.ratingCount} rating{product.ratingCount === 1 ? '' : 's'}
              </Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
            <Text style={[typography.price, { fontSize: 26 }]}>{money(price)}</Text>
            {discount > 0 && (
              <>
                <Text style={[typography.bodyMuted, { textDecorationLine: 'line-through' }]}>
                  {money(mrp)}
                </Text>
                <View style={styles.discountTag}>
                  <Text style={styles.discountText}>{discount}% off</Text>
                </View>
              </>
            )}
          </View>
          {bootstrap.store.taxInclusivePricing && (
            <Text style={typography.tiny}>Inclusive of all taxes</Text>
          )}

          {/* Options */}
          {product.options.map((option) => (
            <View key={option.name} style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <Text style={typography.h3}>{option.name}</Text>
              <View style={styles.optionRow}>
                {option.values.map((value) => {
                  const selected = selectedOptions[option.name] === value;
                  const availableValue = isValueAvailable(option.name, value);
                  return (
                    <Pressable
                      key={value}
                      onPress={() => {
                        setSelectedOptions((s) => ({ ...s, [option.name]: value }));
                        setQuantity(1);
                      }}
                      accessibilityState={{ selected }}
                      style={[
                        styles.optionChip,
                        selected && styles.optionChipSelected,
                        !availableValue && styles.optionChipUnavailable,
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          selected && { color: palette.primary, fontWeight: '600' },
                          !availableValue && styles.optionTextUnavailable,
                        ]}
                      >
                        {value}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          {/* Stock */}
          <View style={{ marginTop: spacing.sm }}>
            {!selectedVariant ? (
              <Badge label="Choose an option" color={palette.warning} />
            ) : available === 0 ? (
              <Badge label="Out of stock" color={palette.danger} />
            ) : available <= 5 ? (
              <Badge label={`Only ${available} left`} color={palette.warning} />
            ) : (
              <Badge label="In stock" color={palette.success} />
            )}
          </View>

          {/* Quantity */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm }}>
            <Text style={typography.h3}>Quantity</Text>
            <View style={styles.stepper}>
              <Pressable
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                style={styles.stepperButton}
                accessibilityLabel="Decrease quantity"
              >
                <Ionicons name="remove" size={16} color={palette.textMuted} />
              </Pressable>
              <Text style={styles.stepperValue}>{quantity}</Text>
              <Pressable
                onPress={() => setQuantity((q) => Math.min(available || 99, q + 1))}
                style={styles.stepperButton}
                accessibilityLabel="Increase quantity"
              >
                <Ionicons name="add" size={16} color={palette.textMuted} />
              </Pressable>
            </View>
          </View>

          {product.description && (
            <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
              <Text style={typography.h3}>Product details</Text>
              <Text style={[typography.bodyMuted, { lineHeight: 21 }]}>{product.description}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky buy bar */}
      <View style={styles.buyBar}>
        <Button
          title="Add to bag"
          variant="outline"
          size="lg"
          loading={adding}
          disabled={!canBuy}
          onPress={() => void add(false)}
          style={{ flex: 1 }}
        />
        <Button
          title="Buy now"
          size="lg"
          disabled={!canBuy || adding}
          onPress={() => void add(true)}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  noImage: {
    flex: 1,
    backgroundColor: palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: {
    position: 'absolute',
    bottom: spacing.md,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.border },
  rating: {
    backgroundColor: palette.success,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  ratingText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  discountTag: {
    backgroundColor: palette.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  discountText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  optionChip: {
    minWidth: 52,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
  },
  optionChipSelected: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  optionChipUnavailable: { opacity: 0.45 },
  optionText: { fontSize: 14, color: palette.text },
  optionTextUnavailable: { textDecorationLine: 'line-through', color: palette.textSubtle },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
  },
  stepperButton: { padding: 9 },
  stepperValue: {
    minWidth: 32,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: palette.text,
  },
  buyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
});

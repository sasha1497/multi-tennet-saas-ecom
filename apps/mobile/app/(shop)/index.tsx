import { useCallback, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@retailos/config';
import type { ProductListItem } from '@retailos/types';
import { Card, EmptyState, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { palette, radius, shadow, spacing, typography } from '@/lib/theme';

export default function HomeScreen() {
  const { bootstrap, tenantSlug } = useStore();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const featured = useQuery({
    queryKey: ['featured', tenantSlug],
    queryFn: () => api().storefront.featuredProducts(8),
    enabled: Boolean(bootstrap),
  });

  const popular = useQuery({
    queryKey: ['popular', tenantSlug],
    queryFn: () => api().storefront.popularProducts(8),
    enabled: Boolean(bootstrap),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([featured.refetch(), popular.refetch()]);
    setRefreshing(false);
  }, [featured, popular]);

  if (!bootstrap) return <Loading />;

  const { store, categories } = bootstrap;
  const banner = store.banners.find((b) => b.isActive) ?? store.banners[0];
  const currency = store.currency;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Store header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={typography.tiny}>You are shopping at</Text>
            <Text style={typography.h2} numberOfLines={1}>
              {store.storeName}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/(shop)/account')}
            style={styles.iconButton}
            accessibilityLabel="Account"
          >
            <Ionicons name="person-circle-outline" size={26} color={palette.text} />
          </Pressable>
        </View>

        {/* Search entry point */}
        <Pressable style={styles.searchBar} onPress={() => router.push('/(shop)/search')}>
          <Ionicons name="search" size={18} color={palette.textSubtle} />
          <Text style={typography.bodyMuted}>Search {store.storeName}…</Text>
        </Pressable>

        {/* Hero */}
        {banner && (
          <Pressable style={styles.hero} onPress={() => router.push('/(shop)/categories')}>
            {banner.imageUrl && (
              <Image source={{ uri: banner.imageUrl }} style={styles.heroImage} />
            )}
            <View style={styles.heroOverlay}>
              <Text style={styles.heroTitle} numberOfLines={2}>
                {banner.title}
              </Text>
              {banner.subtitle && (
                <Text style={styles.heroSubtitle} numberOfLines={1}>
                  {banner.subtitle}
                </Text>
              )}
            </View>
          </Pressable>
        )}

        {/* Categories */}
        {categories.length > 0 && (
          <View style={styles.section}>
            <Text style={typography.h3}>Shop by category</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryRow}
            >
              {categories.map((cat) => (
                <Pressable
                  key={cat.id}
                  style={styles.categoryChip}
                  onPress={() => router.push(`/(shop)/search?category=${cat.slug}`)}
                >
                  {cat.imageUrl ? (
                    <Image source={{ uri: cat.imageUrl }} style={styles.categoryImage} />
                  ) : (
                    <View style={[styles.categoryImage, styles.categoryFallback]}>
                      <Text style={{ fontSize: 18, fontWeight: '700', color: palette.textSubtle }}>
                        {cat.name.charAt(0)}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.categoryLabel} numberOfLines={1}>
                    {cat.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        <ProductSection
          title="Featured"
          products={featured.data ?? []}
          loading={featured.isLoading}
          currency={currency}
        />

        <ProductSection
          title="Best sellers"
          products={popular.data ?? []}
          loading={popular.isLoading}
          currency={currency}
        />

        {!featured.isLoading &&
          !popular.isLoading &&
          (featured.data?.length ?? 0) === 0 &&
          (popular.data?.length ?? 0) === 0 && (
            <EmptyState
              icon="cube-outline"
              title="This store is just getting started"
              description="Products will appear here soon."
            />
          )}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ProductSection({
  title,
  products,
  loading,
  currency,
}: {
  title: string;
  products: ProductListItem[];
  loading: boolean;
  currency: string;
}) {
  if (!loading && products.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={typography.h3}>{title}</Text>
      {loading ? (
        <Loading />
      ) : (
        <FlatList
          horizontal
          data={products}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.md }}
          renderItem={({ item }) => <ProductTile product={item} currency={currency} />}
        />
      )}
    </View>
  );
}

export function ProductTile({
  product,
  currency,
  width = 156,
}: {
  product: ProductListItem;
  currency: string;
  width?: number;
}) {
  return (
    <Link href={`/product/${product.slug}`} asChild>
      <Pressable style={[styles.tile, { width }]}>
        <View style={styles.tileImageWrap}>
          {product.primaryImageUrl ? (
            <Image source={{ uri: product.primaryImageUrl }} style={styles.tileImage} />
          ) : (
            <View style={[styles.tileImage, styles.categoryFallback]} />
          )}
          {product.discountPercent > 0 && (
            <View style={styles.discountTag}>
              <Text style={styles.discountText}>{product.discountPercent}% off</Text>
            </View>
          )}
          {!product.inStock && (
            <View style={styles.outOfStock}>
              <Text style={{ fontWeight: '700', color: palette.text, fontSize: 12 }}>
                Out of stock
              </Text>
            </View>
          )}
        </View>
        <View style={{ padding: spacing.sm, gap: 2 }}>
          {product.brandName && (
            <Text style={typography.tiny} numberOfLines={1}>
              {product.brandName.toUpperCase()}
            </Text>
          )}
          <Text style={[typography.body, { fontWeight: '500' }]} numberOfLines={2}>
            {product.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
            <Text style={[typography.price, { fontSize: 15 }]}>
              {formatMoney(product.priceFrom, currency)}
            </Text>
            {product.discountPercent > 0 && (
              <Text style={[typography.tiny, { textDecorationLine: 'line-through' }]}>
                {formatMoney(product.mrpFrom, currency)}
              </Text>
            )}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.surfaceMuted },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  iconButton: { padding: 4 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  hero: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
    height: 168,
    backgroundColor: palette.primarySoft,
  },
  heroImage: { width: '100%', height: '100%' },
  heroOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    backgroundColor: 'rgba(15,23,42,0.55)',
  },
  heroTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  heroSubtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
  section: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  categoryRow: { gap: spacing.md, paddingVertical: spacing.md },
  categoryChip: { width: 76, alignItems: 'center', gap: 6 },
  categoryImage: { width: 64, height: 64, borderRadius: radius.full },
  categoryFallback: {
    backgroundColor: palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryLabel: { fontSize: 11, color: palette.textMuted, textAlign: 'center' },
  tile: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
    ...shadow.card,
  },
  tileImageWrap: { aspectRatio: 1, backgroundColor: palette.surfaceMuted },
  tileImage: { width: '100%', height: '100%' },
  discountTag: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: palette.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  discountText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  outOfStock: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

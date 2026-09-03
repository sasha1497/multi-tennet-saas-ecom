import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState, Input, Loading } from '@/components/ui';
import { ProductTile } from './index';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { palette, radius, spacing, typography } from '@/lib/theme';

/** Debounces the search term so typing does not fire a request per keystroke. */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function SearchScreen() {
  const params = useLocalSearchParams<{ category?: string }>();
  const { bootstrap, tenantSlug } = useStore();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | undefined>(params.category);
  const debounced = useDebounced(query);

  useEffect(() => {
    if (params.category) setCategory(params.category);
  }, [params.category]);

  const { data, isLoading } = useQuery({
    queryKey: ['search', tenantSlug, debounced, category],
    queryFn: () =>
      api().storefront.products({
        search: debounced || undefined,
        categorySlug: category,
        limit: 30,
        sortBy: debounced ? undefined : 'soldCount',
        sortOrder: 'desc',
      }),
    enabled: Boolean(bootstrap),
  });

  const currency = bootstrap?.store.currency ?? 'INR';

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <Input
          placeholder="Search products…"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
          style={styles.searchInput}
        />
      </View>

      {/* Category filter chips */}
      {bootstrap && bootstrap.categories.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Pressable
            onPress={() => setCategory(undefined)}
            style={[styles.chip, !category && styles.chipActive]}
          >
            <Text style={[styles.chipText, !category && styles.chipTextActive]}>All</Text>
          </Pressable>
          {bootstrap.categories.map((cat) => (
            <Pressable
              key={cat.id}
              onPress={() => setCategory(category === cat.slug ? undefined : cat.slug)}
              style={[styles.chip, category === cat.slug && styles.chipActive]}
            >
              <Text style={[styles.chipText, category === cat.slug && styles.chipTextActive]}>
                {cat.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {isLoading ? (
        <Loading />
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyState
          icon="search-outline"
          title={debounced ? 'Nothing found' : 'Search the store'}
          description={
            debounced
              ? `No products match “${debounced}”. Try a different word.`
              : 'Type a product name, or pick a category above.'
          }
        />
      ) : (
        <FlatList
          data={data!.items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
          contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.md }}
          renderItem={({ item }) => (
            <ProductTile product={item} currency={currency} width={undefined as never} />
          )}
          ListHeaderComponent={
            <Text style={[typography.small, { paddingHorizontal: spacing.lg }]}>
              {data!.pagination.total} product{data!.pagination.total === 1 ? '' : 's'}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.surfaceMuted },
  searchWrap: { padding: spacing.lg, paddingBottom: spacing.sm },
  searchInput: { borderRadius: radius.full, paddingHorizontal: spacing.lg },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  chipActive: { backgroundColor: palette.primary, borderColor: palette.primary },
  chipText: { fontSize: 13, color: palette.textMuted },
  chipTextActive: { color: palette.primaryFg, fontWeight: '600' },
});

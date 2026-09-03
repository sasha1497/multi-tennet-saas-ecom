import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState, Loading } from '@/components/ui';
import { useStore } from '@/lib/store-context';
import { palette, radius, spacing, typography } from '@/lib/theme';

export default function CategoriesScreen() {
  const { bootstrap } = useStore();
  const router = useRouter();

  if (!bootstrap) return <Loading />;

  if (bootstrap.categories.length === 0) {
    return (
      <EmptyState
        icon="grid-outline"
        title="No categories yet"
        description="This store has not organised its products into categories."
      />
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: palette.surfaceMuted }}
      data={bootstrap.categories}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() => router.push(`/(shop)/search?category=${item.slug}`)}
          accessibilityRole="button"
        >
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.image} />
          ) : (
            <View style={[styles.image, styles.fallback]}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: palette.textSubtle }}>
                {item.name.charAt(0)}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={typography.h3}>{item.name}</Text>
            {typeof item.productCount === 'number' && (
              <Text style={typography.small}>
                {item.productCount} product{item.productCount === 1 ? '' : 's'}
              </Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.textSubtle} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
  },
  image: { width: 56, height: 56, borderRadius: radius.md },
  fallback: {
    backgroundColor: palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

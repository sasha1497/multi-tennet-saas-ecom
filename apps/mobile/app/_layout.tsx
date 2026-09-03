import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { Loading } from '@/components/ui';
import { StoreProvider, useStore } from '@/lib/store-context';
import { palette } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // A phone loses connectivity constantly; one retry smooths over a blip
      // without leaving the user staring at a spinner on a real outage.
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Routes to the right place once the app knows which store (if any) is open.
 *
 * A shopper with no store selected lands on discovery; everyone else goes
 * straight into the shop they were last in.
 */
function RootNavigator() {
  const { bootstrap, booting } = useStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (booting) return;
    const onDiscovery = segments[0] === 'discover';

    if (!bootstrap && !onDiscovery) {
      router.replace('/discover');
    } else if (bootstrap && onDiscovery) {
      router.replace('/(shop)');
    }
  }, [bootstrap, booting, segments, router]);

  if (booting) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surface }}>
        <Loading label="Opening your store…" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTitleStyle: { fontSize: 16, fontWeight: '600', color: palette.text },
        headerTintColor: palette.primary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: palette.surfaceMuted },
      }}
    >
      <Stack.Screen name="discover" options={{ headerShown: false }} />
      <Stack.Screen name="(shop)" options={{ headerShown: false }} />
      <Stack.Screen name="product/[slug]" options={{ title: '' }} />
      <Stack.Screen name="cart" options={{ title: 'Your bag' }} />
      <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
      <Stack.Screen name="order/[orderNumber]" options={{ title: 'Order' }} />
      <Stack.Screen name="login" options={{ title: 'Sign in', presentation: 'modal' }} />
      <Stack.Screen name="register" options={{ title: 'Create account', presentation: 'modal' }} />
      <Stack.Screen name="scan" options={{ title: 'Scan a store QR', presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StoreProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </StoreProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

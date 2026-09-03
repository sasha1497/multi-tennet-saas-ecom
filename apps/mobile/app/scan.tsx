import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Card, Loading } from '@/components/ui';
import { useStore } from '@/lib/store-context';
import { palette, radius, spacing, typography } from '@/lib/theme';

/**
 * QR tenant discovery.
 *
 * A merchant prints a code containing their storefront URL
 * (`https://kickzone.ourdomain.in`) or a deep link (`retailos://store/kickzone`).
 * Both forms reduce to a slug here, which is then resolved through the same
 * `domains` lookup as every other entry point.
 */
export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const { selectStore } = useStore();
  const router = useRouter();
  const [handling, setHandling] = useState(false);

  if (!permission) return <Loading label="Preparing the camera…" />;

  if (!permission.granted) {
    return (
      <View style={styles.centre}>
        <Card style={{ gap: spacing.lg, alignItems: 'center' }}>
          <Text style={[typography.h3, { textAlign: 'center' }]}>Camera access needed</Text>
          <Text style={[typography.bodyMuted, { textAlign: 'center' }]}>
            Allow the camera so you can scan a shop&apos;s QR code. You can still type the store
            address instead.
          </Text>
          <Button title="Allow camera" fullWidth onPress={() => void requestPermission()} />
          <Button title="Enter address instead" variant="ghost" onPress={() => router.back()} />
        </Card>
      </View>
    );
  }

  const onScan = async ({ data }: { data: string }) => {
    if (handling) return;
    setHandling(true);

    const slug = extractSlug(data);
    if (!slug) {
      setHandling(false);
      return;
    }

    const ok = await selectStore(slug);
    if (ok) router.replace('/(shop)');
    else setHandling(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handling ? undefined : onScan}
      />
      <View style={styles.overlay}>
        <View style={styles.frame} />
        <Text style={styles.hint}>
          {handling ? 'Opening store…' : 'Point the camera at the shop&apos;s QR code'}
        </Text>
        <Button
          title="Enter address instead"
          variant="ghost"
          onPress={() => router.back()}
          style={{ marginTop: spacing.lg }}
        />
      </View>
    </View>
  );
}

/**
 * Reduces a scanned value to a tenant slug.
 *
 * Accepts a full storefront URL, a `retailos://store/<slug>` deep link, or a
 * bare slug — merchants print whichever their QR generator produced.
 */
function extractSlug(value: string): string | null {
  const trimmed = value.trim();

  if (/^[a-z0-9][a-z0-9-]{1,62}$/i.test(trimmed)) return trimmed.toLowerCase();

  try {
    const url = new URL(trimmed);
    if (url.protocol === 'retailos:') {
      // retailos://store/kickzone
      return url.pathname.replace(/^\/+/, '').split('/').pop()?.toLowerCase() ?? null;
    }
    const [subdomain] = url.hostname.split('.');
    return subdomain ? subdomain.toLowerCase() : null;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: palette.surfaceMuted,
  },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: 230,
    height: 230,
    borderWidth: 3,
    borderColor: '#fff',
    borderRadius: radius.xl,
    backgroundColor: 'transparent',
  },
  hint: {
    color: '#fff',
    marginTop: spacing.xl,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
});

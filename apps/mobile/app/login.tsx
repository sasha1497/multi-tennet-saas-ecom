import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Input } from '@/components/ui';
import { useStore } from '@/lib/store-context';
import { palette, spacing, typography } from '@/lib/theme';

export default function LoginScreen() {
  const { bootstrap, login } = useStore();
  const router = useRouter();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await login(identifier.trim(), password);
      router.back();
    } catch (err) {
      Alert.alert(
        'Could not sign in',
        err instanceof Error ? err.message : 'Check your details and try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: palette.surfaceMuted }}
    >
      <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
        <View style={{ marginBottom: spacing.xl }}>
          <Text style={typography.h1}>Welcome back</Text>
          <Text style={typography.bodyMuted}>
            Sign in to {bootstrap?.store.storeName ?? 'your store'}
          </Text>
        </View>

        <Card style={{ gap: spacing.lg }}>
          <Input
            label="Email or mobile number"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={identifier}
            onChangeText={setIdentifier}
          />
          <Input
            label="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
          <Button title="Sign in" size="lg" fullWidth loading={loading} onPress={() => void submit()} />
        </Card>

        <View style={{ marginTop: spacing.lg, alignItems: 'center' }}>
          <Button
            title="Create an account instead"
            variant="ghost"
            onPress={() => router.replace('/register')}
          />
        </View>

        {__DEV__ && (
          <Card style={{ marginTop: spacing.lg, backgroundColor: palette.surface }}>
            <Text style={[typography.small, { fontWeight: '600' }]}>Demo shopper</Text>
            <Button
              title="Fill demo credentials"
              variant="ghost"
              onPress={() => {
                const slug = bootstrap?.tenant.slug;
                setIdentifier(
                  slug === 'kickzone'
                    ? 'priya@example.com'
                    : slug === 'abcstore'
                      ? 'vikram@example.com'
                      : 'karthik@example.com',
                );
                setPassword('Password@123');
              }}
            />
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

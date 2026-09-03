import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Input } from '@/components/ui';
import { useStore } from '@/lib/store-context';
import { palette, spacing, typography } from '@/lib/theme';

export default function RegisterScreen() {
  const { bootstrap, register } = useStore();
  const router = useRouter();

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        password: form.password,
      });
      router.back();
    } catch (err) {
      Alert.alert(
        'Could not create your account',
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
          <Text style={typography.h1}>Create your account</Text>
          <Text style={typography.bodyMuted}>
            Track orders and check out faster at {bootstrap?.store.storeName ?? 'this store'}.
          </Text>
        </View>

        <Card style={{ gap: spacing.lg }}>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Input
                label="First name"
                value={form.firstName}
                onChangeText={(v) => setForm({ ...form, firstName: v })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                label="Last name"
                value={form.lastName}
                onChangeText={(v) => setForm({ ...form, lastName: v })}
              />
            </View>
          </View>
          <Input
            label="Email address"
            autoCapitalize="none"
            keyboardType="email-address"
            value={form.email}
            onChangeText={(v) => setForm({ ...form, email: v })}
          />
          <Input
            label="Mobile number"
            keyboardType="phone-pad"
            value={form.phone}
            onChangeText={(v) => setForm({ ...form, phone: v })}
            hint="For delivery updates."
          />
          <Input
            label="Password"
            secureTextEntry
            value={form.password}
            onChangeText={(v) => setForm({ ...form, password: v })}
            hint="At least 8 characters, with a letter and a number."
          />
          <Button
            title="Create account"
            size="lg"
            fullWidth
            loading={loading}
            onPress={() => void submit()}
          />
        </Card>

        <View style={{ marginTop: spacing.lg, alignItems: 'center' }}>
          <Button
            title="I already have an account"
            variant="ghost"
            onPress={() => router.replace('/login')}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

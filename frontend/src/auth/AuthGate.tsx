import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, apiRequest } from '../api/client';
import { AppLogo } from '../components/ui/AppLogo';
import { Button } from '../components/ui/Button';
import { useTheme } from '../theme/ThemeContext';
import { MOBILE_INPUT_FONT_SIZE, radius, typography } from '../theme/tokens';
import { useAuth } from './AuthContext';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { colors } = useTheme();

  if (!auth.ready) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.bg }]}>
        <AppLogo size={64} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!auth.authenticated) return <CredentialsScreen />;
  if (!auth.onboardingComplete) return <UsernameScreen />;
  return <>{children}</>;
}

function CredentialsScreen() {
  const { colors } = useTheme();
  const { login, register } = useAuth();
  const [mode, setMode] = React.useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        if (password.length < 10) throw new Error('Use at least 10 characters for your password.');
        await register({ email, password, displayName });
      } else {
        await login(email, password);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not continue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.authContent}
        >
          <View style={styles.brand}>
            <AppLogo size={76} />
            <Text style={[styles.heading, { color: colors.text }]}>Welcome to Parul</Text>
            <Text style={[styles.subheading, { color: colors.textSecondary }]}>
              Care, community, and safer outcomes for every companion.
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.segment, { backgroundColor: colors.surface2 }]}>
              {(['login', 'register'] as const).map(item => (
                <Pressable
                  key={item}
                  onPress={() => {
                    setMode(item);
                    setError(null);
                  }}
                  style={[
                    styles.segmentButton,
                    mode === item && { backgroundColor: colors.primary },
                  ]}
                >
                  <Text style={{
                    color: mode === item ? colors.onPrimary : colors.textSecondary,
                    fontWeight: '700',
                  }}>
                    {item === 'login' ? 'Sign in' : 'Create account'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {mode === 'register' && (
              <AuthInput
                label="Name"
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your display name"
                autoCapitalize="words"
              />
            )}
            <AuthInput
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <AuthInput
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'}
              secureTextEntry
              autoCapitalize="none"
            />

            {error && (
              <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
            )}
            <Button
              size="lg"
              loading={busy}
              disabled={!email.trim() || !password || (mode === 'register' && !displayName.trim())}
              onPress={submit}
            >
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function UsernameScreen() {
  const { colors } = useTheme();
  const { completeUsername, logout } = useAuth();
  const [username, setUsername] = React.useState('');
  const [available, setAvailable] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const candidate = username.trim();
    if (candidate.length < 3) {
      setAvailable(null);
      return;
    }
    const timer = setTimeout(() => {
      apiRequest<{ available: boolean }>(
        `/usernames/${encodeURIComponent(candidate)}/availability`,
        { authenticated: false },
      )
        .then(result => setAvailable(result.available))
        .catch(() => setAvailable(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [username]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await completeUsername(username);
    } catch (caught) {
      setError(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : 'Could not save that username.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.onboarding}>
        <AppLogo size={64} />
        <Text style={[styles.heading, { color: colors.text }]}>Choose your username</Text>
        <Text style={[styles.subheading, { color: colors.textSecondary }]}>
          This becomes your public Parul handle. You can finish your profile after this step.
        </Text>
        <View style={[styles.usernameBox, { borderColor: colors.borderStrong }]}>
          <Text style={[styles.at, { color: colors.primary }]}>@</Text>
          <TextInput
            value={username}
            onChangeText={value => {
              setUsername(value.toLowerCase().replace(/\s/g, ''));
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="yourname"
            placeholderTextColor={colors.textTertiary}
            style={[styles.usernameInput, { color: colors.text }]}
          />
        </View>
        {available != null && (
          <Text style={{ color: available ? colors.success : colors.danger }}>
            {available ? 'Username is available' : 'Username is not available'}
          </Text>
        )}
        {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
        <Button
          size="lg"
          loading={busy}
          disabled={username.trim().length < 3 || available === false}
          onPress={submit}
          style={styles.wideButton}
        >
          Continue to Parul
        </Button>
        <Button variant="ghost" onPress={() => void logout()}>Sign out</Button>
      </View>
    </SafeAreaView>
  );
}

function AuthInput({
  label,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.textTertiary}
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.bg },
          props.style,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  authContent: {
    flexGrow: 1,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    padding: 24,
    gap: 28,
  },
  brand: { alignItems: 'center', gap: 8 },
  heading: { fontSize: 30, fontWeight: '800', letterSpacing: -0.7, textAlign: 'center' },
  subheading: { ...typography.bodySm, textAlign: 'center', maxWidth: 390 },
  card: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: 20,
    gap: 16,
  },
  segment: { flexDirection: 'row', padding: 4, borderRadius: radius.full },
  segmentButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.full,
  },
  field: { gap: 6 },
  label: { ...typography.label },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: MOBILE_INPUT_FONT_SIZE,
  },
  error: { ...typography.small, textAlign: 'center' },
  onboarding: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  usernameBox: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 16,
  },
  at: { fontSize: 22, fontWeight: '700' },
  usernameInput: { flex: 1, minHeight: 54, fontSize: 18, fontWeight: '600' },
  wideButton: { width: '100%' },
});

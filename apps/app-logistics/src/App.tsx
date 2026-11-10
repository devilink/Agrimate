import { StatusBar } from 'expo-status-bar';
import type { ComponentType } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './lib/auth';
import { CameraProvider } from './lib/camera';
import { Navigator, useNav } from './lib/nav';
import { NetProvider, useNet } from './lib/net';
import { QueueProvider, useQueueItems } from './lib/queue';
import { colors, OfflineBanner, styles } from './lib/ui';
import { AcceptTripScreen } from './screens/AcceptTripScreen';
import { DeliverScreen } from './screens/DeliverScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LoginScreen } from './screens/LoginScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { QueueScreen } from './screens/QueueScreen';
import { TripScreen } from './screens/TripScreen';
import { VehiclesScreen } from './screens/VehiclesScreen';

/** Shown on every screen while anything is waiting, so that a driver always knows what has not reached Agrimate yet. */
function QueueBar() {
  const items = useQueueItems();
  const { online } = useNet();
  const nav = useNav();
  if (!items.length) return null;
  const attention = items.filter((i) => i.attention).length;
  const text = attention
    ? `${attention} item${attention > 1 ? 's need' : ' needs'} your attention. Tap to see.`
    : `${items.length} item${items.length > 1 ? 's' : ''} ${online ? 'sending' : 'saved, waiting for a connection'}. Tap to see.`;
  return (
    <Pressable accessibilityRole="button" onPress={() => nav.push('Queue')} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: attention ? colors.errBg : colors.warnBg }}>
      <Text style={{ fontSize: 15, fontWeight: '600', color: attention ? colors.danger : colors.warn }}>{text}</Text>
    </Pressable>
  );
}

const WithBar = (Screen: ComponentType<{ params: any }>) => function Wrapped({ params }: { params: any }) {
  return <View style={styles.flex}><QueueBar /><View style={styles.flex}><Screen params={params} /></View></View>;
};

const screens = {
  Home: WithBar(HomeScreen), Trip: WithBar(TripScreen), AcceptTrip: WithBar(AcceptTripScreen), Deliver: WithBar(DeliverScreen),
  Vehicles: WithBar(VehiclesScreen), Documents: WithBar(OnboardingScreen), Queue: QueueScreen,
};

function Root() {
  const { status, me } = useAuth();
  const items = useQueueItems();
  if (status === 'loading') return <View style={[styles.flex, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator size="large" color={colors.primary} /></View>;
  if (status === 'out' || !me) return <Navigator key="out" screens={{ Login: LoginScreen }} initial="Login" />;
  // A submission waiting in the queue counts as sent. The driver sees the waiting state rather than the form again.
  const profileQueued = items.some((i) => i.kind === 'PROFILE');
  const docStatus = me.logistics?.status ?? 'NOT_SUBMITTED';
  if (docStatus === 'NOT_SUBMITTED' && !profileQueued) return <Navigator key="onboarding" screens={{ Onboarding: OnboardingScreen }} initial="Onboarding" />;
  return <Navigator key={me.id} screens={screens} initial="Home" />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NetProvider>
        <AuthProvider>
          <QueueProvider>
            <CameraProvider>
              <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]}>
                <OfflineBanner />
                <Root />
              </SafeAreaView>
            </CameraProvider>
          </QueueProvider>
        </AuthProvider>
      </NetProvider>
    </SafeAreaProvider>
  );
}

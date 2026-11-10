import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './lib/auth';
import { CameraProvider } from './lib/camera';
import { Navigator } from './lib/nav';
import { NetProvider } from './lib/net';
import { colors, OfflineBanner, styles } from './lib/ui';
import { DegreeEditScreen } from './screens/DegreeEditScreen';
import { HomeScreen } from './screens/HomeScreen';
import { JobDetailScreen } from './screens/JobDetailScreen';
import { LoginScreen } from './screens/LoginScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';

const screens = { Home: HomeScreen, JobDetail: JobDetailScreen, DegreeEdit: DegreeEditScreen };

function Root() {
  const { status, me } = useAuth();
  if (status === 'loading') return <View style={[styles.flex, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator size="large" color={colors.primary} /></View>;
  if (status === 'out' || !me) return <Navigator key="out" screens={{ Login: LoginScreen }} initial="Login" />;
  const degreeStatus = me.inspector?.status ?? 'NOT_SUBMITTED';
  if (degreeStatus === 'NOT_SUBMITTED') return <Navigator key="onboarding" screens={{ Onboarding: OnboardingScreen }} initial="Onboarding" />;
  return <Navigator key={me.id} screens={screens} initial="Home" />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NetProvider>
        <AuthProvider>
          <CameraProvider>
            <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]}>
              <OfflineBanner />
              <Root />
            </SafeAreaView>
          </CameraProvider>
        </AuthProvider>
      </NetProvider>
    </SafeAreaProvider>
  );
}

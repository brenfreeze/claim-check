import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_400Regular_Italic } from '@expo-google-fonts/ibm-plex-sans/400Regular_Italic';
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';
import { SourceSerif4_500Medium } from '@expo-google-fonts/source-serif-4/500Medium';
import { SourceSerif4_600SemiBold } from '@expo-google-fonts/source-serif-4/600SemiBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useIsOnline } from '../src/core/connectivity';
import { flushQueuedEnrichments } from '../src/ui/checkStore';
import { color } from '../src/ui/tokens';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SourceSerif4_500Medium,
    SourceSerif4_600SemiBold,
    IBMPlexSans_400Regular,
    IBMPlexSans_400Regular_Italic,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
  });
  const online = useIsOnline();

  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);

  // Queued Online enrichments run as soon as connectivity returns.
  useEffect(() => {
    if (online) flushQueuedEnrichments();
  }, [online]);

  if (!loaded && !error) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />
    </SafeAreaProvider>
  );
}

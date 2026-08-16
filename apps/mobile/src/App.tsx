/**
 * The root component: the real shell `13.7-a`'s boot screen deferred to here —
 * app-level providers, the config guard it already had, and the tab/stack
 * navigation `13.7-f`…`-j` hang their screens off.
 */
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConfigErrorScreen } from './app/ConfigErrorScreen';
import { RootNavigator } from './app/RootNavigator';
import { MobileConfigError, readMobileConfig } from './config';
import { ThemeProvider } from './theme/theme';

export default function App() {
  const config = useMemo(() => {
    try {
      return { ok: true as const, value: readMobileConfig() };
    } catch (error) {
      // A misconfigured `app.json` is the single most likely reason a fresh
      // checkout shows a blank app. Say so on screen instead of white-screening.
      if (error instanceof MobileConfigError) return { ok: false as const, error };
      throw error;
    }
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StatusBar style="auto" />
        {config.ok ? <RootNavigator /> : <ConfigErrorScreen message={config.error.message} />}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * The root component: the real shell `13.7-a`'s boot screen deferred to here —
 * app-level providers, the config guard it already had, and the tab/stack
 * navigation `13.7-f`…`-j` hang their screens off.
 */
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConfigErrorScreen } from './app/ConfigErrorScreen';
import { ErrorBoundary } from './app/ErrorBoundary';
import { RootNavigator } from './app/RootNavigator';
import { ServicesProvider } from './app/services';
import { MobileConfigError, readMobileConfig } from './config';
import { ThemeProvider } from './theme/theme';

export default function App() {
  const config = useMemo(() => {
    try {
      return { ok: true as const, value: readMobileConfig() };
    } catch (error) {
      // A misconfigured `app.config.ts` is the single most likely reason a fresh
      // checkout shows a blank app. Say so on screen instead of white-screening.
      if (error instanceof MobileConfigError) return { ok: false as const, error };
      throw error;
    }
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StatusBar style="auto" />
        {/* The session and the API client are built from the config, so they
            only exist on the branch where there is one — a screen behind the
            config error has nothing to talk to anyway. */}
        {config.ok ? (
          // The boundary goes inside the config branch, not around it: a missing
          // config value is not a thrown render and has an answer of its own
          // above, whereas everything below here is code that can throw and has
          // nothing but a white screen if it does (13.7-v).
          <ErrorBoundary>
            <ServicesProvider config={config.value}>
              <RootNavigator />
            </ServicesProvider>
          </ErrorBoundary>
        ) : (
          <ConfigErrorScreen message={config.error.message} />
        )}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

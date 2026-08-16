/**
 * The root component, for now a boot screen.
 *
 * `13.7-e` replaces this with the real shell (navigation + the RN rendering of
 * the design tokens) and `13.7-f`…`-j` hang the four surfaces off it. What it
 * has to do today is prove the bundle is wired end to end: it reads the config
 * `app.json` supplies, it names the endpoints straight out of the shared
 * contract, and it renders a value imported at runtime from `@nexa/types`. If
 * any of those three links were broken, `expo export` would fail here rather
 * than in the window that first needs them.
 */
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EVENT_TYPES } from '@nexa/types';

import { MobileConfigError, readMobileConfig } from './config';
import { MOBILE_ENDPOINTS } from './lib/contract';

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
    <View style={styles.screen}>
      <StatusBar style="auto" />
      <View style={styles.content}>
        <Text style={styles.title}>Nexa</Text>

        {config.ok ? (
          <>
            <Text accessibilityRole="text" style={styles.line}>
              API {config.value.apiBaseUrl}
            </Text>
            <Text accessibilityRole="text" style={styles.line}>
              RTM {config.value.rtmBaseUrl}
            </Text>
          </>
        ) : (
          <Text accessibilityRole="alert" style={styles.error}>
            {config.error.message}
          </Text>
        )}

        <Text style={styles.line}>
          {`${Object.keys(MOBILE_ENDPOINTS).length} contract endpoints · ${EVENT_TYPES.length} event types`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#ffffff' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 32, fontWeight: '700' },
  line: { fontSize: 14, color: '#475569' },
  error: { fontSize: 14, color: '#b91c1c', textAlign: 'center' },
});

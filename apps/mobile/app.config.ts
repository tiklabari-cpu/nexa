/**
 * Expo config-as-code (replaces the old static `app.json`, 13.7-t). The only
 * reason to prefer this over JSON: `extra` needs to read an environment
 * variable. A physical phone cannot reach `localhost` — it needs the dev
 * machine's LAN IP — and a static file had no way to express "default to the
 * local API, but let `NEXA_API_BASE_URL` override it." See
 * `apps/mobile/README.md` ("Running on a device") for what each target needs.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Nexa',
  slug: 'nexa',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  scheme: 'nexa',
  platforms: ['ios', 'android'],
  // `newArchEnabled` and `android.edgeToEdgeEnabled` dropped: SDK 57's
  // `@expo/config-types` no longer has either — the New Architecture and
  // edge-to-edge are both mandatory now, not optional toggles.
  ios: { bundleIdentifier: 'com.nexa.app', supportsTablet: true },
  android: { package: 'com.nexa.app' },
  plugins: [['expo-notifications', { color: '#2d67fa' }]],
  extra: {
    // Matches the API port in the root README's "Quick start" table.
    apiBaseUrl: process.env.NEXA_API_BASE_URL ?? 'http://localhost:4000/api/v1',
    rtmBaseUrl: process.env.NEXA_RTM_BASE_URL ?? 'ws://localhost:4001',
  },
});

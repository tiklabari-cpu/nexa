/**
 * Expo config-as-code (replaces the old static `app.json`, 13.7-t). The only
 * reason to prefer this over JSON: `extra` needs to read an environment
 * variable. A physical phone cannot reach `localhost` — it needs the dev
 * machine's LAN IP — and a static file had no way to express "default to the
 * local API, but let `NEXA_API_BASE_URL` override it." See
 * `apps/mobile/README.md` ("Running on a device") for what each target needs.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

// brand-500 — apps/mobile/src/theme/tokens.ts (`COLORS.light.brand500`).
// `apps/mobile/scripts/gen-assets.mjs` draws every generated icon in this
// same color; `src/__tests__/assets.test.ts` checks the two do not drift.
const BRAND_500 = '#2d67fa';

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
  // edge-to-edge are both mandatory now, not optional toggles. Root `splash`
  // is gone the same way (13.7-u) — a real splash screen needs the
  // `expo-splash-screen` config plugin, not a dependency this task adds;
  // `backgroundColor` below is the one splash-adjacent field SDK 57 still has
  // at the root (the native view's color before React paints anything).
  icon: './assets/icon.png',
  backgroundColor: BRAND_500,
  ios: { bundleIdentifier: 'com.nexa.app', supportsTablet: true },
  android: {
    package: 'com.nexa.app',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: BRAND_500,
    },
  },
  plugins: [['expo-notifications', { icon: './assets/notification-icon.png', color: BRAND_500 }]],
  extra: {
    // Matches the API port in the root README's "Quick start" table.
    apiBaseUrl: process.env.NEXA_API_BASE_URL ?? 'http://localhost:4000/api/v1',
    rtmBaseUrl: process.env.NEXA_RTM_BASE_URL ?? 'ws://localhost:4001',
  },
});

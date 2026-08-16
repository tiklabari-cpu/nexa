/* eslint-env node */
/**
 * `SafeAreaProvider` measures its frame through a real native `onLayout`,
 * which never fires under `react-test-renderer` — left unmocked, the
 * subtree it wraps would render empty forever, waiting on a layout pass
 * that will never come. The package ships a mock for exactly this
 * (react-navigation's own testing docs point at the same file), but it
 * publishes one default export where the real module publishes named
 * ones (`SafeAreaProvider`, `useSafeAreaInsets`, …) — spread it back onto
 * named exports so `import { SafeAreaProvider }` (this app's own code, and
 * react-navigation's internals, which read insets for headers and tab
 * bars) resolves against the mock the same way it resolves against the
 * real module.
 */
jest.mock('react-native-safe-area-context', () => {
  const { default: mock } = jest.requireActual('react-native-safe-area-context/jest/mock');
  return { __esModule: true, ...mock };
});

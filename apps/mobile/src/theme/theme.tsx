/**
 * The runtime half of the token module: which of `COLORS.light`/`COLORS.dark`
 * is active right now, and how a screen reaches it.
 *
 * Unlike the web app (`apps/web/src/lib/theme.ts`), which pins `dark` as a
 * fixed default because its whole `apps/e2e/kanit/` evidence set was captured
 * in that theme, mobile carries no such screenshot set and `app.json` already
 * declares `userInterfaceStyle: "automatic"` — so the OS preference (RN's
 * `useColorScheme`) is the honest default here, not a fixed override. A screen
 * can still force one explicitly (Settings → Appearance, `13.7-j`), which is
 * what `setTheme` is for.
 */
import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';

import { COLORS, type ColorTokens, type ThemeName } from './tokens';

interface ThemeContextValue {
  theme: ThemeName;
  colors: ColorTokens;
  /** `null` returns to following the OS preference. */
  setTheme: (theme: ThemeName | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const scheme = useColorScheme();
  const [override, setOverride] = useState<ThemeName | null>(null);
  const theme: ThemeName = override ?? (scheme === 'light' ? 'light' : 'dark');

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, colors: COLORS[theme], setTheme: setOverride }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active theme, its colour tokens, and the setter to override it. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error('useTheme must be called within a ThemeProvider');
  return ctx;
}

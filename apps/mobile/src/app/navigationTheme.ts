/**
 * The one place a token colour turns into a React Navigation option. Every
 * stack's header and the tab bar itself read from here, so a theme change is
 * still the one-file change it is on the web (`tokens.css`'s own promise).
 */
import type { Theme as NavigationTheme } from '@react-navigation/native';
import { DarkTheme, DefaultTheme } from '@react-navigation/native';
import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

import type { ColorTokens, ThemeName } from '../theme/tokens';

/** The colours `NavigationContainer` itself uses — screen background, borders, the default header. */
export function buildNavigationTheme(theme: ThemeName, colors: ColorTokens): NavigationTheme {
  const base = theme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: theme === 'dark',
    colors: {
      ...base.colors,
      primary: colors.brandText,
      background: colors.bgCanvas,
      card: colors.bgSurface,
      text: colors.textPrimary,
      border: colors.border,
      notification: colors.danger,
    },
  };
}

/** Every stack's `screenOptions` — one header style for all four tabs. */
export function buildStackScreenOptions(colors: ColorTokens): NativeStackNavigationOptions {
  return {
    headerStyle: { backgroundColor: colors.bgSurface },
    headerTintColor: colors.textPrimary,
    headerShadowVisible: false,
    contentStyle: { backgroundColor: colors.bgCanvas },
  };
}

/** The tab bar itself. */
export function buildTabScreenOptions(colors: ColorTokens): BottomTabNavigationOptions {
  return {
    headerShown: false,
    tabBarActiveTintColor: colors.brandText,
    tabBarInactiveTintColor: colors.textTertiary,
    tabBarStyle: { backgroundColor: colors.bgSurface, borderTopColor: colors.border },
  };
}
